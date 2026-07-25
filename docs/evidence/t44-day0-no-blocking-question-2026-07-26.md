# T44 Day-0 no-blocking-question acceptance evidence

## Scope and revisions

- Branch: `leelv007-cmd/t44-day0-no-blocking-question`
- Tested implementation revision: `8f0d765e`
- Same-environment comparison revision: local `main` at `30ac4d47`
- Fixture/local evidence only. No provider credential or live-provider call was used.
- No frontend component or visual surface was changed.

The implementation changes only the Harness routing policy seam:

- `workflow-core.ts:890-895,961-974` converts an `industry_category` gap to
  the existing free route only for a new customized Composer snapshot
  (`expectedRevision === 0`, no reuse seed/source package/semantic decision).
- `workflow-core.ts:897-940` remains the blocking-question and T41 resumption
  path for every other case. `HarnessSnapshotDecisionError`,
  `applyCurrentTaskDecision`, and `resubmitSemanticDecision` remain intact.
- `merchant-delivery-language.ts:42-44` owns the exact generic-mode notice;
  its language gate now also rejects `industry_category`, `intent`, and
  `snapshot`.

## Serial D-043 comparison

Both commands ran alone with the same `lane.env`, PostgreSQL instance, ports,
Playwright configuration, and `--workers=1`. Neither run had SQLSTATE `53300`
or an unexplained process interruption.

Branch:

```text
pnpm --filter @meiye/web exec playwright test tests/e2e/specs/uiux-day0-contract.spec.ts --workers=1
2 passed / 5 failed, 9.2m
```

Base `main`:

```text
pnpm --filter @meiye/web exec playwright test tests/e2e/specs/uiux-day0-contract.spec.ts --workers=1
1 passed / 6 failed, 12.6m
```

| Original test | Branch `8f0d765e` | Base `30ac4d47` | Classification |
| --- | --- | --- | --- |
| Template path (`:210`) | First-token timeout at `:76/:242` | Same first-token timeout | Pre-existing; T44 does not own template application |
| Pure text (`:266`) | Reached first token at exactly 2 activations, then `creativeEventTypes=[]` at `:323` | First-token timeout at `:76/:303` | T44 removes the Day-0 block; the later Operations projection gap is pre-existing |
| Video (`:332`) | Delivery-card timeout at `:119/:381` | Same delivery-card timeout | Pre-existing video delivery defect |
| Keyboard submit (`:399`) | PASS at exactly 2 activations | First-token timeout at `:76/:423` | Fixed by T44 |
| Activation counter persistence (`:440`) | PASS | PASS | Control remains green |
| High-risk conflict (`:491`) | First-token timeout at `:76/:524` | Same first-token timeout | Pre-existing `promotion_details`/high-risk gate behavior |
| T5 inline authorization (`:539`) | First-token timeout at `:703` | Same first-token timeout | Pre-existing downstream path |

The `creativeEventTypes=[]` result is not a missing generic-route emission.
`creativeEventTypes()` at `uiux-day0-contract.spec.ts:135-159` does not
collect SSE frames. It calls the Operations `creative_workbench` query and
reads its `events` projection. The Composer submission path is
`CreationSubmissionCoordinator.submit()` in
`execution-spine/submission-coordinator.ts:130-200`; it creates the
snapshot/task/work/package and starts Harness without calling Operations
`createCreativeWork`. The queried `first_work_created` event is emitted only
inside `OperationsApplicationService.createCreativeWork()` at
`operations/application-service.ts:5291,5466`. T44 therefore exposes an
existing cross-spine Operations projection gap after the formerly blocked
Composer path reaches its token; it does not own that projection.

The persisted frames from the focused generic-mode run provide the direct
control. The run was selected from
`meiye_be1_dbos_playwright_4101_41908` by its DBOS `created_at` value:

