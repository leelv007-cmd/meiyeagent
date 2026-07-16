> ⚠️ **2026-07-07 评审批注**：P0 范围已收缩为"保 7 缓 6 砍 6"（合集 v1.5 Scope Lock），本文 backlog 需按 v1.5 07 章重排后使用；L2 浏览器辅助与凭据保险库相关项移出 P0；架构按 ADR-0006、runtime 按 ADR-0007。

# P0 Backlog And Sprint Plan

审查日期：2026-07-06  
审查对象：美业到店 + 医美/医疗资质准入制商家创作副驾 P0  
结论性质：开发前执行路径、工程 backlog 和 sprint 基线。

> 2026-07-07 覆盖更新：P0 服务资质准入的医美/医疗商家。执行路径仍先跑 L3 闭环；受监管内容不在创作阶段硬拒绝，发布、导出、发布包交接或 L1 官方提交前展示 Preflight 提醒和留痕。L2 浏览器辅助整体移出 P0。

## Question

What implementation backlog and sprint sequence should the team follow once the P0 architecture decision is made?

## 结论

P0 不应直接做成“完整自动运营 SaaS”。正确执行路径是：

1. 先保留 4 周商家验证门槛：`10-20` 家访谈，`3-5` 家 Wizard-of-Oz 内容陪跑。
2. 工程上按 ADR-0006 落地：Workers 壳 + 单 Node 服务（core-api / ai-runner / renderer / jobs 模块）+ 单托管 Postgres。
3. 6 周必须跑通 L3 内容闭环：门店档案、素材授权、内容生成、合规、图文导出、L3 发布包、线索台账、周报。
4. 第 7-8 周只做官方能力验证和付费试点加固，不把 L1/L2 自动化作为 P0 主承诺。
5. 每个 story 都必须有自动测试或手工验收；没有 L3 fallback 的平台能力不得进入 P0 backlog。

P0 的第一目标不是“全平台自动发布”，而是让一家美业到店或医美/医疗内容商家从 `1-2` 小时准备一条内容，下降到 `5-10` 分钟拿到一条可发内容，并能记录内容带来的咨询、加微、预约、团购或核销。

## Agent Team Used

本轮启用三个只读 explorer：

- 产品故事和用户验收 explorer。
- 工程边界和基础设施 backlog explorer。
- 冲刺节奏、里程碑和风险门禁 explorer。

三个 explorer 结论一致：P0 必须先保证可审计 L3 闭环；Core API/Postgres、合规门禁、素材授权、用量账本和审计属于早期承重墙；官方发布能力只能在真实账号验证后作为 feature flag。

## Local Sources Used

- `合集-v1.2-含开源项目选型.md`
- `CONTEXT.md`
- `.scratch/beauty-content-agent-wayfinding/map.md`
- `docs/adr/0001-p0-data-architecture.md`
- `docs/adr/0002-p0-service-architecture.md`
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
- `references/analysis/13-p0-architecture-decision.md`

## Live Sources Used

无。本轮只使用本地调研体系、源码镜像、官方快照和前序分析。进入真实开发前，需要按既有本地机制刷新模型价格、平台权限和部署供应商限制。

## Assumptions

- 首发对象是美业到店：美甲、美睫、美发、SPA、生活美容，并纳入资质准入的医美/医疗内容商家。
- P0 是 Creation Copilot，不是代运营、群控、无人值守发布或完整 CRM。
- 所有平台默认 L3 Publish Package；L1 只在官方文档和账号级验收都通过后启用。
- Lead Ledger 是轻量内容台账，不宣称严格 ROI 因果归因。
- 商家操作者通常是老板、前台或店员，不是专业内容运营。
- 工程实现遵守 `docs/adr/0006-p0-runtime-topology.md` 的单 Node 服务拓扑；ADR-0002 只保留历史动机。

## Workstream Strategy

### Track A: Validation Before Full Build

在完整 P0 build-out 前，先跑商家验证：

1. 访谈 `10-20` 家美业到店和医美/医疗内容商家。
2. 筛选 `3-5` 家进入 `4` 周 WOZ。
3. 每家每周交付 `3` 条内容包，至少 `1` 张图文卡和 `1` 条视频脚本或拍摄清单。
4. 商家必须自己确认、发布或明确拒绝发布。
5. 记录采用率、节省时间、素材缺口、线索记录、合规命中、人工耗时和付费动作。

