# V31-06 — Session repository/service + turn runner + policy 中间件挂点 + AgentKernel port

**Parent**: spec-B（#2）`docs/specs/v3.1-agent-specs-2026-08-08/spec-B-430-session-plan.md`；权威 V3.1 §18–§21
**批次**: 2 ｜ **语义锁**: 06/07/08 同域（Session Harness），建议单 lane 串行
**Blocked by**: V31-01, V31-02
**Status**: done (merged, 2026-08-08)

## What to build

Agent Session Harness 核心：AI SDK streamText 工具环（AgentKernel port 薄封装，无 durable checkpoint），状态机 idle→…→handing_off；AgentTurnInput 最小投影（权限裁剪+上下文预算）；AgentTurnDecision Zod strict parse；策略中间件挂点（before/after model、wrap、wrap_tool_call 确定性拦截，控制动作 continue|end_turn|ask_merchant，执行序 pin 进 release）；System-only 动作提案层拦截；6 段摘要+retainedTail compaction（U4，Thread checkpoint 唯一 writer 在此）。

## Acceptance criteria

- [ ] 只读轮零付费副作用（didNotCall('record') 负向断言）
- [ ] System-only 动作拦截返回 {blocked,gateId,reason,nextAction}
- [ ] AgentControlLimits 从 release 冻结绑定读取，未标定项拒进生产路径（U11）
- [ ] compaction 失败保留上次摘要不阻断；checkpoint 单 writer 构造性检查（E lane working 切片经此落盘）
- [ ] partial output 只更新临时 Activity，repair 后替换同一 stable ID
