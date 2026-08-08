# T45 confirmation-card timeout acceptance evidence

## Scope and authority

- Branch: `legacy-origin-a/t45-confirmation-timeout`
- Merge-path base: local `main` at `5aee7c5d` (includes T20 and T28).
- The browser journey input follows T44's promotion-gap behavior; its governed
  admin-config setup only separates answer and timeout timing deterministically.
- Evidence class: local fixture, real lane PostgreSQL, real lane DBOS, and
  locked fixture-browser gates. No credential or live-provider call is part of
  this acceptance.
- The database keeps the existing `pending | resolved` states. Server-authored
  provenance lives in `decision_events.resolution_source`; idempotency suffixes
  are used only for uniqueness.
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
| F-2 — a late answer disappeared after terminal success | A resolved question whose server-authored consuming source is `core_timeout` or `core_hold_expired` accepts only a real `accepted` merchant answer as `{questionId}:late_answer`. The first answer starts a deterministic new workflow; subsequent answers replay the first persisted command and return the same successor reference without 409 or a second start. |
| F-3 — config snapshot shifted old DBOS function IDs | The config read is an ordinary `await`, with the durable recv deadline providing replay determinism. A child process persists a pre-T45 PENDING layout, exits without graceful shutdown, and the parent recovers it with the new code. After T28's static intent-skill step, it completes with IDs `4/5/6/7 = persist pending / setEvent / recv / sleep`, without branch or error. This test does not cover a changed config head. |
| F-4 — timeout looked like a merchant decision | The DBOS carrier passes the server-authored resolution alongside the command; `workflow-core` reads that fact to select `routingSource: policy` and never sniffs an idempotency-key suffix. Merchant ignored decisions remain `routingSource: decision`. |
| F-5 — reverse controls | A snapshot-backed run without `usageReservation` never reads the timeout config and waits until an explicit decision arrives. A reservation proves quota was already locked. `external_effect` remains the separate `approvalRequests` blocking-node path in `PostgresHarnessStore.registerPending`, so this timeout change does not consume or bypass it. |
| F-6/F-7 — unsafe config and English ledger value | Config validation is `1..3600`; `3601` is rejected. The synthetic value is `超时未作答，已按通用口径继续`. |
| F-8 — smoke terminal race | The smoke polls the workflow terminal state before asserting `SUCCESS`. |
| F-9 — evidence and stale 48h review text | This report records the commands, SQL facts, replay layout, reverse controls, frontend boundary, and browser lock audit. The old deep-review line now says config default 30 seconds. |
| F-10 — non-answers created paid successors | Late-answer admission requires `state=accepted` and rejects the sentinels `未作答` and `这次先跳过`. A discarded browser POST returns HTTP 200 with `consumedByOther=true`, omits `replayed` and `successor`, writes no decision event, and creates no quote, usage reservation, or submission. |
| F-11 — leaked recovery baseline | The five coordinator-specified rows are removed before the final gates. The recoverable-start test filters its assertion by the fixture workspace while the production store query remains byte-unchanged. |
| F-12/F-15 — provenance and fallback | `decision_events.resolution_source` is added for existing databases with an explicit backfill. Target resolution and late-answer admission read this server column, while the optional-store fallback reads pending and resolved views separately instead of hardcoding `pending`. |
| F-13 — opt-in timeout | `QuestionCard.unattended` is `continue | hold`, missing means hold, and production constructors explicitly declare their policy. Automatic continuation requires both `continue` and a usage reservation. |
| Hold expiry cancellation | A hold card uses one 48-hour recv. Expiry records `core_hold_expired`, resolves the pending row, refunds through the existing billing compensation port, skips commit and delivery, and writes `outcome=cancelled` plus `超时未选择，本次任务已取消，额度已退回` into the terminal return value. The frontend outlet for that message is not wired and is tracked by OI-69. |

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

hold-expired task:
  pending_status=resolved
  idempotency_keys=[...:core_hold_expired]
  events=1 traces=1 audits=1 outbox=1
```

The same test calls
`PostgresOperationsRepository.assertTaskHasNoPendingQuestion` after the core
timeout and observes no conflict. This is the export/delivery negative control:
the resolved row no longer blocks an export gate.

The frontend/core race is also fail-safe. If the browser `:timed_out` event wins
the row first, `submitCoreTimeout` returns `consumedByOther` rather than failing
the workflow; the DBOS carrier waits for the already-persisted browser command.

The reverse late-answer control sends `ignoredDecision('未作答')` after the core
timeout. The service returns `consumedByOther=true`; direct PostgreSQL counts
for `creation_submissions`, quotes and usage reservations remain unchanged, and
the timeout task still has only its timeout event until a real answer arrives.

## DBOS replay, timeout, and quota proof

Command:

```text
pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 \
  src/p1/harness/dbos-registration.smoke.test.ts

