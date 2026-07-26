# T45 confirmation-card timeout acceptance evidence

## Scope and authority

- Branch: `leelv007-cmd/t45-confirmation-timeout`
- Rework base: local `main` at `62952d5b`
- Evidence class: local fixture, real lane PostgreSQL, real lane DBOS, and
  locked fixture-browser gates. No credential or live-provider call is part of
  this acceptance.
- The database keeps the existing `pending | resolved` states. Core timeout
  provenance lives only in `decision_events` through the
  `:core_timeout` idempotency suffix and `resolution=ignored`.
- The existing in-workflow `buildSemanticDecisionResumption` implementation is
  byte-unchanged. T45 adds a separate terminal-successor builder below it.
- No billing ledger writer or `usage.reserve` call was added. A late answer
  enters the existing Coordinator → PostgreSQL submission transaction, receives
  a fresh quote and usage reservation, and settles through the normal Harness
  workflow.

## Adversarial rework disposition

| Finding | Change and proof |
| --- | --- |
| F-1 — core timeout bypassed the decision channel | `awaitDecision` calls `HarnessDecisionService.submitCoreTimeout` inside the stable post-recv step `persist-core-timeout-{questionId}`. The PostgreSQL test directly asserts `pending_questions.status=resolved` plus one event, trace, audit and outbox row for the timeout. The event is inserted with `resume_status=sent`, so the workflow never sends the synthetic decision to itself. |
| F-2 — a late answer disappeared after terminal success | A resolved question whose consuming event ends in `:core_timeout` is accepted as `{questionId}:late_answer`. The first answer starts a deterministic new workflow; subsequent answers replay the first persisted command and return the same successor reference without 409 or a second start. |
| F-3 — config snapshot shifted old DBOS function IDs | The config read is an ordinary `await`, with the durable recv deadline providing replay determinism. A child process persists a pre-T45 PENDING layout, exits without graceful shutdown, and the parent recovers it with the new code and a changed config head. It completes with IDs `3/4/5/6 = persist pending / setEvent / recv / sleep`, without branch or error. |
| F-4 — timeout looked like a merchant decision | Only an idempotency key ending in `:core_timeout` selects `routingSource: policy`; merchant ignored decisions remain `routingSource: decision`. |
| F-5 — reverse controls | A snapshot-backed run without `usageReservation` never reads the timeout config and waits until an explicit decision arrives. A reservation proves quota was already locked. `external_effect` remains the separate `approvalRequests` blocking-node path in `PostgresHarnessStore.registerPending`, so this timeout change does not consume or bypass it. |
| F-6/F-7 — unsafe config and English ledger value | Config validation is `1..3600`; `3601` is rejected. The synthetic value is `超时未作答，已按通用口径继续`. |
| F-8 — smoke terminal race | The smoke polls the workflow terminal state before asserting `SUCCESS`. |
| F-9 — evidence and stale 48h review text | This report records the commands, SQL facts, replay layout, reverse controls, frontend boundary, and browser lock audit. The old deep-review line now says config default 30 seconds. |

## Real PostgreSQL ledger and export proof

Command:

```text
pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 \
  src/p1/harness/postgres-store.postgres.test.ts

3 passed / 0 failed
```

The timeout-focused case creates separate browser and core tasks and checks the
rows directly. Its asserted projection is:

```text
browser task:
  pending_status=resolved
  idempotency_keys=[...:timed_out]
  events=1 traces=1 audits=1 outbox=1

core task after one late answer:
  pending_status=resolved
  idempotency_keys=[...:core_timeout, ...:late_answer]
  events=2 traces=2 audits=2 outbox=2
  core value=超时未作答，已按通用口径继续
  core resolutionSource=core_timeout
  core resume_status=sent
```

The same test calls
`PostgresOperationsRepository.assertTaskHasNoPendingQuestion` after the core
timeout and observes no conflict. This is the export/delivery negative control:
the resolved row no longer blocks an export gate.

The frontend/core race is also fail-safe. If the browser `:timed_out` event wins
the row first, `submitCoreTimeout` returns `consumedByOther` rather than failing
the workflow; the DBOS carrier waits for the already-persisted browser command.

## DBOS replay, timeout, and quota proof

Command:

```text
pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 \
  src/p1/harness/dbos-registration.smoke.test.ts \
  src/p1/harness/decision-service.test.ts

15 passed / 0 failed
```

The timeout run records:

```text
functionID 3  persist-pending-{questionId}
functionID 4  DBOS.setEvent
functionID 5  DBOS.recv
functionID 6  DBOS.sleep
functionID 7  persist-core-timeout-{questionId}
terminal      SUCCESS
```

The function-ID recovery case uses an independent process to leave IDs 3, 4
and 6 durable while recv is PENDING, then changes the config value from 300 to
1 and launches the new code with the same application version. DBOS recovers
the original deadline, receives the merchant answer at ID 5, completes the
same workflow, and retains the exact final 3/4/5/6 layout. The post-recv write
is ID 7 only on the timeout branch; it cannot shift an already pending recv.

