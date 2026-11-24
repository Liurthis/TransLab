import type { Rubric } from "../types";

export const RUBRIC: Rubric = {
  version: "demo-0.2",
  title: "CATTI 二级笔译（英译汉 / 汉译英）示例评分表",
  totalScore: 100,
  sentenceFloor: 0,
  disclaimer:
    "本表权重为演示配置，未依据 CATTI 官方评分细则校准。官方并未公布逐条扣分值，" +
    "实际考试采用人工分档阅卷。两个方向共用同一组错误类别与权重。" +
    "此分数仅用于练习反馈，不代表任何官方评定。",
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
