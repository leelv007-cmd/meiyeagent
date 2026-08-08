# V31-08 — Progressive Level 0–3 判定 + 计费 UX 三规则 + Quick Checks CI

**Parent**: spec-B（#2）；权威 V3.1 §3、附录 A5/A13、§31.1b
**批次**: 2 ｜ **语义锁**: 同 06
**Blocked by**: V31-06, V31-07
**Status**: done (merged, 2026-08-08)

## What to build

任务分级：Level 0 确定性轻修改不进 LLM 循环；Level 1 纯 copy 免确认直达结果（永久口径 U1）+ 报价 chip 常显/余额阻断双出口/退还双态文案；Level 2 进 Living Plan；Level 3 Campaign（确认粒度合同在 V31-11）。**Quick Checks assertion API + Session 侧行为门进 CI**（toolOrder 六原语序列/didNotCall/maxToolCalls，零 LLM 微秒级）——V31-23 只扩共享 registry 不重写。

## Acceptance criteria

- [ ] Level 0 零 LLM 调用（trace 断言）；Level 1 从 interpreting 直达 handing_off
- [ ] 免确认硬边界=纯 copy（A13 判定权威），kill switch 不扩大确认边界
- [ ] 计费 UX 三规则在免确认路径全过（A5 验收项）
- [ ] Quick Checks 进 CI 且为 required
- [ ] 简单任务不因新链变慢（对照 V31-05 基线）
