---
title: "我方 P0 数据模型与 API 合同规格"
parent: "../map-creatok-product-research.md"
labels:
  - wayfinder:research
  - wayfinder:claimed
status: closed
claimed_at: 2026-07-07
closed_at: 2026-07-07
blocked_by:
  - "我方 P0 产品页面蓝图与工作流规格"
assets:
  - "../../references/product/reports/p0-data-model-api-contract.md"
---

## Question

基于 P0 页面蓝图与工作流规格，我方 Core API/Postgres 需要哪些核心数据模型、状态字段、索引、接口合同和审计事件？需要覆盖 Store Profile、Asset、Content Item、Platform Variant、Compliance Result、Publish Package、Publish Task、Lead、Usage Ledger、Agent Run、Tool Call，并明确哪些事实归 Core API、哪些只归 App Shell/Agent Service/Worker Pool/R2。
