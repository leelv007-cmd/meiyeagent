# Ticket 21 live Tuzi adapter canary — 2026-07-16

## Scope

This is a production-provider adapter baseline for the two configured Tuzi deployments. It does not replace the administrator `configure → probe → evidence` drill and it does not satisfy the blocked A2/A3 fixture-authorization gate.

The opt-in integration test used the real ignored credential source, the production submit/poll/download code paths, fixed sanitized prompts, and no product usage debit. Provider task references, temporary asset URLs, response bodies, and credentials were not persisted.

## Result

| Deployment contract | Lifecycle | Output | Bytes | SHA-256 |
| --- | --- | --- | ---: | --- |
| `gpt-image-2-tuzi-relay` | submit → download | `image/png` | 3,286,943 | `c9c19093a00dc672f9613f2a75d7b947650c7621d6621ebf4d9ac97980f1f177` |
| `seedance-2-tuzi-relay` | submit → poll → download | `video/mp4` | 4,063,352 | `048521d09fe6f887409a679086031257787d5f88979f623a987042b4ef7afe3b` |

Test result: `1 passed / 0 failed` in `58.423 s`.

## Network safety

The provider returned assets from the explicitly allowlisted host `ark-content-generation-v2-cn-beijing.tos-cn-beijing.volces.com`. The local system resolver maps that host into the `198.18.0.0/15` FakeIP range, so the live-only test resolves allowlisted hosts through Cloudflare's DNS-over-HTTPS JSON endpoint. The resulting address is still checked by `ProviderSafeFetch`; redirects and non-allowlisted or private/reserved destinations remain rejected.

## Reproduction contract

Source: `apps/core/src/p1/model-supply/live-tuzi-media.integration.test.ts`.

Required opt-in variables are `RUN_LIVE_TUZI_MEDIA_TEST`, `TUZI_MEDIA_API_KEY`, `TUZI_MEDIA_BASE_URL`, `TUZI_MEDIA_ASSET_SOURCE_HOSTS`, `TUZI_GPT_IMAGE_2_MODEL`, and `TUZI_SEEDANCE_MODEL`. No evidence directory was configured for this run, so provider-generated media bytes were not retained locally.

## Remaining Ticket 21 gates

- Run both deployments through the administrator activation-probe command and persist configuration-revision-bound evidence.
- Prove zero merchant usage debit, idempotent replay, stale-evidence behavior, controlled failure classification, and the real cancellation path.
- Obtain A2/A3 authorization before adding any Vozeb-derived fixture or direct-copy manifest entry.
