# V31-09 — PlanProposal → Plan Compiler → MarketingPlanRevision + CompiledExecutionPlan

**Parent**: spec-B（#2）；权威 V3.1 §13、§22.1–22.2、§16
**批次**: 2
**Blocked by**: V31-07
**Status**: done (merged, 2026-08-08)

## What to build

LLM 输出 PlanProposal，确定性 Plan Compiler 补齐事实/权利/能力/quote（模型不写 quote/余额/rights/model availability）编译为 MarketingPlanRevision（append-only 无状态列，readiness 恒 projection）与 plan-as-data 的 CompiledExecutionPlan（typed unit+依赖分组+重试默认关 D-167③+workspace 隔离缓存 key 含 releaseId）；六原语签名不进领域枚举（A8）；Recipe/Skill 沿用 StageTypeRegistry/RecipeCompiler（D-101 链扩容），只做 registry 归并+invocation receipt。

## Acceptance criteria

- [ ] 自然语言调整只产新 revision，旧版本不被覆盖
- [ ] readiness（ready/stale/blocked/reprice_required）恒为 projection，无第二 writer
- [ ] quote/权利由确定性服务覆盖模型提案（退出门）
- [ ] 条件位禁副作用（A18 构造性检查）；无 grammar 解释器
- [ ] 新增 unit type 需注册/schema/policy/测试的边界成立
