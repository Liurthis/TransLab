// src/lib/zip-write.ts
//
// 只写入「未压缩」的 zip。翻译记录单份最多几十 KB，DEFLATE 省下的是体积，
// 换来的却是「浏览器CompressionStream兼容性 + CRC/尺寸双对得上」两层新错误面，不划算。
// 与 zip.ts 的读取端配对做 round-trip 契约测试，保证自己写的东西自己读得回来。

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipInputEntry {
  name: string;
  content: Uint8Array;
}

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const VERSION = 20;
const FLAGS_UTF8_NAME = 0x0800;
const METHOD_STORE = 0;
// 定死 1980-01-01 00:00:00：产物字节稳定，round-trip 哈希才可比。
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

export function zipStored(entries: ZipInputEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const dataBytes = entry.content;
    const dataLength = dataBytes.length;
    const checksum = crc32(dataBytes);

    const local = new Uint8Array(30 + nameBytes.length + dataLength);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL_SIGNATURE, true);
    lv.setUint16(4, VERSION, true);
    lv.setUint16(6, FLAGS_UTF8_NAME, true);
    lv.setUint16(8, METHOD_STORE, true);
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, checksum, true);
    lv.setUint32(18, dataLength, true);
    lv.setUint32(22, dataLength, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    local.set(dataBytes, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, CENTRAL_SIGNATURE, true);
    cv.setUint16(4, VERSION, true);
    cv.setUint16(6, VERSION, true);
    cv.setUint16(8, FLAGS_UTF8_NAME, true);
    cv.setUint16(10, METHOD_STORE, true);
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, checksum, true);
    cv.setUint32(20, dataLength, true);
    cv.setUint32(24, dataLength, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const c of centrals) centralSize += c.length;
  const totalSize = centralStart + centralSize + 22;

  const out = new Uint8Array(totalSize);
  let pos = 0;
  for (const l of locals) {
    out.set(l, pos);
    pos += l.length;
  }
  for (const c of centrals) {
    out.set(c, pos);
    pos += c.length;
  }
  const tv = new DataView(out.buffer, pos, 22);
  tv.setUint32(0, EOCD_SIGNATURE, true);
  tv.setUint16(4, 0, true);
  tv.setUint16(6, 0, true);
  tv.setUint16(8, entries.length, true);
  tv.setUint16(10, entries.length, true);
  tv.setUint32(12, centralSize, true);
  tv.setUint32(16, centralStart, true);
  tv.setUint16(20, 0, true);
  return out;
}