如果这个验证不通过，只允许继续做底座和验证工具，不应继续投入 L1/L2 发布、复杂账号系统或完整商业化。

### Track B: Build The P0 Spine

P0 主干按以下顺序建设：

1. `mkfast-template` app shell fork。
2. Core API/Postgres skeleton。
3. Workspace、Store、Store Profile、Services、Prices。
4. Real Asset Library：R2 object + Postgres metadata + rights gate。
5. Usage Ledger reserve/commit/refund。
6. Content Core and Platform Variant versions。
7. Compliance Gate v0 and audit events。
8. ai-runner Runtime Port and one weekly generation workflow。
9. Model Provider Registry v0 and local eval gate。
10. Worker Pool renderer：SVG/resvg/sharp。
11. L3 Publish Package export。
12. Manual Lead Ledger and Weekly Report。
13. WeChat draft and Douyin validation only after L3 loop is stable。

### Track C: Pilot Hardening

当 L3 闭环可跑后，再做：

- onboarding flow。
- customer-success/admin views。
- official account validation flags。
- usage/cost reports。
- pilot scorecard。
- support access grants and audit。

## Product Backlog

### Must

| ID | Story | Earliest sprint | Acceptance | Manual verification |
|---|---|---:|---|---|
| M1 | 商家准入、门店档案与首月陪跑基线 | S1 | 能记录门店类型、项目价目、预约方式、人设语气、禁忌话术、是否触发医美/医疗资质准入轻量版、过去 4 周发布基线；价格必须有来源 | 用 1 家门店完成 intake，检查生成内容只使用已确认项目和价格 |
| M2 | 真实素材库与授权门禁 | S1 | 上传素材可标记项目、平台、用途、授权状态、脱敏状态；未授权顾客素材不能进入公开发布包 | 上传顾客脸部图、好评截图、价目表，确认未授权或未脱敏素材被拦截 |
| M3 | 5-10 分钟首条内容测试 | S1 | 新店能基于档案和 3-5 个素材产出标题、正文、话题、封面建议、平台建议、转化钩子、合规提示；`70%` 门店 5-10 分钟内看到可评价内容 | 现场计时，让商家标记直接发、小改、大改或拒绝 |
| M4 | 本周 3-5 条内容生成 | S2 | 每周生成 3-5 条内容卡，覆盖文案、平台建议、图文建议、至少 1 条视频脚本或拍摄清单；采用和拒绝原因可记录 | 对 3-5 家门店连续 4 周交付，统计采用率是否达到 `60%` |
| M5 | 内容库、平台变体与版本状态 | S2 | 内容按 Content Item 管理，可保存小红书、抖音、点评/美团、公众号变体、版本、草稿/待发布/已发布状态、合规状态 | 修改同一内容的两个平台版本，确认版本、状态、平台链接可追踪 |
| M6 | 图文卡片与导出 | S3 | 支持小红书封面、before/after、价格卡、好评卡；可替换图片、自动填项目/价格/门店名、导出平台尺寸 | 用真实素材导出 1 张封面和 1 张价格卡，人工检查文字、尺寸、素材来源 |
| M7 | Compliance Gate 与 AIGC 标识 | S2 | 保存、导出、发布包前检查广告敏感词、医美/医疗资质准入轻量版、价格来源、素材授权；受监管内容发布前核验提醒覆盖率 100%；AIGC 标识 100% 记录/注入 | 输入“水光针”“全网最低”“100% 不伤甲”“无来源价格”，确认受监管内容触发核验提醒，硬风险阻断或给替代表述 |
| M8 | L3 发布包与发布任务 | S3 | 每条内容可生成 L3 包：文案、素材顺序、封面文案、话题、发布步骤、合规提示、线索记录字段；无需平台账号验证也可交付 | 商家照发布包人工发布或明确拒绝，记录发布时间、链接、拒绝原因 |
| M9 | 手工线索台账与内容关联 | S4 | 可登记私信、评论、加微、预约、团购券、核销、到店；每条线索能关联内容和平台；`60%` 门店至少记录 1 条关联线索 | 发布后手工录入 1 条加微或预约，检查周报能追到来源内容 |
| M10 | 周报与下一轮建议 | S4 | 每周输出采用、发布、线索、素材缺口、下周内容建议；不宣称严格 ROI 因果归因 | 用一周试点记录生成周报，让商家判断是否愿意继续或付费 |
| M11 | 账号中心与平台能力矩阵 | S5 | 可记录平台账号、主页链接、人设、授权状态、健康状态；未 account-level verified 的平台只能走 L3，不进入 L1 submit | 绑定小红书、抖音、点评链接，确认能力未知时仍生成 L3 包，不显示自动发布承诺 |
| M12 | 用量、审计与试点指标记录 | S1-S5 | 记录内容生成、渲染、发布包、线索、合规、人工耗时、商家审阅耗时、付费信号；失败任务可退款/重试或人工标记 | 抽查一条内容从生成到线索的全链路记录，确认可复盘成本和采用原因 |

