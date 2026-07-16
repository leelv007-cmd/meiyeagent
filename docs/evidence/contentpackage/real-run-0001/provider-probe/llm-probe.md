# Tuzi direct LLM probe

- Verified at: `2026-07-14T21:55:11Z`
- Command gate: `RUN_LIVE_MODEL_PROVIDER_TEST=1`
- Provider model: `gemini-3-flash-preview`
- Catalog route: `llm-openai` through the OpenAI-compatible Tuzi relay
- Credential version: `v1`
- Endpoint revision: `tuzi-openai-compat-v1`
- Input tokens: `113`
- Output tokens: `1,664`
- Result: three materially different Chinese candidates were returned and each preserved the supplied store and project facts.
- Configuration revision: `b376945b8739658266cfe94b7051ab71c1c9cdd4c53f28492c92fcacaaffcaee`

The local cost configuration was `0 / 0`, so the product correctly recorded configured provider cost as zero. This is not accepted as true billing evidence. For comparison only, Google's published standard price of USD 0.50 / 1M input tokens and USD 3.00 / 1M output tokens would price the observed token counts at USD 0.0050485 before any relay markup. Source: <https://ai.google.dev/gemini-api/docs/pricing#gemini-3-flash-preview>.

No API key, authorization header, provider response body, or prompt containing private merchant data is stored here.
