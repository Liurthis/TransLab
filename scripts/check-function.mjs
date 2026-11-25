// 离线校验 Function 的输入契约：不联网、不花模型配额。
// 运行：node scripts/check-function.mjs
//
// handler.ts 在模块顶层读 Deno.env，Node 下需要先塞一个假 Deno 才能 import。
globalThis.Deno = { env: { get: () => undefined }, serve: () => {} };

const {
  parseBody,
  parseModelJson,
  mergeBatches,
  parseAlignBody,
  parseAlignment,
  parseProviderRequest,
  providerLabel,
} = await import("../functions/handler.ts");

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

console.log("== 用户自带模型配置（provider）==");
check("不带 provider 视为未提供", parseProviderRequest(base).provided, false);
check("provider 为 null 视为未提供", parseProviderRequest({ ...base, provider: null }), {
  provided: false,
  valid: true,
});
const goodProvider = parseProviderRequest({
  ...base,
  provider: { baseUrl: " http://localhost:1234/v1 ", apiKey: " key ", model: " lm " },
});
check(
  "合法配置被采信且首尾空白裁掉",
  [goodProvider.provided, goodProvider.valid, goodProvider.config?.baseUrl, goodProvider.config?.model],
  [true, true, "http://localhost:1234/v1", "lm"],
);
check(
  "非 http(s) 协议被拒",
  parseProviderRequest({ provider: { baseUrl: "javascript:alert(1)", apiKey: "k", model: "m" } }).valid,
  false,
);
check(
  "URL 内嵌凭据被拒",
  parseProviderRequest({ provider: { baseUrl: "https://u:p@api.example.com/v1", apiKey: "k", model: "m" } }).valid,
  false,
);
check("缺字段的 provider 被拒", parseProviderRequest({ provider: { baseUrl: "https://a.example.com/v1" } }).valid, false);
check(
  "空密钥被拒",
  parseProviderRequest({ provider: { baseUrl: "https://a.example.com/v1", apiKey: "   ", model: "m" } }).valid,
  false,
);
check(
  "超长地址被拒",
  parseProviderRequest({
    provider: { baseUrl: "https://a.example.com/" + "x".repeat(300), apiKey: "k", model: "m" },
  }).valid,
  false,
);
check("provider 不是对象被拒", parseProviderRequest({ provider: "https://a.example.com" }).valid, false);

// 分数是谁算的必须写在结果里：本地跑的人看到 "dashscope" 会以为自己调了云。
const label = (baseUrl) => providerLabel({ baseUrl, apiKey: "k", model: "m", fromRequest: false });
console.log("\n== 评分结果的来源标注 ==");
check(
  "界面填的配置标为 user",
  providerLabel({ baseUrl: "http://127.0.0.1:1234/v1", apiKey: "k", model: "m", fromRequest: true }),
  "user",
);
check("阿里云端点标为 dashscope", label("https://dashscope.aliyuncs.com/compatible-mode/v1"), "dashscope");
check("本机 LM Studio 标为实际主机端口", label("http://127.0.0.1:1234/v1"), "127.0.0.1:1234");
check("带路径的自定义域名只取主机名", label("https://api.openai.com/v1"), "api.openai.com");

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
check(
  // 漏译时学生侧无片段可引，空 quote 是合理输出；为它拒收会让千词材料几十批全废。
  "空 quote 仍收录该条",
  parseModelJson(JSON.stringify({ issues: [{ ...good.issues[0], quote: "" }] }), 2).issues.length,
  1,
);
check("缺 quote 字段仍收录该条", parseModelJson(JSON.stringify({ issues: [{ ...good.issues[0], quote: undefined }] }), 2).issues.length, 1);
check("非整数编号整体判失败", parseModelJson(JSON.stringify({ issues: [{ ...good.issues[0], sentenceIndex: 1.5 }] }), 2), null);
check("不是 JSON 就判失败", parseModelJson("模型觉得你译得不错", 2), null);
check("顶层不是对象就判失败", parseModelJson("[1,2,3]", 2), null);
check("issues 不是数组就判失败", parseModelJson(JSON.stringify({ issues: {} }), 2), null);
check("学习条目缺 note 仍保留条目", parseModelJson(JSON.stringify({ ...good, vocabulary: [{ item: "x" }] }), 2).vocabulary, [{ item: "x", note: "" }]);
check("学习条目缺 item 只丢该条", parseModelJson(JSON.stringify({ ...good, vocabulary: [{ item: "" }, { item: "y", note: "n" }] }), 2).vocabulary.length, 1);
check("vocabulary 不是数组整体判失败", parseModelJson(JSON.stringify({ ...good, vocabulary: {} }), 2), null);

