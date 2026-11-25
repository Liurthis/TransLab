import type { Rubric } from "../types";

export const RUBRIC: Rubric = {
  version: "demo-0.2",
  title: "CATTI 笔译（英译汉 / 汉译英）示例评分表",
  totalScore: 100,
  sentenceFloor: 0,
  deductions: [
    { category: "mistranslation", severity: "light", points: 1 },
    { category: "mistranslation", severity: "moderate", points: 3 },
    { category: "mistranslation", severity: "severe", points: 5 },

    { category: "omission", severity: "light", points: 1 },
    { category: "omission", severity: "moderate", points: 2 },
    { category: "omission", severity: "severe", points: 4 },

    { category: "wording", severity: "light", points: 0.5 },
    { category: "wording", severity: "moderate", points: 1.5 },
    { category: "wording", severity: "severe", points: 3 },

    { category: "grammar", severity: "light", points: 0.5 },
    { category: "grammar", severity: "moderate", points: 1.5 },
    { category: "grammar", severity: "severe", points: 2.5 },

    { category: "logic", severity: "light", points: 1 },
    { category: "logic", severity: "moderate", points: 2 },
    { category: "logic", severity: "severe", points: 4 },
  ],
};

export function deductionPoints(
  rubric: Rubric,
  category: Rubric["deductions"][number]["category"],
  severity: Rubric["deductions"][number]["severity"],
): number {
  return (
    rubric.deductions.find((d) => d.category === category && d.severity === severity)
      ?.points ?? 0
  );
}
