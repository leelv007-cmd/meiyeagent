# V31-10 — Living Plan UI + diff + Compact Plan + commit strip

**Parent**: spec-B（#2）；权威 V3.1 §5.2–5.3
**批次**: 2（frontend lane 可承接）
**Blocked by**: V31-04, V31-09
**Status**: done (merged, 2026-08-08)

## What to build

同一 Workstream 里长出 Living Plan 活文档（目标/本次制作/表达策略/事实与素材/预计积分时长），自然语言调整（「只做小红书」「减到 4 页」）产生新 revision 并显示 diff；Compact Plan 与 commit strip 统一现有 Brief/quote/confirm 呈现；组件注册进 Controlled Surface Registry（只注册本票组件）。

## Acceptance criteria

- [ ] 用户在一个连续面理解目标/交付/事实/素材/费用/风险（退出门）
- [ ] 调整产生 revision + 可读 diff，旧版本可回看
- [ ] Playwright：定制图文 检索→一问→Living Plan→调整（§37.4-C 前半）
- [ ] 移动端 Bottom Sheet 形态可用

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
