// scripts/check-docx-write.mjs
//
// 导出下载器写的 .docx 必须：
// 1) 我们自己 src/lib/zip.ts + docx.ts 读得回来（round-trip，防止 zip 头写歪、正文解析不出）；
// 2) document.xml 里带上有内容承诺（分数/每句对照/问题/参考译文/表达/词汇），
//    这样 Word 打开不是空文档，用户也不会以为"下载的东西没用"。

import { installDomParser, installTsResolver } from "./dom-shim.mjs";

installTsResolver();
installDomParser();

const { buildDocxBytes, exportFilename } = await import("../src/lib/export.ts");
const { readDocxParagraphs } = await import("../src/lib/docx.ts");
const { zipEntryNames } = await import("../src/lib/zip.ts");

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}`);
  if (!ok) console.log(`         期望 ${JSON.stringify(expected)}\n         实际 ${JSON.stringify(actual)}`);
}

function baseResult() {
  const material = {
    id: "m1",
    title: "测试：航空/公司*改名?",
    direction: "en2zh",
    register: "时事",
    difficulty: "中级",
    sourceText: "raw source text",
    sourceNote: "内置材料，含人工审定参考译文",
    origin: "builtin",
    createdAt: "2026-11-25T00:00:00.000Z",
    sentences: [
      { index: 0, source: "Airbus A320 was delayed.", reference: "空中巴士 A320 航班延误。" },
      { index: 1, source: "The budget remains limited.", reference: "预算仍然有限。" },
      { index: 2, source: "第三句没有译文。" },
    ],
  };
  const evaluation = {
    materialId: "m1",
    status: "ok",
    isMock: false,
    rubricVersion: "catti-1.0",
    provider: "dashscope",
    model: "qwen3.7-flash",
    submitted: "2026-11-25T02:34:56.789Z",
    direction: "en2zh",
    score: 45,
    totalScore: 100,
    sentenceScores: [
      { index: 0, score: 5, max: 8 },
      { index: 1, score: 4, max: 7 },
      { index: 2, score: 0, max: 7 },
    ],
    issues: [
      {
        sentenceIndex: 0,
        category: "mistranslation",
        severity: "moderate",
        quote: "delayed",
        problem: "把「延误」错译成「取消」。",
        suggestion: "改成「延误」。",
      },
    ],
    summary: "整体偏松。",
    referenceAvailable: true,
    expressions: [{ item: "was delayed", note: "被动语态常见搭配。" }],
    vocabulary: [{ item: "budget", note: "财经常用词。" }],
  };
  const drafts = ["空中巴士被取消了。", "预算有限。", ""];
  return { material, evaluation, drafts, source: undefined };
}

console.log("== zip 结构 ==");
const bytes = buildDocxBytes(baseResult());
const names = zipEntryNames(bytes);
check(
  "五个必要部件齐全",
  names.slice().sort(),
  ["[Content_Types].xml", "_rels/.rels", "docProps/app.xml", "docProps/core.xml", "word/document.xml"].sort(),
);

console.log("\n== round-trip：自己的 reader 能读回来 ==");
const parsed = await readDocxParagraphs(bytes);
const joined = parsed.paragraphs.join("\n");
check("段落数量 >= 12", parsed.paragraphs.length >= 12, true);
check("含标题 TransLab", joined.includes("TransLab · 翻译记录"), true);
check("含材料名", joined.includes("测试"), true);
check("含方向", joined.includes("英译汉"), true);
check("含分数", joined.includes("45 / 100"), true);
check("含评分表", joined.includes("catti-1.0"), true);
check("含模型", joined.includes("qwen3.7-flash"), true);
check("含语域", joined.includes("时事"), true);
check("含材料来源", joined.includes("内置材料"), true);
check("含总结标题", joined.includes("整体偏松"), true);
check("含逐句标题", joined.includes("逐句对照（共 3 句）"), true);
check("含每句原文", joined.includes("Airbus A320 was delayed"), true);
check("含每句我的译文", joined.includes("被取消"), true);
check("含参考译文（第 1 句）", joined.includes("参考译文：空中巴士 A320 航班延误"), true);
check("第 3 句没参考译文", parsed.paragraphs.some((p) => p.startsWith("参考译文：第三句")), false);
check("空 draft 走（未填写）", joined.includes("我的译文：（未填写）"), true);
check("含问题类别", joined.includes("误译"), true);
check("含问题严重度", joined.includes("一般"), true);
check("含问题 quote", joined.includes("引用「delayed」"), true);
check("含问题说明", joined.includes("把「延误」错译成「取消」"), true);
check("含问题建议", joined.includes("改成「延误」"), true);
check("含建议学习表达段", joined.includes("建议学习的英文表达"), true);
check("含建议学习词汇段", joined.includes("建议积累的英文词汇"), true);

console.log("\n== 文档批改分支：段 而非 句，无参考译文 ==");
const docsVariant = baseResult();
docsVariant.source = "docs";
docsVariant.evaluation.referenceAvailable = false;
docsVariant.material.sentences = docsVariant.material.sentences.map(({ reference: _drop, ...rest }) => rest);
const docsBytes = buildDocxBytes(docsVariant);
const docsParsed = await readDocxParagraphs(docsBytes);
const docsJoined = docsParsed.paragraphs.join("\n");
check("标题带 · 文档批改", docsJoined.includes("· 文档批改"), true);
check("段数用「段」", docsJoined.includes("逐段对照（共 3 段）"), true);
check("不再出现参考译文", docsParsed.paragraphs.some((p) => p.startsWith("参考译文：")), false);

console.log("\n== 空 expressions/vocabulary 不生成空段 ==");
const emptyVariant = baseResult();
emptyVariant.evaluation.expressions = [];
emptyVariant.evaluation.vocabulary = [];
const emptyParsed = await readDocxParagraphs(buildDocxBytes(emptyVariant));
const emptyJoined = emptyParsed.paragraphs.join("\n");
check("没有建议学习的英文表达标题", emptyJoined.includes("建议学习的英文表达"), false);
check("没有建议积累的英文词汇标题", emptyJoined.includes("建议积累的英文词汇"), false);

console.log("\n== status=failed 走快照说明 ==");
const failedVariant = baseResult();
failedVariant.evaluation.status = "failed";
const failedJoined = (await readDocxParagraphs(buildDocxBytes(failedVariant))).paragraphs.join("\n");
check("含未完成说明", failedJoined.includes("本次批改未完成"), true);

console.log("\n== 文件名：非法字符全替换、时间戳定形、以 .docx 结束 ==");
const filename = exportFilename(baseResult());
check("无非法字符", /[/\\:*?"<>|\x00-\x1f]/.test(filename), false);
check("以 .docx 结尾", filename.endsWith(".docx"), true);
check("含 TransLab", filename.includes("TransLab"), true);
check("含时间戳", /\d{4}-\d{2}-\d{2}_\d{4}/.test(filename), true);

const weirdTitle = baseResult();
weirdTitle.material.title = "  ??? <<<aaa>>>   :  :  ";
const weirdName = exportFilename(weirdTitle);
check("非法字符全替换后剩 aaa", weirdName.startsWith("aaa-TransLab"), true);
check("文件名里不含 < > : ? 等非法字符", /[/\\:*?"<>|]/.test(weirdName), false);
check("空标题兜底：只留空格与符号 → 翻译记录", exportFilename({ ...baseResult(), material: { ...baseResult().material, title: "   " } }).startsWith("翻译记录"), true);

console.log(failures === 0 ? "\n全部通过" : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
