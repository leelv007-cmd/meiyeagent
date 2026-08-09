# V31-12 — ExecutionPlanSnapshot + admission 绑定 + DBOS 复验 + stale/expiry

**Parent**: spec-C（#3）；权威 V3.1 §14.2、§22.3、U9
**批次**: 3
**Blocked by**: V31-11
**Status**: done (merged, 2026-08-08)

## What to build

编译定稿冻结执行内容并算 snapshotHash（不含 confirmationDecisionRef）；确认请求持 hash 作锚；快照行在 task-admission 一次性写入（merchant_confirmed 带 decisionRef / policy_exempt_copy 免确认不免冻结）；DBOS 运行前复验（verification→context/rights fence）；确认后关键事实/权利/费用变化→stale+diff+重确认；legacy durable task 走独立 replay 分支，layout 不兼容 fail closed。

## Acceptance criteria

- [ ] fidelity=100%：确认的方案与执行逐字段一致（退出门）
- [ ] 纯 copy 路径同样按冻结 plan/quote/release 执行（U9）
- [ ] stale 确认拒绝；mismatch fail closed
- [ ] 重放不重复创建 Task/扣费（at-least-once 幂等）
- [ ] legacy replay 分支可恢复且与新链无双写

## Evidence

> 空表由 L-CI 脚手架落盘，**Wave 4 对着真实证据填**。填表规则（机器可判优先）：
> `AC<n>` 对应「Acceptance criteria」小节里第 n 个 checkbox 条目，顺序固定；id 列只写
> `AC<n>`，不加任何修饰。writer / consumer 写 `path/to/file.ts:line`。PG result 与
> Playwright result 写真实结果（如 `12/12 pass`）；没跑就留 `—`，不写「应该通过」之类
> 的推测。required CI job 写 `.github/workflows/core-quality.yml` 里的 job 名。
> 单元格内的 `|` 必须转义成 `\|`。空值统一写 `—`。
> **一行未填满，对应 AC 不得勾选。**

| AC | production writer | production consumer | failure-recovery test | PG result | Playwright result | required CI job |
|---|---|---|---|---|---|---|
| AC1 | — | — | — | — | — | — |
| AC2 | — | — | — | — | — | — |
| AC3 | — | — | — | — | — | — |
| AC4 | — | — | — | — | — | — |
| AC5 | — | — | — | — | — | — |
