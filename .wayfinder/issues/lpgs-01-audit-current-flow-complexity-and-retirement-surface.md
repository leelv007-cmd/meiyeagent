---
title: "审计当前真实主链、代码规模与退役面"
parent: "../map-lightweight-personalized-generation-spine.md"
labels:
  - wayfinder:research
status: closed
closed_at: 2026-07-24
blocked_by:
  - "锁定轻量主干目的地与收缩权限"
assets:
  - "../../references/analysis/lightweight-generation-spine-research-2026-07-24/01-current-flow-complexity-retirement-audit.md"
---

## Question

当前从用户输入到文案、图片、视频成品的真实可运行路径分别经过哪些模块、数据对象、API 和状态机？代码规模究竟由生产代码、测试、生成物、参考源码、迁移、文档和历史旁路各贡献多少？哪些模块是主链必需、可复用基础、可独立插件、只读历史、冻结候选或退役候选？

## Done when

- 以当前代码和测试为证据绘出三模态真实路径，不把规划当实现；
- 给出可复算的 LOC/文件数口径，排除 vendored、generated 与 reference 项后单列；
- 标出重复编排、重复事实源、重复 API、重复测试面和未进入主链的框架；
- 输出保留/收缩/冻结/退役初步矩阵，但不做最终产品决策。

## Resolution

已完成当前脏工作区的只读审计，并产出：

- `../../references/analysis/lightweight-generation-spine-research-2026-07-24/01-current-flow-complexity-retirement-audit.md`

结论区分了文案结构闭环、图片/视频 durable job 未汇回 Harness/ContentPackage 的缺口、重复状态与流、未挂载实现和兼容路径；同时给出可复算规模口径及初步保留/收缩/插件化/冻结/退役矩阵。本票不实施生产代码变更，也不替后续范围和迁移决策票做最终决定。
