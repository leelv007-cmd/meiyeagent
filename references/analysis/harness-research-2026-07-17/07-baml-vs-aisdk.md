# BAML vs Vercel AI SDK `generateObject` — 五段式 Harness ①意图正名 / ③Brief 编译 结构化节点选型

> **交叉验证裁定（Codex，2026-07-17）：成立但需修正（方向 (b) 成立；BAML 发布物内 Apache/MIT 许可冲突未解；generateObject 已 deprecated；92%/97% 阈值无证据链、降为提案）** — 全文见 `xcheck/r07-xcheck.md`；引用本报告断言前先对照裁定。

> 调研日期：2026-07-17
> 调研员：候选组件深度调研（harness-baml）
> 结论口径：`[官方核实]` = 有源码/官方文档/registry 直接佐证；`[推断]` = 基于机制与已知事实的推理，未直接证实。
> 本地镜像：`references/repos/harness-2026-07-17/baml/`（depth-1，BoundaryML/baml，克隆于 2026-07-17）
> AI SDK 源码核实：GitHub `vercel/ai@main`（raw + gh api）
> 决策背景：美业本地商家内容营销 Agent SaaS；TS 全栈 Next.js + Vercel AI SDK（对话层 token 流式，既定不动）+ PostgreSQL；模型混用含火山方舟/豆包等**中国 OpenAI 兼容端点（硬要求）**；①意图正名=模糊输入→意图 schema；③Brief 编译=六维上下文→复杂嵌套创作 Brief。两节点均**非流式**、要求**高 schema 命中率 + 可迭代性**。

---

## 一句话结论

**建议 (b)：AI SDK 起步、命中率跌破阈值再上 BAML。** 两个节点是 BAML 的绝对甜区，但项目处于验证期（栈已锁、护栏须≈0 成本），而 AI SDK 已在栈内、这两个节点被封在独立函数边界后**日后换 BAML 的切换成本极低**。因此正确姿势是先用 AI SDK 的 `generateObject` / `Output.object` 打底并**埋点测命中率**，对目标中国模型的 ③Brief 编译首过校验率 < ~92% 或 ①意图 < ~97% 时触发迁移。BAML 的最大价值恰在弱模型上（见 §3 benchmark），而中国模型 + 复杂嵌套 schema 正是它最可能跑赢原生 JSON 模式的场景——所以这不是"要不要用"，而是"何时用"。

---

## 1. 版本 / 许可 / 公司健康度 / 采用信号

### 版本 [官方核实]
BAML 现在有**两条并行产品线**，别混淆：

| 线 | 包 / 位置 | 最新版本 | 日期 | 定位 |
|---|---|---|---|---|
| 经典 BAML（结构化输出 DSL + 生成客户端）| npm `@boundaryml/baml` | **0.223.0** | 2026-06-24 | **本次选型的相关产物** |
| 经典 BAML（Python 绑定）| pypi `baml-py` | 0.223.0 | 与 npm 同步 | — |
| BAML Language（"面向 agent 的编程语言" + VM）| GitHub `baml_language/` 目录 | 0.15.1-nightly.20260716 | 2026-07-16 | 新兴，含 `baml-vm`/`boundary-udf`，是公司未来押注 |

- npm 版本时间线（`registry.npmjs.org`）：0.217(01-12) → 0.218(01-22) → 0.219(02-12) → 0.220(03-11) → 0.221(04-15) → 0.222(04-27) → **0.223(06-24)**。**约月度 minor 节奏**，叠加 GitHub 每日 nightly。GitHub 累计 **560 个 release**——发布极活跃。
- 核心引擎 **Rust 67%**（`engine/` 下 `baml-runtime`/`baml-compiler`/`baml-vm`/`baml-schema-wasm`），TS/BAML 为壳。

### 许可 [官方核实 + 一处不一致]
- 仓库 `LICENSE` 实体文件 = **Apache License 2.0**（权威，以此为准）。
- npm registry `license` 元数据字段却标 **MIT**；pypi 标 `None`。属元数据不一致，非法律问题。
- 结论：**宽松开源（Apache-2.0），无采用/商用障碍。** 可自托管，不锁云。

