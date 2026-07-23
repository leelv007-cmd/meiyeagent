/**
 * Project real Provider live-gate evidence into runtime-truth judgments.
 *
 * Honesty rules (#146 / D-069 / D-080 C5):
 * - recorded / fixture / token-only evidence never becomes live_verified
 * - evidence must bind commit, environment, config revision, cost, expiry
 * - expired or wrong-commit evidence fails closed
 * - single official channel → single-channel/no-fallback (never multi-channel ready)
 * - readiness and capabilities must share this projection
 */

import type {
  InternalCapabilityEvidence,
  InternalCapabilityRecord,
  MerchantChannelMode,
  ReadinessCheckResult,
} from './types.js';

export const CORE_GENERATION_CAPABILITIES = [
  'generation_copy',
  'generation_image',
  'generation_video',
] as const;

export type CoreGenerationCapabilityId =
  (typeof CORE_GENERATION_CAPABILITIES)[number];

export const OPERATION_TO_CAPABILITY = {
  'copy.generate': 'generation_copy',
  'image.generate': 'generation_image',
  'video.generate': 'generation_video',
} as const;

export type CoreProviderOperation = keyof typeof OPERATION_TO_CAPABILITY;

export type ProviderPublishGateStatus =
  | 'single_channel'
  | 'multi_channel_ready'
  | 'not_verified'
  | 'blocked'
  | 'missing';

export interface ProviderOperationJudgment {
  capabilityId: CoreGenerationCapabilityId;
  channelLabel: string;
  channelMode: MerchantChannelMode;
  costCny?: number;
  liveVerified: boolean;
  operation: CoreProviderOperation;
  publishGateStatus: ProviderPublishGateStatus;
  reason?: string;
}

export interface ProviderEvidenceJudgment {
  acceptanceMode?: 'primary_connectivity' | 'dual_channel_conformance' | string;
  configurationRevision?: string;
  effectiveConfigurationSha256?: string;
  environment?: string;
  expiresAt?: string;
  operations: ProviderOperationJudgment[];
  /** True only when all three core modalities are live_verified and current. */
  primaryConnectivityReady: boolean;
  reason?: string;
  releaseRef?: string;
  runNonce?: string;
  valid: boolean;
}

export interface AssistedEvidenceHint {
  /** Capability ids that have a usable assisted / recorded path (not live). */
  assistedPathAvailable?: Partial<
    Record<CoreGenerationCapabilityId, boolean>
  >;
  /** Capability ids that completed recorded verification only. */
  recordedVerified?: Partial<Record<CoreGenerationCapabilityId, boolean>>;
}

const SECRET_LEAK_PATTERNS = [
  /sk-[A-Za-z0-9]{16,}/u,
  /Bearer\s+[A-Za-z0-9._-]{16,}/iu,
  /"api[_-]?key"\s*:\s*"[^"]{8,}"/iu,
  /ARK_(?:TEXT_)?API_KEY\s*[:=]\s*\S+/u,
];

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/u;

export function isCoreProviderOperation(
  value: string,
): value is CoreProviderOperation {
  return Object.prototype.hasOwnProperty.call(OPERATION_TO_CAPABILITY, value);
}

/**
 * Validate and judge a provider-live-gate.json (or equivalent) report.
 * Does not invent multi-channel claims. Missing fields fail closed.
 */
