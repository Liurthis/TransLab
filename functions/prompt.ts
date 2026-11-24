// functions/prompt.ts

/**
 * 与 src/types.ts 的 Direction 保持一致。Function 打包只包含本目录，
 * 因此这里本地声明，不跨目录引用前端源码。
 */
export type Direction = "en2zh" | "zh2en";

/** 与前端断句上限保持一致，避免一次评分请求无限膨胀。 */
const MAX_SEGMENTS = 200;

export interface PromptInput {
  direction: Direction;
  sourceSentences: string[];
  userTranslations: string[];
}

export interface ModelIssue {
  sentenceIndex: number;
  category: "mistranslation" | "omission" | "wording" | "grammar" | "logic";
  severity: "light" | "moderate" | "severe";
  quote: string;
  problem: string;
  suggestion: string;
}

export interface ModelLearningItem {
  item: string;
  note: string;
}

export interface ModelResponse {
  issues: ModelIssue[];
  expressions: ModelLearningItem[];
  vocabulary: ModelLearningItem[];
}

const CATEGORIES = `五类错误（两个方向通用，变的只是原文和译文语言）：
- mistranslation（误译）：译文与原文含义不符，包括译反、译偏、术语错译
- omission（漏译）：原文有、译文无，包括整句、从句和限定词漏译
- wording（用词不当）：意思对但选词不当，含语域不符、搭配生硬、直译痕迹
- grammar（语法问题）：译文语言自身的语法、标点与句子完整性问题
- logic（逻辑问题）：句间与句内逻辑关系（因果、转折、递进）被改变或含混`;

const SEVERITY = `每处问题必须标注严重程度：
- light（轻微）：不影响整体理解的小问题
- moderate（一般）：影响局部表达准确度
- severe（严重）：改变句意或导致误解`;

const JSON_SCHEMA = `{
  "issues": [
    {
      "sentenceIndex": 0,
      "category": "mistranslation",
      "severity": "moderate",
      "quote": "问题片段：一般取自学生译文，漏译时取自原文",
      "problem": "用中文说明这里为什么错",
      "suggestion": "给出修改建议"
    }
  ],
  "expressions": [
    { "item": "值得学习的英文表达，必须是英文", "note": "用中文说明什么时候这么用" }
  ],
  "vocabulary": [
    { "item": "值得积累的英文词汇或搭配，必须是英文", "note": "用中文说明词义与用法" }
  ]
}`;

function languages(direction: Direction): { source: string; target: string } {
  return direction === "zh2en"
    ? { source: "中文原文", target: "英文译文" }
    : { source: "英文原文", target: "中文译文" };
}

export function buildPrompt(input: PromptInput): { system: string; user: string } {
  const lang = languages(input.direction);

  const system = `你是一位专业的 CATTI 二级笔译阅卷老师，负责${
    input.direction === "zh2en" ? "汉译英" : "英译中"
  }部分。

你的任务：逐句对比${lang.source}与学生的${lang.target}，找出问题并定位到具体句段。${CATEGORIES}

${SEVERITY}

关于「值得学习的表达与词汇」（expressions 与 vocabulary）：
- item 必须是英文，学生要学的是英文表达本身，两个方向都用英文给出。
- 只能取自${lang.source}、或学生${lang.target}中确实正确且地道的英文，不得编造原文里不存在的表达。
- expressions 给句子层面的表达与句型，vocabulary 给词汇与固定搭配。
- note 用中文说明什么时候这么用，不要复述题目要求。
- 确实没有值得学的东西就返回空数组，不要为凑数硬找。

关于分数：不要给分数、不要给总分、不要给评级。分数由系统按评分表确定性地计算。

输出格式：严格的 JSON，不要任何额外文字、不要 markdown 代码块。JSON 结构如下：
${JSON_SCHEMA}

如果没有问题，issues 为空数组。
sentenceIndex 从 0 开始，对应输入的句子编号。
quote 给出问题片段：默认取自学生${lang.target}；属于漏译时（含整句未译、该句留空）学生${lang.target}里没有可引内容，改为取自${lang.source}中被漏掉的那段，不要自己编，也不要替学生补写译文。
问题数量按严重程度取舍，不要为凑数罗列风格偏好。`;

  const limited = clampSentences(input);
  const sourceBlock = limited.sourceSentences.map((s, i) => `[${i}] ${s}`).join("\n");
  const translationBlock = limited.userTranslations.map((t, i) => `[${i}] ${t}`).join("\n");

  const userMessage = `请逐句分析以下${input.direction === "zh2en" ? "汉译英" : "英译中"}练习。

## ${lang.source}
${sourceBlock}

## 学生${lang.target}
${translationBlock}

请输出 JSON。`;

  return { system, user: userMessage };
}

function clampSentences(input: PromptInput): PromptInput {
  const count = Math.min(input.sourceSentences.length, MAX_SEGMENTS);
  return {
    ...input,
    sourceSentences: input.sourceSentences.slice(0, count),
    userTranslations: input.userTranslations.slice(0, count),
  };
}

export interface AlignInput {
  direction: Direction;
  sourceParagraphs: string[];
  targetParagraphs: string[];
}

/**
 * 配对只看每段开头即可判断；两份全文一起塞进一次调用会顶爆上下文，
 * 也可能把输出撑到被截断——所以给总字数设预算，段数越多每段预览越短。
 */
const ALIGN_TOTAL_CHARS = 12000;
const ALIGN_MIN_PREVIEW = 40;

export function alignPreviewCap(count: number): number {
  return Math.max(ALIGN_MIN_PREVIEW, Math.floor(ALIGN_TOTAL_CHARS / Math.max(count, 1)));
}

export function buildAlignPrompt(input: AlignInput): { system: string; user: string } {
  const lang = languages(input.direction);
  const cap = alignPreviewCap(
    Math.max(input.sourceParagraphs.length, input.targetParagraphs.length),
  );
  const preview = (text: string): string => {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > cap ? `${flat.slice(0, cap)}…` : flat;
  };

  const system = `你在为笔译批改做「段落配对」：把${lang.source}的段落与对应的${lang.target}段落配起来。
你只判断两段之间是不是互译关系，不评价译文好坏，不给分数、不给修改建议。

配对规则：
- 每个原文编号最多出现一次；配不上就写 null，绝不为填满表格而硬配。
- 一个译文编号最多被用一次。
- 学生把几段并成一段时，只配给内容最接近的那一段，其余写 null，剩下的由人工确认。
- 顺序不可靠：译文可能漏译、多译、或小标题与正文错位，必须按内容判断。
- 上面每段只显示开头 ${cap} 字，据此判断即可；不要因为结尾没看到就判成漏译。

输出格式：严格的 JSON，不要任何额外文字、不要 markdown 代码块。
{
  "pairs": [
    [0, 0],
    [1, 2],
    [2, null]
  ],
  "notes": "用中文说明哪些段落配不上、大致原因"
}
pairs 的每一项是 [原文编号, 译文编号或 null]，必须覆盖全部原文编号 ${input.sourceParagraphs.length} 个（0 起），每个编号恰好出现一次。`;

  const sourceBlock = input.sourceParagraphs.map((text, i) => `[${i}] ${preview(text)}`).join("\n");
  const targetBlock = input.targetParagraphs.map((text, i) => `[${i}] ${preview(text)}`).join("\n");

  const user = `请按内容把下面两份文档配对。

## ${lang.source}（共 ${input.sourceParagraphs.length} 段）
${sourceBlock}

## ${lang.target}（共 ${input.targetParagraphs.length} 段）
${targetBlock}

请输出 JSON。`;

  return { system, user };
}