### 公司健康度
- [官方核实] 公司 = **Boundary（BoundaryML）**，**YC W23**，西雅图；CEO/联创 **Vaibhav Gupta**（YC 页面 + LinkedIn + 官网 who-are-we 佐证）。README 明写"HQ in Seattle, hiring Rust engineers"。
- [推断/第三方] GetLatka 估算 **~$330K 营收、约 3 人团队、疑似 bootstrap 无大额 VC**（第三方数据，非官方，仅作量级参考）。Web 搜 "Boundary 融资" 命中的 $2M pre-seed 是**同名 crypto 公司 Boundary Labs，非本公司**——注意别张冠李戴。
- **风险信号**：团队小（bus factor 高）、无公开大额融资；且公司正把叙事从"结构化输出 DSL"扩展到"agent 编程语言 + VM"，**存在核心 DSL 关注度被稀释 / 战略漂移的风险**。对我们只用 ①③ 两个稳定结构化点而言，风险可控（用的是最成熟、迭代 2 年的那条线），但需知悉。

### 采用信号 [官方核实]
- GitHub **8.6k star / 451 fork / 31 watch**。
- 多语言官方客户端：Python / TypeScript / Go / Ruby(beta) / REST-OpenAPI（`engine/language_client_*`）。
- 一等 IDE 支持：VSCode 扩展 + JetBrains 插件 + Zed（`jetbrains/`、`engine/zed/`）。
- 生态成熟度中上：不是玩具，但也非 LangChain 级大盘。

---

## 2. 机制核实 [官方核实，除标注外]

### 2.1 Schema-Aligned Parsing（SAP）原理
- 官方文档（`fern/01-guide/why-baml.mdx`、`09-comparisons/ai-sdk.mdx`）确认 SAP = **两段式**：
  1. **prompt 端注入 schema**：`.baml` 里的 `class`/`enum` 类型经编译器转成紧凑的 `{{ ctx.output_format }}` 描述塞进 prompt（比 JSON Schema 省 token），且 **enum 值可挂 `@description`**（"junior @description('0-2 years')"），把分类语义直接喂给模型——这是 Zod enum 做不到的。
  2. **输出端容错解析**：用编译器生成的**宽容解析器替代 `JSON.parse`**，容忍缺引号、尾逗号、缺右括号、markdown 包裹、字段乱序、甚至流式半截 JSON，而不是硬报错。
- 关键属性：**模型无关**，不依赖端点原生 function calling / JSON mode / json_schema。任何 chat completions 端点都能用。→ **这正是中国模型（火山方舟/豆包，原生结构化输出支持参差）场景下 BAML 对 AI SDK 的核心杠杆。**

### 2.2 TS codegen（`baml_client`）产物质量
- `baml-cli generate` 读 `.baml` 生成 `baml_client/`：**完全类型化**的函数（`b.ExtractResume(text)` 返回值 TS 已知是 `Resume`，enum 是联合类型）。
- generator 目标（`fern/03-reference/generator.mdx`）：`output_type "typescript"`（async/sync 均生成）或 `"typescript/react"`（**Next.js/React 一等**，产 hooks）；`module_format "esm"|"cjs"`；`on_generate "prettier . --write"` 生成后自动格式化。
- [官方核实] 运行时 `@boundaryml/baml` = **napi-rs 原生 Node addon**（`engine/language_client_typescript/package.json` 的 `napi.targets` 覆盖 darwin/linux-gnu/linux-musl/windows × arm64/x64 预编译二进制）。**部署含义见 §4——能上 Node serverless/容器，不能上 Edge/Cloudflare Workers。**

### 2.3 Streaming partial types
- `fern/01-guide/04-baml-basics/streaming.mdx`：生成 `partial_types` 模块，**所有字段转 nullable**，`b.stream.ExtractReceiptInfo()` 逐 token 产出语义合法的半成品对象（"semantic streaming"），末尾 `getFinalResponse()` 拿完整校验后的原类型。含 FastAPI / Next.js 流式示例。
- **对本项目**：①③ 是非流式节点，用不到；但说明 BAML 若日后接手对话层某些结构化流式子任务也 hold 得住（非当前范围）。

