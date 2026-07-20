# P0 Release Evidence

- Date: 2026-07-10
- Scope: GitHub tickets #2-#22
- Candidate branch: `main`
- Public paid launch: disabled by default through `VITE_PUBLIC_PAID_LAUNCH_ENABLED=false`

> **Historical evidence note (2026-07-11)**: This snapshot records the P0 renderer configuration tested on 2026-07-10. It proves that the tested label/provenance path worked for that configuration; it does not establish a current P1 default or a universal authoring-stage label gate. Current P1 uses the switch-controlled product watermark/AIGC label policy and publication-stage platform/legal rules.

## Automated Evidence

| Gate | Command | Result |
|---|---|---|
| Static checks | `pnpm check` | Pass |
| Type contracts | `pnpm typecheck` | Pass |
| Production build | `pnpm build` | Pass; only bundle-size warnings |
| Core + Postgres + media | `TEST_DATABASE_URL=postgres://meiye:meiye@127.0.0.1:54329/meiye FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg FFPROBE_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe pnpm --filter @meiye/core test` | 31 pass, 1 live-provider smoke skipped |
| Golden browser journey | `PORT=3011 ... playwright test tests/e2e/specs/p0-golden-journey.spec.ts` | Pass |
| Full browser regression | `PORT=3011 ... pnpm --filter @meiye/web e2e --reporter=line` | 25 pass |

The automated journeys cover authenticated workspace bootstrap, tenant isolation,
confirmed facts, rights-controlled assets, three copy candidates, structured
safety guidance, content versions, AIDA storyboard confirmation, durable video
jobs, real local ffmpeg composition, visible and implicit AIGC labels, verified
object storage, image/video L3 handoff, manual publication, lead association,
usage accounting, payment event ordering, and PWA/mobile layout primitives.

## Video Evidence

- The default local renderer produces a playable 720 x 1280 MP4 from a real
  uploaded image and records SHA-256, duration, dimensions, cost, latency,
  manifests, label validation, and quality scores.
- The product renderer has a tested provider injection path. Ark mode calls the
  configured provider per shot and records provider/model/task/cost/latency
  before ffmpeg composition and label validation.
- The live Ark smoke remains opt-in because it spends provider quota.

## Release Blocks

The following evidence cannot be manufactured by local code and is not complete:

1. A real Ark/Seedance run with production credentials, measured cost, latency,
   quality, and provider-side task evidence.
2. Physical target-device iOS Safari verification for camera permissions, QR
   transfer, Web Share, Save to Photos, and download fallback.
3. Signed Stripe or Creem sandbox webhook and checkout reconciliation against a
   real provider account.
4. Day-0 mainland network reachability evidence for each pilot merchant.
5. Gate 0 legal/filing evidence and required public registration/model-number
   disclosures.
6. Pilot and commercial metrics that require real merchant usage over time.

## Decision

The repository can be treated as a locally verified P0 software candidate. It
must not be represented as publicly paid-release ready until every release block
above has recorded evidence. The paid-launch gate remains closed by default.

## North-star note (2026-07-16 / 2026-07-17)

ContentPackage continuous same-aggregate real-run **0002** is accepted and counted
(`docs/evidence/contentpackage/README.md`: 真实跑通链路数 **0 → 1**). That
satisfies the D01/D03 product north-star *measurement* of one continuous
merchant journey with real LLM + real media + redacted evidence. It does **not**
clear ADR-0009 single release gate items E1–E7 or the release blocks above, and
must not be described as public paid launch readiness. Real-run 0001 is retained
as rejected history because its generated media never entered the adopted
ContentPackage.