export function judgeProviderLiveEvidence(input: {
  expectedCommitSha: string;
  now?: Date;
  report: unknown;
  requireAcceptanceMode?: 'primary_connectivity' | 'dual_channel_conformance';
}): ProviderEvidenceJudgment {
  const now = input.now ?? new Date();
  const expectedCommit = input.expectedCommitSha.trim();
  if (!Number.isFinite(now.getTime())) {
    return invalidJudgment('Provider live evidence requires a valid current clock.');
  }
  if (!COMMIT_SHA_PATTERN.test(expectedCommit)) {
    return invalidJudgment(
      'A full 40-character release commit is required to bind provider live evidence.',
    );
  }

  if (!isRecord(input.report)) {
    return invalidJudgment('Provider live evidence must be a JSON object.');
  }
  const report = input.report;

  // Incomplete / preflight artifacts are never release evidence.
  if (report.complete === false || report.status === 'preflight_pending') {
    return invalidJudgment(
      'Provider live evidence is incomplete (preflight or probes still running).',
    );
  }

  const leak = findSecretLeak(report);
  if (leak) {
    return invalidJudgment(
      `Provider live evidence appears to contain a secret pattern (${leak}); refuse projection.`,
    );
  }

  const releaseRef =
    asNonEmptyString(report.releaseRef) ??
    asNonEmptyString(report.releaseCommitSha);
  const environment = asNonEmptyString(report.environment);
  const configurationRevision = asNonEmptyString(
    report.configurationRevision,
  );
  const effectiveConfigurationSha256 = asSha256(
    report.effectiveConfigurationSha256,
  );
  const runNonce = asNonEmptyString(report.runNonce);
  const acceptanceMode = asNonEmptyString(report.acceptanceMode);
  const completedAt = asIsoTimestamp(report.completedAt);
  const expiresAt = asIsoTimestamp(report.expiresAt);
  const startedAt = asIsoTimestamp(report.startedAt);
  const context = {
    acceptanceMode,
    configurationRevision,
    effectiveConfigurationSha256,
    environment,
    expiresAt,
    releaseRef,
    runNonce,
  };

  if (!releaseRef || !environment || !configurationRevision || !runNonce) {
    return invalidJudgment(
      'Provider live evidence missing releaseRef, environment, configurationRevision, or runNonce.',
      context,
    );
  }
  if (!COMMIT_SHA_PATTERN.test(releaseRef)) {
    return invalidJudgment(
      'Provider live evidence releaseRef must be a full 40-character commit SHA.',
      context,
    );
  }
  if (!completedAt || !expiresAt || !startedAt) {
    return invalidJudgment(
      'Provider live evidence missing startedAt/completedAt/expiresAt timestamps.',
      context,
    );
  }
  if (!effectiveConfigurationSha256) {
    return invalidJudgment(
      'Provider live evidence missing a valid effectiveConfigurationSha256.',
      context,
    );
  }
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    return invalidJudgment(
      'Provider live evidence completed before it started.',
      context,
    );
  }
  if (Date.parse(expiresAt) <= Date.parse(completedAt)) {
    return invalidJudgment(
      'Provider live evidence expires before completion.',
      context,
    );
  }
  if (Date.parse(expiresAt) <= now.getTime()) {
    return invalidJudgment(
      `Provider live evidence expired at ${expiresAt}.`,
      context,
    );
  }
  if (releaseRef !== expectedCommit) {
    return invalidJudgment(
      `Provider live evidence releaseRef ${releaseRef} does not match commit ${expectedCommit}.`,
      context,
    );
  }
  if (
    input.requireAcceptanceMode &&
    acceptanceMode !== input.requireAcceptanceMode
  ) {
    return invalidJudgment(
      `Provider live evidence acceptanceMode=${acceptanceMode ?? 'missing'} (required ${input.requireAcceptanceMode}).`,
      context,
    );
  }

  if (
    !Array.isArray(report.blockedChecks) ||
    !Array.isArray(report.skippedOperations)
  ) {
    return invalidJudgment(
      'Provider live evidence must include blockedChecks and skippedOperations arrays.',
      context,
    );
  }
  if (
    report.blockedChecks.some((entry) => !isRecord(entry)) ||
    report.skippedOperations.some((entry) => !asNonEmptyString(entry))
  ) {
    return invalidJudgment(
      'Provider live evidence contains malformed blocked or skipped checks.',
      context,
    );
  }
  if (report.blockedChecks.length > 0 || report.skippedOperations.length > 0) {
    return invalidJudgment(
      'Provider live evidence contains blockedChecks or skippedOperations; release projection fails closed globally.',
      context,
    );
  }
  if (
    !Array.isArray(report.activationEvidence) ||
    !Array.isArray(report.probes) ||
    !Array.isArray(report.publishGates)
  ) {
    return invalidJudgment(
      'Provider live evidence must include activationEvidence, probes, and publishGates arrays.',
      context,
    );
  }
  const actualCost = actualCostLedger(report.actualCost);
  if (!actualCost) {
    return invalidJudgment(
      'Provider live evidence is missing a valid bounded CNY actualCost ledger.',
      context,
    );
  }

  const activationByOperation = indexActivationEvidence(report.activationEvidence);
  const gateByOperation = indexPublishGates(report.publishGates);

  const operations: ProviderOperationJudgment[] = (
    Object.keys(OPERATION_TO_CAPABILITY) as CoreProviderOperation[]
  ).map((operation) => {
    const capabilityId = OPERATION_TO_CAPABILITY[operation];
    const activation = activationByOperation.get(operation);
    const gate = gateByOperation.get(operation);
    if (!activation || activation.activationStatus !== 'live_verified') {
      return {
        operation,
        capabilityId,
        liveVerified: false,
        publishGateStatus: gate?.status ?? 'missing',
        channelMode: 'none',
        channelLabel: 'not_verified',
        reason: 'No current live_verified official activation evidence.',
      } satisfies ProviderOperationJudgment;
    }

    if (activation.channelKind !== 'official_direct') {
      return {
        operation,
        capabilityId,
        liveVerified: false,
        publishGateStatus: gate?.status ?? 'not_verified',
        channelMode: 'none',
        channelLabel: 'not_verified',
        reason: 'Primary release path requires official_direct channel evidence.',
      } satisfies ProviderOperationJudgment;
    }

    const activationIssue = activationEvidenceIssue(activation);
    if (activationIssue) {
      return {
        operation,
        capabilityId,
        liveVerified: false,
        publishGateStatus: gate?.status ?? 'not_verified',
        channelMode: 'none',
        channelLabel: 'not_verified',
        reason: activationIssue,
      } satisfies ProviderOperationJudgment;
    }

    const probe = findMatchingAcceptedProbe(
      report.probes,
      operation,
      activation,
    );
    if (!probe) {
      return {
        operation,
        capabilityId,
        liveVerified: false,
        publishGateStatus: gate?.status ?? 'not_verified',
        channelMode: 'none',
        channelLabel: 'not_verified',
        reason:
          'No accepted, CNY-costed provider result matches the live activation.',
      } satisfies ProviderOperationJudgment;
    }
    const costCny = probe.costCny;

    if (!gate || !gate.publishAllowed) {
      return {
        operation,
        capabilityId,
        liveVerified: false,
        publishGateStatus: gate?.status ?? 'missing',
        channelMode: 'none',
        channelLabel: gate?.channelLabel ?? 'not_verified',
        reason: 'Publish gate did not allow this operation.',
        costCny,
      } satisfies ProviderOperationJudgment;
    }

    // Multi-channel ready only when the gate explicitly says so with ≥2 domains.
    if (gate.status === 'multi_channel_ready' && gate.multiChannelReady) {
      if ((gate.independentFaultDomainCount ?? 0) < 2) {
        return {
          operation,
          capabilityId,
          liveVerified: true,
          publishGateStatus: 'single_channel',
          channelMode: 'single_channel',
          channelLabel: 'single-channel/no-fallback',
          reason:
            'Gate claimed multi-channel without two independent fault domains; demoted to single-channel.',
          costCny,
        } satisfies ProviderOperationJudgment;
      }
      return {
        operation,
        capabilityId,
        liveVerified: true,
        publishGateStatus: 'multi_channel_ready',
        channelMode: 'multi_channel',
        channelLabel: gate.channelLabel || 'multi-channel ready',
        costCny,
      } satisfies ProviderOperationJudgment;
    }

    if (gate.status === 'single_channel') {
      if (gate.multiChannelReady) {
        return {
          operation,
          capabilityId,
          liveVerified: false,
          publishGateStatus: 'not_verified',
          channelMode: 'none',
          channelLabel: 'not_verified',
          reason:
            'Single-channel gate cannot simultaneously claim multi-channel readiness.',
          costCny,
        } satisfies ProviderOperationJudgment;
      }
      return {
        operation,
        capabilityId,
        liveVerified: true,
        publishGateStatus: 'single_channel',
        channelMode: 'single_channel',
        channelLabel:
          gate.channelLabel || 'single-channel/no-fallback',
        costCny,
      } satisfies ProviderOperationJudgment;
    }

    return {
      operation,
      capabilityId,
      liveVerified: false,
      publishGateStatus: gate.status,
      channelMode: 'none',
      channelLabel: gate.channelLabel || 'not_verified',
      reason: `Publish gate status ${gate.status} is not release-ready.`,
      costCny,
    } satisfies ProviderOperationJudgment;
  });

  const primaryConnectivityReady = operations.every(
    (entry) => entry.liveVerified,
  );
  const verifiedCoreCostCny = operations.reduce(
    (sum, entry) => sum + (entry.liveVerified ? (entry.costCny ?? 0) : 0),
    0,
  );
  if (
    primaryConnectivityReady &&
    actualCost.providerProbeCny + 1e-9 < verifiedCoreCostCny
  ) {
    return invalidJudgment(
      'Provider live actualCost does not cover the accepted core probe CNY costs.',
      context,
    );
  }
  const reason = primaryConnectivityReady
    ? undefined
    : `Missing live_verified official evidence for: ${operations
        .filter((entry) => !entry.liveVerified)
        .map((entry) => entry.operation)
        .join(', ')}`;

  return {
    valid: primaryConnectivityReady,
    primaryConnectivityReady,
    acceptanceMode,
    configurationRevision,
    effectiveConfigurationSha256,
    environment,
    expiresAt,
    releaseRef,
    runNonce,
    operations,
    ...(reason ? { reason } : {}),
  };
}

