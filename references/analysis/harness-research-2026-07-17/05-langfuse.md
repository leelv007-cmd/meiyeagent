# Langfuse 深度调研（承载 DecisionTrace 审计 + 运行观测 + Eval 数据集）

> **交叉验证裁定（Codex，2026-07-17）：成立但需修正（LangfuseGuardrail/LangfuseEvaluator 实锤存在，五段映射成立；ai@6 以下口径过度外推；EE 模式合规遥测不可关）** — 全文见 `xcheck/r05-xcheck.md`；引用本报告断言前先对照裁定。

> 调研日期：2026-07-17　调研员：候选组件深调（Langfuse 专项）
> 项目：美业本地商家内容营销 Agent SaaS（TS 全栈 / Next.js + Vercel AI SDK + PostgreSQL + pg-boss / 验证期 Cloudflare，未来可能迁中国云）
> 证据来源：本地镜像 `references/repos/harness-2026-07-17/langfuse/`（git HEAD = `ac292e9`，release **v3.221.0**，2026-07-17 当天发布）+ npm registry 实测 + 官方文档 + GitHub API。
> 标注约定：【核实】= 源码/npm/官方文档直接证据；【推断】= 基于证据的工程判断。

---

## 0. 一句话结论

**Langfuse 能完整承载我们的三大目标，且我们需要的全部功能（tracing / DecisionTrace / LLM-as-judge / datasets / 实验回归 / prompt 管理 / 多模态）都落在 MIT 开源自托管免费版里，EE 门禁只锁企业管理类功能（与我们无关）。** 主要代价是自托管栈偏重（强制 ClickHouse + Redis + S3 + PG，4 个有状态组件），以及它是「观测/回放/评估平面」而非「合规系统 of record」——红线门禁等合规留痕必须留在我们自建 PG 审计表，Langfuse 只做富上下文回放与回归评估。

---

## 1. 版本 / 许可分层 / 发布节奏 / 采用信号

### 1.1 版本【核实】
- 平台（server）最新版：**v3.221.0**（本地镜像 `package.json` version 字段 + `git describe --tags` + GitHub releases API 三方一致，2026-07-17 当天发布）。
- 发布节奏极快：**同一天连发 v3.219.0 / v3.220.0 / v3.221.0**（GitHub releases API 时间戳 11:10 / 13:42 / 14:42 UTC）。属高频滚动发布（calver 式 3.x.y）。
- TypeScript SDK 有两条线【核实，npm registry 实测】：
  - **新版模块化 OTEL SDK = v5.9.1**：`@langfuse/core` / `@langfuse/tracing` / `@langfuse/otel` / `@langfuse/client` / `@langfuse/openai` / `@langfuse/langchain` / `@langfuse/vercel-ai-sdk`（全部 5.9.1，MIT）。
  - **旧版单体 SDK = `langfuse` v3.38.20**（`langfuse-core` 基座，非 OTEL，维护态）。新项目应直接用 v5 OTEL 线。

### 1.2 许可分层（关键，逐条核实）
仓库根 `LICENSE`【核实】：除 `ee/`、`web/src/ee/`、`worker/src/ee/` 三个目录外，**全部 MIT（Expat）**。EE 目录受 `ee/LICENSE`（Langfuse Enterprise License）约束——但允许「为开发/测试目的自由拷贝修改，无需订阅」，仅生产使用 EE 功能需 license key。

EE 门禁的运行时开关【核实，`web/src/features/entitlements/constants/entitlements.ts` + `ee/src/ee-license-check/index.ts`】：
```
isEeAvailable = NEXT_PUBLIC_LANGFUSE_CLOUD_REGION !== undefined || LANGFUSE_EE_LICENSE_KEY !== undefined
```
即：**自托管且不设 license key ⇒ `oss` plan**。`oss` plan 的 entitlement 明细（源码 `entitlementAccess.oss`）：

