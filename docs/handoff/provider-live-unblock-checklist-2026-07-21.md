# #119 Official Provider Connectivity — Unblock Checklist

> Status: **verified_current** through `2026-07-23T09:33:07.321Z`. An authorized local run bound to commit `63a0be856d9e81d461901ca3b93691bcc74c3611` satisfied the #119 completion rule.
> Authority: revised D-069 / D-080 C5 · gap `docs/evidence/admin-supply-accept-gaps-2026-07-20.md` G-LIVE-*.

## Latest authorized acceptance receipt

| Field | Verified value |
|---|---|
| Completed / expires | `2026-07-22T09:33:07.321Z` / `2026-07-23T09:33:07.321Z` |
| Release / environment | `63a0be856d9e81d461901ca3b93691bcc74c3611` / `local-authorized` |
| Configuration revision | `ark-primary-cny-20260722-r3` |
| Redacted artifact SHA-256 | `1a5be3d39ec7673fb3ca71f9d2bbdbcc01399f01eb88e041838aedf869286c6e` |
| Cost | `CNY 1.2355202` actual / `CNY 5` cap |
| Text | `live_verified`; non-empty result, 1,425 bytes, SHA-256 present |
| Image | `live_verified`; downloaded PNG, 2,476,010 bytes, SHA-256 present |
| Video | `live_verified`; downloaded MP4, 1,130,848 bytes, SHA-256 present |
| Gate result | `blockedChecks=[]`; `skippedOperations=[]`; all three publish gates `single_channel / no_fallback`, `publishAllowed=true` |

The raw redacted artifact remains ignored at `apps/core/provider-live-evidence/provider-live-gate.json`; this receipt intentionally omits provider task references and credentials. Re-run the gate after expiry before consuming it for a later release candidate.

## Release gate

Text, image, and video must each complete one real official-provider generation:

| Modality | Official model | Required result |
|---|---|---|
| Text | `doubao-seed-2-0-mini-260428` | Accepted provider task with non-empty input/output usage and usable text |
| Image | `doubao-seedream-5-0-260128` | Accepted task, restart recovery, completed poll, downloaded non-empty image and SHA-256 |
| Video | `doubao-seedance-2-0-mini-260615` | Accepted task, restart recovery, completed poll, downloaded playable media and SHA-256 |

The protected workflow pins the public Seedance model ID above; changing it requires a reviewed workflow revision rather than an untracked secret edit.

All three publish as `live_verified`. Without a second channel they must also remain `single_channel / no_fallback`, with `dualChannelReady=false` and `fallbackAvailable=false` wherever those fields are projected.

Token validation, an HTTP 200, recorded evidence, fixtures, or unit tests do not satisfy this gate. The production adapter must create a real provider task and retrieve its result.

## Required protected environment

- Master: `RUN_PROVIDER_LIVE_CONNECTIVITY=1`, `PROVIDER_LIVE_ACCEPTANCE_MODE=primary_connectivity`, `PROVIDER_LIVE_REQUIRE_ALL=1`, `PROVIDER_LIVE_COST_CAP_CNY`, `PROVIDER_LIVE_RUN_NONCE`, `PROVIDER_LIVE_RELEASE_REF`, `PROVIDER_LIVE_CONFIG_REVISION`
- Official credentials: `ARK_TEXT_API_KEY` or `ARK_API_KEY`, plus `ARK_PROVIDER_ACCOUNT_IDENTITY`
- Models: `ARK_TEXT_MODEL`, `ARK_SEEDREAM_MODEL`, `ARK_SEEDANCE_MODEL`
- Catalog binding: `ARK_TEXT_CATALOG_MODEL_ID`, `ARK_IMAGE_CATALOG_MODEL_ID`, `ARK_VIDEO_CATALOG_MODEL_ID`
- Per-probe reservations: `ARK_TEXT_MAX_PROBE_COST_CNY`, `ARK_IMAGE_MAX_PROBE_COST_CNY`, `ARK_VIDEO_MAX_PROBE_COST_CNY`
- Official CNY prices: `ARK_TEXT_INPUT_COST_PER_MILLION`, `ARK_TEXT_OUTPUT_COST_PER_MILLION`, `ARK_SEEDREAM_COST_PER_IMAGE_CNY`, `ARK_SEEDANCE_COST_PER_MILLION_TOKENS_CNY`, `ARK_SEEDANCE_ESTIMATED_TOKENS_PER_SECOND`
- Optional USD-channel conversion: only a future enabled USD-priced secondary channel needs `PROVIDER_LIVE_CNY_PER_USD` and `PROVIDER_LIVE_FX_EVIDENCE_REF`; the official-only release workflow does not.
- Media allowlist: `ARK_MEDIA_ASSET_SOURCE_HOSTS`

Secrets belong in the protected GitHub Environment `provider-live`; never commit them or paste their values into tickets, documents, logs, or chat.

## Cost and evidence invariants

- Every required unit price and per-probe reservation must be finite and positive.
- Official unit prices, per-probe reservations, the run-level cap, and reported totals are all denominated in CNY.
- The sum of the three probe reservations must fit `PROVIDER_LIVE_COST_CAP_CNY` before any paid call starts.
- Reported actual cost must fit each reservation and the run-level cap.
- Each artifact binds the current commit, protected environment, model and CatalogModel revision, provider task reference, run nonce, timestamps, result hash, and actual cost.
- Evidence has an explicit expiry; the protected workflow currently uses `PROVIDER_LIVE_EVIDENCE_TTL_SECONDS=86400`.
- Failed runs still upload a redacted `apps/core/provider-live-evidence/provider-live-gate.json`; they do not become release evidence.

## Run

Use GitHub Environment `provider-live` and dispatch `.github/workflows/provider-live.yml`. For an authorized local run, export the same protected variables and a fresh nonce, then run:

```bash
export RUN_PROVIDER_LIVE_CONNECTIVITY=1
export PROVIDER_LIVE_ACCEPTANCE_MODE=primary_connectivity
export PROVIDER_LIVE_REQUIRE_ALL=1
export PROVIDER_LIVE_COST_CAP_CNY=5.0
export PROVIDER_LIVE_RUN_NONCE="local-$(date +%s)-$RANDOM"
export PROVIDER_LIVE_RELEASE_REF="$(git rev-parse HEAD)"
export PROVIDER_LIVE_ENVIRONMENT="local-authorized"
export PROVIDER_LIVE_CONFIG_REVISION="<reviewed-config-revision>"
export PROVIDER_LIVE_EVIDENCE_TTL_SECONDS=86400

pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 \
  src/p1/model-supply/provider-conformance/live-fault-injection.integration.test.ts
test -s apps/core/provider-live-evidence/provider-live-gate.json
```

The filename remains compatible with the existing integration suite; in `primary_connectivity` mode it does not require the external transport-fault hook.

## Non-blocking dual-channel evidence

The existing same-CatalogModel matrix, independent fault-domain checks, secondary probes, lifecycle evidence, and transport fault injector remain valid hardening work. They are required only before claiming `multi-channel ready` or automatic fallback; they do not block the current single-channel release.

Do not forge equal CatalogModel IDs. Text/image matrix misalignment must continue to report `dualChannelReady=false`.

## Completion rule

Close the live connectivity gap only when all three official probes are current and green, `blockedChecks=[]`, `skippedOperations=[]`, each publish gate is `single_channel` with `publishAllowed=true`, and the evidence artifact is bound to the release commit.
