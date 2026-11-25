// src/lib/export.ts
//
// 一条 SavedResult → 一份 .docx 字节 → 浏览器下载。
// document.xml 手写 OOXML：只用 p/r/t/pPr/rPr/sectPr 五个部件，词汇表极小；
// 与 docx.ts 的读取器同族，自己写的东西必须自己能读回来（见 check-docx-write.mjs）。

import { DIRECTION_LABELS, ISSUE_LABELS, SEVERITY_LABELS } from "../types";
import type { SavedResult } from "./storage";
import { zipStored } from "./zip-write";

const MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XML_HEAD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;

const CONTENT_TYPES_XML =
  XML_HEAD +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
  `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
  `</Types>`;

const ROOT_RELS_XML =
  XML_HEAD +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
  `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>` +
  `</Relationships>`;

const APP_XML =
  XML_HEAD +
  `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>TransLab</Application><Company>TransLab</Company></Properties>`;

function coreXml(title: string, modifiedIso: string): string {
  const stamp = isValidDate(modifiedIso) ? modifiedIso : "2026-01-01T00:00:00.000Z";
  return (
    XML_HEAD +
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>${escapeXml(title)}</dc:title>` +
    `<dc:subject>TransLab 翻译记录</dc:subject>` +
    `<dc:creator>TransLab</dc:creator>` +
    `<cp:keywords>TransLab;CATTI</cp:keywords>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified>` +
    `</cp:coreProperties>`
  );
}

function isValidDate(iso: string): boolean {
  const t = new Date(iso).getTime();
  return Number.isFinite(t);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // 剔除 XML 非法字符（NUL 与其他 C0 控制字符、以及未配对代理项）。
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}

type ParaKind = "title" | "heading" | "subheading" | "body" | "note";

interface ParaStyle {
  bold?: boolean;
  sizeHalfPt?: number;
  spaceBeforeTwip?: number;
  spaceAfterTwip?: number;
}

// sizeHalfPt 是「半磅」：Word 里 22 = 11pt，24 = 12pt，28 = 14pt，36 = 18pt。
// spaceBefore/After 是 twips：1pt = 20，240 = 12pt。
const STYLES: Record<ParaKind, ParaStyle> = {
  title: { bold: true, sizeHalfPt: 36, spaceAfterTwip: 240 },
  heading: { bold: true, sizeHalfPt: 28, spaceBeforeTwip: 240, spaceAfterTwip: 120 },
  subheading: { bold: true, sizeHalfPt: 24, spaceBeforeTwip: 120, spaceAfterTwip: 60 },
  body: { sizeHalfPt: 22, spaceAfterTwip: 60 },
  note: { sizeHalfPt: 20, spaceAfterTwip: 40 },
};

