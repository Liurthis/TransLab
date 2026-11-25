// functions/handler.ts

import { buildAlignPrompt, buildPrompt, type Direction, type ModelResponse } from "./prompt.ts";
import { buildEvaluation, type Issue, type Sentence } from "./scoring.ts";
import { RUBRIC } from "./rubric.ts";

const DASHSCOPE_BASE_URL = Deno.env.get("DASHSCOPE_BASE_URL") ??
  "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DASHSCOPE_MODEL = Deno.env.get("DASHSCOPE_MODEL") ?? "qwen3.7-flash";
const DASHSCOPE_API_KEY = Deno.env.get("DASHSCOPE_API_KEY");

/**
 * 用户自带模型配置（BYO）。部署默认不开启：没设 ALLOW_USER_PROVIDER=true 时，
 * 带 provider 的请求直接报错而不是静默改用服务端配置——静默换后端等于骗用户。
 */
const ALLOW_USER_PROVIDER = Deno.env.get("ALLOW_USER_PROVIDER") === "true";

/** enable_thinking 是阿里云端点的特有字段；严格的 OpenAI 兼容服务可能拒绝未知字段，非阿里端点不发。 */
const ALIYUN_ENDPOINT = /dashscope\.aliyuncs\.com|maas\.aliyuncs\.com/;

interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** true = 来自请求（用户在界面里填的），影响返回结果的 provider 标注。 */
  fromRequest: boolean;
}

interface ProviderParse {
  provided: boolean;
  valid: boolean;
  config?: ProviderConfig;
}

/** 只回字段名与校验结论，绝不把 apiKey 内容带进任何返回值或日志。 */
export function parseProviderRequest(raw: unknown): ProviderParse {
  if (typeof raw !== "object" || raw === null) return { provided: false, valid: true };
  const field = (raw as Record<string, unknown>).provider;
  if (field === undefined || field === null) return { provided: false, valid: true };
  if (typeof field !== "object") return { provided: true, valid: false };
  const p = field as Record<string, unknown>;
  if (typeof p.baseUrl !== "string" || typeof p.apiKey !== "string" || typeof p.model !== "string") {
    return { provided: true, valid: false };
  }
  const baseUrl = p.baseUrl.trim();
  const apiKey = p.apiKey.trim();
  const model = p.model.trim();
  if (!baseUrl || !apiKey || !model) return { provided: true, valid: false };
  if (baseUrl.length > 300 || apiKey.length > 300 || model.length > 150) {
    return { provided: true, valid: false };
  }
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return { provided: true, valid: false };
  }
  // 内嵌凭据的 URL 会把密钥写进每一次请求行；非 http(s) 协议一律拒绝。
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    return { provided: true, valid: false };
  }
  return { provided: true, valid: true, config: { baseUrl, apiKey, model, fromRequest: true } };
}

/** 与前端断句上限、prompt 截断上限保持一致。 */
const MAX_SEGMENTS = 200;

const DIRECTIONS: Direction[] = ["en2zh", "zh2en"];

const CATEGORIES = ["mistranslation", "omission", "wording", "grammar", "logic"];
const SEVERITIES = ["light", "moderate", "severe"];

export interface RequestBody {
  materialId: string;
  direction: Direction;
  sourceSentences: string[];
  userTranslations: string[];
  referenceAvailable: boolean;
}

