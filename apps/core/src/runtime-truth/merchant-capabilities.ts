import type {
  InternalCapabilityRecord,
  MerchantCapabilitiesSnapshot,
  MerchantCapability,
  MerchantCapabilityState,
  MerchantChannelMode,
  ReleaseIdentity,
} from './types.js';

/**
 * Project internal evidence layers to merchant three-state only.
 *
 * Rules (fail closed toward honesty):
 * - merchant_validated or live_verified → verified
 * - recorded_verified, or implemented with assisted path → assisted
 * - implemented alone is not merchant-usable → unavailable
 * - empty / disabled → unavailable
 */
export function projectMerchantCapability(
  record: InternalCapabilityRecord,
): MerchantCapability {
  const evidence = new Set(record.evidence);
  const state = merchantStateFromEvidence(evidence, record.assistedPathAvailable);
  const channelMode =
    state === 'verified' ? (record.channelMode ?? 'none') : 'none';
  const channelLabel =
    state === 'verified'
      ? sanitizeChannelLabel(record.channelLabel, channelMode)
      : undefined;
  return {
    id: record.id,
    state,
    safeExplanation: safeExplanationFor(state, record, channelMode),
    ...(channelMode !== 'none' ? { channelMode } : {}),
    ...(channelLabel ? { channelLabel } : {}),
  };
}

export function projectMerchantCapabilities(input: {
  records: InternalCapabilityRecord[];
  release?: ReleaseIdentity;
}): MerchantCapabilitiesSnapshot {
  return {
    evidencePolicy: 'merchant_three_state_only',
    capabilities: input.records.map(projectMerchantCapability),
    ...(input.release ? { release: input.release } : {}),
  };
}

function merchantStateFromEvidence(
  evidence: ReadonlySet<string>,
  assistedPathAvailable: boolean | undefined,
): MerchantCapabilityState {
  if (evidence.has('merchant_validated') || evidence.has('live_verified')) {
    return 'verified';
  }
  if (evidence.has('recorded_verified')) {
    return 'assisted';
  }
  if (evidence.has('implemented') && assistedPathAvailable) {
    return 'assisted';
  }
  return 'unavailable';
}

function safeExplanationFor(
  state: MerchantCapabilityState,
  record: InternalCapabilityRecord,
  channelMode: MerchantChannelMode = 'none',
): string {
  const purpose = record.purpose?.trim();
  switch (state) {
    case 'verified': {
      const base = purpose
        ? `${purpose}已通过线上验证，可直接使用。`
        : '该能力已通过线上验证，可直接使用。';
      if (channelMode === 'single_channel') {
        return `${base}当前为单渠道 / 无回退（single-channel/no-fallback）。`;
      }
      if (channelMode === 'multi_channel') {
        return `${base}已具备多渠道容灾。`;
      }
      return base;
    }
    case 'assisted':
      return purpose
        ? `${purpose}可在辅助流程下使用，尚不可自动闭环。`
        : '该能力可在辅助流程下使用，尚不可自动闭环。';
    case 'unavailable':
      return purpose
        ? `${purpose}当前不可用。`
        : '该能力当前不可用。';
  }
}

function sanitizeChannelLabel(
  label: string | undefined,
  channelMode: MerchantChannelMode | undefined,
): string | undefined {
  if (channelMode === 'single_channel') {
    return 'single-channel/no-fallback';
  }
  if (channelMode === 'multi_channel') {
    const trimmed = label?.trim();
    if (
      trimmed &&
      !trimmed.includes('live_verified') &&
      !trimmed.includes('recorded_verified') &&
      !trimmed.includes('implemented') &&
      !trimmed.includes('merchant_validated')
    ) {
      return trimmed;
    }
    return 'multi-channel ready';
  }
  return undefined;
}

/** Guard: merchant payloads must never leak internal evidence vocabulary. */
export function assertMerchantOnlyStates(
  snapshot: MerchantCapabilitiesSnapshot,
): void {
  for (const capability of snapshot.capabilities) {
    if (
      capability.state !== 'verified' &&
      capability.state !== 'assisted' &&
      capability.state !== 'unavailable'
    ) {
      throw new Error(
        `Illegal merchant capability state for ${capability.id}: ${String(capability.state)}`,
      );
    }
    const blob = JSON.stringify(capability);
    for (const banned of [
      'implemented',
      'recorded_verified',
      'live_verified',
      'merchant_validated',
    ] as const) {
      if (blob.includes(banned)) {
        throw new Error(
          `Merchant capability ${capability.id} leaked internal evidence ${banned}.`,
        );
      }
    }
  }
}
