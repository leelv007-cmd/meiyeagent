# V31-27 — Mid-run Steering 前台旅程（§37.4-G 缺口整改）

**Parent**: V31-16（票已关，本票承接其未落地的前台部分）
**批次**: 收尾
**Blocked by**: None — can start immediately
**Status**: ready-for-agent

## What to build

商家在运行中（Make 进行时）能直接下达中途指令并看到影响范围反馈——这是 V31-16 验收项「中途指令只修改目标范围（Playwright §37.4-G）」的前台部分。V31-16 已在 Core 落地 steering_submit / list_steering_commands、classifier 四态、双队列与 partial delivery 结算，但 2026-08-09 merge controller 复核发现 web 端零接线：src/ 中不存在任何 steering 输入面或影响反馈面，§37.4-G 浏览器旅程无法成立。

商家可见行为：

1. 运行中（composer session running / workstream 流式中）出现中途指令入口（steering composer），可输入如「封面不要写最后两个名额，第二页少点字」。
2. 提交后得到影响范围反馈（steering impact）：哪些页会改、哪些页保持、费用是否变化。
3. future_step_patch / derived_revision 不弹重报价；plan_change 回方案层 replan + requote 确认；unsafe_or_conflicting 给出解释并要求修正。
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
