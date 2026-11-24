import {
  ISSUE_LABELS,
  type Evaluation,
  type Issue,
  type IssueCategory,
  type Material,
  type Rubric,
  type SentenceScore,
} from "../types";
import { deductionPoints } from "../data/rubric";

export interface ScoreResult {
  score: number;
  sentenceScores: SentenceScore[];
}

// 100 分除不尽句数时，逐句取整会破坏"各句相加等于总分"。
// 这里把余数依次分给前几句，保证每句上限是整数且总和恰好等于满分。
function allocateTotal(total: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

export function computeScore(
  rubric: Rubric,
  material: Material,
  issues: Issue[],
): ScoreResult {
  const maxima = allocateTotal(rubric.totalScore, material.sentences.length);

  const sentenceScores: SentenceScore[] = material.sentences.map((sentence, i) => {
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
  material: Material,
  rubric: Rubric,
  issues: Issue[],
  meta: Pick<Evaluation, "isMock" | "provider" | "model" | "submitted">,
  study: Pick<Evaluation, "expressions" | "vocabulary"> = { expressions: [], vocabulary: [] },
): Evaluation {
  const { score, sentenceScores } = computeScore(rubric, material, issues);
  return {
    materialId: material.id,
    status: "ok",
    rubricVersion: rubric.version,
    score,
    totalScore: rubric.totalScore,
    sentenceScores,
    issues,
    summary: summarize(rubric, issues),
    direction: material.direction,
    // 靠材料本身判断，不采信模型的说法：没有逐句参考译文就没有可展示的对照。
    referenceAvailable: material.sentences.some((sentence) => Boolean(sentence.reference)),
    ...meta,
    ...study,
  };
}

function summarize(rubric: Rubric, issues: Issue[]): string {
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
  const worst = [...lostBySentence]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 2)
    .map(([index, lost]) => `第 ${index + 1} 句（扣 ${round1(lost)} 分）`);
  const focus = worst.length > 0 ? `最需要先改${worst.join("、")}。` : "";
  const advice =
    severe > 0
      ? `其中 ${severe} 处严重错误会改变句意，优先订正。`
      : counts.size === 1
        ? "问题集中在一类，改起来有明确抓手。"
        : "以中轻度问题为主，注意选词与句子完整性。";
  return `共发现 ${issues.length} 处问题：${parts}。${focus}${advice}`;
}
