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

## Evidence grading

| Level | Durable source | Proven boundary | Status |
| --- | --- | --- | --- |
| `fixture` | `activation-probe-executor.test.ts` | Sanitized submit/poll/download/cancel contracts, a code-generated 1×1 PNG reference for `image.edit`, failure classification, zero product usage quantity, and provider-task-reference redaction | Passed; no network or provider claim; no Vozeb or merchant asset used |
| `recorded` | `apps/core/src/p1/model-supply/adapters.test.ts` | Deterministic replay of normalized provider lifecycle and error contracts | Contract evidence only; not a Ticket 21 live probe |
| `local` | `activation-probe-canary.integration.test.ts` and `admin-activation-probe-control.test.tsx` | Public control-plane persistence, idempotent replay, stale-evidence behavior, failure cost/usage preservation, and administrator evidence projection | Passed locally; no provider claim |
| `live` | This opt-in Tuzi baseline | Real submit/poll/download for the two listed deployments with sanitized prompts and zero product usage debit | Passed only for the listed lifecycle; real cancellation, controlled failure, and administrator-command drills remain pending |

Only successful `live` administrator activation probes bound to the current configuration revision and covering every operation declared by the model may create per-deployment `live_verified` activation evidence. A passing `image.generate` probe therefore cannot activate an unprobed `image.edit` capability. That deployment marker does not close Ticket 21 by itself: fixture authorization, administrator drill evidence, and controlled live cancellation/failure evidence remain separate gates. Fixture, recorded, and local results never upgrade a deployment.

## Network safety

The provider returned assets from the explicitly allowlisted host `ark-content-generation-v2-cn-beijing.tos-cn-beijing.volces.com`. The local system resolver maps that host into the `198.18.0.0/15` FakeIP range, so the live-only test resolves allowlisted hosts through Cloudflare's DNS-over-HTTPS JSON endpoint. The resulting address is still checked by `ProviderSafeFetch`; redirects and non-allowlisted or private/reserved destinations remain rejected.

## Reproduction contract

Source: `apps/core/src/p1/model-supply/live-tuzi-media.integration.test.ts`.

The image/video baseline is independently gated by `RUN_LIVE_TUZI_MEDIA_TEST`. The cancellation drill is independently gated by `RUN_LIVE_TUZI_CANCELLATION_TEST`; it was not enabled for this evidence run. Both require `TUZI_MEDIA_API_KEY`, `TUZI_MEDIA_BASE_URL`, `TUZI_MEDIA_ASSET_SOURCE_HOSTS`, `TUZI_GPT_IMAGE_2_MODEL`, and `TUZI_SEEDANCE_MODEL`. No evidence directory was configured for this run, so provider-generated media bytes were not retained locally.

## Remaining Ticket 21 gates

- Run both deployments through the administrator activation-probe command and persist configuration-revision-bound evidence.
- Run the opt-in real cancellation path and a controlled real failure drill. These paths are executable but have not been run against Tuzi, so this document does not claim live proof for them.
- Obtain A2/A3 authorization before adding any Vozeb-derived fixture or direct-copy manifest entry.

## Deterministic verification added after this live baseline

Local integration coverage now proves that the administrator canary uses zero product usage quantity, selects and validates an explicit operation, includes that operation in the idempotency identity, drives `copy.generate`, `copy.adapt`, `text.respond`, `image.generate`, and `image.edit` through their production probe seams, replays without a second provider effect, preserves the last successful evidence after a classified failure, preserves failed-attempt cost and usage as estimated rather than observed, marks evidence stale after a configuration revision change, lists probe history newest-first, and refuses both automatic evidence minting and hand-authored live catalog drafts until every declared model operation has a passing current-revision probe. Fixture-level cancel/failure classification covers `cancel:unsupported_operation`, `cancel:cancel_pending`, `cancel:cancellation_unconfirmed`, `poll:timeout`, and `poll:content_policy` without exposing provider task refs. The administrator history UI exposes one action per declared operation plus operation, configuration revision, correlation ID, provider usage, cost evidence status, failure category, output digest, and the evidence reference; fail-closed UI checks keep missing configuration non-runnable and never project failed runs as evidence refs. These deterministic checks are engineering evidence only; they do not upgrade the unrun real cancellation or failure drills to live evidence.
