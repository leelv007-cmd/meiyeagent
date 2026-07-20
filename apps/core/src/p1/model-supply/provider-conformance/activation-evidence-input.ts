/**
 * Build ActivationEvidenceInput from text channel conformance results.
 * G Deployment publish gates will consume this shape later — no persistence here.
 */
import type { ActivationEvidenceStatus } from '@meiye/contracts';
import { mappingConfidenceMeetsActivationGate } from './mapping-confidence.js';
import type {
  ActivationEvidenceInput,
  TextChannelConformanceResult,
  TextDualChannelConformanceResult,
} from './types.js';

export function activationStatusFromChannelResult(
  channel: TextChannelConformanceResult
): ActivationEvidenceStatus {
  if (!channel.passed) return 'documented';
  if (channel.evidenceKind === 'live_provider') {
    return mappingConfidenceMeetsActivationGate(channel.mappingConfidence)
      ? 'live_verified'
      : 'recorded';
  }
  return 'recorded';
}

export function toActivationEvidenceInput(
  dual: Pick<TextDualChannelConformanceResult, 'id' | 'operation'>,
  channel: TextChannelConformanceResult
): ActivationEvidenceInput {
  const failedCheckIds = channel.checks
    .filter((check) => !check.passed)
    .map((check) => check.checkId);
  return {
    deploymentId: channel.deploymentId,
    catalogModelId: channel.catalogModelId,
    channelKind: channel.channelKind,
    status: activationStatusFromChannelResult(channel),
    verifiedAt: channel.observedAt,
    evidenceRef: `provider-conformance:${dual.id}:${channel.id}`,
    configurationRevision: channel.configurationRevision,
    mappingConfidence: channel.mappingConfidence,
    gatewayFingerprint: channel.gatewayFingerprint,
    conformance: {
      resultId: dual.id,
      channelResultId: channel.id,
      operation: dual.operation,
      passed: channel.passed,
      checkIds: channel.checks.map((check) => check.checkId),
      failedCheckIds,
      evidenceKind: channel.evidenceKind,
    },
  };
}

export function buildActivationEvidenceInputs(
  dual: TextDualChannelConformanceResult
): ActivationEvidenceInput[] {
  return dual.channels.map((channel) =>
    toActivationEvidenceInput(dual, channel)
  );
}

/**
 * Publish-gate helper: dual-channel ready requires both channel kinds with
 * activation status at least `recorded` (live_verified preferred for production).
 */
export function dualChannelActivationGateReady(
  inputs: readonly ActivationEvidenceInput[],
  options: { requireLiveVerified?: boolean } = {}
): boolean {
  const requireLive = options.requireLiveVerified ?? false;
  const statusOk = (status: ActivationEvidenceStatus) =>
    requireLive
      ? status === 'live_verified'
      : status === 'live_verified' || status === 'recorded';
  const official = inputs.some(
    (input) =>
      input.channelKind === 'official_direct' &&
      input.conformance.passed &&
      statusOk(input.status)
  );
  const reseller = inputs.some(
    (input) =>
      input.channelKind === 'upstream_reseller' &&
      input.conformance.passed &&
      statusOk(input.status)
  );
  return official && reseller;
}
