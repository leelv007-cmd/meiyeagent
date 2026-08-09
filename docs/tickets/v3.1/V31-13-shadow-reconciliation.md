# V31-13 — shadow 对账（确定性字段、抽样 10%、时间盒）

**Parent**: spec-C（#3）；权威 V3.1 §23.2
**批次**: 3（观测票，不占开发 lane）
**Blocked by**: V31-14
**Status**: done (merged, 2026-08-08)

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
> **一行未填满，对应 AC 不得勾选。**

| AC | production writer | production consumer | failure-recovery test | PG result | Playwright result | required CI job |
|---|---|---|---|---|---|---|
| AC1 | — | — | — | — | — | — |
| AC2 | — | — | — | — | — | — |
| AC3 | — | — | — | — | — | — |
| AC4 | — | — | — | — | — | — |
