# V31-19 — OutcomeEvidence 统一（含 no_activity）+ D-168② 删除语义

**Parent**: spec-E（#5）；权威 V3.1 §26.1、U2
**Lane**: Memory 并行 lane
**Blocked by**: V31-01
**Status**: done (2026-08-08, lane merged)

## What to build

OutcomeEvidence 三层（verified/merchant_reported/inferred，inferred 只表达时间相关性禁因果）统一唯一 canonical write contract（现有 manual outcome contract 扩展；result ledger 与 observability 只投影）；signal 枚举显式扩列 no_activity 承载「没动静」chip（禁借 feedback 塞值）；幂等键=contentPackageRef+signal+observedAt/sourceRef；修正/撤回绑定 exact ContentPackage revision；频控参数供 V31-17 消费。

## Acceptance criteria

- [ ] evidence 唯一 writer 构造性检查（result ledger 只投影）
- [ ] 幂等与修正/撤回断言（P1 action 边界）
- [ ] no_activity 全链可用（chip→合同→投影）
- [ ] 40% 首窗只观测（U2），不作硬门

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