### 2.4 VSCode playground 测试面
- `ai-sdk.mdx`/`why-baml.mdx` 确认：VSCode 扩展可**不发 API 调用**测 prompt、**看到实际发送的完整 prompt + token 用量**、存测试用例做回归、code lens 一键跑。→ **对开发团队迭代 ①③ 两处 prompt 是实打实的生产力资产**（尤其 ③Brief 编译这种复杂 schema 需反复调）。

### 2.5 Provider 配置 —— 中国模型（火山方舟/豆包）[官方核实，端点能力待实测]
- **静态配置**：`provider "openai-generic"` 支持 `base_url` + `api_key`（→ `Authorization: Bearer`）+ 自定义 `headers`（`fern/03-reference/baml/clients/providers/openai-generic.mdx`；`integ-tests/baml_src/clients.baml` 有 TogetherAI / Gemini 走 openai-generic 的实例）。
  ```baml
  client<llm> Doubao {
    provider "openai-generic"
    options {
      base_url "https://ark.cn-beijing.volces.com/api/v3"   // 火山方舟
      api_key env.ARK_API_KEY
      model "<endpoint-or-model-id>"
    }
  }
  ```
- **运行时/多租户动态配置**：`ClientRegistry`（`fern/01-guide/05-baml-advanced/client-registry.mdx`）——TS 里 `cr.addLlmClient('name','openai-generic',{base_url,api_key,model})` + `cr.setPrimary(...)`，按调用传 `{ clientRegistry: cr }`。→ 多商家/多密钥场景可动态注入。
- **重试/fallback**：`retry_policy`（`max_retries` + `constant_delay`/`exponential_backoff`）；`provider "baml-fallback"`（按 strategy 列表降级）；`provider "baml-round-robin"`（负载轮询）。均声明式内建。
- [推断，须实测] 火山方舟/豆包是 OpenAI 兼容端点，openai-generic 走 chat/completions **一定通**；但**它们对 `response_format`/`json_schema` 的原生结构化支持要真实账号实测**。好消息：BAML 的 SAP **不依赖**端点原生结构化——即便豆包只吐纯文本，SAP 靠 prompt 注入 + 容错解析也能拿到结构化，这是它的立身之本。

---

## 3. 结构化命中率证据 [官方 benchmark，但数据偏旧]

来源：BAML 官方博客 `boundaryml.com/blog/schema-aligned-parsing`（BFCL，n=1000/模型）。

| 模型 | 原生 Function Calling | Python AST Parser | **SAP** | SAP 提升 |
|---|---|---|---|---|
| gpt-3.5-turbo | 87.5% | 75.8% | **92%** | +4.5pp |
| gpt-4o | 87.4% | 82.1% | **93%** | +5.6pp |
| claude-3-5-sonnet | 78.1% | 93.8% | **94.4%** | +16.3pp |
| **claude-3-haiku（弱）** | 57.3% | 82.6% | **91.7%** | **+34.4pp** |
| **gpt-4o-mini（弱）** | 19.8% | 51.8% | **92.4%** | **+72.6pp** |
| **llama-3.1 7b（开源弱）** | — | 60.9% | **76.8%** | 显著 |

配套主张（`boundaryml.com/blog/sota-function-calling`）：SAP **每个模型都拿到 BFCL SOTA**；比 OpenAI FC-strict **快 2–4x**、更省（输出不带 schema、不必每次重发）、更准；**模型无关，开源模型也能用**。

**读法与校准**：
- **核心信号成立**：SAP 提升幅度**与模型强弱强负相关**——顶级模型 +4~6pp，弱模型 +34~73pp。**这直接映射到本项目"可能用中国模型跑 ①③"的场景**：越是原生结构化能力弱的端点，SAP 的杠杆越大。
- **⚠️ 数据旧**：博客约 2 年前（2024），模型是 gpt-3.5 / gpt-4o-mini / claude-3-haiku 这代；**没有豆包/通义/GLM 等中国模型的直接数据**。今天的中国主力模型结构化能力已比 2024 的 gpt-4o-mini 强得多，SAP 的边际增益**大概率没有博客里 +72pp 那么夸张**。
- **⚠️ 厂商自测**：单一来源、有利益倾向；缺独立第三方复现。BFCL 本身是 Berkeley 公开榜（`gorilla.cs.berkeley.edu/leaderboard.html`），但表中数字是 BAML 自跑的。
- **净结论**：SAP 在弱模型上的机制性优势可信且方向正确，但**具体到我们的中国模型 + 我们的 schema，必须自测**（见 §7 阈值法）。