6 passed / 0 failed

pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 \
  src/p1/harness/decision-service.test.ts

11 passed / 0 failed
```

The timeout run records:

```text
functionID 4  persist-pending-{questionId}
functionID 5  DBOS.setEvent
functionID 6  DBOS.recv
functionID 7  DBOS.sleep
functionID 8  persist-core-timeout-{questionId}
terminal      SUCCESS
```

The function-ID recovery case uses an independent process to leave IDs 4, 5
and 7 durable while recv is PENDING, then launches the new code with the same
application version. DBOS recovers the original deadline, receives the merchant
answer at ID 6, completes the same workflow, and retains the exact final
4/5/6/7 layout. The post-recv write is ID 8 only on the timeout branch; it
cannot shift an already pending recv. This case does not exercise config drift.

The quota negative control supplies no `usageReservation`, sets the config to
one second, waits 1.5 seconds, and asserts:

```text
workflow=PENDING
configReads=0
coreTimeoutSubmissions=0
```

An explicit ignored decision then completes the run. A declared `hold` card
uses the same IDs 4/5/6/7 with one 48-hour recv and does not read the 30-second
config. When that recv expires, the post-recv `core_hold_expired` write consumes
the pending row; the wrapper refunds, skips commit, and returns success without
a delivery. Missing reservation means there is nothing to refund; a present
reservation without a billing port or settlement input is rejected rather than
claiming a successful refund.

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

## Lane database cleanup

Before the final browser and Core baselines, the coordinator-authorized cleanup
removes exactly these leaked r2 rows:

```text
execution_spine.creation_submissions:
  snapshot-composer-task:late-answer-4fa4e89fbdabe551e4b81cea
p1_product_billing_quotes:
  quote-composer-task:late-answer-4fa4e89fbdabe551e4b81cea
p1_product_billing_usage:
  task/quote composer-task:late-answer-4fa4e89fbdabe551e4b81cea
harness_runtime.decision_events:
  composer-task:450e1da588d1ae9fce87ebd8c874b976cc6def1f709ccdc3637cd82789181320:s1:promotion_details:late_answer
p1_content_packages:
  content-package-c9c54e63-5c00-4bbf-bc42-c84b2e494efd
workspace:
  ws_Lkhp0iLaQ8qtM7y9CqBord8DIRY4EjpE
```

The final query checks that no `creation_submissions.harness_state=reserved`
row remains, except a row created and cleaned inside a currently running test.
The cleanup transaction returned one deleted row for each identifier above;
the post-browser and post-Core query returned
`reserved_submissions=0` and every target-specific count was zero.

## Package and browser gates

Core typecheck:

```text
pnpm --filter @meiye/core typecheck
exit 0
```

Final Core baseline:

```text
pnpm --filter @meiye/core test

run 1: /tmp/t45-r3-core-full-1.log
tests 2298
pass 2288
fail 0
skipped 10

run 2: /tmp/t45-r3-core-full-2.log
tests 2298
pass 2288
fail 0
skipped 10

merge-path rebase: /tmp/t45-r3-rebase-core-full.log
tests 2321
pass 2311
fail 0
skipped 10
```

The merge-path sample was taken after the targeted PostgreSQL and DBOS runs,
with no later browser or other write-producing gate. The final read-only query
returned `creation_submissions.harness_state=reserved: 0`.

The same run includes the T14 static writer gates:

```text
ProductUsage SQL writes stay in the canonical billing repository
ProductUsage reserve calls stay in the Coordinator billing chain
```

No production `usage.reserve` caller or `p1_product_billing_usage` SQL writer
was added. The only production callers remain the quote service and the
PostgreSQL creation-submission reservation adapter; the only SQL writer remains
the canonical billing repository.

The confirmation-card browser journey now uses the normal governed
admin-config front door in setup:

```text
/Users/bin/Desktop/开发/内容无人区/美业内容2/.scratch/orca-run-2026-07-25/e2e-lock.sh \
  pnpm --filter @meiye/web e2e \
  tests/e2e/specs/composer-card-family.spec.ts \
  --grep 'the three cards appear|answering the question card resumes'
