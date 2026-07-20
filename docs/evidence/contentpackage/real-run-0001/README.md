# Real run 0001

Status: **rejected and not counted**.

Post-run aggregate audit found that the real generated image was saved as a
separate CreativeAsset but was never attached to the ContentPackage created by
copy adoption. The package and its three variants contained only the two
uploaded source photos. This run remains as historical diagnostic evidence;
`real-run-0002/` is the first accepted same-aggregate journey.

## Layout

| Path | Role |
|---|---|
| `journey/` | Continuous merchant journey evidence (authoritative for the count) |
| `journey/run-manifest.json` | Redacted acceptance manifest + artifact hashes |
| `journey/ledger-evidence.json` | Redacted Product Usage reserve/commit and observed Provider Cost cross-check |
| `journey/continuous-journey.webm` | Single-session Playwright recording |
| `journey/network-log.jsonl` | `/api/core/*` method/status/correlationId only |
| `journey/keyframes/` | kf1–kf8 plus registration / submit stills |
| `provider-probe/` | Historical isolated Tuzi media probes (not a full journey) |

## Journey summary

- **runId**: `real-run-0001-1784228421812`
- **completedAt**: `2026-07-16T19:01:25.957Z`
- **packageId**: `content-package-430806b82280ee8754fe9393` (status `accepted`)
- **jobs**: `copy.generate` completed (`llm-openai`) + `image.generate` completed (`gpt-image-2`)
- **variants**: `xiaohongshu`, `douyin`, `video_account` (one version each)
- **product usage**: copy 2 committed / 100, image 1 / 40, video 0 / 20
- **observed provider cost**: CNY 0.05 + USD 0 (currency totals are intentionally not combined)
- **merchant**: 润复丝·泽发防脱头皮管理（D5世纪城店）, authorized real photos
- **env notes**: web `vite --mode e2e` for email verify helper; temporary
  `/etc/hosts` for TOS/tuzi (ops should remove after use)

## What does *not* count alone

- `provider-probe/` image/video artifacts without the continuous journey
- Failed diagnostic browser attempts (submit blocked / size invalid_request /
  timeouts) that were **not** spliced into this accepted package

## Keyframes

| File | Moment |
|---|---|
| `kf1-store-confirmed.png` | Store profile confirmed |
| `kf2-assets-authorized.png` | Real photos authorized for public marketing |
| `kf3-first-tokens-streaming.png` | Real LLM stream visible |
| `kf4-three-candidates.png` | Three copy candidates |
| `kf5-adopted-into-package.png` | Single adoption → ContentPackage |
| `kf6-real-photo-reference-image.png` | Real reference-image result saved |
| `kf7-three-platform-variants.png` | 小红书 / 抖音 / 视频号 ready |
| `kf8-library-usable.png` | Content library **可使用** |

Full step list and SHA-256 inventory: `journey/run-manifest.json`.