```sql
with run as (
  select workflow_uuid, status
  from dbos.workflow_status
  where created_at = 1785012757028
),
frames as (
  select
    s.offset as stream_offset,
    (s.value::jsonb->'json') as frame_json
  from dbos.streams s
  join run r using (workflow_uuid)
  where s.key = 'progress'
    and s.serialization = 'js_superjson'
)
select
  stream_offset,
  case
    when frame_json ? 'delta' then 'workflow.token'
    else 'workflow.progress'
  end,
  coalesce(frame_json->>'stage', frame_json->>'channel'),
  coalesce(frame_json->>'state', frame_json->>'delta')
from frames
union all
select 999, 'workflow.state', null, status from run
order by 1;
```

Actual sequence:

```text
workflow.progress intent_naming success
workflow.progress context_injection success
workflow.progress brief_compilation success
workflow.token copy.title x2
workflow.token copy.body x7
workflow.token copy.cta x1
workflow.progress execution_selection success
workflow.progress assembly_delivery success
workflow.state SUCCESS
```

The first progress frame contains the exact generic-mode notice. The ten token
frames contain the delivered title/body/CTA, and the workflow closes
successfully. A same-workspace query against `public.p1_creation_events` for
this run's workspace returned `0 rows`, which is why
`creative_workbench.events` is empty even though the Harness SSE delivery is
complete. This proves classification **(b)**: the existing spec reads a
projection populated only by the separate Operations `createCreativeWork`
path.

The original D-043 spec and assertions were not changed:

```text
git diff --exit-code 30ac4d47..HEAD -- \
  mkfast-template-main/tests/e2e/specs/uiux-day0-contract.spec.ts
exit 0
```

## Focused end-to-end proof and reverse control

```text
pnpm --filter @meiye/web exec playwright test \
  tests/e2e/specs/intent-routing-http-sse.spec.ts --workers=1
2 passed (1.1m)
```

The first test uses a confirmed store and a customized cold-start phrase with
no category word. It asserts:

- no blocking question;
- the exact merchant-visible generic-mode notice;
- first token after exactly **2 trusted top-level activations**;
- visible delivery card;
- no pending task decision;
- no internal routing vocabulary in the notice.

The second test is the reverse control. A non-Day-0
`promotion_details` question is still raised; after the answer, the same task
continues over SSE to `success`, proving the T41 resumption path remains
effective.

Focused Core tests covering Day-0, later-revision blocking, resumption, and
merchant language passed before the browser run:

```text
pnpm --filter @meiye/core test -- \
  src/p1/harness/workflow-core.test.ts \
  src/p1/harness/merchant-delivery-language.test.ts
17 passed / 0 failed
```

## Dashboard chain and DBOS check

Branch and base both ran the same single sample-chain test:

```text
pnpm --filter @meiye/web exec playwright test \
  tests/e2e/specs/dashboard-home-mount.spec.ts --workers=1 \
  --grep 'sample task runs on the real chain'
```

Both runs produced one successful DBOS workflow but remained on `/dashboard`
instead of navigating to the expected result URL:

- branch: `ui-journey.ts:238`, 1 failed in 1.1m;
- base: `ui-journey.ts:241`, 1 failed in 1.1m.

The post-run query was:

```sql
select count(*)
from dbos.workflow_status s
where s.status = 'PENDING'
  and exists (
    select 1
    from dbos.workflow_events e
    where e.workflow_uuid = s.workflow_uuid
      and e.key = 'pending-structured-decision'
  );
```

| Run | Workflow status | Pending structured-decision runs |
| --- | --- | --- |
| Branch DB `meiye_be1_dbos_playwright_4101_44373` | `SUCCESS=1` | **0** |
| Base DB `meiye_be1_dbos_playwright_4101_49207` | `SUCCESS=1` | **0** |

This satisfies the T44 DBOS hard check. The identical result-page navigation
failure is a pre-existing dashboard projection/navigation defect, not a
pending semantic decision and not a T44 regression.

## Package gates

```text
pnpm --filter @meiye/core test
2182 tests / 2172 pass / 0 fail / 10 skipped, 290938ms

pnpm --filter @meiye/core typecheck
exit 0

pnpm --filter @meiye/web typecheck
exit 0

git diff --check
exit 0
```

The skipped tests are explicit live-provider or isolated-service opt-ins; T44
did not add skips. The working tree after recording this report contains only
this report plus the pre-existing untracked local `lane.env`.
