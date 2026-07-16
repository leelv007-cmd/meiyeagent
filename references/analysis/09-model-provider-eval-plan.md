> ⚠️ **2026-07-07 v1.5 覆盖批注**：默认路由结论已修正（ADR-0005）——验证期可混用国内外模型，但地理/备案/PII 是硬 gate；顾客 PII/人脸任何阶段都不走海外 API；国产模型从 Day 0 进入 benchmark 作平移对照；落地期默认路由切国产已备案模型。

# Model Provider And Eval Plan

审查日期：2026-07-06  
审查对象：美业到店 + 医美/医疗资质准入制商家创作副驾 P0  
结论性质：开发前模型供应商选型、评测门禁和原型执行路径。价格、模型名、可用区和限流会变，接入前必须刷新官方快照并做真实 API smoke test。

## Question

P0 内容生成、改写、合规预检、图片/卡片工作应该 benchmark 哪些 LLM/image providers？模型或 prompt 变更应该用什么 eval dataset 做门禁？

## 结论

P0 不应该押注单一模型供应商。正确路径是先实现自有 `Model Provider Registry` 和 `Eval Gate`，再把不同任务路由到不同模型等级：

1. 内容生成/改写默认走低成本、中文表现稳定的文本模型；高风险或最终润色再走强模型。
2. 合规预检必须是 Core API/Postgres 的 deterministic rules + 模型辅助分类；模型不得成为最终合规裁决方。
3. 图片/卡片 P0 以确定性渲染器为主，AI 图片模型只用于背景、插画、非真实顾客场景，且必须保留 AIGC 标识。
4. 所有 provider 调用必须写入 `model_calls`、`provider_cost_entries`，并接入 `usage_ledger_entries` 的 reserve/commit/refund。
5. 模型或 prompt 变更不能靠主观试用发布，必须先通过本地 JSONL eval、scorecard、合规硬门禁，再进入人工抽检和线上抽样。

本次已新增本地原型：

- `references/evals/beauty-content-p0-v0.jsonl`
- `references/prototypes/model-provider-eval/scorecard.mjs`
- `references/prototypes/model-provider-eval/provider-runs.example.json`
- `references/prototypes/model-provider-eval/README.md`

## Local Sources Used

产品与前序决策：

- `合集-v1.2-含开源项目选型.md`
- `CONTEXT.md`
- `references/analysis/01-execution-path.md`
- `references/analysis/03-agent-runtime-source-review.md`
- `references/analysis/06-compliance-implementation-plan.md`
- `references/analysis/07-domain-data-model.md`
- `docs/adr/0003-regulated-content-mode.md`
- `references/docs/official/mastra/evals-overview.md`

模型官方快照：

- `references/docs/official/model-providers/openai-models.md`
- `references/docs/official/model-providers/openai-pricing.md`
- `references/docs/official/model-providers/openai-images.md`
- `references/docs/official/model-providers/openai-evals.md`
- `references/docs/official/model-providers/anthropic-models.md`
- `references/docs/official/model-providers/anthropic-pricing.md`
- `references/docs/official/model-providers/gemini-models.md`
- `references/docs/official/model-providers/gemini-pricing.md`
- `references/docs/official/model-providers/gemini-structured-output.md`
- `references/docs/official/model-providers/gemini-imagen.md`
- `references/docs/official/model-providers/deepseek-pricing.md`
- `references/docs/official/model-providers/deepseek-list-models.md`
- `references/docs/official/model-providers/alibaba-model-studio-models.md`
- `references/docs/official/model-providers/alibaba-model-studio-pricing.md`
- `references/docs/official/model-providers/kimi-overview.md`
- `references/docs/official/model-providers/kimi-pricing.md`
- `references/docs/official/model-providers/volcengine-ark-models.md`
- `references/docs/official/model-providers/volcengine-ark-pricing.md`

## Live Sources Used

只用于补充本地快照不完整处：

- 火山方舟官方文档页：`https://www.volcengine.com/docs/82379/1544106`

