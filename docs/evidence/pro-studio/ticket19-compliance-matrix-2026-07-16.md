# Ticket 19 Light Composer compliance matrix — 2026-07-16

## Result

The local fixture-backed Chromium E2E journey exported all four watermark × AIGC combinations through the Light Composer, Core command, owned raster, and export-receipt path. The four PNG binaries were non-empty, had the PNG signature, had distinct SHA-256 values, and each matching receipt carried the requested switches plus image/font/CJK-line-break/raster-dimension evidence. This is local deterministic test evidence, not production/live execution or human approval.

| AIGC | Watermark | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| off | off | 81,442 | `5b6e32a83de0ab411e6e21b9afb125563d6326c2dfe35e1f82eaa7212c9dab6e` |
| on | off | 83,478 | `448376e7efbe524405d854cba02b05ad6865daec90cfa84d5df85e7c945852f7` |
| off | on | 84,811 | `fbd3164f130080f2a0faa1e10b5b4c3267be0e1c67c27b7d7fa34a0eb9f12445` |
| on | on | 87,133 | `9d862c6596ca515cf17767aeae05ecb20987f226a6c0b1d47c64ef3f84ad6661` |

Command:

```bash
PORT=3200 \
PLAYWRIGHT_CORE_PORT=4320 \
PLAYWRIGHT_CANVAS_PORT=4420 \
TEST_DATABASE_URL=postgres://meiye:meiye@127.0.0.1:54329/meiye \
pnpm --filter @meiye/web exec playwright test \
  tests/e2e/specs/uiux-operations-reuse.spec.ts \
  --grep 'edits, saves, and exports a real light Composer raster with a receipt'
```

Result: `1 passed` in `49.2 s` (test body: `18.9 s`). Runtime screenshot: [`ticket17-19-light-composer-runtime.png`](./ticket17-19-light-composer-runtime.png).

## Approved legacy comparison

`apps/core/src/p1/operations/renderer-comparison.ts` now provides RGBA pixel-difference and structural-similarity comparison. Its CLI requires a non-empty sample set, each approved legacy raster's SHA-256, reviewer, approval timestamp, approval reference, and explicit thresholds; missing or substituted approval evidence fails closed.

No approved legacy-renderer sample or product-approved threshold exists in the workspace, so the old/new equivalence gate remains open and Ticket 19 remains partial.
