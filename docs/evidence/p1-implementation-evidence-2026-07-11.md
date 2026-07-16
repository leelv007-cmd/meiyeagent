# P1 全票实施证据（2026-07-11）

> 状态说明：这是 implemented-recorded 证据包，不是 P1 功能完成证明。按 D01，当前仍需至少一条真实供应商端到端商家链路与留证。
>
> 历史边界：本证据固定于 `44435ec`（2026-07-11）；后续 D05–D07 的 ContentPackage 结构性收敛、真实链路和管理配置票据不由本包证明。当前待实现状态以 `docs/specs/contentpackage-productization-spec.md`、`.scratch/contentpackage-productization/MAP.md` 和当前代码/测试为准。

Status: `implemented-recorded`

Baseline: `44435ec feat: apply P1 revision plan`

## 口径

- 35 张票的应用层、持久化、本地运行、管理面和用户界面已实现。
- 模型、网关、抖音和飞书在无外部密钥时使用可重放的 recorded contract；未激活的真实能力不冒充为可用。
- 创作与编辑默认放开；品牌水印和 AIGC 标识均为显式开关；不在创作阶段增加法务门禁。
- 下文的“已实现”不等于“已通过封闭付费 Beta 发布 Gate”；真实账号、付费流量、法务终审和试点指标仍属发布证据。

## 35 张票的代码证据

| 票 | 状态 | 主要交付与证据 |
|---|---|---|
| 01 | implemented-recorded | `p1/foundation/application-service.ts` 建立统一 Command/Query/Idempotency seam，HTTP、Worker 和各 P1 module 共用。 |
| 02 | implemented-recorded | `product/relational-product-state.ts`、`relational-product-repository.ts` 承接门店、素材、内容和版本关系事实；cutover dry-run 会报告请求平台与历史落库平台错配。 |
| 03 | implemented-recorded | 关系 Product repository 承接视频、发布包、线索和审计事实；`redeemed/lost/invalid` 线索终态单调不可回退，并保留 P0 旅程。 |
| 04 | implemented-recorded | `p1/foundation/entitlement-service.ts`、`entitlement-policy.ts` 交付 Pro/加购项、预留、提交、释放、退还和可追溯用量账本。 |
| 05 | implemented-recorded | `p1/job-runtime/pg-boss-job-port.ts` 交付 durable JobPort、独立 worker heartbeat、runner outcome、PostgreSQL 运行指标、恢复和 Graphile Worker 对照证据。 |
| 06 | implemented-recorded | `p1/cutover/` 交付双读校验、回滚阻断、重新 cutover、不可变开场 ID 和实际额度往返。 |
| 07 | implemented-recorded | `p1/model-supply/catalog.ts`、`index.ts` 交付版本化 CatalogModel、ProviderProfile、ExecutionChannel、Deployment、capability/price/route/lifecycle revision；Admin 可编辑完整目录并走发布生命周期，发布以客户端所见 head 执行 PostgreSQL CAS 防止并发覆盖，用户只见稳定业务模型。 |
| 08 | implemented-recorded | ModelSupply 交付 GenerationJob、Attempt、ProviderCost、自有 Asset、任务 TTL、response-loss 恢复、取消竞态与双账契约。 |
| 09 | implemented-recorded | RouteSnapshot 冻结目录/价格/区域/凭据/策略、Provider/Channel/交易对手/credential owner；`allowedDataClasses` 同时约束普通与冻结路由，敏感分类不出境；后台 simulator 复用正式路由判定。 |
| 10 | implemented-recorded | OpenAI/Anthropic/Gemini recorded contract 与 OpenAI-compatible 真实单次执行端口；Auto 仅对 LLM 开放。 |
| 11 | implemented-recorded | `GptImage2RecordedAdapter` 实现生图/改图、参考输入、逻辑超时、逐码结构化错误、取消、TTL Asset 与独立成本契约。 |
| 12 | implemented-recorded | `NanoBanana2RecordedAdapter`、`NanoBananaProRecordedAdapter` 各自固定 capability/price/lifecycle，并共用可恢复媒体状态机。 |
| 13 | implemented-recorded | `Seedream5ProRecordedAdapter` 接入国内 Deployment、白名单错误、图像任务、TTL 和 Asset 链。 |
| 14 | implemented-recorded | `Seedance2RecordedAdapter` 接入 durable submit/poll/cancel/download、download-only retry 与 cancel 后 late terminal 对账。 |
| 15 | implemented-recorded | `KlingLatestRecordedAdapter` 接入同一视频任务、late terminal、恢复和 revision 冻结契约。 |
| 16 | implemented-recorded | `GrokLatestVideoRecordedAdapter` 接入 Preview 错误、恢复、取消和 Asset 统一契约。 |
| 17 | implemented-recorded | `VeoLatestRecordedAdapter` 接入地区/Preview 错误、fal Queue 分流、TTL 来源证据和恢复契约。 |
| 18 | implemented-recorded | `p1/integrations/secret-store.ts`、`aws-secret-store.test.ts` 交付服务端 Secret Store、mask、create/rotate/OAuth saga、response-loss 恢复、scope 与 Connection Core。 |
| 19 | implemented-recorded | `p1/integrations/byok.ts`、`foundation-byok-ledger.ts` 交付 workspace strict BYOK、连接检查、隔离账本和显式降级。 |
| 20 | implemented-recorded | `RecordedGatewayPocPort`、Fal/Replicate Adapter 在统一 Port 后隔离 Bifrost/LiteLLM 对照；任务绑定 workspace/credential，报告覆盖部署、许可证、运维、媒体、迁移和回滚证据，网关不拥有产品事实。 |
| 21 | implemented-recorded | `p1/operations/application-service.ts`、`content-task-inbox.tsx` 交付可恢复任务收件箱、异常聚类、状态/来源链、facet 和筛选。 |
| 22 | implemented-recorded | 周批次/素材缺口/久未确认草稿/周回顾内置 Trigger，含调度幂等；通知已送达但 receipt 丢失时以稳定 effect key 对账，不重复业务副作用，并补齐审计与指标。 |
| 23 | implemented-recorded | Weekly Batch 交付短事务 claim、lease token fencing、排除原因、Product/Operations 批次、薄回顾和下周候选确认。 |
| 24 | implemented-recorded | 七个官方模板族、版本、百分比灰度/全量、退役、历史作品固定和用户快捷展示；快捷项 exactly-one 引用官方/自建模板并校验 workspace 归属。 |
| 25 | implemented-recorded | Polotno 4.3.0 自由画布、Product 素材来源、用户模板、修订冲突和可追溯 PNG 导出；Sharp 解码并用 raster/document marker 校验图片、字体、中文换行与像素，水印/AIGC 均为开关。 |
| 26 | implemented-recorded | 图文工作台支持显式图片模型、生图/改图、引用素材、数据分级、进度、取消和插入画布；任务按 workId 在服务端恢复，重载后仍可继续或插入完成 Asset。 |
| 27 | implemented-recorded | 抖音 OAuth/账号能力/确认后发布链；发布只选真实 Product 视频包，提交前重验 revision，持久化有界轮询，POI/小程序锚点执行 granted+active+qualified 双门禁。 |
| 28 | implemented-recorded | 抖音观测持久化 available/empty/unavailable/unknown，保留平台时间、证据 revision、差异，并按 frequency/nextSyncAt 节流调度。 |
| 29 | implemented-recorded | `ai-sdk-feishu-mcp.test.ts` 交付飞书 MCP 发现/读取 tracer、活动证据和服务端连接。 |
| 30 | implemented-recorded | 飞书远程发现、vendored 工具 revision、发布/退役、快捷展示、读写风险、副作用确认；unknown 写只查账不重放，支持本地账本/inspect worker 恢复。 |
| 31 | implemented-recorded | PostgreSQL FTS/trigram/bigram、产品 alias/synonym 与结构化筛选；真实 `pg_indexes_size`、非字面固定查询集、逐例 Recall@K、负例通过率、空结果率和诚实标注的固定集改查率可重跑。 |
| 32 | implemented-recorded | `p1/cutover/execution-service.ts`、CLI 和 PostgreSQL 测试交付 dry-run、cutover、rollback、recutover 和证据束。 |
| 33 | implemented-recorded | `model-supply-copy-provider.ts`、`copy-prompt-library.ts` 将正式 Product generate_copy 接入目录/路由/双账，provider 调用移到 workspace lock 之外；真实适配器要求三个非空且实质不同的候选。 |
| 34 | implemented-recorded | 版本化 prompt/template/few-shot/brandVoice/门店事实 grounding、固定美业评测集、逐例结果；线上质量在至少 20 个采用样本前保持 unknown，Admin 展示 model/template/scenario/prompt 分组和反馈漏斗，并可回滚。 |
| 35 | implemented-recorded | 视频先审阅分镜再入队；逐镜 N→1、真实 provider lifecycle latency、受限人工标注校准、技术/质量分离、复用 renderer+ffmpeg、late terminal、checkpoint、取消 fencing 与重启恢复均接入 durable runtime。 |