| 我们关心的功能 | 在 `oss`（自托管免费）是否可用 | 证据 |
|---|---|---|
| Tracing / observations / sessions / scores | ✅ 核心 MIT，不在 entitlement 列表 | 【核实】不受任何 gate |
| Datasets（数据集管理） | ✅ 核心 MIT | 【核实】不在 entitlement 列表 |
| **LLM-as-judge / model-based evals** | ✅ 免费无限 | 【核实】`model-based-evaluations-count-evaluators: false`（false=无限）；官方 pricing-self-host 页明确标 ✓ Included |
| **Annotation queues（人工标注队列）** | ✅ 免费无限 | 【核实】`annotation-queue-count: false`（oss）；官方页 ✓ Included |
| **Prompt experiments / prompt 管理** | ✅ 免费无限 | 【核实】`prompt-management-count-prompts: false`；`web/src/features/experiments` 无任何 `hasEntitlement` gate |
| Playground | ✅ | 【核实】官方 pricing-self-host ✓ |
| Multimodal / media 附件 | ✅ 核心 | 【核实】`LangfuseMediaView.tsx`、`media-deletion.ts`、S3 media bucket 均在 MIT 区 |
| SSO（基础 OIDC/OAuth） | ✅ | 【核实】官方页 ✓（EE 锁的是「多租户 SSO enforcement」`cloud-multi-tenant-sso`） |
| Org 级 RBAC | ✅ | 【核实】官方页 ✓ |

**落在 EE（需 license key）的功能**（官方 license-key 文档 + `entitlementAccess.self-hosted:enterprise` 双向核实）：`project 级 RBAC roles`、`audit-logs`（Langfuse 自己的操作审计，非我们的 DecisionTrace）、`data-retention` 保留策略、`server-side data masking`（服务端脱敏）、`UI customization`、`allowed-organization-creators`、`prompt-protected-labels`、`admin-api` / `Org & Instance Management API` / `SCIM`。

> **要点纠偏**：训练知识里「LLM-as-judge / annotation / experiments 属 EE」的旧印象**在 v3.221 已不成立**——这三项现全部在 OSS 免费无限。唯一你可能想要但被锁的是「Langfuse UI 操作审计日志 audit-logs」和「数据保留策略 data-retention」，但前者与我们的业务 DecisionTrace 无关，后者可用 ClickHouse TTL 自己实现。

### 1.3 采用信号【核实，GitHub API 2026-07-17】
- `langfuse/langfuse`：**31,333 stars / 3,307 forks / 706 open issues**，`pushed_at` 当天，非 archived。
- **公司信号：Langfuse 自 2026 年 1 月起已被 ClickHouse 收购**（README + 备选对比文均确认）。含义正负都有：正=ClickHouse 后端一等公民、长期资金稳；负=战略上会更绑 ClickHouse，轻量化去 CH 的可能性更低。
- 生态：官方一等集成覆盖 OpenAI / LangChain / **Vercel AI SDK** / LlamaIndex 等；`langfuse-js` SDK 独立仓库活跃（当天有 push）。

---

## 2. 自托管组件栈 / 运维复杂度 / 中国云可部署性

### 2.1 组件清单【核实，本地 `docker-compose.yml`】
`langfuse-web` 与 `langfuse-worker` 两个应用容器，`depends_on` 强制健康的 4 个有状态服务：

| 组件 | 镜像/版本（compose 默认） | 是否必需 | 作用 |
|---|---|---|---|
| **PostgreSQL** | `postgres:17` | **必需** | 事务性元数据（用户/项目/prompt/dataset/config/scores 定义） |
| **ClickHouse** | `clickhouse/clickhouse-server` | **必需（v3 起硬依赖）** | traces / observations / scores 的海量列存分析库 |
| **Redis** | `redis:7`（支持 Valkey / 集群 / TLS） | **必需** | BullMQ 摄取队列 + 缓存 |
| **S3 兼容对象存储** | `cgr.dev/chainguard/minio`（MinIO） | **必需** | 事件原始体、多模态 media、批量导出 |
| langfuse-web | `langfuse/langfuse:3` | 必需 | 控制台 UI + 公共 API 摄取端 |
| langfuse-worker | `langfuse/langfuse-worker:3` | 必需 | 异步消费队列写 ClickHouse、跑 evals、发邮件 |

