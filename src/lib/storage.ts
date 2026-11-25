import type { Evaluation, Material } from "../types";
import { DIRECTION_LABELS } from "../types";
import { MATERIALS } from "../data/materials";

/**
 * 结果与自建材料都存在本机浏览器 localStorage：
 * 不配数据库、不加登录，跨设备看不到，清浏览器数据会丢。
 * 这个代价写进界面文案，不假装是云端同步。
 */

const MATERIALS_KEY = "translab.v1.materials";
const RESULTS_KEY = "translab.v1.results";
const DRAFTS_KEY = "translab.v1.drafts";

/** 保存结果上限：再多本机存储也没意义，且旧结果会长期挤占配额。 */
export const MAX_SAVED_RESULTS = 100;

/** 一台设备最多留 50 篇的未提交译文：练过的材料早就不止这些了，留着只挤配额。 */
const MAX_DRAFTS = 50;

export interface SavedResult {
  material: Material;
  /** 保存当时的译文，重开结果页才能重现你写的内容。 */
  drafts: string[];
  evaluation: Evaluation;
  /** 文档批改页保存的记录：打开时回文档页看快照，不去练习页（原文不在材料库里）。 */
  source?: "docs";
}

export type StorageState = "ok" | "disabled" | "unavailable";

interface WriteResult {
  ok: boolean;
  state: StorageState;
}

/** 隐私模式与部分嵌入式浏览器里访问 localStorage 会直接抛异常。 */
function backend(): Storage | null {
  try {
    const store = window.localStorage;
    if (!store) return null;
    const probe = "__translab_probe__";
    store.setItem(probe, "1");
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

function readList<T>(store: Storage, key: string): { items: T[]; corrupt: boolean } {
  let raw: string | null = null;
  try {
    raw = store.getItem(key);
  } catch {
    return { items: [], corrupt: true };
  }
  if (!raw) return { items: [], corrupt: false };
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { items: [], corrupt: true };
    return { items: parsed as T[], corrupt: false };
  } catch {
    // 解析失败当作没有数据，不抛异常：一次坏数据不能让整个页面白屏。
    return { items: [], corrupt: true };
  }
}

function write(store: Storage, key: string, items: unknown[]): WriteResult {
  try {
    store.setItem(key, JSON.stringify(items));
    return { ok: true, state: "ok" };
  } catch {
    // 配额满或被禁用：如实告诉用户没保存成功，不假装保存好了。
    return { ok: false, state: "unavailable" };
  }
}

export function storageState(): StorageState {
  return backend() ? "ok" : "disabled";
}

export function loadUserMaterials(): Material[] {
  const store = backend();
  if (!store) return [];
  return readList<Material>(store, MATERIALS_KEY)
    .items.filter(isValidMaterial)
    .map((material) => ({ ...material, origin: "user" as const }));
}

/**
 * 内置材料在前、自建材料在后的完整列表。
 * 练习页与材料库必须读同一个来源，否则会出现「材料库看不到但练习页能打开」的错位。
 */
export function getAllMaterials(): Material[] {
  const builtin = MATERIALS.map((material) => ({ ...material, origin: "builtin" as const }));
  return [...builtin, ...loadUserMaterials()];
}

export function findMaterial(id: string): Material | undefined {
  if (!id) return undefined;
  return getAllMaterials().find((material) => material.id === id);
}

export function loadResults(): SavedResult[] {
  const store = backend();
  if (!store) return [];
  return readList<SavedResult>(store, RESULTS_KEY)
    .items.filter(isValidSavedResult)
    .sort((a, b) => b.evaluation.submitted.localeCompare(a.evaluation.submitted));
}

export function saveUserMaterial(material: Material): WriteResult {
  const store = backend();
  if (!store) return { ok: false, state: "disabled" };
  const existing = readList<Material>(store, MATERIALS_KEY).items.filter(isValidMaterial);
  const next = [material, ...existing.filter((item) => item.id !== material.id)];
  return write(store, MATERIALS_KEY, next);
}

export function deleteUserMaterial(id: string): WriteResult {
  const store = backend();
  if (!store) return { ok: false, state: "disabled" };
  const existing = readList<Material>(store, MATERIALS_KEY).items.filter(isValidMaterial);
  return write(
    store,
    MATERIALS_KEY,
    existing.filter((item) => item.id !== id),
  );
}

export function saveResult(result: SavedResult): WriteResult {
  const store = backend();
  if (!store) return { ok: false, state: "disabled" };
  const existing = readList<SavedResult>(store, RESULTS_KEY).items.filter(isValidSavedResult);
  const next = [
    result,
    ...existing.filter((item) => item.evaluation.submitted !== result.evaluation.submitted),
  ].slice(0, MAX_SAVED_RESULTS);
  return write(store, RESULTS_KEY, next);
}

export function deleteResult(submitted: string): WriteResult {
  const store = backend();
  if (!store) return { ok: false, state: "disabled" };
  const existing = readList<SavedResult>(store, RESULTS_KEY).items.filter(isValidSavedResult);
  return write(store, RESULTS_KEY, existing.filter((item) => item.evaluation.submitted !== submitted));
}

/** 一篇材料的未提交译文：练习页边写边自动存，关掉页面下次接着写。 */
export interface PracticeDraft {
  materialId: string;
  drafts: string[];
  updatedAt: string;
}

export function loadDraft(materialId: string): PracticeDraft | null {
  const store = backend();
  if (!store || !materialId) return null;
  return readDrafts(store).find((item) => item.materialId === materialId) ?? null;
}

/** 全是空白就等价于「没写过」：删条目而不是存空壳，别占 50 条上限的名额。 */
export function saveDraft(materialId: string, drafts: string[]): WriteResult {
  const store = backend();
  if (!store) return { ok: false, state: "disabled" };
  const others = readDrafts(store).filter((item) => item.materialId !== materialId);
  const next = drafts.some((text) => text.trim())
    ? [{ materialId, drafts, updatedAt: new Date().toISOString() }, ...others].slice(0, MAX_DRAFTS)
    : others;
  return write(store, DRAFTS_KEY, next);
}

export function deleteDraft(materialId: string): WriteResult {
  const store = backend();
  if (!store) return { ok: false, state: "disabled" };
  return write(store, DRAFTS_KEY, readDrafts(store).filter((item) => item.materialId !== materialId));
}

function readDrafts(store: Storage): PracticeDraft[] {
  return readList<PracticeDraft>(store, DRAFTS_KEY).items.filter(isValidDraft);
}

/** 内置材料不在本机存储里改动：只校验自建材料，结构不合的一律不采信。 */
function isValidMaterial(value: unknown): value is Material {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || !item.id) return false;
  if (typeof item.title !== "string" || !item.title.trim()) return false;
  if (item.direction !== "en2zh" && item.direction !== "zh2en") return false;
  if (!Array.isArray(item.sentences) || item.sentences.length === 0) return false;
  if (typeof item.sourceText !== "string" || !item.sourceText.trim()) return false;
  return item.sentences.every((sentence) => {
    if (typeof sentence !== "object" || sentence === null) return false;
    const row = sentence as Record<string, unknown>;
    return typeof row.source === "string" && Boolean(row.source.trim());
  });
}

