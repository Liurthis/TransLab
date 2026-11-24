// src/lib/docx.ts
//
// 从 .docx 的 word/document.xml 里按文档顺序取出段落文字。
// 只做「读正文」这一件事：不猜句子、不配对、不美化排版——断句与配对是别的模块的职责。

import { readZipEntryText, zipEntryNames, ZipFormatError } from "./zip";

export interface DocumentText {
  /** 正文段落，按出现顺序。纯空白段不计入：空段没有可批改内容，却会在对齐表里造成假行。 */
  paragraphs: string[];
  /** 提取过程中的取舍，界面必须如实显示，不能让用户以为拿到了整份文件的所有文字。 */
  notes: string[];
}

export class DocxError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** 非 .docx 的 zip（含 IWork 的 .pages）与普通非 zip 文件都用这句，统一口径、不带软件名。 */
const MISSING_DOCUMENT_MESSAGE =
  "这个文件读不出 .docx 正文。请在 Word 里把文档另存为 .docx 后上传，或把正文另存成 .txt 上传。";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const MC_NS = "http://schemas.openxmlformats.org/markup-compatibility/2006";

/** 这些子树里的文字不属于当前段落：图片、对象、嵌入的正文部件，以及被删掉的修订内容。
 * 注意不要顺手加进 w:smartTag / w:hyperlink / w:ins——它们里面的 run 是真正文，跳过就是丢字。 */
const SKIP_SUBTREES = new Set([
  "drawing",
  "pict",
  "object",
  "oleObject",
  "del",
]);

/** 文本框里的段落单独成段；页眉页脚脚注在别的部件里，本来就不在 document.xml 中。 */
const TEXTBOX_CONTAINERS = new Set(["txbxContent"]);

const FALLBACK_ELEMENTS = new Set(["Fallback"]);

/** 只在块级结构里下钻：表格、行、单元格、内容控件。其余元素不产生新段落。 */
const BLOCK_CONTAINERS = new Set([
  "body",
  "tbl",
  "tr",
  "tc",
  "sdt",
  "sdtContent",
  "txbxContent",
  "cell",
  "story",
]);

/**
 * 入参既接受浏览器的 ArrayBuffer，也接受 Node 的 Uint8Array：
 * Buffer 的 .buffer 是池化的，长度比文件本身大，直接取会读到别人的字节。
 */
export async function readDocxParagraphs(data: ArrayBuffer | Uint8Array): Promise<DocumentText> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const names = identifyContainer(bytes);
  if (!names.includes("word/document.xml")) {
    // IWork（Pages/Numbers 等）也是 zip，但没有 word/document.xml，会落到这里。
    throw new DocxError("no_document", MISSING_DOCUMENT_MESSAGE);
  }
  const xml = await readZipEntryText(bytes, "word/document.xml");
  if (xml === null) throw new DocxError("no_document", "这份 .docx 里没有正文部件。");
  return extractParagraphs(xml);
}

/** 先看容器魔数再报错：.doc 与 .pdf 用户很可能直接拖进来，提示必须说清下一步怎么做。 */
function identifyContainer(bytes: Uint8Array): string[] {
  if (bytes.length < 4) throw new DocxError("empty", "文件是空的。");
  const isOle =
    bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (isOle) {
    throw new DocxError(
      "legacy_doc",
      "这是 Word 97-2003 的 .doc（二进制格式）。请在 Word 里另存为 .docx 后重新上传。",
    );
  }
  const isPdf =
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  if (isPdf) {
    throw new DocxError("pdf", "暂不解析 PDF：请把原文与译文分别另存为 .docx（或 .txt）后上传。");
  }
  try {
    return zipEntryNames(bytes);
  } catch (error) {
    if (error instanceof ZipFormatError && error.code === "not_zip") {
      throw new DocxError("not_docx", MISSING_DOCUMENT_MESSAGE);
    }
    throw error;
  }
}

