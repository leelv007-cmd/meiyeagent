# Z2-ACCEPT gap list — same-increment AP + MP (#128)

**Date:** 2026-07-23 (refreshed after single-channel local completion audit)
**Ticket:** #128 / `leelv007-cmd/issue-128-z2-accept-ap`  
**Discipline:** honest gaps only — no silent degrade of acceptance claims.  
**Recorded/fake gates and D-048 Playwright are green; only G-LIVE-* remains env-gated.**

## Five gates status

| # | Gate | Recorded / unit status | Live / env status |
|---|------|------------------------|-------------------|
| 1 | Capability skeleton completion (inventory + D-051 six-question + drilldown + exceptions aggregable) | **GREEN** — `packages/contracts` inventory + `mkfast-template-main/src/p1/z2-accept-ap.test.tsx` | N/A (pure projection) |
| 2 | Tri-modal official-channel connectivity + story 30 main chain (procurement→publish→allocate→task→ledger→audit) | **GREEN** — `apps/core/src/p1/z2-accept/z2-accept.test.ts` recorded/fake | **GAP** three official live probes remain env-gated (see below) |
| 3 | Publish gate: <2 qualified Deployments cannot mark multi-channel ready; single-channel no-fallback labeled | **GREEN** — core `publish-gate.ts` + admin supply overview SSR + composer merchant select labels | **GREEN** dual-end label projection (admin + composer); not a live C5 claim |
| 4 | D-048 interaction ban on ops main paths (no code/SQL/env/raw JSON/CLI) | **GREEN** — catalog / exception home / supply SSR unit assertions | **GREEN** — four-service Playwright 3/3 (2026-07-21; see below) |
| 5 | Gap list on disk (this file) | **GREEN** | — |

**Same-increment rule (D-080 C3):** AP skeleton and MP vertical are not separately claimable. Recorded gates green ≠ live C5 claim. **#128 whole package is not claimable complete until all three official-channel G-LIVE probes are current and green.** Dual-channel conformance is non-blocking unless the product claims multi-channel readiness.

---

## Explicit gaps (must not be claimed complete)

### G-LIVE-CONNECTIVITY — official text/image/video real generation

| Field | Value |
|-------|--------|
| Status | **open / live_blocked** (refreshed 2026-07-23 lane-live) |
| Why | `.github/workflows/provider-live.yml` requires protected ARK credentials, model bindings, prices and a cost cap that are not present in the default test environment. |
| Required for C5 claim | `copy.generate`, `image.generate`, and `video.generate` each complete one official production-adapter call and produce current `live_verified` task/result/cost evidence. |
| Evidence expected | `PROVIDER_LIVE_ACCEPTANCE_MODE=primary_connectivity` env-gated integration run + protected workflow artifact bound to the release commit. |
| Recorded substitute | None. Recorded/fake tests remain useful but cannot close live connectivity. Official single-channel fault matrix (`runSingleChannelFaultInjectionMatrix`) is GREEN on fixtures only. |
| Claim allowed today | **Recorded readiness only** until all three official probes run. No multi-channel claim. #119 stays OPEN; do not close #128 from recorded green. |

### G-LIVE-TEXT / IMAGE / VIDEO — official-channel credentials

| Field | Value |
|-------|--------|
| Status | **open / env-gated** |
| Why | Live probes require protected ARK credentials, account identity, model/CatalogModel bindings, price inputs and per-probe reservations. CI `core-persistence` does not spend provider quota. |
| Required models | Text: `doubao-seed-2-0-mini-260428`; Image: `doubao-seedream-5-0-260128`; Video: `doubao-seedance-2-0-mini-260615` (the protected primary-connectivity workflow pins this value). |
| Unit honesty note | F-I-01 FIXED: unit `dualChannelReady=true` now requires same `catalogModelId` + distinct channel kinds; text/image handoff cross-model pairs report honest `false` / `channelMatrixAligned=false`. |
| Claim allowed after green | Each modality may be `live_verified` while remaining `single_channel / no_fallback`; multi-channel readiness remains false. |

### G-UI-MERCHANT-NO-FALLBACK — user selection page single-channel label

| Field | Value |
|-------|--------|
| Status | **closed (code)** — 2026-07-21 Agent Team fix |
| Why (was) | Admin supply overview labels `单渠道 / 无回退` (gate 3 admin end **green**). Merchant-facing model selection / composer surface did not project badges. |
| Dual-end requirement (D-069) | User selection page **and** admin must both label single-channel / no-fallback. |
| Landed | Admin: supply overview + model-settings badge. Merchant: Composer primary `catalogModel` select options + selected readiness line (`composer-home.tsx`, `data-channel-readiness`, same paraglide keys as ModelCardPicker). Static gate: `composer-channel-readiness.static.test.ts`. |
| Related | F-J-01 closed on merchant select path; full ModelCardPicker card UI still optional polish. |
| Claim allowed today | Dual-end single-channel / no-fallback **label projection** on merchant composer select + admin. Not a live C5 claim. |

### G-E2E-PLAYWRIGHT-D048 — four-service Playwright ops path