### Should

- 微信公众号 draft creation 真实账号验证。
- 抖音 OpenAPI/share 真实账号和应用权限验证。
- 发布耗时探针：只记录 L3 发布包从打开到人工发布的耗时，不做小红书 L2 灰度。
- 客户成功后台：素材缺口、采用率、合规命中、连续未发布门店。
- 更多图文模板和多尺寸导出。
- Provider Registry、benchmark runner 和 local eval gate 的 CI 接入。
- 支付、套餐、用量展示的商业化增强。

### Later

- 内容日历。
- 账号 packs。
- 团队协作。
- 轻视频生成。
- 统一收件箱、意图分类、自动回复建议。
- 多店或代运营工作台。
- 行业模板市场。
- 跨垂类复制。

## Engineering Backlog By Boundary

### App Shell

| Backlog | Dependency | Earliest | Load-bearing | Smoke / check |
|---|---|---:|---|---|
| Fork `mkfast-template`，隐藏非 P0 demo surface，保留 auth/dashboard/settings/admin/billing/storage | none | S0 | no | 本地启动；登录、注册、dashboard、settings、admin 可渲染 |
| 冻结 shell/domain 边界：D1 只保留 Better Auth、session、API key、shell-local payment/upload | ADR 0001/0002 | S0 | yes | 自动检查 `mkfast-template/src/db/app.schema.ts` 不出现 product tables |
| Typed Core API client / BFF adapter，只转发身份、参数和 correlation id | Core API skeleton | S1 | yes | shell user 访问 product data 必须经过 Core API membership check |
| 产品入口路由：store setup、asset library、weekly generation、variant editor、publish package | Core API endpoints | S2 | no | mock store 能在 UI 跑到 3-5 张 content cards |
| Upload/proxy 复用 R2 机械能力，metadata 改由 Core API 管 | Postgres/R2 asset tables | S1 | no | 上传后 R2 有 object，Postgres 有 asset/version/rights |

### Core API

| Backlog | Dependency | Earliest | Load-bearing | Smoke / check |
|---|---|---:|---|---|
| 独立 TypeScript HTTP service + Postgres + Drizzle skeleton | local Postgres | S0 | yes | `/health`、migration、seeded workspace/store 可读 |
| Identity projection：`identity_users` 映射 Better Auth user | App Shell auth | S1 | yes | shell session user 被 Core API 投影并可查 membership |
| Workspace/store authorization：所有 product request 校验 `workspace_id`、actor、`store_id` 归属 | identity/workspace tables | S1 | yes | 非成员读写返回 403；不能靠 `session.user.role` 授权 |
| Store Profile / Services / Prices 版本化事实 | workspace/store auth | S1 | yes | 生成含价格内容只能引用有效 price source |
| Content Core / Platform Variant 版本表 | store facts, compliance v0 | S2 | yes | 用户改标题、正文、价格或图片顺序生成新 version 并触发 compliance |
| Durable jobs：Postgres-backed job lease、retry、cancel、idempotency | job schema, usage ledger | S1 | yes | worker/agent claim `SKIP LOCKED`；失败可 retry 且不重复 commit |
| Usage Ledger：reserve/commit/refund/adjust + provider cost entries | workspace auth | S1 | yes | generation success commit；failure/cancel refund；重复 idempotency key 不重复扣费 |

