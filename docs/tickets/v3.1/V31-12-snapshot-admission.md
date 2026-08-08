# V31-12 — ExecutionPlanSnapshot + admission 绑定 + DBOS 复验 + stale/expiry

**Parent**: spec-C（#3）；权威 V3.1 §14.2、§22.3、U9
**批次**: 3
**Blocked by**: V31-11
**Status**: ready-for-agent

## What to build

编译定稿冻结执行内容并算 snapshotHash（不含 confirmationDecisionRef）；确认请求持 hash 作锚；快照行在 task-admission 一次性写入（merchant_confirmed 带 decisionRef / policy_exempt_copy 免确认不免冻结）；DBOS 运行前复验（verification→context/rights fence）；确认后关键事实/权利/费用变化→stale+diff+重确认；legacy durable task 走独立 replay 分支，layout 不兼容 fail closed。

## Acceptance criteria

- [ ] fidelity=100%：确认的方案与执行逐字段一致（退出门）
- [ ] 纯 copy 路径同样按冻结 plan/quote/release 执行（U9）
- [ ] stale 确认拒绝；mismatch fail closed
- [ ] 重放不重复创建 Task/扣费（at-least-once 幂等）
- [ ] legacy replay 分支可恢复且与新链无双写
