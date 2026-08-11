# V31-16 — Steering service + classifier 四态 + 双队列 + partial delivery

**Parent**: spec-D（#4）；权威 V3.1 §5.6、§23.3、§24.2
**批次**: 4
**Blocked by**: V31-14, V31-15
**Status**: done (merged, 2026-08-09)

**Implementation state**: done
**Verification state**: verified
**Evidence SHA**: 1f2ac579ee18ff22dd151f6b5b6f78f15abfb7d3
**Workflow Run**: 
**Artifact Digest**: 

## What to build

运行中商家指令按影响分类精准应用：future_step_patch（不重报价）/derived_revision/plan_change（回方案层 replan+requote）/unsafe_or_conflicting（解释并要求修正）；双队列 steer（当前单元完成即插入）/follow_up（全部完成后插入）；影响范围明确反馈；6 页成功 5 页只重做失败页+退费规则清楚（partial delivery 结算）；全部 Steering 形成可追踪 command（绑定 revision/snapshot），accepted/acceptance_unknown 的 Provider 副作用不可被「修改」。

## Acceptance criteria

- [ ] 中途指令只修改目标范围，其余页保持（Playwright §37.4-G）
- [ ] 数量/费用变化回方案层重报价确认
- [ ] partial delivery 结算与退费断言
- [ ] steering 分类与影响范围断言（P1 action 边界）
- [ ] make_steering_v1 flag + disable_make_steering kill switch 生效

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