| Field | Value |
|-------|--------|
| Status | **closed / verified** — 2026-07-21 Agent Team four-service Playwright 3/3 |
| Why | Spec Testing §5 calls for Playwright e2e: exception home → drilldown → safe action → audit loop with D-048 ban. Unit/SSR gate 4 already green. |
| Landed | `admin-supply-ops.spec.ts` asserts exact D048 testids + `data-ops-control` + one-click-repair on exception/supply/dialog/audit surfaces (aligned with catalog-model SSOT). The exception-first home wait now allows its two live sources to settle without weakening any product assertion. |
| Proof | `PORT=30128 PLAYWRIGHT_CORE_PORT=41128 PLAYWRIGHT_CANVAS_PORT=42128 TEST_DATABASE_URL=postgres://meiye:meiye@127.0.0.1:54329/meiye_issue128 pnpm --filter @meiye/web exec playwright test tests/e2e/specs/admin-supply-ops.spec.ts --project=chromium --workers=1` → **3 passed (59.2s)**. |
| Remaining | None for G-E2E-PLAYWRIGHT-D048. This does not clear G-LIVE-*. |
| Claim allowed today | D-048 unit/SSR and four-service interactive ops-path acceptance **green**. |

### G-J5 — credentials simulator / governed shortcuts UI

| Field | Value |
|-------|--------|
| Status | **landed on main (not a blocking accept red)** |
| Why | J5 surfaces present: `admin-provider-credential-control`, supply credential panel, route simulator panel, governed actions panel. Story 30 credential step uses domain lifecycle (create → test → activate) in core; accept suite does not treat J5 polish as a silent gate pass. |
| Impact on #128 | No longer an independent open gap for recorded harness sign-off. |

---

## Code-side notes (2026-07-21 review remediations)

- Wave 0/1 + P2 code fixes landed on branch `fix/admin-supply-review-findings-2026-07-21` (F-G-01..05, F-S2-01..03, F-I-03). These do **not** close any G-LIVE-* item.
- F-I-01 (`dualChannelReady` same-CatalogModel unit honesty) is **FIXED** in code (`fault-injection/matrix.ts` same-CatalogModel gate).
- G-UI-MERCHANT-NO-FALLBACK **closed (code)** — composer primary model select projects channel readiness (2026-07-21 Agent Team).
- G-E2E-PLAYWRIGHT-D048 is **closed / verified** (four-service Playwright 3/3).
- ProductUsage bilateral bridge residual is **closed / code + PostgreSQL verified** — durable reserve → freeze → fresh-instance read/replay evidence is recorded in `docs/evidence/product-usage-residual-2026-07-21.md`.
- **G-LIVE-\*** remains the only open blocker for whole-package #128 completion.

## What is explicitly **not** a gap

- Audio modality out of supply v1 (`generation_audio` = `not_in_scope_for_supply_v1`) — inventory stub retained (D-051/D-068).
- Cloudflare GraphQL analytics broker — out of scope (D-080 C3).
- Incident ack/assign workflow — out of scope (D-080 C1); exception home is read-only.
- Dual-channel CatalogModel alignment or fault injection for the current release — retained as hardening and required only for a future multi-channel claim.

---

## How to re-run gates

```bash
# Core MP gates (story 30 + publish gate)
pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 \
  src/p1/z2-accept/z2-accept.test.ts

# Web AP gates (skeleton + D-048 + dual-end admin/merchant labels)
# Generate the Paraglide imports required by the direct TSX runner first.
pnpm --filter @meiye/web locale:compile
pnpm --filter @meiye/web exec tsx --test \
  src/p1/z2-accept-ap.test.tsx \
  src/product/composer/composer-channel-readiness.static.test.ts

# Four-service interactive D-048 gate
pnpm --filter @meiye/web exec playwright test \
  tests/e2e/specs/admin-supply-ops.spec.ts --project=chromium --workers=1

# Official provider live connectivity (requires protected secrets and spends quota)
# RUN_PROVIDER_LIVE_CONNECTIVITY=1 PROVIDER_LIVE_ACCEPTANCE_MODE=primary_connectivity \
#   pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 \
#   src/p1/model-supply/provider-conformance/live-fault-injection.integration.test.ts

# Optional Playwright four-service (not default CI green)
# pnpm --filter @meiye/web e2e -- tests/e2e/specs/admin-supply-ops.spec.ts
```

## Sign-off rule

- **May claim:** same-increment **recorded acceptance harness** complete for #128.
- **May not claim:** whole-package #128 complete until all three official G-LIVE probes are current and green. Even after that, do not claim multi-channel ready or automatic fallback without separate dual-channel evidence.

## Local live re-run (2026-07-23)

**Status update for G-LIVE-***: authorized local `primary_connectivity` run produced a current artifact bound to
`d6787b292cc12db0fd3ecef738f34b9842262856` (environment `local-authorized`, nonce `local-1784786625-14318`,
cost CNY 1.24 / cap 5, expires `2026-07-24T06:06:25.833Z`). Text/image/video probes accepted; publish gates are
`single_channel` / `publishAllowed=true` / `multiChannelReady=false`.

Redacted acceptance: `docs/evidence/provider-live-local-acceptance-2026-07-23.md`.
Raw gitignored path: `apps/core/provider-live-evidence/provider-live-gate.json` (worktree `wt-provider-live`).

**Still not package-complete for #128:** multi-channel remains false by design; staging/protected workflow upload is separate;
re-run the five Z2 gates on the same increment before closing #128. Do not treat this note as multi-channel or paid-launch readiness.

