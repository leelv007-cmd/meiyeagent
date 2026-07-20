/**
 * Dual-channel test model matrix (handoff 2026-07-20, I1–I4 / C5).
 * Credentials stay in .env / docs/_private/ — never in ticket or doc body.
 *
 * Video channels share Seedance manufacturer → channel-level resilience only
 * (not manufacturer-level dual supply) per D-069.
 */
import type { SupplyChannelKind, SupplyOperation } from '@meiye/contracts';
import type { FaultInjectionModality } from './types.js';

export interface DualChannelMatrixModel {
  modality: FaultInjectionModality;
  operation: SupplyOperation;
  channelKind: SupplyChannelKind;
  providerModel: string;
  /** Env var that selects the live model id. */
  modelEnv: string;
  /** Env vars that must be present for live gate (api key / base). */
  credentialEnvHints: string[];
  catalogModelId: string;
  providerProfileId: string;
  manufacturer: string;
  /**
   * channel_level: shared manufacturer across dual channels (video Seedance).
   * manufacturer_level: distinct manufacturers across dual channels.
   */
  independenceClaim: 'channel_level' | 'manufacturer_level';
}

export const DUAL_CHANNEL_MATRIX_MODELS: readonly DualChannelMatrixModel[] = [
  // Text — official_direct (Ark) + upstream_reseller (tuzi)
  {
    modality: 'llm',
    operation: 'copy.generate',
    channelKind: 'official_direct',
    providerModel: 'doubao-seed-2-0-mini-260428',
    modelEnv: 'ARK_TEXT_MODEL',
    credentialEnvHints: ['ARK_TEXT_API_KEY', 'ARK_API_KEY'],
    catalogModelId: 'llm-doubao-seed-mini',
    providerProfileId: 'pp-volcengine-ark',
    manufacturer: 'volcengine',
    independenceClaim: 'manufacturer_level',
  },
  {
    modality: 'llm',
    operation: 'copy.generate',
    channelKind: 'upstream_reseller',
    providerModel: 'gemini-3-flash-preview',
    modelEnv: 'MODEL_DIRECT_MODEL',
    credentialEnvHints: ['MODEL_DIRECT_API_KEY', 'MODEL_DIRECT_BASE_URL'],
    catalogModelId: 'llm-gemini-flash',
    providerProfileId: 'pp-tuzi-upstream',
    manufacturer: 'google',
    independenceClaim: 'manufacturer_level',
  },
  // Image
  {
    modality: 'image',
    operation: 'image.generate',
    channelKind: 'official_direct',
    providerModel: 'doubao-seedream-5-0-260128',
    modelEnv: 'ARK_SEEDREAM_MODEL',
    credentialEnvHints: ['ARK_API_KEY', 'ARK_BASE_URL'],
    catalogModelId: 'seedream-5-pro',
    providerProfileId: 'pp-volcengine-ark',
    manufacturer: 'bytedance',
    independenceClaim: 'channel_level',
  },
  {
    modality: 'image',
    operation: 'image.generate',
    channelKind: 'upstream_reseller',
    providerModel: 'doubao-seedream-4-5-251128',
    modelEnv: 'TUZI_GPT_IMAGE_2_MODEL',
    credentialEnvHints: ['TUZI_API_KEY', 'TUZI_BASE_URL'],
    catalogModelId: 'gpt-image-2',
    providerProfileId: 'pp-tuzi-upstream',
    manufacturer: 'bytedance',
    independenceClaim: 'channel_level',
  },
  // Video — shared Seedance manufacturer → channel-level only
  {
    modality: 'video',
    operation: 'video.generate',
    channelKind: 'official_direct',
    providerModel: 'doubao-seedance-1-5-pro-251215',
    modelEnv: 'ARK_SEEDANCE_MODEL',
    credentialEnvHints: ['ARK_API_KEY', 'ARK_BASE_URL'],
    catalogModelId: 'seedance-1-5-pro',
    providerProfileId: 'pp-volcengine-ark',
    manufacturer: 'bytedance',
    independenceClaim: 'channel_level',
  },
  {
    modality: 'video',
    operation: 'video.generate',
    channelKind: 'upstream_reseller',
    providerModel: 'doubao-seedance-1-5-pro_720p',
    modelEnv: 'TUZI_SEEDANCE_MODEL',
    credentialEnvHints: ['TUZI_API_KEY', 'TUZI_BASE_URL'],
    catalogModelId: 'seedance-1-5-pro',
    providerProfileId: 'pp-tuzi-upstream',
    manufacturer: 'bytedance',
    independenceClaim: 'channel_level',
  },
] as const;

export function matrixModelsForOperation(
  operation: SupplyOperation,
): DualChannelMatrixModel[] {
  return DUAL_CHANNEL_MATRIX_MODELS.filter((m) => m.operation === operation);
}

export function matrixModelsForModality(
  modality: FaultInjectionModality,
): DualChannelMatrixModel[] {
  return DUAL_CHANNEL_MATRIX_MODELS.filter((m) => m.modality === modality);
}

/** Secondary ops share primary channel models; single-channel/no-fallback. */
export const SECONDARY_MATRIX_NOTES = {
  'copy.adapt': {
    minLiveVerified: 1,
    channelLabel: 'single-channel/no-fallback',
    preferredModelEnv: 'ARK_TEXT_MODEL',
  },
  'text.respond': {
    minLiveVerified: 1,
    channelLabel: 'single-channel/no-fallback',
    preferredModelEnv: 'ARK_TEXT_MODEL',
  },
  'image.edit': {
    minLiveVerified: 1,
    channelLabel: 'single-channel/no-fallback',
    preferredModelEnv: 'ARK_SEEDREAM_MODEL',
  },
} as const;
