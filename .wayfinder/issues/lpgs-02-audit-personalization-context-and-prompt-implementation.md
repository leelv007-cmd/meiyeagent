---
title: "审计个性化上下文、资源与 Prompt 实现"
parent: "../map-lightweight-personalized-generation-spine.md"
labels:
  - wayfinder:research
status: closed
closed_at: 2026-07-24
blocked_by:
  - "锁定轻量主干目的地与收缩权限"
assets:
  - "../../references/analysis/lightweight-generation-spine-research-2026-07-24/02-personalization-context-prompt-implementation-audit.md"
---

## Question

当前项目对个人身份、品牌、门店、行业、服务项目、素材、历史作品、偏好、禁忌和反馈分别如何存储、装配和注入生成？MarketingIdentity、StoreProfile、OwnedAsset、ContextBundle、Recipe、Brief、Prompt revision 与 Harness 各自实际完成到什么程度，在哪些入口或模态中被绕过？

## Done when

- 从 UI、公共合同、服务端、数据库和生成调用追踪至少一条文案、一条图片和一条视频路径；
- 区分“有数据结构”“进入 prompt”“影响输出”“被记录以供复用”四个层级；
- 识别用户专属信息与通用结构化模板之间的断点；
- 输出可复用实体、重复实体和缺失实体清单，不提前锁定新命名。

## Resolution

已完成当前代码级审计，研究资产见
[`02-personalization-context-prompt-implementation-audit.md`](../../references/analysis/lightweight-generation-spine-research-2026-07-24/02-personalization-context-prompt-implementation-audit.md)。

结论：身份和图片/视频引用素材已在三模态主链真实生效；StoreProfile 与 StoreFact
仍是未桥接的双真相，Recipe `promptRevisionRef` 未绑定实际 Harness Prompt，图片/视频
实际复用 copy Brief Prompt，Preference 与采用/修改反馈尚未进入后续任务。资产同时给出
了 UI→合同→服务端→数据库→Provider 追踪、四层完成度矩阵、重复/缺失实体和分级优化顺序。
