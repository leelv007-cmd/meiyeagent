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
- Hook: `PROVIDER_LIVE_CONFORMANCE_HOOK_COMMAND`, `PROVIDER_LIVE_EXTERNAL_EVIDENCE_PATH`, `PROVIDER_LIVE_FAULT_INJECTOR_MAX_COST_USD`
- Six channels: ARK/MODEL_DIRECT/TUZI keys + `*_PROVIDER_ACCOUNT_IDENTITY` + `*_MAX_PROBE_COST_USD` + media asset hosts

## Product decisions required before code can dualChannelReady text/image

1. Text: same CatalogModel on both channels **or** explicit de-scope multi-channel claim
2. Image: bind reseller to same CatalogModel (prefer existing seedream tuzi relay)
3. Video: keep channel-level claim; manufacturer-independent needs third vendor

## Run when secrets + hook ready

```bash
export RUN_PROVIDER_LIVE_FAULT_INJECTION=1
export PROVIDER_LIVE_REQUIRE_ALL=1
export PROVIDER_LIVE_COST_CAP_USD=1.0
# … map secrets from docs/_private (never commit) …
pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 \
  src/p1/model-supply/provider-conformance/live-fault-injection.integration.test.ts
```

Or GitHub Environment `provider-live` → workflow_dispatch → attach `provider-live-gate.json`.

## Non-claims

- Six paid probes alone ≠ multi-channel ready (need lifecycle + transport injector evidence)
- Do not forge same catalogModelId across different models
- #128 whole-package complete still blocked by G-LIVE-* + G-E2E-PLAYWRIGHT-D048 + #92

## Shortest path

1. Product: text/image CM alignment decision  
2. Code: matrix-models + fakes match decision  
3. Ops: secrets + cost cap  
4. Eng: real hook → external JSON  
5. Run live gate → only then update G-LIVE-* closed
