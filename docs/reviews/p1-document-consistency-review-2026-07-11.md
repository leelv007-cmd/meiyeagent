# P1 文档一致性复核

> 状态：历史快照，固定于 2026-07-12。其“没有未决产品口径冲突”不覆盖 2026-07-14 D01–D18 新决策。  
> **当前一致性入口**：[`doc-consistency-review-2026-07-22.md`](./doc-consistency-review-2026-07-22.md) + `CONTEXT.md` + `docs/evidence/contentpackage/`。本文只保留 2026-07-12 的 P1 历史审计事实。
> `doc-consistency-audit-2026-07-15.md` / `2026-07-16.md` 均为历史（计数/实现矩阵不得当活源）。

- 日期：2026-07-12（重校）
- 状态：已复核；本轮冲突与文档卫生项见 [`全面复核草案`](doc-consistency-audit-2026-07-12.md)
- 方法：`grill-with-docs`（逐项审问决策、以代码事实校验术语）+ `domain-modeling`（更新统一术语、区分当前规范与历史记录）
- 结论：当前没有未决的产品口径冲突；四层固定角色已纳入 P1，剩余事项是活动文档文字统一、历史标记、UI/UX 施工缺口和真实 deployment/质量/成本证据，不阻塞 P1 业务合同。

> **2026-07-11 后续修订**：`p1-revision-plan-2026-07-11.md` 已回写 P1 spec、实施 MAP/票据和 ADR-0009；`createCandidate()` 平台硬编码与 warning 破坏性改写已修复并有回归测试。下方实现漂移清单仍用于追踪尚未落地的关系表、durable jobs、连接与发布阶段策略，不应把已修复问题重新带回。

## 权威顺序

1. 用户最后确认的结论（含 2026-07-12 UI/UX 权限决策）：发布时审核即可，其他图文功能全部放开；品牌水印和 AIGC 标识都是开关；法务在产品功能完整后由专门团队终审，不限制开发流程。
2. `.scratch/p1-wayfinding/map.md`、`.scratch/model-supply-wayfinding/map.md` 与 UI/UX 交接/壳层决策资产的已关闭结论。
3. [`docs/specs/beauty-content-agent-p1-spec.md`](../specs/beauty-content-agent-p1-spec.md)、`CONTEXT.md` 与最新 ADR 修订。
4. P0 合集、P0 spec、原型截图和研究资产：只用于追溯，不得覆盖最新 P1/UIUX 口径。

## 已统一的现行口径

| 主题 | 当前口径 | 复核结果 |
|---|---|---|
| P1 目标 | 付费单店固定角色工作区（Owner/Operator/Reviewer；Platform Admin 独立）；Pro 只增加产出量/并发/优先级，不做功能墙 | 已按 2026-07-12 决策统一 |
| 创作边界 | 自由画布、官方/自建模板、AI 生图/改图、改稿、草稿和创作批处理全部开放 | 已修正旧的风险分层创作门槛 |
| 发布边界 | 抖音官方 Publish 为条件启用，提交/排期时由用户确认；未激活回 L3；其他平台仍按已锁范围 | 一致 |
| 合规/法务 | 法务功能完整后终审；发布阶段平台审核/Preflight/责任确认；明显不安全、欺骗、未授权或绕过强制 provenance/发布标识的行为可硬停止 | 已把开发/草稿门禁移出当前口径 |
| 水印/AIGC | 产品品牌水印和产品侧 AIGC 标识为开关；provider/platform 强制 provenance 与实际 metadata 如实记录；平台标签在发布阶段处理 | 已修正“不可关闭、不可后置”旧文案 |
| 批次 | 周内容批次负责聚合和开放式创作处理；缺素材、权限不可用等真实执行前置条件可单独阻塞；公开发布和后台自主高风险外部副作用不自动执行 | 已修正“风险项逐条确认”旧文案 |
| 模板 | 官方模板由后台版本化规划、发布、更新、下架；历史作品固定版本；用户自选置顶/排序/隐藏快捷模板 | 一致 |
| 模型供应 | Product Core 自有目录、路由快照、Job/Attempt/Asset、双账和 BYOK；四类图片模型、四类视频系列进入完整目录；用户自由选择，固定选择不得静默换模 | 一致 |
| 抖音/MCP | 抖音一账号独立 Publish/Observe；飞书官方远程 MCP 全正式工具进入后台目录，用户自选快捷展示，Product Core 负责授权、重试、幂等、账本和脱敏 | 一致 |
| 运行时 | 单仓单服务双入口、Postgres durable jobs 优先复用成熟组件；pg-boss 主 PoC，Graphile Worker 对照；Mastra/Redis/拆服务/pgvector 证据触发 | 一致 |

