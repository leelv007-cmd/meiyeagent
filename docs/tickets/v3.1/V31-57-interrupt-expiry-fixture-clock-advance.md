# V31-57 — Interrupt expiry E2E fixture 无法推进时钟

**Parent**: V31-14（typed interrupt 过期、退款与终态合同）
**批次**: 收尾
**Blocked by**: 无
**Related**: V31-28（同 spec 的另一条 Composer interrupt 渲染红）；V31-29（fixture 真实性原则，但不拥有本 route）
**Status**: partially-fixed（2026-08-11）— hold-expiry billing/workflow identity 分裂已合入；fixture 时钟推进在 Chromium 上已越过原 400 形态；终态 UI 仍停在「积分退款处理中」而非「积分已退回」，AC 未勾

## 症状与边界

`v31-interrupt-resume-journey.spec.ts` 的「expired hold refunds and closes the dispatched waiting run without continuing」用例已创建并读到 pending interrupt，但 `POST /api/e2e/interrupt-expiry-fixture` 返回 400：

`INVALID_STATE — The E2E interrupt expiry fixture could not advance the clock.`

失败发生在 fixture 自身，旅程未进入后续的 decision=`core_hold_expired`、ProductUsage refund 和 terminal outcome 断言，因此不能用这次红判定产品 expiry 合同对错。

## 证据

- 锚树：集成树 `d3e29ee0f`。
- 旅程：`mkfast-template-main/tests/e2e/specs/v31-interrupt-resume-journey.spec.ts:316-344`；失败断言在 `:344`。
- 日志：`scratchpad/w4d/w4-final-v2/round-per-spec/v31-interrupt-resume-journey.log:202-223`。该 spec 本轮总结为 `1 passed / 2 failed`，本票只领第二条 fixture 失败。
- 失败包装点：`apps/core/src/server.ts:1250-1284`；任何 `expire()` 内部错误都被统一包装为上述 400，当前日志未暴露具体内部分支。
- fixture 实现：`apps/core/src/assembly/api-runtime.ts:1928-1970`；它要求 pending interrupt 存在且属于 workspace，再以 `ttlSeconds + 1` 构造时间、跑一次 exact sweeper，并确认 sweeper `claimed=1/completed=1/failed=0` 且 decision/interrupt 均已 resolved。当前证据不足以判断是哪个守卫失败。

## Acceptance criteria

- [ ] 复现并指名 `expire()` 内部失败分支，保留可诊断证据，不以放宽 spec 断言规避
- [ ] fixture 只过期请求指名的 workspace/task/interrupt，不依赖真实等待 TTL，不污染其他测试数据
- [ ] 修复后该用例证明 decision 以 `core_hold_expired` resolved、interrupt resolved、ProductUsage 全额 refund 且零 settlement、waiting run 终止不继续
- [ ] 有一条针对根因的先红后绿回归，并重跑本 Playwright case 转绿

## 本票不做什么

- 不领 `agent-pending-interrupt` 在 Composer 中不可见的另一条失败；那条归 V31-28。
- 不把 HTTP 包装的通用 `INVALID_STATE` 当成根因；必须追到 `expire()` 里的具体不变量。

## Wave-4 resume 证据（2026-08-11，不勾 AC）

锚树：集成 `codex/v31-integration` @ `a9095ad40`。

| 项 | 事实 |
|---|---|
| 合入 | `a1c76afc4` / merge `243002708` — 显式 `billingTaskId` 与 workflow `taskId` 分轴；`reservation_sweeps` / compensation 持久化 billing identity；stale reclaim 先校验再 dead-letter orphan；拒绝合入被审拒的 `1d62a2c70` |
| 证据 handoff | `docs/handoff/v31-w4-expiry-billing-id-evidence-2026-08-11.md` |
| focused PG/unit @ tip | reservation-sweeper + billing-compensation + settlement/sweeper 等 **63/63 pass**（`/tmp/v31-final-verify/core-focused-pg.log`） |
| Chromium expiry case | **仍红**：`v31-interrupt-resume-journey`「expired hold refunds…」在 crit batch PORT=3170 到达 `composer-terminal-outcome`，文案为 **「超时未选择，本次任务已取消，积分退款处理中」**，期望 `/已取消.*积分已退回/u`（spec `:384-385`；log `/tmp/v31-final-verify/browser-crit/runner.log`） |
| 相对原票症状的漂移 | 原 400 `INVALID_STATE — could not advance the clock` **本轮未再作为失败签名**；case 已进入 terminal outcome 断言。根因从「fixture 推钟」前移到 **refund 结算/投影未从 processing 落到 settled「已退回」** |
| V31-59 候选（未开票） | ordinary DBOS settlement 仍可能在缺 `sourceTaskId` 时用 workflow id 当 billing 轴；见 expiry evidence handoff open items |

**勾选纪律**：AC1–AC4 均要求 Playwright case 转绿或根因回归闭环；本轮 Chromium 仍红 ⇒ **零勾选**。
