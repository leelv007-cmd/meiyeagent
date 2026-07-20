# V1 real-chain validation log

## Final hard gate

From `mkfast-template-main`:

```sh
TEST_DATABASE_URL=postgres://meiye:meiye@127.0.0.1:54329/meiye_review_v1_final8_20260719 \
TEST_DBOS_SYSTEM_DATABASE_URL=postgres://meiye:meiye@127.0.0.1:54329/meiye_review_v1_final8_dbos_20260719 \
PORT=3441 \
PLAYWRIGHT_CORE_PORT=4441 \
PLAYWRIGHT_CANVAS_PORT=4541 \
pnpm exec playwright test \
  tests/e2e/specs/uiux-day0-contract.spec.ts \
  --project=chromium
```

Result after the final Standards/Spec fixes: `5 passed (57.0s)`.

The run used one Playwright worker, a fresh Web/Core/Canvas port set, an
isolated business database, a separately derived DBOS database, and a unique
Core queue prefix. Product HTTP and SSE calls used the real Web → Core →
Harness/DBOS path; only the provider boundary used the E2E fixture runtime.
The final run emitted no workspace provisioning, grant-ledger cleanup, or
workspace-not-found domain errors. Existing Vite route-file naming and
`NO_COLOR` warnings remained non-failing startup warnings.

## Failures fixed before the final run

| Run | Evidence | Fix verified by the final run |
| --- | --- | --- |
| 1 | `4 failed, 1 passed`: `workspace_provisioning_outbox.claim_token` was absent from a database that had already applied the earlier `0005` body. | Forward-only `0006_workspace_provision_claim_fencing.sql` plus a migration contract test. |
| 2 | `3 failed, 2 did not run`: E2E platform defaults were not explicitly configured; cleanup deleted a workspace while grant-lot transactions still referenced its lots. | E2E-only complete default-model configuration with production fail-closed behavior; cleanup order now removes redemption references, transactions, and lots first. |
| 3 | `4 passed, 1 failed`: the canonical assertion expected two fields outside the documented strict metric privacy boundary. | Response discrimination now uses the stable idempotency prefix and the actual strict path/time/count contract. |
| 4 | `5 passed`, but teardown logged one late model settlement against an already deleted workspace. | Cleanup waits for Foundation generation jobs to reach a 500 ms quiescent terminal window; late work resets the window and timeout remains fail-closed. |

## Screenshot evidence

- `before/manifest.json`: 8 named stations, generated from detached
  `main@05e99eed7c0628537d405d16bcc1535a09ed3590`.
- `after/manifest.json`: the same 8 named stations, generated at
  `2026-07-19T11:51:32.134Z` from the persistent after stack.
- Both station sets contain exactly 8 non-empty PNG files (16 total).

## Post-critique browser verification

The refreshed after tour completed all eight stations. A separate healthy
390×844 browser session then loaded all three persisted candidates, adopted the
first candidate, switched to the second candidate, and observed the final
states `first=false` and `second=true`. The session emitted zero browser console
errors, zero `Maximum update depth exceeded` errors, and exposed none of the
removed internal workflow terms. The resulting state is captured in
`mobile-candidate-switch.png`.
