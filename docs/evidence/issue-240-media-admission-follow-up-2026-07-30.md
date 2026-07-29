# Issue 240 Media Admission Follow-up

Date: 2026-07-30

Scope: the controller-assigned P0-1 start-failure classification and P0-2
fixture frozen-route compatibility follow-up on local branch
`issue/240-d153`. This is local evidence. It is not push, merge, deployment,
live-provider, or production proof.

Final validation fixed point: `main@002cd409`, branch `HEAD@383ed0d0`
(`0` behind, `1` ahead before this evidence-only commit).

## Changes

- Harness start failures now terminate only for the permanent immutable-request
  codes `REQUEST_FINGERPRINT_CONFLICT` and
  `EXECUTION_SNAPSHOT_MISMATCH`.
- `FROZEN_ROUTE_MISMATCH`, `FROZEN_REQUEST_MISSING`, and unknown failures remain
  recoverable. The pre-admission `taskBelongsToWorkspace` inference was removed.
- Local fixture media routes now carry an explicit inferred modality profile on
  the frozen execution candidate. Existing deployment fingerprints and
  production capability profiles are unchanged.
- The route acceptance test proves that an explicit image profile is eligible
  without consulting the platform-default fallback.

The two recorded P1 items (billing compensation conflict and pending-start
polling race) were not changed.

## Verification

| Gate | Result |
| --- | --- |
| Focused Core after final rebase | 27 pass, 0 fail, 0 skip |
| Core typecheck after final rebase | exit 0 |
| Issue 256 changed-path Core tests after final rebase | 2,558 pass, 0 fail, 174 skip (2,732 total) |
| Full Core on the immediately preceding `main@6d1c98df` fixed point | 2,473 pass, 0 fail, 173 skip (2,646 total) |
| Locked `m04 image_text` on `main@ddf6c24a` | 1 pass, 0 fail (run 1: 2.3 min; run 2 after rebase: 2.2 min) |
| Locked `m04 image_text` on `main@6d1c98df` | blocked before media admission: `REQUIRED_EXECUTION_LIMIT_UNSET` for `maxIterations` |

The two green browser runs used the isolated real PostgreSQL database
`meiye_issue240_d153`, the credential-free fixture runtime, the production
Core/worker/Web/Canvas assembly, and the absolute shared E2E lock. They covered
submission, the note-direction decision, delivery, adoption, package download,
and refresh restore.

After Issue 255 entered `main`, the same browser command stops before frozen
media routing. Issue 255's committed calibration decision sets only
`maxIterations` and explicitly leaves required `maxCostCents` and
`maxWallClockMs` unset; its controller receipt also keeps live authorization
at NO. This follow-up therefore does not invent boundary values to manufacture
a green browser result.

## Legacy request audit and waiver strategy

Read-only audit of the current local business database found:

| Legacy class | Count |
| --- | ---: |
| Requests with an execution snapshot | 461 |
| Requests missing `frozenRouteSnapshot` | 425 |
| Missing-route requests delivered terminally | 364 |
| Missing-route requests failed terminally | 57 |
| Missing-route requests still nonterminal under the current active-task filter | 4 |
| Missing-route requests containing route-like deployment/candidate/capability material | 0 |

No automatic backfill is safe: resolving the current catalog for a historical
request would manufacture a route that was never frozen and would make replay
non-deterministic.

The fail-closed waiver is:

1. Keep the 364 delivered and 57 failed rows immutable and read-only. They may
   be waived from replay because terminal evidence already exists, but their
   historical request payloads must not be rewritten.
2. Treat the four nonterminal rows as a release blocker. An operator must
   explicitly cancel each task, verify refund or durable compensation truth,
   and ask the merchant to resubmit so the new request receives a real frozen
   route.
3. Enable replay only after the same read-only audit reports zero active legacy
   rows. Preserve the classified counts and query result with the release
   evidence.

## Commands

```bash
pnpm --filter @meiye/core exec node --import tsx --test \
  src/p1/execution-spine/creation-stage-port.test.ts \
  src/p1/model-supply/production-frozen-route.test.ts \
  src/p1/model-supply/runtime-config.test.ts \
  src/p1/model-supply/runtime-assembly.test.ts
pnpm --filter @meiye/core typecheck

changed_tests=(${(f)"$(git diff --name-only 6d1c98df..main |
  rg '^apps/core/src/.+\.test\.ts$' |
  sed 's#^apps/core/##')"})
pnpm --filter @meiye/core exec node --import tsx --test $changed_tests
```

Browser gate:

```bash
PORT=3245 PLAYWRIGHT_CORE_PORT=4245 PLAYWRIGHT_CANVAS_PORT=4345 \
TEST_DATABASE_URL='<isolated-local-postgres-url>' \
/Users/bin/Desktop/开发/内容无人区/美业内容2/.scratch/orca-run-2026-07-25/e2e-lock.sh \
pnpm --filter @meiye/web e2e \
tests/e2e/specs/m04-browser-hard-gate.spec.ts \
--grep 'image_text →' --reporter=list
```

No provider credential, paid probe, or `RUN_LIVE_*` flag was used.