export async function handler(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };

  if (request.method !== "POST") {
    return Response.json(
      { ok: false, error: "method_not_allowed" },
      { status: 405, headers: { ...headers, Allow: "POST" } },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400, headers });
  }

  const providerParse = parseProviderRequest(raw);
  if (providerParse.provided && !ALLOW_USER_PROVIDER) {
    return Response.json({ ok: false, error: "provider_not_enabled" }, { status: 400, headers });
  }
  if (providerParse.provided && !providerParse.valid) {
    return Response.json({ ok: false, error: "invalid_provider" }, { status: 400, headers });
  }
  const provider: ProviderConfig = providerParse.config ?? {
    baseUrl: DASHSCOPE_BASE_URL,
    apiKey: DASHSCOPE_API_KEY ?? "",
    model: DASHSCOPE_MODEL,
    fromRequest: false,
  };
  if (!provider.apiKey) {
    return Response.json(
      { ok: false, error: "service_not_configured" },
      { status: 500, headers },
    );
  }

  // 文档导入的「段落配对」是另一个动作：只回配对建议，分数仍只由评分那条路算出来。
  if (isAlignRequest(raw)) {
    return await handleAlign(raw, headers, provider);
  }

  const body = parseBody(raw);
  if (!body) {
    return Response.json({ ok: false, error: "invalid_input" }, { status: 400, headers });
  }

  const { materialId, direction, sourceSentences, userTranslations, referenceAvailable } = body;

  let parsed: ModelResponse;
  try {
    parsed = await evaluateInBatches(direction, sourceSentences, userTranslations, provider);
  } catch (error) {
    // 任何一批失败都整篇失败：缺了几批的错误清单，分数必然虚高，不能凑一份结果回去。
    if (error instanceof UpstreamError) {
      return Response.json(
        { ok: false, error: error.code, ...(error.detail ? { detail: error.detail } : {}) },
        { status: 502, headers },
      );
    }
    throw error;
  }

  const sentences: Sentence[] = sourceSentences.map((source, index) => ({
    index,
    source,
    // 参考译文留在前端本地，Function 只带「有没有」这个事实。
    reference: "",
  }));

  const evaluation = buildEvaluation(
    materialId,
    RUBRIC,
    sentences,
    parsed.issues,
    provider.fromRequest ? "user" : "dashscope",
    provider.model,
  );

  return Response.json(
    {
      ok: true,
      evaluation: {
        ...evaluation,
        direction,
        referenceAvailable,
        expressions: parsed.expressions,
        vocabulary: parsed.vocabulary,
      },
    },
    { headers },
  );
}

/**
 * 一次调用评几句。长材料单次评全篇会同时踩两个坑：网关 60 秒超时，
 * 以及模型输出 JSON 过长被截断（表现为 model_json_parse_failed）。分批后单次输出短、
 * 各批并发，总耗时约等于「批数 ÷ 并发数」这一波数乘以最慢一批。
 * 分数仍由 scoring.ts 在合并后统一计算。
 */
const CONCURRENCY = 10;

/**
 * 句数越多、每批越大：批数才是总耗时的主导项。
 * 144 句按每批 2 句实测 60.3 秒被网关切断（504），按每批 4 句批数降到 36。
 */
function batchSizeFor(segmentCount: number): number {
  if (segmentCount <= 8) return 2;
  if (segmentCount <= 32) return 3;
  return 4;
}

class UpstreamError extends Error {
  code: string;
  detail?: string;

  // 不用 constructor(public code: ...) 参数属性：离线校验靠 Node 的 strip-only 模式跑这份文件。
  constructor(code: string, detail?: string) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

async function evaluateInBatches(
  direction: Direction,
  sourceSentences: string[],
  userTranslations: string[],
  provider: ProviderConfig,
): Promise<ModelResponse> {
  const batchSize = batchSizeFor(sourceSentences.length);
  const starts: number[] = [];
  for (let start = 0; start < sourceSentences.length; start += batchSize) starts.push(start);

  const batches = await mapLimit(starts, CONCURRENCY, async (start) => {
    const size = Math.min(batchSize, sourceSentences.length - start);
    const { system, user } = buildPrompt({
      direction,
      sourceSentences: sourceSentences.slice(start, start + size),
      userTranslations: userTranslations.slice(start, start + size),
    });
    const parsed = await evaluateChunk(system, user, size, provider);
    // 每批内部用 0 起的局部编号，越界判定也在批内做，合并时再换算回全篇编号。
    return { start, parsed };
  });

  return mergeBatches(batches);
}

/**
 * 单批评分，解析失败重试一次。
 * 长材料会产生几十批，任何一批偶发返回残缺 JSON 都不该让整篇练习白做。
 */
async function evaluateChunk(
  system: string,
  user: string,
  size: number,
  provider: ProviderConfig,
): Promise<ModelResponse> {
  let reason = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const diag: { reason?: string } = {};
    const { content, finishReason } = await callModel(system, user, provider);
    const parsed = parseModelJson(content, size, diag);
    if (parsed) return parsed;
    // 只带可安全回传的诊断量：finish_reason 区分"被 max_tokens 截断"，
    // diag.reason 指出违反哪一条校验，两者都不含用户译文。
    reason = `finish=${finishReason || "unknown"} length=${content.length} rule=${
      diag.reason || "unknown"
    } attempt=${attempt + 1}`;
  }
  throw new UpstreamError("model_json_parse_failed", reason);
}