/**
 * Project judgment (+ optional assisted/recorded hints) into internal capability
 * records. Merchant projection must still run through projectMerchantCapabilities.
 */
export function projectCapabilityRecordsFromProviderEvidence(input: {
  assisted?: AssistedEvidenceHint;
  judgment: ProviderEvidenceJudgment;
}): InternalCapabilityRecord[] {
  const purposeById: Record<CoreGenerationCapabilityId, string> = {
    generation_copy: '文案生成',
    generation_image: '图片生成',
    generation_video: '视频生成',
  };

  return CORE_GENERATION_CAPABILITIES.map((capabilityId) => {
    const operation = input.judgment.operations.find(
      (entry) => entry.capabilityId === capabilityId,
    );
    const evidence: InternalCapabilityEvidence[] = ['implemented'];
    let channelMode: MerchantChannelMode = 'none';

    if (operation?.liveVerified) {
      evidence.push('live_verified');
      channelMode = operation.channelMode;
    } else if (input.assisted?.recordedVerified?.[capabilityId]) {
      // recorded is assisted only — never live_verified
      evidence.push('recorded_verified');
    }

    const assistedPathAvailable =
      input.assisted?.assistedPathAvailable?.[capabilityId] === true ||
      evidence.includes('recorded_verified');

    return {
      id: capabilityId,
      purpose: purposeById[capabilityId],
      evidence,
      channelMode,
      ...(assistedPathAvailable ? { assistedPathAvailable: true } : {}),
      ...(operation?.channelLabel && channelMode !== 'none'
        ? { channelLabel: operation.channelLabel }
        : channelMode === 'single_channel'
          ? { channelLabel: 'single-channel/no-fallback' }
          : {}),
    } satisfies InternalCapabilityRecord;
  });
}

