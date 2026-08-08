# V31-01 — Agent 域 contracts + branded IDs + ownership matrix（含 release 合同）

**Parent**: spec-A（#1）`docs/specs/v3.1-agent-specs-2026-08-08/spec-A-429-foundation.md`；权威 V3.1 §7–§10、§14.2、§29（合同形状）
**批次**: 1（全系前沿票）
**Blocked by**: 无——立即可开工
**Status**: ready-for-agent

## What to build

Agent 域全部新合同落 `packages/contracts`：thread/run/goal/plan/memory/event/execution-plan/**release**/steering/outcome，branded IDs + canonical ownership matrix（one writer per semantic fact）。release 合同（HarnessReleaseArtifact 含 middlewareBindings+controlLimits、Lifecycle、Rollout）属主在本票，V31-20/21 只消费不再定义。schema versioning 与 one-writer enforcement 是全系仅四项必须前置之二，在此一次做对。

## Acceptance criteria

- [ ] 十个域合同 + branded IDs 全量落 contracts，合同测试挂现有模式（三帧 envelope 为先例）
- [ ] ownership matrix 落文档化常量：每个 semantic fact 唯一 writer，构造性测试断言无双写
- [ ] ExecutionPlanSnapshot 含 approvalBasis 两枚举 + snapshotHash（覆盖域=冻结执行内容，不含 confirmationDecisionRef）
- [ ] AgentRun 含 durability: exit|sync 与 sync 必填 executionLink（workflowId+snapshotHash，创建后不可变）
- [ ] 现有创作行为零变化（本票纯合同层，不触运行时）
