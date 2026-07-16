# Tickets 11–12 audio foundation evidence

Date: 2026-07-16

## Implemented without a provider decision

- `audio.speech` and `audio.sfx` have separate, strict input contracts.
- Both catalog entries are providerless and inactive by default: `modelId` is
  `null`, usage is `0`, and activation evidence is absent.
- Activation requires a concrete model ID, positive approved usage price, a
  current configuration revision, and persisted `live_verified` probe evidence.
- MP3 and PCM-S16LE WAV outputs pass MIME/container/magic checks, full ffmpeg
  decode, ffprobe duration/bitrate/sample-rate/codec inspection, and metadata
  limits before entering owned storage.
- Provider audio URLs enter the pipeline only through `ProviderSafeFetch`.
- Accepted audio uses a random private object key and workspace-scoped delivery
  through `CanvasAssetFacade.getAssetDelivery`, including single byte ranges,
  `nosniff`, `private, no-store`, and sanitized download filenames.

The decoder invokes ffprobe and ffmpeg with fixed argument arrays through
`spawn` without a shell. Input is materialized in a mode-0600 temporary file;
the temporary directory is removed recursively in `finally` on success,
failure, or timeout.

## Enforced limits

| Limit | Value |
| --- | ---: |
| Containers/codecs | MP3/mp3, WAV/pcm_s16le |
| File size | 25 MiB |
| Duration | 600 seconds |
| Bitrate | 512 kbps |
| Sample rate | 96 kHz |
| Metadata | 64 KiB |
| SFX request duration | 120 seconds |

## External blockers

Tickets 11 and 12 are not complete and neither operation may be exposed or
sold until all of the following exist independently for each operation:

1. approved provider and concrete provider model;
2. real runtime credentials and exact asset-host allowlist;
3. approved product price and provider cost unit;
4. successful configure -> live probe -> persisted evidence flow;
5. provider adapter lifecycle and recovery evidence;
6. canvas generate -> listen -> download E2E evidence.

No provider, model, price, credential, task receipt, probe result, or activation
evidence is inferred or fabricated by this implementation.