/** Shared readiness check derived from the same judgment as capabilities. */
export function providerLiveEvidenceReadiness(
  judgment: ProviderEvidenceJudgment,
): ReadinessCheckResult {
  if (judgment.primaryConnectivityReady && judgment.valid) {
    return {
      name: 'providerLive',
      status: 'pass',
      detail: `Primary connectivity live evidence current through ${judgment.expiresAt} for commit ${judgment.releaseRef}.`,
    };
  }
  return {
    name: 'providerLive',
    status: 'fail',
    detail:
      judgment.reason ??
      'Provider live evidence is missing, expired, unbound, or incomplete.',
  };
}

export function defaultProviderLiveEvidencePath(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const explicit = env.PROVIDER_LIVE_EVIDENCE_PATH?.trim();
  if (explicit) return explicit;
  const dir = env.PROVIDER_LIVE_EVIDENCE_DIR?.trim();
  if (dir) {
    return dir.endsWith('provider-live-gate.json')
      ? dir
      : `${dir.replace(/\/$/u, '')}/provider-live-gate.json`;
  }
  return undefined;
}

function invalidJudgment(
  reason: string,
  partial: Partial<ProviderEvidenceJudgment> = {},
): ProviderEvidenceJudgment {
  return {
    valid: false,
    primaryConnectivityReady: false,
    reason,
    operations: (
      Object.keys(OPERATION_TO_CAPABILITY) as CoreProviderOperation[]
    ).map((operation) => ({
      operation,
      capabilityId: OPERATION_TO_CAPABILITY[operation],
      liveVerified: false,
      publishGateStatus: 'missing',
      channelMode: 'none',
      channelLabel: 'not_verified',
      reason,
    })),
    ...partial,
  };
}

