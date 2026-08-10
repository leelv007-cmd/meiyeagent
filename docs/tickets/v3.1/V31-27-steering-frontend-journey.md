# V31-27 — Mid-run Steering 前台旅程（§37.4-G 缺口整改）

**Parent**: V31-16（票已关，本票承接其未落地的前台部分）
**批次**: 收尾
**Blocked by**: None — can start immediately
**Status**: merged-with-evidence-debt (merged aaad2a0f1, 2026-08-09) — Wave-4 浏览器实证证伪 AC1（`v31-mid-run-steering-journey` 2 FAIL，红在前置步骤，本票被测行为未被走到）；降级为主控 2026-08-10 裁决，口径同 V31-18

## What to build

商家在运行中（Make 进行时）能直接下达中途指令并看到影响范围反馈——这是 V31-16 验收项「中途指令只修改目标范围（Playwright §37.4-G）」的前台部分。V31-16 已在 Core 落地 steering_submit / list_steering_commands、classifier 四态、双队列与 partial delivery 结算，但 2026-08-09 merge controller 复核发现 web 端零接线：src/ 中不存在任何 steering 输入面或影响反馈面，§37.4-G 浏览器旅程无法成立。

商家可见行为：

1. 运行中（composer session running / workstream 流式中）出现中途指令入口（steering composer），可输入如「封面不要写最后两个名额，第二页少点字」。
2. 提交后得到影响范围反馈（steering impact）：哪些页会改、哪些页保持、费用是否变化。
3. future_step_patch / derived_revision 不弹重报价；plan_change 回方案层 replan + requote 确认；unsafe_or_conflicting 给出解释并要求修正。
   **计费口径（2026-08-09 用户拍板）**：已触发上游 API 调用的单元一律正常计费不退免；局部修改＝生成「修改对象」并按正常口径计费。影响反馈里必须把这两点讲清楚（积分口径、D-061 不暴露上游成本），例：「封面与第 2 页将按修改重新生成并计 X 分；其余页不变不计费」。
4. 指令形成可追踪 command（绑定 revision/snapshot），在会话恢复后仍可见。

## Acceptance criteria

- [ ] `tests/e2e/specs/v31-mid-run-steering-journey.spec.ts` 两条 fixme 去除并全绿（该文件即验收合同；面向真实 testid 接线，禁止改弱断言）
- [ ] 运行中入口只在 run 可被 steering 的状态出现（非运行态不出现）
- [ ] 影响反馈的商家语言符合 D-061（不暴露上游成本）与交付语言合同
- [ ] 消费者证明：steering 输入面消费 Core steering_submit，影响反馈消费其分类结果（禁止前端自演）

## Blocked by

- None — can start immediately（Core seam 已在 V31-16 就绪）

## 背景记录

- 2026-08-09 triage：spec 原引用 steering-composer-input / steering-submit / steering-impact / plan-requote-card 等 testid 在产品源码中不存在；V31-16 合并对 mkfast-template-main 零改动。属「后端建满、前台没接」失效模式（docs/reviews/product-plan-implementation-gap-review-2026-07-27.md 四失效模式之一）。

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

## Wave-4 浏览器实证：AC1 未成立（2026-08-10，review-memory 落，W4-D 证据）

**本票 Status 是 `done (merged aaad2a0f1)`，但它自己的第一条 AC 在真实浏览器上不成立。** AC1 原文是「`tests/e2e/specs/v31-mid-run-steering-journey.spec.ts` 两条 fixme 去除并全绿（该文件即验收合同）」；W4-D 2026-08-10 第三轮逐 spec 独立进程实跑，该 spec **2 FAIL**（`scratchpad/w4d/round3-per-spec/SUMMARY.txt`：`exit=1 fail=[2 failed]`）。

**关键：红在前置步骤，本票的被测行为一次都没被执行到。** 两条用例分别停在 `spec.ts:108` 与 `:169`，断言是同一个 `progressHost`：

| 项 | 实测 |
|---|---|
| 失败用例 1 | `spec.ts:78` `修改封面与第二页 → 其他页保持 → 无费用变化直接应用`（2.2m） |
| 失败用例 2 | `spec.ts:146` `增加页数进入 replan + requote 确认`（2.1m） |
| 断言 | `:108` / `:169` `await expect(progressHost.first()).toBeVisible({ timeout: 120_000 })` |
| 定位器 | `getByTestId('plan-commit-strip').or(getByTestId('artifact-panel')).or(getByTestId('agent-activity-line')).or(getByTestId('composer-question-turn')).first()` |
| 结果 | 四个 testid **一个都没出现**，120s 超时 |

**判定：与 V31-28 同因，不另开票。** 三条理由：

1. `progressHost` 的四个候选里，`plan-commit-strip` 与 `artifact-panel` 正是 **V31-28 的主题**——那张票的原话就是「Living Plan、commit strip、plan diff 与 typed interrupt 的刷新持久面必须**确定性**出现在旅程里……当前真实浏览器旅程中这些面不出现」。
2. 定位器用了 `.or()` 串起**四个**候选，四个全没出现——所以这不是选择器挑错了的问题。
3. 失败位置是 steering 的**前置**（等运行出现进度面），意味着 steering 输入面与影响反馈面（本票真正要建的东西）**根本没被走到**。本票的 AC2/AC3/AC4 目前既没被证实也没被证伪。

**给主控的收口含义**：V31-28 的缺口修好之前，本票的 AC1 无法转绿，AC2-AC4 无法开始验证。本票的 `done` 应视为**未验收**（同 V31-18 那类「done 但 AC 未成立」），处置口径请与 V31-18 的 `merged-with-evidence-debt` 一并裁。**本轮未改本票 Status 与任何 checkbox。**
