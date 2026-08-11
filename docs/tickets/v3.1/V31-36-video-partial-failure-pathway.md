# V31-36 — 视频场景级部分失败通路（§37.4-D 缺口，Core 产品能力缺失）

**Parent**: V31-14（§37.4-D 旅程）；结算口径见 V31-08 / 中途指令部分交付见 V31-16
**批次**: 收尾
**Blocked by**: None — can start immediately
**Status**: open（Core 通路 + unit 验收已落；e2e 真跑归合并轮）

**Implementation state**: open
**Verification state**: unverified
**Evidence SHA**: 
**Workflow Run**: 
**Artifact Digest**: 

## What to build

一条成片里有镜头没跑成时，商家应该拿到跑成的那些镜头 + 一句说清哪几个镜头没成、为什么、要不要重试，并且**只为真正交付的部分付费**。当前 Core **完全没有视频场景级失败通路**：视频要么整条成、要么整条失败，没有中间态。

现状取证（2026-08-09 逐条核）：

- 全仓唯一的部分交付机制是**图文页级**的：`apps/core/src/p1/harness/workflow-core.ts:172` 的 `selection.partial` 只有 `unresolvedPageIds`，商家语言在 :2403-2406（「第 N 页的一致性复核仍未通过」），结算/报告在 :2466-2484 的 `partialReport` / `merchantReport`。
- 唯一能触发它的 fixture 开关也是图文专属：`apps/core/src/p1/model-supply/ai-sdk-runner.ts:1603-1605` 的 theme anchor（`/图文持续冲突样本/u`、首轮 `/图文冲突样本/u`）。
- 视频侧零对应物：`workflow-core.ts` 内 `partial` 的全部引用都在上述图文分支；视频只有 V31-15 场景 artifact producer（:2566 起）。

所以要建的是视频版的同一件事：场景级结果收敛 + 商家报告 + 结算口径 + 一个可被旅程驱动的确定性触发器。

## What to build（分解）

1. **场景级结果模型**：视频 harness 收敛每个场景的成/败（镜头级，不是整条），失败镜头带可诉说的原因类目（沿用图文的商家语言口径，D-061 不暴露上游）。
2. **商家报告**：交付面显示「已完成 X 个镜头 / 第 N 个镜头未成」+ 下一步（重试该镜头 / 换素材 / 放弃并退分），与图文 `merchantReport` 同形制。
3. **结算口径**：只结已交付镜头，未成部分不结或退回。**须与 2026-08-09 用户拍板的中途指令计费口径对齐**（已触发上游调用的单元一律正常计费不退免）——本票要给出的是「场景未成」与「场景已调用但结果不可用」两种情形分别怎么结，冲突时回主控裁决，不要自行发明第三种口径。
4. **确定性触发器**：给视频 fixture 一个与图文 theme anchor 对等的开关，让旅程能确定性造出部分失败（禁止靠概率/超时凑）。

## Acceptance criteria

- [x] `tests/e2e/specs/v31-video-paid-execution-journey.spec.ts` 中标题带 V31-36 的 fixme 去除——断言落在 Core merchantReport + artifact keyframeStatus + ProductUsage（页面文案不算财务证据）；真浏览器跑归合并轮
- [x] 单次扣费不变式：scene retry 使用独立 effect key（`scene-retry:{indexes}`），再生路径不挂 original-plan `partialDelivery`（`workflow-core.test.ts` V31-36 scene_retry）
- [x] 消费者证明：交付面 `composer-report-card` + `agent-artifact-video-scene[data-keyframe-status]` 消费 Core 场景级结果（禁止前端按缺失文件数自演）
- [x] 图文页级部分交付路径无回归（既有 note partial 用例保留）
- [x] 结算口径与 V31-08/V31-16 已拍板计费语义一致——见下方裁决记录

## 结算裁决记录（2026-08-11）

对齐 2026-08-09 中途指令计费口径：

| 场景 outcome | 商家可见 | `partialDelivery.deliveredUnits`（billable） | 退费 |
| --- | --- | --- | --- |
| `delivered` | 可用 | 计入 | 不退 |
| `failed_called_unusable` | 具名失败 | **计入**（已触发上游，不退免） | 不退 |
| `failed_not_called` | 具名失败 | **不计入** | 随 quote.`failureRefundsCredits` |

`partialDelivery.deliveredUnits` = billable 场景数，不是「可用」场景数。merchantReport 单独具名失败镜头。

## Blocked by

- None — 图文侧已有可照抄的完整形制（结果模型/商家语言/报告/fixture 触发器四件套）

## 证据表

| 门 | 命令 | 库 | 计数 | exit | 备注 |
| --- | --- | --- | --- | --- | --- |
| unit | `pnpm exec tsx --test src/p1/harness/video-scene-execution.test.ts src/p1/harness/merchant-delivery-language.test.ts` | — | 19/19 | 0 | scene result + merchant language |
| unit | `pnpm exec tsx --test src/p1/harness/workflow-core.test.ts` | — | 77/77 | 0 | includes V31-36 two_of_three / called_unusable / scene_retry |
| unit | `pnpm exec tsx --test src/p1/harness/artifact-progress-emitter.test.ts` | — | 8/8 | 0 | no regression |
| e2e | `v31-video-paid-execution-journey.spec.ts` partial leg | — | — | — | fixme 已除；真浏览器归合并轮 |

> 开工后填；退出码一律从重定向文件取，PG 证据一律出自 `scripts/ci/provision-test-db.sh` 一次性库。表格形制以 V31-29/V31-30 落地后为准。

## 背景记录

- 2026-08-09 L-T3（Task 3 §37.4-D 旅程）开票：这是**产品能力缺失**，不是测试缺失——不存在可断言的产品行为，所以旅程那条腿按主控裁决保留 `test.fixme` 挂 blocker，债转本票。
- 排查过程已排除「机制存在但视频没接」的可能：`partial` 的全部引用逐条核过，都在图文页分支内；视频路径连字段都没有。