```

Before each affected journey, an E2E administrator reads `config_history`,
applies `harness.confirmation_card.timeout_seconds` with the current CAS
revision and a unique idempotency key, then reads the history again and asserts
the new value, revision and audit reason. The two answer journeys use 600 and
599 seconds so every repeated suite run advances the revision. The timeout
journey uses 60 seconds, leaving the card's shipped 30-second countdown and all
existing assertions byte-unchanged while ensuring the browser `:timed_out`
decision wins before core's independent fallback.

Answer journeys, consecutive locked run 1:

```text
the three cards appear ...                         17.7s
answering the question card resumes the run ...    12.8s
2 passed (1.8m)
```

Answer journeys, consecutive locked run 2:

```text
the three cards appear ...                         17.7s
answering the question card resumes the run ...    11.9s
2 passed (1.6m)
```

Timeout journey:

```text
leaving the question alone releases it on the countdown ... 46.5s
1 passed (1.9m)
```

The lane PostgreSQL audit history after those runs:

```text
revision  value  reason
8         600    T45 e2e three-cards ... set confirmation timeout to 600s
9         599    T45 e2e answer-question ... set confirmation timeout to 599s
10        600    T45 e2e three-cards ... set confirmation timeout to 600s
11        599    T45 e2e answer-question ... set confirmation timeout to 599s
12         60    T45 e2e timeout-question ... set confirmation timeout to 60s
```

Each row also carries its authenticated admin `actor_id` and a distinct
`correlation_id`. This is a real `admin_config_revisions` audit trail; the E2E
does not seed or update that table directly.

Lock audit for the four successful commands:

```text
2026-07-26T14:38:41+0800 acquire pid=72945 waited=130s cwd=/Users/bin/orca/workspaces/美业内容2/t45-confirmation-timeout cmd=pnpm --filter
2026-07-26T14:40:33+0800 release pid=72945 cwd=/Users/bin/orca/workspaces/美业内容2/t45-confirmation-timeout
2026-07-26T14:40:38+0800 acquire pid=79478 waited=0s cwd=/Users/bin/orca/workspaces/美业内容2/t45-confirmation-timeout cmd=pnpm --filter
2026-07-26T14:42:15+0800 release pid=79478 cwd=/Users/bin/orca/workspaces/美业内容2/t45-confirmation-timeout
2026-07-26T14:42:20+0800 acquire pid=82012 waited=0s cwd=/Users/bin/orca/workspaces/美业内容2/t45-confirmation-timeout cmd=pnpm --filter
2026-07-26T14:44:19+0800 release pid=82012 cwd=/Users/bin/orca/workspaces/美业内容2/t45-confirmation-timeout
2026-07-26T14:44:27+0800 acquire pid=85770 waited=0s cwd=/Users/bin/orca/workspaces/美业内容2/t45-confirmation-timeout cmd=pnpm --filter
2026-07-26T14:46:03+0800 release pid=85770 cwd=/Users/bin/orca/workspaces/美业内容2/t45-confirmation-timeout
```

The earlier full smoke remains green for the Core-owned browser surfaces:

```text
assembly-gate-required-journey: 1 passed
intent-routing-http-sse:        3 passed
combined:                       4 passed (1.6m)
```

## Merge-path backlog notes

- OI-69 owns the unwired terminal cancellation message outlet and the narrow
  double-swallow refund path; neither is represented as completed frontend
  behavior here.
- The existing no-reservation 60-second retry loop can grow DBOS function IDs
  without bound. It is pre-existing and non-blocking for this merge.
- The late-answer sentinel value comparisons are redundant after the accepted
  state gate; they remain as defense in depth and are not expanded in T45.
- The append-only audit stream can retain the r2 invalid late-answer attempt
  even after the coordinator-authorized mutable-row cleanup. It is historical
  evidence of the rejected attempt, not current decision truth.
- The reviewer independently ran the contracts leg at `77 passed / 0 failed`.

## Post-merge coordinator note (2026-07-26)

The full-suite "0 failed" figures above are facts about those sample runs, not a
property: the independent reviewer's two full runs scored 1 fail / 0 fail, the
failure being the pre-existing five-stage DBOS smoke (dbosErrorCode 26) whose
cancel/resume could race the recv arming window — with a pre-T45 precedent on
the T28 lane (be1_dbos, 06:57:22, same code). That window is test infrastructure,
not production (no non-test cancelWorkflow/resumeWorkflow callers), and the
smoke now waits for the persisted pending pre-state before cancelling.
