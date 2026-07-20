> ⚠️ **2026-07-07 评审批注（自旧工作区 `美业内容/` 迁入）**：本文部分结论已被 supersede——部署改阶段化（验证期 CF-first，ADR-0005）、四服务改"Workers 壳+单 Node 服务"（ADR-0006）、Mastra 改 AI SDK 起步（ADR-0007）。已确认的方法论盲点：本文 Live Sources Used=无，从未评估大陆可达性/备案轴（见 `plan-review-2026-07-07/04-技术架构与选型验证.md` 第十节"取景问题"）。Postgres 事实源、durable jobs、Compliance Gate 等组件级结论仍有效。

> ⚠️ **2026-07-18 链接审计批注**：本文所引 `references/repos/*` 本地镜像已从工作区移除（当前仅存 creatok-skills、vozeb、harness-2026-07-17，均 gitignore 不入库）。mkfast-template 模板现位于仓库根 `mkfast-template-main/`；需复核其余源码时按原仓库名重新 clone。文中镜像路径为 2026-07-06 快照期历史记录，结论不受影响。

# P0 Architecture Decision

审查日期：2026-07-06  
审查对象：美业到店 + 医美/医疗内容商家 Regulated Content Mode 创作副驾 P0 技术架构  
结论性质：开发前架构决策；用于指导 P0 backlog、试点实现和后续 ADR。

> 2026-07-06 同步更新：P0 范围已从“非医美”扩展为“可服务医美/医疗类商家，但采用 Regulated Content Mode”。架构边界不变；Compliance Gate 需要支持发布前核验提醒、人工确认和硬停止留痕。

## Question

What final P0 architecture should be used across app shell, Core API, Agent service, worker pool, database, object storage, queue, provider registry, compliance, and deployment?

## 结论

P0 采用 **四服务边界 + Postgres 产品事实源 + R2 二进制对象 + Cloudflare Workers app shell**：

```text
Cloudflare Workers App Shell, mkfast-template fork
  - TanStack Start UI
  - Better Auth identity/session
  - D1 shell-local data
  - R2 upload/proxy mechanics
  - BFF adapters only
        |
        v
Core API, TypeScript service + Postgres
  - Store Workspace authorization
  - product facts
  - Compliance Gate
  - Usage Ledger and Provider Cost Ledger
  - Publish Router and Platform Capability Matrix
  - Lead Ledger and audit events
  - durable job records
        |
        +--> Agent Service, Node >= 22.13 + Mastra
        |     - workflows, focused agents, tools
        |     - model provider adapters
        |     - execution traces and eval helpers
        |
        +--> Worker Pool, Node containers
        |     - SVG/resvg/sharp rendering
        |     - Playwright QA/fallback screenshots
        |     - image normalization and export artifacts
        |
        +--> R2
              - original assets
              - rendered artifacts
              - package export files
              - consent evidence files
```

核心判断：

1. `mkfast-template` 作为 app-shell fork，不作为 Core API。
2. Core API/Postgres 是唯一产品事实来源。
3. Mastra 只放在独立 Agent Service 内部，不能泄漏到 app shell 或 Core API 类型边界。
4. Worker Pool 承担重 CPU/字体/浏览器/图片任务，不塞进 Cloudflare Workers。
5. P0 队列先用 Postgres-backed durable jobs，保留未来切到 Redis Streams / Inngest / managed queue 的空间。
6. Provider Registry、Eval Gate、Compliance Gate、Publish Router 都归 Core API/Postgres 管。
7. P0 不依赖 L2 自动发布；所有平台先有 L3 Publish Package。

## Agent Team Used

本轮启用了三个只读 explorer：

- App shell / auth / tenancy / deployment explorer.
- Agent Service / worker pool / queue / provider registry explorer.
- Core API / compliance / publishing / merchant validation explorer.

三个 explorer 结论一致：应保留 `mkfast-template` 壳层速度，但把产品事实、合规、发布、用量、线索、审计全部放在 Core API/Postgres；Agent 和 worker 只执行任务。

