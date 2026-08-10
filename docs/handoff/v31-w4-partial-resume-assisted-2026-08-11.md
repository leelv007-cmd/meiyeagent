# V31-14 / V31-16 partial-resume assisted journey closeout (2026-08-11)

## Status

| Item | Result |
| --- | --- |
| `v31-partial-resume-assisted-journey` | **1/1 PASS** Chromium ~43s (e2e-lock) |
| `v31-context-fence-journey` regression | **1/1 PASS** ~35.6s (PORT=3351) |
| Tip | post-fix commit on `codex/v31-integration` |
| `wave4_ready_to_stamp` | still **false** (broader gates remain) |

## Prior red

Solo runs failed at `getByTestId('agent-pending-interrupt').filter({ hasText: /价格|事实|变化/ })` (mid-flight fence text) after note_style accept. Earlier batches also hit host `PostgresError: too many clients already` from orphan e2e workers / 350+ leftover `meiye_*` DBs.

## Diagnosis

1. **Phantom fence expectation**  
   This journey never mutates facts after admit. Mid-flight §23.4 pause only fires on real live drift. Waiting for `/价格|事实|变化/` without a price write is not product truth. Mid-flight pause is owned by `v31-context-fence-journey` (§37.4-E).

2. **Product gaps found while forcing a real mid-flight pause** (kept as real fixes):
   - `withExecutionConfirmationStagePort` spread a class instance (`{ ...ports.shared }`) and **dropped prototype methods**, so after a real pause the workflow threw `Context fence pause requires an acknowledgement port`.
   - Mid-flight ack was **one-shot**; post-ack full workflow restart re-hit the same diff and could not re-hold cleanly.
   - Postgres interrupt `putPending` rejected re-open of a **resolved** row; Memory store already reopened (parity gap).

3. **Settlement assertion mismatch**  
   Partial delivery correctly settles as `partially_refunded` with undelivered page credits returned (V31-16). Spec wrongly required `committed` + zero refund.

## Fix

### Product (kept)

- `dbos-workflow.ts`: keep StagePorts instance identity when attaching confirmation ports (Object.assign, no class spread).
- `production-stage-ports.ts`: sticky acknowledge for the exact live-facts diff; a *new* diff still pauses.
- `postgres-interrupt-store.ts`: reopen resolved interrupt rows on re-request (match Memory store).

### E2E (aligned to product)

- After note_style accept, proceed to partial report / assisted handoff (no phantom mid-flight fence wait).
- Assert usage `status: 'partially_refunded'`, `0 < settled < reserved`, `refunded = reserved - settled`.

## Evidence

| Gate | Ports / DBs | Result |
| --- | --- | --- |
| Unit: runner fence sticky ack | n/a | **PASS** (`production-stage-ports.test.ts` fence cases) |
| E2E partial-resume | PORT=3349 CORE=4349, `meiye_pr6_*` | **1/1 PASS ~43s / 1.5m wall** |

Logs under implementer scratch: `pw-partial6.log`, `pr6-meta.txt`.

## Hard rules observed

- No push
- No kill of host :3001
- Orphan e2e workers drained before re-run (PG clients ~6)
- Isolated ports/DBs under e2e-lock
- Real UI journey

## Not closed by this leg

- Full `run-v31-browser-acceptance.sh`
- Level-1 copy / Artifact growth missing specs (pause handoff §5)
- V31-57 expiry billing identity
- V31-26b external
- Stamp remains blocked
