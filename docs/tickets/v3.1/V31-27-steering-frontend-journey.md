# V31-27 — Mid-run Steering 前台旅程（§37.4-G 缺口整改）

**Parent**: V31-16（票已关，本票承接其未落地的前台部分）
**批次**: 收尾
**Blocked by**: None — can start immediately
**Status**: done (merged aaad2a0f1, 2026-08-09)

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
> **一行未填满，对应 AC 不得勾选。**

| AC | production writer | production consumer | failure-recovery test | PG result | Playwright result | required CI job |
|---|---|---|---|---|---|---|
| AC1 | — | — | — | — | — | — |
| AC2 | — | — | — | — | — | — |
| AC3 | — | — | — | — | — | — |
| AC4 | — | — | — | — | — | — |