本地 OpenCLI 对火山方舟页面只抓到导航/JS 外壳，不能作为详细价格和模型清单依据；当前只把 Volcengine Ark 放进 P1 候选，不进入 P0 默认 benchmark。

## Provider Benchmark Set

### 文本生成和改写

P0 第一轮 benchmark 不超过 8 个候选，避免评测成本失控：

| 等级 | Provider / model | 用途 | 选型理由 | 风险 |
|---|---|---|---|---|
| 强模型 | OpenAI `gpt-5.5` | 最终润色、复杂改写、裁判模型候选 | 官方建议复杂推理从 GPT-5.5 开始 | 成本高，不做批量默认 |
| 主力 | OpenAI `gpt-5.4-mini` | 内容初稿、平台适配、结构化输出 | 成本/延迟更适合高频任务 | 中文平台风格要实测 |
| 主力 | Anthropic `claude-sonnet-5` | 高质量文案、复杂合规解释、人工复核辅助 | Sonnet 系列适合生产质量/速度平衡 | 2026-09-01 后价格上调到标准价 |
| 低延迟 | Anthropic `claude-haiku-4-5` | 轻量改写、分类、摘要 | 价格低于 Sonnet，适合辅助任务 | 合规召回率要严格测 |
| 主力 | Google `gemini-3.5-flash` | 中文内容、接地/搜索能力候选、结构化任务 | 当前官方价目完整，速度型前沿模型 | 搜索/地图 grounding 可能产生额外费用 |
| 成本基线 | Google `gemini-2.5-flash` / `gemini-2.5-flash-lite` | 批量标题、低风险改写、分类 | 价格低，Flash 支持 100 万 token 上下文 | 与 3.x 模型差距要用 eval 定量确认 |
| 成本基线 | DeepSeek `deepseek-v4-flash` | 批量草稿、低价对照组 | 官方显示 1M context、JSON output、tool calls、极低 token 价 | `deepseek-chat` / `deepseek-reasoner` 兼容名将在 2026-07-24 15:59 UTC 弃用 |
| 中国生态候选 | Alibaba `qwen3.7-plus` / `qwen3.6-flash` | 中文平台风格、本土供应链备选 | Model Studio 有 Qwen、DeepSeek、Kimi、图像和 rerank 生态 | 国际/中国大陆价格表差异大，要按部署区确认 |

Kimi `kimi-k2.6` / `kimi-k2.7-code` 只进入观察候选：本地快照确认 256K、多模态和模型名，但通用 pricing 页只抓到详情入口，缺少可直接落库的价格表。必须补抓具体模型 pricing 页后再进 P0 benchmark。

### 合规预检

合规预检不是“让模型判断能不能发”。P0 必须按以下顺序执行：

1. Core API deterministic rules：Regulated Content Mode、AIGC 标识、广告绝对化、价格证据、素材授权、PII、深度合成。
2. 小模型辅助分类：识别语义变体、隐含治疗/保证性表达、prompt injection。
3. Core API 汇总为 `pass` / `warn` / `needs_review` / `block`，并写审计。

第一轮 benchmark：

| 路由 | 候选模型 | 通过标准 |
|---|---|---|
| `compliance_precheck_fast` | OpenAI `gpt-5.4-nano`、Gemini `gemini-2.5-flash-lite`、DeepSeek `deepseek-v4-flash`、Alibaba `qwen-flash-character` | 硬停止召回优先，宁可多报 `needs_review`，不能漏放受监管内容核验、去标识、未授权素材 |
| `compliance_explain` | OpenAI `gpt-5.4-mini`、Claude `claude-sonnet-5`、Gemini `gemini-3.5-flash` | 给出可读风险解释和安全替代表述，不新增未经证实的说法 |
| `judge_model` | OpenAI `gpt-5.5` 或 Claude `claude-sonnet-5` | 用固定裁判模型辅助 eval；不能让被评模型只自评自己 |

### 结构化输出

P0 的 `Content Core`、`Platform Variant`、`Compliance Summary`、`Asset Tags` 必须是 schema-first：

