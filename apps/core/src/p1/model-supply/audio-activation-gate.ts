import {
  isLiveVerifiedActivationEvidence,
  type ActivationEvidence,
} from './catalog.js';
import type { ModelDeployment, ModelOperation } from './index.js';

/**
 * Production fail-closed activation gate for audio.speech / audio.sfx.
 *
 * No path here fabricates live probe success or approved prices. Ticket 11
 * (speech) may open only with a real provider deployment, approved unit price,
 * price revision, and matching live_verified probe evidence. Ticket 12 (SFX)
 * has no real provider selected yet, so production generation stays closed.
 */

export type AudioActivationBlocker =
  | 'catalog_inactive'
  | 'provider_not_selected'
  | 'approved_price_missing'
  | 'price_revision_missing'
  | 'live_probe_missing_or_failed';

export type AudioGenerationOperation = Extract<
  ModelOperation,
  'audio.speech' | 'audio.sfx'
>;

/** Fixture-only catalog models — never production-sellable activations. */
export const AUDIO_FIXTURE_CATALOG_MODEL_IDS = [
  'audio-speech-fixture',
  'audio-sfx-fixture',
] as const;

/** Real speech provider model once priced + live-verified. */
export const AUDIO_SPEECH_PROVIDER_CATALOG_MODEL_ID = 'seed-tts-2';

/**
 * Real SFX provider catalog model. Empty until an independent provider/model is
 * selected; absence is intentional fail-closed scaffolding (no fake credentials).
 */
export const AUDIO_SFX_PROVIDER_CATALOG_MODEL_ID: string | null = null;

export function isAudioGenerationOperation(
  operation: string,
): operation is AudioGenerationOperation {
  return operation === 'audio.speech' || operation === 'audio.sfx';
}

export function audioProductionActivationBlockers(input: {
  operation: AudioGenerationOperation;
  deployment?: Pick<
    ModelDeployment,
    | 'status'
    | 'catalogModelId'
    | 'unitPrice'
    | 'priceRevision'
    | 'activationEvidence'
  > | null;
  activationEvidence?: ActivationEvidence;
}): AudioActivationBlocker[] {
  const blockers: AudioActivationBlocker[] = [];
  const deployment = input.deployment ?? null;
  const evidence =
    input.activationEvidence ?? deployment?.activationEvidence;

  if (input.operation === 'audio.sfx') {
    if (!AUDIO_SFX_PROVIDER_CATALOG_MODEL_ID) {
      blockers.push('provider_not_selected');
    } else if (
      !deployment ||
      deployment.catalogModelId !== AUDIO_SFX_PROVIDER_CATALOG_MODEL_ID ||
      AUDIO_FIXTURE_CATALOG_MODEL_IDS.includes(
        deployment.catalogModelId as (typeof AUDIO_FIXTURE_CATALOG_MODEL_IDS)[number],
      )
    ) {
      blockers.push('provider_not_selected');
    }
  } else {
    if (
      !deployment ||
      deployment.catalogModelId !== AUDIO_SPEECH_PROVIDER_CATALOG_MODEL_ID ||
      AUDIO_FIXTURE_CATALOG_MODEL_IDS.includes(
        deployment.catalogModelId as (typeof AUDIO_FIXTURE_CATALOG_MODEL_IDS)[number],
      )
    ) {
      blockers.push('provider_not_selected');
    }
  }

  if (
    !deployment?.unitPrice ||
    !Number.isFinite(deployment.unitPrice.amountMicros) ||
    deployment.unitPrice.amountMicros < 0
  ) {
    blockers.push('approved_price_missing');
  }

  if (
    !deployment?.priceRevision?.trim() ||
    deployment.priceRevision.endsWith(':price-unavailable')
  ) {
    blockers.push('price_revision_missing');
  }

  if (!isLiveVerifiedActivationEvidence(evidence)) {
    blockers.push('live_probe_missing_or_failed');
  }

  if (!deployment || deployment.status !== 'active') {
    blockers.push('catalog_inactive');
  }

  return [...new Set(blockers)];
}

export function isAudioProductionGenerationAllowed(input: {
  operation: AudioGenerationOperation;
  deployment?: Parameters<typeof audioProductionActivationBlockers>[0]['deployment'];
  activationEvidence?: ActivationEvidence;
}): boolean {
  return audioProductionActivationBlockers(input).length === 0;
}
