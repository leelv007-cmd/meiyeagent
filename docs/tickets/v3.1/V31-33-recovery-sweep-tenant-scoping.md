# V31-33 — Harness start 恢复扫描无 tenant 作用域

**Parent**: spec-E（#5）；权威 V3.1 §23 执行脊 / 提交恢复
**Lane**: spine/confirmation 域（L-S0 territory，**不是 memory lane**）
**Blocked by**: —
**Status**: open

## What to build

`listRecoverableHarnessStarts`（`apps/core/src/p1/execution-spine/postgres-creation-submission-store.ts:783-801`）的 WHERE 只有 `harness_state` / `updated_at` / lease 三类谓词，**没有 `workspace_id`**。它由 `recoverPendingStarts()` 消费（`submission-coordinator.ts:663`），在 API 进程 boot（`api-runtime.ts:1640`）与定时 sweep（`:1648`）各跑一次——即一个多租户恢复扫描对租户完全无感知，`LIMIT 100` 之下先到先得，任一 workspace 的积压可以挤占其他 workspace 的恢复额度。

要做的是给恢复扫描一个明确的租户语义并落断言：要么按 workspace 分片/轮转取，要么显式声明「全局扫描 + 每 workspace 配额」并测出该配额。顺带把 `LIMIT 100` 与退避窗口的关系写清楚（当前 `LEAST(300, 2^attempts)` 秒退避在全局排序下会让老 workspace 长期领先）。

## 发现路径（证据的开场展品）

L-T4 在 V31-18/19 修复轮遇到一次间歇性 PG 红：`postgres-creation-submission-store.postgres.test.ts:928` 断言 `attempted: 1`，某次返回 `attempted: 2`。按主控新协议在 `provision-test-db.sh` 一次性新库复现 → 全绿；长活 lane 库当时留有 15 行 / 14 个 distinct workspace_id，新库 0 行。

**结论分两半，两半都要记**：
- 那条测试红是**环境性**的（长活库业务行积累），不是产品缺陷 —— 符合「红的数字随行数缩放而非随断言缩放」启发式。
- 但它暴露的**缺少租户作用域是真的**：正因为查询全局，该断言才会对「库里恰好有别的可恢复行」敏感。测试的脆弱性与产品的租户盲区是同一个根因。

## 附带项（同域，一并裁决）

`apps/core/src/assembly/core-assembly.ts:718-719`：`experience.retrieveForInjection` 在 late-bound 的 `sessionRetrievalExperiencePort.current` 未绑定时**静默返回 `[]`** —— 与 V31-18 P0-2 同形状的静默缺席，只是下沉了一层（无 receipt、无面板、无错误）。今天在 API 角色上不可达（`api-runtime.ts:403` 无条件绑定，`worker-runtime.ts` 不做 planning），但这个 seam 本身无守卫，任何一次重构都能把它变成活洞。要么绑定失败即抛，要么显式声明「未绑定＝合法空」并测出来。

## Acceptance criteria

- [ ] 恢复扫描的租户语义被显式选定并断言（分片/配额二选一，不留默认全局先到先得）
- [ ] 一个 workspace 的积压不能耗尽其他 workspace 的恢复额度（多 workspace 并发恢复测试）
- [ ] `postgres-creation-submission-store.postgres.test.ts:928` 类断言不再依赖库内无其他可恢复行（断言按 workspace 收敛）
- [ ] `core-assembly.ts:718-719` 的未绑定路径被裁决：fail-closed 或显式合法空 + 断言

## Evidence

| # | 证据 | 落点 | 结论 |
|---|---|---|---|
| | | | |