export function mergeBatches(
  batches: { start: number; parsed: ModelResponse }[],
): ModelResponse {
  const issues = batches.flatMap(({ start, parsed }) =>
    parsed.issues.map((issue) => ({ ...issue, sentenceIndex: issue.sentenceIndex + start })),
  );
  issues.sort((a, b) => a.sentenceIndex - b.sentenceIndex);
  return {
    issues,
    expressions: batches.flatMap((batch) => batch.parsed.expressions),
    vocabulary: batches.flatMap((batch) => batch.parsed.vocabulary),
  };
}

/** 上游明确抱怨 response_format 时才值得退回不带它重发；其它 4xx 退让只会掩盖真因。 */
const JSON_MODE_REJECTED = /response_format/i;

/**
 * 一次模型调用。先按 JSON 模式请求（阿里云等服务商靠它显著降低格式错误），
 * 只有当服务明确拒绝该字段时才去掉它重试——严格的 OpenAI 兼容服务（如 LM Studio 跑
 * gpt-oss）只接受 json_schema/text，硬带 json_object 会整批批改失败。
 */
async function callModel(
  system: string,
  user: string,
  provider: ProviderConfig,
): Promise<{ content: string; finishReason: string }> {
  try {
    return await requestCompletion(system, user, provider, true);
  } catch (error) {
    if (error instanceof UpstreamError && error.code === "model_call_failed" && JSON_MODE_REJECTED.test(error.detail ?? "")) {
      return await requestCompletion(system, user, provider, false);
    }
    throw error;
  }
}

async function requestCompletion(
  system: string,
  user: string,
  provider: ProviderConfig,
  jsonMode: boolean,
): Promise<{ content: string; finishReason: string }> {
  let modelResponse: Response;
  try {
    modelResponse = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.1,
        max_tokens: 4096,
        // 思考链是单次调用 50 秒以上的主因；关掉后同一段文本的耗时才有希望落在网关 60 秒内。
        ...(ALIYUN_ENDPOINT.test(provider.baseUrl) ? { enable_thinking: false } : {}),
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    });
  } catch (error) {
    // 自建模型最典型的失败是连接被拒（本地服务没开、地址端口填错）。原始异常往上冒只会
    // 变成一句没有内容的 500，用户看不出该改哪里；错误文本只有主机端口，不含密钥与译文。
    const message = error instanceof Error ? error.message : String(error);
    throw new UpstreamError("model_call_failed", `connect: ${message.slice(0, 160)}`);
  }

  if (!modelResponse.ok) {
    // 只回传状态码与截断后的错误摘要：上游响应体可能包含请求回显内容，
    // 不能把它原样交给前端渲染。
    const detail = await modelResponse.text().catch(() => "");
    throw new UpstreamError(
      "model_call_failed",
      `HTTP ${modelResponse.status} ${detail.slice(0, 200)}`.trim(),
    );
  }

  const modelData = await modelResponse.json().catch(() => null);
  const choice = modelData?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== "string" || !content) {
    throw new UpstreamError("model_response_invalid");
  }
  return { content, finishReason: String(choice?.finish_reason ?? "") };
}

/** 并发上限：200 段的文章会产生几十批，不能一次性全打出去。 */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        out[index] = await fn(items[index]);
      }
    }),
  );
  return out;
}

