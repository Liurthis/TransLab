// tests/fixtures/spec.mjs
//
// docx 提取器的测试件规格：同一份规格既用来生成 .docx，也用来生成期望段落。
// 期望值写成"人一眼能核对"的字面量，不引入第二个实现来当裁判。

export const FIXTURES = [
  {
    file: "basic.docx",
    title: "三个普通段落，中英混排",
    body: `
      <w:p><w:r><w:t>Urban parks are not decoration.</w:t></w:r></w:p>
      <w:p><w:r><w:t>城市绿地不是装饰，而是基础设施。</w:t></w:r></w:p>
      <w:p><w:r><w:t>Yet a single park cannot rewire a district.</w:t></w:r></w:p>`,
    paragraphs: [
      "Urban parks are not decoration.",
      "城市绿地不是装饰，而是基础设施。",
      "Yet a single park cannot rewire a district.",
    ],
  },
  {
    file: "runsplit.docx",
    title: "一句话被拆成多个 run，中间夹拼写检查标记、制表符与软换行",
    body: `
      <w:p>
        <w:proofErr w:type="spellStart"/>
        <w:r><w:t>The budget</w:t></w:r>
        <w:proofErr w:type="spellEnd"/>
        <w:r><w:t xml:space="preserve"> remains limited</w:t></w:r>
        <w:r><w:tab/></w:r>
        <w:r><w:t>for remote work.</w:t></w:r>
        <w:r><w:br/></w:r>
        <w:r><w:t>第二行</w:t></w:r>
      </w:p>`,
    // tab 与 br 一律换成空格：它们是排版，不是文字内容。
    paragraphs: ["The budget remains limited for remote work. 第二行"],
  },
  {
    file: "entities.docx",
    title: "实体引用必须解码，不能把 &amp; 原样留在译文里",
    body: `
      <w:p><w:r><w:t>R&amp;D is 5&#38; &lt;quoted&gt; &#8220;ok&#8221;</w:t></w:r></w:p>
      <w:p><w:r><w:t>it&#8217;s fine</w:t></w:r></w:p>`,
    // &#38; 是 &（不是 %）；这条期望值被 Apple textutil 独立比对纠正过一次。
    paragraphs: ["R&D is 5& <quoted> “ok”", "it’s fine"],
  },
  {
    file: "table.docx",
    title: "表格单元格里的段落按出现顺序取出",
    body: `
      <w:p><w:r><w:t>Before table</w:t></w:r></w:p>
      <w:tbl>
        <w:tr>
          <w:tc><w:p><w:r><w:t>甲项</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>Item A</w:t></w:r></w:p></w:tc>
        </w:tr>
        <w:tr>
          <w:tc><w:p><w:r><w:t>乙项</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>Item B</w:t></w:r></w:p></w:tc>
        </w:tr>
      </w:tbl>
      <w:p><w:r><w:t>After table</w:t></w:r></w:p>`,
    paragraphs: ["Before table", "甲项", "Item A", "乙项", "Item B", "After table"],
  },
  {
    file: "textbox.docx",
    title: "文本框的 Choice 与 Fallback 是同一段内容，只能取一次",
    body: `
      <w:p>
        <w:r><w:t>Host paragraph</w:t></w:r>
        <w:r>
          <mc:AlternateContent>
            <mc:Choice Requires="wps">
              <w:drawing><wp:inline>
                <wps:txbx><w:txbxContent>
                  <w:p><w:r><w:t>框内文字</w:t></w:r></w:p>
                </w:txbxContent></wps:txbx>
              </wp:inline></w:drawing>
            </mc:Choice>
            <mc:Fallback>
              <w:pict><v:shape>
                <v:textbox><w:txbxContent>
                  <w:p><w:r><w:t>框内文字</w:t></w:r></w:p>
                </w:txbxContent></v:textbox>
              </v:shape></w:pict>
            </mc:Fallback>
          </mc:AlternateContent>
        </w:r>
      </w:p>
      <w:p><w:r><w:t>Next paragraph</w:t></w:r></w:p>`,
    // 宿主段落只留自己的文字（不能把框内文字并进去），框内段落单独成段且只出现一次。
    paragraphs: ["Host paragraph", "框内文字", "Next paragraph"],
  },
  {
    file: "revision.docx",
    title: "修订：删除的内容不计入，插入的内容计入",
    body: `
      <w:p>
        <w:r><w:t>The plan </w:t></w:r>
        <w:del w:id="1"><w:r><w:delText>was delayed</w:delText></w:r></w:del>
        <w:ins w:id="2"><w:r><w:t>was approved</w:t></w:r></w:ins>
        <w:r><w:t> in May.</w:t></w:r>
      </w:p>`,
    paragraphs: ["The plan was approved in May."],
  },
  {
    file: "field.docx",
    title: "域代码不能当成正文文字",
    body: `
      <w:p>
        <w:r><w:fldChar w:fldCharType="begin"/></w:r>
        <w:r><w:instrText>PAGE </w:instrText></w:r>
        <w:r><w:fldChar w:fldCharType="separate"/></w:r>
        <w:r><w:t>7</w:t></w:r>
        <w:r><w:fldChar w:fldCharType="end"/></w:r>
        <w:r><w:t xml:space="preserve"> of the report</w:t></w:r>
      </w:p>
      <w:p>
        <w:fldSimple w:instr="DATE @ &quot;yyyy-MM-dd&quot;">
          <w:r><w:t>2026-11-24</w:t></w:r>
        </w:fldSimple>
      </w:p>`,
    // 域结果保留，instrText 里的 PAGE / DATE 表达式绝不能混进句子。
    paragraphs: ["7 of the report", "2026-11-24"],
  },
  {
    file: "linksmart.docx",
    title: "超链接与 smartTag 里的文字是正文，跳过就是丢字",
    body: `
      <w:p>
        <w:r><w:t>See </w:t></w:r>
        <w:hyperlink r:id="rId1"><w:r><w:t>the official guide</w:t></w:r></w:hyperlink>
        <w:r><w:t xml:space="preserve"> and </w:t></w:r>
        <w:smartTag w:uri="x" w:element="thing"><w:r><w:t>smart content</w:t></w:r></w:smartTag>
        <w:r><w:t>.</w:t></w:r>
      </w:p>`,
    paragraphs: ["See the official guide and smart content."],
  },
  {
    file: "sdt.docx",
    title: "内容控件（w:sdt）里的段落同样要取出来",
    body: `
      <w:p><w:r><w:t>Intro</w:t></w:r></w:p>
      <w:sdt>
        <w:sdtPr><w:alias w:val="目录"/></w:sdtPr>
        <w:sdtContent>
          <w:p><w:r><w:t>Controlled paragraph</w:t></w:r></w:p>
        </w:sdtContent>
      </w:sdt>
      <w:p><w:r><w:t>Outro</w:t></w:r></w:p>`,
    paragraphs: ["Intro", "Controlled paragraph", "Outro"],
  },
  {
    file: "stored.docx",
    title: "不压缩存储（method=0）的 docx 也要能读",
    store: true,
    body: `
      <w:p><w:r><w:t>Stored, not deflated.</w:t></w:r></w:p>`,
    paragraphs: ["Stored, not deflated."],
  },
  {
    file: "reference.docx",
    title: "脚注引用标记留在正文，脚注正文在别的部件里（本工具不取）",
    body: `
      <w:p>
        <w:r><w:t>Remote work costs less</w:t></w:r>
        <w:r><w:footnoteReference w:id="1"/></w:r>
        <w:r><w:t> than offices.</w:t></w:r>
      </w:p>`,
    paragraphs: ["Remote work costs less than offices."],
    notesInclude: ["脚注"],
  },
  {
    file: "onlysect.docx",
    title: "只有分节符的空文档",
    body: `<w:p><w:pPr><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:pPr></w:p>`,
    paragraphs: [],
  },
  {
    file: "long.docx",
    title: "千词级：40 段各 25 词，评分链路已单独压测，这里只验提取不丢字",
    body: Array.from({ length: 40 }, (_, i) => {
      const words = Array.from({ length: 25 }, (_, w) => `s${i}w${w}`).join(" ");
      return `<w:p><w:r><w:t>${words}.</w:t></w:r></w:p>`;
    }).join("\n"),
    paragraphs: Array.from(
      { length: 40 },
      (_, i) => `${Array.from({ length: 25 }, (_, w) => `s${i}w${w}`).join(" ")}.`,
    ),
  },
];

/** WordprocessingML 命名空间声明：少一条，DOMParser 就把元素判给错误命名空间。 */
export const DOCUMENT_HEAD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:w="${"http://schemas.openxmlformats.org/wordprocessingml/2006/main"}"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:v="urn:schemas-microsoft-com:vml"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  mc:Ignorable="wps wp v o">
  <w:body>`;

export const DOCUMENT_TAIL = `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`;

export const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

export const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
    Target="word/document.xml"/>
</Relationships>`;

/** 生成端与校验端共用同一份拼装函数，避免"测试件与期望值来自两套拼接"这种自证。 */
export function documentXmlFor(fixture) {
  return `${DOCUMENT_HEAD}\n${fixture.body}\n${DOCUMENT_TAIL}`;
}