interface IndexedActivationEvidence {
  activationStatus: string;
  adapterExecuted: boolean;
  catalogModelId?: string;
  channelKind?: string;
  deploymentId?: string;
  evidenceRef?: string;
  providerCallSucceeded: boolean;
  providerProfileId?: string;
  verifiedAt?: string;
}

function indexActivationEvidence(
  value: unknown,
): Map<string, IndexedActivationEvidence> {
  const map = new Map<string, IndexedActivationEvidence>();
  if (!Array.isArray(value)) return map;
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const operation = asNonEmptyString(entry.operation);
    const activationStatus = asNonEmptyString(entry.activationStatus);
    if (!operation || !activationStatus) continue;
    const candidate: IndexedActivationEvidence = {
      activationStatus,
      adapterExecuted: entry.adapterExecuted === true,
      providerCallSucceeded: entry.providerCallSucceeded === true,
      ...(asNonEmptyString(entry.channelKind)
        ? { channelKind: asNonEmptyString(entry.channelKind) }
        : {}),
      ...(asNonEmptyString(entry.deploymentId)
        ? { deploymentId: asNonEmptyString(entry.deploymentId) }
        : {}),
      ...(asNonEmptyString(entry.catalogModelId)
        ? { catalogModelId: asNonEmptyString(entry.catalogModelId) }
        : {}),
      ...(asNonEmptyString(entry.providerProfileId)
        ? { providerProfileId: asNonEmptyString(entry.providerProfileId) }
        : {}),
      ...(asNonEmptyString(entry.evidenceRef)
        ? { evidenceRef: asNonEmptyString(entry.evidenceRef) }
        : {}),
      ...(asIsoTimestamp(entry.verifiedAt)
        ? { verifiedAt: asIsoTimestamp(entry.verifiedAt) }
        : {}),
    };
    const existing = map.get(operation);
    if (!existing || activationScore(candidate) > activationScore(existing)) {
      map.set(operation, candidate);
    }
  }
  return map;
}

function activationScore(value: IndexedActivationEvidence): number {
  return (
    (value.activationStatus === 'live_verified' ? 64 : 0) +
    (value.channelKind === 'official_direct' ? 32 : 0) +
    (value.adapterExecuted ? 16 : 0) +
    (value.providerCallSucceeded ? 8 : 0) +
    (value.deploymentId ? 4 : 0) +
    (value.catalogModelId ? 2 : 0) +
    (value.providerProfileId ? 1 : 0)
  );
}

function activationEvidenceIssue(
  value: IndexedActivationEvidence,
): string | undefined {
  if (
    !value.deploymentId ||
    !value.catalogModelId ||
    !value.providerProfileId ||
    !value.evidenceRef ||
    !value.verifiedAt
  ) {
    return 'Live activation is missing provider, catalog, route, or timestamp evidence.';
  }
  if (!value.adapterExecuted || !value.providerCallSucceeded) {
    return 'Live activation does not prove an executed, successful provider call.';
  }
  return undefined;
}

