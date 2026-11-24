import type { Direction } from "../types";

/**
 * 确定性断句：同一段文本 + 同一方向，永远切出完全一样的句段。
 *
 * 为什么不交给模型切句：分数是逐句算的，模型多切一句或少切一句会连带把整篇分数算错，
 * 而规则切分你可以复核、可以在界面上手工合并/拆分，符合「分数与切句不采信模型」这条底线。
 */

/** 切错时句段数量也要有上限，避免一次粘贴几万字把评分请求撑爆。 */
export const MAX_SEGMENTS = 200;

/** 句末点号后面可能紧跟右引号、右括号、书名号，收尾符号属于本句，要一起带走。 */
const CLOSERS = `”’"')]）)》」』】`;

/** 小写字母开头的一定是新句的反面（e.g. this…），但真正的新句不会是小写开头。 */
const EN_OPENERS = /^[A-Z0-9"'“‘(\[【]/;

/**
 * 常见缩写。点号落在这类词上不算句末，否则 "Mr. Liu" 会被切成两句。
 * 这里列正式外刊、政府与学术文本里常见的，并且是「去掉点后」的形式。
 * 宁少勿滥：多列一个词，就会漏切一句真正该切的。
 */
const EN_ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "st", "sr", "jr", "hon", "rev", "gen",
  "sen", "rep", "gov", "sgt", "capt", "lt", "col", "maj", "ph", "esq",
  "inc", "ltd", "co", "corp", "plc", "pte", "bros", "dept", "univ", "govt",
  "ave", "rd", "blvd", "hwy", "mt", "fld", "fig", "figs", "no", "nos",
  "vol", "vols", "vs", "etc", "eg", "ie", "cf", "al", "ff", "approx", "est",
  "min", "max", "ref", "jr", "sr",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
]);

/** 单字母缩写式专名：U.S.、U.N.、E.U.、Ph.D. —— 内部的点不切。 */

export function segmentText(text: string, direction: Direction): string[] {
  const clean = text.replace(/\r\n?/g, "\n").trim();
  if (!clean) return [];

  const raw = direction === "zh2en" ? splitChinese(clean) : splitEnglish(clean);
  return normalizeSegments(raw);
}

function normalizeSegments(segments: string[]): string[] {
  // 故意不做「重复句段去重」：原文里的排比句确实会重复出现，
  // 静默删掉就是丢用户内容。切法正确时不会产生重复段。
  return segments
    .map((segment) => segment.replace(/[ \t\f\v]+/g, " ").replace(/\n{3,}/g, "\n\n").trim())
    .filter(Boolean)
    .slice(0, MAX_SEGMENTS);
}

function emit(text: string, start: number, end: number, out: string[]): boolean {
  const segment = text.slice(start, end);
  if (!segment.trim()) return false;
  out.push(segment);
  return true;
}

/** 吃掉连续点号与点间空格："..."、". . ."、"…"、"……" 都算一处省略号。 */
function swallowEllipsis(text: string, index: number): number {
  let end = index;
  while (end < text.length) {
    if (text[end] === "…" || text[end] === "．") {
      end += 1;
      continue;
    }
    // ". ." 形式：点之间只隔空格才算同一个省略号。
    if (text[end] === "." && (text[end + 1] === "." || text[end + 1] === " ")) {
      end += 1;
      continue;
    }
    break;
  }
  while (end < text.length && CLOSERS.includes(text[end])) end += 1;
  return end;
}