function isValidSavedResult(value: unknown): value is SavedResult {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  if (!isValidMaterial(item.material)) return false;
  if (!Array.isArray(item.drafts)) return false;
  const evaluation = item.evaluation as Record<string, unknown> | null;
  if (!evaluation || typeof evaluation !== "object") return false;
  return (
    typeof evaluation.submitted === "string" &&
    typeof evaluation.score === "number" &&
    Array.isArray(evaluation.sentenceScores) &&
    Array.isArray(evaluation.issues)
  );
}

function isValidDraft(value: unknown): value is PracticeDraft {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.materialId === "string" &&
    Boolean(item.materialId) &&
    Array.isArray(item.drafts) &&
    item.drafts.every((text) => typeof text === "string") &&
    typeof item.updatedAt === "string"
  );
}

export function formatSavedLine(material: Material): string {
  return `${material.title} · ${DIRECTION_LABELS[material.direction]}`;
}

/** 界面填写的模型接入配置；enabled=false 时请求不带 provider，走部署默认。 */
export interface ProviderSetting {
  enabled: boolean;
  baseUrl: string;
  model: string;
  apiKey: string;
}

const PROVIDER_KEY = "translab.v1.provider";

export function loadProvider(): ProviderSetting | null {
  const store = backend();
  if (!store) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(PROVIDER_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const p = parsed as Record<string, unknown>;
    if (
      typeof p.enabled !== "boolean" ||
      typeof p.baseUrl !== "string" ||
      typeof p.model !== "string" ||
      typeof p.apiKey !== "string"
    ) {
      return null;
    }
    return { enabled: p.enabled, baseUrl: p.baseUrl, model: p.model, apiKey: p.apiKey };
  } catch {
    return null;
  }
}

export function saveProviderSetting(setting: ProviderSetting): WriteResult {
  const store = backend();
  if (!store) return { ok: false, state: "disabled" };
  try {
    store.setItem(PROVIDER_KEY, JSON.stringify(setting));
    return { ok: true, state: "ok" };
  } catch {
    return { ok: false, state: "unavailable" };
  }
}

export function clearProviderSetting(): WriteResult {
  const store = backend();
  if (!store) return { ok: false, state: "disabled" };
  try {
    store.removeItem(PROVIDER_KEY);
    return { ok: true, state: "ok" };
  } catch {
    return { ok: false, state: "unavailable" };
  }
}

/** 评分/配对请求的统一出口：未启用或填不全就返回空对象，由部署侧环境变量兜底。 */
export function providerPayload(): { provider?: { baseUrl: string; apiKey: string; model: string } } {
  const setting = loadProvider();
  if (!setting || !setting.enabled) return {};
  const baseUrl = setting.baseUrl.trim();
  const model = setting.model.trim();
  const apiKey = setting.apiKey.trim();
  if (!baseUrl || !model || !apiKey) return {};
  return { provider: { baseUrl, apiKey, model } };
}
