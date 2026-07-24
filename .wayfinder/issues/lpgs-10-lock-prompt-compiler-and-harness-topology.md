---
title: "锁定 Prompt Compiler 与 Harness 拓扑"
parent: "../map-lightweight-personalized-generation-spine.md"
labels:
  - wayfinder:grilling
status: open
blocked_by:
  - "综合主干偏差、可复用资产与候选方案"
  - "锁定个性化上下文领域模型"
---

## Question

从简单输入到结构化多模态指令，最终采用普通应用服务流水线、轻量 durable workflow，还是通用 Agent/graph 编排？哪些步骤必须确定性，哪些允许模型参与，用户在哪些节点可见、可改或确认？

答案必须明确是否保留现有五阶段 Harness、DBOS、DecisionTrace、QuestionCard 与 Prompt revision，以及不得新增的框架和兜底。
