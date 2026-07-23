# Provider live local acceptance — 2026-07-23

**Worktree:** `/Users/bin/orca/workspaces/美业内容2/wt-provider-live`  
**Branch:** `lane/provider-live-20260723`  
**Release SHA:** `d6787b292cc12db0fd3ecef738f34b9842262856`  
**Environment:** `local-authorized` (authorized local run using root `.env` ARK credentials)  
**Mode:** `primary_connectivity`  
**Config revision:** `ark-primary-cny-20260722-r3`  
**Run nonce:** `local-1784786625-14318`  
**Evidence file (gitignored):** `apps/core/provider-live-evidence/provider-live-gate.json`

This record is redacted. It never copies API keys, provider task payloads, or signed URLs.

## What was run

```bash
export RUN_PROVIDER_LIVE_CONNECTIVITY=1
export PROVIDER_LIVE_ACCEPTANCE_MODE=primary_connectivity
export PROVIDER_LIVE_REQUIRE_ALL=1
export PROVIDER_LIVE_ENVIRONMENT=local-authorized
export PROVIDER_LIVE_EVIDENCE_TTL_SECONDS=86400
export PROVIDER_LIVE_RELEASE_REF="$(git rev-parse HEAD)"
export PROVIDER_LIVE_RUN_NONCE="local-$(date +%s)-$RANDOM"
export PROVIDER_LIVE_EVIDENCE_DIR=provider-live-evidence
# ARK_* model/cost/identity from .env; ARK_API_KEY fell back from ARK_MEDIA_API_KEY

pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 \
  src/p1/model-supply/provider-conformance/live-fault-injection.integration.test.ts
```

Result: **2/2 pass** in ~160s. Artifact written and bound to the release SHA above.

## Gate summary (safe fields only)

| Field | Value |
|---|---|
| `acceptanceMode` | `primary_connectivity` |
| `blockedChecks` | `[]` |
| `skippedOperations` | `[]` |
| Actual cost | CNY **1.2368942** / cap **5** |
| Expires | `2026-07-24T06:06:25.833Z` |
| Text / image / video probes | all `accepted`, adapter executed, provider call succeeded |
| Publish gates | each `single_channel`, `publishAllowed=true`, `multiChannelReady=false` |

## #146 capability projection

With:

```bash
export RELEASE_COMMIT_SHA=d6787b292cc12db0fd3ecef738f34b9842262856
export PROVIDER_LIVE_EVIDENCE_PATH=apps/core/provider-live-evidence/provider-live-gate.json
export PROVIDER_LIVE_REQUIRE_ACCEPTANCE_MODE=primary_connectivity
```

`assembleCapabilitiesFromEnv` + merchant projection produced:

| Capability | Merchant state | Channel |
|---|---|---|
| `generation_copy` | **verified** | `single-channel/no-fallback` |
| `generation_image` | **verified** | `single-channel/no-fallback` |
| `generation_video` | **verified** | `single-channel/no-fallback` |

`providerLive` readiness: **pass** (current through evidence expiry for this commit).

Unit suite: `pnpm --filter @meiye/core exec tsx --test src/runtime-truth/*.test.ts` → **20 pass**.

Code already on `main` at this SHA (`assembleCapabilitiesFromEnv` wired in `main.ts`). PR #188 content is superseded by main commits `1a75ce65` + `13cc33c0` (main is stricter / more complete than the open PR tip).

## #147 RC evidence half

Pure `assertReleaseCandidateEvidence` against the real live report:

| Check | Result |
|---|---|
| Live report + same-SHA units shape | **ok** (live half satisfies primary_connectivity rules) |
| Missing units | fail closed: `Release units are required.` |
| Missing live report | fail closed |
| CLI without `RELEASE_MANIFEST_PATH` | fail closed: manifest required |

**Whole-package #147 remains OPEN.** Staging four-unit release manifest (`environment=staging`, workflowRun, digests, readiness/recovery/journey refs) is not manufactured from local probe digests. Full `run-release-candidate-quality.sh` (build + four-service e2e + staging manifest) was not claimed green.

## #128 / G-LIVE

This artifact clears the **current-SHA official single-channel live** half of G-LIVE for text/image/video under `primary_connectivity`.

Still not claimed:

- multi-channel ready / automatic fallback
- protected GitHub Environment `provider-live` workflow artifact upload (this run is `local-authorized`)
- package-complete close of #128 without re-check of the five gates on the same increment as admin AP

## Honesty / non-claims

- Do **not** reuse after `expiresAt`.
- Do **not** rebind this file to a different commit.
- Do **not** treat local probe unit digests as staging release units.
- Do **not** claim multi-channel verified.
- `recorded` / fixture paths remain non-equivalent to `live_verified`.