function findMatchingAcceptedProbe(
  value: unknown,
  operation: string,
  activation: IndexedActivationEvidence,
): { costCny: number } | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    if (
      entry.operation !== operation ||
      entry.channelKind !== 'official_direct' ||
      entry.deploymentId !== activation.deploymentId ||
      entry.catalogModelId !== activation.catalogModelId ||
      entry.providerProfileId !== activation.providerProfileId ||
      entry.adapterExecuted !== true ||
      entry.providerCallSucceeded !== true ||
      entry.acceptance !== 'accepted' ||
      !asNonEmptyString(entry.providerTaskRef) ||
      entry.evidenceRef !== activation.evidenceRef ||
      !asIsoTimestamp(entry.observedAt) ||
      !isRecord(entry.lifecycle) ||
      entry.lifecycle.submitted !== true ||
      !isRecord(entry.providerCost)
    ) {
      continue;
    }
    const costCny = providerCostCny(entry.providerCost);
    if (costCny === undefined || costCny < 0) continue;
    return { costCny };
  }
  return undefined;
}

function providerCostCny(value: Record<string, unknown>): number | undefined {
  return (
    asFiniteNumber(value.amountCny) ??
    (value.currency === 'CNY' ? asFiniteNumber(value.amount) : undefined)
  );
}

function actualCostLedger(
  value: unknown,
):
  | {
      capCny: number;
      externalEvidenceCny: number;
      providerProbeCny: number;
      totalCny: number;
    }
  | undefined {
  if (!isRecord(value)) return undefined;
  const providerProbeCny = asFiniteNumber(value.providerProbeCny);
  const externalEvidenceCny = asFiniteNumber(value.externalEvidenceCny);
  const totalCny = asFiniteNumber(value.totalCny);
  const capCny = asFiniteNumber(value.capCny);
  if (
    providerProbeCny !== undefined &&
    providerProbeCny >= 0 &&
    externalEvidenceCny !== undefined &&
    externalEvidenceCny >= 0 &&
    totalCny !== undefined &&
    totalCny >= 0 &&
    capCny !== undefined &&
    capCny > 0 &&
    totalCny <= capCny &&
    Math.abs(totalCny - providerProbeCny - externalEvidenceCny) < 1e-9
  ) {
    return { capCny, externalEvidenceCny, providerProbeCny, totalCny };
  }
  return undefined;
}

function indexPublishGates(value: unknown): Map<
  string,
  {
    channelLabel?: string;
    independentFaultDomainCount?: number;
    multiChannelReady?: boolean;
    publishAllowed?: boolean;
    status: ProviderPublishGateStatus;
  }
> {
  const map = new Map<
    string,
    {
      channelLabel?: string;
      independentFaultDomainCount?: number;
      multiChannelReady?: boolean;
      publishAllowed?: boolean;
      status: ProviderPublishGateStatus;
    }
  >();
  if (!Array.isArray(value)) return map;
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const operation = asNonEmptyString(entry.operation);
    const status = asPublishGateStatus(entry.status);
    if (!operation || !status) continue;
    map.set(operation, {
      status,
      publishAllowed: entry.publishAllowed === true,
      multiChannelReady: entry.multiChannelReady === true,
      independentFaultDomainCount: asFiniteNumber(
        entry.independentFaultDomainCount,
      ),
      channelLabel: asNonEmptyString(entry.channelLabel),
    });
  }
  return map;
}

function findSecretLeak(value: unknown): string | undefined {
  const blob = JSON.stringify(value);
  for (const pattern of SECRET_LEAK_PATTERNS) {
    if (pattern.test(blob)) return pattern.source;
  }
  return undefined;
}

function asPublishGateStatus(
  value: unknown,
): ProviderPublishGateStatus | undefined {
  if (
    value === 'single_channel' ||
    value === 'multi_channel_ready' ||
    value === 'not_verified' ||
    value === 'blocked'
  ) {
    return value;
  }
  return undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return Number.isFinite(Date.parse(value)) ? value : undefined;
}

function asSha256(value: unknown): string | undefined {
  const normalized = asNonEmptyString(value);
  return normalized && SHA256_PATTERN.test(normalized) ? normalized : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