## Local Sources Used

产品和前序决策：

- `合集-v1.2-含开源项目选型.md`
- `CONTEXT.md`
- `docs/adr/0001-p0-data-architecture.md`
- `docs/adr/0003-regulated-content-mode.md`
- `references/analysis/01-execution-path.md`
- `references/analysis/02-saas-shell-source-review.md`
- `references/analysis/03-agent-runtime-source-review.md`
- `references/analysis/05-platform-capability-matrix.md`
- `references/analysis/06-compliance-implementation-plan.md`
- `references/analysis/07-domain-data-model.md`
- `references/analysis/09-model-provider-eval-plan.md`
- `references/analysis/10-graphic-renderer-selection.md`
- `references/analysis/11-publish-route-poc.md`
- `references/analysis/12-merchant-validation-plan.md`

源码和官方快照：

- `references/repos/mkfast-template`
- `references/repos/open-tanstarter`
- `references/repos/mastra`
- `references/docs/official/cloudflare/workers-limits.md`
- `references/docs/official/cloudflare/d1-limits.md`
- `references/docs/official/cloudflare/r2.md`
- `references/docs/official/mastra/`

## Live Sources Used

无。本轮只使用本地 OpenCLI 官方快照、源码镜像和前序分析。上线前仍需刷新平台能力、模型价格和部署供应商限制。

## Component Decisions

### 1. App Shell

决策：fork `references/repos/mkfast-template`。

负责：

- TanStack Start app structure.
- 登录、注册、session、邮箱验证。
- Better Auth admin / API key / session 基础能力。
- dashboard、settings、admin、billing、legal、public pages。
- Stripe/Creem 这类 payment portal 入口。
- R2 upload/proxy 机械能力。
- BFF/server functions：只做 session 检查、请求转发、轻量参数校验。
- 调用 Core API、Agent Service 的 typed adapter。

不负责：

- Store Workspace 授权。
- Store Profile、Real Asset Library、Content Core、Platform Variant。
- Publish Package / Publish Job。
- Compliance Gate。
- Usage Ledger / Provider Cost Ledger。
- Lead Ledger。
- 平台能力矩阵和账号级 verified 状态。

理由：

- `mkfast-template` 已有完整 SaaS 壳，能减少 P0 壳层时间。
- 现有 D1 schema 是 user-centric，只有 `payment` 和 `user_files` 这类壳层表。
- 本产品是 workspace/store-centric，而且有版本、账本、审计和合规状态机，不能塞进 D1 app schema。

### 2. Core API

决策：独立 TypeScript HTTP service，Postgres + Drizzle，作为产品事实来源。

负责：

- Workspace membership and store authorization.
- Store Profile / Store Services / Store Prices.
- Platform Accounts and Platform Capability Matrix.
- Real Asset Library metadata and rights.
- Content Core and Platform Variants.
- Compliance Gate and AIGC labels.
- Publish Packages, Publish Jobs, Publish Attempts, Publish Observations.
- Lead Ledger and Weekly Reports.
- Usage Ledger and Provider Cost Entries.
- Agent runs, tool calls, model calls summaries.
- Audit Events.
- Feature flags and entitlement projection.
- Durable job records and idempotency.

关键原则：

- 每个产品请求都带 `workspace_id` 和 actor。
- `store_id` 必须属于当前 workspace。
- 每个高风险写操作都有 idempotency key 和 audit event。
- 普通用户不能 override `P0_BLOCK`。
- Agent、worker、平台回调都只能通过 Core API 改产品事实。

### 3. Database

决策：

- D1：只保留 Better Auth、session、API key、shell-local payment entry、shell-local upload metadata。
- Postgres：承载全部产品事实、账本、合规、审计、agent run 摘要和 job records。
- pgvector：P0 可预留给素材/历史内容/template embeddings，但不作为价格、资质、合规、账号能力事实来源。

原因：

