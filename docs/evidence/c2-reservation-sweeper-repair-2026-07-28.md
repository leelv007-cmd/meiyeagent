# C2 reservation sweeper and repair metrics closeout

## Reservation current-state map

```text
CreationSubmissionCoordinator
  ├─ ProductUsage = reserved
  ├─ ProductQuote = reserved
  └─ GrantLot consume operation(s)
          │
          ▼
DBOS Harness reaches a question with unattended=hold
  ├─ pending_questions.status = pending
  └─ waits without a workflow timeout
          │
          ├─ merchant answers before the reservation lease ends
          │    └─ existing workflow continues and normal settlement runs
          │
          └─ no answer before reservation lease ends
               └─ reservation sweeper refunds ProductUsage + GrantLot
                    ├─ reservation_sweeps = completed
                    ├─ operations audit + Langfuse = reservation released
                    └─ pending_questions stays pending
```

Before this change, only normal completion, workflow failure/cancellation, or a
merchant answer reached the billing settlement executor. An unbounded hold
reached none of them, so both the ProductUsage projection and its consumed
GrantLot operations could remain reserved forever.

## Release semantics

- The default 7-day value is a **reservation lease**, not a question timeout.
  It is hot-read from `harness.reservation_sweep.ttl_seconds`; the 30-day
  operator-configurable upper bound is unchanged.
- A candidate must still be a pending `hold`, have a reserved ProductUsage and
  reserved quote, and have no existing completed sweep.
- Release uses the normal idempotent billing refund seam. The durable sweep row
  records its reason, attempts, held time, quote, usage reservation and units;
  completion emits an audit event and Langfuse outbox row.
- The question is not resolved by release. When the merchant later answers, the
  existing late-answer seam creates a fresh quote/snapshot successor, then sends
  a stable cancellation signal to the old suspended workflow. The old workflow
  cannot execute against quota that has already been returned. Both the normal
  dispatch and the compensation reconciler enforce this at their DBOS send
  boundary.
- The pending-decision read model carries `reservationReleased` independently
  from `resolutionSource`. The merchant card changes its promise immediately:
  the old quota is back, and answering will re-enter the queue and reserve quota
  again. A persisted `late_answer` keeps the question available for retry.
- A refund failure before either billing ledger changes marks the sweep
  `failed`, schedules exponential backoff, and leaves the still-valid hold
  answerable between attempts. Five failed attempts move it to `dead_letter`
  rather than creating a permanent 60-second retry loop. A partial refund or a
  crash after refund but before completion remains `processing`; its persisted
  facts replay after the lease even though ProductUsage already reads
  `refunded`.
- Completion and dead-letter outcomes are written to the canonical
  `p1_operations_audit_events` table. The completion also emits the existing
  Harness audit/outbox event under the registered `product-billing` Langfuse
  stage, so the product operations projection and external observability agree.
- This path does not depend on a `persist-core-hold-expired` recovery shim. The
  explicit no-production-deployment exemption remains unchanged.

## D-035 repair truth

The three repair indicators are now derived from the real structured provider
attempt boundary:

| Indicator | Previous reading | Truth source |
| --- | --- | --- |
| First-pass schema validation | Always `true` after any final valid output | First `Output.object` attempt |
| Repair call rate | Fake runner callback/result only | One bounded retry after `NoObjectGeneratedError` |
| Retry trigger rate | Model-supply route attempts only | Model-supply attempts plus the provider repair attempt |

This is an intentional production behavior change, not only a measurement
change. Every structured node now gets at most one additional provider call
after `NoObjectGeneratedError`, using the AI SDK `Output.object` repair pattern.
On this failure path provider requests and token cost can therefore be up to
twice the former single-attempt path. If the bounded repair also fails, the task
keeps its existing conservative failure/fallback semantics, but both attempts'
usage and the failed first-pass/repair measurement are still recorded.

The constructive regression sends one invalid structured provider response and
one valid repaired response. It asserts the exact snapshot: first-pass
`0 valid / 1 invalid`, repair `1`, retry `1`, and nested completeness `6 / 7`.
Two additional regressions prove that (a) a first-pass plus repair double failure
still contributes one invalid call to the denominator and (b) a model-supply
idempotency replay preserves the original repair measurement instead of
defaulting it to a first-pass success.

## Baseline-red attribution

The focused command
`pnpm --filter @meiye/core exec tsx --test src/p1/harness/postgres-store.test.ts`
was run on this branch and in a detached `/tmp` worktree at the exact branch
base `650999e5`. Both produced the same result: **4 pass, 1 fail, 0 skip**. The
single failure is
`apps/core/src/p1/harness/postgres-store.test.ts:123`, where
`today recommendation selects the frozen revision trace when context injection
has multiple traces` receives `undefined` instead of `package-1`. No file in
that assertion or its today-recommendation production path differs in this C2
branch, so this failure is baseline evidence rather than a C2 regression.

## Recorded follow-ups

- The streaming repair branch does not replay repaired partial output through
  `onPartialOutput`; changing that user-visible stream transition remains
  separately recorded (P2-4).
- `claimBatch` still polls its multi-join CTE once per compensation interval and
  `pending_questions` has no dedicated `(status, updated_at)` index. Index/query
  tuning remains separately recorded (P2-7).
