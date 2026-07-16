# Agent Runtime 源码审查

> ⚠️ **2026-07-07 v1.5 覆盖批注**：本文为 Mastra 采用评估，不再作为 P0 runtime 实施口径。P0 以 ADR-0007 为准：Vercel AI SDK + Postgres durable_jobs + 自研 step-runner + promptfoo；Mastra 推迟到流水线出现真实复杂度后再引入，且只替换 `ContentWorkflowRunner` 实现。

审查日期：2026-07-06

## 审查问题

Mastra 的哪些能力应该进入 P0，哪些必须包在我们自己的 adapter 后面，哪些应该延后到 P1/P2？

## 结论

本文原结论是“P0 可以采用 Mastra”，该结论已被 ADR-0007 覆盖。当前口径：P0 使用 Vercel AI SDK + 自研 step-runner；Mastra 仅作为触发式升级项，且不能成为产品域、合规域、发布域或用量账本的事实来源。

推荐采用方式：

- P0 主链路使用 Mastra Workflows：`GenerateWeeklyContentWorkflow`、`RewriteContentWorkflow`、`CreatePublishPackageWorkflow`。
- 开放式生成步骤使用 Mastra Agents：文案生成、平台改写、视频脚本、拍摄建议、周报总结。
- 所有业务动作通过 Mastra Tools 调用我们自己的 Core API、Renderer、Publish Router、Compliance Gate、Usage Ledger。
- Memory/RAG 只做会话上下文、历史素材召回、历史内容召回，不保存门店档案、价格、内容版本、线索、用量、合规审计。
- Guardrails/Processors 只做通用安全层；Regulated Content Mode、广告极限词、AIGC 标识、素材授权必须由自研 Compliance Gate 处理。
- Observability/Evals 用于研发、运营和模型/prompt 质量评估，但必须同步到我们自己的 `agent_runs`、`tool_calls`、`provider_cost_entries`、`audit_events`。

核心判断：P0 要的是“可审计的创作副驾流水线”，不是 long-running autonomous agent。

## 本地证据

主要本地来源：

- 产品基线：`合集-v1.2-含开源项目选型.md`
- 产品术语：`CONTEXT.md`
- 源码清单：`references/analysis/02-source-inventory.md`
- SaaS 壳结论：`references/analysis/02-saas-shell-source-review.md`
- Mastra 官方文档快照：`references/docs/official/mastra/`
- Mastra 源码：`references/repos/mastra`

关键文档快照：

- `references/docs/official/mastra/agents-overview.md`
- `references/docs/official/mastra/workflows-overview.md`
- `references/docs/official/mastra/memory-overview.md`
- `references/docs/official/mastra/rag-overview.md`
- `references/docs/official/mastra/guardrails.md`
- `references/docs/official/mastra/observability-overview.md`
- `references/docs/official/mastra/evals-overview.md`

注意：`references/docs/official/mastra/tools.md` 当前快照是 404，因此工具能力主要以 `agents-overview.md` 中的 `createTool()` 摘要和源码为依据。

关键源码文件：

- `references/repos/mastra/package.json`
- `references/repos/mastra/packages/core/package.json`
- `references/repos/mastra/packages/core/src/agent/types.ts`
- `references/repos/mastra/packages/core/src/tools/tool.ts`
- `references/repos/mastra/packages/core/src/tools/types.ts`
- `references/repos/mastra/packages/core/src/workflows/create.ts`
- `references/repos/mastra/packages/core/src/workflows/workflow.ts`
- `references/repos/mastra/packages/core/src/workflows/step.ts`
- `references/repos/mastra/packages/core/src/workflows/handlers/step.ts`
- `references/repos/mastra/packages/core/src/mastra/index.ts`
- `references/repos/mastra/packages/memory/src/index.ts`
- `references/repos/mastra/packages/rag/src/document/document.ts`
- `references/repos/mastra/packages/evals/package.json`
- `references/repos/mastra/packages/server/src/server/handlers/workflows.ts`
- `references/repos/mastra/packages/server/src/server/handlers/agents.ts`
- `references/repos/mastra/stores/pg/package.json`

当前本地 Mastra clone commit：

```text
81b66d0 chore: regenerate providers and docs [skip ci]
```

## 版本与稳定性风险

源码里 `@mastra/core` 和 `@mastra/server` 当前版本是 `1.50.0-alpha.2`，`@mastra/mcp` 是 `1.13.1-alpha.0`。这不是不能用，但意味着 P0 必须隔离依赖：