> **不能去掉 ClickHouse**【核实】：`docker-compose.yml` 中 web/worker 的 `depends_on` 显式要求 `clickhouse: condition: service_healthy`。v3 架构把热数据全放 CH，没有「纯 PG 单库」模式。这是与 Phoenix 的关键差异。

### 2.2 最小资源脚印【核实 + 推断】
- 官方 per-container 最小值【核实，官方 infrastructure/containers 文档】：`langfuse-web` **2 vCPU / 4 GB RAM**、`langfuse-worker` **2 vCPU / 4 GB RAM**；Node.js 需设 `NODE_OPTIONS max-old-space-size`；HA 建议 web ≥2 实例；CPU >50% 时扩容。文档未给 CH/PG/Redis 的最小值。
- 【推断】验证期单 VM all-in-one docker-compose 起步：约 **4 vCPU / 16 GB RAM / 50–100 GB SSD** 可跑通冒烟；生产建议 web/worker 各独立 + CH 至少 4C/16G 单节点起。ClickHouse 是资源与运维大头。

### 2.3 运维复杂度 / 升级路径
- 部署方式【核实，README】：docker-compose（5 分钟本地）、**Kubernetes Helm（官方推荐生产）**、Terraform（AWS/Azure/GCP）。
- 升级【推断，基于滚动 3.x 版本流】：镜像 tag `:3` 滚动，含 PG（Prisma migrations）+ ClickHouse（`CLICKHOUSE_MIGRATION_URL`）两套自动迁移，worker 启动时执行。高频发版意味着需要固定 minor 版本、灰度升级，不宜盲追 `:3` latest。
- **运维真实成本集中在 ClickHouse**：单机可跑，但生产级要考虑副本/分片（`CLICKHOUSE_CLUSTER_ENABLED`）、冷热分层、备份，团队若无 CH 经验是主要学习曲线。

### 2.4 中国云 / 全内网可部署性【核实 + 推断】
- ✅ 全组件均可自托管（PG/CH/Redis/MinIO 都是可在阿里云/腾讯云/内网自建的标准件），无强制外部 SaaS 依赖。SDK 的 `baseUrl` / `LANGFUSE_BASE_URL` 可指向自有实例【核实，`LangfuseSpanProcessorParams.baseUrl`】。
- ⚠️ 外呼依赖需显式关闭【核实】：
  - **产品遥测 → PostHog**（`eu.posthog.com` / `us.posthog.com`）：用 `TELEMETRY_ENABLED=false` 关闭（源码 `web/src/features/telemetry/index.ts`、`ServerPosthog.ts` 确认开关存在）。
  - README 提到的 Scarf pixel 仅 README 阅读统计，与运行时无关。
  - **EE license 校验**：OSS 模式（不设 `LANGFUSE_EE_LICENSE_KEY`）时 `isEeAvailable=false`，**完全不触发任何 license 网络校验**【核实，`ee-license-check/index.ts` 仅一个布尔判断】——纯 OSS 部署可完全离线/内网运行。
- **平移结论**：验证期 CF（Workers 壳 + 单 Node 服务 + Hyperdrive→托管 PG）与未来中国云之间，Langfuse 作为**独立自托管服务**平移无阻；唯一注意点见 §2.5。

### 2.5 与我们 Cloudflare 栈的接线注意【核实 + 推断】
- `@langfuse/tracing` / `@langfuse/otel` 标注 **Node.js 20+ only**【核实，npm 包 README environments 列】——**不能在 Cloudflare Workers 运行**（Workers 非 Node 运行时）。
- 但我们的编排层（五段式 Harness）跑在**单 Node 常驻服务**里，SDK 正落在这里，无冲突。【推断】Workers 壳只做边缘路由，不需要引入 tracing SDK；若 Workers 侧要写 score/取 prompt，可用 `@langfuse/client`（标注 Universal JS）。
- Langfuse 自身作为独立容器部署（不进 Workers），Node 服务通过 HTTP/OTLP 把 span 推给它。

