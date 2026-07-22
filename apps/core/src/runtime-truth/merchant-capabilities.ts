import type {
  InternalCapabilityRecord,
  MerchantCapabilitiesSnapshot,
  MerchantCapability,
  MerchantCapabilityState,
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
  return {
    id: record.id,
    state,
    safeExplanation: safeExplanationFor(state, record),
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
): string {
  const purpose = record.purpose?.trim();
  switch (state) {
    case 'verified':
      return purpose
        ? `${purpose}已通过线上验证，可直接使用。`
        : '该能力已通过线上验证，可直接使用。';
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
