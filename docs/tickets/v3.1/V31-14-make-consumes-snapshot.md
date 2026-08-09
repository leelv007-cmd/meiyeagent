# V31-14 — Make Harness 消费 snapshot + validator 降级 + Interrupt 类型化协议

**Parent**: spec-C（#3）；权威 V3.1 §23、§27.6、D-169①
**批次**: 3
**Blocked by**: V31-12
**Status**: done (merged, 2026-08-08)

## What to build

Make Harness 新任务只消费 ExecutionPlanSnapshot，不再重新调用 intent/brief LLM（旧节点降 validator）；执行中素材撤权安全停止不重复扣费、已引用价格/日期变化暂停提示（Context Fence §23.4）；Interrupt 升级类型化协议（threadId/runId/workflowId/step/revision/schemaVersion；resume 按 interruptId+revision CAS 回注，禁位置索引）；listPendingInterrupts workspace 鉴权（首页/手机可见全部待处理确认项）；duplicate resume/submit/重放全幂等；bounded execution 触顶=可续挂起非失败（A6）。

## Acceptance criteria

- [ ] 新任务零 intent/brief LLM 重调（trace 断言）
- [ ] pending interrupt 刷新/重连不丢（Playwright §37.4-H）
- [ ] 素材撤权/事实变化精确中断（§37.4-F/E）
- [ ] duplicate resume/submit 幂等（durable 测试缝 kill/restart 副作用=0）
- [ ] 确认门与 note 页级帧迁出为独立模块（symbol 锚定），XHS §3.2 门全绿

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
