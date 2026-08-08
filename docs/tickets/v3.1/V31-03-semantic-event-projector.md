# V31-03 — Semantic Event Projector（三帧扩展）+ snapshot/replay

**Parent**: spec-A（#1）；权威 V3.1 §27
**批次**: 1
**Blocked by**: V31-01, V31-02
**Status**: done (merged, 2026-08-08)

## What to build

基于现有 workflow progress/token/state 三帧扩展统一 Semantic Event Projector：各领域经 outbox 产出 semantic 事件，Projector 赋 per-thread 单调 streamOffset（domain bigint / wire decimal string）；contextRole: included|excluded|summarized；ephemeral 帧发射侧标 transient 绝不落库；snapshot+replay 恢复链（session projection → StateSnapshot → lastEventId 回放）。影子事件不改 Task/账单/UI。

## Acceptance criteria

- [ ] snapshot+replay 等价断言：乱序/重复/跨 thread 隔离全过（主 seam：P1 action + SSE 事件流）
- [ ] ephemeral 不落库的构造性检查（逐 token 零 PostgreSQL 写）
- [ ] wire/domain schema 分离，游标按数值序
- [ ] AG-UI 仅输出 adapter，内部 domain event 不用 AG-UI enum
- [ ] 影子运行期现有 UI/账单零变化
