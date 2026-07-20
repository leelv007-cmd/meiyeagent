# Ticket 11 live Volcengine TTS probe attempt

Date: 2026-07-16 (re-run after adapter payload fix)

## Command

```bash
# Speaker must be a seed-tts-2.0 voice (*_uranus_bigtts). The previous
# *_mars_bigtts speaker is a 1.0 voice and returns provider code 55000000.
export VOLCENGINE_TTS_SPEAKER=zh_female_tianmeitaozi_uranus_bigtts
RUN_LIVE_VOLCENGINE_TTS_TEST=1 pnpm --filter @meiye/core exec tsx --test \
  src/p1/model-supply/live-volcengine-tts.integration.test.ts
```

## Results

### Attempt A — original env speaker (`*_mars_bigtts`) + pre-fix adapter

**Failed.** Provider error:

- error: `VolcengineTtsAdapterError`
- event: `invalid_response`
- providerErrorCode: `55000000`

Interpretation (live + community docs): resource/speaker family mismatch.
`VOLCENGINE_TTS_RESOURCE_ID=seed-tts-2.0` does not accept `*_mars_bigtts` (TTS 1.0 family).

### Attempt B — 2.0 speaker (`*_uranus_bigtts`) + pre-fix adapter

**Failed (auth/session OK, zero audio).**

- ConnectionStarted → SessionStarted succeeded
- TaskRequest payload was bare `{ "text": "..." }`
- Server returned `TTSSentenceStart` with empty text, then `SessionFinished` with no `TTSResponse` audio

### Attempt C — 2.0 speaker + fixed TaskRequest payload

**Passed.**

Adapter fix: TaskRequest body is `{ "req_params": { "text": "..." } }`
(not bare `{ "text": "..." }`). Live diagnosis proved only the nested shape
returns audio bytes.

| Field | Value |
| --- | --- |
| status | `completed` |
| contentType | `audio/mpeg` |
| outputBytes | `19629` (prior successful run: `18285`; non-deterministic provider audio) |
| outputSha256 | `1a56baa42c9105ef6e1e1376e723c680337272bd2b7dea82c7b4c8b3b05b609a` |
| billedTextWords | `11` |
| resourceId | `seed-tts-2.0` |
| model | `seed-tts-2.0-standard` |
| speaker | `zh_female_tianmeitaozi_uranus_bigtts` |
| endpoint | `wss://openspeech.bytedance.com/api/v3/tts/bidirection` |
| authKind | `legacy` (App-Id + Access-Key; secret key not sent) |
| deploymentId | `seed-tts-2-volcengine-direct` |

Non-secret config fingerprint (sha256 of endpoint/model/resourceId/speaker/authKind):

`d3fc753d5719b1187a9f1944f2ec7be5f67e639cb517161a2c7e01bab735f8dc`

## Activation evidence path (wired, still blocked on price)

- Live probe path: `apps/core/src/p1/model-supply/live-volcengine-tts.integration.test.ts`
- Adapter: `apps/core/src/p1/model-supply/volcengine-tts-adapter.ts`
- Runtime assembly binds `seed-tts-2-volcengine-direct` only when:
  1. `MODEL_MEDIA_EXECUTION_MODE` includes `volcengine_tts`
  2. non-secret + credential env for Volcengine TTS is complete
  3. approved `text_word` price + price revision are present
  4. `activationEvidenceByDeploymentId['seed-tts-2-volcengine-direct']` is
     `live_verified` with matching `configurationRevision` and
     `evidenceRef` matching `activation-probe-[a-f0-9]{24,64}`
- Production gate: `audioProductionActivationBlockers` still requires
  provider + approved price + price revision + live_verified + active catalog.

**This successful probe does not open production TTS.**

Missing for activation:

1. Approved `VOLCENGINE_TTS_APPROVED_PRICE_PER_TEXT_WORD_CNY` (do not invent)
2. Approved `VOLCENGINE_TTS_PRICE_REVISION`
3. Credential/endpoint revision metadata env
   (`VOLCENGINE_TTS_CREDENTIAL_VERSION`, `VOLCENGINE_TTS_ENDPOINT_REVISION`)
4. Control-plane / admin-config binding of
   `activation-probe-*` evidence to the full configuration revision hash
   from `volcengineTtsConfigurationRevisionFromEnv`

Until those exist, catalog deployment `seed-tts-2-volcengine-direct` stays
`inactive` and `isAudioProductionGenerationAllowed` remains false.

## Fail-closed verification

Unit tests re-run green after the live pass:

- `audio-activation-gate.test.ts` — default closed; missing price blocks even
  with live_verified claims; missing probe blocks priced inactive; speech opens
  only with provider + price + live_verified
- `volcengine-tts-adapter.test.ts` — TaskRequest payload asserts
  `{ req_params: { text } }`

## Ticket 11 checkbox

Leave **open**. Live adapter path works and evidence is persisted, but
activation gate DoD still requires approved unit price + bound live_verified
evidence. Prefer strict reading: no checkbox close without price + activation.