// 诊断只回传"违反哪一条规则"，供线上排查，绝不带模型返回的正文。
const diagCategory = {};
parseModelJson(JSON.stringify({ issues: [{ ...good.issues[0], category: "style" }] }), 2, diagCategory);
check("非法 category 的诊断指向该字段", diagCategory.reason, "issues[0].category.len=5");
const diagIndex = {};
parseModelJson(JSON.stringify({ issues: [{ ...good.issues[0], sentenceIndex: "0" }] }), 2, diagIndex);
check("字符串编号的诊断指向该字段", diagIndex.reason, "issues[0].sentenceIndex");
const diagNote = {};
parseModelJson(JSON.stringify({ ...good, expressions: [{ note: "只有说明没有条目" }] }), 2, diagNote);
check("可降级修复时不写诊断", diagNote.reason, undefined);

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
check("点评按扣分多少指出最该改的那一项", summary.includes("第 1 项（扣 5 分）"), true);
check("并列的两项带各自的扣分", summary.includes("第 2 项（扣 2.5 分）"), true);
check("严重错误数量出现在点评里", summary.includes("其中 1 处严重错误"), true);
check("计数与逐句分数自洽", `${graded.score}` === "92.5" && summary.startsWith("共发现 3 处问题"), true);
check(
  "没有问题时不编造点评",
  buildEvaluation("m", RUBRIC, twoSentences, [], "dashscope", "test-model").summary,
  "未发现问题。",
);

// 千词材料一句只摊到 1~2 分，堆三处严重错误的"本该扣分"是 15，写进点评就成了假数字。
const manySentences = Array.from({ length: 72 }, (_, index) => ({ index, source: "S." }));
const stacked = Array.from({ length: 3 }, () => ({
  sentenceIndex: 5,
  category: "mistranslation",
  severity: "severe",
  quote: "x",
  problem: "p",
  suggestion: "s",
}));
const longGraded = buildEvaluation("m", RUBRIC, manySentences, stacked, "dashscope", "test-model");
const cappedMax = longGraded.sentenceScores.find((item) => item.index === 5).max;
check(
  "长材料点评写的是该句实际扣分而非累计分值",
  longGraded.summary.includes(`第 6 项（扣 ${cappedMax} 分）`),
  true,
);
check("长材料点评不出现超过单句满分的扣分", longGraded.summary.includes("扣 15 分"), false);

// 分批评分的合并必须只做「编号换算 + 拼接」，不能改动任何一条错误内容或重复计数。
console.log("\n== 分批合并 ==");
const merged = mergeBatches([
  {
    start: 3,
    parsed: {
      issues: [{ ...good.issues[0], sentenceIndex: 1 }],
      expressions: [{ item: "b", note: "n" }],
      vocabulary: [],
    },
  },
  {
    start: 0,
    parsed: {
      issues: [{ ...good.issues[0], sentenceIndex: 2 }],
      expressions: [{ item: "a", note: "n" }],
      vocabulary: [{ item: "v", note: "n" }],
    },
  },
]);
check("局部编号换算为全篇编号并按句排序", merged.issues.map((issue) => issue.sentenceIndex), [2, 4]);
check("错误内容原样保留", merged.issues[0].quote, good.issues[0].quote);
check("学习清单逐批拼接不丢", merged.expressions.map((item) => item.item), ["b", "a"]);
check("词汇清单一并合并", merged.vocabulary.length, 1);
check(
  "空批次也能合并",
  mergeBatches([{ start: 0, parsed: { issues: [], expressions: [], vocabulary: [] } }]),
  { issues: [], expressions: [], vocabulary: [] },
);

