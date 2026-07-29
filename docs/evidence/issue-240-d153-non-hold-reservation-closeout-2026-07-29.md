# Issue 240 D-153 Non-Hold Reservation Closeout

Date: 2026-07-29

Scope: the D-153 follow-up that remained after hold expiry cancellation was
addressed on the local branch: prove that every non-hold ProductUsage
reservation reaches a terminal ledger state or retains one durable recovery
owner. This is local acceptance evidence, not merge, live-provider, or
production-deployment proof.

## Invariant matrix

| Path | Crash or failure boundary | Durable owner / terminal result |
| --- | --- | --- |
| Composer reservation before Harness admission | Process exits before the first start | `creation_submissions.reserved`; recurring recovery claims a fenced start lease |
| Harness start acknowledgement is unknown | DBOS or registry may already own the task | Authority lookup keeps the submission recoverable; errors are not counted as proof of rejection; retries back off to five minutes |
| Harness definitively rejects the immutable request | Authority confirms that no task was admitted and returns `HarnessAdmissionError` | Submission becomes `failed`; orphan recovery creates one refund compensation |
| Exact-text verification child job | The child calls Model Supply inside an already reserved media task | Child submission freezes `productUsageQuantity: 0`; it cannot debit ProductUsage or GrantLot again |
| Decision resume | Process exits after claiming or sending | Expiring database lease is reclaimable and fenced; `DBOS.send` uses a stable decision effect key |
| Terminal delivery | Process exits around settlement | Commit intent is persisted before direct settlement; the delivery audit persists trusted product-unit or measured-duration evidence |
| Terminal failure or cancellation | Direct refund or first enqueue fails | Refund intent is persisted first; terminal facts rebuild a missing intent; merchant copy says refund pending until ledger truth says refunded |
| Normal delivery still in flight | Billing recovery runs after `package_delivered` | Five-minute grace prevents fallback from racing normal terminal settlement |
| Conflicting commit/refund intent | Concurrent or historical opposite actions | `(workspace_id, task_id)` is the active-queue fence; new opposite actions fail explicitly; legacy double rows are archived before the unique index is installed |
| Large orphan backlog | Existing owner appears before the query limit | Recovery excludes any existing task owner before ordering and limiting, so occupied rows cannot starve later orphans |

The retired hold-age reservation sweeper was not restored. Recovery is driven
by explicit submission, decision, workflow, delivery, failure, and
cancellation facts.

## Verification

| Gate | Result |
| --- | --- |
| Focused changed-path Core tests | 101 pass, 0 fail, 0 skip |
| Core typecheck | exit 0 |
| `git diff --check` | exit 0 |
| PostgreSQL creation-submission recovery | 10 pass, 0 fail, 0 skip |
| PostgreSQL Harness store and resume-lease recovery | 10 pass, 0 fail, 0 skip |
| PostgreSQL billing migration and orphan-owner recovery | 1 pass, 0 fail, 0 skip |
| Real DBOS smoke | 11 pass, 0 fail, 0 skip |
| Combined real PostgreSQL and DBOS gate | 32 pass, 0 fail, 0 skip |
| Final post-rebase full Core suite | 2,397 pass, 0 fail, 166 skip (2,563 total) |
| Final two-axis review | P0=0, P1=0; reviewer focus 58 pass, 0 fail, 0 skip |

The skipped full-suite cases are explicit database/live-provider opt-ins. The
final report must keep local PostgreSQL/DBOS proof separate from any unrun live
provider or production acceptance.

The final Web-only rebase did not change the `apps/core`,
`packages/contracts`, or `pnpm-lock.yaml` Git tree hashes. The focused tests,
typecheck, and diff gate were rerun after that rebase; the full Core and locked
PostgreSQL/DBOS results above therefore exercise the exact same Core tree as
the final branch.

## Commands

Focused behavior and static gates:

```bash
pnpm --filter @meiye/core exec node --import tsx --test \
  src/p1/execution-spine/composer-http.test.ts \
  src/p1/execution-spine/creation-stage-port.test.ts \
  src/p1/harness/billing-compensation.test.ts \
  src/p1/harness/dbos-workflow.test.ts \
  src/p1/harness/dbos-workflow-events.test.ts \
  src/p1/harness/decision-service.test.ts \
  src/p1/harness/http.test.ts \
  src/p1/harness/resume-reconciler.test.ts \
  src/p1/harness/unified-media-stage-ports.test.ts \
  src/p1/model-supply/usage-ledger-invariants.static.test.ts \
  src/runtime-truth/main-wiring.test.ts
pnpm --filter @meiye/core typecheck
git diff --check
```

PostgreSQL and DBOS gates run under the repository's absolute shared lock with
business and DBOS URLs derived inside the child shell:

```bash
/Users/bin/Desktop/开发/内容无人区/美业内容2/.scratch/orca-run-2026-07-25/e2e-lock.sh \
  zsh -lc '<source local env; derive isolated TEST_DATABASE_URL and
  TEST_DBOS_SYSTEM_DATABASE_URL; run the selected PostgreSQL and DBOS specs>'
```

No provider credentials, paid probes, or live-provider calls are used by this
evidence run.
