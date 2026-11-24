// functions/scoring.ts
// 与 src/lib/scoring.ts 完全一致，保证前后端分数相同

export type IssueCategory =
  | "mistranslation"
  | "omission"
  | "wording"
  | "grammar"
  | "logic";

export type Severity = "light" | "moderate" | "severe";

export interface Issue {
  sentenceIndex: number;
  category: IssueCategory;
  severity: Severity;
  quote: string;
  problem: string;
  suggestion: string;
}

export interface Sentence {
  index: number;
  source: string;
  reference: string;
}

export interface Rubric {
  version: string;
  title: string;
  totalScore: number;
  sentenceFloor: number;
  deductions: { category: IssueCategory; severity: Severity; points: number }[];
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
  score: number;
  totalScore: number;
  sentenceScores: SentenceScore[];
  issues: Issue[];
  summary: string;
}

const ISSUE_LABELS: Record<IssueCategory, string> = {
  mistranslation: "误译",
  omission: "漏译",
  wording: "用词不当",
  grammar: "语法问题",
  logic: "逻辑问题",
};

function deductionPoints(
  rubric: Rubric,
  category: IssueCategory,
  severity: Severity,
): number {
  return (
    rubric.deductions.find((d) => d.category === category && d.severity === severity)
      ?.points ?? 0
  );
}

function allocateTotal(total: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

export function computeScore(
  rubric: Rubric,
  sentences: Sentence[],
  issues: Issue[],
): { score: number; sentenceScores: SentenceScore[] } {
  const maxima = allocateTotal(rubric.totalScore, sentences.length);

  const sentenceScores: SentenceScore[] = sentences.map((sentence, i) => {
    const lost = issues
      .filter((issue) => issue.sentenceIndex === sentence.index)
      .reduce(
        (total, issue) => total + deductionPoints(rubric, issue.category, issue.severity),
        0,
      );
    return {
      index: sentence.index,
      max: maxima[i],
      score: Math.max(rubric.sentenceFloor, maxima[i] - lost),
    };
  });

  const score = sentenceScores.reduce((total, item) => total + item.score, 0);
  return { score: round1(score), sentenceScores };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function buildEvaluation(
  materialId: string,
  rubric: Rubric,
  sentences: Sentence[],
  issues: Issue[],
  provider: string,
  model: string,
): Evaluation {
  const { score, sentenceScores } = computeScore(rubric, sentences, issues);
  return {
    materialId,
    status: "ok",
    isMock: false,
    rubricVersion: rubric.version,
    provider,
    model,
    submitted: new Date().toISOString(),
    score,
    totalScore: rubric.totalScore,
    sentenceScores,
    issues,
    summary: summarize(rubric, issues, sentenceScores),
  };
}

function summarize(rubric: Rubric, issues: Issue[], sentenceScores: SentenceScore[]): string {
  if (issues.length === 0) return "未发现问题。";
  const counts = new Map<IssueCategory, number>();
  const lostBySentence = new Map<number, number>();
  for (const issue of issues) {
    const points = deductionPoints(rubric, issue.category, issue.severity);
    counts.set(issue.category, (counts.get(issue.category) ?? 0) + 1);
    lostBySentence.set(issue.sentenceIndex, (lostBySentence.get(issue.sentenceIndex) ?? 0) + points);
  }
  const parts = [...counts]
    .map(([category, n]) => `${ISSUE_LABELS[category]}×${n}`)
    .join("、");
  const severe = issues.filter((issue) => issue.severity === "severe").length;
  const actualLost = new Map(
    sentenceScores.map((item) => [item.index, round1(item.max - item.score)]),
  );
  const worst = [...lostBySentence]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 2)
    // 排名按"本该扣多少"，显示按"实际扣了多少"：单句扣到下限为止，
    // 长材料一句只值 2 分时写"扣 11 分"会和逐句分数表自相矛盾。
    .map(([index, gross]) => {
      const actual = actualLost.get(index) ?? gross;
      return `第 ${index + 1} 项（扣 ${actual} 分）`;
    });
  const focus = worst.length > 0 ? `最需要先改${worst.join("、")}。` : "";
  const advice =
    severe > 0
      ? `其中 ${severe} 处严重错误会改变句意，优先订正。`
      : counts.size === 1
        ? "问题集中在一类，改起来有明确抓手。"
        : "以中轻度问题为主，注意选词与句子完整性。";
  return `共发现 ${issues.length} 处问题：${parts}。${focus}${advice}`;
}