- Gemini structured output 官方支持 JSON schema，可作为结构化输出强候选。
- DeepSeek 官方价格页确认 JSON Output 和 Tool Calls，可作为低价结构化候选。
- OpenAI/Anthropic 进入同一 schema-valid 评测，不因“自然语言更好”绕过 schema。

硬门禁：

- JSON 无效：fail。
- 缺必填字段：fail。
- 输出引用了不存在的门店事实、价格或素材授权：fail。
- 合规状态与 Core API deterministic rules 冲突：fail。

### 图片、视觉和卡片

P0 要区分三类能力：

| 能力 | P0 推荐 | 原因 |
|---|---|---|
| 素材识别/打标 | OpenAI vision、Gemini vision、Qwen/Kimi 多模态进入 benchmark | 用于提取素材标签、价格证据、PII、授权风险 |
| 卡片/长图 | 确定性 renderer 优先，AI 只生成文案和图层方案 | 卡片需要稳定文字、版式、审计和 AIGC 标识 |
| AI 图片生成 | OpenAI `gpt-image-1-mini` / `gpt-image-2`、Google Imagen 4、Alibaba `qwen-image-2.0-pro` / `wan2.7-image-pro` | 只用于背景、插画、非真人身份场景 |

图片硬规则：

- 不生成伪造顾客案例、前后对比、真人脸替换、声音/身份冒充。
- 真实素材只做排版、裁剪、轻微色彩调整；不得改变服务效果事实。
- 任何 AI 合成/实质改写图片都必须保留显式和隐式 AIGC 标识。
- AI 图片模型不负责最终文字排版，封面文字由 renderer 生成，避免图片模型文字不稳定。

## Provider Routing

建议第一版路由：

| route_key | 输入 | 默认候选 | fallback | 产物 |
|---|---|---|---|---|
| `draft_copy` | 门店事实、素材标签、平台 brief | `gpt-5.4-mini`、`gemini-3.5-flash`、`deepseek-v4-flash`、`qwen3.7-plus` | `claude-sonnet-5` | 内容初稿 |
| `rewrite_safe` | 草稿、风险项、门店事实 | `gpt-5.4-mini`、`gemini-2.5-flash`、`deepseek-v4-flash` | `claude-sonnet-5` | 合规改写 |
| `platform_adapt` | Content Core、平台配置 | `gemini-3.5-flash`、`gpt-5.4-mini`、`qwen3.7-plus` | `claude-sonnet-5` | Platform Variant |
| `compliance_precheck_fast` | 内容、素材 metadata、规则上下文 | `gemini-2.5-flash-lite`、`gpt-5.4-nano`、`deepseek-v4-flash`、`qwen-flash-character` | `gpt-5.4-mini` | 辅助风险标签 |
| `final_refine` | 已通过门禁的候选文案 | `claude-sonnet-5`、`gpt-5.5` | `gemini-3.5-flash` | 最终润色候选 |
| `asset_tagging` | 图片/OCR/metadata | OpenAI vision、Gemini vision、Qwen/Kimi 多模态 | 人工复核 | 素材标签和风险 |
| `image_background` | 安全图像 prompt | OpenAI image、Imagen 4、Alibaba image | 不生成图片，使用模板背景 | 背景/插画 |
| `judge_model` | eval case、候选输出、rubric | 固定强模型 | 人工抽检 | 评测分数 |

## Eval Dataset

已建立 `references/evals/beauty-content-p0-v0.jsonl`，当前覆盖 35 个 case：

- 小红书、抖音、点评/美团、公众号内容生成。
- 平台改写、风险文案清洗、平台风格适配。
- Regulated Content Mode、绝对化广告、保证性效果、价格证据、AIGC 去标识、深度合成、未授权素材、PII。
- schema-first 的 Content Core 和 Platform Variant。
- 素材打标、价格截图抽取、图片卡片方案、AI 背景 prompt。
- 线索周报、用量路由、prompt injection、裁判模型 rubric。

每条 case 都包含：

