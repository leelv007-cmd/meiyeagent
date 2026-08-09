# V31-02 — AgentThread/AgentRun persistence + lazy legacy thread + sessionRevision OCC

**Parent**: spec-A（#1）；权威 V3.1 §9–§10、§27.6、U6
**批次**: 1
**Blocked by**: V31-01
**Status**: done (merged, 2026-08-08)

## What to build

p1_agent_threads / p1_agent_runs 两表与仓储：Thread 跨 Work 长期会话（title/status/activeGoalIds/summaryRevision + 独立 sessionRevision 列），历史 Work 首次打开懒创建 legacy Thread；单活跃写 turn=CAS 递增 sessionRevision，第二写端 409 且 payload 带 current revision；「最近」语义由 Thread 列表投影承接（UI 收编在 V31-05）。

## Acceptance criteria

- [ ] 一个 Thread 可挂多个 Work；legacy Work lazy 打开进 Thread，旧数据零迁移
- [ ] 双端并发写 turn：后提交端收 409 + current sessionRevision（P1 action 边界断言）
- [ ] sessionRevision 与 summaryRevision 分离（摘要更新不参与并发仲裁）
- [ ] sync child run 创建时落 workflowId+snapshotHash，parent 唯一约束 + crash window 重放幂等测试
- [ ] 业务写路径完全不变

## Evidence

> 空表由 L-CI 脚手架落盘，**Wave 4 对着真实证据填**。填表规则（机器可判优先）：
> `AC<n>` 对应「Acceptance criteria」小节里第 n 个 checkbox 条目，顺序固定；id 列只写
> `AC<n>`，不加任何修饰。writer / consumer 写 `path/to/file.ts:line`。PG result 与
> Playwright result 写真实结果（如 `12/12 pass`）；没跑就留 `—`，不写「应该通过」之类
> 的推测。required CI job 写 `.github/workflows/core-quality.yml` 里的 job 名。
> 单元格内的 `|` 必须转义成 `\|`。空值统一写 `—`。
> **一行未填满，对应 AC 不得勾选。**

| AC | production writer | production consumer | failure-recovery test | PG result | Playwright result | required CI job |
|---|---|---|---|---|---|---|
| AC1 | — | — | — | — | — | — |
| AC2 | — | — | — | — | — | — |
| AC3 | — | — | — | — | — | — |
| AC4 | — | — | — | — | — | — |
| AC5 | — | — | — | — | — | — |
