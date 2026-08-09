# V31-07 — Intent interpreter + ambiguity policy + 检索 tools

**Parent**: spec-B（#2）；权威 V3.1 §17–§20
**批次**: 2 ｜ **语义锁**: 同 06
**Blocked by**: V31-06
**Status**: done (merged, 2026-08-08)

## What to build

模糊目标→检索门店事实/素材/身份/历史（turn 内 tools，工作流化合并非端点化，检索类带 response_format）→可见假设→高影响歧义每轮最多一问（问题预算 Intent/Plan 各 1）；模糊适配由「影响类别×可逆性×权威来源」决定；Day-0 自由创作事实分层（free 不被 confirmed_store/project 阻断，D-175 沿用）；主动度设置（稳妥/平衡/主动）。工具注册表 sideEffect/riskClass/approval/allowedPhases/maxCalls/timeout。

## Acceptance criteria

- [ ] 已有信息不重复询问；每轮最多一个问题（批次 2 退出门）
- [ ] 假设可见且低风险默认可逆
- [ ] Day-0 零门店商家可达安全通用结果（Playwright §37.4-A）
- [ ] 权利与事实高风险不被 LLM 默认
- [ ] 工具面治理字段齐备并有拒绝理由投影

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
