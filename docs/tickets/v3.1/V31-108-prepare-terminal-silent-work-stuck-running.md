# V31-108 — V31-41 prepare-terminal 那支对商家静默，且其 work 永久停在 running

**Parent**: V31-105 §13（①A 收口时发现的独立活洞；用户 2026-08-23 裁决开票）
**批次**: 产品缺陷（复用 V31-82 终态路径，半天）
**Blocked by**: V31-105 ①A（`claude/terminal-fail`，`orchestration_lost` 已接进 `terminateRunningWork`）合入
**Related**: V31-41、V31-82、V31-105 §13

**Status**: 已修待关（2026-08-25）— prepare 终态拒绝已接 `terminateRunningWork`（`prepare_rejected`）；work 不再静默 running；积分恰退一次

**Implementation state**: implemented
**Verification state**: local-verified (unit + postgres + e2e fixture + cataloged Playwright green)
**Evidence SHA**: ad612a3268c2b45f24ad2adfce9d36ba9e7dcf7f
**Workflow Run**:
**Artifact Digest**:

## 实施记录（Lane P，2026-08-25）

生产接线：`recoverPendingStarts` 在 `recordPrepareFailure` 终态化之后调用 `failCreationForPrepareTerminalRejection`（`prepare-terminal-rejection.ts`，reason 硬编码 `prepare_rejected`）。`refundPrepareTerminalReservation` 退款幂等键改为 `stalledWorkRefundOperationId(taskId)`，并在对账提交后再调同一 helper，覆盖 record 与 terminate 之间的崩溃窗口。商家原话 `这次创作没能开始，{safeReason}。积分已经退回。`（无 CJK / 像栈的 reason 不进申报卡）；`WORK_EXECUTION_STALLED` 仍走现成申报卡／改一下要求。前端零改动。

验收：

1. 带库单测先红后绿：修前 `work status actual: 'running' expected: 'failed'`；修后 work=`failed`、`failureReason='prepare_rejected'`、`failureCode=WORK_EXECUTION_STALLED`、积分 80→100、REFUND 恰 1 条、审计含拒绝原因且不含「超时」、二次 `already_terminal`。
2. 反向对照：helper 若改成 `reason:'timeout'`，postgres 断言 `failureReason` 与「不得匹配 超时」必红（同 ①A）。缺 `terminateRunningWork` 的 store 抛错而非悬挂。V31-82／①A／V31-41 既有带库用例保持绿。
3. e2e：**绿**（isolated PORT=3310 / CORE=4310 / 54329 `meiye_lane_drv_e2e`）。夹具 terminate 后 cancel DBOS；同页抬申报卡；reload 从 recentlyCompleted.merchantReport 重挂。`xhs-image-text-main-journey`：PR #41 `production-journey-composer-xhs` 绿。
4. 本票与 V31-105 §13 静默悬挂标「已修」。opt-in 证据债：SHA `12d8c3849` / `88ed903d4` 已签；HEAD `ad612a326` 官方 blocking 29 files / 169 tests 绿，收据 `dd2d3cbd_4794_4508_a0bd_ccded1833404`。

## 修法（与 ①A 同构）

prepare 终态拒绝时调用 `terminateRunningWork`（`postgres-creation-submission-store.ts:2529`，V31-82）：work→failed、预留 usage＋credits 退回（与现有 prepare 退款对账去重，幂等键复用 `stalledWorkRefundOperationId(taskId)` 或对账记录）、在 task id 与 prepared-attempt run id 两个 workflow_id 下写 `workflow_failed` 审计，让 SSE 抬申报卡与「改一下要求」入口。新增 `StalledWorkTerminalReason='prepare_rejected'`，商家原话按拒绝原因给一句人话（不得写「超时」）。前端零改动。

## 验收

1. 带库单测先红后绿：prepare 终态拒绝 → work failed、积分恰退一次（与既有对账不重复）、审计原话含拒绝原因；二次触发 `already_terminal`。
2. 反向对照：去掉接线 → 上测必红；V31-82/①A 既有用例不受影响。
3. e2e：造一条 prepare 被拒的旅程（fixture 若可造）重开标签页能看到失败卡与重开入口；`xhs-image-text-main-journey` 一轮绿。
4. V31-105 §13 与本票标「已修」。
