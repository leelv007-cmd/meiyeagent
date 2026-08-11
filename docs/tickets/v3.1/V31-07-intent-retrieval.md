# V31-07 — Intent interpreter + ambiguity policy + 检索 tools

**Parent**: spec-B（#2）；权威 V3.1 §17–§20
**批次**: 2 ｜ **语义锁**: 同 06
**Blocked by**: V31-06
**Status**: done (merged, 2026-08-08)

**Implementation state**: done
**Verification state**: verified
**Evidence SHA**: 868b98836fc4af9a13bb101a0d25a71af93bcabe
**Workflow Run**: 
**Artifact Digest**: 

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