---

## 4. 工程成本 [官方核实]

| 维度 | 现状 |
|---|---|
| **构建链** | `npm i @boundaryml/baml` → 写 `.baml` → 跑 `baml-cli generate`（或 VSCode 存盘自动生成）→ 产 `baml_client/`。CI 里加一步 generate 即可，**无需 Rust/wasm 工具链**（runtime 是预编译 napi 二进制）。`on_generate` 可挂 prettier。 |
| **运行时形态** | **napi-rs 原生 Node addon**（预编译多平台二进制）。✅ Vercel **Node** Functions / AWS Lambda（架构匹配）/ 容器 / 长驻 Node 服务。❌ **Vercel Edge Runtime / Cloudflare Workers（不支持原生 addon）**。 |
| **本项目部署契合** | 记忆里架构 = "Cloudflare Workers 壳 + 单 Node 服务 + 托管 PG"。①③ 是后端非流式调用 → **落在 Node 服务层，与 napi 兼容**；只要**不把 BAML 塞进 CF Workers 边缘壳**即可。这是硬约束但当前架构本就满足。 |
| **开发体验** | `.baml` 语言 + `.ts` 双语言代码库；`.baml` 学习成本官方称 "< 10 分钟"（语法像 TS）。最佳 DX 依赖 VSCode 扩展（playground / code lens / 语法高亮）。 |
| **团队学习成本** | 低-中：结构化点封装干净，工程师上手快；但团队要接受"再多一门 DSL + 一套生成物 + 一个原生依赖"。 |

---

## 5. 与 AI SDK 并存边界 [部分官方核实，部分推断]

设定：BAML 只管 ①③ 两个非流式结构化点；AI SDK 管对话层 token 流式。

| 维度 | 顺不顺 | 说明 |
|---|---|---|
| **职责切分** | ✅ 干净 | 两个 BAML 函数是独立后端节点，与对话流式物理隔离，接口边界清晰。官方 ai-sdk.mdx 自己也定位"AI SDK 擅长 Next.js 流式，BAML 擅长生产级结构化抽取"——**两者是互补而非竞争**。 |
| **两套 provider 配置** | ⚠️ 有重复 | 火山方舟/豆包要在 **两处**各配一遍：AI SDK 侧 `@ai-sdk/openai-compatible`（baseURL），BAML 侧 `clients.baml` 的 openai-generic。密钥/base_url 需同步维护（可抽到共享 env）。 |
| **两套重试** | ⚠️ 各管各 | AI SDK 用 `maxRetries`；BAML 用 `retry_policy`。语义不冲突但需分别调参。 |
| **可观测性统一** | ❌ **最大摩擦点** | **BAML 无原生 OpenTelemetry/OTLP 导出**（全仓 grep 无 otel/otlp 实现）。它的观测 = (a) 自家 **Boundary Studio**（专有 SaaS，`BOUNDARY_API_KEY`，自动 trace，但数据进它家云）+ (b) 编程式 **`Collector`**（0.79.0 起，给你 raw HTTP 请求/响应 + usage + timing）。**要统一进 Langfuse/OTel，得手写胶水**：用 `Collector` 取原始 span，再手动喂 Langfuse SDK。反观 AI SDK 有原生 `experimental_telemetry`（OTel）。→ **统一观测需为 BAML 侧写适配层，这是引入 BAML 的隐性成本，须计入。** |

**净评**：功能边界顺，配置有可控的重复；**观测统一是真成本**——若项目把 Langfuse 当护栏基建（记忆里 harness-langfuse 是并行 workstream），BAML 侧需额外 Collector→Langfuse bridge。

---

## 6. AI SDK baseline 核实 [官方核实，源码级]

别拿旧印象——现场核了 `vercel/ai@main` 源码与文档：