---

## 3. TS SDK + OpenTelemetry 数据模型 & 五段式映射设计（核心交付）

### 3.1 数据模型【核实，`@langfuse/tracing` v5.9.1 `dist/index.d.ts` 实测】
- **Trace**：一次完整调用链的根，持有 trace 级属性（`user_id` / `session_id` / `tags` / `metadata` / `version` / `name` + 整体 input/output）。trace 级属性通过 `propagateAttributes()`（re-export 自 `@langfuse/core`）设置；`LangfuseTraceAttributes` 本体只含 `input/output`，其余走 propagate。
- **Observation**：trace 内的节点，v5 提供**语义化子类型**（全部 `extends LangfuseBaseObservation`）：
  `LangfuseSpan`（通用）、`LangfuseGeneration`（LLM 调用，带 model/usage/cost/prompt）、`LangfuseEvent`（时点事件）、`LangfuseAgent`、`LangfuseTool`、`LangfuseChain`、`LangfuseRetriever`、**`LangfuseEvaluator`**、**`LangfuseGuardrail`**、`LangfuseEmbedding`。
- **Observation 属性**【核实】`LangfuseSpanAttributes` = `{ input, output, metadata: Record<string,unknown>, level: "DEBUG"|"DEFAULT"|"WARNING"|"ERROR", statusMessage, version, environment }`；Generation 额外含 `model / modelParameters / usageDetails / costDetails / completionStartTime / prompt`。
- **Scores**：结构化评分，`langfuse.score.create / .observation / .trace / .activeObservation / .activeTrace`【核实，`@langfuse/client`】。
- 核心埋点函数【核实】：`startObservation(name, attrs, opts)`、`startActiveObservation(name, fn, opts)`（自动做 OTEL context 嵌套）、`updateActiveObservation(attrs)`、`setActiveTraceIO(attrs)`、`observe(fn, opts)` 包装器、`createTraceId(seed)` / `getActiveTraceId()`。

> **对我们的红利**：SDK 原生就有 `LangfuseGuardrail`（正好映射「红线门禁」）和 `LangfuseEvaluator`（正好映射「择优」）两个语义类型——不用把所有东西都塞进泛型 span，trace 可读性直接对上五段式。

### 3.2 推荐映射方案（Task=trace，五段=五个语义 span）

**总原则**（本报告的映射设计推断，已对齐 SDK 能力）：
- **可聚合、可跨 run 比较、要进回归基线的信号 → `scores`**（ClickHouse 里可过滤/聚合/画趋势）。例：门禁通过与否、择优命中 rank、路由到哪个模型。
- **富上下文 / 决策理由 / 结构化 JSON → 对应 observation 的 `metadata`**（完整保真用于回放，不做聚合）。
- **每段的原始输入输出 → 每个 span 的 `input/output`**（原生）。
- **合规必须留痕的字段 → 另外同步双写我们自建 PG 审计表**（见 §8）。

| 五段 | Langfuse observation | DecisionTrace 关键字段落点 |
|---|---|---|
| ① 意图正名（LLM） | `LangfuseGeneration`（或包一层 `LangfuseAgent`） | input=原始用户话；output=归一化意图；metadata.intentConfidence；score `intent.normalized`(bool) |
| ② 上下文注入（确定性） | `LangfuseRetriever` | input=查询键；output=注入的上下文快照；metadata.contextSources[]（命中的知识/偏好记忆 id） |
| ③ Brief 编译（LLM） | `LangfuseGeneration` | output=编译后 Brief；metadata.briefTemplateVersion；`prompt` 字段挂 Langfuse prompt 版本 |
| ④ 执行与择优（N选1 + 红线门禁） | 父 `LangfuseSpan`，子级：N×`LangfuseGeneration`（候选）+ 1×`LangfuseEvaluator`（打分择优）+ 1×`LangfuseGuardrail`（红线门禁） | **路由决定** → metadata.modelRoute + score `route.model`(categorical)；**择优理由** → Evaluator.metadata.rationale + score `selection.rank`(numeric)；**门禁结果** → Guardrail.level(ERROR=拦截) + metadata.violatedRules[] + score `gate.redline`(bool) |
| ⑤ 回装交付 | `LangfuseSpan` | input=中选产物；output=最终交付物；metadata.deliveryChannel |