### Agent Service

| Backlog | Dependency | Earliest | Load-bearing | Smoke / check |
|---|---|---:|---|---|
| 单 Node 服务内 ai-runner 模块，Vercel AI SDK + Runtime Port | container runtime | S1 | yes | Core API 可用 `workspace_id/store_id/user_id/agent_run_id` 调用 |
| Runtime Port：`generateWeeklyContent/rewrite/createPublishPackage/cancel/approve/streamEvents` | service skeleton | S1 | yes | App Shell/Core API 不 import Mastra types |
| Core API tools：store read、asset search、usage、copy、platform adapt、video script、compliance、content save、publish package | Core API endpoints | S2 | yes | 每个 tool 有 schema；写操作只通过 Core API；写 `tool_calls` |
| `GenerateWeeklyContentWorkflow` v0 | tools, provider route | S2 | no | mock store + mock assets 生成 3-5 张卡，失败 refund，成功保存内容 |
| Minimal observability：agent_runs、steps/tool/model call summary | Core API tables | S2 | no | 一次生成可追踪 prompt、model、tool、cost、correlation id |

### Worker Pool

| Backlog | Dependency | Earliest | Load-bearing | Smoke / check |
|---|---|---:|---|---|
| 独立 Node container worker，不放 Cloudflare Workers | container runtime | S1 | yes | worker 可 claim render job 并心跳/释放 lease |
| Render job contract：Core API 创建 job，worker 只处理输入，不决定权限/合规/扣费 | Core API durable jobs | S2 | yes | 无 Core API job 时 worker 不能直接生成 artifact |
| SVG compiler v0：小红书封面、价格卡、发布包长图 | template schema, font assets | S3 | no | 同一输入 SVG hash 稳定 |
| `resvg-js` rasterize + `sharp` normalize/compress/metadata sidecar | R2, fonts | S3 | yes | 真实或占位素材输出 PNG，上传 R2，Postgres 写 artifact/audit |
| Playwright QA fallback/golden screenshots | renderer v0 | S4 | no | 5 个 golden：封面、价格卡、超长标题、无授权拒绝、AIGC 裁剪 |

### Postgres And R2

| Backlog | Dependency | Earliest | Load-bearing | Smoke / check |
|---|---|---:|---|---|
| Postgres migrations：product facts、usage、compliance、agent/tool、audit | Core API skeleton | S0 | yes | migration up/down；关键唯一约束和索引存在 |
| R2 bucket per env：original assets、render artifacts、export files、consent evidence | env setup | S1 | yes | signed/internal URL 读写；R2 key 不当事实来源 |
| Real Asset Library：assets、asset_versions、asset_rights、asset_usages | R2, Core API auth | S1 | yes | 未授权顾客素材不能进入 public package/export |
| Render artifacts tables：graphic templates、render_jobs、rendered_artifacts、font_assets | Worker Pool renderer | S3 | no | artifact 可从 content/version/compliance/audit 回溯 |
| Backup/retention posture：audit、usage、compliance、publish attempt 不硬删 | managed Postgres | S5 | yes | 删除草稿不删除 ledger/audit/compliance 记录 |

### Provider And Eval

| Backlog | Dependency | Earliest | Load-bearing | Smoke / check |
|---|---|---:|---|---|
| Provider Registry schema：providers/specs/routes/model_calls/eval_runs/results | Core API migrations | S1 | yes | route lookup 有 primary/fallback/budget/timeout |
| Provider adapter interface：验证期混用 + 国产模型 Day-0 benchmark；顾客 PII/人脸不进海外 API | ai-runner runtime port | S2 | yes | mock provider call records `model_calls` + `provider_cost_entries` |
| Local JSONL eval gate wired to CI: `scorecard.mjs --strict` | eval prototype | S1 | yes | coverage 100%，hard failure 0，avg >= 0.82，min case >= 0.72 |
| Prompt/model route versioning | Provider Registry | S2 | yes | route change without eval run fails release check |
| Benchmark runner | adapters, eval dataset | S3 | no | one provider run produces scored JSON output |
| Production async sampling | model call logging | S5 | no | warn/needs_review 100% sampled；user heavy edits enter drift pool |

### Compliance And Audit

