---
title: "调研轻量 Prompt Compiler 与 Harness 模式"
parent: "../map-lightweight-personalized-generation-spine.md"
labels:
  - wayfinder:research
status: closed
closed_at: 2026-07-24
blocked_by:
  - "锁定轻量主干目的地与收缩权限"
assets:
  - "../../references/analysis/lightweight-generation-spine-research-2026-07-24/04-lightweight-harness-prompt-compiler-research.md"
---

## Question

对于“少量用户输入 + 个性化上下文 → 结构化多模态生成指令 → 调用供应商 → 质量反馈”的产品，成熟框架、开源组件和一手工程实践中有哪些足够轻量的 Prompt Compiler、typed structured output、workflow/harness 和 evaluation 组合？哪些应直接采用、二次开发、仅借鉴或不推荐？

## Done when

- 复核现有 DBOS、AI SDK、Langfuse 和仓内 Harness 研究，不从零重复选型；
- 外部候选必须核对官方文档、许可证、维护状态、核心扩展接口和运行负担；
- 至少比较“普通应用服务流水线”“轻量 durable workflow”“通用 Agent/graph framework”三类；
- 明确每类为产品带来的用户价值与新增概念/运行成本；
- 推荐以最少抽象实现当前目标的候选组合，但不替用户锁定。

## Resolution

- 已完成指定研究资产：`../../references/analysis/lightweight-generation-spine-research-2026-07-24/04-lightweight-harness-prompt-compiler-research.md`。
- 结论：保留现有 TypeScript Harness，以 AI SDK + Zod 为 typed output 内核、DBOS 为 durable 外壳、Langfuse + promptfoo/Vitest 为 Prompt/观测/评估闭环；只补轻量 `PromptBinding + CompilationReceipt`，不新建 DSL、graph 或第二套状态机。
- BAML 仅在真实美业数据的同模型配对实验达到业务 SLO 时单节点采用；DSPy、Temporal 仅借鉴离线优化与 durable 工程纪律；LangGraph、Mastra workflow 当前不进入固定五段主干。
- 研究不替用户锁定最终决策；文中列出各候选的重开条件。
