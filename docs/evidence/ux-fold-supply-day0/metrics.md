# Product metrics wiring (V1)

## Existing Langfuse node-quality metrics

`apps/core/src/p1/harness/langfuse-sender.ts` exports:

| Score name | Meaning |
| --- | --- |
| `harness.schema.first_pass_rate` | Initial structured-node schema validity |
| `harness.repair.call_rate` | Repair path status |
| `harness.retry.trigger_rate` | Retry trigger rate |
| `harness.nested_field_completeness_rate` | Nested field completeness |

The prompt-version dataset remains `harness-structured-node-metrics`.

## Day-0 product metrics

The production path is:

1. `first-usable-draft-metric.ts` starts from the trusted composer submit
   activation, counts later trusted top-level primary clicks or keyboard submits,
   marks a Harness question as a conflict, and stops at the first non-empty
   candidate token.
2. The Web route posts the allowlisted metric to the authenticated Harness task.
3. Core verifies workspace ownership, writes
   `first_usable_draft_observed` to `harness_runtime.audit_events`, and enqueues
   the same event in `harness_runtime.langfuse_outbox`.
4. `langfuse-sender.ts` emits deterministic scores on the existing Harness trace.

| Score | Value | Boundary |
| --- | --- | --- |
| `product.confirmation_precision` | `1` when no-conflict 用户激活次数 is `<= 2`, otherwise `0` | Conflict paths are excluded from this score. |
| `product.time_to_first_usable_draft` | Integer milliseconds from submit activation to first usable token | Exported for mouse, keyboard, and conflict paths. |

Only `path`, `userActivationCount`, and `timeToFirstUsableDraftMs` cross the
observability boundary. Raw intent, user identity, assets, and credentials are
not accepted by the strict request schema or included in the Langfuse payload.
PostgreSQL remains authoritative; Langfuse delivery is retryable observability.

## Verification

- `packages/contracts/src/harness.test.ts` freezes the strict metric request.
- `apps/core/src/p1/harness/http.test.ts` covers authenticated ownership,
  idempotent audit creation, invalid input, and cross-workspace rejection.
- `apps/core/src/p1/harness/langfuse-sender.test.ts` covers both score mappings
  and the conflict-path precision exemption.
- `mkfast-template-main/tests/e2e/specs/uiux-day0-contract.spec.ts` remains the
  browser hard gate. Its canonical path requires the authenticated metric POST
  to return HTTP 202. The response is selected by the stable
  `first-usable-draft-v1:` idempotency prefix plus valid path/time/count fields;
  the assertion requires the captured count and `canonical_mouse` (therefore a
  non-conflict precision sample). Screenshots never replace these assertions.
