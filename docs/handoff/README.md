# 全量功能开发 Worktree Handoff 索引（2026-07-18）

> **当前项目入口：** [`docs/ops/current-project-status.md`](../ops/current-project-status.md)。本目录是按日期保存的历史交接索引；除非 CURRENT 明确重新激活，不得据旧 handoff 创建分支、worktree 或恢复旧数据库。

> **当前开放中的交付编排见 [`ui-journey-rebuild-handoff-2026-07-20.md`](ui-journey-rebuild-handoff-2026-07-20.md)**（spec #83，票 #84-#105，D-072~D-098 落地）**与 [`admin-supply-handoff-2026-07-20.md`](admin-supply-handoff-2026-07-20.md)**（spec #106，票 #107-#128，D-048~D-071 按 D-080 口径的 AP/MP 补足包；两包跨包接缝见前者「跨包接缝增补」节）。

> **状态：已完成的历史交付编排。** WT-1～WT-6 对应工作已合入 `main`，本目录只保留当时的依赖、文件属主与接缝纪律；不得按本文重新创建分支或把票写成未实现。当前开放项见 [`../reviews/implementation-gap-ledger-2026-07-19.md`](../reviews/implementation-gap-ledger-2026-07-19.md)。

四条并行开发线，按文件域稳定分线。每条线读自己的 handoff 即可开工；跨线关系在各自文档的「上下游」节。

| 线 | Handoff | 认领序列 | 分支建议 |
|---|---|---|---|
| WT-1 Harness 主干（关键路径） | [wt1-harness.md](wt1-harness.md) | #26 → #31 → #34 → #35 | `lane/harness` |
| WT-2 合同与存储 | [wt2-data-storage.md](wt2-data-storage.md) | #25 → #30 → #32 →（扇出后）#37 → #43 | `lane/data-storage` |
| WT-3 视频线 | [wt3-video.md](wt3-video.md) | #27(A-E) →（扇出后）#42 → #46 | `lane/video` |
| WT-4 前端体验 | [wt4-frontend.md](wt4-frontend.md) | #28 → #29 组件 → #33 → #36 → #44 | `lane/frontend` |

**全局规则（四线通用）**：

1. 票体 = GitHub issue 正文，**末尾「复审修订（2026-07-18）」节口径优先于上文冲突处**，先读修订节再动手。
2. 权威链：合并权威版 `docs/design/beauty-marketing-agent-product-design-2026-07-17.md`（D-001~D-042）> 全量功能规格 issue #24 / `docs/specs/beauty-marketing-agent-full-feature-dev-spec.md` > 各票。跨票职责冲突查 `docs/reviews/ticket-pack-codex-review-2026-07-18.md` §4 唯一属主矩阵。
3. 带内部分批（A/B/C…）的票按序各落独立 PR，不攒大分支；每批合入即通知被解锁的线。
4. 测试：core 侧 `pnpm --filter @meiye/core test` + `typecheck`（同目录 `*.test.ts`；真机走 `.live.test.ts` 且 CI 默认不跑）；壳侧 Playwright e2e。接缝纪律：合同测试打在 HTTP+SSE 边界与纯函数边界，**永不 import DBOS**。
5. #35 合入后并行宽度扩大，届时新增 WT-5（#41→#48）/ WT-6（#38/#40/#45/#47/#39/#49 按上游就绪领活），另行派发。
6. Commit message 用英文；D-040 口径：功能自由迭代、验收=工程质量检查，不走预登记仪式；合规/运营流程置后但**结构性护栏（七门/权利门/审计双写/provenance）随功能建**。
7. D-041 DBOS Transact 已锁定（PoC 七面全过）；D-042 暗色主题转正 + 套组收进对话流 + 次级面 polish（定价蒙皮/页头对比度/内容卡可读）。

## 持久层验收环境

默认 `pnpm --filter @meiye/core test` 的全绿不能单独作为持久层验收结论。
正式验收必须同时注入 `TEST_DATABASE_URL` 与
`TEST_DBOS_SYSTEM_DATABASE_URL`：前者指向已施加壳侧 Drizzle migrations
（含 Better Auth `public.session`）的业务测试库，后者指向独立的 DBOS system
库，禁止两者同库。可在仓库根目录运行
`./scripts/ci/provision-test-db.sh` 创建/检查两个库并预置壳侧 schema；详细用法见
`apps/core/TESTING.md`。CI 的 `core-persistence` job 负责执行并防止 PostgreSQL
21 个用例与 DBOS 注册 smoke 静默 skip。

## Playwright 验收

壳侧 Playwright 是 handoff/发布验收流程的一环，不得以 catalog 或 spec 文件
存在代替实际执行。日常功能开发先运行相关 spec；完整验收运行
`pnpm --filter @meiye/web e2e`。CI 的 `e2e` job 会预置 PostgreSQL 并启动 Main、
Core、Worker、Canvas 的现有多服务 harness，可通过 `workflow_dispatch` 手动触发，
或给 PR 添加 `run-e2e` 标签触发。catalog 中标记为 `MISSING SPEC` 的条目明确
不计入已覆盖范围，必须等专属可执行 spec 补齐后才能据此宣称验收通过。
