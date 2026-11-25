// scripts/check-draft.mjs
//
// 草稿存储的契约：全空=没写过、坏条目静默过滤、上限 50 条挤掉最旧、隐私模式如实报 disabled。
// 页面里的「边写边自动存」是浏览器行为，这里只锁 storage.ts 这层的纯逻辑。

import { installTsResolver } from "./dom-shim.mjs";

installTsResolver();

// storage.ts 只摸 window.localStorage，给它一台内存版就够了。
const rows = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => (rows.has(key) ? rows.get(key) : null),
    setItem: (key, value) => rows.set(key, String(value)),
    removeItem: (key) => rows.delete(key),
  },
};

const { saveDraft, loadDraft, deleteDraft } = await import("../src/lib/storage.ts");

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}`);
  if (!ok) console.log(`         期望 ${JSON.stringify(expected)}\n         实际 ${JSON.stringify(actual)}`);
}

console.log("== 存 / 取 / 删 ==");
check("全空白等于没写过，不留空壳条目", (() => { saveDraft("m1", ["", "   "]); return loadDraft("m1"); })(), null);
saveDraft("m1", ["第一段译文", "", "第三段"]);
const one = loadDraft("m1");
check("非空草稿按原样读回（保留中间空句）", one?.drafts, ["第一段译文", "", "第三段"]);
check("updatedAt 是合法 ISO 时间", one && !Number.isNaN(new Date(one.updatedAt).getTime()), true);
saveDraft("m1", ["改过的译文"]);
check("同一材料覆盖而不是堆两份", loadDraft("m1")?.drafts, ["改过的译文"]);
check("deleteDraft 删干净", (() => { deleteDraft("m1"); return loadDraft("m1"); })(), null);
check("没存过的材料返回 null", loadDraft("never"), null);
check("空 materialId 不写入不读出", (() => { saveDraft("", ["x"]); return loadDraft(""); })(), null);

console.log("\n== 上限 50 条，挤掉最旧 ==");
for (let i = 0; i < 51; i += 1) saveDraft(`cap-${i}`, [`内容 ${i}`]);
check("第 1 条被挤掉", loadDraft("cap-0"), null);
check("最新一条保留", loadDraft("cap-50")?.drafts, ["内容 50"]);

console.log("\n== 坏数据不采信，也不拖累合法条目 ==");
const KEY = "translab.v1.drafts";
const current = JSON.parse(rows.get(KEY));
rows.set(
  KEY,
  JSON.stringify([
    ...current,
    { materialId: "bad1", drafts: "不是数组", updatedAt: "x" },
    "整个条目不是对象",
    { materialId: "", drafts: ["ok"], updatedAt: "z" },
    { materialId: "bad2", drafts: [1, 2], updatedAt: "z" },
  ]),
);
check("drafts 不是字符串数组的条目被过滤", loadDraft("bad1"), null);
check("数字译文条目被过滤", loadDraft("bad2"), null);
check("合法条目不受影响", loadDraft("cap-50")?.drafts, ["内容 50"]);
check("重新保存时坏数据被整体刷掉", (() => { saveDraft("cap-50", ["更新"]); const after = JSON.parse(rows.get(KEY)); return [loadDraft("cap-50")?.drafts, after.every((item) => item && typeof item === "object" && item.materialId)]; })(), [["更新"], true]);

console.log("\n== 隐私模式：如实报不可用，不假装存好了 ==");
globalThis.window = {
  get localStorage() {
    throw new Error("隐私模式禁止访问");
  },
};
check("saveDraft 返回 disabled", saveDraft("m9", ["x"]).state, "disabled");
check("loadDraft 返回 null", loadDraft("m9"), null);
check("deleteDraft 返回 disabled", deleteDraft("m9").state, "disabled");

console.log(failures === 0 ? "\n全部通过" : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