export function extractParagraphs(xml: string): DocumentText {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const parseError = document.getElementsByTagName("parsererror");
  if (parseError.length > 0) {
    throw new DocxError("xml", ".docx 的正文 XML 不合法，无法可靠提取，请另存为新的 .docx 再试。");
  }
  const body = document.getElementsByTagNameNS(W_NS, "body")[0];
  if (!body) throw new DocxError("xml", ".docx 正文里找不到 body 节点。");

  const blocks: string[] = [];
  collectBlocks(body, blocks);
  const paragraphs = blocks.filter((text) => text !== "");

  const notes: string[] = [];
  if (blocks.length > paragraphs.length) {
    notes.push(`已忽略 ${blocks.length - paragraphs.length} 个空段落。`);
  }
  if (hasAncestorNamespaceIssue(document)) {
    notes.push("文中「兼容性回退」内容只取一次，不重复计入。");
  }
  if (document.getElementsByTagNameNS(W_NS, "tbl").length > 0) {
    notes.push("表格按单元格内段落顺序取出。");
  }
  if (document.getElementsByTagNameNS(W_NS, "del").length > 0) {
    notes.push("已标记删除的修订内容不计入正文，接受的插入计入。");
  }
  if (document.getElementsByTagNameNS(W_NS, "txbxContent").length > 0) {
    notes.push("文本框里的文字单独成段，顺序排在宿主段落之后。");
  }
  notes.push(...missingPartsNote(xml));

  return { paragraphs, notes };
}

/** AlternateContent 的 Fallback 分支与 Choice 分支是同一段内容，两边都取就会重复计数。 */
function hasAncestorNamespaceIssue(document: Document): boolean {
  return document.getElementsByTagNameNS(MC_NS, "Fallback").length > 0;
}

/** 页眉页脚脚注尾注是独立部件，本提取器只看正文；用户以为"全部文字都进来了"就是错的。 */
function missingPartsNote(xml: string): string[] {
  const present: string[] = [];
  if (xml.includes("footnoteReference")) present.push("脚注");
  if (xml.includes("endnoteReference")) present.push("尾注");
  if (present.length === 0) return [];
  return [`${present.join("与")}标记出现在正文里，但其内容存于独立部件，本次未提取。`];
}

function collectBlocks(container: Element, out: string[]): void {
  for (const child of children(container)) {
    if (isFallback(child)) continue;
    const name = localName(child);
    if (namespaceUri(child) === W_NS && name === "p") {
      out.push(paragraphText(child));
      // 文本框嵌在段落里：先收宿主段落，再把框内段落按出现顺序补在后面。
      for (const box of descendants(child, TEXTBOX_CONTAINERS)) {
        collectBlocks(box, out);
      }
      continue;
    }
    if (BLOCK_CONTAINERS.has(name) || name === "AlternateContent") {
      collectBlocks(child, out);
    }
  }
}

function paragraphText(paragraph: Element): string {
  let text = "";
  visitRuns(paragraph, (element) => {
    const name = localName(element);
    if (namespaceUri(element) !== W_NS) return;
    if (name === "t") text += element.textContent ?? "";
    else if (name === "tab" || name === "br" || name === "cr") text += " ";
    // 软连字符是断词提示不发音；noBreakHyphen 是真可见的连字符。
    else if (name === "noBreakHyphen") text += "-";
  });
  return text.trim();
}

/** 深度优先访问元素，遇到需要整块跳过的子树就不再下去（但仍会补收其中的文本框）。 */
function visitRuns(root: Element, onElement: (element: Element) => void): void {
  const stack: Element[] = [];
  for (let index = root.children.length - 1; index >= 0; index -= 1) stack.push(root.children[index]);
  while (stack.length > 0) {
    const element = stack.pop() as Element;
    const name = localName(element);
    if (SKIP_SUBTREES.has(name)) continue;
    if (TEXTBOX_CONTAINERS.has(name)) continue;
    onElement(element);
    for (let index = element.children.length - 1; index >= 0; index -= 1) {
      stack.push(element.children[index]);
    }
  }
}

function descendants(root: Element, names: Set<string>): Element[] {
  const found: Element[] = [];
  const stack: Element[] = [];
  for (let index = root.children.length - 1; index >= 0; index -= 1) stack.push(root.children[index]);
  while (stack.length > 0) {
    const element = stack.pop() as Element;
    if (isFallback(element)) continue;
    if (names.has(localName(element)) && namespaceUri(element) === W_NS) found.push(element);
    for (let index = element.children.length - 1; index >= 0; index -= 1) {
      stack.push(element.children[index]);
    }
  }
  return found;
}

function isFallback(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (FALLBACK_ELEMENTS.has(localName(current))) return true;
    current = current.parentElement;
  }
  return false;
}

function children(element: Element): Element[] {
  return Array.from(element.children);
}

function localName(element: Element): string {
  return element.localName;
}

function namespaceUri(element: Element): string {
  return element.namespaceURI ?? "";
}
