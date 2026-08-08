# V31-16 — Steering service + classifier 四态 + 双队列 + partial delivery

**Parent**: spec-D（#4）；权威 V3.1 §5.6、§23.3、§24.2
**批次**: 4
**Blocked by**: V31-14, V31-15
**Status**: done (merged, 2026-08-09)

## What to build

运行中商家指令按影响分类精准应用：future_step_patch（不重报价）/derived_revision/plan_change（回方案层 replan+requote）/unsafe_or_conflicting（解释并要求修正）；双队列 steer（当前单元完成即插入）/follow_up（全部完成后插入）；影响范围明确反馈；6 页成功 5 页只重做失败页+退费规则清楚（partial delivery 结算）；全部 Steering 形成可追踪 command（绑定 revision/snapshot），accepted/acceptance_unknown 的 Provider 副作用不可被「修改」。

## Acceptance criteria

- [ ] 中途指令只修改目标范围，其余页保持（Playwright §37.4-G）
- [ ] 数量/费用变化回方案层重报价确认
- [ ] partial delivery 结算与退费断言
- [ ] steering 分类与影响范围断言（P1 action 边界）
- [ ] make_steering_v1 flag + disable_make_steering kill switch 生效