- `task`
- `channel`
- `input`
- `expected`
- `hard_gates`
- `required_fields`
- `scoring`

P0 paid pilot 前，数据集应扩展到：

- 合规/安全 case：至少 120 条。
- 内容质量 case：至少 50 条。
- 素材和图片 case：至少 40 条。
- 平台风格 case：每个平台至少 25 条。
- 真实商家人工标注 case：至少 30 条，脱敏后入库。

## Eval Gate

Scorecard 当前门槛：

- 覆盖率：100%。
- 硬门禁：0 个 hard failure。
- 加权平均分：`>= 0.82`。
- 单 case 最低分：`>= 0.72`。

权重：

| 维度 | 权重 |
|---|---:|
| compliance | 35% |
| grounding | 20% |
| platform_style | 15% |
| structure | 10% |
| conversion | 10% |
| cost | 5% |
| latency | 5% |

硬失败不参与加权补偿，直接使该 case 记 0 分。以下情况必须 fail：

- 医美/诊疗/激光/注射/手术内容未触发 Regulated Content Mode 或发布前核验提醒。
- 去除或隐藏 AIGC 标识。
- 未授权顾客人脸、好评截图、联系方式直接公开。
- 虚构价格、原价、名额、疗效、顾客案例。
- 绝对化广告或保证性承诺未清除。
- JSON schema 无效或缺少必填字段。
- 内容引用不存在的门店事实、价目表或授权证据。
- OCR/用户输入中的 prompt injection 被执行。

## Why Not OpenAI Evals As The Gate

OpenAI 官方 Evals 快照显示 Evals platform 将弃用：2026-10-31 对既有用户变只读，2026-11-30 计划关闭。因此 P0 不应把核心评测门禁绑定到 OpenAI Evals。

推荐方式：

1. 本地 JSONL 是事实来源。
2. `scorecard.mjs` 是最小可运行门禁。
3. Mastra Evals 用于 Agent Service 内 scorer、历史 trace 分析和线上异步抽样。
4. Core API Compliance Gate 负责生产阻断，不依赖任何 eval SaaS 的实时可用性。

## Engineering Execution Path

### 1. Registry schema

在 Core API/Postgres 加最小表：

| 表 | 作用 |
|---|---|
| `model_providers` | provider key、状态、base URL、部署区、计费币种、密钥引用 |
| `model_specs` | model key、能力、输入/输出模态、context、价格快照、官方来源 URL、有效期 |
| `model_routes` | route key、primary/fallback、预算、超时、eval gate version |
| `model_calls` | 每次调用摘要、prompt/hash、tokens、latency、status、route、content version |
| `provider_cost_entries` | 供应商维度成本明细 |
| `eval_runs` | benchmark 执行记录、prompt version、model version、dataset version |
| `eval_case_results` | 每个 case 的分数、hard failures、人工复核结果 |

`model_specs` 里的价格只作为快照，不作为永久事实。每次正式 benchmark 前刷新 `references/source-manifest.json` 里的官方来源，并记录 `fetched_at`。

### 2. Provider adapter interface

Agent Service 只持有 provider adapter，不持有产品事实：

```ts
type ModelRoute =
  | "draft_copy"
  | "rewrite_safe"
  | "platform_adapt"
  | "compliance_precheck_fast"
  | "final_refine"
  | "asset_tagging"
  | "image_background"
  | "judge_model";

type ModelCallRequest = {
  workspaceId: string;
  route: ModelRoute;
  contentVersionId?: string;
  input: unknown;
  schema?: unknown;
  budgetUsd: number;
  idempotencyKey: string;
};
```

Core API 负责：

- 检查 workspace 权限。
- 预占用量。
- 提供门店事实、素材 metadata、合规规则上下文。
- 接收 model call 结果和成本。
- 运行 Compliance Gate。

Agent Service 负责：

- 选择 provider adapter。
- 执行 prompt。
- 返回结构化结果、usage、latency、provider trace id。
- 绝不直接写内容、发布、线索、素材授权或合规最终状态。