### 3.3 代码骨架（英文，Vercel AI SDK 集成路径）

**接线现状核实**：`@langfuse/vercel-ai-sdk` v5.9.1 明确「**for AI SDK v7 (`ai@7`)**」，而 npm `ai` latest = **7.0.31**（均【核实】）。存在两条通路，按项目实际 AI SDK 版本二选一：

```ts
// ── instrumentation.ts ── 全局一次，Node 常驻服务入口 ──
import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";

// LangfuseSpanProcessor 构造项【核实自 @langfuse/otel d.ts】：
//   baseUrl(自托管指向自有实例) / publicKey / secretKey / mask(MaskFunction 脱敏)
//   / shouldExportSpan(过滤) / mediaUploadEnabled / environment / release
//   / exportMode: "immediate"(serverless) | "batched"(常驻，推荐)
export const langfuseSpanProcessor = new LangfuseSpanProcessor({
  baseUrl: process.env.LANGFUSE_BASE_URL,   // 自托管实例
  mask: ({ data }) => redactRedlineAndPII(data), // 红线/PII 出口脱敏
  exportMode: "batched",
});
new NodeSDK({ spanProcessors: [langfuseSpanProcessor] }).start();
```

```ts
// ── AI SDK v7 通路（新，官方 @langfuse/vercel-ai-sdk README 逐字核实）──
import { generateText, registerTelemetry } from "ai";
import { propagateAttributes } from "@langfuse/tracing";
import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";

registerTelemetry(new LangfuseVercelAiSdkIntegration()); // 全局一次

// 每个 Task 一个 trace：
await propagateAttributes(
  {
    traceName: "beauty-content-task",
    userId: merchantUserId,
    sessionId: conversationId,
    tags: [category, channel],       // e.g. ["医美","小红书"]
    metadata: { taskId, tenantId },
  },
  async () => {
    // 段①③ 的 LLM 调用会自动成为该 trace 的 generation
    await generateText({
      model,
      prompt: brief,
      runtimeContext: {
        langfusePrompt: { name: "brief/default", version: 3, isFallback: false },
      },
      telemetry: { functionId: "brief-compile", includeRuntimeContext: { langfusePrompt: true } },
    });
  },
);
```

```ts
// ── AI SDK v6 及以下通路（旧，若项目未升 v7）──
// 用 experimental_telemetry 触发 OTEL span，仍由上面的 LangfuseSpanProcessor 采集
const { text } = await generateText({
  model,
  prompt: brief,
  experimental_telemetry: { isEnabled: true, functionId: "brief-compile" },
});
```

```ts
// ── 段④ 的择优/门禁/评分：手动语义 span（核心 DecisionTrace）──
import { startActiveObservation, updateActiveObservation } from "@langfuse/tracing";
import { LangfuseClient } from "@langfuse/client";
const langfuse = new LangfuseClient();

await startActiveObservation("execute-and-select", async (span) => {
  // 红线门禁
  const gate = await startActiveObservation("redline-gate", async (g) => {
    const res = checkRedlines(candidate);
    g.update({ level: res.blocked ? "ERROR" : "DEFAULT",
               metadata: { violatedRules: res.rules } });
    return res;
  }, { asType: "guardrail" });            // → LangfuseGuardrail

  langfuse.score.create({ name: "gate.redline", value: gate.blocked ? 0 : 1,
                          comment: gate.rules.join(",") });

  // 择优
  await startActiveObservation("select-best", async (ev) => {
    const ranked = rankCandidates(candidates);
    ev.update({ output: ranked.winner,
                metadata: { rationale: ranked.rationale, scores: ranked.perModel } });
    langfuse.score.create({ name: "selection.rank", value: ranked.winnerRank });
    langfuse.score.create({ name: "route.model", value: ranked.winner.model }); // categorical
  }, { asType: "evaluator" });            // → LangfuseEvaluator
}, { asType: "span" });
```
> 注：`asType` 为 `startActiveObservation` 的重载选择器（d.ts 显示 generation/agent/tool/chain/retriever/evaluator/guardrail/embedding/span 各有重载）；上面写法为映射意图示意，具体参数名以 v5.9.1 类型为准。

