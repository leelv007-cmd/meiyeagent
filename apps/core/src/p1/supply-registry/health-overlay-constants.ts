/**
 * C6 / D-080 health-guardrail defaults as sourced configuration constants.
 *
 * Implementation convention (engineering add-on, not D-080 wording): constants
 * document the upstream URL and the upstream version/default that was copied.
 * No LiteLLM or Envoy runtime dependency is introduced.
 *
 * ---------------------------------------------------------------------------
 * LiteLLM Router (cooldown_time / allowed_fails)
 * Upstream project: BerriAI/litellm
 * Source constants file:
 *   https://github.com/BerriAI/litellm/blob/main/litellm/constants.py
 * Docs:
 *   https://docs.litellm.ai/docs/routing
 *   https://docs.litellm.ai/docs/proxy/reliability
 * Copied defaults (LiteLLM mainline defaults as of 2026-07; DEFAULT_* env fallbacks):
 *   DEFAULT_COOLDOWN_TIME_SECONDS = 5
 *   DEFAULT_ALLOWED_FAILS = 3
 * ---------------------------------------------------------------------------
 * Envoy outlier detection
 * Upstream project: envoyproxy/envoy
 * Source proto / docs:
 *   https://www.envoyproxy.io/docs/envoy/latest/api-v3/config/cluster/v3/outlier_detection.proto
 *   https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/outlier
 * Copied defaults (Envoy api-v3 OutlierDetection message defaults):
 *   consecutive_5xx = 5
 *   base_ejection_time = 30s
 *   max_ejection_percent = 10
 *   interval = 10s
 * ---------------------------------------------------------------------------
 */

/** LiteLLM `DEFAULT_COOLDOWN_TIME_SECONDS` — seconds a deployment stays in cooldown. */
export const LITELLM_COOLDOWN_TIME_SECONDS = 5 as const;

/** LiteLLM `DEFAULT_ALLOWED_FAILS` — failures before cooldown. */
export const LITELLM_ALLOWED_FAILS = 3 as const;

/** Envoy `consecutive_5xx` — consecutive 5xx/connect failures before circuit open. */
export const ENVOY_CONSECUTIVE_5XX = 5 as const;

/** Envoy `base_ejection_time` — base circuit-open duration in seconds. */
export const ENVOY_BASE_EJECTION_TIME_SECONDS = 30 as const;

/** Envoy `max_ejection_percent` — maximum percent of hosts ejectable (informational). */
export const ENVOY_MAX_EJECTION_PERCENT = 10 as const;

/** Envoy `interval` — outlier analysis sweep interval in seconds (informational). */
export const ENVOY_INTERVAL_SECONDS = 10 as const;

/** Provenance metadata asserted by unit tests (no network I/O). */
export const HEALTH_OVERLAY_CONSTANT_PROVENANCE = {
  litellm: {
    project: 'BerriAI/litellm',
    sourceUrl:
      'https://github.com/BerriAI/litellm/blob/main/litellm/constants.py',
    docsUrl: 'https://docs.litellm.ai/docs/routing',
    upstreamDefaults: {
      cooldown_time: LITELLM_COOLDOWN_TIME_SECONDS,
      allowed_fails: LITELLM_ALLOWED_FAILS,
    },
    copiedFrom: 'LiteLLM mainline DEFAULT_* constants (2026-07)',
  },
  envoy: {
    project: 'envoyproxy/envoy',
    sourceUrl:
      'https://www.envoyproxy.io/docs/envoy/latest/api-v3/config/cluster/v3/outlier_detection.proto',
    docsUrl:
      'https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/outlier',
    upstreamDefaults: {
      consecutive_5xx: ENVOY_CONSECUTIVE_5XX,
      base_ejection_time_seconds: ENVOY_BASE_EJECTION_TIME_SECONDS,
      max_ejection_percent: ENVOY_MAX_EJECTION_PERCENT,
      interval_seconds: ENVOY_INTERVAL_SECONDS,
    },
    copiedFrom: 'Envoy api-v3 OutlierDetection message defaults',
  },
} as const;
