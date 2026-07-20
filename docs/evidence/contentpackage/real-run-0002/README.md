# Real run 0002

Status: **accepted and counted** (north-star 0 → 1).

This is the first run that satisfies the same-aggregate requirement: the real
Tuzi image is attached to the ContentPackage created by copy adoption, its
current version contains both authorized source photos and the generated owned
asset, and all three platform variants inherit that exact ordered media list.

## Journey

- Run: `real-run-0002-1784236289412`
- Completed: `2026-07-16T21:12:34.025Z`
- ContentPackage: `content-package-5f75c81790ceb090a397c975`
- Real LLM: Tuzi OpenAI-compatible direct route, streamed three candidates.
- Real media: Tuzi `gpt-image-2-tuzi-relay` / Seedream reference-image route.
- Final aggregate: 2 authorized source photos + 1 generated owned PNG.
- Variants: Xiaohongshu, Douyin, Video Account; each keeps the same 3 images.
- Product usage: copy 2 committed, image 1 committed.
- Provider cost: CNY 0.05 observed for the image; USD 0 observed as reported by
  the relay for both streamed copy calls.

## Evidence

| Path | Purpose |
|---|---|
| `journey/continuous-journey.webm` | One uncut browser session |
| `journey/keyframes/` | Store, authorization, stream, adoption, attachment, variants, library |
| `journey/generated-image.png` | Exact owned output bytes, receipt hash verified |
| `journey/package-evidence.json` | Redacted same-aggregate and variant inheritance facts |
| `journey/ledger-evidence.json` | Redacted reserve/commit and Provider Cost cross-check |
| `journey/network-log.jsonl` | Core request status and correlation IDs |
| `journey/run-manifest.json` | Acceptance checklist and SHA-256 inventory |

No API key, cookie, provider task reference, or provider signed URL is stored.
This evidence increments the product north-star only; it does not by itself
claim that the full release gate is open.

Formal Ticket 22 limitation: this historical run selected a GPT Image 2 label
before submit, while the provider route persisted Seedream 4.5 as the actual
model. That cross-brand mismatch means this run does not satisfy the fixed-model
DoD. The corrected runtime uses a distinct `seedream-4-5-tuzi-relay` deployment;
Ticket 22 remains open until a corrected journey and its remaining evidence
items are recorded.