- 业务代码不要直接到处 import Mastra API。
- Agent Service 内部建立 `AgentRuntimePort` / `ContentWorkflowRunner` 这类 adapter。
- Core API 只理解我们自己的请求、状态、错误码、用量和审计，不理解 Mastra 内部对象。
- 后续若引入 Mastra，API 变动只改 `ContentWorkflowRunner` 实现，不改产品域。

Mastra 包要求 Node `>=22.13.0`。P0 部署环境需要按这个版本线规划，不能默认放进 Cloudflare Workers app-shell 里。

## P0 应该采用的能力

### 1. Workflows：P0 主编排

Mastra 官方文档把 workflows 定义为“步骤明确、顺序清楚、多阶段控制”的任务。源码中 `createWorkflow()`、`createStep()` 支持 input/output schema、state、request context、stream、start、restart、suspend/resume、step scorers 和 retries。

这正好匹配 P0 的固定创作链路：

```text
GenerateWeeklyContentWorkflow
  1. load_store_context
  2. reserve_usage
  3. retrieve_real_assets
  4. select_beauty_skill_pack
  5. generate_topics
  6. compose_content_core
  7. adapt_platform_variants
  8. create_visual_plan
  9. create_video_script_if_needed
 10. run_compliance_gate
 11. save_drafts
 12. commit_or_refund_usage
 13. return_content_cards
```

P0 还应该有：

```text
RewriteContentWorkflow
  1. load_content_variant
  2. reserve_usage
  3. apply_rewrite_instruction
  4. run_compliance_gate
  5. save_new_version
  6. return_diff

CreatePublishPackageWorkflow
  1. load_approved_variant
  2. ensure_compliance_passed
  3. inject_aigc_label
  4. export_text
  5. export_assets
  6. render_manual_steps
  7. create_publish_package
```

采用边界：Workflow 是执行态，不是业务状态机。`content_cores`、`platform_variants`、`publish_packages`、`compliance_checks`、`usage_ledger_entries` 仍由 Core API/Postgres 保存。

### 2. Agents：开放式生成步骤

Mastra Agents 适合 LLM + tools + memory 的开放式任务。P0 不应该做“一个超级 Agent 自己运营门店”，但可以做小而清晰的生成 agent：

- `StoreContentCopilotAgent`：本周内容生成、单条内容生成。
- `PlatformAdaptAgent`：小红书/抖音/点评/公众号平台变体。
- `VideoScriptAgent`：口播稿、分镜、拍摄清单。
- `WeeklyInsightAgent`：基于 Lead Ledger 和内容台账生成周报。

Agent 输出必须结构化，不以一段聊天文本作为产品数据。

建议输出形状：

```text
ContentCard
  content_core
  platform_variants[]
  visual_plan
  video_script?
  compliance_status
  next_actions[]
  usage_summary
```

### 3. Tools：所有业务能力的受控入口

源码中的 `Tool` / `createTool()` 支持：

- `id`
- `description`
- `inputSchema`
- `outputSchema`
- `suspendSchema`
- `resumeSchema`
- `requestContextSchema`
- `requireApproval`
- `needsApprovalFn`
- output validation
- tool context 中的 agent/workflow/run 信息

P0 工具应该围绕 Core API 和外部服务封装：

| 工具域 | Tool | P0 角色 |
|---|---|---|
| 门店 | `store.profile.read` | 从 Core API 读取结构化门店事实 |
| 素材 | `asset.search` | 检索真实素材和素材标签 |
| 素材 | `asset.suggest_shooting_list` | 素材不足时生成拍摄清单 |
| 文案 | `copy.compose` | 生成内容母体 |
| 文案 | `copy.platform_adapt` | 生成平台变体 |
| 图文 | `graphic.plan` | 生成封面/卡片计划，不直接替代 renderer |
| 视频 | `video.script` | 口播稿/分镜/字幕草稿 |
| 合规 | `compliance.check` | 调用自研 Compliance Gate |
| 合规 | `aigc.label.inject` | 注入显式/隐式 AIGC 标识 |
| 内容 | `content.save_draft` | 写入 Core API，带版本和审计 |
| 发布 | `publish.create_package` | 生成 L3 发布包 |
| 线索 | `lead.summarize` | 周报和下轮建议 |
| 计费 | `usage.reserve` / `usage.commit` / `usage.refund` | 用量账本 |

高风险工具默认 `requireApproval`：

- `publish.official`
- `publish.browser_assist`
- `account.credential_access`
- `usage.adjust`
- `store.profile.update`
- 任何公开发布、价格承诺、顾客素材授权变更相关动作

### 4. RequestContext：传递租户和执行上下文

Mastra workflow step 和 tool 都支持 `requestContext` / `requestContextSchema`。P0 应该强制传入：

```text
user_id
workspace_id
store_id
role
plan
locale
platform_scope
feature_flags
agent_run_id
correlation_id
```

