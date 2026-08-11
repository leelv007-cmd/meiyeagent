# V31-11 — 确认卡扩容 + ExecutionConfirmationRequest/PlanConfirmationDecision（确认前 reserve）

**Parent**: spec-C（#3）`docs/specs/v3.1-agent-specs-2026-08-08/spec-C-431-confirm-execute.md`；权威 V3.1 §14.3、U7/U8
**批次**: 3
**Blocked by**: V31-09
**Status**: done (merged, 2026-08-08)

**Implementation state**: done
**Verification state**: verified
**Evidence SHA**: 5d4bd4810fede830e641081856011c334a3f9777
**Workflow Run**: 
**Artifact Digest**: 

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
> **三个结果列各守一轴，不得跨轴填**：`unit/eval result` 只收单测与离线评测结果，
> `PG result` 只收真实 Postgres 套件结果，`Playwright result` 只收浏览器旅程结果。
> 把 `biome` / `tsc` / 单测结果写进 `Playwright result` 属跨轴，须改回本轴。
> 三个结果列的空值分三种，必须区分：`—`＝该格未填（脚手架初始态）；`n/a`＝该 AC 在该轴上
> **没有**证据要求（须在表下用一句话说明为何没有）；`未跑`＝该轴有要求但本轮未执行（须写出
> 未执行的原因）。writer / consumer / failure-recovery test / required CI job 四列的空值
> 仍统一写 `—`。
> **勾选规则**：writer / consumer / failure-recovery test / required CI job 四列非空，**且**
> 三个结果列每一格都是真实结果或 `n/a` ⇒ 方可勾选。任一结果格为 `—` 或 `未跑` ⇒ 不得勾选。
> （原规则是「一行未填满，对应 AC 不得勾选」。在只有 PG / Playwright 两个结果列时，它把
> 「本来就不该有 PG 证据的 AC」也判成未验收——列集扩展史见 V31-29「Evidence」节末。）

| AC | production writer | production consumer | failure-recovery test | unit/eval result | PG result | Playwright result | required CI job |
|---|---|---|---|---|---|---|---|
| AC1 | — | — | — | — | — | — | — |
| AC2 | — | — | — | — | — | — | — |
| AC3 | — | — | — | — | — | — | — |
| AC4 | — | — | — | — | — | — | — |
| AC5 | — | — | — | — | — | — | — |
