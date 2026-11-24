// scripts/check-docx.mjs
//
// 文档导入的离线契约校验：zip 读取、正文提取、以及"报错必须说清下一步"这三条线。
// 期望值与 .docx 测试件同源于 tests/fixtures/spec.mjs，避免用两套实现互相印证。
// Node 里缺的 DOMParser 与 .ts 相对导入由 scripts/dom-shim.mjs 顶替。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { installDomParser, installTsResolver } from "./dom-shim.mjs";

installTsResolver();
installDomParser();

const { extractParagraphs, readDocxParagraphs, DocxError } = await import("../src/lib/docx.ts");
const { readZipEntryText, ZipFormatError } = await import("../src/lib/zip.ts");
const { documentXmlFor, FIXTURES } = await import("../tests/fixtures/spec.mjs");
const { segmentText } = await import("../src/lib/segment.ts");

const here = join(dirname(fileURLToPath(import.meta.url)), "../tests/fixtures");
let failures = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}`);
  if (!ok) console.log(`         期望 ${JSON.stringify(expected)}\n         实际 ${JSON.stringify(actual)}`);
}

function bytes(name) {
  return new Uint8Array(readFileSync(join(here, name)));
}

const squish = (value) => value.replace(/\s+/g, "");
const multiset = (value) => [...squish(value)].sort().join("");

console.log("\n== zip 读取：与 unzip 独立实现逐字节对齐 ==");
for (const fixture of FIXTURES) {
  const xml = await readZipEntryText(bytes(fixture.file), "word/document.xml");
  check(`${fixture.file} 正文与生成端字符串一致`, xml, documentXmlFor(fixture));
}
try {
  const viaUnzip = execFileSync("unzip", ["-p", join(here, "basic.docx"), "word/document.xml"]);
  const viaUs = await readZipEntryText(bytes("basic.docx"), "word/document.xml");
  check("basic.docx 与系统 unzip 输出一致", viaUs, new TextDecoder().decode(viaUnzip));
} catch (error) {
  console.log(`  skip unzip 对照（本机没有 unzip 或读取失败）：${String(error).slice(0, 60)}`);
}

console.log("\n== 正文提取：段落、顺序、不丢不重 ==");
for (const fixture of FIXTURES) {
  const extracted = extractParagraphs(documentXmlFor(fixture));
  check(`${fixture.file}：${fixture.title}`, extracted.paragraphs, fixture.paragraphs);
}

// 提取出来的段落必须原样进入既有断句器：断句前后字符多重集一致，才算"文档没被吃掉内容"。
console.log("\n== 与断句器衔接：字符不丢不重 ==");
for (const fixture of FIXTURES.filter((item) => item.paragraphs.length > 0)) {
  const joined = fixture.paragraphs.join(" ");
  const segments = segmentText(joined, fixture.file === "basic.docx" ? "en2zh" : "zh2en");
  check(
    `${fixture.file}：断句后拼回与提取文字一致`,
    multiset(segments.join(" ")),
    multiset(joined),
  );
}

// 这几条用 textutil（macOS 自带的另一套 docx 实现）实测对照过：只有文本框内容它会重复一次，
// 其余几条两份实现结果相同，下面的断言是防回归，不是"我们比系统更懂"。
console.log("\n== 提取规则：textutil 实测对照 ==");
const textbox = extractParagraphs(documentXmlFor(FIXTURES.find((f) => f.file === "textbox.docx")));
check("文本框内容只出现一次（textutil 实测重复一次）", squish(textbox.paragraphs.join("")).split("框内文字").length - 1, 1);
const revision = extractParagraphs(documentXmlFor(FIXTURES.find((f) => f.file === "revision.docx")));
check("删除的修订不计入（textutil 实测同样不计入）", revision.paragraphs[0].includes("was delayed"), false);
const field = extractParagraphs(documentXmlFor(FIXTURES.find((f) => f.file === "field.docx")));
check("域结果保留（textutil 实测同样保留）", field.paragraphs.includes("2026-11-24"), true);
check("域代码不混进正文", squish(field.paragraphs.join("")).includes("PAGE"), false);
const runsplit = extractParagraphs(documentXmlFor(FIXTURES.find((f) => f.file === "runsplit.docx")));
check("制表符与软换行换成空格（textutil 实测保留制表符）", runsplit.paragraphs[0], "The budget remains limited for remote work. 第二行");

console.log("\n== 反例：报错必须指名格式并给出下一步 ==");
const cases = [
  { file: "fake.pages", code: "no_document", includes: ".docx" },
  { file: "fake.doc", code: "legacy_doc", includes: ".docx" },
  { file: "fake.pdf", code: "pdf", includes: "PDF" },
];
for (const item of cases) {
  let error = null;
  try {
    await readDocxParagraphs(bytes(item.file));
  } catch (caught) {
    error = caught;
  }
  check(
    `${item.file} 报出 ${item.code}`,
    [error instanceof DocxError ? error.code : null, error ? error.message.includes(item.includes) : false],
    [item.code, true],
  );
}

const garbage = new Uint8Array(Array.from({ length: 64 }, (_, i) => (i * 37) % 251));
let garbageError = null;
try {
  await readDocxParagraphs(garbage);
} catch (error) {
  garbageError = error;
}
check("随机字节不会被当成文档", garbageError?.code, "not_docx");

const truncated = bytes("basic.docx").subarray(0, 800);
let truncatedError = null;
try {
  await readDocxParagraphs(truncated);
} catch (error) {
  truncatedError = error;
}
check(
  "截断文件必须报错而不是解出半篇正文",
  truncatedError instanceof ZipFormatError || truncatedError instanceof DocxError,
  true,
);

// 浏览器里 DOMParser 返回 parsererror 节点，Node 的 xmldom 直接抛 ParseError：两条路都算"没静默"。
let xmlError = false;
try {
  extractParagraphs("<w:body xmlns:w=\"urn:w\"><w:p><w:r>未闭合</w:r></w:body>");
} catch {
  xmlError = true;
}
check("非法 XML 不会静默返回段落", xmlError, true);

console.log(failures === 0 ? "\n全部通过" : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