---

## 4. Datasets + Evals：能否承载 BeautyPreferenceMemoryEval

### 4.1 三种评估路径【核实】
1. **平台侧 managed LLM-as-judge**（UI 配置）：Evaluators 页 → 选默认模型（需支持 structured output，如 GPT-4o/Claude Sonnet/Gemini，走 LLM Connections 配置）→ 选 managed 模板（Hallucination/Toxicity/Helpfulness…）或自定义 prompt → 选打分类型（numeric/categorical/boolean）→ 挂到 live observations / live traces / experiments 上跑。**OSS 免费无限**（§1.2）。
2. **SDK 本地实验 runner**【核实，`@langfuse/client` ExperimentManager】：`langfuse.experiment.run({ name, data, task, evaluators, runEvaluators })` 或 `dataset.runExperiment({...})`。`evaluators`=逐条评估（返回 `{ name, value, comment }`），`runEvaluators`=整轮聚合（如平均分/通过率）。task 与 evaluator 都是你写的 TS 函数——可在 evaluator 内自行调 LLM 实现 code-based LLM-as-judge，或写确定性断言。
3. **Datasets 管理**【核实】：`langfuse.dataset.get(name)` 拿到 dataset（items + `runExperiment` + `datasetVersion` 时间点快照 + dataset run 血缘 `datasetRunId/datasetRunUrl`）。支持把 dataset item 链到 trace/observation。

### 4.2 BeautyPreferenceMemoryEval 承载判断【推断】
- **能承载，且推荐用 §4.1 的路径 2（SDK experiment runner）+ 路径 3（datasets）组合**：
  - 把「一组商家偏好输入 → 期望学到的偏好画像/期望产出特征」做成 Langfuse **dataset**（版本化、可时间点快照，天然当回归基线）。
  - 偏好记忆学习逻辑作为 `task`，`evaluators` 里写「学对了没」的判定（结构化断言 + 可选 LLM-as-judge 双评），`runEvaluators` 出整轮通过率作为**回归基线指标**。
  - 每次改记忆算法 → `runExperiment` → 对比历史 dataset run 的分数曲线，即回归。
- **是否需要外挂 promptfoo？**【推断】：**不必要**。Langfuse 的 experiment runner + datasets + scores 已覆盖 promptfoo 的「数据集×任务×评估×对比」核心闭环，且评估结果、trace、dataset run 三者血缘一体，比外挂工具的割裂体验好。**分工建议**：Langfuse 做「有状态、要长期趋势、要和线上 trace 血缘打通」的回归；若某天需要「纯 CI、matrix 扫参、无状态、YAML 声明式」的快速 prompt 网格测试，再补 promptfoo 作 CI gate，但不是必需项，且会引入第二套 dataset 事实源（不推荐同时维护）。

---

## 5. Prompt Management：能否管 Brief 模板

【核实，`@langfuse/client` PromptManager + `entitlementAccess`】
- ✅ 完整支持：`langfuse.prompt.get / create / update`，服务端版本化、缓存、label（如 `production`/`staging`）。OSS 免费无限（`prompt-management-count-prompts: false`）。
- **版本化/回滚**：每次 update 产生新 version，`prompt.get(name, { version })` 或按 label 取；回滚=把 label 指回旧 version【核实，有版本与 label 概念】。
- **A/B**：可用不同 label / version 分流 + 结合 scores 对比【推断，用 label 分流是标准做法；平台未必有开箱「实验分桶」UI】。
- **与 trace 血缘**：generation 上挂 `langfusePrompt: { name, version }`（AI SDK v7 通路的 `runtimeContext`，或 Generation 的 `prompt` 属性），trace 里可直接看到「这次用了 Brief 模板 v3」——对我们「Brief 编译」段是刚需。
- ⚠️ **EE 限制**：`prompt-protected-labels`（锁定 `production` 标签不被误改）属 EE。OSS 下 label 无写保护，需靠我们自己的发布流程约束。

