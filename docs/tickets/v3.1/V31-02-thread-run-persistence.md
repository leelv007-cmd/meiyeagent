# V31-02 — AgentThread/AgentRun persistence + lazy legacy thread + sessionRevision OCC

**Parent**: spec-A（#1）；权威 V3.1 §9–§10、§27.6、U6
**批次**: 1
**Blocked by**: V31-01
**Status**: evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending

**Implementation state**: done
**Verification state**: evidence-debt
**Evidence SHA**: 5dca0ab561a44c45501bd0b9d41f9428ec229905
**Workflow Run**: 
**Artifact Digest**: 

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
