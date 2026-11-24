// scripts/check-docimport.mjs
//
// 文档导入「本机这一层」的离线校验：纯文本分段、按语言拆段、顺序配对、超限拦截、
// 以及各格式的报错文案。Node 里缺的 DOMParser 与 .ts 相对导入由 scripts/dom-shim.mjs 顶替。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installDomParser, installTsResolver } from "./dom-shim.mjs";

installTsResolver();
installDomParser();

const {
  paragraphLimitError,
  paragraphsFromPlainText,
  readDocument,
  rowsFromPairs,
  segmentOverflowError,
  sequentialPairs,
  splitByLanguage,
} = await import("../src/lib/docimport.ts");
const { DocxError } = await import("../src/lib/docx.ts");

const here = join(dirname(fileURLToPath(import.meta.url)), "../tests/fixtures");
let failures = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}`);
  if (!ok) console.log(`         期望 ${JSON.stringify(expected)}\n         实际 ${JSON.stringify(actual)}`);
}

/** 只用到 name/text/arrayBuffer 三个成员，够 readDocument 走完整条路。 */
function fakeFile(name, content) {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return {
    name,
    text: async () => new TextDecoder().decode(bytes),
    arrayBuffer: async () => bytes.slice().buffer,
  };
}

console.log("\n== 纯文本分段 ==");
check("空行分段", paragraphsFromPlainText("第一段。\n\n第二段。\n\n\n第三段。"), ["第一段。", "第二段。", "第三段。"]);
check("整篇没有空行就按行分段", paragraphsFromPlainText("Line one.\nLine two."), ["Line one.", "Line two."]);
check("中文折行处不加空格", paragraphsFromPlainText("中国经济\n持续恢复。\n\n下一段。"), ["中国经济持续恢复。", "下一段。"]);
check("英文折行处补一个空格", paragraphsFromPlainText("The economy\nkeeps recovering.\n\nNext."), ["The economy keeps recovering.", "Next."]);
check("汉字与字母交界补空格", paragraphsFromPlainText("文字\nwords follow\n\n下一段。"), ["文字 words follow", "下一段。"]);
check("CRLF 与行内多空格一起收拾干净", paragraphsFromPlainText("  甲   乙  \r\n\r\n  丙  "), ["甲 乙", "丙"]);
check("空文本不产生空段", paragraphsFromPlainText("   \n\n   \n"), []);
check("编号行各成一段", paragraphsFromPlainText("1. 第一\n2. 第二"), ["1. 第一", "2. 第二"]);

console.log("\n== 单份对照文档：按字符占比判语言 ==");
const bilingual = [
  "The city planted more trees last spring.",
  "城市去年春天种了更多树。",
  "Roads were widened near the river.",
  "河边道路已经拓宽。",
];
check("英译汉：英文段是原文", splitByLanguage(bilingual, "en2zh").sourceParagraphs.length, 2);
check("英译汉：中文段是译文", splitByLanguage(bilingual, "en2zh").targetParagraphs, [
  "城市去年春天种了更多树。",
  "河边道路已经拓宽。",
]);
check("汉译英：两侧对调", splitByLanguage(bilingual, "zh2en").sourceParagraphs, [
  "城市去年春天种了更多树。",
  "河边道路已经拓宽。",
]);
check("保持文档顺序", splitByLanguage(bilingual, "en2zh").sourceParagraphs[0], bilingual[0]);

const tricky = ["经济发展水 level", "1.", "城市绿化成效明显。", "Greening the city works."];
const trickySplit = splitByLanguage(tricky, "en2zh");
check("中英各半的段落判为同段混排", trickySplit.unclassified[0].reason, "mixed");
check("字数太少的段落判为无法判断", trickySplit.unclassified[1].reason, "short");
check("判不出来的段落保留原位置", trickySplit.unclassified.map((item) => item.index), [0, 1]);
check("三类相加等于总段数，一段不丢", trickySplit.sourceParagraphs.length + trickySplit.targetParagraphs.length + trickySplit.unclassified.length, tricky.length);
check("判不出来的段落不占用原文/译文侧", trickySplit.sourceParagraphs, ["Greening the city works."]);
check("判不出来的段落也不占用译文侧", trickySplit.targetParagraphs, ["城市绿化成效明显。"]);

console.log("\n== 配对：相等才按顺序，不等绝不猜 ==");
check("段数相等按 1:1", sequentialPairs(3, 3), [
  { sourceIndex: 0, targetIndex: 0 },
  { sourceIndex: 1, targetIndex: 1 },
  { sourceIndex: 2, targetIndex: 2 },
]);
check("译文少一段就不给顺序配对", sequentialPairs(3, 2), null);
check("原文少一段也不给顺序配对", sequentialPairs(2, 3), null);
check("空文档不配对", sequentialPairs(0, 0), null);

check(
  "配对行取不到译文时留空而不是错位",
  rowsFromPairs(["甲。", "乙。"], ["A."], [
    { sourceIndex: 0, targetIndex: 0 },
    { sourceIndex: 1, targetIndex: null },
  ]),
  [
    { source: "甲。", target: "A." },
    { source: "乙。", target: null },
  ],
);
check(
  "编号越界的建议降级成留空",
  rowsFromPairs(["甲。"], ["A."], [{ sourceIndex: 0, targetIndex: 7 }]),
  [{ source: "甲。", target: null }],
);

console.log("\n== 超限拦截 ==");
check("200 段放行", paragraphLimitError(200, 200), null);
check("201 段拦下并说明下一步", paragraphLimitError(201, 10)?.includes("拆成两份"), true);
check("一侧超限也拦", paragraphLimitError(10, 400) !== null, true);

// 段数没超不代表句段数没超：Function 收到后还会把每段切成句段，上限按句段计。
const hundredThreeSentences = Array.from({ length: 100 }, () => "第一句。第二句。第三句。");
check(
  "100 段切出 300 句段时本地拦下，不等上传才被拒",
  segmentOverflowError(hundredThreeSentences, "zh2en")?.includes("300 个句段"),
  true,
);
check("段内多句但总数在上限内放行", segmentOverflowError(["第一句。第二句。", "第三句。"], "zh2en"), null);
check("拦下时给出可执行的下一步", segmentOverflowError(hundredThreeSentences, "zh2en")?.includes("这段不批"), true);

console.log("\n== readDocument：按后缀分流，报错要说清下一步 ==");
const txt = await readDocument(fakeFile("译文.txt", "第一段。\n\n第二段。"));
check(".txt 读出段落", txt.paragraphs, ["第一段。", "第二段。"]);
check(".txt 保留文件名", txt.name, "译文.txt");

const docx = await readDocument(fakeFile("原文.docx", new Uint8Array(readFileSync(join(here, "basic.docx")))));
check(".docx 走 zip 提取", docx.paragraphs.length, 3);
check(".docx 文件名保留", docx.name, "原文.docx");

const bigDocx = await readDocument(fakeFile("long.docx", new Uint8Array(readFileSync(join(here, "long.docx")))));
check("千词级文档 40 段全进来", bigDocx.paragraphs.length, 40);

for (const [name, code] of [["a.doc", "legacy_doc"], ["a.pdf", "pdf"], ["a.pages", "not_docx"]]) {
  let error = null;
  try {
    await readDocument(fakeFile(name, "占位内容，不靠字节判断"));
  } catch (caught) {
    error = caught;
  }
  check(`${name} 报出 ${code}`, [error instanceof DocxError ? error.code : null, error?.message.length > 20], [code, true]);
}

let noNameError = null;
try {
  await readDocument(fakeFile("notes", "这不是文档"));
} catch (caught) {
  noNameError = caught;
}
check("没有后缀的文件按 .docx 试，失败后指名格式", noNameError?.code, "not_docx");

console.log(failures === 0 ? "\n全部通过" : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