| Backlog | Dependency | Earliest | Load-bearing | Smoke / check |
|---|---|---:|---|---|
| Compliance Gate v0 tables：rule sets/checks/findings/AIGC labels/user confirmations | Core API migrations | S1 | yes | `P0_BLOCK` ordinary user cannot override |
| Deterministic rules：医美/医疗资质准入轻量版、绝对化广告、价格证据、素材授权、AIGC 标识、PII | Store/Asset/Content data | S2 | yes | 发布前核验提醒覆盖，hard cases fail before export/publish |
| Save hooks：Content Core、Platform Variant、publish package/export 前强制 check | content/publish endpoints | S2 | yes | variant save always creates compliance check |
| Audit Events across high-risk writes | Core API auth | S1 | yes | store/profile/asset/content/usage/compliance/publish writes all emit audit |
| Support/admin access grants | workspace auth | S5 | no | support access requires grant and audit event |
| AIGC label injection and lock in render/export | Worker Pool renderer | S3 | yes | label visible and not cropped in exported image |

### Deployment

| Backlog | Dependency | Earliest | Load-bearing | Smoke / check |
|---|---|---:|---|---|
| Local compose/dev env：app shell、Core API、Agent Service、Worker Pool、Postgres、R2 mock/bucket | service skeletons | S0 | yes | one command boots all services；health checks pass |
| Service-to-service auth and correlation id | Core API, Agent, Worker | S1 | yes | unauthenticated internal call rejected；correlation id visible across logs |
| Staging env：real Postgres/R2, sandbox/fake providers | local env stable | S3 | yes | seeded merchant flow runs end-to-end |
| Production env posture：secrets、backups/PITR、audit retention、strict provider keys | staging | S5 | yes | no plaintext platform credentials in Postgres |
| Cloudflare Workers app shell deploy with D1/R2 bindings | App Shell fork | S1 | no | deployed shell can call staging Core API via typed adapter |
| Container deploy for Agent/Worker with Node >= 22.13 and Playwright/sharp deps | Agent/Worker | S3 | yes | render smoke passes in container, not only local machine |

## Sprint Plan

### S0: Local Foundation, 3-5 Days

目标：搭起本地开发底座并冻结边界。

产物：

- Fork `mkfast-template` app shell。
- Core API/Postgres skeleton。
- local compose/dev env。
- Postgres migrations baseline。
- service-to-service auth draft。
- shell/domain boundary check。

验收：

- 一条命令启动 app shell、Core API、Postgres、Agent stub、Worker stub。
- `/health` and migrations pass。
- `mkfast-template/src/db/app.schema.ts` 没有 Store Workspace/Product tables。
- App shell 不能绕过 Core API 读取 product data。

### S1: Store Facts And Asset Rights, Week 1

目标：完成门店事实和素材授权的最小闭环。

产物：

- identity projection。
- workspace membership and store authorization。
- Store Profile / Services / Prices。
- Real Asset Library。
- R2 upload object + Postgres metadata。
- Usage Ledger and Audit Events baseline。
- Compliance Gate tables and P0 hard blocks seed。
- Provider Registry schema and eval gate skeleton。

验收：

- 1 家门店可建档并版本化。
- 1 个素材上传后产生 R2 object + asset/version/rights rows。
- 未授权顾客素材不能进入 public package/export。
- 生成价格内容只能引用有效 price source。
- 非成员读写 product data 返回 403。

### S2: Content And Agent Workflow, Week 2

目标：跑通第一条可评价内容和本周 3-5 条内容。

产物：

- Content Core。
- Platform Variant versions。
- ai-runner Runtime Port skeleton。
- Runtime Port。
- Core API tools。
- `GenerateWeeklyContentWorkflow` v0。
- first model provider adapters or mocks。
- Compliance save hooks。

验收：

- 新店基于门店档案和 3-5 个素材产出可评价内容。
- 一个 generate request reserves usage、runs Agent Service、saves Content Core and Platform Variants、commits/refunds usage。
- variant save always creates Compliance Check。
- app shell/Core API 不 import Mastra types。
- prompt/model route change without eval run cannot release。

### S3: Compliance, Rendering, And L3 Package, Week 3-4

目标：完成合规阻断、图文导出和 L3 发布包。

产物：

