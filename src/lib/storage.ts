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

/** 保存结果上限：再多本机存储也没意义，且旧结果会长期挤占配额。 */
export const MAX_SAVED_RESULTS = 100;

export interface SavedResult {
  material: Material;
  /** 保存当时的译文，重开结果页才能重现你写的内容。 */
  drafts: string[];
  evaluation: Evaluation;
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

export function formatSavedLine(material: Material): string {
  return `${material.title} · ${DIRECTION_LABELS[material.direction]}`;
}
