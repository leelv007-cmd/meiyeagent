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

## Evidence

> 空表由 L-CI 脚手架落盘，**Wave 4 对着真实证据填**。填表规则（机器可判优先）：
> `AC<n>` 对应「Acceptance criteria」小节里第 n 个 checkbox 条目，顺序固定；id 列只写
> `AC<n>`，不加任何修饰。writer / consumer 写 `path/to/file.ts:line`。PG result 与
> Playwright result 写真实结果（如 `12/12 pass`）；没跑就留 `—`，不写「应该通过」之类
> 的推测。required CI job 写 `.github/workflows/core-quality.yml` 里的 job 名。
> 单元格内的 `|` 必须转义成 `\|`。空值统一写 `—`。
> **三个结果列各守一轴，不得跨轴填**：`unit/eval result` 只收单测与离线评测结果，
> `PG result` 只收真实 Postgres 套件结果，`Playwright result` 只收浏览器旅程结果。
> 把 `biome` / `tsc` / 单测结果写进 `Playwright result` 属跨轴，须改回本轴。
> 三个结果列的空值分三种，必须区分：`—`＝该格未填（脚手架初始态）；`n/a`＝该 AC 在该轴上
> **没有**证据要求（须在表下用一句话说明为何没有）；`未跑`＝该轴有要求但本轮未执行（须写出
> 未执行的原因）。writer / consumer / failure-recovery test / required CI job 四列的空值
> 仍统一写 `—`。
> **勾选规则**：writer / consumer / failure-recovery test / required CI job 四列非空，**且**
> 三个结果列每一格都是真实结果或 `n/a` ⇒ 方可勾选。任一结果格为 `—` 或 `未跑` ⇒ 不得勾选。
> （原规则是「一行未填满，对应 AC 不得勾选」。在只有 PG / Playwright 两个结果列时，它把
> 「本来就不该有 PG 证据的 AC」也判成未验收——列集扩展史见 V31-29「Evidence」节末。）

| AC | production writer | production consumer | failure-recovery test | unit/eval result | PG result | Playwright result | required CI job |
|---|---|---|---|---|---|---|---|
| AC1 | — | — | — | — | — | — | — |
| AC2 | — | — | — | — | — | — | — |
| AC3 | — | — | — | — | — | — | — |
| AC4 | — | — | — | — | — | — | — |
| AC5 | — | — | — | — | — | — | — |
