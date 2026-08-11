# V31-35 — Plan 里可读的分镜（§37.4-D 缺口，contracts→compiler→投影三段接缝）

**Parent**: V31-14（§37.4-D 旅程）；接缝跨 V31-01 契约 / V31-09 plan compiler / V31-10 Living Plan 投影
**批次**: 收尾
**Blocked by**: None — 但属跨域接缝，开工前须由主控指派单一 owner lane（语义锁：三处改动不可分包）
**Status**: **废止（2026-08-11 用户拍板，不实施）**

**Implementation state**: void
**Verification state**: unverified
**Evidence SHA**: 
**Workflow Run**: 
**Artifact Digest**: 

## 决策记录（2026-08-11）

**用户拍板：本票前提被推翻，整票废止**——原文：「商家不需要知道分镜，以及分镜与积分的关系。因为上游供应商没有任何关于『分镜』的计费规则，分镜只是应用在提示词生成的环节，与计费无关。」即：

- §37.4-D「Plan 显示分镜」要求废止，Plan 只显示时长/积分（已落地，`agent-plan-section-cost_duration`）；
- 分镜定位为提示词生成环节的内部产物（§17.2 LLM 职责不变），不进 Plan、不与积分建立任何关系；
- 三段接缝（契约场景坐标/compiler 产出/Living Plan 投影）均不建设；
- 旅程 D 中标题带 V31-35 的 `test.fixme` 直接删除（该腿从 §37.4-D 移除，不存在「改弱」问题）；
- Make 之后的逐场景分镜进度（V31-15 artifact）与交付工作面 shot list（`video-worksurface.tsx` `video-shot`）**不受影响**，继续保留。

决策已落盘：权威规划 §37.4-D 同步修订。

## What to build

商家在**确认执行之前**就能在 Living Plan 里读到这条视频将拍哪几个镜头。§37.4-D 原文要求 Plan 显示「时长/分镜/积分」——积分与时长已落地（`agent-plan-section-cost_duration` 含「预计积分 N 分」「预计时长」），**分镜没有**：它只在 Make 之后、在交付工作面上才出现，商家花积分时看不到自己买的是什么镜头。

这是三段接缝，缺任一段都不成立：

1. **契约**：`packages/contracts/src/agent-domain.ts:444-452` 的 `planDeliverableSchema` 是 `.strict()`，字段只有 `deliverableId/kind/platform/quantity/purpose`——没有任何分镜/场景坐标，且 strict 意味着 compiler 也塞不进去。需要在 plan revision 契约上给出分镜坐标（场景数与逐镜要点的最小形状，注意 D-061 不暴露上游成本、不泄露内部实现词）。
2. **compiler**：plan compiler 需在编译视频交付物时产出该坐标（不是前端自演——禁止 web 端凭 intent 猜镜头）。
3. **投影**：`mkfast-template-main/src/product/agent-workbench/plan/living-plan-model.ts:17-21` 的五节枚举（goal/deliverables/expression/facts_assets/cost_duration）需让分镜可读；建议落在 `deliverables`（「本次制作」，section builder 在 :253-257）而非新增第六节，否则 `diffLivingPlanViews` 的节集合断言与既有旅程都要跟着改。

分镜现居下游：`mkfast-template-main/src/product/results/video/video-worksurface.tsx:154-164`（`data-testid="video-shot"` / `video-shot-label`）。本票不是把这块搬走，是让计划期先有一份可读的镜头意图。

## Acceptance criteria

- [ ] `tests/e2e/specs/v31-video-paid-execution-journey.spec.ts` 中标题带 `V31-35` 的 fixme 去除并全绿——该断言即验收合同：确认执行**之前** Plan 内可读到分镜，且断言面向真实 testid（禁止改弱、禁止挪到 Make 之后）
- [ ] 消费者证明：Living Plan 分镜行消费 compiler 产出的契约字段（禁止 web 端由 intent/配方名推导）
- [ ] 契约收紧不破既有 strict 保证（新字段 optional 或显式必填 + migration 说明，不得改成 passthrough）
- [ ] 商家语言合规：分镜文案符合 D-061（不暴露上游模型/成本）与交付语言合同
- [ ] Living Plan 五节现有断言与 `v31-living-plan-journey.spec.ts` / `v31-context-fence-journey.spec.ts` 的节集合断言不被打红（若必须变更节语义，先回主控裁决）

## Blocked by

- None — Core 与前端两侧都无前置票；唯一约束是三段改动须同一 lane 串行（语义锁）

## 证据表

| 门 | 命令 | 库 | 计数 | exit | 备注 |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

> 开工后填；退出码一律从重定向文件取（`| tail` 会吞 exit code），PG 证据一律出自 `scripts/ci/provision-test-db.sh` 一次性库。表格形制以 V31-29/V31-30 落地后为准，届时以那两票为准改写本表。

## 背景记录

- 2026-08-09 L-T3（Task 3 §37.4-D 旅程）开票：写 D 旅程时逐条核 §37.4-D 六腿，四腿可断（积分/时长、typed interrupt、关标签页、恢复到交付且单次扣费），分镜这腿在本 HEAD 不可断。按主控裁决保留 `test.fixme` 挂 blocker（required 门不允许永久红，伪造绿恒禁），债转本票。
- 判定依据：契约 strict 且无场景字段（上引 agent-domain.ts:444-452）＋五节枚举无分镜行（living-plan-model.ts:17-21）＋分镜唯一现居地在 Make 之后的 worksurface（video-worksurface.tsx:154-164）。属「后端建满、计划期没有」而非测试缺失。
