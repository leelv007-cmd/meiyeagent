# 项目状态长期政策

本文只承载**不随 SHA 过期**的政策。SHA-scoped 验证快照在：

- `docs/ops/current-project-status.md`
- `docs/ops/capability-ledger-2026-08-13.md`

这两份快照的 machine header 由 `scripts/ops/project-status.mjs` 写入与检查。header 不是 CURRENT 时，不得把快照里的 Integration SHA、required / browser / PG/DBOS 结论当成当前 HEAD 的执行入口。

## CURRENT / STALE

- **CURRENT**：header 的 `head` 与 `baseline` 都等于当前 `git rev-parse HEAD`，且任何 `conclusion: success` 的 required run、browser run、PG/DBOS evidence 都钉在这个 SHA 上。
- **STALE**：baseline 不是 HEAD 的 ancestor，或 baseline 已过期（HEAD 已向前），或 success 证据钉在祖先 SHA。此时必须标 STALE，禁止继续标 CURRENT。
- 禁止把祖先 CI 绿复制到当前 SHA：`write` 只刷新 HEAD / remote / dirty，不把 ancestor evidence SHA 改写成 HEAD。

## verification ≠ release

实现完成、本地 PostgreSQL/DBOS 或 Chromium 生产路径、required CI、release-ready 是四个分开的状态，全部钉在 exact SHA。不同 SHA 的本地结果与 CI 结果不得拼成同 SHA release evidence。required 绿只证明「门通过」，不等于能力可用。

## 文档权威顺序

1. 本文：长期政策与 CURRENT/STALE 规则。
2. `docs/ops/current-project-status.md`：仅在 header=CURRENT 时描述当前集成、验证和 release 边界；STALE 时只是其所署 baseline 的快照。
3. `docs/ops/capability-ledger-2026-08-13.md`：能力四态表是 SHA-scoped 盘点；STALE 时不得当当前工作队列的 HEAD 结论。
4. `docs/tickets/v3.1/README.md` 与个票：任务状态事实源。
5. `CONTEXT.md` 与 `docs/adr/`：领域语言和稳定架构决定。
6. 带日期 reviews/handoffs：固定历史快照，只通过 superseded 横幅指回 SHA-scoped 状态文件。

## 能力账本政策

账本是能力驱动的工作队列合同，票列表不是 backlog。四态定义不变：

- **可用**：真浏览器走查绿
- **降级可用**：部分走通或仅 fixture 档验证
- **不可用**：走查确认死路或核心断裂
- **未走查**：只有 e2e/单测背书，从未被人走过；诚实态，不得写成可用

更新纪律：每条能力 lane 收敛完成（旅程 spec 无掩码进门＋required CI 绿＋主控走查留痕）后更新 SHA-scoped 表；不按票关闭更新。Parked 项不进工作队列。收敛顺序：C1 → C2/C3 → C6 → C4 → C5 → C7 → C9/C10 → C12 → C8 → C11 → C13 → C14 → C17。

## 仍有效的批次政策

R3 开票冻结已解除。其余改约继续有效：R1（Day-0 零素材首访＝release gate）、R2（每批次先开旅程票、验收=真浏览器走查）、R4（单波 ≤12 票、每波必含旅程票），以及仪器票优先于功能票。ADR-0019 纵切交付与接缝属主不受 STALE 快照影响。

## 禁止的恢复方式

- 不恢复已经删除的 lane/worktree 或临时测试数据库。
- 不执行旧 handoff 中解除管理员保护后直推 main 的命令。
- 不把 instrument failure 之后的剩余 spec 记为产品失败；其状态为 `not_evaluated`。
- 不把不同 SHA 的本地和 CI 结果拼成同 SHA release evidence。
