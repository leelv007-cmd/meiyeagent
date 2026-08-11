# V31-13 — shadow 对账（确定性字段、抽样 10%、时间盒）

**Parent**: spec-C（#3）；权威 V3.1 §23.2
**批次**: 3（观测票，不占开发 lane）
**Blocked by**: V31-14
**Status**: evidence-debt — implementation SHA is recorded; Workflow Run / Artifact Digest provenance pending

**Implementation state**: done
**Verification state**: evidence-debt
**Evidence SHA**: 89e05345d6ea2e8c95816e92ecb732609f5fca2b
**Workflow Run**: 
**Artifact Digest**: 

## What to build

过渡期 shadow 对账：新链消费 snapshot 的产物与旧链只比确定性字段，抽样约 10%，连续 2–4 周 mismatch=0 即提前关闭（关停 owner=本票，不留常驻机器）。

## Acceptance criteria

- [ ] 只比确定性字段（不烧 LLM）
- [ ] 抽样率与窗口可配置且有观测面
- [ ] mismatch 告警可定位到字段级 diff
- [ ] 关闭动作有留痕（时间盒到期或提前达标）

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
