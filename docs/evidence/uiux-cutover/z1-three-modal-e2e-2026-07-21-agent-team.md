# #105 three-modal e2e — Agent Team closure evidence (2026-07-21)

**Command:**
```bash
cd mkfast-template-main
pnpm exec playwright test \
  tests/e2e/specs/ui-journey-three-modal.spec.ts --workers=1
```

**HEAD base:** `1f3d750` + this wave of #105 fixes (uncommitted at write time).

## Results (latest full serial run)

| Path | Result | Notes |
|---|---|---|
| copy · desktop | **PASS** (8.1s) | discover→submit→wait→adjust→adopt→download→restore |
| copy · mobile-dark | **PASS** (5.5s) | same |
| image_text · desktop | **PASS** (10.8s) | real ZIP download and restore |
| image_text · mobile-dark | **PASS** (16.6s) | same |
| video / douyin · desktop | **PASS** (2.3m) | terminal edit lock→quoted full-compose→completed derived task→new current asset→adopt→deep ZIP validation→restore |
| video / douyin · mobile-dark | **PASS** (2.3m) | same |
| video / video_account · desktop | **PASS** (2.3m) | same, with 视频号 delivery target |
| video / video_account · mobile-dark | **PASS** (2.3m) | same, with 视频号 delivery target |

**Score: 8 / 8 green in one serial command (`8 passed (10.7m)`, test file
runtime `10.0m`).** The
fixture-backed #105 browser gate is complete.

## Closure fixes

1. **ADR-0007** Result Center `submitCopyCandidateStream` (prior commit + streamActive only for `copy.generate`)
2. **Fixture submit status** accept `running|completed`
3. **image_text wait** does not require copy-stream tokens
4. **D-046 Brief gate** derived `autoConfirmBrief` under gate (result adjust)
5. **Intent seeds** 朋友圈 / 小红书 / 抖音 for delivery package labels
6. **Download asserts** accept production filenames + multi-line caption body
7. **First adopt seeds platform variant shells** so image/video full-package can enable
8. **Video workflow query soft-degrade** (no hard fail page when `video_workflow_public` errors)
9. **Queue isolation/cleanup** follows the Playwright `JOB_QUEUE_PREFIX` and clears capacity/lease state
10. **Frozen route snapshot persistence** retains optional retry/fallback/policy/source facts across PostgreSQL reload
11. **Video public projection authorization** registers workflow queries so the creative observer can resume
12. **Terminal video edit contract** disables in-place candidate/reorder/subtitle writes and routes adjustment through quoted regeneration
13. **First video adoption identity** accepts the completed Work-bound CreativeAsset wrapper while preserving its owned composed receipt
14. **Recorded composition custody** persists composed bytes to `workspace/composed/<sha256>.mp4` with matching evidence/sidecar
15. **Video compliance export** carries and verifies AIGC/watermark composition evidence before creating the ZIP
16. **Video first-adopt variants** seeds all three required platform variants, preventing the export transition schema failure
17. **Canonical terminal edit enforcement** rejects completed/cancelled/failed in-place edits in Core; regeneration creates a separate derived workflow
18. **Production composition boundary** permits recorded synthetic composition only with explicit `APP_ENV=e2e`, and production export rejects recorded synthetic compliance evidence by default
19. **Full-compose browser proof** waits for the derived task and workflow, reloads the package-backed current asset, and proves the adopted asset differs from the original
20. **First-adopt receipt verification** checks workspace/work/job/output binding, approved object-key namespaces, SHA-256, positive size, evidence hash/size, and requested/actual/validated compliance flags
21. **Watermark evidence binding** persists `compliance.watermarkText` and requires it to equal the composition evidence text at export
22. **Recorded custody replay safety** keeps immutable sidecars and separates same-byte receipts by workflow/composition lineage
23. **Formal regeneration approval** signs a one-time high-cost approval receipt for the derived full-compose contract using the actor's real workspace role; shot regeneration does not consume this path
24. **Deep delivery assertions** unzip the artifact and validate manifest schema/kind/platform/rights summary plus non-empty caption, checklist, and media bytes
25. **Newest same-Work package selection** consumes the Core `updatedAt DESC` order directly, so the original CreativeJob provider workflow cannot mask a derived full-compose package
26. **Canonical delivery evidence** binds workflow/storyboard/composition revisions, output SHA, persisted first-frame cover receipt, exact subtitle text, measured composition duration, and frozen execution duration at completion, first adoption, reconciliation, and export
27. **Synthetic evidence isolation** rejects recorded synthetic video, cover, or subtitle evidence even when both compliance flags are off; only explicit override plus `APP_ENV=e2e` is accepted
28. **Playwright process-tree teardown** runs every managed service in a signal-aware process group and verifies SIGTERM removes its grandchild processes, preventing orphan Core/worker PostgreSQL clients

## Root-cause proof for the final video residual

- Before the final fix, `result_export` returned generic `INVALID_COMMAND` even
  though the recorded composed file existed and its SHA/size/evidence matched.
- Direct execution against the same PostgreSQL package exposed the original
  exception: `ContentPackage variants must be empty or contain all three platforms.`
- The video first-adopt path had seeded only `douyin`. It now seeds
  `xiaohongshu`, `douyin`, and `video_account`; a focused regression adopts a
  completed CreativeAsset and executes the real ZIP export transition.
- The independent closure review then exposed that terminal edits, recorded
  evidence defaults, first-adopt receipt checks, watermark text binding, and
  full-compose browser identity proof were not all enforced at the canonical
  seams. Those checks are now explicit and covered by focused negative tests.
- The first post-review full-compose browser run reached ZIP download and
  exposed a test-only schema mismatch (`manifest.compliance` versus canonical
  `manifest.rightsSummary`). After correcting the assertion to the existing
  `beauty-delivery-manifest/v1` schema, the isolated desktop path passed and
  the subsequent six-path serial matrix passed 6/6.
- Expanding the matrix to explicit `douyin` and `video_account` desktop/mobile
  paths exposed a final harness-only PostgreSQL `53300` on the eighth test.
  The cause was five orphan Core/worker process groups left by prior Playwright
  service shutdowns, not a database capacity requirement. A process-group
  wrapper plus `gracefulShutdown` teardown regression now closes descendants.
- The affected `video:video_account · mobile-dark` path then passed 1/1
  (`3.1m` total), followed by the final full serial matrix at 8/8 (`10.7m`).
  After teardown, the orphan Core/worker count was `0`; PostgreSQL returned to
  `6` total activities with only the sampling `psql` client active.

## Evidence boundary

- This closes the local fixture-backed #105 three-modal browser gate, including
  real downloaded package bytes and reload restoration.
- Recorded synthetic composition and its compliance override are confined to
  explicit E2E runtime. Production requires real ffmpeg/provider composition
  evidence and rejects recorded synthetic evidence.
- It does **not** claim live provider credentials, live capability activation,
  or production ffmpeg/provider composition evidence; those remain separate
  live-environment gates.
