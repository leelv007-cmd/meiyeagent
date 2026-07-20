# ContentPackage real-run evidence register

Current counted end-to-end runs: **1**

The first accepted continuous merchant journey is
`real-run-0002/journey/` (runId `real-run-0002-1784236289412`, completed
2026-07-16T21:12:34Z). It proves that the real generated image entered the same
ContentPackage created by copy adoption and was inherited by all three
platform variants.

## Rejected run 0001

Status: **rejected and not counted**. Its generated image remained a separate
CreativeAsset and never entered the adopted ContentPackage aggregate. The files
are retained for audit history, not north-star credit.

## Accepted run 0002

Status: **accepted and counted (0 → 1)**.

- Continuous Playwright browser journey (single session, continuous WebM).
- Real merchant facts: 润复丝·泽发防脱头皮管理（D5世纪城店）/ 成都.
- User-authorized real merchant photos (Dianping album, confirmed 2026-07-16).
- Real LLM copy stream → three candidates → single adoption into ContentPackage.
- Real reference-image generation via Tuzi Seedream (`gpt-image-2-tuzi-relay`).
- Three platform variants: 小红书 / 抖音 / 视频号.
- Content library shows the package under **可使用**.
- Redacted manifest, network correlation IDs, keyframes, exact owned generated
  image, and continuous video under `real-run-0002/journey/`.
- Redacted Product Usage reserve/commit and observed Provider Cost facts in
  `real-run-0002/journey/ledger-evidence.json` close the run's dual-ledger
  evidence without persisting provider task refs, signed URLs, or credentials.

## Corrective run 0003

Status: **accepted, fixed-model corrected, not an additional north-star item**.

`real-run-0003/journey/` repeats the already-counted must-have journey with the
corrected Seedream 4.5 selector. The selected catalog model, frozen route,
actual catalog model, Tuzi deployment, provider model, activation evidence, and
owned receipt agree. This removes real-run 0002's cross-brand fixed-model gap.
Ticket 22's evidence bundle is complete through the before/after comparison,
merchant-visible actual-model/Product Usage card, and final zero-regression
record. Its ticket status remains open only because the decision map's gate and
blocked-by tickets are still open; this is not release approval.

Do not increment the count from fixture, recorded, isolated-provider, or
synthetic-sample evidence alone. Do not splice failed diagnostic attempts into
accepted evidence.