## 验证面

- Core 全量单测：348 项，347 通过、0 失败、1 项显式的真实 Ark 付费测试 skip；PostgreSQL 测试实际运行，覆盖 Product、Foundation、Job Runtime、Model Supply、Operations、Integrations、search、cutover、通知 effect 幂等账本和目录 head 并发 CAS。
- Web 全量单测：49/49，通过 P1 view-model、稳定 submission key、导出标识、渠道目录和设置映射。
- Playwright：28/28；`p1-recorded-journey.spec.ts` 实际跑通模型选择、自由画布、水印/AIGC 开关、分镜审阅/确认、图片任务恢复和四类搜索筛选，Integration 旅程覆盖 strict BYOK 与已发布飞书工具。
- P0 golden journey 继续验证门店、素材、文案、30 秒视频、真实 Product 抖音 handoff、受信回调、发布异常恢复和线索旅程。
- 全仓 TypeScript、Biome、生产 build、`git diff --check` 与 ffmpeg 6.1.6 均通过。

## 封闭付费 Beta 仍需的外部证据

1. 真实模型凭据、最新 stable model name、成本、限额、延迟和质量实测；未通过前保持不激活。
2. Bifrost/LiteLLM 真实容器对照、供应链锁定和实际错误语义证据。
3. 抖音真实 OAuth/scopes/callback/审核与发布账号，飞书真实 UAT 组织与文档权限。
4. 真实付费 checkout/webhook、试点样本、恢复/负载和持续质量指标。
5. 产品功能完全落地后，按已有 ADR 由专门法务团队执行终审；不反向限制开发流程。
