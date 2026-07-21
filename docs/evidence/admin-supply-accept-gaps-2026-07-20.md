# Z2-ACCEPT gap list — same-increment AP + MP (#128)

**Date:** 2026-07-21 (refreshed after Wave 0/1 review remediations)  
**Ticket:** #128 / `leelv007-cmd/issue-128-z2-accept-ap`  
**Discipline:** honest gaps only — no silent degrade of acceptance claims.  
**Recorded/fake gates and D-048 Playwright are green; only G-LIVE-* remains env-gated.**

## Five gates status

| # | Gate | Recorded / unit status | Live / env status |
|---|------|------------------------|-------------------|
| 1 | Capability skeleton completion (inventory + D-051 six-question + drilldown + exceptions aggregable) | **GREEN** — `packages/contracts` inventory + `mkfast-template-main/src/p1/z2-accept-ap.test.tsx` | N/A (pure projection) |
| 2 | Tri-modal dual-channel + story 30 main chain (procurement→publish→allocate→task→ledger→audit) | **GREEN** — `apps/core/src/p1/z2-accept/z2-accept.test.ts` recorded/fake | **GREEN** unit matrix on main; **GAP** live env-gated (see below) |
| 3 | Publish gate: <2 qualified Deployments cannot mark multi-channel ready; single-channel no-fallback labeled | **GREEN** — core `publish-gate.ts` + admin supply overview SSR + composer merchant select labels | **GREEN** dual-end label projection (admin + composer); not a live C5 claim |
| 4 | D-048 interaction ban on ops main paths (no code/SQL/env/raw JSON/CLI) | **GREEN** — catalog / exception home / supply SSR unit assertions | **GREEN** — four-service Playwright 3/3 (2026-07-21; see below) |
| 5 | Gap list on disk (this file) | **GREEN** | — |

**Same-increment rule (D-080 C3):** AP skeleton and MP vertical are not separately claimable. Recorded gates green ≠ live C5 claim. **#128 whole package is not claimable complete while any G-LIVE / dual-end / Playwright gap remains open.**

---

## Explicit gaps (must not be claimed complete)

### G-LIVE-I4 — MP-08 fault-injection live matrix (unit matrix on main; live env-gated)

| Field | Value |
|-------|--------|
| Status | **open** |
| Why | I4 unit matrix + `.github/workflows/provider-live.yml` are on main; live runs still require `RUN_PROVIDER_LIVE_FAULT_INJECTION=1` + secrets + cost cap. |
| Required for C5 claim | Per core operation: ≥2 independent fault-domain `live_verified` Deployments; four scenarios: pre-accept failover, accepted/acceptance_unknown no re-submit, isolate/drain without restart, RouteSnapshot + dual ledger replay. |
| Evidence expected | `live-*.integration.test.ts` env-gated + manual/scheduled provider-live workflow (secrets + cost cap). |
| Recorded substitute | Story 30 recorded chain + MP-04T/I/V fake dual-channel conformance + publish-gate negative tests + unit matrix with same-CatalogModel honesty (F-I-01). |
| Claim allowed today | **Recorded dual-channel readiness only** — not production multi-channel live readiness. |

### G-LIVE-TEXT / IMAGE / VIDEO — live dual-channel credentials

| Field | Value |
|-------|--------|
| Status | **open / env-gated** |
| Why | Live probes require ARK + tuzi secrets under `docs/_private/` / root `.env` (gitignored). CI `core-persistence` does not run provider live matrix. |
| Models (handoff matrix) | Text: `doubao-seed-2-0-mini-260428` + `gemini-3-flash-preview`; Image: Seedream 5.0 + Seedream 4.5 via tuzi; Video: Seedance 1.5 both channels (shared manufacturer → **channel-level only**, not manufacturer-independent). |
| Unit honesty note | F-I-01 FIXED: unit `dualChannelReady=true` now requires same `catalogModelId` + distinct channel kinds; text/image handoff cross-model pairs report honest `false` / `channelMatrixAligned=false`. |
| Claim allowed today | Live optional when env open; default suite skips live. |

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
- Manufacturer-independent dual supply for video when both channels are Seedance — channel-level only is the honest claim (handoff).

---

## How to re-run gates

```bash
# Core MP gates (story 30 + publish gate)
pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 \
  src/p1/z2-accept/z2-accept.test.ts

# Web AP gates (skeleton + D-048 + dual-end admin/merchant labels)
pnpm --filter @meiye/web exec tsx --test src/p1/z2-accept-ap.test.tsx

# Four-service interactive D-048 gate
pnpm --filter @meiye/web exec playwright test \
  tests/e2e/specs/admin-supply-ops.spec.ts --project=chromium --workers=1

# Optional live (requires secrets; not default green)
# RUN_PROVIDER_LIVE_FAULT_INJECTION=1 pnpm --filter @meiye/core test -- ...

# Optional Playwright four-service (not default CI green)
# pnpm --filter @meiye/web e2e -- tests/e2e/specs/admin-supply-ops.spec.ts
```

## Sign-off rule

- **May claim:** same-increment **recorded acceptance harness** complete for #128.
- **May not claim:** production C5 live dual-channel multi-channel ready or whole-package #128 complete while G-LIVE-* remains open.
