// 断句器验收脚本：node scripts/check-segment.mjs
// 检查三条硬不变量：不丢字、不重复切、同输入必同输出。
import { segmentText, MAX_SEGMENTS } from "../src/lib/segment.ts";

let failures = 0;

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures += 1;
  console.log(`FAIL   ${name}\n       got ${a}\n       want ${e}`);
}

const EN = [
  {
    name: "缩写 Mr. 与句末点号共存",
    text: "Cities that plant more trees are not simply making themselves prettier. Mr. Liu disagrees. They are rewiring how residents think.",
    want: 3,
  },
  {
    name: "单字母专名 U.S. 内部不切",
    text: "The U.S. EPA set the limit. It took effect in 2020.",
    want: 2,
  },
  {
    name: "e.g. 在句中不切",
    text: "Some services — e.g. buses and subways — cut emissions. Others do not.",
    want: 2,
  },
  {
    name: "省略号结尾算一句",
    text: "They promised to plant a thousand trees… Nothing happened. Voters noticed.",
    want: 3,
  },
  {
    name: "右引号属于前一句",
    text: 'The mayor called it "a turning point." Critics disagreed. The budget was cut.',
    want: 3,
  },
  {
    name: "小数点不切",
    text: "Coverage rose to 3.5 per cent in 2019. It fell again last year.",
    want: 2,
  },
  {
    name: "问号与感叹号",
    text: "Does it work? Officials say yes. But the data is thin!",
    want: 3,
  },
  {
    name: "排比句重复出现不许丢",
    text: "They counted the trees. They counted the trees. Nothing changed.",
    want: 3,
  },
];

const ZH = [
  {
    name: "中文按句号切",
    text: "城市绿化并不只是让市容更美。它们正在重塑居民出行的方式。研究还发现焦虑症在减少。",
    want: 3,
  },
  {
    name: "右书名号属于前一句",
    text: "《城市绿化条例》已实施十年。多地将其视为景观点缀。这值得商榷。",
    want: 3,
  },
  {
    name: "分号故意不切",
    text: "绿地可以降温；可以滞洪；也可以改善心情。但一座公园补不回数十年的以车为本。",
    want: 2,
  },
  {
    name: "省略号算一处",
    text: "他们承诺补种一千棵树……十年后无人浇水。市民注意到了。",
    want: 3,
  },
  {
    name: "连续句末点号算一处",
    text: "这真的是效果吗？是的！数据也支持。",
    want: 3,
  },
  {
    name: "数字与英文缩写混排",
    text: "2020 年 U.S. 的研究覆盖了 3.5 亿人。结论后来被推翻。",
    want: 2,
  },
];

for (const group of [
  { direction: "en2zh", cases: EN },
  { direction: "zh2en", cases: ZH },
]) {
  console.log(`\n== ${group.direction} ==`);
  for (const testCase of group.cases) {
    const out = segmentText(testCase.text, group.direction);
    check(`${testCase.name} → ${testCase.want} 段`, out.length, testCase.want);

    // 字符多重集合相等：一次同时抓住「丢字」和「重复切」两类事故。
    const keep = (s) => Array.from(s.replace(/\s/g, "")).sort().join("");
    check(`${testCase.name} 字符不丢不重`, keep(out.join("")) === keep(testCase.text), true);

    // 确定性：同输入两次切法必须完全一致。
    check(`${testCase.name} 可重现`, JSON.stringify(out) === JSON.stringify(segmentText(testCase.text, group.direction)), true);
  }
}

console.log("\n== 边界 ==");
check("空文本", segmentText("   \n  ", "en2zh"), []);
check("无句末点号仍出一段", segmentText("A single unfinished clause", "en2zh"), [
  "A single unfinished clause",
]);
check("段数上限", segmentText("One. ".repeat(MAX_SEGMENTS + 50), "en2zh").length, MAX_SEGMENTS);
check(
  "换行不产生空段",
  segmentText("First line.\nSecond line.\n\nThird.\n", "en2zh").length,
  3,
);

// 内置材料也必须过同一把尺子：如果断句器和预置句段对不上，说明材料本身写错了，
// 或者断句器改版后把某篇材料的分数分配悄悄改掉了。
console.log("\n== 内置材料与断句器一致 ==");
const { MATERIALS } = await import("../src/data/materials.ts");
const keep = (value) => Array.from(value.replace(/\s/g, "")).sort().join("");

for (const material of MATERIALS) {
  const cut = segmentText(material.sourceText, material.direction);
  const preset = material.sentences.map((sentence) => sentence.source);
  check(`${material.title} 句段数量一致`, cut.length, preset.length);
  check(`${material.title} 逐句文字一致`, cut.join("\u0001"), preset.join("\u0001"));
  check(`${material.title} 原文字符不丢不重`, keep(cut.join("")) === keep(material.sourceText), true);
  const withRef = material.sentences.filter((sentence) => Boolean(sentence.reference)).length;
  check(
    `${material.title} 参考译文整篇有或整篇无`,
    withRef === 0 || withRef === material.sentences.length,
    true,
  );
}

console.log(failures === 0 ? "\n全部通过" : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