- Compliance Gate v0 deterministic rules。
- AIGC label injection and export lock。
- Worker Pool render contract。
- SVG compiler v0。
- `resvg-js` + `sharp` raster path。
- 小红书封面、价格卡、发布包长图。
- L3 Publish Package UI/API/export。
- PublishRouteResolver default L3。

验收：

- 输入医美/医疗等受监管内容时触发发布前核验提醒；绝对化广告、无来源价格、未授权素材按风险阻断或进入人工复核。
- 合规 `block` 禁止导出、发布包交接和官方提交。
- 1 个 render job 创建 R2 artifact + Postgres rendered artifact/audit records。
- 任意平台合规通过后可生成 L3 发布包。
- L1 未 verified 时自动降级 L3。

### S4: Lead Ledger And Weekly Report, Week 5

目标：补齐价值闭环和试点记录。

产物：

- Lead Ledger。
- content-to-lead link。
- manual publish link/status。
- Weekly Report。
- merchant trial scorecard fields。
- failure/refund/retry reporting。

验收：

- 发布后可手工录入私信、评论、加微、预约、团购券、核销或到店。
- 每条线索能关联 content/platform。
- 一周记录可生成周报和下周建议。
- 抽查一条内容从生成到线索的全链路可复盘。

### S5: Pilot Hardening, Week 6

目标：让 3-5 家 WOZ/试点门店能连续使用。

产物：

- onboarding flow。
- customer-success/admin views。
- adoption/rejection reason tracking。
- support access grants。
- staging env seeded merchant flow。
- backup/retention posture。

验收：

- 试点门店每周可产出或发布 3 条。
- `60%` 门店至少记录 1 条内容关联线索。
- 合规硬失败为 0。
- support access requires grant and audit event。
- staging 跑通 seeded merchant end-to-end。

### S6: Official Capability Validation, Week 7 Optional

目标：验证 L1/L2 能力，不扩展产品承诺。

产物：

- `platform_capabilities` seed。
- 微信公众号草稿真实账号验收。
- 抖音 OpenAPI/share validation plan。
- 小红书/抖音医美类目发布权限真实账号实测设计。
- 美团/点评线索台账和 attribution validation plan。

验收：

- 未 account-level verified 的平台只能 L3。
- `platform_capabilities.status = doc-only` 时只输出验证计划，不进入 production submit。
- 微信 draft and freepublish are separate feature flags。
- L2 不做 final submit、captcha bypass、cookie extraction、hidden API call。

### S7: Paid Pilot Readiness, Week 8 Optional

目标：准备 10 家真实付费试点。

产物：

- paid pilot checklist。
- pricing/usage display。
- pilot scorecard dashboard。
- cost report and provider cost entries。
- release checklist。

验收：

- 至少 10 家真实付费或付定金进入试点 pipeline。
- 第 2-4 周留存目标 `>=50%`。
- `>=3` 家明确愿意续费或续跑。
- 单店内容产出、采用、发布包使用、线索记录、人工陪跑耗时可计算。

## Go / No-Go Gates

### Gate 0: Start Build

Go：

- 已完成至少 10 家访谈，或者已有明确试点名单和素材收集计划。
- 有 3-5 家愿意进入 4 周 WOZ。
- 商家接受“发布包 + 人工确认发布”，不要求全自动代运营。

No-Go：

- 用户只愿意为“AI 写文案”付 `<=99/月`。
- 多数门店无法持续提供真实素材。
- 需要承诺 GMV、全托管代运营或全自动发布才愿意付费。

### Gate 1: Continue After S2

Go：

- 70% 商家能在 5-10 分钟看到可评价内容。
- 60% 内容达到直接发或小改后发。
- 受监管内容发布前核验提醒覆盖率 100%，无来源价格或未授权素材不进入公开包。

No-Go：

- 内容采用率低于 40%。
- 内容不像本店，主要原因不是 prompt，而是缺少真实素材和门店事实。
- 合规拦截经常误漏，无法靠规则和人工复核控制。

### Gate 2: Enter Paid Pilot

Go：

- 3-5 家完成 4 周 WOZ。
- 每店每周至少产出或发布 3 条内容。
- `>=60%` 门店记录至少 1 条内容关联线索。
- 至少 3 家愿意续费、续跑或付定金。
- 合规硬失败为 0。

