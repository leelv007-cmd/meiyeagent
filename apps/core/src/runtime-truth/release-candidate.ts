/**
 * Same-commit P0 release-candidate acceptance judgment (#147).
 * Fail closed when live evidence, release identity, or manifest is incomplete.
 */

import { assertP0ReleaseCandidateManifest } from './release-identity.js';
import {
  assembleCapabilitiesFromProviderEvidence,
  type CapabilityAssemblyResult,
} from './capability-assembly.js';
import { assertMerchantOnlyStates, projectMerchantCapabilities } from './merchant-capabilities.js';
import type { P0ReleaseCandidateManifest } from './types.js';

export interface ReleaseCandidateAcceptanceInput {
  expectedCommitSha: string;
  now?: Date;
  providerLiveReport: unknown | null | undefined;
  /** Staging-produced four-unit evidence artifact; unit-only input is not RC proof. */
  releaseManifest?: P0ReleaseCandidateManifest;
  requireAcceptanceMode?: 'primary_connectivity' | 'dual_channel_conformance';
}

export interface ReleaseCandidateAcceptanceResult {
  assembly: CapabilityAssemblyResult;
  errors: string[];
  merchantCapabilitiesOk: boolean;
  ok: boolean;
  releaseManifest?: P0ReleaseCandidateManifest;
}

/**
 * Evaluate whether a candidate SHA may be marked P0 release candidate.
 * Missing live evidence is always a hard failure — no silent skip.
 */
export function evaluateReleaseCandidateAcceptance(
  input: ReleaseCandidateAcceptanceInput,
): ReleaseCandidateAcceptanceResult {
  const errors: string[] = [];
  const expectedCommitSha = input.expectedCommitSha.trim();
  if (!expectedCommitSha || expectedCommitSha === 'unknown') {
    errors.push('RELEASE_COMMIT_SHA is required for release-candidate acceptance.');
  }

  const releaseManifest = input.releaseManifest;
  if (!releaseManifest) {
    errors.push(
      'Staging release manifest (four units: web/core/worker/canvas) is required.',
    );
  } else {
    try {
      assertP0ReleaseCandidateManifest(
        releaseManifest,
        expectedCommitSha,
        input.now,
      );
    } catch (error) {
      errors.push(
        error instanceof Error
          ? error.message
          : 'Release manifest is not coherent.',
      );
    }
  }

  if (
    input.providerLiveReport === null ||
    input.providerLiveReport === undefined
  ) {
    errors.push(
      'Provider live evidence is required for release-candidate acceptance (fail closed).',
    );
  }

  const assembly = assembleCapabilitiesFromProviderEvidence({
    report: input.providerLiveReport ?? null,
    expectedCommitSha: expectedCommitSha || 'unknown',
    now: input.now,
    requireAcceptanceMode:
      input.requireAcceptanceMode ?? 'primary_connectivity',
  });

  if (!assembly.judgment.primaryConnectivityReady) {
    errors.push(
      assembly.judgment.reason ??
        'Provider live evidence is not primary-connectivity ready.',
    );
  }
  if (assembly.providerLiveReadiness.status !== 'pass') {
    errors.push(
      assembly.providerLiveReadiness.detail ??
        'providerLive readiness check failed.',
    );
  }

  // Multi-channel claims without two domains are already demoted; still refuse
  // any residual multi_channel_ready when independentFaultDomainCount < 2.
  for (const operation of assembly.judgment.operations) {
    if (
      operation.publishGateStatus === 'multi_channel_ready' &&
      operation.channelMode !== 'multi_channel'
    ) {
      errors.push(
        `${operation.operation}: multi-channel claim rejected without independent fault domains.`,
      );
    }
  }

  let merchantCapabilitiesOk = false;
  try {
    const snapshot = projectMerchantCapabilities({
      records: assembly.capabilityRecords,
      release: { commitSha: expectedCommitSha || 'unknown' },
    });
    assertMerchantOnlyStates(snapshot);
    const verified = snapshot.capabilities.filter(
      (entry) => entry.state === 'verified',
    );
    if (verified.length < 3) {
      errors.push(
        `Merchant capabilities projected ${verified.length}/3 verified generation modalities.`,
      );
    }
    for (const capability of verified) {
      if (
        capability.channelMode === 'single_channel' &&
        capability.channelLabel !== 'single-channel/no-fallback'
      ) {
        errors.push(
          `${capability.id}: single-channel verified capability missing single-channel/no-fallback label.`,
        );
      }
    }
    // Never allow internal evidence vocabulary on merchant surface.
    const blob = JSON.stringify(snapshot);
    for (const banned of [
      'implemented',
      'recorded_verified',
      'live_verified',
      'merchant_validated',
    ]) {
      if (blob.includes(banned)) {
        errors.push(`Merchant capability snapshot leaked ${banned}.`);
      }
    }
    merchantCapabilitiesOk = verified.length === 3;
  } catch (error) {
    errors.push(
      error instanceof Error
        ? error.message
        : 'Merchant capability projection failed.',
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    assembly,
    merchantCapabilitiesOk,
    ...(releaseManifest ? { releaseManifest } : {}),
  };
}
