# #119 I4 Live Fault Injection — Unblock Checklist

> Status: **external_blocked**. Unit/recorded green ≠ C5 live complete.
> Authority: D-069 / D-080 C5 · gap `docs/evidence/admin-supply-accept-gaps-2026-07-20.md` G-LIVE-*.

## Already green (may claim)

- Unit MP-08 matrix + F-I-01 same-CatalogModel honesty
- Publish-gate negatives (&lt;2 domains cannot multi-channel ready)
- Live gate fail-closed without external evidence
- Workflow skeleton `.github/workflows/provider-live.yml`

## Structural blockers (not “missing a key”)

| Modality | CatalogModel alignment | Note |
|---|---|---|
| Text | **misaligned** | official doubao-seed-mini vs reseller gemini-flash |
| Image | **misaligned** | official seedream-5-pro vs reseller gpt-image-2 (catalog already has seedream tuzi relay unused) |
| Video | **aligned** | seedance-1-5-pro both; **channel_level only** (shared manufacturer) |

## Required env (names only)

- Master: `RUN_PROVIDER_LIVE_FAULT_INJECTION=1`, `PROVIDER_LIVE_COST_CAP_USD`, `PROVIDER_LIVE_REQUIRE_ALL`
- Hook: `PROVIDER_LIVE_CONFORMANCE_ENDPOINT`, `PROVIDER_LIVE_CONFORMANCE_TOKEN`, `PROVIDER_LIVE_CONFORMANCE_HOOK_SHA256`, `PROVIDER_LIVE_EXTERNAL_EVIDENCE_PATH`, `PROVIDER_LIVE_FAULT_INJECTOR_MAX_COST_USD`
- Cost normalization: `PROVIDER_LIVE_CNY_PER_USD`, `PROVIDER_LIVE_FX_EVIDENCE_REF`, all provider `*_COST_*` price variables
- Run binding: CI sets `PROVIDER_LIVE_RUN_NONCE`; local runs must export a fresh unique value too
- Six channels: ARK/MODEL_DIRECT/TUZI keys + `*_PROVIDER_ACCOUNT_IDENTITY` + `*_MAX_PROBE_COST_USD` + media asset hosts

The hook output JSON must contain channel-bound `lifecycleEvidence` and
`transportFaultEvidence` for all three core operations, plus one real
`secondaryProbes` entry for each of `copy.adapt`, `text.respond`, and
`image.edit`, and `costEvidence` that reconciles actual secondary/lifecycle/
fault-injection spend. Every entry must carry the current run nonce and fresh
timestamps. Secondary probes may bind to either configured channel, but each
must have its own task, idempotency request, request payload, and result hashes;
copying a core probe or declaring a status is not accepted. The hook command
must reference a checked-in `scripts/provider-live/` runner whose file SHA-256
matches the protected secret.

Set `PROVIDER_LIVE_CONFORMANCE_HOOK_SHA256` to the output of
`shasum -a 256 scripts/provider-live/run-conformance.mjs`.

## Product decisions required before code can dualChannelReady text/image

1. Text: approve one audited cross-channel model mapping, then update the checked-in matrix mapping and alignment flag; equal env IDs alone stay fail-closed
2. Image: approve and check in the reseller mapping (prefer existing seedream tuzi relay); equal env IDs alone stay fail-closed
3. Video: keep channel-level claim; manufacturer-independent needs third vendor

## Run when secrets + hook ready

```bash
export RUN_PROVIDER_LIVE_FAULT_INJECTION=1
export PROVIDER_LIVE_REQUIRE_ALL=1
export PROVIDER_LIVE_COST_CAP_USD=1.0
export PROVIDER_LIVE_RUN_NONCE="local-$(date +%s)-$RANDOM"
export PROVIDER_LIVE_CONFORMANCE_ENDPOINT="https://<protected-service>/provider-live"
export PROVIDER_LIVE_CONFORMANCE_TOKEN="<protected-token>"
export PROVIDER_LIVE_EXTERNAL_EVIDENCE_PATH="apps/core/provider-live-evidence/external-conformance.json"
export PROVIDER_LIVE_FAULT_INJECTOR_MAX_COST_USD="0.1"
# … map secrets from docs/_private (never commit) …
node scripts/provider-live/run-conformance.mjs
test -s "${PROVIDER_LIVE_EXTERNAL_EVIDENCE_PATH}"
pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 \
  src/p1/model-supply/provider-conformance/live-fault-injection.integration.test.ts
```

Or GitHub Environment `provider-live` → workflow_dispatch → attach `provider-live-gate.json`.

## Non-claims

- Six paid probes alone ≠ multi-channel ready (need lifecycle + transport injector evidence)
- Before any paid call, the sum of per-call reservations must fit the run
  ceiling and every required unit-price input must be positive. After each
  call, its reported actual cost must fit that call's reservation, and the run
  total is reconciled afterward. This gate does not claim a transactional,
  real-time provider-side cutoff.
- Do not forge equal catalogModelId env values across different provider models;
  alignment requires a reviewed checked-in matrix mapping
- #128 whole-package complete still blocked by G-LIVE-* + G-E2E-PLAYWRIGHT-D048 + #92

## Shortest path

1. Product: text/image CM alignment decision  
2. Code: matrix-models + fakes match decision  
3. Ops: secrets + cost cap  
4. Eng: real hook → external JSON (core lifecycle/transport + three secondary probes)
5. Run live gate → only then update G-LIVE-* closed
