# V31-28 interrupt resume-by-id closeout (2026-08-11)

## Status

| Item | Result |
| --- | --- |
| Root cause | **Fixed** |
| `v31-interrupt-resume-journey` full suite | **3/3 PASS** (Chromium, e2e-lock) |
| Tip | post-fix commit on `codex/v31-integration` |
| `wave4_ready_to_stamp` | still **false** (broader gates remain) |

## Failure (pre-fix)

Solo red on tip `a4ebcca3a`:

- Spec: `v31-interrupt-resume-journey.spec.ts` — `pending interrupt 刷新/重连不丢 → resume by interruptId`
- After Living Plan start + `agent-interrupt-accept` on the paid hold, Core threw:

```
Paid execution confirmation confirmation:<authority-hash> has no immutable confirmed decision.
  at admitConfirmedExecutionPlan (paid-generation-confirmation.ts)
```

- UI terminal: 「这次没有做成」/ 积分已退回; never reached note_style `两种图文方向`.

## Root cause

Two merchant surfaces can resolve a paid execution hold:

1. **Composer interaction card** (`answerExecutionConfirmation`) — writes `PlanConfirmationDecision` via `decideExecutionConfirmation`, then resumes the interaction.
2. **Typed interrupt strip** (`agent-interrupt-accept` → `POST p1/interrupts/resume`) — only CAS-resolved the interrupt and re-injected the workflow decision. It did **not** write the domain decision.

`admitConfirmedExecutionPlan` always requires an immutable `confirmed` decision for the confirmation request id. Path (2) therefore admitted nothing and the run failed closed.

Living Plan decide→start can pre-write the same decision; the interrupt surface still must be authority-complete when the hold is answered only via resume-by-id (including successor re-confirm request ids).

## Fix

- `createHarnessInterruptResumeBridge` + `ensurePaidExecutionDecisionFromInterruptResume`:
  - On `confirm_paid_execution` accept/reject, read existing decision for the interrupt id (request id).
  - If absent, `decideForWorkspace` with stable `interrupt-resume-decision:<id>:r<rev>`.
  - If present with matching outcome, no-op (Living Plan / interaction-card first).
  - If present with conflicting outcome, fail closed.
- `InterruptResumeBridgeInput.actorId` passed from protocol `resume` user id.
- Production assembly wires `executionConfirmationService` into the bridge.

## Evidence

| Gate | Ports / DBs | Result |
| --- | --- | --- |
| Unit: `dbos-workflow.test.ts` (incl. new paid-decision cases) | n/a | **55/55 PASS** |
| E2E solo `-g "resume by interruptId"` | 3305/4305, `meiye_ir2_*` | **1/1 PASS** (~22s) |
| E2E full `v31-interrupt-resume-journey.spec.ts` | 3307/4307, `meiye_irb_*` | **3/3 PASS** (~1.8m) |

Cases covered in full suite:

1. resume by interruptId (refresh + accept + 图文方向 continuity + duplicate replay)
2. owner homepage / cross-workspace isolation
3. expired hold refunds without continuing

Commands (integration worktree, e2e-lock, fixture mode):

```bash
pnpm --filter @meiye/web exec playwright test \
  tests/e2e/specs/v31-interrupt-resume-journey.spec.ts \
  --reporter=list
```

## Not closed by this leg

- Full `run-v31-browser-acceptance.sh`
- Day-0 / Goal / context-fence / V31-26b external
- Stamp remains blocked until broader residual matrix is green

## Hard rules observed

- No push
- No kill of host :3001 (DBOS admin bind warning only)
- Isolated ports/DBs under e2e-lock
- Real UI journey (not mock-only)
