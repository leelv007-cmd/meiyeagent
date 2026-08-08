# #128 Z2-ACCEPT same-increment re-sign — 2026-07-23

**Worktree:** `/Users/bin/orca/workspaces/美业内容2/wt-provider-live`  
**Branch:** `lane/provider-live-20260723`  
**Code + live evidence SHA:** `d6787b292cc12db0fd3ecef738f34b9842262856`  
**Live artifact:** `apps/core/provider-live-evidence/provider-live-gate.json` (gitignored)  
**Live acceptance write-up:** `docs/evidence/provider-live-local-acceptance-2026-07-23.md`  
**Docs PR (redacted summary onto origin/main):** https://github.com/legacy-origin-a/legacy-web-repo/pull/189

## Five gates (re-run)

| # | Gate | Result | Evidence this pass |
|---|---|---|---|
| 1 | Capability skeleton | **GREEN** | contracts inventory 4/4 |
| 2 | Story 30 recorded + official single-channel live | **GREEN** | core Z2 10/10 recorded; live probes accepted on release SHA (text/image/video); capability projection `verified` ×3 |
| 3 | Publish gate + dual-end labels | **GREEN** | MP-08 matrix/publish 24/24; AP/composer labels 12/12 (includes single-channel/no-fallback dual-end) |
| 4 | D-048 ops ban | **GREEN** | AP Z2 gate4 paths in the 12-test AP suite |
| 5 | Honest gap list | **GREEN** | G-LIVE local half documented; multi-channel deferred explicitly |

## Live binding (Gate 2 live half)

| Field | Value |
|---|---|
| releaseRef | `d6787b292cc12db0fd3ecef738f34b9842262856` |
| environment | `local-authorized` |
| acceptanceMode | `primary_connectivity` |
| expiresAt | `2026-07-24T06:06:25.833Z` |
| blockedChecks / skipped | empty |
| merchant capabilities | all three `verified` + `single-channel/no-fallback` |
| multiChannelReady | **false** (correct) |

## Commands

```bash
pnpm --filter @meiye/contracts exec tsx --test src/capability-inventory.test.ts
pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 src/p1/z2-accept/z2-accept.test.ts
pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 \
  src/p1/model-supply/provider-conformance/fault-injection/fault-injection.matrix.test.ts \
  src/p1/model-supply/provider-conformance/fault-injection/publish-gate.test.ts
pnpm --filter @meiye/web locale:compile
pnpm --filter @meiye/web exec tsx --test \
  src/p1/z2-accept-ap.test.tsx \
  src/product/composer/composer-channel-readiness.static.test.ts
# live projection (requires gitignored gate.json + RELEASE_COMMIT_SHA bound)
pnpm --filter @meiye/core exec tsx -e '/* assembleCapabilitiesFromEnv smoke */'
```

## Package decision recommendation

Under the approved single-channel publish rule (`primary_connectivity`, dual-channel not a release prerequisite):

- **Local package re-sign is GREEN** for the five gates on this increment.
- Remaining non-package items (do not block #128 if single-channel scope holds):
  - multi-channel ready / automatic fallback
  - protected GitHub `provider-live` workflow upload (local-authorized is the authorized local path already used historically)
  - P0 full RC staging package (#147) — separate ticket

**Close recommendation:** #128 may close after maintainer ack of this re-sign. This document does not auto-close the issue.

## Non-claims

- Not multi-channel verified
- Not #147 P0 RC complete (staging manifest missing)
- Not paid public launch
- Live evidence expires; re-run if SHA or TTL moves
