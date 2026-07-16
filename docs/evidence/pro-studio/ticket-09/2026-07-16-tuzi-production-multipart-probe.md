# Ticket 09 production provider-reference probe

## Probe identity

- Provider: Tuzi Seedream relay
- Model: `doubao-seedream-4-5-251128`
- Operation: `image.edit`
- Production transport: owned `data:` URL decoded locally and uploaded to
  `/images/edits` as multipart form data
- Correlation ID: `ticket09-434b57f0-b6f9-4036-b608-d70fb0a2898f`
- Started at: `2026-07-16T06:47:14.870Z`
- Completed at: `2026-07-16T06:47:29.772Z`

## Secret-safe invocation

The probe loaded the repository's ignored `.env` for the Tuzi media Base URL
and model. The valid same-provider credential in ignored
`docs/_private/tuzi.env` was mapped to `TUZI_MEDIA_API_KEY` only in the test
child process. No credential value was printed, persisted, or written back.

The executed test was:

```sh
RUN_LIVE_PROVIDER_REFERENCE_PROBE=1 \
PROVIDER_REFERENCE_PROBE_CORRELATION_ID=<generated-correlation-id> \
node --import tsx --test \
  apps/core/src/pro-studio-runtime/provider-reference-live.integration.test.ts
```

## Result

- HTTP status: `200`
- Provider error code: absent
- Provider task accepted: yes
- Non-empty generated image output present: yes
- Owned reference bytes: `6274`
- Provider response body persisted: no
- Secrets persisted: no

The production adapter accepted an owned data URL, decoded it inside the trusted
Core process, and sent the reference as a multipart file. The provider accepted
that production request. A public bearer URL is therefore unnecessary.

## Grant decision

Decision: **do not build or enable `ProviderReferenceGrant`**.

- `grantEndpoint` remains `null`.
- The generation path produces no grant URL.
- Reference dispatch may use the validated owned data URL already returned by
  the workspace-scoped resolver; the Tuzi adapter performs the bounded local
  decode and multipart upload.
- The live decision is scoped to deployment `gpt-image-2-tuzi-relay`, provider
  profile `provider-tu-zi-openai`, execution channel
  `channel-tuzi-gpt-image-2-relay`, provider model
  `doubao-seedream-4-5-251128`, and operation `image.edit`. Any other
  provider/model/operation tuple remains fail-closed until it has matching live
  evidence.
- The legacy HTTP 401 JSON-path probe remains archived separately as historical,
  inconclusive evidence.

This closes Ticket 09's conditional branch without exposing an asset through a
temporary public endpoint.
