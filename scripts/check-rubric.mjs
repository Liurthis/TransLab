// 校验前端与 Function 两份评分表、以及两份评分核心逻辑完全一致。
// 存在两份的原因：Sites 只把 functions/ 目录打进 Function 包，服务端代码引用不到前端源码。
// 运行：node scripts/check-rubric.mjs
import { readFile } from "node:fs/promises";

const { RUBRIC: web } = await import("../src/data/rubric.ts");
const { RUBRIC: fn } = await import("../functions/rubric.ts");

const problems = [];

for (const field of ["version", "title", "totalScore", "sentenceFloor"]) {
  if (web[field] !== fn[field]) {
    problems.push(`${field} 不一致：前端「${web[field]}」/ Function「${fn[field]}」`);
  }
}

const key = (row) => `${row.category}/${row.severity}`;
const webRows = new Map(web.deductions.map((row) => [key(row), row.points]));
const fnRows = new Map(fn.deductions.map((row) => [key(row), row.points]));

for (const [row, points] of webRows) {
  if (!fnRows.has(row)) problems.push(`Function 缺扣分项：${row}`);
  else if (fnRows.get(row) !== points) {
    problems.push(`扣分值不一致：${row} 前端 ${points} / Function ${fnRows.get(row)}`);
  }
}
for (const row of fnRows.keys()) {
  if (!webRows.has(row)) problems.push(`前端缺扣分项：${row}`);
}

// 分数在前端与 Function 各算一次，逻辑副本只要差一行，线上算出的分就和页面看到的分不同。
// 因此直接要求这几段源码逐字相同（空白折叠后比较），而不是靠人记得同步改。
const webScoring = await readFile(new URL("../src/lib/scoring.ts", import.meta.url), "utf8");
const fnScoring = await readFile(new URL("../functions/scoring.ts", import.meta.url), "utf8");

function body(source, name) {
  const matched = source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n}`));
  return matched ? matched[0].replace(/\s+/g, " ").trim() : null;
}

for (const name of ["allocateTotal", "round1", "summarize"]) {
  const fromWeb = body(webScoring, name);
  const fromFn = body(fnScoring, name);
  if (fromWeb === null || fromFn === null) {
    problems.push(`无法在两份评分源码里都定位到 ${name}（改名或删掉了，检查随之失效）`);
  } else if (fromWeb !== fromFn) {
    problems.push(`${name} 两份副本已漂移`);
  }
}

for (const [label, source] of [
  ["前端", webScoring],
  ["Function", fnScoring],
]) {
  if (!source.includes("summarize(rubric, issues, sentenceScores)")) {
    problems.push(`${label} 的 summarize 调用没有传 rubric 与逐句分数，批改点评会算不出扣分`);
  }
}

if (problems.length) {
  console.log("评分表与评分逻辑两份副本已漂移：");
  for (const problem of problems) console.log("  - " + problem);
  process.exit(1);
}

console.log(`评分表与评分逻辑两份副本一致：${web.version} · ${webRows.size} 条扣分项`);
