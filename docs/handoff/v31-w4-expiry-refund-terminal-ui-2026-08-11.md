# V31-57 hold-expiry refund terminal UI — fix evidence (2026-08-11)

## Outcome

- Integration branch `codex/v31-integration` tip includes hold-expiry refund
  terminal projection fix (this commit).
- Rejected commit `1d62a2c70` was **not** merged.

## Root cause

After sweeper completes ProductUsage/credit full refund (credit-era:
`status=refunded`, `refundedCredits>0`, **`refundedQuantity=0`**):

1. Workflow cancellation path may still persist merchantMessage
   `超时未选择，本次任务已取消，积分退款处理中` when the in-workflow refund write
   is not observed as `refunded`.
2. `HarnessDbosWorkflowEventReader.readState` only upgraded
   处理中 → 已退回 when `actionUsage.refundedUnits > 0`. Credit full refunds
   project `refundedUnits=0`, so SSE/UI stayed on 处理中 forever.

## Fix

- `productUsageRefundLanded(usage)` — ledger truth via status /
  `refundedCredits` / `refundedQuantity`.
- `readState` upgrades cancelled hold-expiry copy when ledger shows refund.
- `settleHarnessCancellation` probes billing-identity ProductUsage via optional
  `getUsage` when refund outcome ≠ `refunded`; already-refunded keeps 已退回.
- Wire `productQuoteService.getUsage` on harness billing port.
- Open residual ordinary-settlement ticket **V31-59**.

## Validation

| Gate | Result |
|---|---|
| unit (action-usage / events / dbos-workflow) | pass (in 94 suite) |
| focused PG+unit sweeper/settlement (fresh DBs) | **94/94 PASS** |
| Chromium `-g "expired hold refunds"` under e2e-lock | **1/1 PASS** (20s) |

Evidence dir: `/tmp/v31-expiry-refund-ui/`  
(`core-focused-pg.log`, `playwright-expiry.log`, `e2e.env`, provision logs).

## Safety

- No push.
- Port 3001 not killed.
- Workflow axes remain on workflow `taskId`; billing uses `billingTaskId`.
