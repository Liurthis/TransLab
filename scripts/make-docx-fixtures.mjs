// scripts/make-docx-fixtures.mjs
//
// 按 tests/fixtures/spec.mjs 生成 .docx 测试件。手写 zip 是为了能精确控制
// 压缩方式（deflate / store）与内部结构——真实 Word 会出的构造都得自己造一遍才测得到。
// 生成物提交在 tests/fixtures/*.docx，构建时的校验只读文件，不依赖本脚本。

import { deflateRawSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTENT_TYPES, documentXmlFor, FIXTURES, ROOT_RELS } from "../tests/fixtures/spec.mjs";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "../tests/fixtures");

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[i] = value;
  }
  return table;
})();

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

/** 最小 zip 写入器：本地头 + 中央目录 + EOCD，够 docx 用，也够校验读取端。 */
function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const encoder = new TextEncoder();

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const source = encoder.encode(entry.data);
    const stored = entry.store === true;
    const payload = stored ? source : deflateRawSync(source, { level: 9 });
    const crc = crc32(source);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(source.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, payload);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(stored ? 0 : 8, 10);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(payload.length, 20);
    header.writeUInt32LE(source.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);

    offset += local.length + name.length + payload.length;
  }

  const directory = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directory, eocd]);
}

await mkdir(outDir, { recursive: true });
for (const fixture of FIXTURES) {
  const documentXml = documentXmlFor(fixture);
  const archive = buildZip([
    { name: "[Content_Types].xml", data: CONTENT_TYPES, store: fixture.store },
    { name: "_rels/.rels", data: ROOT_RELS, store: fixture.store },
    { name: "word/document.xml", data: documentXml, store: fixture.store },
  ]);
  await writeFile(join(outDir, fixture.file), archive);
  console.log(`生成 ${fixture.file}（${archive.length} 字节，${fixture.store ? "store" : "deflate"}）`);
}

// 三种"用户很可能直接拖进来"的非 docx：提示必须指名格式，而不是笼统一句解析失败。
const fakePages = buildZip([
  { name: "Index/Index.iwa", data: "iwork-archive-placeholder" },
  { name: "Metadata/BuildVersionProperties.plist", data: "<plist/>" },
]);
await writeFile(join(outDir, "fake.pages"), fakePages);

const ole = Buffer.alloc(64);
ole.writeUInt32LE(0xe011cfd0, 0); // OLE 复合文档：Word 97-2003 的 .doc
await writeFile(join(outDir, "fake.doc"), ole);

const pdf = Buffer.concat([new TextEncoder().encode("%PDF-1.7"), Buffer.alloc(32)]);
await writeFile(join(outDir, "fake.pdf"), pdf);
console.log("生成 fake.pages / fake.doc / fake.pdf 三种反例");
