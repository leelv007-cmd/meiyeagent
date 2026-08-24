# Lane P report — V31-108

**Branch**: `agent/v31-108`
**HEAD (code)**: `28df64b21960ee9e184c5bdd89a4a8fc159a7420`
**Do not push.** Driver merges.

## Files (tree `28df64b21`)

| File | What |
|---|---|
| `apps/core/src/p1/execution-spine/prepare-terminal-rejection.ts:22` | `failCreationForPrepareTerminalRejection` — hardcodes `reason: 'prepare_rejected'`; throws if `terminateRunningWork` is missing |
| `apps/core/src/p1/execution-spine/submission-coordinator.ts:190` | `CreationSubmissionStore.terminateRunningWork` reason union widened with `orchestration_lost` + `prepare_rejected` + `detail` |
| `apps/core/src/p1/execution-spine/submission-coordinator.ts:2062-2072` | After `recordPrepareFailure` terminalizes in `recoverPendingStarts`, call the helper (production path) |
| `apps/core/src/p1/execution-spine/postgres-creation-submission-store.ts:2437` | `refundPrepareTerminalReservation` credit op id = `stalledWorkRefundOperationId(taskId)`; skip credit write when usage already `refunded` |
| `apps/core/src/p1/execution-spine/postgres-creation-submission-store.ts:2451` | After that refund commits, call the same helper (crash window between record and recover's terminate) |
| `apps/core/src/p1/execution-spine/postgres-creation-submission-store.ts:2631` / `:2724` | `terminateRunningWork` failAndRefund reason + merchantMessage switch for `prepare_rejected` |
| `apps/core/src/p1/execution-spine/stalled-work-sweeper.ts:26-30` | `StalledWorkTerminalReason` += `'prepare_rejected'` |
| `apps/core/src/p1/execution-spine/stalled-work-sweeper.ts:76` | `prepareRejectedMerchantMessage` — CJK-safe detail; never 超时 |
| `apps/core/src/p1/execution-spine/unroutable-media-terminal.ts:34` | Store reason union kept in sync |
| `apps/core/src/p1/harness/merchant-delivery-language.ts:305-312` | Unchanged; still prefers audit `written` over the timeout default |

Frontend: zero UI changes.

## Tests red → green

| Case | Red | Green |
|---|---|---|
| `V31-108: prepare terminal rejection fails the running work, refunds once, and stays idempotent` (`stalled-work-sweeper.postgres.test.ts:311`) | 1 (work `actual: 'running' expected: 'failed'`) | 1 |
| Helper unit (`prepare-terminal-rejection.test.ts`) | — | 2 new |
| Merchant sentence unit (`stalled-work-sweeper.test.ts`) | — | 1 new |
| Fail-closed recover (`recovery-fairness.test.ts`) | — | 1 new |
| Merchant delivery language (`merchant-delivery-language.test.ts`) | — | 1 new |

Regression (same postgres run, all green):

- V31-82 Step 1 / stalled timeout / merchant cancel
- V31-105 §13 ①A unroutable media terminal
- V31-41 prepare terminal refunds exactly once (op id assertion updated to `stalledWorkRefundOperationId`; REFUND count still 1)
- V31-41 prepare terminal refund dead-letter
- V31-41 / V31-33 recovery-fairness (3 terminal tests stub `terminateRunningWork`)
- composer-http recover paths (3)

Command (5432, `meiye_lane_v31p`):

```
pnpm exec tsx --test --test-concurrency=1 --test-name-pattern='V31-108: prepare terminal rejection|V31-105|V31-82 stalled work timeout|V31-82 merchant cancel|V31-82 Step 1|V31-41 prepare terminal' \
  src/p1/execution-spine/stalled-work-sweeper.postgres.test.ts \
  src/p1/execution-spine/postgres-creation-submission-store.postgres.test.ts
# 6 pass / 0 fail
```

## Reverse wiring

1. **Postgres (load-bearing)**: first implementation of the new test against current main was red (`running` vs `failed`). If `recoverPendingStarts` does not call `terminateRunningWork`, that assertion goes red again.
2. **Reason flip (①A shape)**: `failCreationForPrepareTerminalRejection` hardcodes `reason: 'prepare_rejected'` (`prepare-terminal-rejection.ts:50`). Forcing `'timeout'` fails `failureReason === 'prepare_rejected'` and the audit `doesNotMatch(/超时/)`.
3. **Fail closed**: store without `terminateRunningWork` throws `Prepare terminal rejection cannot fail closed` (`recovery-fairness.test.ts` + helper unit), instead of leaving the work running.

## Commits

1. `28df64b21960ee9e184c5bdd89a4a8fc159a7420` `fix(execution-spine): fail running work on prepare terminal rejection`
2. `docs(tickets): mark V31-108 prepared-terminal hang as 已修待关` (this branch; Evidence SHA on the tickets is commit 1)

## Unfinished

- **e2e not run.** No fixture / `e2eAgentFault` can force `PREPARE_TERMINAL_REJECTION`. Did not invent a journey. `xhs-image-text-main-journey` not executed (54329 serial lock; not on this causal path).
- **opt-in evidence debt.** `node scripts/uiux/opt-in-test-evidence-guard.mjs` exit 1 (expected). Touched `apps/core/src/p1/execution-spine/` (blocking postgres suites) and `apps/core/src/p1/harness/merchant-delivery-language.test.ts` (stales the harness directory). Driver records via `run-persistence-evidence-instrument.sh` + `record-opt-in-persistence-evidence.mjs`. Do not self-sign.
- Historical rows already `harness_state='failed'` + work `running` are not listed by `listRecoverableHarnessStarts`. New terminals fail the work in the same recover that records them; a crash between `recordPrepareFailure` and recover's terminate is closed by `refundPrepareTerminalReservation` calling the same helper.

Gates: `assert-v31-ticket-index.mjs` OK (109/109). `node --test scripts/ci/*.test.mjs scripts/ops/*.test.mjs` 247 pass / 0 fail.
