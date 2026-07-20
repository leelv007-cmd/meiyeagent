# Research Analysis

## Current research bundles

- [`beauty-marketing-validation-2026-07-17/`](./beauty-marketing-validation-2026-07-17/) — Current three-platform validation baseline for beauty marketing and store-visit acquisition: 8–12-store sampling contract, OpenCLI evidence boundaries, 30-day-window corpus contract and representative extracts, platform opportunities, and decision log.
- [`hitl-research-2026-07-17/`](./hitl-research-2026-07-17/) — AI-native beauty marketing JTBD, personalized/industry asset orchestration, Human-in-the-loop patterns, conditional rights gates, component fit, source register, and OpenCLI snapshots.
- [`harness-research-2026-07-17/`](./harness-research-2026-07-17/) — Harness 五段式实现选型调研：durable 载体（DBOS/Inngest/Trigger.dev/CF）、①③结构化节点（BAML vs AI SDK）、评估与审计（Langfuse/promptfoo/Vitest）、非代码可变层（admin-config/Mastra Studio/Dify），10 份报告 + xcheck 对抗验证 + 11 号决策简报；已拍板转正为 D-034~D-038。
- [`admin-platform-research-2026-07-19/`](./admin-platform-research-2026-07-19/) — 系统能力中心式后台的成熟架构与组件研究：现有后台实况、TanStack/shadcn 复用边界、可视化与技术深诊断分工、候选组件取舍及 AP-01～AP-08。
- [`cloudflare-admin-boundary-2026-07-19/`](./cloudflare-admin-boundary-2026-07-19/) — Cloudflare 与我方管理后台的 A/B/C 能力边界、只读数据源与最小权限、采样/保留/成本限制、跨控制台 handoff 合同及 CF-01～CF-08。
- [`model-provider-management-2026-07-19/`](./model-provider-management-2026-07-19/) — 多渠道模型供应管理总览：官方 API 与第三方上游的真实边界、New API/Sub2API 技术指纹、已确认 D-058～D-069、文本/图片/视频三模态 P0 与三项核心操作双渠道、统一 MP-01～MP-08 与开放风险。
- [`provider-control-plane-selection-2026-07-19/`](./provider-control-plane-selection-2026-07-19/) — 多渠道模型供应控制面的开源选型：已转正为 D-071 的“自有 Product Core + 分层局部复用”，以及 AI Gateway、后台 UI、计量权益、策略权限和 Secret 管理候选的 Adopt/Reference/Reject 边界。
- [`user-journey-ui-benchmark-2026-07-20/`](./user-journey-ui-benchmark-2026-07-20/) — 用户旅程与 UI 增量审计：当前产品真机/代码真相，小云雀与 CreatOK 的图片视频流程，讯飞绘文的选题、文案与图文资产流程，以及“统一创作入口 + 分化成品工作区”待拍板提案。

## Retrieval and retention policy

- 网络检索优先使用本机 Open CLI；仅在 Open CLI 无法覆盖所需官方资料、API 或最新变更时补用 Web Search，并在研究文档中说明 fallback。
- 产品、平台与技术结论优先追溯到官方文档、官方仓库、规范或第一方 API；维护状态与限制在影响实现前刷新，不把旧快照当作当前事实。
- 有复用价值的有效信息写入本目录的主题研究包，至少包含 Question、Local sources、Live sources、Findings、Decision/open risk 与 Follow-up tickets。
- 会话和产品设计文档只保留结论、决策编号、证据边界与研究包路径；不重复粘贴长篇网页内容，避免上下文膨胀。
- 不为“留资料”保存无筛选的搜索结果或整站镜像；只保留支持决策、实现或复核所需的摘要、字段、限制、来源链接与必要快照。

Write investigation results here. Each analysis file should include:

- Question.
- Local sources used.
- Live sources used, only if the local sources were stale or incomplete.
- Findings.
- Decision or open risk.
- Follow-up tickets.
