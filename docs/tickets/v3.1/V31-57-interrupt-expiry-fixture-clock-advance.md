# V31-57 — Interrupt expiry E2E fixture 无法推进时钟

**Parent**: V31-14（typed interrupt 过期、退款与终态合同）
**批次**: 收尾
**Blocked by**: 无
**Related**: V31-28（同 spec 的另一条 Composer interrupt 渲染红）；V31-29（fixture 真实性原则，但不拥有本 route）
**Status**: open（终审轮独立 fixture 红，尚未定根因）

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
