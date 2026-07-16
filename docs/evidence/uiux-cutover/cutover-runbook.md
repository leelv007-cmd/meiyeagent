# UI/UX One-Time Cutover And Rollback Runbook

This runbook is executable preparation only. Running it against production
requires a separately confirmed target, credentials, window, named owners, and
deployment authorization.

## Preconditions

- Candidate Web/Core/worker commit and schema revision are fixed.
- `pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm e2e`, production build,
  bundle budget, accessibility, viewport, and secret scan all pass on that same
  commit.
- Migration dry-run, repeated dry-run, reconciliation, backup/restore, and
  pre-cutover application compatibility pass on a production-shaped copy.
- No Sev0/Sev1 is open. Any permitted P2/P3 waiver has a named P1 Owner,
  impact, workaround, repair owner, and expiry.
- Submission drain, deployment, rollback, smoke, and observation owners are
  named and reachable.

## CLI sequence

Set `DATABASE_URL`, `CUTOVER_WORKSPACE_ID`, `CUTOVER_ACTOR_ID`, and
`CUTOVER_CORRELATION_ID` through the environment or secret manager. Never paste
their values into a report.

```bash
pnpm uiux:cutover plan
pnpm uiux:cutover dry-run "$RUN_ID"
pnpm uiux:cutover inspect "$RUN_ID"
pnpm uiux:cutover backup "$RUN_ID"
pnpm uiux:cutover restore "$RUN_ID"
pnpm uiux:cutover freeze "$RUN_ID"
pnpm uiux:cutover backfill "$RUN_ID"
pnpm uiux:cutover activate "$RUN_ID"
```

Every step must persist an idempotent run record and a redacted report. Do not
continue after an unexplained count, owner, status, version, receipt, ledger, or
publication difference.

## Submission drain and deployment

1. Enter the approved low-traffic window.
2. Block only new generation, publication, and external-side-effect claims.
   Preserve drafts and return the explicit temporary-maintenance state.
3. Continue callbacks, polling, reconciliation, Asset persistence, reads,
   downloads, and copies for already accepted work.
4. Confirm new side effects are drained and record queue ownership.
5. Deploy the compatible Core, worker, and Web candidate versions.
6. Verify schema and version combination, then run the fixed smoke set: login,
   E0/E1, Work creation, fixture Job, recovery, Asset/Content, task/template,
   L3, settings return anchor, admin allow/deny, and legacy redirect.
7. Resume new submissions only after every smoke passes and record the time.

## Application rollback

Rollback triggers include authorization bypass, unreachable canonical objects,
duplicate submissions or Assets, ledger imbalance, false publication state,
blocked core journeys, or unacceptable error/performance regression.

```bash
pnpm uiux:cutover rollback "$RUN_ID" "$REASON"
```

- Pause new side effects first.
- Route future work to the frozen pre-cutover application entry.
- Keep additive schema and every legal post-cutover fact.
- Do not restore an old database snapshot over new Task/Work/Job/Asset/Content,
  publication, or ledger facts.
- Each accepted Job stays with its immutable RouteSnapshot and owning runtime;
  do not resubmit, switch model, or duplicate an Asset.
- Re-run the frozen-build smoke before resuming submissions.

## Observation record

### First hour

- login and role denial
- core journeys and API/query errors
- Job/Asset idempotency and ledger balance
- publication state and old-route redirects
- Web Vitals and Web/Core/worker version combinations
- rollback trigger status and named observer

### Following 24 hours

- asynchronous Job recovery and callback persistence
- notification recall and next-day task creation
- external-platform state reconciliation
- error, performance, and security alerts
- rollback availability and named on-call owner

### Seven-day safety period

- no destructive schema or legacy-adapter contraction
- ordinary alerts remain active
- old-route removal is still prohibited until two stable releases and 30 days
  of zero valid hits are independently proven

## P1 Owner acceptance template

- Defect and severity:
- Why it is peripheral and not a locked outcome/security/data issue:
- Affected merchants/surfaces:
- Workaround:
- Repair owner and ticket:
- Expiry before the next milestone:
- Named P1 Owner and decision time:

No waiver may cover Sev0/Sev1, role or tenant bypass, secrets/privacy, canonical
data loss, duplicate side effects, ledger imbalance, false publication state,
failed migration/rollback, or a blocked required journey.