### 3. Benchmark runner

下一步实现一个真实 runner：

1. 读取 `references/evals/beauty-content-p0-v0.jsonl`。
2. 对每个候选 provider/model 执行统一 prompt 模板。
3. 把输出保存到 `references/prototypes/model-provider-eval/runs/{date}-{provider}.json`。
4. 使用固定 judge route 或人工 rubric 给分。
5. 运行：

```bash
node references/prototypes/model-provider-eval/scorecard.mjs references/prototypes/model-provider-eval/runs/2026-07-xx.json --strict
```

### 4. Prompt release gate

任何 prompt 或 model route 变更：

1. 必须更新 prompt version。
2. 跑完整 JSONL dataset。
3. 新版本不得新增 hard failure。
4. 新版本平均分不得比当前生产基线下降超过 2 个百分点。
5. 合规/安全 case 必须 100% 通过。
6. 至少抽检 10 条真实商家脱敏样本。

### 5. Production observation

线上不做同步阻塞 eval，但要做异步抽样：

- 低风险内容：5%-10% 抽样。
- 合规 warn/needs_review：100% 记录 scorer 结果。
- 被用户手动大改的内容：进入 prompt drift 样本池。
- 平台拒审/下架反馈：进入 hard negative dataset。

Mastra Evals 可用于 scorer 和 trace 分析，但线上阻断仍由 Core API 的 Compliance Gate 执行。

## Initial Decision

P0 第一阶段建议这样落地：

1. 先接 3 类文本供应商：OpenAI、Gemini、DeepSeek。
2. 同时预留 Anthropic 和 Alibaba adapter，但不作为首批默认路由，先做 benchmark。
3. Kimi 和 Volcengine 进入候选池，等价格/模型清单本地快照完整后再评测。
4. 图片生成先只接一个 provider 做背景/插画 spike；卡片文字和排版必须走确定性 renderer。
5. 所有 prompt 发布都必须跑 `beauty-content-p0-v0.jsonl`，CI 先用 `scorecard.mjs --strict` 做硬门禁。

首批默认建议：

| route | P0 default | fallback |
|---|---|---|
| `draft_copy` | `gpt-5.4-mini` 或 `gemini-3.5-flash` | `deepseek-v4-flash` |
| `rewrite_safe` | `gpt-5.4-mini` | `claude-sonnet-5` |
| `compliance_precheck_fast` | `gemini-2.5-flash-lite` 或 `gpt-5.4-nano` | deterministic rules + manual review |
| `platform_adapt` | `gemini-3.5-flash` | `gpt-5.4-mini` |
| `final_refine` | `claude-sonnet-5` | `gpt-5.5` |
| `asset_tagging` | Gemini vision 或 OpenAI vision | manual review |
| `image_background` | Imagen 4 或 OpenAI image | renderer template background |

这个默认不是最终采购决策，只是开发期 benchmark 起点。真实选择必须以 eval 分数、硬失败、成本、延迟、限流、账单稳定性和中国业务可用性共同决定。

## Open Risks

- 价格和模型名更新频繁，必须每次 benchmark 前刷新官方快照。
- 火山方舟本地 OpenCLI 抓取不完整，不能进入 P0 默认路由。
- Kimi pricing 页缺少可直接入库的具体模型价格，需要补抓子页面。
- 供应商账单和 token 统计口径不一致，`provider_cost_entries` 要保存原始 usage JSON。
- 裁判模型可能有偏差，合规 hard gate 不能只依赖模型裁判。
- 中文平台风格不能只看模型主观质量，要结合真实商家人工标注和平台发布反馈。

## Follow-up Tickets

- 实现 provider registry DDL 和 provider adapter interface。
- 实现真实 benchmark runner，输出 `provider-runs.json`。
- 扩充 eval dataset 到 paid pilot 门槛。
- 建立 prompt versioning 和 CI gate。
- 补抓 Kimi 具体模型 pricing 页。
- 重新抓取/手动核验 Volcengine Ark 详细模型清单和价格。
