# V31-24 — MarketingGoal 产品面 + Proactive 管道（evidence 门控）

**Parent**: spec-F（#6）`docs/specs/v3.1-agent-specs-2026-08-08/spec-F-434-goal-proactive.md`；权威 V3.1 §11、§25、§26.2、U2/U13
**批次**: 6
**Blocked by**: V31-17, V31-18, V31-19
**Status**: ready-for-agent

## What to build

Goal 产品面（合同已在 V31-01）：对话中提议创建/提议归组（确认才关联），status 迁移同走提议→确认（revision OCC），进度只投影 delivered Work 与 evidence 不新建统计真相，Idle 首屏当前最重要目标+主动建议；Proactive 管道：Signals（只用真实拥有数据）→确定性过滤→Agent 排序→candidate（derived projection+最小 append-only 决定记录，accept 幂等键=candidateId）→商家提案；evidence 覆盖率准入门（U13：unset=默认关只观测，运营可用既有 flag 按 workspace allowlist 临时开）；接受→正常 Thread→Plan→Work，绝不自动产生付费副作用；Campaign 目标分解按周排期（确认粒度走 V31-11 合同）。

## Acceptance criteria

- [ ] 归组/状态迁移只走提议→确认；无 Goal 管理页
- [ ] 每条建议带「为什么现在」evidence；接受后零付费副作用（退出门）
- [ ] refresh/replay 后记得已忽略/已接受；accept 只创建一个 turn
- [ ] 门 unset=不出建议；allowlist 临时开可用（U13）
- [ ] disable_proactive_agent kill switch 生效
