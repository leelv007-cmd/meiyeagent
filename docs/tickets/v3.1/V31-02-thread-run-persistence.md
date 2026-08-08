# V31-02 — AgentThread/AgentRun persistence + lazy legacy thread + sessionRevision OCC

**Parent**: spec-A（#1）；权威 V3.1 §9–§10、§27.6、U6
**批次**: 1
**Blocked by**: V31-01
**Status**: ready-for-agent

## What to build

p1_agent_threads / p1_agent_runs 两表与仓储：Thread 跨 Work 长期会话（title/status/activeGoalIds/summaryRevision + 独立 sessionRevision 列），历史 Work 首次打开懒创建 legacy Thread；单活跃写 turn=CAS 递增 sessionRevision，第二写端 409 且 payload 带 current revision；「最近」语义由 Thread 列表投影承接（UI 收编在 V31-05）。

## Acceptance criteria

- [ ] 一个 Thread 可挂多个 Work；legacy Work lazy 打开进 Thread，旧数据零迁移
- [ ] 双端并发写 turn：后提交端收 409 + current sessionRevision（P1 action 边界断言）
- [ ] sessionRevision 与 summaryRevision 分离（摘要更新不参与并发仲裁）
- [ ] sync child run 创建时落 workflowId+snapshotHash，parent 唯一约束 + crash window 重放幂等测试
- [ ] 业务写路径完全不变
