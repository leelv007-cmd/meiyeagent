# T44 Day-0 no-blocking-question acceptance evidence

## Scope

- Branch: `leelv007-cmd/t44-day0-no-blocking-question`
- Final rework base: local `main` at `755396f2`
- Fixture/local evidence only; no credential or live-provider call was used.
- No frontend component, visual surface, or original D-043 assertion was changed.

The revised implementation keeps a new Day-0 industry-gap run on the
`customized` route, preserves `usedAssetCategories` (or supplies `store` when
empty), and marks the server-owned continuation as `routingSource: "policy"`.
It compiles the frozen grounding surface and counts only active confirmed
`store_fact:` references. A fact suppresses a question only when its key can
answer that gap; otherwise the workflow continues without registering a new
question and chooses its merchant notice from whether confirmed materials are
actually present.

Before taking that new branch, the runtime directly reads the pending-question
store. An already registered matching PENDING question follows the original
`awaitDecision` sequence. The read intentionally stays outside `DBOS.runStep`,
so an old workflow replay does not acquire a new function ID.

## Adversarial rework disposition

| Finding | Change and proof |
| --- | --- |
| F1 — predicate was effectively Day-0 metadata | Replaced revision/snapshot heuristics with frozen-grounding counts. Production tests cover one matching confirmed fact, active but non-answering facts, and no answering fact. |
| F2 — free route lost customized semantics | New continuation returns `route: customized`, `routingSource: policy`, and preserves categories or fills `store`. Workflow and production-port assertions inspect the declaration received by context injection. |
| F3 — acceptance used a qualitative activation claim | Focused browser proof measured exactly **2 trusted top-level activations** before first token. |
| F4 — test used merchant copy as the no-question oracle | Focused browser test now asserts `data-testid="composer-question-turn"` count is zero. Original `uiux-day0-contract.spec.ts` is unchanged. |
| F5 — replay could change the DBOS function-ID sequence | `hasRegisteredPendingQuestion` is checked before the policy branch. The replay test supplies an old PENDING row and asserts the original six `runStep` keys in order; no extra effect key appears. |
| F6 — reverse control was not production-reachable | Production ports and workflow tests use a `reuseSeed` request whose `industry_category` question is raised, answered, and then resumes. |
| F7 — test-surface changes were under-reported | Every modified test file is declared below. |
| F8 — ignored-decision HTTP/SSE coverage was displaced | Restored a focused test that POSTs `state: "ignored"` and observes the same SSE task reach `success`. Accepted-answer continuation is separately covered. |
| F10 — `"decision"` falsely implied merchant choice | Added `routingSource: "policy"` with a type comment: the server policy chose continuation; the merchant made no decision. |

## Focused Core contract

```text
pnpm --filter @meiye/core exec tsx --test \
  src/p1/harness/workflow-core.test.ts \
  src/p1/harness/production-stage-ports.test.ts \
  src/p1/harness/merchant-delivery-language.test.ts

95 passed / 0 failed
```

The relevant assertions prove:

- an answerable confirmed fact removes the question without changing away from
  `customized`;
- non-answering confirmed facts do not masquerade as an answer, but do select
  the honest “reference confirmed materials” continuation notice;
- no confirmed grounding selects the neutral continuation notice, which does
  not tell a filled merchant to add store information;
- a pre-existing PENDING industry question keeps the exact old decision effect
  sequence;
- a reachable reuse-path industry question is raised, answered, and resumed.

## Focused HTTP + SSE proof

```text
pnpm --filter @meiye/web exec playwright test \
  tests/e2e/specs/intent-routing-http-sse.spec.ts

3 passed (1.8m)
```

The three tests prove:

1. A cold start without a category word has zero
   `composer-question-turn` elements, reaches its first token after exactly
   **2** trusted top-level activations, shows a delivery card, and has no
   decision.
2. A reachable `promotion_details` question accepts an inbox answer and the
   same task continues over SSE to `success` (T41 control).
3. POST `/decision` with `state: "ignored"` resumes the same task over HTTP +
   SSE to `success`.

The final run created six task requests after `2026-07-26 00:19:00+00`.
The direct post-run query returned zero PENDING questions; both tasks that
registered a question were `resolved`:

```sql
select count(*) as pending_since_final_run
from harness_runtime.pending_questions q
join harness_runtime.task_requests r on r.task_id = q.task_id
where r.created_at >= '2026-07-26 00:19:00+00'
  and q.status = 'pending';

pending_since_final_run = 0
```

There are 12 older PENDING rows in this lane database, all predating this run.
The revised contract explicitly leaves stored cleanup to a separate ticket;
T44 produced no new ghost row.

## Serial D-043 measurement

The original spec ran alone after the rework:

```text
pnpm --filter @meiye/web exec playwright test \
  tests/e2e/specs/uiux-day0-contract.spec.ts --workers=1

3 passed / 4 failed (8.5m)
```

The pure-text case reached first token after its built-in exact
**2-activation** assertion, then failed only at
`creativeEventTypes=[]` (`uiux-day0-contract.spec.ts:323`). The other current
red cases were the template first-token timeout (`:210`), video delivery-card
timeout (`:332`), and T5 first-token timeout (`:539`). The ticket coordinator
assigned these D-043 residual failures to other owner issues.

The pure-text empty array is an Operations projection result, not an SSE frame
collection. `creativeEventTypes()` queries `creative_workbench.events`.
The corresponding generic Harness run persisted progress, ten token frames,
delivery success, and terminal `SUCCESS`, while the workspace had no
`p1_creation_events` row. That is the previously reported cross-spine
projection gap: delivery occurred, but the separate Operations
`createCreativeWork` projection was never populated.

The original spec remains byte-identical to main:

```text
git diff --exit-code main -- \
  mkfast-template-main/tests/e2e/specs/uiux-day0-contract.spec.ts
exit 0
```

## Modified test surface

- `workflow-core.test.ts`: customized policy continuation with and without
  confirmed material; exact old PENDING replay effect keys; production-reachable
  reuse question, answer, and resumption; T41 semantic resumption uses the
  reachable promotion gap.
- `production-stage-ports.test.ts`: confirmed matching fact policy declaration,
  grounding counts for non-answering facts, and reuse-path industry question.
- `merchant-delivery-language.test.ts`: generic and both grounding-sensitive
  notices remain merchant-facing and free of internal routing language.
- `dbos-registration.smoke.test.ts`: supplies the new read-only pending-store
  seam to the registration smoke fixture.
- `intent-routing-http-sse.spec.ts`: real question-turn absence, exact activation
  count and delivery; accepted-answer continuation; ignored POST decision plus
  SSE success.
- `ui-journey.ts`: documents that the shared journey accepts category-free
  Day-0 intent while later required gaps may still ask and resume.

`uiux-day0-contract.spec.ts` was not edited.

## Package gates

```text
pnpm --filter @meiye/core typecheck
exit 0

pnpm --filter @meiye/web typecheck
exit 0

pnpm --filter @meiye/core test
2248 tests / 2238 pass / 0 fail / 10 skipped, 568987ms
```

The focused owner tests, full Core suite, both affected-package typechecks,
HTTP/SSE contract, and DBOS pending-row check are green. The ten skips are the
existing explicit live-provider or isolated-service opt-ins; T44 added no
skip.
