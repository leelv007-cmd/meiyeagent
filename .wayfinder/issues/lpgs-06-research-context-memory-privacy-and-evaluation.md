---
title: "调研上下文记忆、隐私与评测边界"
parent: "../map-lightweight-personalized-generation-spine.md"
labels:
  - wayfinder:research
status: closed
closed_at: 2026-07-24
blocked_by:
  - "锁定轻量主干目的地与收缩权限"
assets:
  - "../../references/analysis/lightweight-generation-spine-research-2026-07-24/06-context-memory-privacy-evaluation-research.md"
---

## Question

个性化内容生成需要怎样区分稳定身份事实、品牌/门店知识、已授权素材、会话上下文、长期偏好与任务反馈？如何做版本、来源、置信度、删除、授权与评测，既避免把所有历史塞进 prompt，也避免无依据地“猜用户特色”？

## Done when

- 使用一手文档、标准或论文解释上下文装配、检索、记忆与评测的边界；
- 给出最小数据分类、版本/来源和删除模型候选；
- 明确不应长期保存或自动推断的内容；
- 提出离线固定样例与在线采纳/编辑/重做信号的最小质量闭环；
- 不把向量库、知识图谱或自主记忆框架预设为必选。

## Resolution

已完成研究并产出 `references/analysis/lightweight-generation-spine-research-2026-07-24/06-context-memory-privacy-evaluation-research.md`：

- 使用 Open CLI 复核全国人大、W3C、NIST、NeurIPS/arXiv、Microsoft Research/HAX 与 OpenAI 官方一手来源；
- 给出稳定身份事实、品牌/门店知识、已授权素材、会话上下文、长期偏好和任务反馈的六层最小分类，以及来源、作用域、版本、置信度、保留、撤权和删除边界；
- 明确敏感信息、事实/权利推断、一次性纠偏、完整会话和弱行为信号等不得自动长期化；
- 提出 32 例离线固定集、八项零容忍守门和采用/编辑/重做/拒绝的最小在线闭环；
- 映射当前 ContextBundle、身份/权利、偏好晋升和失效机制，指出认识状态、统一删除/不复活、会话 TTL 与偏好装配的最小缺口，不预设向量库、知识图谱或自主记忆框架。
