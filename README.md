# TransLab

英语笔译自助训练与评估工具。面向 CATTI 笔译的两个方向（英译汉、汉译英），逐句定位误译、漏译、用词不当、语法问题与逻辑问题，给出修改建议、批改总结与值得积累的英文表达和词汇。可粘贴自己的文章自动断句成练习材料，也可上传 Word 文档整篇批改；材料与练习结果只保存在本机浏览器。

## 技术栈

- 前端：React 19 + TypeScript + Vite 8 + Tailwind 4 + Shadcn UI
- 后端：Qoder Sites Edge Function（Deno），同源 `/functions/v1/app`
- 持久化：浏览器 `localStorage`（无数据库、无登录，见「诚实声明」）
- 部署：Qoder Sites（静态产物 + Function）
- 模型：默认通义千问 DashScope；任何 OpenAI 兼容端点（含 LM Studio / Ollama 本地模型）可凭三个环境变量替换，见「接入你自己的模型」

## 目录

```
translab/
├── functions/         # Edge Function（Deno）
│   ├── index.ts       # Deno 入口
│   ├── handler.ts     # 路由 + 调用 DashScope + 校验模型输出
│   ├── prompt.ts      # 按方向构造阅卷 prompt，强制 JSON 输出
│   ├── scoring.ts     # 评分引擎（与 src/lib/scoring.ts 同一套逻辑）
│   └── rubric.ts      # Function 侧评分表副本，由 check-rubric 保证与前端一致
├── dev/
│   └── function-local.ts  # 本地跑 Function 的 Deno 入口（127.0.0.1:8000）
├── scripts/
│   ├── check-rubric.mjs   # 两份评分表必须逐条相等
│   ├── check-segment.mjs  # 自动断句不丢字、不重字、可重现
│   ├── check-function.mjs # 请求体与模型输出解析的边界契约
│   ├── check-docx.mjs     # 浏览器端 .docx 解析
│   ├── check-docimport.mjs# 文档导入的判语言/配对规则
│   ├── check-docx-write.mjs # 练习记录导出 .docx 的生成与回读
│   └── check-draft.mjs    # 草稿自动存取的边界
├── src/
│   ├── data/          # 材料、评分表、示例分析（纯数据，可替换）
│   ├── lib/           # 评分引擎、断句、本机存储、路由、docx 读写、导出
│   ├── pages/         # Materials / NewMaterial / Practice / Docs / Results / Rubric / Provider
│   ├── components/    # 应用组件
│   ├── types.ts       # 前后端数据契约
│   └── App.tsx
├── index.html
├── package.json
└── .TransLab.qoder.site   # Qoder Sites 描述符（自动生成，勿手改）
```

## 本地开发

```bash
npm ci
npm run dev            # Vite 开发服务器，http://127.0.0.1:5173
npm run build          # 类型检查 + 七项离线契约检查 + 生产构建 → dist/
npm run check:contract # 只跑检查：断句 / Function 契约 / 评分表一致性
npm run preview        # 本地预览 dist/（注意：preview 不含 Function，提交评分会报错）
```

这些检查都是离线的，不联网、不消耗模型额度，且已挂进 `npm run build`：断句丢字、评分表漂移或 Function 契约破坏都会让构建失败，进不了上传产物。

Function 已在线上发布并实测调通，本地 Deno 检查不再是阻塞项（当前环境未安装 Deno）。本地若要用代理调试 Function，需另起兼容的 Function 服务：

```bash
npm run check:function
npm run dev:function
```

## 密钥约定

- 应用 Secret 名称：`DASHSCOPE_API_KEY`
- 值通过 Qoder Sites Settings 界面填写，**绝不粘贴到对话、代码或 `.env` 中**
- `.env.example` 只列变量名，不含真实值

## 接入你自己的模型

后端 Function 只依赖 OpenAI 兼容协议（`POST {BASE_URL}/chat/completions`），换服务商或改用本地模型不需要改代码，只需要三个环境变量：

| 变量 | 作用 | 取值 |
| --- | --- | --- |
| `DASHSCOPE_BASE_URL` | 模型服务地址 | 默认 `https://dashscope.aliyuncs.com/compatible-mode/v1`；LM Studio 填 `http://localhost:1234/v1`；Ollama 填 `http://localhost:11434/v1` |
| `DASHSCOPE_MODEL` | 模型名 | 默认 `qwen3.7-flash`；本地服务填你加载的模型名 |
| `DASHSCOPE_API_KEY` | 密钥 | 云端服务商必填；本地服务（LM Studio / Ollama）填任意非空值即可 |

