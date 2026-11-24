// functions/handler.ts

import { buildPrompt, type Direction, type ModelResponse } from "./prompt.ts";
import { buildEvaluation, type Issue, type Sentence } from "./scoring.ts";
import { RUBRIC } from "./rubric.ts";

const DASHSCOPE_BASE_URL = Deno.env.get("DASHSCOPE_BASE_URL") ??
  "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DASHSCOPE_MODEL = Deno.env.get("DASHSCOPE_MODEL") ?? "qwen3.7-flash";
const DASHSCOPE_API_KEY = Deno.env.get("DASHSCOPE_API_KEY");

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

  if (!DASHSCOPE_API_KEY) {
    return Response.json(
      { ok: false, error: "service_not_configured" },
      { status: 500, headers },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400, headers });
  }

  const body = parseBody(raw);
  if (!body) {
    return Response.json({ ok: false, error: "invalid_input" }, { status: 400, headers });
  }

  const { materialId, direction, sourceSentences, userTranslations, referenceAvailable } = body;
  const { system, user } = buildPrompt({ direction, sourceSentences, userTranslations });

  const modelResponse = await fetch(`${DASHSCOPE_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${DASHSCOPE_API_KEY}`,
    },
    body: JSON.stringify({
      model: DASHSCOPE_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });

  if (!modelResponse.ok) {
    // 只回传状态码与截断后的错误摘要：上游响应体可能包含请求回显内容，
    // 不能把它原样交给前端渲染。
    const detail = await modelResponse.text().catch(() => "");
    return Response.json(
      {
        ok: false,
        error: "model_call_failed",
        status: modelResponse.status,
        detail: detail.slice(0, 200),
      },
      { status: 502, headers },
    );
  }

  const modelData = await modelResponse.json().catch(() => null);
  const content = modelData?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content) {
    return Response.json(
      { ok: false, error: "model_response_invalid" },
      { status: 502, headers },
    );
  }

  const parsed = parseModelJson(content, sourceSentences.length);
  if (!parsed) {
    // 解析失败就明确失败：绝不 fallback 造一份分数或清单。
    return Response.json(
      { ok: false, error: "model_json_parse_failed" },
      { status: 502, headers },
    );
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
    "dashscope",
    DASHSCOPE_MODEL,
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
export function parseModelJson(content: string, sentenceCount: number): ModelResponse | null {
  let raw: unknown;
  try {
    raw = JSON.parse(stripFence(content));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const data = raw as Record<string, unknown>;
  if (!Array.isArray(data.issues)) return null;

  const issues: Issue[] = [];
  let dropped = 0;
  for (const item of data.issues) {
    const issue = parseIssue(item);
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

  const expressions = parseLearningItems(data.expressions);
  const vocabulary = parseLearningItems(data.vocabulary);
  if (expressions === null || vocabulary === null) return null;

  return { issues, expressions, vocabulary };
}

function parseIssue(item: unknown): Issue | null {
  if (typeof item !== "object" || item === null) return null;
  const data = item as Record<string, unknown>;
  if (!Number.isInteger(data.sentenceIndex) || (data.sentenceIndex as number) < 0) return null;
  if (typeof data.category !== "string" || !CATEGORIES.includes(data.category)) return null;
  if (typeof data.severity !== "string" || !SEVERITIES.includes(data.severity)) return null;
  for (const key of ["quote", "problem", "suggestion"]) {
    if (typeof data[key] !== "string" || !(data[key] as string).trim()) return null;
  }
  return {
    sentenceIndex: data.sentenceIndex as number,
    category: data.category as Issue["category"],
    severity: data.severity as Issue["severity"],
    quote: data.quote as string,
    problem: data.problem as string,
    suggestion: data.suggestion as string,
  };
}

/** 学习清单允许为空数组；非空时每条必须有英文 item 和中文 note。 */
function parseLearningItems(value: unknown): ModelResponse["expressions"] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const out: ModelResponse["expressions"] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const data = item as Record<string, unknown>;
    if (typeof data.item !== "string" || !data.item.trim()) return null;
    if (typeof data.note !== "string" || !data.note.trim()) return null;
    out.push({ item: data.item, note: data.note });
  }
  return out;
}

/** 模型偶尔仍会包一层 ```json；剥掉围栏再解析，内容本身不改。 */
function stripFence(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1].trim() : trimmed;
}
