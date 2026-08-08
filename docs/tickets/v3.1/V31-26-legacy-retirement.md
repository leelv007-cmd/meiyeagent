# V31-26 — Legacy 退役清单 + replay 归档条件门（U14）

**Parent**: spec-I（#9）；权威 V3.1 §35 批次 6 退役门、§34.3、U14
**批次**: 6（全系最后一张）
**Blocked by**: V31-22, V31-24, V31-25 ＋ **退役前置条件全满足**（含真实商家试点优于旧流程——试点执行归发布 owner，本票只消费结论）
**Status**: ready-for-agent（开工门另检）

## What to build

逐项删除：Thread=Work 假设胶水、旧 result conversation glue、重复 planning DTO、第二份 Prompt pack 映射、手工硬编码 Tool allowlist、已无消费者的旧 Harness surface、重复 UI（旧卡片流）；每项先过「消费者为零」构造性证明再删；feature flag 逐个翻转可回退，force_legacy_five_stage 最后删；legacy durable replay 按 U14 条件门归档 fail closed（零 active/pending+最长 hold 30d 走完+审计导出与回滚证明+ops policy 缓冲）。

## Acceptance criteria

- [ ] 每个删除项附零消费者证明（grep 级或运行时引用计数）
- [ ] 商家体验零变化（退役只删死代码）
- [ ] replay 归档条件门监控在位；归档后审计只读入口可用
- [ ] 全量 journey 全绿收官