- D1 单库大小、单线程处理、查询时间和 Workers runtime 约束不适合 ledger-heavy、audit-heavy、workflow-heavy 的产品域。
- Postgres 更适合事务、版本、锁、`SKIP LOCKED` job claiming、审计查询、复杂索引和后续 pgvector。

### 4. Object Storage

决策：Cloudflare R2 作为二进制对象存储。

存：

- 原始素材。
- 处理后的素材版本。
- 图文卡片、长图、发布包导出文件。
- 授权凭证截图或文件。
- font files and render artifacts where needed.

不存：

- 权限、授权状态、内容事实、发布状态、合规状态、用量余额。

所有可查询事实都在 Postgres；R2 key 只作为 artifact reference。

### 5. Agent Service

决策：独立 Node service，内部使用 Mastra Workflows/Agents/Tools。

负责：

- `GenerateWeeklyContentWorkflow`
- `RewriteContentWorkflow`
- `CreatePublishPackageWorkflow`
- `WeeklyReportWorkflow`
- focused generation agents：copy, platform adapt, video script, weekly insight.
- model provider adapter calls.
- workflow state、trace、debug memory、eval/scorer results.

不负责：

- 门店档案、价格、素材授权、内容版本、合规结论、发布状态、线索、用量、账号凭据。
- 商家端不直接访问 Mastra `/agents`、`/workflows`、`/tools`。
- app shell 和 Core API 不 import Mastra types。

对外只暴露产品语义 API：

```text
POST /agent-runs/generate-weekly-content
POST /agent-runs/rewrite-content
POST /agent-runs/create-publish-package
POST /agent-runs/weekly-report
GET  /agent-runs/:id
GET  /agent-runs/:id/events
POST /agent-runs/:id/cancel
POST /agent-runs/:id/approve
```

### 6. Worker Pool

决策：独立 Node container workers，和 app shell 分离。

负责：

- schema-driven SVG templates compile.
- `resvg-js` rasterization.
- `sharp` resize/composite/format/metadata/sidecar.
- Playwright QA screenshots and fallback screenshots.
- image normalization, crop, color profile, CJK font loading.
- rendered artifact upload to R2.
- selected long-running asset processing tasks.

不负责：

- 判断素材是否授权。
- 修改内容事实。
- 决定合规是否通过。
- 扣费或退款。

Worker 输入必须由 Core API 创建 job；Worker 输出必须回写 Core API，由 Core API commit usage、写 audit、记录 artifact。

### 7. Queue And Background Jobs

决策：P0 用 Postgres-backed durable job table；不要把 Mastra background tasks 当产品级队列。

最小能力：

- `job_type`: agent_run / render / publish_probe / report.
- `status`: queued / leased / running / succeeded / failed / cancelled.
- `idempotency_key`.
- `lease_until`.
- `attempt_count`.
- `max_attempts`.
- `next_run_at`.
- `priority`.
- `progress`.
- `error_code` / `error_message`.
- usage reservation id.
- correlation id.

执行规则：

- Core API 创建 job and reserves usage.
- Worker/Agent claims job with lease.
- Success commits usage and records output.
- Failure refunds or schedules retry.
- Cancel writes audit and releases lease.

未来触发条件：

- 当 Postgres queue 出现明显吞吐瓶颈或多区域复杂度，再切 Redis Streams / BullMQ / Inngest / managed queue。
- 切换不能改变产品事实来源；job result 仍回 Core API/Postgres。

### 8. Provider Registry And Eval Gate

决策：Provider Registry 和 Eval Gate 归 Core API/Postgres；Agent Service 只执行 adapter。

表：

- `model_providers`
- `model_specs`
- `model_routes`
- `model_calls`
- `provider_cost_entries`
- `eval_runs`
- `eval_case_results`

规则：

- Prompt/model route 变更必须跑本地 JSONL eval。
- `scorecard.mjs --strict` 是第一版 CI gate。
- hard failures 不能靠加权分补偿。
- 线上 Mastra Evals 只做异步抽样和 trace scorer，不做生产合规阻断。
- Core API Compliance Gate 是最终阻断。

