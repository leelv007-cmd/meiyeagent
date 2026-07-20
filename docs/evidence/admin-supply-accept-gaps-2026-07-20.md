# Z2-ACCEPT gap list — same-increment AP + MP (#128)

**Date:** 2026-07-20  
**Ticket:** #128 / `ticket/128-z2-accept`  
**Discipline:** honest gaps only — no silent degrade of acceptance claims.  
**Recorded/fake gates in this commit are green; items below remain env-gated or not yet landed.**

## Five gates status

| # | Gate | Recorded / unit status | Live / env status |
|---|------|------------------------|-------------------|
| 1 | Capability skeleton completion (inventory + D-051 six-question + drilldown + exceptions aggregable) | **GREEN** — `packages/contracts` inventory + `mkfast-template-main/src/p1/z2-accept-ap.test.tsx` | N/A (pure projection) |
| 2 | Tri-modal dual-channel + story 30 main chain (procurement→publish→allocate→task→ledger→audit) | **GREEN** — `apps/core/src/p1/z2-accept/z2-accept.test.ts` recorded/fake | **GAP** live I4 matrix (see below) |
| 3 | Publish gate: <2 qualified Deployments cannot mark multi-channel ready; single-channel no-fallback labeled | **GREEN** — core `publish-gate.ts` + admin supply overview SSR | **GAP** merchant user-selection page label (see below) |
| 4 | D-048 interaction ban on ops main paths (no code/SQL/env/raw JSON/CLI) | **GREEN** — catalog / exception home / supply SSR unit assertions | **GAP** Playwright four-service e2e (see below) |
| 5 | Gap list on disk (this file) | **GREEN** | — |

**Same-increment rule (D-080 C3):** AP skeleton and MP vertical are not separately claimable. Recorded gates green ≠ live C5 claim.

---

## Explicit gaps (must not be claimed complete)

### G-LIVE-I4 — MP-08 fault-injection live matrix (#119 I4 not on main)

| Field | Value |
|-------|--------|
| Status | **open** |
| Why | I4 (`ticket/119-i4-fault-injection`) has not landed independent fault-injection suite + protected `provider-live` workflow on `main` at accept time. |
| Required for C5 claim | Per core operation: ≥2 independent fault-domain `live_verified` Deployments; four scenarios: pre-accept failover, accepted/acceptance_unknown no re-submit, isolate/drain without restart, RouteSnapshot + dual ledger replay. |
| Evidence expected | `live-*.integration.test.ts` env-gated + manual/scheduled provider-live workflow (secrets + cost cap). |
| Recorded substitute | Story 30 recorded chain + MP-04T/I/V fake dual-channel conformance + publish-gate negative tests. |
| Claim allowed today | **Recorded dual-channel readiness only** — not production multi-channel live readiness. |

### G-LIVE-TEXT / IMAGE / VIDEO — live dual-channel credentials

| Field | Value |
|-------|--------|
| Status | **open / env-gated** |
| Why | Live probes require ARK + tuzi secrets under `docs/_private/` / root `.env` (gitignored). CI `core-persistence` does not run provider live matrix. |
| Models (handoff matrix) | Text: `doubao-seed-2-0-mini-260428` + `gemini-3-flash-preview`; Image: Seedream 5.0 + Seedream 4.5 via tuzi; Video: Seedance 1.5 both channels (shared manufacturer → **channel-level only**, not manufacturer-independent). |
| Claim allowed today | Live optional when env open; default suite skips live. |

### G-UI-MERCHANT-NO-FALLBACK — user selection page single-channel label

| Field | Value |
|-------|--------|
| Status | **open** |
| Why | Admin supply overview labels `单渠道 / 无回退` (gate 3 admin end **green**). Merchant-facing model selection / composer surface does **not** yet project `single-channel` / `no-fallback` badges from supply readiness. |
| Dual-end requirement (D-069) | User selection page **and** admin must both label single-channel / no-fallback. |
| Mitigation | Gap explicit; do not claim dual-end complete until product selection surface wires `projectDualChannelCoverage` (or equivalent readiness projection). |
| Related | J4 admin end done; product selection is #83 journey surface — coordinate, do not silent-fake. |

### G-E2E-PLAYWRIGHT-D048 — four-service Playwright ops path

| Field | Value |
|-------|--------|
| Status | **open** |
| Why | Spec Testing §5 calls for Playwright e2e: exception home → drilldown → safe action → audit loop with D-048 ban. Current gate 4 is SSR/unit HTML scan of catalog, exception home, and supply control (sufficient for pure-model ban). |
| Claim allowed today | Unit/SSR D-048 ban **green**; full interactive e2e still pending harness time + four-service boot. |

### G-J5 — credentials simulator / governed shortcuts UI

| Field | Value |
|-------|--------|
| Status | **partial / not independently claimed** |
| Why | J5 (`#125`) may still be landing; accept suite does not depend on J5-only surfaces. Story 30 credential step uses domain lifecycle (create → test → activate) in core, not J5 UI. |
| Impact on #128 | Not a silent pass — credentials UI polish is out of recorded story 30 path. |

---

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

# Web AP gates (skeleton + D-048 + dual-end admin labels)
pnpm --filter @meiye/web exec tsx --test src/p1/z2-accept-ap.test.tsx

# Optional live (requires secrets; not default green)
# PROVIDER_LIVE=1 pnpm --filter @meiye/core test -- live-text-conformance...
```

## Sign-off rule

- **May claim:** same-increment **recorded acceptance harness** complete for #128.
- **May not claim:** production C5 live dual-channel multi-channel ready; dual-end merchant no-fallback label; Playwright four-service D-048 e2e — until corresponding gaps close and this file is updated.
