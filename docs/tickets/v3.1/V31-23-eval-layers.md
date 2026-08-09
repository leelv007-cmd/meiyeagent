# V31-23 — Eval：L0/L0.5/L1 + gates/verdict 三态 + L4 canary + 回滚演练

**Parent**: spec-G（#7）；权威 V3.1 §31、§32、U3/U12
**批次**: 5
**Blocked by**: V31-08（复用其 Quick Checks 资产）, V31-21
**Status**: done (merged, 2026-08-08)

## What to build

L0 合同测试整备；L0.5 共享 Quick Checks registry+生产抽样+verdict 存储+release 绑定（**复用 V31-08 的 assertion API，不重写**）；L1 节点数据集 fixtures 为主+脱敏历史抽样（冻结 dataset revision/来源/许可，U3）；gates（忠实性/权利/红线，缺一即 failed）/thresholds（调性/可读性，反向带）/verdict 三态（scored=可放行但记账，放量人工 U12）；全链 trace 字段齐备且不泄密（D-061）；数据写入 Langfuse 不建查看界面；L2/L3 trigger-bound backlog（建时带只读闸）。

## Acceptance criteria

- [ ] gates 缺一即 failed；scored 只记账
- [ ] dataset revision/来源/许可冻结可查
- [ ] trace 无 API Key/未脱敏资料/原始 CoT/上游美元成本
- [ ] 人工回滚演练通过留记录
- [ ] 评估结果绑定 release

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