/**
 * 导出供离线校验脚本测试：生产入口只使用 handler，
 * 但这两个校验函数是评分契约里最容易出错的部分，必须能在不联网、不花配额的情况下验证。
 */
export function parseBody(raw: unknown): RequestBody | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Record<string, unknown>;

  if (typeof body.materialId !== "string" || !body.materialId) return null;
  // 缺省方向按英译汉处理：这是尚未发送 direction 的旧前端当前唯一在做的方向，
  // 迁移期保持一致才 honest；新前端总会显式带上方向。
  const direction =
    body.direction === undefined ? "en2zh" : body.direction;
  if (typeof direction !== "string" || !DIRECTIONS.includes(direction as Direction)) {
    return null;
  }
  if (!Array.isArray(body.sourceSentences) || !Array.isArray(body.userTranslations)) return null;

  const sourceSentences = body.sourceSentences.map((s) => String(s ?? ""));
  const userTranslations = body.userTranslations.map((t) => String(t ?? ""));
  if (sourceSentences.length === 0) return null;
  if (sourceSentences.length > MAX_SEGMENTS) return null;
  if (sourceSentences.length !== userTranslations.length) return null;
  if (!sourceSentences.some((s) => s.trim()) || !userTranslations.some((t) => t.trim())) {
    return null;
  }

  return {
    materialId: body.materialId,
    direction: direction as Direction,
    sourceSentences,
    userTranslations,
    referenceAvailable: body.referenceAvailable === true,
  };
}

/**
 * 模型输出的结构校验。问题结构不合任何一条都算整体失败，
 * 因为分数与展示都依赖可定位的句段编号，脏数据会连带算错分数。
 * sentenceIndex 越界的问题无法定位，只能丢弃（见下），其余保留。
 */
export function parseModelJson(
  content: string,
  sentenceCount: number,
  diag?: { reason?: string },
): ModelResponse | null {
  const fail = (reason: string): null => {
    // 只记录违反了哪一条规则，绝不把模型返回的文本写进诊断：那里面含用户译文。
    if (diag) diag.reason = reason;
    return null;
  };
  let raw: unknown;
  try {
    raw = JSON.parse(stripFence(content));
  } catch {
    return fail("json_parse");
  }
  if (typeof raw !== "object" || raw === null) return fail("top_level_not_object");
  const data = raw as Record<string, unknown>;
  if (!Array.isArray(data.issues)) return fail("issues_not_array");

  const issues: Issue[] = [];
  let dropped = 0;
  for (const [position, item] of data.issues.entries()) {
    const issue = parseIssue(item, diag, position);
    if (!issue) return null;
    // 越界编号无法定位到句段：显示与计数都会错，丢弃比错位归因诚实。
    if (issue.sentenceIndex >= sentenceCount) {
      dropped += 1;
      continue;
    }
    issues.push(issue);
  }
  if (dropped > 0) {
    console.warn(`dropped ${dropped} issue(s) with out-of-range sentenceIndex`);
  }

  const expressions = parseLearningItems(data.expressions, diag, "expressions");
  const vocabulary = parseLearningItems(data.vocabulary, diag, "vocabulary");
  if (expressions === null || vocabulary === null) return null;

  return { issues, expressions, vocabulary };
}

