# #105 three-modal e2e — Agent Team progress (2026-07-21)

**Command:**
```bash
cd mkfast-template-main
pnpm exec playwright test tests/e2e/specs/ui-journey-three-modal.spec.ts --reporter=list
```

**HEAD base:** `8a039bd` + this wave of fixture/product fixes (uncommitted at write time unless noted).

## Results (latest full serial run)

| Path | Result | Notes |
|---|---|---|
| copy · desktop | **PASS** (~8s) | discover→submit→wait→adjust→adopt→download→restore |
| copy · mobile-dark | **PASS** (~5s) | same |
| image_text · desktop | **PASS** (~12–16s) | ZIP download real (hash filename) |
| image_text · mobile-dark | **PASS** (~10s) | same |
| video · desktop | **FAIL** | shell mounts after soft-degrade; phase stuck `running` >180s |
| video · mobile-dark | **not run** | serial stop after video desktop fail |

**Score: 4 / 6 green.** Not claimable as #105 complete.

## Fixes landed this wave (enablers)

1. **ADR-0007** Result Center `submitCopyCandidateStream` (prior commit + streamActive only for `copy.generate`)
2. **Fixture submit status** accept `running|completed`
3. **image_text wait** does not require copy-stream tokens
4. **D-046 Brief gate** derived `autoConfirmBrief` under gate (result adjust)
5. **Intent seeds** 朋友圈 / 小红书 / 抖音 for delivery package labels
6. **Download asserts** accept production filenames + multi-line caption body
7. **First adopt seeds platform variant shells** so image/video full-package can enable
8. **Video workflow query soft-degrade** (no hard fail page when `video_workflow_public` errors)

## Remaining video residual

- Job phase stays `running` for full 180s wait — fixture/worker video completion path not finishing under e2e harness.
- Need: fixture `video.generate` terminal completion (or durable video workflow id that settles) before video e2e can green.

## Non-claims

- Do not close #105 / #83 until video desktop + mobile-dark also green with real download.
- Do not claim live provider evidence from this run (fixture only).
