# V31-11 — 确认卡扩容 + ExecutionConfirmationRequest/PlanConfirmationDecision（确认前 reserve）

**Parent**: spec-C（#3）`docs/specs/v3.1-agent-specs-2026-08-08/spec-C-431-confirm-execute.md`；权威 V3.1 §14.3、U7/U8
**批次**: 3
**Blocked by**: V31-09
**Status**: ready-for-agent

## What to build

含付费媒体方案的紧凑确认条（积分/余额/授权/事实/退还状态可见，只读+拒绝/确认）；确认拆两对象：待决请求（**创建事务内完成余额检查+reservation+FEFO 扣减**，同事务+workspace 锁；reservationIdempotencyKey+holdExpiresAt）+ 不可变决定；等待期显示「已预留 N 分」；拒绝/超时全额退回原扣批次+白话告知（D-153）；Campaign 合同 campaignPlanRef/workOrdinal/approvalScope（U7：每付费 Work 单独确认）。

## Acceptance criteria

- [ ] 创建事务原子性：并发下无超扣/双扣（计费并发测试，A3）
- [ ] hold 到期=取消+退分+白话告知（DBOS durable 测试缝）
- [ ] 决定不可变；「已确认记录」不承载 TTL
- [ ] Campaign 第二个付费 Work 单独确认（Playwright）
- [ ] refund 双态文案随失败退还开关投影（A4/A5）
