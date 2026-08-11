# V31-01 — Agent 域 contracts + branded IDs + ownership matrix（含 release 合同）

**Parent**: spec-A（#1）`docs/specs/v3.1-agent-specs-2026-08-08/spec-A-429-foundation.md`；权威 V3.1 §7–§10、§14.2、§29（合同形状）
**批次**: 1（全系前沿票）
**Blocked by**: 无——立即可开工
**Status**: done (2026-08-08, merged d69e4db2)

**Implementation state**: done
**Verification state**: verified
**Evidence SHA**: 60b059d6b57d11d56b3e833008c2318c50abead4
**Workflow Run**: 
**Artifact Digest**: 

## What to build

Agent 域全部新合同落 `packages/contracts`：thread/run/goal/plan/memory/event/execution-plan/**release**/steering/outcome，branded IDs + canonical ownership matrix（one writer per semantic fact）。release 合同（HarnessReleaseArtifact 含 middlewareBindings+controlLimits、Lifecycle、Rollout）属主在本票，V31-20/21 只消费不再定义。schema versioning 与 one-writer enforcement 是全系仅四项必须前置之二，在此一次做对。

## Acceptance criteria

- [ ] 十个域合同 + branded IDs 全量落 contracts，合同测试挂现有模式（三帧 envelope 为先例）
- [ ] ownership matrix 落文档化常量：每个 semantic fact 唯一 writer，构造性测试断言无双写
- [ ] ExecutionPlanSnapshot 含 approvalBasis 两枚举 + snapshotHash（覆盖域=冻结执行内容，不含 confirmationDecisionRef）
- [ ] AgentRun 含 durability: exit|sync 与 sync 必填 executionLink（workflowId+snapshotHash，创建后不可变）
- [ ] 现有创作行为零变化（本票纯合同层，不触运行时）

## Evidence

> 空表由 L-CI 脚手架落盘，**Wave 4 对着真实证据填**。填表规则（机器可判优先）：
> `AC<n>` 对应「Acceptance criteria」小节里第 n 个 checkbox 条目，顺序固定；id 列只写
> `AC<n>`，不加任何修饰。writer / consumer 写 `path/to/file.ts:line`。PG result 与
> Playwright result 写真实结果（如 `12/12 pass`）；没跑就留 `—`，不写「应该通过」之类
> 的推测。required CI job 写 `.github/workflows/core-quality.yml` 里的 job 名。
> 单元格内的 `|` 必须转义成 `\|`。空值统一写 `—`。
> **三个结果列各守一轴，不得跨轴填**：`unit/eval result` 只收单测与离线评测结果，
> `PG result` 只收真实 Postgres 套件结果，`Playwright result` 只收浏览器旅程结果。
> 把 `biome` / `tsc` / 单测结果写进 `Playwright result` 属跨轴，须改回本轴。
> 三个结果列的空值分三种，必须区分：`—`＝该格未填（脚手架初始态）；`n/a`＝该 AC 在该轴上
> **没有**证据要求（须在表下用一句话说明为何没有）；`未跑`＝该轴有要求但本轮未执行（须写出
> 未执行的原因）。writer / consumer / failure-recovery test / required CI job 四列的空值
> 仍统一写 `—`。
> **勾选规则**：writer / consumer / failure-recovery test / required CI job 四列非空，**且**
> 三个结果列每一格都是真实结果或 `n/a` ⇒ 方可勾选。任一结果格为 `—` 或 `未跑` ⇒ 不得勾选。
> （原规则是「一行未填满，对应 AC 不得勾选」。在只有 PG / Playwright 两个结果列时，它把
> 「本来就不该有 PG 证据的 AC」也判成未验收——列集扩展史见 V31-29「Evidence」节末。）

| AC | production writer | production consumer | failure-recovery test | unit/eval result | PG result | Playwright result | required CI job |
|---|---|---|---|---|---|---|---|
| AC1 | — | — | — | — | — | — | — |
| AC2 | — | — | — | — | — | — | — |
| AC3 | — | — | — | — | — | — | — |
| AC4 | — | — | — | — | — | — | — |
| AC5 | — | — | — | — | — | — | — |
