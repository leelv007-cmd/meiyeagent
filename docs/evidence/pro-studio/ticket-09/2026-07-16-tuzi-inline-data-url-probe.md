# Ticket 09 provider reference probe (historical non-production transport)

## Probe identity

- Provider: Tuzi Seedream relay
- Model: `doubao-seedream-4-5-251128`
- Operation: `image.edit`
- Reference transport under test: inline `data:image/png;base64,...` in a JSON
  `/images/generations` request
- Correlation ID: `pro-studio-ticket09-20260715T213253Z`
- Started at: `2026-07-15T21:32:59.463Z` (`2026-07-16T05:32:59.463+08:00`)
- Completed at: `2026-07-15T21:32:59.982Z` (`2026-07-16T05:32:59.982+08:00`)

## Redacted command

```sh
RUN_LIVE_PROVIDER_REFERENCE_PROBE=1 \
PROVIDER_REFERENCE_PROBE_CORRELATION_ID=pro-studio-ticket09-20260715T213253Z \
pnpm --filter @meiye/core exec node \
  --env-file=<repo>/.env \
  --import tsx \
  --test \
  --test-concurrency=1 \
  <repo>/apps/core/src/pro-studio-runtime/provider-reference-live.integration.test.ts
```

The API key, inline data URL, task reference, and provider response body are not
printed or persisted by the probe.

The command above records the invocation used at probe time. The test at that
path has since been corrected to use the production multipart transport, so a
current rerun will not reproduce the legacy JSON request.

## Result

- HTTP status: `401`
- Provider error code: absent
- Provider task accepted: no
- Provider task/reference created: no
- Quota-consuming generation observed: no

Conclusion: **inconclusive**. The request was rejected at authentication before
the provider could evaluate the inline data URL. This is not evidence that the
provider rejects data URLs.

This probe also did not exercise the production Tuzi transport. Production
rewrites a reference-bearing image request to `/images/edits`, decodes the
owned data URL locally, and uploads the bytes as multipart form data. Therefore
this historical result cannot establish production reference capability even
with a successful authentication response.

Credential inventory at probe time:

- `ARK_MEDIA_API_KEY`: missing.
- `TUZI_MEDIA_API_KEY`: present but matched the repository's placeholder-value
  check and failed live authentication.
- Integration vault: no active `platform:ark.media` or
  `platform:model.direct` connection was present.

## Conditional grant decision

Grant decision: **undetermined**. `ProviderReferenceGrant` remains unbuilt.
Ticket 09 permits that public bearer endpoint only after a real provider
rejects a valid inline data URL. A 401 does not satisfy that condition.
Consequently there is no grant endpoint and the generation path does not
produce a grant URL.

`provider-reference-policy.ts` makes this state fail closed: release
conformance returns `PROVIDER_REFERENCE_PROBE_REQUIRED`, and the durable media
effect rejects a resolved reference request before provider submission while
the decision is undetermined. Requests without references are unaffected.

The live probe now imports the same Tuzi transport factory used by the
production adapter, so its request is rewritten to `/images/edits` multipart.
It has not been rerun because no valid media credential is available. If the
provider accepts the request, keep grants disabled. If production transport
still requires a public URL, implement the full hash-token, TTL, audience,
limits, revocation, and janitor contract before enabling any public URL.

## Adapter audit

- Tuzi validates owned data URLs locally, decodes them, and uploads multipart
  files for image edits and video references.
- The production adapter and Ticket 09 live probe now share
  `createTuziProductionTransportFetch`; unit coverage asserts that image
  references reach `/images/edits` as multipart files.
- A valid-credential run of the corrected probe is still required before the
  grant decision can move from `undetermined`.
