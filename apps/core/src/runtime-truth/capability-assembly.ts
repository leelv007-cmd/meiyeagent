/**
 * Assemble merchant capability records from provider live evidence + assisted hints.
 * Shared by readiness/capabilities so both consume one projection (#146).
 */

import { readFileSync } from 'node:fs';
import { releaseIdentityFromEnv } from './release-identity.js';
import {
  defaultProviderLiveEvidencePath,
  judgeProviderLiveEvidence,
  projectCapabilityRecordsFromProviderEvidence,
  providerLiveEvidenceReadiness,
  type AssistedEvidenceHint,
  type ProviderEvidenceJudgment,
} from './provider-evidence.js';
import type {
  InternalCapabilityRecord,
  ReadinessCheckResult,
  ReleaseIdentity,
} from './types.js';

export interface CapabilityAssemblyResult {
  capabilityRecords: InternalCapabilityRecord[];
  judgment: ProviderEvidenceJudgment;
  providerLiveReadiness: ReadinessCheckResult;
  release: ReleaseIdentity;
}

/**
 * Build capability records and the matching providerLive readiness check from
 * a live-gate report (or absence thereof). Fail closed toward honesty.
 */
export function assembleCapabilitiesFromProviderEvidence(input: {
  assisted?: AssistedEvidenceHint;
  expectedCommitSha: string;
  now?: Date;
  report: unknown | null | undefined;
  requireAcceptanceMode?: 'primary_connectivity' | 'dual_channel_conformance';
}): CapabilityAssemblyResult {
  const judgment = input.report
    ? judgeProviderLiveEvidence({
        report: input.report,
        expectedCommitSha: input.expectedCommitSha,
        now: input.now,
        requireAcceptanceMode: input.requireAcceptanceMode,
      })
    : judgeProviderLiveEvidence({
        report: null,
        expectedCommitSha: input.expectedCommitSha,
        now: input.now,
        requireAcceptanceMode: input.requireAcceptanceMode,
      });

  const capabilityRecords = projectCapabilityRecordsFromProviderEvidence({
    judgment,
    assisted: input.assisted,
  });

  return {
    judgment,
    capabilityRecords,
    providerLiveReadiness: providerLiveEvidenceReadiness(judgment),
    release: {
      commitSha: input.expectedCommitSha,
      ...(judgment.configurationRevision
        ? { configRevision: judgment.configurationRevision }
        : {}),
    },
  };
}

/**
 * Env-driven assembly for process wiring (main/worker handoff).
 *
 * Env:
 * - RELEASE_COMMIT_SHA / GITHUB_SHA / … via releaseIdentityFromEnv
 * - PROVIDER_LIVE_EVIDENCE_PATH or PROVIDER_LIVE_EVIDENCE_DIR
 * - PROVIDER_LIVE_REQUIRE_ACCEPTANCE_MODE (default primary_connectivity when path set)
 * - CAPABILITY_ASSISTED_PATHS=generation_copy,generation_image (optional)
 * - CAPABILITY_RECORDED_VERIFIED=generation_copy,... (optional; still not live_verified)
 */
export function assembleCapabilitiesFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: { now?: Date; reportOverride?: unknown } = {},
): CapabilityAssemblyResult {
  const release = releaseIdentityFromEnv(env);
  const evidencePath = defaultProviderLiveEvidencePath(env);
  let report: unknown | null = options.reportOverride ?? null;

  if (report === null && evidencePath) {
    try {
      report = JSON.parse(readFileSync(evidencePath, 'utf8')) as unknown;
    } catch (error) {
      report = {
        complete: false,
        status: 'evidence_unreadable',
        detail:
          error instanceof Error ? error.message : 'evidence file unreadable',
      };
    }
  }

  const requireMode =
    (env.PROVIDER_LIVE_REQUIRE_ACCEPTANCE_MODE?.trim() as
      | 'primary_connectivity'
      | 'dual_channel_conformance'
      | undefined) ||
    (evidencePath || env.PROVIDER_LIVE_REQUIRE_EVIDENCE === '1'
      ? 'primary_connectivity'
      : undefined);

  const assisted = assistedHintsFromEnv(env);

  const assembly = assembleCapabilitiesFromProviderEvidence({
    report,
    expectedCommitSha: release.commitSha,
    now: options.now,
    requireAcceptanceMode: requireMode,
    assisted,
  });
  return {
    ...assembly,
    release: {
      ...release,
      ...(assembly.judgment.configurationRevision
        ? { configRevision: assembly.judgment.configurationRevision }
        : {}),
    },
  };
}

function assistedHintsFromEnv(env: NodeJS.ProcessEnv): AssistedEvidenceHint {
  const parseList = (value: string | undefined) =>
    (value ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

  const assistedPathAvailable: AssistedEvidenceHint['assistedPathAvailable'] =
    {};
  const recordedVerified: AssistedEvidenceHint['recordedVerified'] = {};

  for (const id of parseList(env.CAPABILITY_ASSISTED_PATHS)) {
    if (
      id === 'generation_copy' ||
      id === 'generation_image' ||
      id === 'generation_video'
    ) {
      assistedPathAvailable[id] = true;
    }
  }
  for (const id of parseList(env.CAPABILITY_RECORDED_VERIFIED)) {
    if (
      id === 'generation_copy' ||
      id === 'generation_image' ||
      id === 'generation_video'
    ) {
      recordedVerified[id] = true;
    }
  }

  return { assistedPathAvailable, recordedVerified };
}
