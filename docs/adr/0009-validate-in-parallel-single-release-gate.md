# ADR-0009: Validate in Parallel with a Single P1 Release Gate

Status: accepted (2026-07-11)

P1 在 Scope Lock 后即可开始功能建设，不设置真实商户、付费 cohort 或成效数据的开发准入 Gate；这些验证与 recorded/fake 合同实现并行推进。P1 只有一个面向封闭付费 Beta 的发布 Gate：must-have 用户结果、技术安全、双账、迁移/恢复与可运营性通过后才可放行；从封闭 Beta 转为公众注册或公开收费时，ADR-0005 的 Gate 0 是额外硬前置。

该决定来自 `.scratch/p1-wayfinding/issues/03-set-p1-stage-gates.md` 与 `CONTEXT.md` 的已确认口径，只提升可追溯性，不重开 Scope Lock、改变票 01 frontier 或把法务终审倒灌为创作开发门禁。代价是建设可能先于市场效果证据，Product Owner 必须把真实成效标为并行观察，并接受功能完成不等于商业验证或可公开收费。
