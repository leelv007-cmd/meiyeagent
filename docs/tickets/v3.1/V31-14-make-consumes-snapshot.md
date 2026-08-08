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