## 本轮已修订文件

- `CONTEXT.md`：新增权威顺序；校正 P1 发布 Gate、资质商家、视频成片、批次和动作级权限术语。
- `docs/adr/0003-regulated-content-mode.md`、`0004-qualified-access-medical-content.md`：明确创作开放、发布阶段 Preflight、法务后审。
- `docs/adr/0006-p0-runtime-topology.md`、`0007-agent-runtime-ai-sdk-first.md`、`0008-video-in-p0-and-layered-buy-build.md`：校正视频标签开关/来源记录，并把旧 AI SDK 版本写法标为决策时快照。
- `docs/specs/beauty-content-agent-p0-spec.md`：加历史优先级说明，修正视频标签、AIGC、发布阶段核验和验收措辞。
- `docs/evidence/p0-release-evidence.md`：说明 P0 证据只证明当时的启用配置，不定义 P1 默认门禁。
- `合集-v1.5-P0决策定稿.md`：增加历史记录与 2026-07-11 最新结论覆盖说明。
- `.scratch/p1-wayfinding/map.md`、issues 03/04/05、assets/04：把早期原型票的风险分层创作结论标为被覆盖，保留历史审计记录。

## 保留为历史证据、没有强行改写的内容

P0 的决策时间线、原型截图、P0 发布证据和外部研究中的旧方案继续保留。它们现在都由顶层历史说明或 superseding amendment 明确降级为“当时证据”，不再是当前实施要求。这样既能追溯用户当时为何选择某方案，也避免历史文字被误复制成 P1 门禁。

## 实现/证据状态（2026-07-12 重校）

本节曾记录 2026-07-11 之前的实现漂移；`d161449 feat: implement P1 content operations platform` 后，关系化 Product repository、P1 cutover、Model Supply、durable runtime、连接/MCP 和质量闭环已经以 `implemented-recorded` 交付。以下只保留仍然有效的边界，不再把已交付票写成未实现：

1. `apps/core/src/product/postgres-repository.ts` 的单行 `product_states` JSONB 仍作为 legacy read/rollback source 保留；当前 P1 写入口由 `relational-product-repository.ts` 与 Cutover owner 控制。它是迁移兼容边界，不是 P1 关系表缺失。
2. 旧 ProductService 路径仍保留用于 legacy drain/rollback；当前 P1 路径通过 relational service、Model Supply copy bridge 和 publication-stage safety check，不应把旧入口行为误写成 P1 创作合同。
3. 产品侧 AIGC/水印开关已经在 P1 canvas/operations seam 中有显式字段和测试；legacy video evidence 仍保留可选 visible label，provider/platform 强制 provenance 仍需 live activation 证据，不能把 recorded 合同写成真实供应方已激活。
4. `main.ts` 的 webhook/no-op notifier 是 P0 兼容入口；P1 Connection/MCP 目录、UAT 和局部降级已有 recorded implementation，但真实 OAuth/UAT/供应账号仍属于发布证据。
5. 历史快照：在 `b074cb0 test: run web node tests from workspace` 之前，Web 测试未被根命令可重复发现。现在 `@meiye/web` 已声明 `test` script，根 `pnpm test` 会执行 Web 测试；当前计数和同候选门禁见 `docs/evidence/uiux-cutover/s5-release-candidate-local-rehearsal.md`。

## Grill 结论

- “创作是否需要逐条合规确认？”——否；当前只保留发布阶段和明确外部副作用边界。
- “水印/AIGC 是否必须在生成阶段固定烧录？”——否；产品开关与实际 provider/platform provenance 分开记录。
- “真实商户数据是否阻塞 P1 功能实现？”——否；deployment、真实 Key、成本、质量和负载是 activation/evidence backlog。
- “还有没有需要继续调研后才能写实现？”——没有 Scope Lock 级别的未决项；真实平台 Scope、模型 deployment、供应商成本/质量、负载和法务终审属于并行证据或发布阶段工作。