// 配对建议不会自动生效：下面只验两件事——建议本身对不对，以及坏数据是不是被摊开成「没配上」，
// 而不是被静默丢掉某一段（少一段就等于少批一段，分数会虚高）。
console.log("\n== 段落配对建议 ==");
const { alignPreviewCap } = await import("../functions/prompt.ts");
const asJson = (value) => JSON.stringify(value);
const alignBase = {
  action: "align",
  direction: "zh2en",
  sourceParagraphs: ["甲段。", "乙段。", "丙段。"],
  targetParagraphs: ["A.", "B.", "C."],
};

check("合法配对请求被采信", parseAlignBody(alignBase).targetParagraphs.length, 3);
check("缺 targetParagraphs 被拒", parseAlignBody({ ...alignBase, targetParagraphs: undefined }), null);
check("一侧是空数组被拒", parseAlignBody({ ...alignBase, sourceParagraphs: [] }), null);
check("全是空白段落被拒", parseAlignBody({ ...alignBase, targetParagraphs: [" ", "\n"] }), null);
check("非法方向被拒", parseAlignBody({ ...alignBase, direction: "fr2en" }), null);
check(
  "超过 200 段的配对被拒：配上也没法批",
  parseAlignBody({ ...alignBase, sourceParagraphs: Array.from({ length: 201 }, (_, i) => `S${i}`) }),
  null,
);

check("配对建议原样采用", parseAlignment(asJson({ pairs: [[0, 1], [1, 0], [2, 2]] }), 3, 3).pairs, [
  { sourceIndex: 0, targetIndex: 1 },
  { sourceIndex: 1, targetIndex: 0 },
  { sourceIndex: 2, targetIndex: 2 },
]);
check(
  "模型漏掉的原文段补成没配上，行数与段数一致",
  parseAlignment(asJson({ pairs: [[0, 0]] }), 3, 2).pairs,
  [
    { sourceIndex: 0, targetIndex: 0 },
    { sourceIndex: 1, targetIndex: null },
    { sourceIndex: 2, targetIndex: null },
  ],
);
check(
  "越界译文编号降级为没配上，不整份作废",
  parseAlignment(asJson({ pairs: [[0, 9]] }), 1, 2).pairs,
  [{ sourceIndex: 0, targetIndex: null }],
);
check(
  "同一译文段被配两次，第二条退回没配上",
  parseAlignment(asJson({ pairs: [[0, 1], [1, 1]] }), 2, 2).pairs,
  [
    { sourceIndex: 0, targetIndex: 1 },
    { sourceIndex: 1, targetIndex: null },
  ],
);
check(
  "重复的原文编号只认第一条",
  parseAlignment(asJson({ pairs: [[0, 1], [0, 0]] }), 2, 2).pairs,
  [
    { sourceIndex: 0, targetIndex: 1 },
    { sourceIndex: 1, targetIndex: null },
  ],
);
check(
  "形状坏的条目只丢该条",
  parseAlignment(asJson({ pairs: [[0], "nope", [1, 0]] }), 2, 1).pairs,
  [
    { sourceIndex: 0, targetIndex: null },
    { sourceIndex: 1, targetIndex: 0 },
  ],
);
check(
  "配对说明过长会被截断",
  parseAlignment(asJson({ pairs: [], notes: "x".repeat(500) }), 1, 1).notes.length,
  400,
);
check(
  "markdown 围栏包住的配对结果也能解析",
  parseAlignment("```json\n" + asJson({ pairs: [[0, 0]] }) + "\n```", 1, 1).pairs.length,
  1,
);
check("pairs 不是数组就整份判失败", parseAlignment(asJson({ pairs: {} }), 2, 2), null);
check("不是 JSON 就整份判失败", parseAlignment("我觉得这两段挺像的", 2, 2), null);
const alignDiag = {};
parseAlignment(asJson({ pairs: {} }), 2, 2, alignDiag);
check("配对失败诊断只写规则名", alignDiag.reason, "pairs_not_array");

// 配对只看段首：预算随段数收缩，段数太多时预览太短就不该指望模型判准（界面上会如实写明）。
check("段数越多预览越短", alignPreviewCap(200) < alignPreviewCap(10), true);
check("两百段时每段预览 60 字", alignPreviewCap(200), 60);
check("段数很少时按预算给足", alignPreviewCap(4), 3000);
check("预览下限 40 字", alignPreviewCap(100000), 40);

console.log(failures === 0 ? "\n全部通过" : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
