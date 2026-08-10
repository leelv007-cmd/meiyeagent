# V31-57 / Wave-4 expiry billing identity — evidence (2026-08-11)

## Outcome

- Integration branch `codex/v31-integration` tip includes merge
  `243002708` (`merge: split hold-expiry billing identity from workflow axes`)
  landing fix `a1c76afc4`.
- Rejected commit `1d62a2c70` was **not** merged. Work was ported from the
  pause WIP intent onto INT HEAD (`df0a7641c`) on branch
  `codex/v31-w4-expiry-billing-id`.

## What landed

- Explicit `billingTaskId` on settlement/compensation inputs; workflow
  `taskId` retained for observability / decisions / sweep fences.
- `reservation_sweeps.billing_task_id` persisted with migration + fail-closed
  dead-letter when identity cannot be bound.
- Claim path binds request `sourceTaskId` + `usageReservation` + quote refs;
  stale reclaim validates authority first and dead-letters orphans (no silent
  lease renew via discarded INNER JOIN).
- Settlement executor uses billing identity for ProductUsage/credits and
  workflow identity for root axes / ActionUsage taskId projection.
- Compensation queue persists billing identity and unique-fences on
  `(workspace_id, billing_task_id)` so opposite actions cannot bypass via
  different plan workflow IDs.

## Seams proven (fresh empty PG + `provision-test-db.sh`, not TEMPLATE meiye)

Unit (no PG):

- `product-billing-settlement.test.ts` including
  `split billing refund keeps workflow observability and source ledger identity`
- `reservation-sweeper.test.ts` including split-coordinate refund
- `dbos-workflow.test.ts`
  `prepared settlement keeps workflow and billing task identities separate`

PG (TEST_DATABASE_URL / TEST_DBOS_SYSTEM_DATABASE_URL provisioned empty):

- `reservation-sweeper.postgres.test.ts` — 6/6
  - migrates legacy billing coordinates
  - expired hold + post-refund crash window
  - workflow vs billing coordinates separate
  - stale reclaim single settle with real `HarnessProductBillingSettlementExecutor`
  - orphan same-id dead-letter
  - mismatched source/usage/quote binds fail-closed
- `postgres-billing-compensation-store.postgres.test.ts` — 3/3
  - forced-refund + billingTaskId round-trip
  - opposite actions blocked across different plan workflow IDs
  - orphan recovery / legacy dual-action archive

Re-verify on integration HEAD after merge: 28/28 focused pass, 0 fail.

Core typecheck: pass (`pnpm --filter @meiye/core typecheck`).

## Open items

- Chromium V31-57 case
  `v31-interrupt-resume-journey` “expired hold refunds…” **not** run this
  session (needs e2e-lock + isolated ports). Do not close V31-57 AC on browser
  without that leg.
- **V31-59 candidate**: ordinary DBOS settlement still builds settlement via
  `harnessBillingSettlementInput(request, workflowId)` and only sets
  `billingTaskId` when `request.sourceTaskId` is present. Paths that omit
  `sourceTaskId` while ledger rows key on another identity remain a residual
  risk; do not close without explicit product evidence. Not claimed fixed here.

## Safety

- No push.
- Port 3001 not touched.
- WIP patch backup retained at
  `/private/tmp/v31-w4-expiry-backup/wip-20260811-003554.patch`.
