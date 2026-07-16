# Ticket 11 live Volcengine TTS probe attempt

Date: 2026-07-16

## Command

```bash
RUN_LIVE_VOLCENGINE_TTS_TEST=1 pnpm --filter @meiye/core exec tsx --test \
  src/p1/model-supply/live-volcengine-tts.integration.test.ts
```

## Result

**Failed.** The adapter connected and received a provider failure event:

- error: `VolcengineTtsAdapterError`
- event: `invalid_response`
- providerErrorCode: `55000000`

No audio bytes, billed text-word usage, or `live_verified` activation evidence was produced.

## Implications

- Ticket 11 remains **partial**: the provider-neutral contract and fail-closed catalog path stay green, but the configure → live probe → activation evidence gate is still open.
- Ticket 12 remains **partial**: SFX reuses the same audio foundation and still has no approved provider/price/probe.
- No activation or pricing claim is inferred from the failed credential response.

## Required before activation

1. Working Volcengine credential/resource/speaker tuple that returns non-empty audio.
2. Approved `text_word` unit price and price revision.
3. Persisted live-probe evidence bound to the non-secret configuration fingerprint.
4. Independent SFX provider/model selection (ticket 12) with the same activation gate.