- **版本**：npm `ai` **最新 stable 7.0.31（2026-07-17）**，同时维护 5.x / 6.x 分支。已到 v7 世代。
- **API 现状**：当前官方结构化数据指南（`content/docs/03-ai-sdk-core/10-generating-structured-data.mdx`）**已主推 `generateText`/`streamText` + `output: Output.object()/array()/enum()/json()`**；`generateObject`/`streamObject` **仍保留可用**（`packages/ai/src/generate-object/` 仍在），非废弃。
- **`generateObject` 真实签名**（源码 `generate-object.ts`）：
  - `output`: `'object' | 'array' | 'enum' | 'no-schema'`
  - `schema` / `schemaName` / `schemaDescription` / `enum`
  - `maxRetries`（**默认 2**）
  - **`experimental_repairText`**：`(options: { text, error }) => Promise<string | null>` ——**是"你自己写的修复函数"**（源码 `repair-text.ts`），SDK 不内建智能容错。
  - **⚠️ 已无 `mode: 'auto'|'json'|'tool'` 参数**（旧版 v3/v4 有，现签名 grep 不到；现由 `output-strategy.ts` 内部自动选策略）。
- **底层机制**（`inject-json-instruction.ts` + `output-strategy.ts`）：端点支持原生结构化（`response_format`/tool）就用；否则退化为 **prompt 注入 JSON 指令 → 严格 `JSON.parse` → zod 校验 → 失败重试（≤2）→ 可选调你的 `repairText`**。
- **失败**：抛 **`NoObjectGeneratedError`**（保留 text/response/usage/cause）。
- **中国 OpenAI 兼容端点**：走 `@ai-sdk/openai-compatible`（自定义 baseURL）。结构化质量**取决于端点是否原生支持 `response_format`/`json_schema`**：支持则质量高；**不支持则退回严格 JSON.parse 路径——弱模型上易碎，且"容错"要你自己在 `experimental_repairText` 里手写**。

**baseline 到底多弱？**——**没有旧印象里那么弱**：有重试、有 repair 钩子、有 `Output` 统一 API、v7 成熟。**但**：它的容错解析智能与 prompt-schema 格式优化**要你自己造**（`experimental_repairText` 只是个空钩子）；而 BAML 把 SAP（容错解析器 + 省 token 的 schema 格式 + enum 描述）**开箱内建**。差距不在"能不能做结构化"，而在**"命中率地板 + 弱模型鲁棒性 + 迭代工具链"**。

---

## 7. 结论与理由

### 选 **(b)：AI SDK 起步，命中率跌破阈值再上 BAML**

**理由链**：
1. **项目阶段决定**：记忆里的项目原则明确——验证期用最快栈、护栏须≈0 成本、约束绑生效触发点。AI SDK 已在栈内、零新增基建；BAML 不是 0 成本（napi 原生依赖 + 新 DSL + 观测胶水 + 两套 provider 配置）。验证期不该先付这笔。
2. **切换成本低 → 起步风险低**：①③ 封在**独立非流式函数边界**后，日后把某个函数的实现从 AI SDK 换成 BAML 是**局部替换**（改一个模块，不动对话层、不动 UI）。所以"先 AI SDK"几乎无锁定风险——这正是支持 (b) 而非 (a) 的关键。
3. **BAML 的价值在弱模型上最大（§3）**，而我们是否真用弱中国模型跑 ①③、豆包/方舟对 `json_schema` 的原生支持到底多好，**都得实测才知道**。未测先上专用层 = 过早优化。
4. **但要预置触发点**（不能"以后再说"）：

**建议阈值与测量法**：
- 建一个 **50–100 条真实输入的标注 eval 集**（覆盖模糊表达、方言、缺字段等边角），分别测 ①意图正名、③Brief 编译。
- 埋点指标（在 AI SDK 调用外层记录）：
  - **首过 schema 校验率** = zod 校验一次通过、**未触发 repair/retry** 的比例。
  - repair 调用率、retry 触发率、`NoObjectGeneratedError` 率。
  - ③ 额外测 **嵌套字段完整率**（复杂 Brief 的必填子字段被正确填充的比例）。
- **触发迁移到 BAML 的阈值**（在**目标中国模型**上测，非 GPT/Claude）：
  - ③Brief 编译**首过校验率 < ~92%**，或嵌套字段完整率 < ~90%；
  - **或** ①意图正名首过校验率 < ~97%；
  - **或** 需要在 `experimental_repairText` 里手写的容错逻辑开始变复杂/难维护（这本身就是"该上 SAP"的信号）。
