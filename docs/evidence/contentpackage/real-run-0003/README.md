# Real run 0003

Status: **accepted and fixed-model corrected** (north-star remains 1 because
this is a corrective rerun of the already-counted journey, not a new journey).

This continuous browser run repeats the same aggregate journey from real-run
0002 with an honest fixed Seedream 4.5 selection. The selected catalog model,
frozen route, actual catalog model, provider model, and owned output receipt all
agree; no cross-brand substitution occurred.

## Journey

- Run: `real-run-0003-1784239833734`
- Completed: `2026-07-16T22:11:47.293Z`
- ContentPackage: `content-package-b0aa589eb050a9211762969c`
- Real LLM: direct OpenAI-compatible route using `gemini-3-flash-preview`.
- Real media: Tuzi `seedream-4-5-tuzi-relay`, provider model
  `doubao-seedream-4-5-251128`.
- Final aggregate: 2 authorized source photos + 1 generated owned PNG.
- Variants: Xiaohongshu, Douyin, and Video Account; each keeps the same ordered
  3-image list and has a distinct complete-copy digest.
- Product usage: copy 2 committed, image 1 committed.
- Provider cost: CNY 0.05 observed for the journey image; USD 0 observed as
  reported by the relay for both copy calls.

## Evidence

| Path | Purpose |
|---|---|
| `activation/activation-evidence.json` | Real `image.generate` + `image.edit` activation coverage |
| `activation/catalog-publication/` | Same-workspace live probes and `draft → enabled → published` admin evidence |
| `journey/continuous-journey.webm` | One uncut browser session |
| `journey/keyframes/` | Store, authorization, stream, adoption, real image, variants, library |
| `journey/keyframes/kf9-result-card-model-usage.png` | Merchant-visible actual model and charged Product Usage status |
| `journey/before-after-comparison.md` | Frozen baseline versus current real-run evidence |
| `journey/generated-image.png` | Exact owned output bytes, receipt hash verified |
| `journey/package-evidence.json` | Redacted same-aggregate, fixed-model, and variant facts |
| `journey/route-snapshot-evidence.json` | Redacted immutable fixed route |
| `journey/ledger-evidence.json` | Redacted Product Usage and Provider Cost cross-check |
| `journey/network-log.jsonl` | Core request status and correlation IDs with queries removed |
| `journey/run-manifest.json` | Acceptance checklist and SHA-256 inventory |

No API key, cookie, provider task reference, signed URL, workspace/user id,
object key, or full generated copy is stored in the curated JSON evidence.

This run removes the cross-brand fixed-model gap recorded against real-run
0002. Ticket 22's evidence bundle is complete, but its formal status remains
open while the decision map's gate and blocked-by tickets remain open.
