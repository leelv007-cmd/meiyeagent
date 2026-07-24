---
title: "锁定轻量主干目的地与收缩权限"
parent: "../map-lightweight-personalized-generation-spine.md"
labels:
  - wayfinder:grilling
status: closed
closed_at: 2026-07-24
blocked_by: []
---

## Question

这张 Wayfinder 地图是否允许把偏离“个性化提示词 → 图文/视频成品”主干的现有能力明确列为冻结、移出首发或退役，而不是要求全部兼容保留？

## Decision

用户选择“允许主动收缩”：

- 地图可以提出保留、冻结、移出首发、退役和必要数据迁移清单；
- 轻量化是目的地硬约束，不是开发完成后的性能优化；
- 本轮只调研、分析、讨论和规划，不直接删除或改写生产代码；
- 后续每项产品边界与不可逆迁移仍通过独立决策票逐项确认。
