# V31-24 — MarketingGoal 产品面 + Proactive 管道（evidence 门控）

**Parent**: spec-F（#6）`docs/specs/v3.1-agent-specs-2026-08-08/spec-F-434-goal-proactive.md`；权威 V3.1 §11、§25、§26.2、U2/U13
**批次**: 6
**Blocked by**: V31-17, V31-18, V31-19
**Status**: done (merged, 2026-08-08)

**Implementation state**: done
**Verification state**: verified
**Evidence SHA**: 92fa174b2a09b2aa51656bb026a72a518d697314
**Workflow Run**: 
**Artifact Digest**: 

## What to build

Goal 产品面（合同已在 V31-01）：对话中提议创建/提议归组（确认才关联），status 迁移同走提议→确认（revision OCC），进度只投影 delivered Work 与 evidence 不新建统计真相，Idle 首屏当前最重要目标+主动建议；Proactive 管道：Signals（只用真实拥有数据）→确定性过滤→Agent 排序→candidate（derived projection+最小 append-only 决定记录，accept 幂等键=candidateId）→商家提案；evidence 覆盖率准入门（U13：unset=默认关只观测，运营可用既有 flag 按 workspace allowlist 临时开）；接受→正常 Thread→Plan→Work，绝不自动产生付费副作用；Campaign 目标分解按周排期（确认粒度走 V31-11 合同）。

## Acceptance criteria

- [ ] 归组/状态迁移只走提议→确认；无 Goal 管理页
- [ ] 每条建议带「为什么现在」evidence；接受后零付费副作用（退出门）
- [ ] refresh/replay 后记得已忽略/已接受；accept 只创建一个 turn
- [ ] 门 unset=不出建议；allowlist 临时开可用（U13）
- [ ] disable_proactive_agent kill switch 生效

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
