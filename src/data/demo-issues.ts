import type { Issue, LearningItem } from "../types";

/**
 * 下面三份示例数据是按这篇内置材料的句子编号与中文译文写死的。
 * 换一篇材料（自建或汉译英）仍然展示它们，就等于把不相干的假分析
 * 冒充成对用户文本的评估，因此练习页只在 materials[DEMO_MATERIAL_ID] 上开放示例入口。
 */
export const DEMO_MATERIAL_ID = "urban-green";

export const DEMO_ISSUES: Issue[] = [
  {
    sentenceIndex: 0,
    category: "mistranslation",
    severity: "severe",
    quote: "只是让它们变得更美丽",
    problem:
      "原文为 not simply …（不仅仅是），译文“只是”把否定含义译反，句子核心论点丢失。",
    suggestion: "改为“并不只是让市容更美”，并保留后半句的递进关系。",
  },
  {
    sentenceIndex: 0,
    category: "wording",
    severity: "moderate",
    quote: "重新连接",
    problem: "rewire 在此为比喻用法，指从根本上改变机制，而非物理上的重新接线。",
    suggestion: "改用“重塑”“改变……的方式”。",
  },
  {
    sentenceIndex: 0,
    category: "grammar",
    severity: "moderate",
    quote: "居民移动、呼吸和思考",
    problem: "how residents move, breathe and think 是宾语从句，译文缺少中心词“的方式”，句子不完整。",
    suggestion: "补出中心词：“居民出行、呼吸乃至思考的方式”。",
  },
  {
    sentenceIndex: 1,
    category: "omission",
    severity: "moderate",
    quote: "把接触绿地",
    problem: "easy access 中的 easy（便捷的）未译，导致结论的适用范围被扩大。",
    suggestion: "译为“便捷接触绿地”或“易于到达的绿地”。",
  },
  {
    sentenceIndex: 1,
    category: "omission",
    severity: "light",
    quote: "焦虑症下降",
    problem: "measurable（可衡量的/显著的）漏译，削弱了研究结论的力度。",
    suggestion: "补为“焦虑症发病率的显著下降”。",
  },
  {
    sentenceIndex: 2,
    category: "mistranslation",
    severity: "moderate",
    quote: "最买不起",
    problem:
      "afford to 此处强调“有条件、腾得出时间金钱”，不限于购买力；“买不起”把社会经济学论断窄化成了消费问题。",
    suggestion: "改为“最无力……的人”。",
  },
  {
    sentenceIndex: 3,
    category: "logic",
    severity: "severe",
    quote: "因此一座公园",
    problem:
      "Yet 表转折（然而），与上文构成让步关系；译为“因此”把逻辑方向改成了因果，全段论证关系被颠倒。",
    suggestion: "改为“然而，仅靠一座公园……”。",
  },
  {
    sentenceIndex: 4,
    category: "omission",
    severity: "severe",
    quote: "把植树当作装饰的部门",
    problem: "rather than infrastructure 整个对比结构漏译，原文的批评对象因此变得模糊。",
    suggestion: "补全“……而非基础设施”。",
  },
  {
    sentenceIndex: 4,
    category: "grammar",
    severity: "moderate",
    quote: "维护更少的时间",
    problem: "动宾搭配不当，中文不说“维护时间少”，且与前分句结构不对称。",
    suggestion: "改为“养护周期也更短”。",
  },
  {
    sentenceIndex: 5,
    category: "wording",
    severity: "light",
    quote: "替换",
    problem: "replacement 指树木死亡后的补种，属园林行业用语；“替换”偏机械，语域不符。",
    suggestion: "改为“补种”。",
  },
];

/**
 * 演示用「值得学习」清单，与 DEMO_ISSUES 配套，来源是上面那篇内置示例材料的英文原文。
 * 学的对象一律是英文表达；note 只用中文说明什么时候这么用。
 * 内置示例与真实模型输出都在这里标注为未经人工审定，不对应任何官方参考表达集。
 */
export const DEMO_EXPRESSIONS: LearningItem[] = [
  {
    item: "rewire how residents move, breathe and think",
    note: "rewire 本义是重新接线，这里比喻从根本上改变机制；中文可译“重塑……的方式”，不要直译成“重新连接”。",
  },
  {
    item: "treat X as decoration rather than infrastructure",
    note: "“把 X 当作点缀而非基础设施”，是评论文章里批评短视决策的常用句型，rather than 前后必须对称。",
  },
  {
    item: "offset decades of car-first planning",
    note: "offset 表示“抵消”，后面接被抵消的负面积累；car-first 是“以车为本”的构词方式，可类比 family-first、profit-first。",
  },
  {
    item: "costs that rarely appear in an election year",
    note: "“很少出现在选举年的开支”，用 in an election year 暗指只愿做有选票回报的事；中文需要补出“选举年”的言外之意。",
  },
];

export const DEMO_VOCABULARY: LearningItem[] = [
  {
    item: "easy access to green space",
    note: "“便捷地到达绿地”，access 前用形容词说明可达性；漏译 easy 会把结论适用范围放大。",
  },
  {
    item: "anxiety disorders",
    note: "焦虑症，公共卫生文本里的固定搭配，用 disorder 而非 illness。",
  },
  {
    item: "pruning / watering / replacement",
    note: "园林养护三件事：修剪、浇水、补种；replacement 在此专指死树后的补种。",
  },
];