---

## 6. 多模态：图/视频产物在 trace 里怎么存

【核实，官方 multi-modality 文档 + 源码 `LangfuseMediaView.tsx`/`mediaReferences.ts`/S3 media bucket】
- **存储**：媒体不进 trace 本体，SDK 客户端侧检测 base64 data URI，抽出后上传 **S3 兼容对象存储**（自托管配 MinIO/云 OSS）。
- **引用 token 格式**：`@@@langfuseMedia:type={MIME}|id={MEDIA_ID}|source={base64_data_uri|bytes|file}@@@`，UI 按此 inline 渲染。
- **支持格式**：图（png/jpg/webp/gif/svg/tiff/bmp/avif/heic）、音频（mp3/wav/ogg/aac/flac/opus）、**视频（mp4/webm/mov/mkv）**、文档（pdf/docx/xlsx/pptx）、数据（json/xml/zip/parquet）。
- **TS SDK API**：`new LangfuseMedia({ source, contentBytes, contentType })` 包裹后塞进 input/output/metadata；`resolveMediaReferences()` 反解回 base64；SpanProcessor 有 `mediaUploadEnabled` 开关。
- **对我们的意义**【推断】：文案+图+**视频成片**产物都能作为 media 挂在段⑤交付 observation 上，回放时直接在 Langfuse UI 看到成片。**注意成本**：视频体积大，media bucket 会快速膨胀，需配 S3 生命周期/TTL（见 §8）。建议只挂「用于审计/抽检回放」的产物或其缩略/首帧，原片留业务存储、trace 里放引用 URL。

---

## 7. 备选对比（一段带过）【核实，WebSearch 2026 对比源】

- **Arize Phoenix**（Elastic 2.0，OTel/OpenInference 原生）：**单进程、无事件配额、部署最轻**，评估/notebook 研究向体验最好。若我们只想要「轻量 tracing + eval、不想背 ClickHouse 运维」，Phoenix 是唯一能显著减负的选项——**但**它的 prompt 管理/dataset/标注/多租户产品化程度弱于 Langfuse，且 Elastic 2.0 非 MIT。
- **OpenLLMetry / Traceloop**（OTel 纯instrumentation，无自带后端）：价值是 vendor-neutral，一行接入把 LLM span 发到任意 OTLP 后端（SigNoz/Datadog/Grafana）。**它不是后端**，不提供 datasets/evals/prompt/标注 UI——不能独立承载我们的目标。
- **选 Langfuse 而非它们的理由**：我们要的是「审计回放 + 数据集回归 + LLM-as-judge + prompt 管理 + 人工标注」**一体化平面**，且 MIT 核心 + 全功能 OSS 免费。Langfuse 是唯一把这些开箱且自托管无功能阉割的。**代价**就是 ClickHouse 那套重栈。若后续验证期想极限降本，Phoenix 可作为「先上车再迁」的过渡备选（都 OTel，instrumentation 层可复用）。

---

## 8. 风险清单 & 与自建 PG 审计表的边界

