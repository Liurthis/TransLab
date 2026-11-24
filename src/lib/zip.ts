// src/lib/zip.ts
//
// docx 本质是 zip。这里只用 DataView 与 DecompressionStream，不引入第三方解压库：
// 站点是静态导出，多一个依赖就多一分构建与体积风险，而 zip 的目录结构足够简单。

/** zip 条目的定位信息，正文按 localHeaderOffset 再读一次本地头才准。 */
interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

export class ZipFormatError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/** 从尾部倒扫中央目录结尾签名：末尾可变长度的注释让正序定位不可靠。 */
function findEocd(bytes: Uint8Array): number {
  const lowest = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= lowest; i -= 1) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06
    ) {
      return i;
    }
  }
  return -1;
}

function readEntries(bytes: Uint8Array, view: DataView): ZipEntry[] {
  const eocd = findEocd(bytes);
  if (eocd < 0) {
    throw new ZipFormatError(
      "not_zip",
      "这个文件不是 .docx：读不到 Word 文档应有的内部目录。老版 .doc 或别的格式请先另存为 .docx。",
    );
  }
  // zip64 的字段是 0xffff/0xffffffff 占位，真值在另一条记录里；文档级 zip 不该走到这里。
  if (view.getUint16(eocd + 10, true) === 0xffff || view.getUint32(eocd + 16, true) === 0xffffffff) {
    throw new ZipFormatError("zip64", "这个 .docx 用了 zip64 布局，本工具暂不支持。");
  }

  const count = view.getUint16(eocd + 10, true);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: ZipEntry[] = [];
  let offset = view.getUint32(eocd + 16, true);

  for (let n = 0; n < count; n += 1) {
    if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw new ZipFormatError("corrupt", ".docx 内部目录读坏了，文件可能不完整。");
    }
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    entries.push({
      name: decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)),
      method,
      compressedSize,
      localHeaderOffset,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function zipEntryNames(bytes: Uint8Array): string[] {
  return readEntries(bytes, viewOf(bytes)).map((entry) => entry.name);
}

function viewOf(bytes: Uint8Array): DataView {
  // byteOffset/byteLength 必须带上：subarray 出来的视图不代表从 0 开始。
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** 取出一个条目的 UTF-8 文本；条目不存在返回 null，格式意外一律抛错不静默。 */
export async function readZipEntryText(
  bytes: Uint8Array,
  name: string,
): Promise<string | null> {
  const view = viewOf(bytes);
  const entry = readEntries(bytes, view).find((item) => item.name === name);
  if (!entry) return null;

  // 本地头的名字与扩展区长度可以和中央目录不同，正文起点要按本地头重算。
  const local = entry.localHeaderOffset;
  if (view.getUint32(local, true) !== LOCAL_SIGNATURE) {
    throw new ZipFormatError("corrupt", ".docx 内部正文位置读坏了。");
  }
  const localNameLength = view.getUint16(local + 26, true);
  const localExtraLength = view.getUint16(local + 28, true);
  const start = local + 30 + localNameLength + localExtraLength;
  const raw = bytes.subarray(start, start + entry.compressedSize);

  if (entry.method === 0) return decode(raw);
  if (entry.method !== 8) {
    throw new ZipFormatError("method", `不支持的 .docx 内部压缩方式（method=${entry.method}）。`);
  }
  const inflated = new Blob([raw as unknown as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return decode(new Uint8Array(await new Response(inflated).arrayBuffer()));
}

function decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ZipFormatError("encoding", ".docx 里的正文不是合法 UTF-8，无法安全提取。");
  }
}
