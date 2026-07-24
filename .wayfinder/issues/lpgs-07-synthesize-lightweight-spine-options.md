---
title: "综合主干偏差、可复用资产与候选方案"
parent: "../map-lightweight-personalized-generation-spine.md"
labels:
  - wayfinder:research
status: closed
closed_at: 2026-07-24
blocked_by:
  - "审计当前真实主链、代码规模与退役面"
  - "审计个性化上下文、资源与 Prompt 实现"
  - "调研供应商 API 差异与最小适配合同"
  - "调研轻量 Prompt Compiler 与 Harness 模式"
  - "调研小白创作交互与质量反馈闭环"
  - "调研上下文记忆、隐私与评测边界"
assets:
  - "../../references/analysis/lightweight-generation-spine-research-2026-07-24/07-lightweight-generation-spine-synthesis.md"
---

## Question

综合六张研究票，当前项目为什么没有把“个性化上下文编译”变成唯一产品主干？现有资产中哪些可以直接保留，哪些需要收缩，哪些应冻结或退役？有哪些 2–3 套足够不同的轻量主干候选，它们的产品完整度、迁移风险、运行复杂度和代码规模代价分别是什么？

## Done when

- 所有判断可追溯到前置研究资产；
- 给出当前偏差的形成机制，而不只列症状；
- 给出 2–3 套可讨论候选和明确推荐，不替用户关闭后续决策票；
- 单列“不必要的兜底”“不够优雅的框架/实施方式”和可删除复杂度；
- 明确哪些结论仍需用户逐项拍板。

## Resolution

已综合六份前置研究并产出：

- `../../references/analysis/lightweight-generation-spine-research-2026-07-24/07-lightweight-generation-spine-synthesis.md`

综合稿追溯了 01–06 的代码、供应商、Harness、交互、隐私与评测证据，裁决了媒体闭环、DBOS、偏好 fail-closed、反馈入口和轻量供应边界之间的表面矛盾；解释了复杂度形成机制，并比较“固定供应商极简”“复用优先、边界受限”“平台路线”三套候选及可测轻量预算。报告明确推荐第二套作为后续讨论基线，同时单列保留/收缩/插件化/冻结/退役、不必要兜底、不够优雅的实施方式、可删除复杂度和仍需用户逐项拍板的决策。本票不修改 map、产品代码，也不替后续决策票锁定最终范围或不可逆迁移。