function parseIssue(
  item: unknown,
  diag?: { reason?: string },
  position = 0,
): Issue | null {
  const fail = (reason: string): null => {
    if (diag) diag.reason = reason;
    return null;
  };
  if (typeof item !== "object" || item === null) return fail(`issues[${position}]_not_object`);
  const data = item as Record<string, unknown>;
  // 只有决定分数的三个字段是硬要求：缺了就只能判失败，绝不猜一个档位来凑分。
  if (!Number.isInteger(data.sentenceIndex) || (data.sentenceIndex as number) < 0) {
    return fail(`issues[${position}].sentenceIndex`);
  }
  if (typeof data.category !== "string" || !CATEGORIES.includes(data.category)) {
    // 只报长度不报内容：枚举字段被模型写成句子时，诊断本身不该带上译文片段。
    return fail(`issues[${position}].category.len=${String(data.category).length}`);
  }
  if (typeof data.severity !== "string" || !SEVERITIES.includes(data.severity)) {
    return fail(`issues[${position}].severity.len=${String(data.severity).length}`);
  }
  // quote/problem/suggestion 只影响展示，不参与算分。整句未译时学生侧无片段可引，
  // 为空是合理结果；为此拒收整批会让长材料里几十批被一条空引用全废掉。
  const text = (key: string): string =>
    typeof data[key] === "string" ? (data[key] as string).trim() : "";
  return {
    sentenceIndex: data.sentenceIndex as number,
    category: data.category as Issue["category"],
    severity: data.severity as Issue["severity"],
    quote: text("quote"),
    problem: text("problem"),
    suggestion: text("suggestion"),
  };
}

/**
 * 学习清单与分数无关，放宽到"缺 note 也留条目"：
 * 千词材料有几十批，让一条缺说明的条目废掉整篇评分不值得。
 */
function parseLearningItems(
  value: unknown,
  diag?: { reason?: string },
  name = "learning",
): ModelResponse["expressions"] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    if (diag) diag.reason = `${name}_not_array`;
    return null;
  }
  const out: ModelResponse["expressions"] = [];
  let dropped = 0;
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      dropped += 1;
      continue;
    }
    const data = item as Record<string, unknown>;
    // 没有 item 的条目没有可学内容；note 缺失只影响解释，不影响条目成立。
    if (typeof data.item !== "string" || !data.item.trim()) {
      dropped += 1;
      continue;
    }
    out.push({
      item: data.item.trim(),
      note: typeof data.note === "string" ? data.note.trim() : "",
    });
  }
  if (dropped > 0) {
    console.warn(`dropped ${dropped} malformed ${name} item(s)`);
  }
  return out;
}

/** 模型偶尔仍会包一层 ```json；剥掉围栏再解析，内容本身不改。 */
function stripFence(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1].trim() : trimmed;
}

/**
 * 文档导入的段落配对。与评分严格分开：模型只回答「这两段是不是同一段的互译」，
 * 分数一律由 scoring.ts 按评分表算；而且这里的返回值不会自动生效——
 * 前端必须把它摊开给用户逐行确认或改完，才拿去评分。错位的配对会把之后每一段都批错，
 * 分数看着正常，其实全废。
 */
interface AlignRequestBody {
  direction: Direction;
  sourceParagraphs: string[];
  targetParagraphs: string[];
}

export interface AlignPair {
  sourceIndex: number;
  targetIndex: number | null;
}

export interface AlignmentResult {
  pairs: AlignPair[];
  notes: string;
}

function isAlignRequest(raw: unknown): boolean {
  return (
    typeof raw === "object" &&
    raw !== null &&
    (raw as Record<string, unknown>).action === "align"
  );
}

async function handleAlign(
  raw: unknown,
  headers: Record<string, string>,
  provider: ProviderConfig,
): Promise<Response> {
  const input = parseAlignBody(raw);
  if (!input) {
    return Response.json({ ok: false, error: "invalid_input" }, { status: 400, headers });
  }
  try {
    const alignment = await alignOnce(input, provider);
    return Response.json({ ok: true, alignment }, { headers });
  } catch (error) {
    if (error instanceof UpstreamError) {
      return Response.json(
        { ok: false, error: error.code, ...(error.detail ? { detail: error.detail } : {}) },
        { status: 502, headers },
      );
    }
    throw error;
  }
}

/** 配对是一次调用：输入按段首截断，输出只有编号，不需要分批。失败重试一次。 */
async function alignOnce(input: AlignRequestBody, provider: ProviderConfig): Promise<AlignmentResult> {
  const { system, user } = buildAlignPrompt(input);
  let reason = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const diag: { reason?: string } = {};
    const { content, finishReason } = await callModel(system, user, provider);
    const parsed = parseAlignment(
      content,
      input.sourceParagraphs.length,
      input.targetParagraphs.length,
      diag,
    );
    if (parsed) return parsed;
    reason = `finish=${finishReason || "unknown"} length=${content.length} rule=${
      diag.reason || "unknown"
    } attempt=${attempt + 1}`;
  }
  throw new UpstreamError("model_json_parse_failed", reason);
}