The quota negative control supplies no `usageReservation`, sets the config to
one second, waits 1.5 seconds, and asserts:

```text
workflow=PENDING
configReads=0
coreTimeoutSubmissions=0
```

An explicit ignored decision then completes the run. The carrier's hold path
has no product timeout; it continues receiving until a real decision arrives.

## Terminal successor, billing, and semantic consistency

Commands:

```text
pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 \
  src/p1/harness/semantic-decision-resumption.test.ts \
  src/p1/execution-spine/creation-stage-port.test.ts \
  src/p1/execution-spine/composer-http.test.ts \
  src/p1/execution-spine/postgres-creation-submission-store.postgres.test.ts
```

The focused PostgreSQL successor case asserts:

```text
submission_count=2
reservation_count=2
successor.task.id != source.task.id
successor.snapshot.semanticDecision.sourceSnapshotId == source.snapshot.id
late answer value == successor Harness context offer_price
second identical successor claim == replayed
Harness starts == 2 total (source + one successor)
```

This proves two deliveries use two tasks, two quotes and two reservations. The
new run receives the late answer both as a decision reference and as its
merchant-context field, so the decision ledger and generated-version input
cannot disagree. The successor quote is built and confirmed through the
existing product quote service; the existing PostgreSQL creation submission
store performs the normal reservation transaction. Insufficient quota therefore
fails at the same reservation gate as any other paid regeneration and cannot
become a free or silently started run.

The service-level true-PostgreSQL case sends two different late answers. The
first starts the deterministic successor and persists the canonical
`:late_answer` event. The second returns `replayed=true` and the same
`successor.workflowId`; it neither returns 409 nor starts another workflow.

The authenticated HTTP boundary independently proves that the public decision
POST exposes the same contract:

```text
pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 \
  src/p1/harness/http.test.ts

2 passed / 0 failed
```

The test first consumes the question through `submitCoreTimeout`, then sends
two different late-answer POST bodies. Both return HTTP 200, the second returns
`replayed=true` with the first successor reference, and the workflow resumer
observes exactly one successor start.

## Frontend boundary and OI

T31's current card does **not** provide a working post-timeout affordance.
After `timed_out`, the input and submit button remain rendered, but
`ComposerQuestionCard.decide` exits immediately because `settledRef.current`
remains true. The apparent late answer therefore emits no POST. This was
reported to the coordinator and registered as **OI-53**. T45 proves the
late-answer API path; OI-53 owns the frontend `settledRef` distinction, exactly
one late POST, and the honest second-charge copy.

The agreed editing-pause contract is still coherent at the API layer: editing
is local frontend state, core does not observe it, and an answer arriving after
core terminal timeout is accepted by the successor endpoint rather than being
discarded. T31 needs to expose that now-working API truth.

## Package and browser gates

Core typecheck:

```text
pnpm --filter @meiye/core typecheck
exit 0
```

Final Core baseline:

```text
pnpm --filter @meiye/core test

tests 2273
pass 2263
fail 0
skipped 10
```

The same run includes the T14 static writer gates:

```text
ProductUsage SQL writes stay in the canonical billing repository
ProductUsage reserve calls stay in the Coordinator billing chain
```

No production `usage.reserve` caller or `p1_product_billing_usage` SQL writer
was added. The only production callers remain the quote service and the
PostgreSQL creation-submission reservation adapter; the only SQL writer remains
the canonical billing repository.

Final locked browser command:

```text
/Users/bin/Desktop/开发/内容无人区/美业内容2/.scratch/orca-run-2026-07-25/e2e-lock.sh \
  pnpm --filter @meiye/web e2e \
  tests/e2e/specs/assembly-gate-required-journey.spec.ts \
  tests/e2e/specs/intent-routing-http-sse.spec.ts \
  tests/e2e/specs/composer-card-family.spec.ts
```

Playwright original summary:

```text
2 failed
11 passed (15.1m)
```

The Core-owned smoke portion was green inside that same run:

```text
assembly-gate-required-journey: 1 passed
intent-routing-http-sse:        3 passed
```

Seven of nine confirmation-card cases also passed, including the default
countdown release. The two pre-timeout question-card cases did not see the card:
Core won the configured 30-second race before the slow browser rendered it.
The first run also recorded a transient P1 worker PostgreSQL connection timeout;
an isolated locked rerun without that worker failure reproduced the same two
missing-card outcomes. This is the OI-53 frontend presentation/trigger boundary,
not a Core late-answer API failure; T45 leaves the frontend unchanged and
records the red honestly.

Lock audit for the complete three-spec run:

```text
2026-07-26T12:18:15+0800 acquire pid=77752 waited=0s cwd=/Users/bin/orca/workspaces/美业内容2/t45-confirmation-timeout cmd=pnpm --filter
2026-07-26T12:33:28+0800 release pid=77752 cwd=/Users/bin/orca/workspaces/美业内容2/t45-confirmation-timeout
```
