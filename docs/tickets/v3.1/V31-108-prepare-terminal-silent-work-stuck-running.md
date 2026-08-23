# V31-108 — V31-41 prepare-terminal 那支对商家静默，且其 work 永久停在 running

**Parent**: V31-105 §13（①A 收口时发现的独立活洞；用户 2026-08-23 裁决开票）
**批次**: 产品缺陷（复用 V31-82 终态路径，半天）
**Blocked by**: V31-105 ①A（`claude/terminal-fail`，`orchestration_lost` 已接进 `terminateRunningWork`）合入
**Related**: V31-41、V31-82、V31-105 §13

**Status**: open（2026-08-23）— prepare 阶段终态拒绝（`PREPARE_TERMINAL_REJECTION`，`submission-coordinator.ts:692`）只做了预留退款对账（`:2115-2171`），把 `creation_submissions.harness_state` 写成 `failed`（`postgres-creation-submission-store.ts:1046`）却**不动 `p1_creative_works`**：work 留在 running，商家侧无申报卡、无「改一下要求」入口；又因 `listStalledWorks`（`:2447`）要求 work=running 且 harness_state≠failed，回收器也永远不会捡它——静默＋永久悬挂

**Implementation state**: not started
**Verification state**: n/a
**Evidence SHA**:
**Workflow Run**:

## 修法（与 ①A 同构）

prepare 终态拒绝时调用 `terminateRunningWork`（`postgres-creation-submission-store.ts:2529`，V31-82）：work→failed、预留 usage＋credits 退回（与现有 prepare 退款对账去重，幂等键复用 `stalledWorkRefundOperationId(taskId)` 或对账记录）、在 task id 与 prepared-attempt run id 两个 workflow_id 下写 `workflow_failed` 审计，让 SSE 抬申报卡与「改一下要求」入口。新增 `StalledWorkTerminalReason='prepare_rejected'`，商家原话按拒绝原因给一句人话（不得写「超时」）。前端零改动。

## 验收

1. 带库单测先红后绿：prepare 终态拒绝 → work failed、积分恰退一次（与既有对账不重复）、审计原话含拒绝原因；二次触发 `already_terminal`。
2. 反向对照：去掉接线 → 上测必红；V31-82/①A 既有用例不受影响。
3. e2e：造一条 prepare 被拒的旅程（fixture 若可造）重开标签页能看到失败卡与重开入口；`xhs-image-text-main-journey` 一轮绿。
4. V31-105 §13 与本票标「已修」。
