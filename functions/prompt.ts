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
      "quote": "学生译文中的具体问题片段",
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
quote 必须是学生${lang.target}中出现的原文片段，不要自己编。
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