export function parseAlignBody(raw: unknown): AlignRequestBody | null {
  if (typeof raw === "object" && raw !== null) {
    const body = raw as Record<string, unknown>;
    if (!Array.isArray(body.sourceParagraphs) || !Array.isArray(body.targetParagraphs)) {
      return null;
    }
    const sourceParagraphs = body.sourceParagraphs.map((p) => String(p ?? ""));
    const targetParagraphs = body.targetParagraphs.map((p) => String(p ?? ""));
    if (!sourceParagraphs.length || !targetParagraphs.length) return null;
    // 与评分同样的上限：超出就算配上对也批不了。
    if (sourceParagraphs.length > MAX_SEGMENTS || targetParagraphs.length > MAX_SEGMENTS) {
      return null;
    }
    if (!sourceParagraphs.some((p) => p.trim()) || !targetParagraphs.some((p) => p.trim())) {
      return null;
    }
    const direction = body.direction === undefined ? "en2zh" : body.direction;
    if (typeof direction !== "string" || !DIRECTIONS.includes(direction as Direction)) {
      return null;
    }
    return { direction: direction as Direction, sourceParagraphs, targetParagraphs };
  }
  return null;
}

/**
 * 配对建议的校验：坏条目一律降级成「没配上」而不是拒收整份建议。
 * 原文段落永远成行出现（末尾补齐为 null），这样界面上看得见的段落数和文档段落数一致，
 * 用户不会以为某一段被系统吃掉了。
 */
export function parseAlignment(
  content: string,
  sourceCount: number,
  targetCount: number,
  diag?: { reason?: string },
): AlignmentResult | null {
  const fail = (reason: string): null => {
    if (diag) diag.reason = reason;
    return null;
  };
  let raw: unknown;
  try {
    raw = JSON.parse(stripFence(content));
  } catch {
    return fail("json_parse");
  }
  if (typeof raw !== "object" || raw === null) return fail("top_level_not_object");
  const data = raw as Record<string, unknown>;
  if (!Array.isArray(data.pairs)) return fail("pairs_not_array");

  const chosen = new Map<number, number | null>();
  const usedTarget = new Set<number>();
  let dropped = 0;
  for (const item of data.pairs as unknown[]) {
    if (!Array.isArray(item) || item.length < 2) {
      dropped += 1;
      continue;
    }
    const source = item[0];
    const target = item[1];
    if (!Number.isInteger(source) || (source as number) < 0 || (source as number) >= sourceCount) {
      dropped += 1;
      continue;
    }
    const sourceIndex = source as number;
    if (chosen.has(sourceIndex)) {
      dropped += 1;
      continue;
    }
    if (target === null || target === undefined) {
      chosen.set(sourceIndex, null);
      continue;
    }
    // 译文编号不可用或被用过，只降级成「没配上」：原文行还在，用户看得见也能自己选。
    if (!Number.isInteger(target) || (target as number) < 0 || (target as number) >= targetCount) {
      chosen.set(sourceIndex, null);
      continue;
    }
    const targetIndex = target as number;
    if (usedTarget.has(targetIndex)) {
      chosen.set(sourceIndex, null);
      continue;
    }
    usedTarget.add(targetIndex);
    chosen.set(sourceIndex, targetIndex);
  }
  if (dropped > 0) {
    console.warn(`alignment dropped ${dropped} malformed pair entry(ies)`);
  }

  const pairs: AlignPair[] = [];
  for (let sourceIndex = 0; sourceIndex < sourceCount; sourceIndex += 1) {
    pairs.push({ sourceIndex, targetIndex: chosen.get(sourceIndex) ?? null });
  }
  return {
    pairs,
    notes: typeof data.notes === "string" ? data.notes.trim().slice(0, 400) : "",
  };
}
