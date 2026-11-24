// src/lib/docimport.ts
//
// 文档导入的本机一侧：把用户选的文件变成「可批改的段落」。
// 解析全在浏览器里完成，文件本身不上传、不保存；只有段落文字随评分请求发一次给 Function。

import { DocxError, readDocxParagraphs } from "./docx";
import { MAX_SEGMENTS, isMostlyChinese, isMostlyEnglish, segmentText } from "./segment";
import type { Direction } from "../types";

export interface ImportedDocument {
  name: string;
  paragraphs: string[];
  notes: string[];
}

/** 导入结果的一行：一段原文，和配上的那段译文（没配上就是 null）。 */
export interface ImportRow {
  source: string;
  target: string | null;
}

export interface PairSuggestion {
  sourceIndex: number;
  targetIndex: number | null;
}

export async function readDocument(file: File): Promise<ImportedDocument> {
  const name = file.name.trim() || "未命名文档";
  const ext = fileExtension(name);

  if (ext === ".txt") {
    return {
      name,
      paragraphs: paragraphsFromPlainText(await file.text()),
      notes: ["纯文本按空行分段；整篇没有空行时按行分段。"],
    };
  }
  if (ext === ".doc") {
    throw new DocxError(
      "legacy_doc",
      "「" + name + "」是 Word 97-2003 的 .doc。请在 Word 里「文件 → 另存为」选 .docx 后重新上传。",
    );
  }
  if (ext === ".pdf") {
    throw new DocxError(
      "pdf",
      "暂不解析 PDF。请在 Word 里打开它再另存为 .docx，或把正文另存成 .txt 上传。",
    );
  }
  // 其余后缀（含没有后缀）一律先按 .docx 试：读不出正文时由 docx.ts 报出格式与下一步。
  const parsed = await readDocxParagraphs(await file.arrayBuffer());
  return { name, ...parsed };
}

export function fileExtension(name: string): string {
  const dot = name.toLowerCase().lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

export function paragraphsFromPlainText(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  // 有空行就按空行分段；整篇没空行时只能按行分段，由用户自己确认段界。
  const blocks = /\n[ \t\f\v]*\n/.test(normalized)
    ? normalized.split(/\n[ \t\f\v]*\n+/)
    : normalized.split("\n");
  return blocks
    .map((block) => joinWrappedLines(block.split("\n")))
    .filter((paragraph) => paragraph !== "");
}

/**
 * 段内换行是排版折行，不是段落结束。中文行相接处两侧都是汉字时直接接上——
 * 补空格会在「经济」中间留一道缝，英文行相接处补空格才不粘连单词。
 */
function joinWrappedLines(lines: string[]): string {
  return lines
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .filter(Boolean)
    .reduce((joined, line) => {
      if (!joined) return line;
      const isCjkSeam = /[\u4e00-\u9fff]$/.test(joined) && /^[\u4e00-\u9fff]/.test(line);
      return isCjkSeam ? joined + line : `${joined} ${line}`;
    }, "");
}

export interface LanguageSplit {
  sourceParagraphs: string[];
  targetParagraphs: string[];
  /** 判不出语言的段落：界面必须原样列出，不能悄悄丢掉——丢掉就等于丢内容。 */
  unclassified: { index: number; text: string; reason: "mixed" | "short" }[];
}

/**
 * 单份中英对照文档：逐段判断语言。判据是汉字数与拉丁字母数谁多，
 * 这件事确定性能做，不交给模型——模型判语言会整段判反，之后每段都批错。
 */
export function splitByLanguage(paragraphs: string[], direction: Direction): LanguageSplit {
  const sourceIsChinese = direction === "zh2en";
  const split: LanguageSplit = { sourceParagraphs: [], targetParagraphs: [], unclassified: [] };

  for (const [index, text] of paragraphs.entries()) {
    const signalCount = (text.match(/[\u4e00-\u9fff]|[A-Za-z]/g) ?? []).length;
    if (signalCount < 4) {
      split.unclassified.push({ index, text, reason: "short" });
      continue;
    }
    const chinese = isMostlyChinese(text);
    const english = isMostlyEnglish(text);
    if (chinese === english) {
      // 两个都不像（汉字与字母数相当）就是中英同段，需要人工拆分，规则不猜。
      split.unclassified.push({ index, text, reason: "mixed" });
      continue;
    }
    if (chinese === sourceIsChinese) split.sourceParagraphs.push(text);
    else split.targetParagraphs.push(text);
  }
  return split;
}

/** 段数相等才按顺序 1:1；不等就绝不猜顺序，交给模型给建议、由用户确认。 */
export function sequentialPairs(
  sourceCount: number,
  targetCount: number,
): PairSuggestion[] | null {
  if (sourceCount === 0 || sourceCount !== targetCount) return null;
  return Array.from({ length: sourceCount }, (_, index) => ({
    sourceIndex: index,
    targetIndex: index,
  }));
}

export function rowsFromPairs(
  sourceParagraphs: string[],
  targetParagraphs: string[],
  pairs: PairSuggestion[],
): ImportRow[] {
  return pairs.map((pair) => {
    const target =
      pair.targetIndex === null ? null : targetParagraphs[pair.targetIndex] ?? null;
    return { source: sourceParagraphs[pair.sourceIndex] ?? "", target };
  });
}

/** 超过评分上限时提前拦下：Function 也会拒，但那时用户已经等了一次上传。 */
export function paragraphLimitError(sourceCount: number, targetCount: number): string | null {
  const over = Math.max(sourceCount, targetCount) > MAX_SEGMENTS;
  if (!over) return null;
  return `段落数 ${sourceCount} / ${targetCount} 超过 ${MAX_SEGMENTS} 段上限。请把文档拆成两份，或删掉不需要批改的段落后重新上传。`;
}

/**
 * 段数没超但句段数会超：Function 收到之后还会把每段切成句段，上限是按句段计的。
 * 这里用同一个断句器先在本地算一遍，避免用户等一次上传才被拒。
 */
export function segmentOverflowError(sourceParagraphs: string[], direction: Direction): string | null {
  const total = sourceParagraphs.reduce(
    (sum, paragraph) => sum + segmentText(paragraph, direction).length,
    0,
  );
  if (total <= MAX_SEGMENTS) return null;
  return (
    `这些段落切出来是 ${total} 个句段，超过 ${MAX_SEGMENTS} 句上限。` +
    "把不需要批改的段落标成「这段不批」，或把文档拆成两次批改。"
  );
}
