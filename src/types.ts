export type IssueCategory =
  | "mistranslation"
  | "omission"
  | "wording"
  | "grammar"
  | "logic";

export type Severity = "light" | "moderate" | "severe";

export const ISSUE_LABELS: Record<IssueCategory, string> = {
  mistranslation: "误译",
  omission: "漏译",
  wording: "用词不当",
  grammar: "语法问题",
  logic: "逻辑问题",
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  light: "轻微",
  moderate: "一般",
  severe: "严重",
};

/**
 * 翻译方向。CATTI 二级笔译同时考英译汉与汉译英，
 * 五类错误定义与权重对两个方向通用，变的只是原文/译文语言与建议表达的语言。
 */
export type Direction = "en2zh" | "zh2en";

export const DIRECTION_LABELS: Record<Direction, string> = {
  en2zh: "英译汉",
  zh2en: "汉译英",
};

/** 值得学习的英文表达或词汇；学的对象是英文，note 用中文说明何时这么用。 */
export interface LearningItem {
  item: string;
  note: string;
}

export interface Sentence {
  index: number;
  /** 原文句段，语言由 material.direction 决定。 */
  source: string;
  /**
   * 人工审定的参考译文。多数自建材料没有，因此是可选的；
   * 缺失时练习页不展示参考译文，并说明原因，而不是让模型现造一份。
   */
  reference?: string;
}

export interface Material {
  id: string;
  title: string;
  direction: Direction;
  register: string;
  difficulty: "入门" | "中级" | "高级";
  /** 未断句的整篇原文，便于重新断句与溯源。 */
  sourceText: string;
  sentences: Sentence[];
  /**
   * 材料来源说明。内置材料自带；自建材料留空时由界面推导为
   * 「用户自建材料，无人工审定参考译文」，不假装是真题材料。
   */
  sourceNote?: string;
  origin: "builtin" | "user";
  createdAt: string;
}

export interface Issue {
  sentenceIndex: number;
  category: IssueCategory;
  severity: Severity;
  quote: string;
  problem: string;
  suggestion: string;
}

export interface Deduction {
  category: IssueCategory;
  severity: Severity;
  points: number;
}

export interface Rubric {
  version: string;
  title: string;
  totalScore: number;
  sentenceFloor: number;
  deductions: Deduction[];
}

export interface SentenceScore {
  index: number;
  score: number;
  max: number;
}

export interface Evaluation {
  materialId: string;
  status: "ok" | "failed";
  isMock: boolean;
  rubricVersion: string;
  provider: string;
  model: string;
  submitted: string;
  direction: Direction;
  score: number;
  totalScore: number;
  sentenceScores: SentenceScore[];
  issues: Issue[];
  summary: string;
  /** 本材料是否含人工审定参考译文；保存的结果要靠它判断能否重现对照。 */
  referenceAvailable: boolean;
  /** 建议学习的英文表达（来自原文或参考译文），模型生成、未经人工审定。 */
  expressions: LearningItem[];
  /** 建议积累的英文词汇，模型生成、未经人工审定。 */
  vocabulary: LearningItem[];
}