工具内部不能相信模型传入的 workspace/store 参数，必须以 request context 和 Core API 鉴权结果为准。

### 5. Observability：内部可观测性

Mastra observability 能记录 agent run、workflow step、tool call、model interaction，并能派生 duration、token usage、cost estimates。P0 应启用最小可观测能力，用来调试和运营：

- 哪一步慢。
- 哪个模型成本高。
- 哪个工具失败多。
- 哪些 prompt 版本质量下降。
- 哪些 compliance gate 常拦截。

但 Mastra observability 不能替代产品账本。必须把关键运行摘要同步到 Core API：

```text
agent_runs
agent_workflow_steps
tool_calls
provider_cost_entries
usage_ledger_entries
audit_events
```

### 6. Evals：内部质量门禁

Mastra evals/scorers 可以用于 CI 或内部实验：

- 标题是否平台原生。
- 文案是否像真实美业门店。
- 是否遗漏转化钩子。
- 是否命中医美/疗效风险。
- 是否正确生成发布包字段。

P0 可以先做离线 eval dataset，不建议一开始把 live scorers 作为生产阻断机制。生产阻断仍由自研 Compliance Gate 和规则/小模型组合控制。

## 必须包 Adapter 的能力

### 1. Agent Runtime Adapter

建议建立 Agent Service，而不是让 app-shell 直接调用 Mastra：

```text
App Shell
  -> Core API
  -> Agent Service Adapter
       -> Mastra workflows / agents / tools
       -> Core API client
       -> Model provider registry
       -> Renderer / Publish Router
```

对外 API 只暴露产品语义：

```text
POST /agent-runs/generate-weekly-content
POST /agent-runs/rewrite-content
POST /agent-runs/create-publish-package
GET  /agent-runs/:agent_run_id
GET  /agent-runs/:agent_run_id/events
POST /agent-runs/:agent_run_id/cancel
POST /agent-runs/:agent_run_id/approve
```

不要暴露 Mastra 原生 `/agents`、`/workflows`、`/tools` 给商家端。

### 2. Model Provider Adapter

Mastra 的 model router 可以作为内部调用方式，但本产品仍需要自己的 provider registry：

- 按任务类型路由模型。
- 记录 provider、model、tokens、image count、cost、latency、failure reason。
- 支持低成本 draft 与高质量 refine。
- 支持 provider fallback。
- 支持套餐和 quota 限制。

Mastra 的 `usage` / observability 可作为数据来源之一，但收费和额度以 Core API 的 usage ledger 为准。

### 3. Memory Adapter

Mastra Memory 可以保存副驾会话、线程上下文、临时偏好。不能保存以下事实：

- 门店档案。
- 项目价目。
- 营业时间。
- 资质状态。
- 素材授权。
- 内容版本。
- 发布状态。
- 线索台账。
- 用量账本。
- 合规审计。
- 账号凭据。

建议双层记忆：

```text
Mastra Memory
  会话级、线程级、短期任务上下文

Core API/Postgres + RAG
  门店级、租户级、长期事实、资产、审计
```

### 4. RAG Adapter

Mastra RAG 提供 `MDocument`、chunking、metadata extraction、vector store 支持，可用于：

- 历史爆款内容召回。
- 顾客好评召回。
- 门店介绍/服务流程召回。
- 案例说明召回。
- 老板/店员语气召回。
- 模板和场景包召回。

不要用 RAG 判断价格、优惠有效期、资质、账号能力、套餐额度、合规结论。这些必须结构化读取。

P0 推荐：

```text
Postgres structured tables
  stores
  store_projects
  assets
  content_cores
  platform_variants
  lead_events

pgvector indexes
  asset_embeddings
  review_embeddings
  historical_content_embeddings
  template_embeddings
```

Mastra 的 `@mastra/pg` 可以作为 runtime/vector provider 参考或直接使用，但业务表仍由 Core API 自己管理。

### 5. Compliance Adapter

Mastra Guardrails/Processors 可作为通用安全网：

- `PromptInjectionDetector`
- `SystemPromptScrubber`
- `PIIDetector`
- `ModerationProcessor`
- `CostGuardProcessor`
- `BatchPartsProcessor`

但它们不能替代自研 Compliance Gate。P0 必须自研：

- 广告绝对化用语。
- Regulated Content Mode 触发与发布前核验。
- 价格/优惠表述。
- 顾客素材授权。
- AIGC 显式标识。
- AIGC 隐式元数据。
- 合规结果审计。
- 发布包合规提示。

### 6. Server Adapter

