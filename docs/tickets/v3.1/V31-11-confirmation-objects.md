# V31-11 — 确认卡扩容 + ExecutionConfirmationRequest/PlanConfirmationDecision（确认前 reserve）

**Parent**: spec-C（#3）`docs/specs/v3.1-agent-specs-2026-08-08/spec-C-431-confirm-execute.md`；权威 V3.1 §14.3、U7/U8
**批次**: 3
**Blocked by**: V31-09
**Status**: done (merged, 2026-08-08)

## What to build

含付费媒体方案的紧凑确认条（积分/余额/授权/事实/退还状态可见，只读+拒绝/确认）；确认拆两对象：待决请求（**创建事务内完成余额检查+reservation+FEFO 扣减**，同事务+workspace 锁；reservationIdempotencyKey+holdExpiresAt）+ 不可变决定；等待期显示「已预留 N 分」；拒绝/超时全额退回原扣批次+白话告知（D-153）；Campaign 合同 campaignPlanRef/workOrdinal/approvalScope（U7：每付费 Work 单独确认）。

## Acceptance criteria

- [ ] 创建事务原子性：并发下无超扣/双扣（计费并发测试，A3）
- [ ] hold 到期=取消+退分+白话告知（DBOS durable 测试缝）
- [ ] 决定不可变；「已确认记录」不承载 TTL
- [ ] Campaign 第二个付费 Work 单独确认（Playwright）
- [ ] refund 双态文案随失败退还开关投影（A4/A5）

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