- 命中阈值就把该节点切到 BAML（openai-generic 指同一端点，SAP 接管解析），仅迁触发的那个节点，保持另一个在 AI SDK。

**何时反过来直接选 (a)**：若立项即锁定"①③ 长期跑较弱的中国模型" **且** 开发团队把"VSCode playground 驱动的 prompt 快速迭代"当作 ③Brief 编译的核心工作流（复杂 schema 要天天调），则起步即上 BAML 更省事——但当前信息（栈刚锁、验证优先、模型混用未定死）不支持这么早下注。

**(c) 不需要 BAML —— 不推荐**：会等于赌"中国模型原生结构化足够好 + 我们愿意长期自己维护 repair 逻辑"，把 §3 那条"弱模型 +34~73pp"的机制性红利拱手让掉，且没有退路预案。

---

## 来源 URL（全部）

**本地镜像（BoundaryML/baml，2026-07-17 depth-1 克隆）**
- `references/repos/harness-2026-07-17/baml/README.md`
- `.../fern/01-guide/why-baml.mdx`（SAP 原理）
- `.../fern/01-guide/09-comparisons/ai-sdk.mdx`（官方 BAML vs AI SDK 对比）
- `.../fern/01-guide/04-baml-basics/streaming.mdx`（partial_types 语义流式）
- `.../fern/01-guide/07-observability/studio.mdx`（Boundary Studio）
- `.../fern/03-reference/generator.mdx`（typescript / typescript-react 生成目标）
- `.../fern/03-reference/baml/clients/providers/openai-generic.mdx`（base_url/api_key/headers）
- `.../fern/03-reference/baml/clients/strategy/retry.mdx`（retry_policy）
- `.../fern/01-guide/05-baml-advanced/client-registry.mdx`（运行时动态 provider）
- `.../fern/03-reference/baml_client/collector.mdx`（Collector，0.79.0）
- `.../integ-tests/baml_src/clients.baml`（openai-generic / fallback / round-robin 实例）
- `.../engine/language_client_typescript/package.json`（napi 原生 targets）
- `.../LICENSE`（Apache-2.0）

**Registry / 官方站**
- https://registry.npmjs.org/@boundaryml/baml （0.223.0 / 2026-06-24 / license 字段=MIT）
- https://pypi.org/pypi/baml-py/json （0.223.0）
- https://github.com/BoundaryML/baml （8.6k star / 560 release / Rust 67% / Apache-2.0）
- https://www.boundaryml.com/ ，https://docs.boundaryml.com

**Benchmark（官方博客，约 2024）**
- https://boundaryml.com/blog/schema-aligned-parsing （BFCL SAP vs FC vs JSON mode 表）
- https://boundaryml.com/blog/sota-function-calling （2-4x 更快 / 更省 / 模型无关）
- https://gorilla.cs.berkeley.edu/leaderboard.html （BFCL 榜本体）

**公司**
- https://www.ycombinator.com/companies/boundary （YC W23）
- https://theorg.com/org/boundary-yc-w23/org-chart/vaibhav-gupta （CEO Vaibhav Gupta，YC W23）
- https://getlatka.com/companies/boundaryml.com （第三方营收/团队估算，仅参考）

**AI SDK baseline（vercel/ai@main 源码 + 文档 + registry）**
- https://registry.npmjs.org/ai （ai 7.0.31 / 2026-07-17；6.x/5.x 并存）
- https://raw.githubusercontent.com/vercel/ai/main/packages/ai/src/generate-object/generate-object.ts （output/schema/maxRetries/experimental_repairText；无 mode）
- https://raw.githubusercontent.com/vercel/ai/main/packages/ai/src/generate-object/repair-text.ts （RepairTextFunction 类型）
- https://raw.githubusercontent.com/vercel/ai/main/packages/ai/src/generate-object/{inject-json-instruction,output-strategy}.ts
- https://raw.githubusercontent.com/vercel/ai/main/content/docs/03-ai-sdk-core/10-generating-structured-data.mdx （现主推 Output.object；NoObjectGeneratedError）
- https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data
