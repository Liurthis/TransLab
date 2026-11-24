// 离线校验 Function 的输入契约：不联网、不花模型配额。
// 运行：node scripts/check-function.mjs
//
// handler.ts 在模块顶层读 Deno.env，Node 下需要先塞一个假 Deno 才能 import。
globalThis.Deno = { env: { get: () => undefined }, serve: () => {} };

const { parseBody, parseModelJson } = await import("../functions/handler.ts");

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log("  ok   " + name);
    return;
  }
  failures += 1;
  console.log(`FAIL   ${name}\n       got ${a}\n       want ${e}`);
}

const base = {
  materialId: "urban-green",
  sourceSentences: ["Cities plant more trees.", "Mr. Liu disagrees."],
  userTranslations: ["城市多种树。", "刘先生不同意。"],
};

console.log("== 请求体校验 ==");
// 旧前端不发 direction：必须按英译汉放行，否则发布顺序一变就全线 invalid_input。
const legacy = parseBody(base);
check("缺省方向按 en2zh 放行", legacy && legacy.direction, "en2zh");
check("缺省参考译文标记为无", legacy && legacy.referenceAvailable, false);
check("显式 zh2en 被采信", parseBody({ ...base, direction: "zh2en" }).direction, "zh2en");
check("非法方向被拒", parseBody({ ...base, direction: "fr2en" }), null);
check("句子数与译文数不等被拒", parseBody({ ...base, userTranslations: ["只有一句"] }), null);
check("空原文被拒", parseBody({ ...base, sourceSentences: [] }), null);
check("全是空白译文被拒", parseBody({ ...base, userTranslations: ["  ", "\n"] }), null);
check("非对象请求体被拒", parseBody("hello"), null);
check("缺 materialId 被拒", parseBody({ ...base, materialId: "" }), null);
check(
  "超过 200 段被拒",
  parseBody({
    ...base,
    sourceSentences: Array.from({ length: 201 }, (_, i) => `S${i}.`),
    userTranslations: Array.from({ length: 201 }, (_, i) => `T${i}`),
  }),
  null,
);

console.log("\n== 模型输出校验 ==");
const good = {
  issues: [
    {
      sentenceIndex: 0,
      category: "mistranslation",
      severity: "severe",
      quote: "城市多种树",
      problem: "译反",
      suggestion: "改为「城市多栽树」",
    },
  ],
  expressions: [{ item: "plant more trees", note: "搭配：tree 用 plant 不用 grow" }],
  vocabulary: [{ item: "disagree", note: "与 disagree with 连用" }],
};

check("合规输出全部保留", parseModelJson(JSON.stringify(good), 2).issues.length, 1);
check("学习清单一并带回", parseModelJson(JSON.stringify(good), 2).expressions.length, 1);
check(
  "缺 expressions/vocabulary 时按空数组",
  parseModelJson(JSON.stringify({ issues: [] }), 2),
  { issues: [], expressions: [], vocabulary: [] },
);
check(
  "markdown 围栏包住的 JSON 也能解析",
  parseModelJson("```json\n" + JSON.stringify(good) + "\n```", 2).issues.length,
  1,
);
check(
  "越界 sentenceIndex 被丢弃",
  parseModelJson(JSON.stringify({ issues: [{ ...good.issues[0], sentenceIndex: 9 }] }), 2).issues
    .length,
  0,
);
check("非法 category 整体判失败", parseModelJson(JSON.stringify({ issues: [{ ...good.issues[0], category: "style" }] }), 2), null);
check("非法 severity 整体判失败", parseModelJson(JSON.stringify({ issues: [{ ...good.issues[0], severity: "critical" }] }), 2), null);
check("缺 quote 整体判失败", parseModelJson(JSON.stringify({ issues: [{ ...good.issues[0], quote: "" }] }), 2), null);
check("非整数编号整体判失败", parseModelJson(JSON.stringify({ issues: [{ ...good.issues[0], sentenceIndex: 1.5 }] }), 2), null);
check("不是 JSON 就判失败", parseModelJson("模型觉得你译得不错", 2), null);
check("顶层不是对象就判失败", parseModelJson("[1,2,3]", 2), null);
check("issues 不是数组就判失败", parseModelJson(JSON.stringify({ issues: {} }), 2), null);
check("学习条目缺 note 判失败", parseModelJson(JSON.stringify({ ...good, vocabulary: [{ item: "x" }] }), 2), null);

// 批改点评必须由规则从"定位到的错误 + 评分表分值"算出来，不能是一句空话或模型口播。
const { RUBRIC } = await import("../functions/rubric.ts");
const { buildEvaluation } = await import("../functions/scoring.ts");
const twoSentences = [
  { index: 0, source: "A." },
  { index: 1, source: "B." },
];
const mixedIssues = [
  { sentenceIndex: 0, category: "mistranslation", severity: "severe", quote: "x", problem: "p", suggestion: "s" },
  { sentenceIndex: 1, category: "omission", severity: "light", quote: "y", problem: "p", suggestion: "s" },
  { sentenceIndex: 1, category: "wording", severity: "moderate", quote: "z", problem: "p", suggestion: "s" },
];
const graded = buildEvaluation("m", RUBRIC, twoSentences, mixedIssues, "dashscope", "test-model");
const summary = graded.summary;
check("点评按扣分多少指出最该改的句子", summary.includes("第 1 句（扣 5 分）"), true);
check("并列句子带各自的扣分", summary.includes("第 2 句（扣 2.5 分）"), true);
check("严重错误数量出现在点评里", summary.includes("其中 1 处严重错误"), true);
check("计数与逐句分数自洽", `${graded.score}` === "92.5" && summary.startsWith("共发现 3 处问题"), true);
check(
  "没有问题时不编造点评",
  buildEvaluation("m", RUBRIC, twoSentences, [], "dashscope", "test-model").summary,
  "未发现问题。",
);

console.log(failures === 0 ? "\n全部通过" : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