本地跑一份完整实例（需要支持顶层 `Deno.serve` 与 `--env-file` 的 [Deno](https://deno.com)，作者实测版本 2.9.8 / macOS arm64）：

```bash
npm ci
cp .env.example .env   # 填入你自己的三行；.env 已在 .gitignore，勿提交
npm run dev:function   # 终端 1：Deno 起 Function，监听 127.0.0.1:8000
npm run dev            # 终端 2：Vite 起前端，打开 http://127.0.0.1:5173
```

Vite 会把 `/functions/v1/app` 代理到本地 Function（见 `vite.config.ts`），前端代码与线上部署完全一致。

把这三行指向本机的模型服务（LM Studio / Ollama），原文与译文就一步都不出这台电脑：界面本身没有任何外部资源（无 CDN、无字体外链），请求只走 `127.0.0.1`。评分结果里的 `provider` 显示实际主端点（例如 `127.0.0.1:1234`），不会把本地调用写成 `dashscope`。

也可以不碰环境变量：顶栏有「模型接入」页面，在界面里填地址 / 模型名 / API Key，打开开关保存即生效——配置只存在你这台浏览器里。此模式要求 Function 启动时带 `ALLOW_USER_PROVIDER=true`：

```bash
npm run dev:function:byo   # 等价于上一节命令 + ALLOW_USER_PROVIDER=true
```

向没开启该开关的部署发送自带配置，会得到 `provider_not_enabled` 报错——后端不会静默改用服务端密钥，你花的额度始终是你自己的。

注意：`enable_thinking: false`（关闭思考链提速）只在阿里云端点（dashscope / maas 域名）随请求发送，其他服务商收不到这个字段。评分逻辑与模型无关：模型只负责定位错误，分数一律由评分引擎按版本化评分表计算。

端点兼容性实测记录：LM Studio 跑 `gpt-oss-20b` 会拒绝 `response_format: {"type":"json_object"}`，后端在收到明确指向该字段的报错后会去掉它重发一次（作者本机 2 句批改约 38 秒通过）；连接不上、地址端口填错也会返回 `model_call_failed · connect: …`，而不是一个没有任何说明的 500。

## 开发进度

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| D1 | 静态可提交版：材料库 + 练习页 + 评分规则页 + 示例评估 | ✅ 完成 |
| D2 | Edge Function：切句 + 评分引擎 + DashScope 调用 | ✅ 完成（已发布） |
| D3 | 真实模型接入：`isMock` 切换为 false | ✅ 完成（线上实测调通） |
| D4 | 部署 + 公开访问 + 比赛发帖 | 部署与公开访问 ✅；发帖待办 |
| D5 | 双向（英译汉/汉译英）+ 自建材料 + 自动断句 + 学习清单 + 本机保存 | ✅ 完成，已发布并线上实测 |

线上实测记录（2026-11-24）：

- 自建汉译英材料，4 句，故意写错两处（「同比增长」译成 down、「不是短期内能完成」译成可以完成）→ 真实模型 84/100，逐句上限 25+25+25+25=100，两处误译均标为 severe 并定位到英文片段。
- 旧前端不带 `direction` 的请求仍按英译汉放行，返回 100/100，迁移期不炸线上。
- 「保存结果 → 刷新页面 → 练习记录 → 打开」回放出当时的译文、评分与学习清单。
- 内置汉译英材料「城市更新与老旧小区改造」真实评分：故意把「约九百万户」写成 90 million → 判 `mistranslation/severe`，得 `92/100`，逐句 50/42；批改总结给出「最需要先改第 2 句（扣 8 分）」，与评分表 5+3 分可复核。

## 诚实声明

- 评分表权重（`src/data/rubric.ts`）依据 CATTI 官方评分标准；前后端两份配置由契约测试保证逐条一致。
- 内置 4 篇材料（2 篇英译汉、2 篇汉译英）均**非 CATTI 真题**：前 3 篇为原创示例，带参考译文的 2 篇其译文由 AI 辅助生成、未经专业译审校核；`urban-regeneration` 不提供参考译文，用于演示"没有参考译文时界面如何说明"；`poverty-eradication` 由用户本人提供（出处未核实）。
- **批改总结由规则生成，不是模型评语**：先按错误类别计数，再按评分表算出每句扣分，指出扣分最多的 1–2 句，并按严重程度给一句取径。所有数字都能用评分表复核。
- `isMock = true` 时页面显示黄色横幅，说明该分数来自内置示例而非模型真实调用；示例入口只在配套材料上出现，避免把不相干的示例分析冒充成对用户文本的评估。
- 自动断句是确定性正则，不是模型切的：引号内的句号仍会切开（如 `He said: “No. Never.”` 会切成 4 段），练习页提供合并/拆句手工修正，且原始整篇文本始终保留。
- 自建材料默认没有人工审定参考译文，此时页面不提供对照，也不会让模型现造一份「参考译文」冒充标准答案。
- 「建议学习」的表达与词汇由模型生成，未经人工审定，条目一律以英文给出。
- 材料与练习结果只存本机浏览器 `localStorage`，不上传、不跨设备同步，清除浏览器数据即丢失。

## 比赛信息

- 天池赛题 ID：532536
- 赛道：StudyHack（学习科研）
- 报名与提交截止：2026-11-30 18:00
- 要求：Qoder Sites 公网可访问