### 9. Compliance And Audit

决策：Compliance Gate 是 Core API 一等域能力。

强制检查点：

- 素材入库。
- Content Core 保存前。
- Platform Variant 保存前。
- 图片/视频/发布包导出前。
- L1/L2 提交前。
- 用户改字、换图、改价格后。

硬规则：

- `block` 禁止导出、浏览器准备、官方提交。
- `P0_BLOCK` 普通用户不可 override。
- AIGC 显式/隐式标识默认保留。
- 医美/医疗内容进入 Regulated Content Mode，发布、导出、浏览器准备、官方提交前必须做 Publish Compliance Preflight。
- 伪造资质、未授权案例、去 AIGC 标识、绕平台审核、疗效/安全性保证、治愈率/有效率承诺必须 `block`。
- 未授权顾客素材不进入公开发布包。
- 价格和优惠必须有来源。
- 平台能力未 account-level verified 时不进入 L1 submit。

审计覆盖：

- workspace/member/role.
- store profile/service/price/policy.
- asset upload/version/rights.
- content and variant versions.
- compliance check/findings/user confirmation.
- AIGC label injection.
- publish package/job/attempt/downgrade.
- lead record/link/followup.
- usage reserve/commit/refund/adjust.
- platform credential rotation/revoke.
- support/admin access.

### 10. Publish Route

决策：所有平台默认 L3 Publish Package。

平台路线：

- WeChat Official Account：第一条 L1 是 draft creation，`freepublish` 单独 flag。
- Douyin：OpenAPI/share 先做 validation，不默认承诺自动发布。
- Xiaohongshu：L3 only；L2 browser preparation 仅灰度、无 final submit。
- Meituan/Dianping：L3 content package + lead/attribution validation，不承诺内容自动发布。

Core API 拥有：

- `platform_capabilities`.
- `platform_capability_evidence`.
- `platform_account_capabilities`.
- `publish_jobs`.
- `publish_attempts`.
- `publish_observations`.

### 11. Deployment Environments

P0 至少三套环境：

| Environment | Purpose | Notes |
|---|---|---|
| local | developer loop | local Postgres, R2 mock/local bucket, local services |
| staging | merchant validation / internal QA | real Postgres/R2, fake or sandbox providers where possible |
| production | paid pilot | strict secrets, audit retention, backups, eval gate |

部署形态：

- App shell：Cloudflare Workers Paid + D1 + R2 binding.
- Core API：containerized Node service, managed Postgres.
- Agent Service：containerized Node service, Node >= 22.13, private network access where possible.
- Worker Pool：containerized Node workers, CPU/memory sized for sharp/resvg/Playwright.
- Postgres：managed service with daily backups and PITR if available.
- R2：separate buckets by environment.
- Secrets：Cloudflare Worker secrets + container platform secrets; platform credentials stored as secret refs, not plaintext Postgres.

P0 不要求先锁死具体 container provider；关键是 Node container runtime、managed Postgres、private service-to-service auth、repeatable deploy。

## API Boundaries

### App Shell -> Core API

Use typed HTTP client; app shell passes authenticated identity, Core API resolves workspace membership.

Do not let app shell compute product authorization from `session.user.role`.

### Core API -> Agent Service

Core API creates `agent_runs`, reserves usage, then calls Agent Service with:

- `workspace_id`
- `store_id`
- `actor_id`
- `agent_run_id`
- `feature_flags`
- `correlation_id`

Agent Service calls Core API tools for every business read/write.

### Core API -> Worker Pool

Core API creates durable job and usage reservation.

Workers claim job, fetch signed/internal R2 assets, process, write result through Core API, then Core API commits/refunds usage.

### Platform Webhooks

App shell or Core API can receive webhooks depending on provider, but webhook handler must:

1. verify signature.
2. enqueue or call Core API.
3. never mutate product state without Core API validation.