function paragraph(text: string, kind: ParaKind = "body"): string {
  const style = STYLES[kind];
  const pPrParts: string[] = [];
  const spacingAttrs: string[] = [];
  if (style.spaceBeforeTwip) spacingAttrs.push(`w:before="${style.spaceBeforeTwip}"`);
  if (style.spaceAfterTwip) spacingAttrs.push(`w:after="${style.spaceAfterTwip}"`);
  if (spacingAttrs.length) pPrParts.push(`<w:spacing ${spacingAttrs.join(" ")}/>`);
  const pPr = pPrParts.length ? `<w:pPr>${pPrParts.join("")}</w:pPr>` : "";

  const rPrParts: string[] = [];
  if (style.bold) rPrParts.push(`<w:b/><w:bCs/>`);
  if (style.sizeHalfPt)
    rPrParts.push(
      `<w:sz w:val="${style.sizeHalfPt}"/><w:szCs w:val="${style.sizeHalfPt}"/>`,
    );
  const rPr = rPrParts.length ? `<w:rPr>${rPrParts.join("")}</w:rPr>` : "";

  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

export function buildDocxBytes(result: SavedResult): Uint8Array {
  const { material, drafts, evaluation, source } = result;
  const isDoc = source === "docs";
  const unit = isDoc ? "段" : "句";
  const paragraphs: string[] = [];

  paragraphs.push(paragraph("TransLab · 翻译记录", "title"));
  paragraphs.push(
    paragraph(
      `${material.title} · ${DIRECTION_LABELS[evaluation.direction]}${isDoc ? " · 文档批改" : ""}`,
      "heading",
    ),
  );
  paragraphs.push(
    paragraph(`提交时间：${formatDateTime(evaluation.submitted)}`, "body"),
  );
  paragraphs.push(
    paragraph(
      `得分：${evaluation.score} / ${evaluation.totalScore}`,
      evaluation.status === "failed" ? "note" : "body",
    ),
  );
  if (evaluation.status === "failed") {
    paragraphs.push(paragraph("本次批改未完成，以下为当时提交的原文与译文快照。", "note"));
  }
  paragraphs.push(
    paragraph(
      `评分表：${evaluation.rubricVersion} · 模型：${evaluation.model || "未知"}${evaluation.isMock ? " · 演示数据" : ""}`,
      "body",
    ),
  );
  paragraphs.push(paragraph(`语域：${material.register}`, "body"));
  const sourceNote = material.sourceNote ?? (material.origin === "user" ? "用户自建材料，无人工审定参考译文。" : undefined);
  if (sourceNote) paragraphs.push(paragraph(`材料来源：${sourceNote}`, "note"));

  if (evaluation.summary) {
    paragraphs.push(paragraph("总结", "heading"));
    paragraphs.push(paragraph(evaluation.summary, "body"));
  }

  paragraphs.push(
    paragraph(`逐${unit}对照（共 ${material.sentences.length} ${unit}）`, "heading"),
  );
  material.sentences.forEach((sentence, i) => {
    const draft = drafts[i] ?? "";
    paragraphs.push(paragraph(`第 ${i + 1} ${unit}`, "subheading"));
    paragraphs.push(paragraph(`原文：${sentence.source}`, "body"));
    paragraphs.push(
      paragraph(`我的译文：${draft.trim() ? draft : "（未填写）"}`, "body"),
    );
    if (evaluation.referenceAvailable && sentence.reference) {
      paragraphs.push(paragraph(`参考译文：${sentence.reference}`, "body"));
    }
    const score = evaluation.sentenceScores.find((s) => s.index === sentence.index);
    if (score) {
      paragraphs.push(
        paragraph(`本${unit}得分：${score.score} / ${score.max}`, "body"),
      );
    }
    const issues = evaluation.issues.filter((issue) => issue.sentenceIndex === sentence.index);
    for (const issue of issues) {
      const label = `${ISSUE_LABELS[issue.category]} · ${SEVERITY_LABELS[issue.severity]}`;
      paragraphs.push(paragraph(`问题：${label} · 引用「${issue.quote}」`, "body"));
      paragraphs.push(paragraph(`说明：${issue.problem}`, "body"));
      paragraphs.push(paragraph(`建议：${issue.suggestion}`, "body"));
    }
  });

  if (evaluation.expressions.length > 0) {
    paragraphs.push(paragraph("建议学习的英文表达", "heading"));
    for (const expr of evaluation.expressions) {
      paragraphs.push(paragraph(`${expr.item} — ${expr.note}`, "body"));
    }
  }
  if (evaluation.vocabulary.length > 0) {
    paragraphs.push(paragraph("建议积累的英文词汇", "heading"));
    for (const word of evaluation.vocabulary) {
      paragraphs.push(paragraph(`${word.item} — ${word.note}`, "body"));
    }
  }

  const documentXml =
    XML_HEAD +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
    paragraphs.join("") +
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>` +
    `</w:body></w:document>`;

  const encoder = new TextEncoder();
  const coreXmlTitle = `${material.title} · TransLab 翻译记录`;
  return zipStored([
    { name: "[Content_Types].xml", content: encoder.encode(CONTENT_TYPES_XML) },
    { name: "_rels/.rels", content: encoder.encode(ROOT_RELS_XML) },
    { name: "word/document.xml", content: encoder.encode(documentXml) },
    { name: "docProps/core.xml", content: encoder.encode(coreXml(coreXmlTitle, evaluation.submitted)) },
    { name: "docProps/app.xml", content: encoder.encode(APP_XML) },
  ]);
}

export function exportFilename(result: SavedResult): string {
  const title = sanitizeTitle(result.material.title);
  const stamp = formatStamp(result.evaluation.submitted);
  return `${title}-TransLab-${stamp}.docx`;
}

function sanitizeTitle(raw: string): string {
  const stripped = raw
    .replace(/[/\\:*?"<>|\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const head = stripped.slice(0, 60).trim();
  return head || "翻译记录";
}

function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "时间未知";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "时间未知";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 只在浏览器里跑：Node 端契约测试直接调 buildDocxBytes 校验字节。 */
export function downloadRecord(result: SavedResult): void {
  const bytes = buildDocxBytes(result);
  const blob = new Blob([bytes as unknown as BlobPart], { type: MIME });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = exportFilename(result);
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // 立刻 revoke 会让某些浏览器中断下载；留 4 秒，够它把字节写完。
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
