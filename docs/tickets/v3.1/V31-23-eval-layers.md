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
> **一行未填满，对应 AC 不得勾选。**

| AC | production writer | production consumer | failure-recovery test | PG result | Playwright result | required CI job |
|---|---|---|---|---|---|---|
| AC1 | — | — | — | — | — | — |
| AC2 | — | — | — | — | — | — |
| AC3 | — | — | — | — | — | — |
| AC4 | — | — | — | — | — | — |
| AC5 | — | — | — | — | — | — |