function splitEnglish(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (ch === "." || ch === "…") {
      const isEllipsis =
        ch === "…" ||
        text.slice(i, i + 2) === ".." ||
        text.slice(i, i + 3) === "...";
      const end = isEllipsis ? swallowEllipsis(text, i) : swallowClosers(text, i + 1);

      // 不切的情况：小数点（"3.5"）、已知缩写（"Mr."）。省略号不受这两条限制。
      const rejected =
        isDecimalDot(text, end) ||
        (ch === "." && !isEllipsis && endsWithAbbreviation(text.slice(start, i + 1)));

      if (end < text.length && !rejected && startsNewSentence(text.slice(end))) {
        if (emit(text, start, end, out)) start = end;
      }
      i = Math.max(end, i + 1);
      continue;
    }

    if (ch === "!" || ch === "?") {
      const end = swallowClosers(text, i + 1);
      // 连续句末点号（?!、！？）算一处切分。
      const runEnd = swallowRunners(text, end);
      if (runEnd < text.length && startsNewSentence(text.slice(runEnd))) {
        if (emit(text, start, runEnd, out)) start = runEnd;
        i = runEnd;
        continue;
      }
      i = end;
      continue;
    }

    i += 1;
  }

  const tail = text.slice(start);
  if (tail.trim()) out.push(tail);
  return out;
}

function swallowClosers(text: string, from: number): number {
  let end = from;
  while (end < text.length && CLOSERS.includes(text[end])) end += 1;
  return end;
}

function swallowRunners(text: string, from: number): number {
  let end = from;
  while (end < text.length && (text[end] === "!" || text[end] === "?")) {
    end += 1;
    end = swallowClosers(text, end);
  }
  return end;
}

/** "3.5" 里的点后面直接接数字，不是句末。 */
function isDecimalDot(text: string, end: number): boolean {
  return /[0-9]/.test(text[end] ?? "");
}

function startsNewSentence(after: string): boolean {
  const first = after.replace(/^\s+/, "").slice(0, 1);
  return EN_OPENERS.test(first);
}

function endsWithAbbreviation(segmentUpToDot: string): boolean {
  const token = tokenBefore(segmentUpToDot);
  if (!token) return false;
  // 纯大写字母加点的专名缩写：U.S.、U.N.、E.U. —— 内部的点不算句末。
  if (/^[A-Z](\.[A-Z])+\.?$/.test(token)) return true;
  // 多字母专名的第一个点，此时可见 token 只剩单个大写字母："The U.|S."。
  if (/^[A-Z]\.?$/.test(token)) return true;
  const bare = token.replace(/\./g, "");
  if (!bare) return false;
  if (EN_ABBREVIATIONS.has(bare.toLowerCase())) return true;
  // 多点缩写整体不切：Ph.D.、LL.M.、a.m. —— 字母加点、含两个以上点。
  if (((token.match(/\./g) ?? []).length >= 2) && /^[A-Za-z.]+$/.test(token)) return true;
  // 序数词尾，如 "1st."、"2nd."，保守不切。
  if (/^\d+(st|nd|rd|th)$/i.test(bare)) return true;
  return false;
}

/** 取最后一个空格之后的词，即点号所属的那个 token。 */
function tokenBefore(text: string): string {
  const trimmed = text.replace(/\s+$/, "");
  const index = Math.max(trimmed.lastIndexOf(" "), trimmed.lastIndexOf("\n"));
  return trimmed.slice(index + 1);
}

/**
 * 中文按 。！？ 切，后接右引号/书名号一起带走。
 * 故意不按 ；和 ：切：政论文里分号连接的是同一层意思，切开会改变评分粒度，
 * 想切细应当由你在界面上手工拆分，而不是让规则替你做决定。
 */
function splitChinese(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (ch === "。" || ch === "！" || ch === "？" || ch === "…") {
      const isEllipsis = ch === "…";
      let end = isEllipsis ? swallowEllipsis(text, i) : swallowClosers(text, i + 1);
      if (!isEllipsis) end = swallowRunners(text, end);
      if (end < text.length) {
        if (emit(text, start, end, out)) start = end;
        i = end;
        continue;
      }
      i = end;
      continue;
    }

    i += 1;
  }

  const tail = text.slice(start);
  if (tail.trim()) out.push(tail);
  return out;
}

/** 字数统计用：中文数汉字，英文数词。 */
export function sourceLength(text: string, direction: Direction): number {
  if (direction === "zh2en") {
    return (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  }
  return text.split(/\s+/).filter(Boolean).length;
}

export function isMostlyChinese(text: string): boolean {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return cjk > latin;
}

export function isMostlyEnglish(text: string): boolean {
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return latin > cjk;
}