Mastra server 源码包含 `/agents`、`/workflows` 等 handlers，并且有 auth/FGA/registry 概念。这适合内部 Studio 或开发调试，不适合直接暴露给商家产品。

P0 商家端应该只调用我们自己的 Core API / Agent Service API。Mastra server 如果启用，应限制在内部网络或研发环境。

## P1/P2 延后能力

以下能力不进入 P0 主承诺：

| 能力 | 延后原因 |
|---|---|
| Durable Agents | P0 是用户触发的创作副驾，不需要 long-running autonomous agent |
| Signals / Heartbeats / Daemon | 平台评论/私信/指标读取能力未验证前不能承诺值守 |
| Background Tasks 深度使用 | P0 可用普通队列；复杂 durable/replay 留到 spike |
| Multi-agent supervisor networks | P0 用 workflow + 少量 focused agents 更可控 |
| Browser automation | L2 仅灰度，且发布前一步必须人确认 |
| MCP 外部工具市场 | 工具边界、权限、审计和凭据风险太高 |
| Voice | P0 只需文本脚本和拍摄清单 |
| Channels: Slack/Discord/Telegram | 与美业商家 P0 使用场景无关 |
| Agent Builder / Studio 商家端暴露 | 商家不应看到 Agent/Workflow/Trace/Tool 等工程概念 |
| Observational Memory 深度使用 | 可后置；P0 先保证结构化门店事实和内容资产 |

## P0 Agent Service 执行路径

### Step 1（历史建议）：建立独立 Agent Service

创建独立 Node 服务，运行 Mastra。不要放进 Cloudflare Workers app-shell。

验收：

- Node 版本满足 `>=22.13.0`。
- 服务可以注册一个 Mastra instance。
- Core API 能以 `workspace_id` / `store_id` / `user_id` 调用 Agent Service。

### Step 2：定义 Runtime Port

建立我们自己的接口：

```text
ContentWorkflowRunner.generateWeeklyContent()
ContentWorkflowRunner.rewriteContent()
ContentWorkflowRunner.createPublishPackage()
ContentWorkflowRunner.cancelRun()
ContentWorkflowRunner.approveRun()
ContentWorkflowRunner.streamRunEvents()
```

验收：

- app-shell 和 Core API 不 import Mastra types。
- Mastra 替换或升级只影响 Agent Service 内部。

### Step 3：实现 Core API Tools

第一批工具只做 P0 主链路：

- `store.profile.read`
- `asset.search`
- `usage.reserve`
- `usage.commit`
- `usage.refund`
- `copy.compose`
- `copy.platform_adapt`
- `video.script`
- `compliance.check`
- `content.save_draft`
- `publish.create_package`

验收：

- 每个工具都有 `inputSchema`、`outputSchema`、`requestContextSchema`。
- 每次工具调用都写入 `tool_calls`。
- 任何写操作通过 Core API 做权限、审计和幂等。

### Step 4：实现 GenerateWeeklyContentWorkflow

先用 mock store 和 mock assets 跑通 3 到 5 张内容卡。

验收：

- workflow 可 stream 进度。
- 每张内容卡有平台、标题、正文、素材建议、合规状态、下一步动作。
- 失败时 usage 可以 refund。
- 成功时保存 Content Core 和 Platform Variants。

### Step 5：接入最小 Observability 和 Evals

先做研发内部能力：

- 记录 agent run、workflow step、tool call、model usage。
- 建 20 到 50 条美业内容 eval dataset。
- 为标题质量、平台适配、合规风险、结构完整性做离线 scorer。

验收：

- 每次生成能追踪到模型、prompt version、tool calls、cost estimate。
- prompt 或模型变更前能跑小样本 eval。

## 运行时数据边界

建议 Core API 持久化：

```text
agent_runs
agent_workflow_steps
tool_calls
model_calls
provider_cost_entries
usage_ledger_entries
compliance_checks
audit_events
```

Mastra runtime 可以保存自己的 traces、workflow state、memory、scorer results，但它们是调试和执行辅助，不是产品主数据。

## 最终建议

P0 采用 Mastra 的方式应该是：

```text
Mastra = Agent Service 内部编排框架
Workflows = 主链路
Agents = 生成/改写/总结步骤
Tools = 受控业务能力入口
Memory/RAG = 上下文和召回辅助
Guardrails = 通用安全层
Observability/Evals = 内部质量与成本治理

Core API/Postgres = 产品事实来源
Compliance Gate = 垂类合规事实来源
Usage Ledger = 计费事实来源
Publish Router = 发布能力事实来源
```

这样既能利用 Mastra 快速搭建 AI 编排，又不会把美业内容产品最关键的门店事实、合规、发布、线索和用量账本交给一个 alpha 期框架隐式管理。