No-Go：

- 线索台账没人记，无法形成闭环感。
- 商家只要代运营，不愿自己确认发布。
- 人工陪跑耗时无法推导出合理毛利。
- P0 必须依赖 L1/L2 自动发布才有价值。

## Technical Load-Bearing Walls

必须不晚于 S1 完成：

- 服务边界冻结。
- Core API/Postgres skeleton。
- workspace membership and identity projection。
- service-to-service auth and correlation id。
- Postgres durable jobs。
- Usage Ledger。
- Compliance/Audit 基础表。
- Provider Registry/Eval Gate。
- R2 只存二进制，Postgres 存事实。

必须不晚于 S2-S3 完成：

- Agent/Mastra adapter 隔离。
- variant 保存强制 compliance。
- deterministic server-side renderer。
- AIGC label locked export。
- L3 Publish Package fallback。

## Automated And Manual Checks

最小自动检查：

1. `app.schema.ts` 不出现 Store/Product domain tables。
2. Core API non-member access returns 403。
3. R2 upload creates Postgres asset/version/rights rows。
4. Generate request reserves and commits/refunds usage exactly once。
5. Variant save always creates Compliance Check。
6. `P0_BLOCK` cannot be overridden by ordinary user。
7. Render job writes R2 artifact plus Postgres artifact/audit records。
8. `block` status prevents export and publish route actions。
9. Prompt/model route change requires local JSONL eval gate。
10. Worker/Agent job retry is idempotent。

最小手工验收：

1. 1 家真实门店 intake。
2. 3-5 个素材生成首条内容，现场计时。
3. 导出 1 张小红书封面和 1 张价格卡。
4. 生成 1 个 L3 发布包并让商家照包发布或拒绝。
5. 手工记录 1 条线索并生成周报。
6. 微信公众号草稿、抖音、小红书、美团/点评只做能力验证，不做 P0 商业承诺。

## Not P0

以下能力明确不进入 P0：

- 一个 Agent 自主运营所有账号。
- 多平台一键全自动发布。
- L2 浏览器自动化替代官方能力。
- 绕过验证码、cookie 抽取、hidden API。
- 小红书自动发布笔记。
- 点评/美团内容自动发布。
- 7x24 自动回复和完整统一收件箱。
- 复杂 CRM、SCRM、POS、收银、会员系统。
- 自动投放、GMV 承诺、全托管代运营。
- 复杂因果归因。
- 多门店集团管理。
- 跨垂类模板市场。
- 未接入资质准入和 Preflight 的医美、医疗、教培等强监管内容首发。
- 真视频生成、数字人口播、人声克隆、真人换脸。
- AgentController、Durable Agent 或 multi-agent supervisor 作为 P0 主链路。

## Follow-Up Tickets

可在第 12 张之后拆成工程 issue：

1. Create app shell fork and boundary check.
2. Create Core API/Postgres skeleton and migrations.
3. Implement workspace membership and identity projection.
4. Implement Store Profile, Services, Prices.
5. Implement Real Asset Library and R2 metadata flow.
6. Implement Usage Ledger and durable jobs.
7. Implement Compliance Gate v0 and audit events.
8. Implement Content Core and Platform Variant versions.
9. Implement Agent Service Runtime Port and weekly generation workflow.
10. Implement Provider Registry and local eval gate.
11. Implement Worker Pool renderer and golden checks.
12. Implement L3 Publish Package.
13. Implement Lead Ledger and Weekly Report.
14. Implement pilot admin/customer-success dashboard.
15. Validate WeChat draft and Douyin account capability behind feature flags.

## Decision

Adopt this backlog and sprint sequence as the P0 execution baseline:

```text
S0: local foundation and boundary freeze
S1: store facts, asset rights, usage, audit
S2: content core and Agent workflow
S3: compliance, rendering, L3 publish package
S4: lead ledger and weekly report
S5: pilot hardening
S6 optional: official capability validation
S7 optional: paid pilot readiness
```

P0 succeeds only if the L3 loop works without unsafe automation: store facts -> authorized assets -> generated content -> compliance -> rendered artifacts -> publish package -> manual lead ledger -> weekly report -> next content suggestions.
