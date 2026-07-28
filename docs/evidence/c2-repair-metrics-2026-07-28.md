# C2 repair-only closeout

## Scope

This branch keeps only the C2 work that remains valid after the product ruling
that a held confirmation expires, cancels the task, and refunds its reservation.
It does not contain the reservation sweeper, sweep state machine, billing
release projection, released-reservation cancellation envelope, or the
sweeper-only Langfuse stage.

## D-035 repair truth

The D-035 indicators are now derived from the real structured provider attempt
boundary:

| Indicator | Previous reading | Truth source |
| --- | --- | --- |
| First-pass schema validation | A final valid object was always recorded as first-pass valid | The first AI SDK `Output.object` attempt |
| Repair call rate | Only fake runner callbacks/results could report repair | One bounded retry after `NoObjectGeneratedError` |
| Retry trigger rate | Only model-supply route attempts were counted | Route attempts plus the provider repair attempt |

The AI SDK runner makes at most one repair call. Its prompt includes the invalid
response, asks only for the structural correction, and explicitly forbids
inventing missing merchant facts. The runner adds both calls' token usage and
passes the real provider attempt count through the durable model-supply result
to the structured-node metrics consumer.

This is an intentional production behavior change, not an observability-only
change. Previously, `NoObjectGeneratedError` ended the structured node, which
then followed its existing task-failure/refund or conservative fallback path.
Now every structured node silently asks the model once more before taking that
path. Provider requests and token cost on the schema-failure path can therefore
reach approximately twice the former single-attempt path. If the bounded repair
also fails, the node then returns to its existing failure/refund or conservative
fallback behavior, while both calls' usage and the failed first-pass/repair
measurement are recorded.

## Constructive negative controls

Focused command:

```text
pnpm --filter @meiye/core exec tsx --test \
  src/p1/model-supply/structured-node-runner.test.ts
```

Before the repair implementation, the real-provider regression failed with
`providerCalls: 1` where `2` was required.

After the first repair implementation but before the two review corrections,
the focused suite reproduced both biased readings:

1. When the first attempt and bounded repair both failed, the old catch boundary
   recorded `calls 0 / schemaInvalid 0 / repair 0 / retry 0 / completeness 0/0`.
   The corrected reading is
   `calls 1 / schemaInvalid 1 / repair 1 / retry 1 / completeness 0/7`.
2. On a durable model-supply replay, the old result exposed
   `firstPassSchemaValid: undefined`; the consumer's `?? true` therefore
   classified an originally repaired call as first-pass valid. The corrected
   replay preserves `firstPassSchemaValid: false`, repair count `1`, and reason
   `schema_validation` without a second provider execution.

The final focused result is **10 pass / 0 fail / 0 skip**.

## C1 resume reconciliation judgment

The sweeper fence itself is not retained:

- `core_hold_expired` is inserted with `resume_status='sent'`, so it is never a
  resume-reconciler candidate.
- The same transaction resolves the pending question. A normal decision cannot
  subsequently persist as a pending resume event; it fails the authoritative
  pending-question check.
- A merchant answer after expiry is deliberately persisted as `late_answer` and
  creates a fresh successor. The expired DBOS workflow has already returned a
  cancellation and its billing settlement has refunded the reservation.

Therefore, the C2 `reservationReleased` lookup and the
`resumeHarnessDbosWorkflow` send-boundary fence solve a state that C1 cannot
reach and are omitted.

One independent C1 recovery defect remains reachable and is fixed narrowly. If
a `late_answer` event is committed but synchronous successor creation fails,
the old reconciler sent that event to the expired workflow. That does not
restart provider work, but it can mark the compensation sent without creating
the promised successor. The reconciler now reads the persisted
`resolution_source` and original request, routes only `late_answer` to the
stable successor ID, and keeps ordinary decisions on the existing resume path.
It does not query reservation release state or send a cancellation envelope.

The constructive negative control observed
`unsafe-old-workflow-message` before the fix. The final focused reconciler
result is **3 pass / 0 fail / 0 skip**, with the action instead equal to
`successor:task-35:composer-task:late-answer-d3724871c13976fac6cae12b`.