## P0 Implementation Sequence

1. Fork `mkfast-template` as app shell and hide non-P0 demo surface.
2. Add Core API skeleton with Postgres and identity projection.
3. Connect shell session to Core API membership checks.
4. Implement Store Workspace, Store Profile, Store Services/Prices.
5. Implement Real Asset Library: R2 object + Postgres metadata + rights gate.
6. Implement Usage Ledger reserve/commit/refund.
7. Implement Content Core and Platform Variant versions.
8. Implement Compliance Gate v0 and audit events.
9. Implement Agent Service adapter with one workflow: generate weekly content from mock/seed store.
10. Implement Model Provider Registry v0 and local eval gate.
11. Implement Worker Pool renderer: SVG/resvg/sharp for one cover and one price card.
12. Implement L3 Publish Package export.
13. Implement manual Lead Ledger and weekly report.
14. Only then implement WeChat draft validation and Douyin validation.

## Acceptance Criteria

P0 architecture is acceptable when:

1. No Store Workspace/Product tables are added to `mkfast-template/src/db/app.schema.ts`.
2. A shell user can access product data only after Core API workspace membership check.
3. One store profile can be versioned and used in generated content.
4. One asset upload produces R2 object + Postgres asset/version/rights rows.
5. One generate request reserves usage, runs Agent Service, saves Content Core and Platform Variants, and commits/refunds usage.
6. Platform Variant save always creates a Compliance Check.
7. One render job creates an R2 artifact and Postgres rendered artifact/audit records.
8. One L3 Publish Package can be generated without platform account verification.
9. `block` compliance status prevents export and publish route actions.
10. Model route changes can run local JSONL scorecard before release.
11. Agent Service can be upgraded or replaced without app shell/Core API importing Mastra types.
12. Worker failure does not lose product state and can retry idempotently.

## Rejected Alternatives

| Alternative | Rejection reason |
|---|---|
| Put product domain into D1 app schema | D1/user-centric shell model cannot safely own workspace authorization, ledgers, compliance, audit, content versions, and job records |
| Use `open-tanstarter` as main shell | Too much SaaS shell work would be rebuilt; keep it as Postgres/Better Auth reference only |
| Embed Mastra in app shell | Node/runtime/version/workflow needs do not fit Cloudflare Workers shell boundary |
| Use Mastra Memory as product state | Not suitable for prices, authorization, compliance, publishing, leads, usage, or audit |
| Put renderer in browser/client | Not deterministic, hard to audit, CORS/font/device-dependent |
| Promise L2/browser automation as P0 | Platform and account risk; P0 value must stand on L3 publish packages |
| Use payment records as quota ledger | Payment is collection fact; usage ledger is product consumption fact |

## Open Risks

- Exact container platform remains open; choose during implementation based on private networking, Postgres support, Playwright support, backups, logs, and cost.
- Model prices and model names are unstable; benchmark before provider defaults are frozen.
- CJK font licensing and renderer memory footprint need a production smoke test with real assets.
- Merchant validation may change P0 scope if stores refuse Lead Ledger or only want代运营.
- WeChat/Douyin L1 timelines depend on real account and application verification.

## Decision

Adopt this P0 architecture:

```text
App Shell: mkfast-template fork on Cloudflare Workers
Core API: independent Postgres-backed product service
Agent Service: independent Node/Mastra workflow service
Worker Pool: independent Node workers for render/export/heavy tasks
Database: D1 for shell-local data, Postgres for product facts
Object Storage: R2 for binary objects only
Queue: Postgres-backed durable jobs for P0
Provider Registry: Core API/Postgres
Compliance: Core API/Postgres hard gate
Deployment: local/staging/production with strict service boundaries
```

This is slower than building everything inside the starter, but it prevents the highest-cost failure mode: a polished SaaS shell quietly becoming the un-auditable owner of tenant permissions, content facts, compliance, publishing, usage, cost, and lead records.
