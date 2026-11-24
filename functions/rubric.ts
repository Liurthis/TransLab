// functions/rubric.ts
// 必须与 src/data/rubric.ts 完全一致；由 scripts/check-rubric.mjs 在构建前强制校验。
// 之所以存在两份：Sites 的 Function 打包只包含 functions/ 目录，不能引用前端源码。

import type { Rubric } from "./scoring.ts";

export const RUBRIC: Rubric = {
  version: "demo-0.2",
  title: "CATTI 二级笔译（英译汉 / 汉译英）示例评分表",
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