| 风险 | 说明 | 缓解【推断】 |
|---|---|---|
| **ClickHouse 运维**【核实硬依赖】 | v3 强制 CH，团队若无 CH 经验是最大学习曲线；生产要管副本/分片/备份 | 验证期单节点 CH（docker/K8s Helm），中国云可用云托管 CH（阿里云 CH/ClickHouse Cloud 中国区）外挂，别自己扛集群 |
| **数据量增长成本** | traces/observations 全量进 CH + media 进 S3，内容 Agent 每 Task 多段多候选，写放大明显；视频 media 体积大 | 用 SpanProcessor `mask`/`shouldExportSpan` 只导需要的段；CH 表配 TTL；S3 media 配生命周期；采样非关键 trace |
| **高频发版** | 一天 3 版，盲追 latest 有回归风险 | 固定 minor 版、灰度升级、升级前跑 PG+CH migration 演练 |
| **被 ClickHouse 收购的战略绑定** | 去 CH 轻量化几无可能，长期与 CH 深绑 | 接受现实；用 OTel 标准埋点保留「换后端」的理论退路（instrumentation 不锁死） |
| **SDK 仅 Node 20+，不能进 Workers** | tracing/otel 包不在 Workers 跑 | 编排在单 Node 服务埋点；Workers 侧只用 Universal 的 `@langfuse/client` |
| **OSS 无 audit-logs / 无 protected-labels / 无服务端脱敏** | Langfuse 自身操作审计、prompt 标签写保护、服务端 masking 属 EE | 操作审计与我们业务无关可忽略；脱敏用 SpanProcessor 客户端 `mask` 自己做；prompt 标签靠发布流程约束 |

### 与自建 PG 审计表的边界（关键架构决策）【推断】
- **Langfuse = 观测/回放/评估平面**：富上下文、每段输入输出、可视化回放、回归评估。数据在 ClickHouse（分析型、最终一致、受 TTL/保留策略影响、可能随迁移丢历史）。**不适合当合规 system of record**。
- **自建 PG DecisionTrace 审计表 = 合规权威记录**：`taskId / tenantId / 红线门禁结果 / 用了哪个模型 / 时间戳 / 操作人 / langfuseTraceId`，事务性写入、业务可强一致查询、永久留存、随业务库一起备份/迁移。
- **推荐做法**：合规必留字段在业务事务里**同步双写 PG 审计表**，并把 `langfuseTraceId` 作为外键指向 Langfuse 的富回放。**Langfuse 挂了/被清了不影响合规留痕**；需要「为什么这么决策」的细节时再跳 Langfuse trace。这条边界必须在编排层落地时明确，否则会误把可丢的观测数据当审计凭证。

---

## 附：来源 URL（全部本次现场核实）

**本地镜像 / npm / GitHub（一手）**
- 本地仓库：`references/repos/harness-2026-07-17/langfuse/`（v3.221.0, git `ac292e9`）——`LICENSE`、`ee/LICENSE`、`ee/src/ee-license-check/index.ts`、`web/src/features/entitlements/constants/entitlements.ts`、`docker-compose.yml`、`web/src/features/telemetry/`、`web/src/features/posthog-analytics/ServerPosthog.ts`
- npm：`https://registry.npmjs.org/@langfuse/{core,tracing,otel,client,openai,langchain,vercel-ai-sdk}`（均 5.9.1）、`https://registry.npmjs.org/langfuse`（3.38.20）、`https://registry.npmjs.org/ai`（7.0.31）——含 tarball `dist/*.d.ts` 与 README 逐字核实
- GitHub API：`repos/langfuse/langfuse`（31,333★ / 3,307 forks / v3.221.0）、`repos/langfuse/langfuse-js`

**官方文档**
- https://langfuse.com/pricing-self-host （许可分层）
- https://langfuse.com/self-hosting/license-key （EE 门禁功能清单）
- https://langfuse.com/self-hosting/infrastructure/containers （容器资源要求）
- https://langfuse.com/docs/observability/sdk/typescript/overview （TS SDK 概览）
- https://langfuse.com/docs/integrations/vercel-ai-sdk （AI SDK 集成）
- https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge （managed evals）
- https://langfuse.com/docs/observability/features/multi-modality （多模态）
- https://js.reference.langfuse.com （SDK API 参考）

**备选对比**
- https://www.morphllm.com/comparisons/arize-phoenix-vs-langfuse
- https://langfuse.com/faq/all/best-phoenix-arize-alternatives
- https://signoz.io/comparisons/llm-observability-tools/
- https://laminar.sh/article/langfuse-alternatives-2026
