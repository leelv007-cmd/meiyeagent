import type {
  ActivationEvidenceStatus,
  SupplyChannelKind,
  SupplyOperation,
} from '@meiye/contracts';
import {
  CORE_FAULT_INJECTION_OPERATIONS,
  FAULT_INJECTION_SCENARIOS,
  SECONDARY_FAULT_INJECTION_OPERATIONS,
  type FaultInjectionMatrixReport,
  type FaultInjectionModality,
  type FaultInjectionScenarioResult,
  type MultiChannelPublishGateResult,
  type QualifiedDeploymentEvidence,
} from './fault-injection/types.js';
import type { DualChannelMatrixModel } from './fault-injection/matrix-models.js';
import {
  evaluateMultiChannelPublishGate,
  qualifiedDeployment,
} from './fault-injection/publish-gate.js';

export type LiveProviderAdapterKind =
  | 'openai_compatible_llm'
  | 'ark_media'
  | 'tuzi_media';

export interface LiveProviderChannel {
  model: DualChannelMatrixModel;
  adapterKind: LiveProviderAdapterKind;
  /** Required when more than one channel shares the same modality/kind. */
  deploymentId?: string;
  accountIdentityFingerprint: string;
  endpointFingerprint: string;
  maxProbeCostUsd: number;
}

export interface LiveProviderProbeEvidence {
  operation: SupplyOperation;
  modality: FaultInjectionModality;
  channelKind: SupplyChannelKind;
  catalogModelId: string;
  providerProfileId: string;
  deploymentId: string;
  adapterKind: LiveProviderAdapterKind;
  accountIdentityFingerprint: string;
  endpointFingerprint: string;
  /** True only after calling the production adapter instance. */
  adapterExecuted: boolean;
  /** True only when that adapter returned accepted/completed provider evidence. */
  providerCallSucceeded: boolean;
  acceptance:
    | 'accepted'
    | 'acceptance_unknown'
    | 'rejected_before_accept';
  providerTaskRef?: string;
  providerCost: {
    amount: number;
    currency: 'CNY' | 'USD';
    amountUsd?: number;
    fx?: {
      cnyPerUsd: number;
      evidenceRef: string;
      observedAt: string;
    };
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      mediaUnits?: number;
    };
  };
  lifecycle: {
    submitted: boolean;
    recovered: boolean;
    pollStatus?: 'queued' | 'running' | 'completed' | 'failed' | 'unknown';
    downloaded: boolean;
    downloadedBytes?: number;
    contentType?: string;
    assetSha256?: string;
  };
  evidenceRef: string;
  observedAt: string;
  operationEvidence?: {
    operation: SupplyOperation;
    runNonce: string;
    requestIdempotencyKeySha256: string;
    requestPayloadSha256: string;
    resultPayloadSha256: string;
  };
  failureCode?: string;
  failureMessage?: string;
  failureDetailSha256?: string;
}

export interface LiveProviderActivationEvidence {
  operation: SupplyOperation;
  modality: FaultInjectionModality;
  channelKind: SupplyChannelKind;
  deploymentId: string;
  catalogModelId: string;
  providerProfileId: string;
  adapterKind: LiveProviderAdapterKind;
  activationStatus: ActivationEvidenceStatus;
  evidenceRef: string;
  verifiedAt: string;
  adapterExecuted: boolean;
  providerCallSucceeded: boolean;
  accountIdentityFingerprint: string;
  endpointFingerprint: string;
}

export interface LiveProviderBlockedCheck {
  operation: SupplyOperation;
  check:
    | 'catalog_model_alignment'
    | 'fault_domain_independence'
    | 'real_fault_injection'
    | 'complete_lifecycle_conformance'
    | 'secondary_live_verification';
  status: 'blocked';
  reason: string;
}

export interface LiveExternalCostEvidence {
  source: 'provider_live_cost_ledger';
  runNonce: string;
  evidenceRef: string;
  observedAt: string;
  amountUsd: number;
  currency: 'USD';
  components: Array<{
    kind:
      | 'secondary_probe'
      | 'lifecycle_probe'
      | 'fault_injection'
      | 'infrastructure';
    amountUsd: number;
    evidenceRef: string;
  }>;
}

export type LiveLifecycleCheckId =
  | 'protocol_completion'
  | 'error_normalization'
  | 'usage_evidence'
  | 'gateway_fingerprint'
  | 'mapping_confidence'
  | 'health_observation'
  | 'idempotent_submit'
  | 'cross_process_recover'
  | 'drain_without_restart'
  | 'cancel_confirmed'
  | 'late_terminal_reconciliation'
  | 'owned_asset_persistence';

export interface LiveProviderLifecycleEvidence {
  source: 'provider_lifecycle_injector';
  runNonce: string;
  evidenceRef: string;
  observedAt: string;
  operation: SupplyOperation;
  modality: FaultInjectionModality;
  channelKind: SupplyChannelKind;
  catalogModelId: string;
  providerProfileId: string;
  deploymentId: string;
  adapterKind: LiveProviderAdapterKind;
  accountIdentityFingerprint: string;
  endpointFingerprint: string;
  checks: Array<{
    checkId: LiveLifecycleCheckId;
    passed: boolean;
    evidenceRef: string;
  }>;
}

export interface LiveTransportFaultEvidence {
  source: 'provider_transport_injector';
  runNonce: string;
  evidenceRef: string;
  observedAt: string;
  operation: SupplyOperation;
  catalogModelId: string;
  officialDeploymentId: string;
  resellerDeploymentId: string;
  officialAccountIdentityFingerprint: string;
  officialEndpointFingerprint: string;
  resellerAccountIdentityFingerprint: string;
  resellerEndpointFingerprint: string;
  scenarios: Array<{
    scenarioId: FaultInjectionMatrixReport['scenarios'][number]['scenarioId'];
    transportInjectorExecuted: boolean;
    evidenceRefs: string[];
  }>;
  matrixReport: FaultInjectionMatrixReport;
}

export interface LiveProviderGateReport {
  observedAt: string;
  probes: LiveProviderProbeEvidence[];
  activationEvidence: LiveProviderActivationEvidence[];
  publishGates: MultiChannelPublishGateResult[];
  liveMatrixReports: FaultInjectionMatrixReport[];
  skippedOperations: SupplyOperation[];
  blockedChecks: LiveProviderBlockedCheck[];
  externalEvidenceRefs: string[];
  actualCost: {
    providerProbeUsd: number;
    externalEvidenceUsd: number;
    totalUsd: number;
    capUsd: number;
  };
}

export async function runLiveProviderGate(input: {
  channels: readonly LiveProviderChannel[];
  probe: (channel: LiveProviderChannel) => Promise<LiveProviderProbeEvidence>;
  onProbe?: (probes: readonly LiveProviderProbeEvidence[]) => Promise<void>;
  costCapUsd: number;
  externalEvidenceCostReservationUsd?: number;
  externalCostEvidence?: LiveExternalCostEvidence;
  runNonce?: string;
  secondaryProbes?: readonly LiveProviderProbeEvidence[];
  lifecycleEvidence?: readonly LiveProviderLifecycleEvidence[];
  transportFaultEvidence?: readonly LiveTransportFaultEvidence[];
}): Promise<LiveProviderGateReport> {
  const observedAt = new Date().toISOString();
  const probes: LiveProviderProbeEvidence[] = [];
  // Keep paid calls serial so reservations and reported actual spend remain
  // observable; provider billing is reconciled after each completed call.
  const externalEvidenceCostReservationUsd =
    input.externalEvidenceCostReservationUsd ?? 0;
  const lifecycleEvidence = Array.isArray(input.lifecycleEvidence)
    ? input.lifecycleEvidence
    : [];
  const transportFaultEvidence = Array.isArray(input.transportFaultEvidence)
    ? input.transportFaultEvidence
    : [];
  const secondaryProbes = Array.isArray(input.secondaryProbes)
    ? input.secondaryProbes
    : [];
  const hasExternalEvidence =
    lifecycleEvidence.length > 0 ||
    transportFaultEvidence.length > 0 ||
    secondaryProbes.length > 0;
  const externalEvidenceRequired =
    input.runNonce !== undefined ||
    input.externalCostEvidence !== undefined ||
    externalEvidenceCostReservationUsd > 0;
  const reservedCostUsd =
    input.channels.reduce(
      (sum, channel) => sum + channel.maxProbeCostUsd,
      0,
    ) + externalEvidenceCostReservationUsd;
  const invalidChannelBudget = input.channels.some(
    (channel) =>
      !Number.isFinite(channel.maxProbeCostUsd) ||
      channel.maxProbeCostUsd <= 0,
  );
  const invalidExternalEvidenceBudget =
    !Number.isFinite(externalEvidenceCostReservationUsd) ||
    externalEvidenceCostReservationUsd < 0 ||
    ((hasExternalEvidence || externalEvidenceRequired) &&
      externalEvidenceCostReservationUsd <= 0);
  if (
    !Number.isFinite(input.costCapUsd) ||
    input.costCapUsd <= 0 ||
    invalidChannelBudget ||
    invalidExternalEvidenceBudget ||
    reservedCostUsd > input.costCapUsd
  ) {
    throw new Error(
      `provider_live_cost_cap_exceeded:reserved=${reservedCostUsd.toFixed(4)}:cap=${input.costCapUsd}`,
    );
  }
  const externalCostEvidence = validateExternalCostEvidence(
    input.externalCostEvidence,
    input.runNonce,
    observedAt,
  );
  if (
    (hasExternalEvidence || externalEvidenceRequired) &&
    !externalCostEvidence
  ) {
    throw new Error('provider_live_external_cost_unverifiable');
  }
  const externalEvidenceUsd = externalCostEvidence?.amountUsd ?? 0;
  if (externalEvidenceUsd > externalEvidenceCostReservationUsd) {
    throw new Error('provider_live_external_cost_reservation_exceeded');
  }
  if (hasExternalEvidence || externalEvidenceRequired) {
    preflightExternalEvidence({
      channels: input.channels,
      lifecycleEvidence,
      transportFaultEvidence,
      secondaryProbes,
      externalCostEvidence: externalCostEvidence!,
      runNonce: input.runNonce,
      observedAt,
    });
  }
  for (const channel of input.channels) {
    probes.push(await input.probe(channel));
    await input.onProbe?.([...probes]);
  }
  const providerProbeUsd = validateProviderProbeCosts(probes, input.channels);
  const actualTotalUsd = providerProbeUsd + externalEvidenceUsd;
  if (actualTotalUsd > input.costCapUsd) {
    throw new Error(
      `provider_live_actual_cost_cap_exceeded:actual=${actualTotalUsd.toFixed(4)}:cap=${input.costCapUsd}`,
    );
  }
  const validSecondaryProbes = validateSecondaryProbes({
    probes: secondaryProbes,
    channels: input.channels,
    primaryProbes: probes,
    runNonce: input.runNonce,
    observedAt,
  });
  probes.push(...secondaryProbes);
  const activationEvidence = probes.map((probe) =>
    toLiveProviderActivationEvidence(
      probe,
      input.channels.some(
        (channel) =>
          probeMatchesChannel(probe, channel) ||
          (validSecondaryProbes.has(probe) &&
            secondaryEvidenceMatchesChannel(probe, channel)),
      ),
    ),
  );
  const publishGates: MultiChannelPublishGateResult[] = [];
  const liveMatrixReports: FaultInjectionMatrixReport[] = [];
  const skippedOperations: SupplyOperation[] = [];
  const blockedChecks: LiveProviderBlockedCheck[] = [];
  const externalEvidenceRefs = new Set<string>();
  if (externalCostEvidence) {
    externalEvidenceRefs.add(externalCostEvidence.evidenceRef);
    for (const component of externalCostEvidence.components) {
      externalEvidenceRefs.add(component.evidenceRef);
    }
  }

  for (const operation of CORE_FAULT_INJECTION_OPERATIONS) {
    let operationBlocked = false;
    const configured = input.channels.filter(
      (channel) => channel.model.operation === operation,
    );
    const alignedChannels = selectAlignedChannels(configured);
    const alignedCatalogModelId =
      alignedChannels[0]?.model.catalogModelId ?? null;
    const operationEvidence = activationEvidence.filter(
      (evidence) => evidence.operation === operation,
    );
    const deployments = alignedChannels.map((channel) =>
      deploymentEvidence(
        channel,
        operationEvidence.find(
          (evidence) => activationMatchesChannel(evidence, channel),
        ),
      ),
    );
    if (!alignedCatalogModelId) {
      operationBlocked = true;
      blockedChecks.push({
        operation,
        check: 'catalog_model_alignment',
        status: 'blocked',
        reason:
          'Official and reseller probes do not represent one declared, aligned CatalogModel.',
      });
    }
    const identitiesIndependent =
      hasIndependentOfficialResellerPair(alignedChannels);
    if (alignedChannels.length >= 2 && !identitiesIndependent) {
      operationBlocked = true;
      blockedChecks.push({
        operation,
        check: 'fault_domain_independence',
        status: 'blocked',
        reason:
          'Channels share a provider account identity or endpoint fingerprint.',
      });
    }
    const gate = evaluateMultiChannelPublishGate({
      operation,
      catalogModelId: alignedCatalogModelId,
      deployments: alignedCatalogModelId ? deployments : [],
      requireLiveVerified: true,
    });
    publishGates.push(gate);
    const lifecycleChannels = alignedChannels.filter((channel) =>
      findCompleteLifecycleEvidence(
        lifecycleEvidence,
        channel,
        input.runNonce,
        observedAt,
      ),
    );
    const matchedLifecycleEvidence = lifecycleChannels.flatMap((channel) => {
      const evidence = findCompleteLifecycleEvidence(
        lifecycleEvidence,
        channel,
        input.runNonce,
        observedAt,
      );
      return evidence ? [evidence] : [];
    });
    const lifecycleComplete =
      hasIndependentOfficialResellerPair(lifecycleChannels);
    if (lifecycleComplete) {
      for (const evidence of matchedLifecycleEvidence) {
        if (!evidence) continue;
        externalEvidenceRefs.add(evidence.evidenceRef);
        for (const check of evidence.checks) {
          externalEvidenceRefs.add(check.evidenceRef);
        }
      }
    }
    if (!lifecycleComplete) {
      operationBlocked = true;
      blockedChecks.push({
        operation,
        check: 'complete_lifecycle_conformance',
        status: 'blocked',
        reason:
          'Complete channel-bound provider lifecycle evidence is missing or failed.',
      });
    }

    const liveLifecycleChannels = lifecycleChannels.filter((channel) =>
      operationEvidence.some(
        (evidence) =>
          evidence.activationStatus === 'live_verified' &&
          activationMatchesChannel(evidence, channel),
      ),
    );
    const transportEvidence = alignedCatalogModelId
      ? findValidTransportFaultEvidence({
          allEvidence: transportFaultEvidence,
          channels: liveLifecycleChannels,
          operation,
          catalogModelId: alignedCatalogModelId,
          runNonce: input.runNonce,
          observedAt,
        })
      : undefined;
    if (!transportEvidence) {
      operationBlocked = true;
      blockedChecks.push({
        operation,
        check: 'real_fault_injection',
        status: 'blocked',
        reason:
          'Channel-bound provider transport fault evidence is missing or failed validation.',
      });
    }

    if (
      operationBlocked ||
      !gate.multiChannelReady ||
      !lifecycleComplete ||
      !transportEvidence
    ) {
      skippedOperations.push(operation);
    } else {
      externalEvidenceRefs.add(transportEvidence.evidenceRef);
      for (const scenario of transportEvidence.scenarios) {
        for (const reference of scenario.evidenceRefs) {
          externalEvidenceRefs.add(reference);
        }
      }
      liveMatrixReports.push(
        sanitizeTransportMatrixReport(transportEvidence.matrixReport),
      );
    }
  }

  for (const operation of SECONDARY_FAULT_INJECTION_OPERATIONS) {
    const evidence = activationEvidence.find(
      (candidate) =>
        candidate.operation === operation &&
        candidate.activationStatus === 'live_verified',
    );
    const channel = evidence
      ? input.channels.find((candidate) =>
          secondaryEvidenceMatchesChannel(evidence, candidate),
        )
      : undefined;
    const gate = evaluateMultiChannelPublishGate({
      operation,
      catalogModelId: channel?.model.catalogModelId ?? null,
      deployments:
        channel && evidence ? [deploymentEvidence(channel, evidence)] : [],
      requireLiveVerified: true,
    });
    publishGates.push(gate);
    if (
      gate.status !== 'single_channel' ||
      !gate.publishAllowed ||
      gate.multiChannelReady
    ) {
      blockedChecks.push({
        operation,
        check: 'secondary_live_verification',
        status: 'blocked',
        reason:
          'One channel-bound live_verified probe is required for the secondary operation.',
      });
      skippedOperations.push(operation);
    } else if (evidence) {
      externalEvidenceRefs.add(evidence.evidenceRef);
    }
  }

  return {
    observedAt,
    probes,
    activationEvidence,
    publishGates,
    liveMatrixReports,
    skippedOperations,
    blockedChecks,
    externalEvidenceRefs: [...externalEvidenceRefs],
    actualCost: {
      providerProbeUsd,
      externalEvidenceUsd,
      totalUsd: actualTotalUsd,
      capUsd: input.costCapUsd,
    },
  };
}

function selectAlignedChannels(
  channels: readonly LiveProviderChannel[],
): LiveProviderChannel[] {
  const groups = new Map<string, LiveProviderChannel[]>();
  for (const channel of channels) {
    if (channel.model.catalogAlignment !== 'channel_matrix_aligned') continue;
    const group = groups.get(channel.model.catalogModelId) ?? [];
    group.push(channel);
    groups.set(channel.model.catalogModelId, group);
  }
  return [...groups.values()]
    .filter(
      (group) =>
        group.length >= 2 &&
        group.some(
          (channel) => channel.model.channelKind === 'official_direct',
        ) &&
        group.some(
          (channel) => channel.model.channelKind === 'upstream_reseller',
        ),
    )
    .sort(
      (left, right) =>
        Number(hasIndependentOfficialResellerPair(right)) -
          Number(hasIndependentOfficialResellerPair(left)) ||
        right.length - left.length,
    )[0] ?? [];
}

function hasIndependentOfficialResellerPair(
  channels: readonly LiveProviderChannel[],
): boolean {
  return channels.some(
    (official) =>
      official.model.channelKind === 'official_direct' &&
      channels.some(
        (reseller) =>
          reseller.model.channelKind === 'upstream_reseller' &&
          reseller.accountIdentityFingerprint !==
            official.accountIdentityFingerprint &&
          reseller.endpointFingerprint !== official.endpointFingerprint,
      ),
  );
}

function findValidTransportFaultEvidence(input: {
  allEvidence: readonly LiveTransportFaultEvidence[];
  channels: readonly LiveProviderChannel[];
  operation: SupplyOperation;
  catalogModelId: string;
  runNonce: string | undefined;
  observedAt: string;
}): LiveTransportFaultEvidence | undefined {
  for (const official of input.channels) {
    if (official.model.channelKind !== 'official_direct') continue;
    for (const reseller of input.channels) {
      if (
        reseller.model.channelKind !== 'upstream_reseller' ||
        reseller.accountIdentityFingerprint ===
          official.accountIdentityFingerprint ||
        reseller.endpointFingerprint === official.endpointFingerprint
      ) {
        continue;
      }
      const evidence = input.allEvidence.find((candidate) =>
        isValidTransportFaultEvidence(
          candidate,
          input.operation,
          input.catalogModelId,
          official,
          reseller,
          input.runNonce,
          input.observedAt,
        ),
      );
      if (evidence) return evidence;
    }
  }
  return undefined;
}

function channelDeploymentId(channel: LiveProviderChannel): string {
  return (
    channel.deploymentId ??
    `live-${channel.model.modality}-${channel.model.channelKind}`
  );
}

function probeMatchesChannel(
  probe: LiveProviderProbeEvidence,
  channel: LiveProviderChannel,
): boolean {
  return (
    probe.operation === channel.model.operation &&
    probe.modality === channel.model.modality &&
    probe.channelKind === channel.model.channelKind &&
    probe.catalogModelId === channel.model.catalogModelId &&
    probe.providerProfileId === channel.model.providerProfileId &&
    probe.deploymentId === channelDeploymentId(channel) &&
    probe.adapterKind === channel.adapterKind &&
    probe.accountIdentityFingerprint === channel.accountIdentityFingerprint &&
    probe.endpointFingerprint === channel.endpointFingerprint
  );
}

function secondaryEvidenceMatchesChannel(
  evidence: Pick<
    LiveProviderProbeEvidence,
    | 'operation'
    | 'modality'
    | 'channelKind'
    | 'catalogModelId'
    | 'providerProfileId'
    | 'deploymentId'
    | 'adapterKind'
    | 'accountIdentityFingerprint'
    | 'endpointFingerprint'
  >,
  channel: LiveProviderChannel,
): boolean {
  const expectedModality =
    evidence.operation === 'copy.adapt' || evidence.operation === 'text.respond'
      ? 'llm'
      : evidence.operation === 'image.edit'
        ? 'image'
        : null;
  return (
    expectedModality !== null &&
    channel.model.modality === expectedModality &&
    evidence.modality === channel.model.modality &&
    evidence.channelKind === channel.model.channelKind &&
    evidence.catalogModelId === channel.model.catalogModelId &&
    evidence.providerProfileId === channel.model.providerProfileId &&
    evidence.deploymentId === channelDeploymentId(channel) &&
    evidence.adapterKind === channel.adapterKind &&
    evidence.accountIdentityFingerprint ===
      channel.accountIdentityFingerprint &&
    evidence.endpointFingerprint === channel.endpointFingerprint
  );
}

function activationMatchesChannel(
  evidence: LiveProviderActivationEvidence,
  channel: LiveProviderChannel,
): boolean {
  return (
    evidence.operation === channel.model.operation &&
    evidence.modality === channel.model.modality &&
    evidence.channelKind === channel.model.channelKind &&
    evidence.catalogModelId === channel.model.catalogModelId &&
    evidence.providerProfileId === channel.model.providerProfileId &&
    evidence.adapterKind === channel.adapterKind &&
    evidence.deploymentId === channelDeploymentId(channel) &&
    evidence.accountIdentityFingerprint ===
      channel.accountIdentityFingerprint &&
    evidence.endpointFingerprint === channel.endpointFingerprint
  );
}

const LLM_LIFECYCLE_CHECKS: readonly LiveLifecycleCheckId[] = [
  'protocol_completion',
  'error_normalization',
  'usage_evidence',
  'gateway_fingerprint',
  'mapping_confidence',
];

const MEDIA_LIFECYCLE_CHECKS: readonly LiveLifecycleCheckId[] = [
  'health_observation',
  'idempotent_submit',
  'cross_process_recover',
  'drain_without_restart',
  'cancel_confirmed',
  'late_terminal_reconciliation',
  'owned_asset_persistence',
];

function findCompleteLifecycleEvidence(
  allEvidence: readonly LiveProviderLifecycleEvidence[],
  channel: LiveProviderChannel,
  runNonce: string | undefined,
  observedAt: string,
): LiveProviderLifecycleEvidence | undefined {
  const evidence = allEvidence.find(
    (candidate) =>
      isRecord(candidate) &&
      candidate.source === 'provider_lifecycle_injector' &&
      isRunNonce(runNonce) &&
      candidate.runNonce === runNonce &&
      candidate.operation === channel.model.operation &&
      candidate.modality === channel.model.modality &&
      candidate.channelKind === channel.model.channelKind &&
      candidate.catalogModelId === channel.model.catalogModelId &&
      candidate.providerProfileId === channel.model.providerProfileId &&
      candidate.deploymentId === channelDeploymentId(channel) &&
      candidate.adapterKind === channel.adapterKind &&
      candidate.accountIdentityFingerprint ===
        channel.accountIdentityFingerprint &&
      candidate.endpointFingerprint === channel.endpointFingerprint &&
      isEvidenceRef(candidate.evidenceRef) &&
      isFreshObservedAt(candidate.observedAt, observedAt) &&
      Array.isArray(candidate.checks),
  );
  if (!evidence) return undefined;
  const required =
    channel.model.modality === 'llm'
      ? LLM_LIFECYCLE_CHECKS
      : MEDIA_LIFECYCLE_CHECKS;
  const checkIds = new Set(
    evidence.checks.map((check) =>
      isRecord(check) ? check.checkId : undefined,
    ),
  );
  return evidence.checks.length === required.length &&
    checkIds.size === required.length &&
    required.every((checkId) =>
      evidence.checks.some(
        (check) =>
          isRecord(check) &&
          check.checkId === checkId &&
          check.passed === true &&
          isEvidenceRef(check.evidenceRef),
      ),
    )
    ? evidence
    : undefined;
}

function isValidTransportFaultEvidence(
  evidence: LiveTransportFaultEvidence,
  operation: SupplyOperation,
  catalogModelId: string,
  official: LiveProviderChannel,
  reseller: LiveProviderChannel,
  runNonce: string | undefined,
  observedAt: string,
): boolean {
  if (
    !isRecord(evidence) ||
    evidence.source !== 'provider_transport_injector' ||
    !isRunNonce(runNonce) ||
    evidence.runNonce !== runNonce ||
    evidence.operation !== operation ||
    evidence.catalogModelId !== catalogModelId ||
    evidence.officialDeploymentId !== channelDeploymentId(official) ||
    evidence.resellerDeploymentId !== channelDeploymentId(reseller) ||
    evidence.officialAccountIdentityFingerprint !==
      official.accountIdentityFingerprint ||
    evidence.officialEndpointFingerprint !== official.endpointFingerprint ||
    evidence.resellerAccountIdentityFingerprint !==
      reseller.accountIdentityFingerprint ||
    evidence.resellerEndpointFingerprint !== reseller.endpointFingerprint ||
    !isEvidenceRef(evidence.evidenceRef) ||
    !isFreshObservedAt(evidence.observedAt, observedAt) ||
    !Array.isArray(evidence.scenarios) ||
    !evidence.scenarios.every(isRecord) ||
    !isRecord(evidence.matrixReport)
  ) {
    return false;
  }
  const report = evidence.matrixReport;
  if (
    report.operation !== operation ||
    report.modality !== official.model.modality ||
    report.evidenceKind !== 'live_provider' ||
    !isEvidenceRef(report.id) ||
    !isFreshObservedAt(report.observedAt, observedAt) ||
    report.allPassed !== true ||
    report.dualChannelReady !== true ||
    !Array.isArray(report.scenarios) ||
    !report.scenarios.every(
      (scenario) =>
        isRecord(scenario) &&
        Array.isArray(scenario.attempts) &&
        scenario.attempts.every(isRecord) &&
        scenario.operation === operation &&
        scenario.modality === official.model.modality &&
        scenario.evidenceKind === 'live_provider' &&
        isFreshObservedAt(scenario.observedAt, observedAt),
    )
  ) {
    return false;
  }
  const scenarioIds = new Set(
    evidence.scenarios.map((scenario) => scenario.scenarioId),
  );
  const reportScenarioIds = new Set(
    report.scenarios.map((scenario) => scenario.scenarioId),
  );
  if (
    evidence.scenarios.length !== FAULT_INJECTION_SCENARIOS.length ||
    report.scenarios.length !== FAULT_INJECTION_SCENARIOS.length ||
    scenarioIds.size !== FAULT_INJECTION_SCENARIOS.length ||
    reportScenarioIds.size !== FAULT_INJECTION_SCENARIOS.length
  ) {
    return false;
  }
  if (
    !FAULT_INJECTION_SCENARIOS.every(
      (scenarioId) =>
        scenarioIds.has(scenarioId) && reportScenarioIds.has(scenarioId),
    ) ||
    !evidence.scenarios.every(
      (scenario) =>
        isRecord(scenario) &&
        scenario.transportInjectorExecuted === true &&
        Array.isArray(scenario.evidenceRefs) &&
        scenario.evidenceRefs.length > 0 &&
        scenario.evidenceRefs.every(isEvidenceRef),
    ) ||
    report.scenarios.some((scenario) =>
      scenario.attempts.some(
        (attempt) =>
          attempt.deploymentId !== evidence.officialDeploymentId &&
          attempt.deploymentId !== evidence.resellerDeploymentId,
      ),
    )
  ) {
    return false;
  }
  return hasRequiredLiveScenarioSemantics(
    report,
    catalogModelId,
    evidence.officialDeploymentId,
    evidence.resellerDeploymentId,
  );
}

function hasRequiredLiveScenarioSemantics(
  report: FaultInjectionMatrixReport,
  catalogModelId: string,
  officialDeploymentId: string,
  resellerDeploymentId: string,
): boolean {
  const scenario = (id: (typeof FAULT_INJECTION_SCENARIOS)[number]) =>
    report.scenarios.find((candidate) => candidate.scenarioId === id);
  const switched = scenario('reject_before_accept_switch');
  const accepted = scenario('accepted_no_resubmit');
  const unknown = scenario('acceptance_unknown_reconcile');
  const drain = scenario('isolate_drain_new_task');
  const replay = scenario('route_snapshot_ledger_replay');
  return Boolean(
    switched?.passed &&
      switched.disposition === 'switched_to_fallback' &&
      switched.attempts.length === 2 &&
      switched.attempts[0]?.deploymentId === officialDeploymentId &&
      switched.attempts[0]?.acceptance === 'rejected_before_accept' &&
      switched.attempts[1]?.deploymentId === resellerDeploymentId &&
      switched.attempts[1]?.acceptance === 'accepted' &&
      isEvidenceRef(switched.attempts[1]?.providerTaskRef) &&
      accepted?.passed &&
      accepted.disposition === 'primary_succeeded' &&
      accepted.attempts.length === 1 &&
      accepted.attempts[0]?.deploymentId === officialDeploymentId &&
      accepted.attempts[0]?.acceptance === 'accepted' &&
      isEvidenceRef(accepted.attempts[0]?.providerTaskRef) &&
      unknown?.passed &&
      unknown.disposition === 'reconcile_no_resubmit' &&
      unknown.attempts.length === 1 &&
      unknown.attempts[0]?.deploymentId === officialDeploymentId &&
      unknown.attempts[0]?.acceptance === 'acceptance_unknown' &&
      drain?.passed &&
      drain.disposition === 'fallback_only' &&
      drain.attempts.length === 1 &&
      drain.attempts[0]?.deploymentId === resellerDeploymentId &&
      drain.attempts[0]?.acceptance === 'accepted' &&
      isEvidenceRef(drain.attempts[0]?.providerTaskRef) &&
      replay?.passed &&
      replay.routeSnapshot &&
      replay.bilateralLedger &&
      isValidReplaySnapshot(
        replay.routeSnapshot,
        catalogModelId,
        officialDeploymentId,
        resellerDeploymentId,
      ) &&
      isValidBilateralLedger(replay.bilateralLedger, replay.routeSnapshot.id) &&
      replay.bilateralLedger.supplyFreeze.routeSnapshotRef ===
        replay.routeSnapshot.id,
  );
}

function isValidReplaySnapshot(
  snapshot: NonNullable<FaultInjectionScenarioResult['routeSnapshot']>,
  catalogModelId: string,
  officialDeploymentId: string,
  resellerDeploymentId: string,
): boolean {
  return (
    isRecord(snapshot) &&
    isEvidenceRef(snapshot.id) &&
    snapshot.catalogModelId === catalogModelId &&
    snapshot.deploymentId === officialDeploymentId &&
    snapshot.actualDeploymentId === officialDeploymentId &&
    isObservedAt(snapshot.createdAt) &&
    Array.isArray(snapshot.allowedCandidates) &&
    snapshot.allowedCandidates.length === 2 &&
    snapshot.allowedCandidates[0]?.catalogModelId === catalogModelId &&
    snapshot.allowedCandidates[0]?.deploymentId === officialDeploymentId &&
    snapshot.allowedCandidates[0]?.rank === 1 &&
    snapshot.allowedCandidates[0]?.sourceKind === 'official_direct' &&
    snapshot.allowedCandidates[1]?.catalogModelId === catalogModelId &&
    snapshot.allowedCandidates[1]?.deploymentId === resellerDeploymentId &&
    snapshot.allowedCandidates[1]?.rank === 2 &&
    snapshot.allowedCandidates[1]?.sourceKind === 'upstream_reseller' &&
    snapshot.fallbackConsent === true &&
    snapshot.fallbackChain?.length === 2 &&
    snapshot.fallbackChain[0] === officialDeploymentId &&
    snapshot.fallbackChain[1] === resellerDeploymentId &&
    snapshot.sourceKind === 'official_direct'
  );
}

function isValidBilateralLedger(
  ledger: NonNullable<FaultInjectionScenarioResult['bilateralLedger']>,
  routeSnapshotId: string,
): boolean {
  return (
    isRecord(ledger) &&
    isRecord(ledger.productUsage) &&
    isRecord(ledger.providerCost) &&
    isRecord(ledger.supplyFreeze) &&
    isEvidenceRef(ledger.productUsage.id) &&
    ['reserved', 'settled', 'refunded', 'held_for_reconcile'].includes(
      ledger.productUsage.status,
    ) &&
    Number.isFinite(ledger.productUsage.quantity) &&
    ledger.productUsage.quantity >= 0 &&
    ['copy', 'image', 'video'].includes(ledger.productUsage.resource) &&
    isEvidenceRef(ledger.providerCost.id) &&
    Number.isFinite(ledger.providerCost.amount) &&
    ledger.providerCost.amount >= 0 &&
    ['CNY', 'USD'].includes(ledger.providerCost.currency) &&
    ['estimated', 'observed', 'unknown'].includes(
      ledger.providerCost.status,
    ) &&
    isEvidenceRef(ledger.providerCost.attemptId) &&
    isEvidenceRef(ledger.supplyFreeze.id) &&
    ledger.supplyFreeze.routeSnapshotRef === routeSnapshotId &&
    isEvidenceRef(ledger.supplyFreeze.credentialAccountVersion) &&
    isEvidenceRef(ledger.supplyFreeze.supplierRequestTaskId) &&
    isEvidenceRef(ledger.supplyFreeze.supplyPoolId) &&
    isObservedAt(ledger.supplyFreeze.frozenAt)
  );
}

function sanitizeTransportMatrixReport(
  report: FaultInjectionMatrixReport,
): FaultInjectionMatrixReport {
  return {
    id: report.id,
    operation: report.operation,
    modality: report.modality,
    scenarios: report.scenarios.map((scenario) => ({
      scenarioId: scenario.scenarioId,
      operation: scenario.operation,
      modality: scenario.modality,
      passed: scenario.passed,
      disposition: scenario.disposition,
      attempts: scenario.attempts.map((attempt) => ({
        rank: attempt.rank,
        deploymentId: attempt.deploymentId,
        channelKind: attempt.channelKind,
        acceptance: attempt.acceptance,
        ...(isEvidenceRef(attempt.providerTaskRef)
          ? { providerTaskRef: attempt.providerTaskRef }
          : {}),
        switched: attempt.switched,
      })),
      ...(scenario.routeSnapshot
        ? {
            routeSnapshot: {
              id: scenario.routeSnapshot.id,
              catalogModelId: scenario.routeSnapshot.catalogModelId,
              deploymentId: scenario.routeSnapshot.deploymentId,
              allowedCandidates: scenario.routeSnapshot.allowedCandidates.map(
                (candidate) => ({
                  catalogModelId: candidate.catalogModelId,
                  deploymentId: candidate.deploymentId,
                  rank: candidate.rank,
                  ...(candidate.sourceKind
                    ? { sourceKind: candidate.sourceKind }
                    : {}),
                }),
              ),
              actualDeploymentId: scenario.routeSnapshot.actualDeploymentId,
              fallbackChain: scenario.routeSnapshot.fallbackChain
                ? [...scenario.routeSnapshot.fallbackChain]
                : undefined,
              fallbackConsent: scenario.routeSnapshot.fallbackConsent,
              sourceKind: scenario.routeSnapshot.sourceKind,
              createdAt: scenario.routeSnapshot.createdAt,
            },
          }
        : {}),
      ...(scenario.bilateralLedger
        ? {
            bilateralLedger: {
              productUsage: {
                id: scenario.bilateralLedger.productUsage.id,
                status: scenario.bilateralLedger.productUsage.status,
                quantity: scenario.bilateralLedger.productUsage.quantity,
                resource: scenario.bilateralLedger.productUsage.resource,
              },
              providerCost: {
                id: scenario.bilateralLedger.providerCost.id,
                amount: scenario.bilateralLedger.providerCost.amount,
                currency: scenario.bilateralLedger.providerCost.currency,
                status: scenario.bilateralLedger.providerCost.status,
                attemptId: scenario.bilateralLedger.providerCost.attemptId,
              },
              supplyFreeze: {
                id: scenario.bilateralLedger.supplyFreeze.id,
                routeSnapshotRef:
                  scenario.bilateralLedger.supplyFreeze.routeSnapshotRef,
                credentialAccountVersion:
                  scenario.bilateralLedger.supplyFreeze
                    .credentialAccountVersion,
                supplierRequestTaskId:
                  scenario.bilateralLedger.supplyFreeze
                    .supplierRequestTaskId,
                supplyPoolId:
                  scenario.bilateralLedger.supplyFreeze.supplyPoolId,
                frozenAt: scenario.bilateralLedger.supplyFreeze.frozenAt,
              },
            },
          }
        : {}),
      detail: 'Validated external provider transport injector evidence.',
      evidenceKind: 'live_provider',
      observedAt: scenario.observedAt,
    })),
    allPassed: true,
    // Live dual-channel evidence is only accepted after catalog_model_alignment.
    dualChannelReady: true,
    channelMatrixAligned: true,
    observedAt: report.observedAt,
    evidenceKind: 'live_provider',
  };
}

function validateProviderProbeCosts(
  probes: readonly LiveProviderProbeEvidence[],
  channels: readonly LiveProviderChannel[],
): number {
  let totalUsd = 0;
  for (const probe of probes) {
    const channel = channels.find((candidate) =>
      probeMatchesChannelForCost(probe, candidate),
    );
    if (!channel) throw new Error('provider_live_probe_cost_unbound');
    const amountUsd = verifiedProviderCostUsd(probe.providerCost);
    if (amountUsd === null) {
      throw new Error('provider_live_probe_cost_unverifiable');
    }
    if (amountUsd > channel.maxProbeCostUsd) {
      throw new Error(
        `provider_live_probe_reservation_exceeded:${channelDeploymentId(channel)}`,
      );
    }
    totalUsd += amountUsd;
  }
  return totalUsd;
}

function preflightExternalEvidence(input: {
  channels: readonly LiveProviderChannel[];
  lifecycleEvidence: readonly LiveProviderLifecycleEvidence[];
  transportFaultEvidence: readonly LiveTransportFaultEvidence[];
  secondaryProbes: readonly LiveProviderProbeEvidence[];
  externalCostEvidence: LiveExternalCostEvidence;
  runNonce: string | undefined;
  observedAt: string;
}): void {
  const validSecondary = validateSecondaryProbes({
    probes: input.secondaryProbes,
    channels: input.channels,
    primaryProbes: [],
    runNonce: input.runNonce,
    observedAt: input.observedAt,
  });
  const secondaryComplete = SECONDARY_FAULT_INJECTION_OPERATIONS.every(
    (operation) =>
      [...validSecondary].some((probe) => probe.operation === operation),
  );
  const secondaryProbeUsd = validateSecondaryProbeCosts(input.secondaryProbes);
  const secondaryCostReconciled = approximatelyEqual(
    costComponentTotal(input.externalCostEvidence, 'secondary_probe'),
    secondaryProbeUsd,
  );
  const coreComplete = CORE_FAULT_INJECTION_OPERATIONS.every((operation) => {
    const aligned = selectAlignedChannels(
      input.channels.filter((channel) => channel.model.operation === operation),
    );
    const lifecycleChannels = aligned.filter((channel) =>
      findCompleteLifecycleEvidence(
        input.lifecycleEvidence,
        channel,
        input.runNonce,
        input.observedAt,
      ),
    );
    return (
      hasIndependentOfficialResellerPair(lifecycleChannels) &&
      Boolean(
        aligned[0] &&
          findValidTransportFaultEvidence({
            allEvidence: input.transportFaultEvidence,
            channels: lifecycleChannels,
            operation,
            catalogModelId: aligned[0].model.catalogModelId,
            runNonce: input.runNonce,
            observedAt: input.observedAt,
          }),
      )
    );
  });
  if (!secondaryCostReconciled) {
    throw new Error('provider_live_secondary_cost_reconciliation_failed');
  }
  if (!secondaryComplete || !coreComplete) {
    throw new Error('provider_live_external_evidence_incomplete');
  }
}

function validateSecondaryProbeCosts(
  probes: readonly LiveProviderProbeEvidence[],
): number {
  return probes.reduce((sum, probe) => {
    const amountUsd = verifiedProviderCostUsd(probe.providerCost);
    if (amountUsd === null) {
      throw new Error('provider_live_secondary_probe_cost_unverifiable');
    }
    return sum + amountUsd;
  }, 0);
}

function costComponentTotal(
  evidence: LiveExternalCostEvidence,
  kind: LiveExternalCostEvidence['components'][number]['kind'],
): number {
  return evidence.components
    .filter((component) => component.kind === kind)
    .reduce((sum, component) => sum + component.amountUsd, 0);
}

function probeMatchesChannelForCost(
  probe: LiveProviderProbeEvidence,
  channel: LiveProviderChannel,
): boolean {
  return (
    probe.operation === channel.model.operation &&
    probe.modality === channel.model.modality &&
    probe.channelKind === channel.model.channelKind &&
    probe.deploymentId === channelDeploymentId(channel) &&
    probe.adapterKind === channel.adapterKind
  );
}

function verifiedProviderCostUsd(
  cost: LiveProviderProbeEvidence['providerCost'],
): number | null {
  if (!Number.isFinite(cost.amount) || cost.amount < 0) return null;
  if (cost.currency === 'USD') {
    return cost.amountUsd === undefined ||
      (Number.isFinite(cost.amountUsd) &&
        cost.amountUsd >= 0 &&
        approximatelyEqual(cost.amountUsd, cost.amount))
      ? cost.amount
      : null;
  }
  if (cost.amount === 0 && (cost.amountUsd === undefined || cost.amountUsd === 0)) {
    return 0;
  }
  if (!Number.isFinite(cost.amountUsd) || (cost.amountUsd ?? -1) < 0) {
    return null;
  }
  const fx = cost.fx;
  if (
    !fx ||
    !Number.isFinite(fx.cnyPerUsd) ||
    fx.cnyPerUsd <= 0 ||
    !isEvidenceRef(fx.evidenceRef) ||
    !isObservedAt(fx.observedAt)
  ) {
    return null;
  }
  const calculated = cost.amount / fx.cnyPerUsd;
  return approximatelyEqual(cost.amountUsd!, calculated)
    ? cost.amountUsd!
    : null;
}

function validateExternalCostEvidence(
  evidence: LiveExternalCostEvidence | undefined,
  runNonce: string | undefined,
  observedAt: string,
): LiveExternalCostEvidence | undefined {
  if (!evidence) return undefined;
  if (
    evidence.source !== 'provider_live_cost_ledger' ||
    evidence.currency !== 'USD' ||
    !isRunNonce(runNonce) ||
    evidence.runNonce !== runNonce ||
    !isEvidenceRef(evidence.evidenceRef) ||
    !isFreshObservedAt(evidence.observedAt, observedAt) ||
    !Number.isFinite(evidence.amountUsd) ||
    evidence.amountUsd < 0 ||
    !Array.isArray(evidence.components) ||
    evidence.components.length < 3
  ) {
    return undefined;
  }
  const requiredKinds = new Set([
    'secondary_probe',
    'lifecycle_probe',
    'fault_injection',
  ]);
  const refs = new Set<string>();
  let componentTotal = 0;
  for (const component of evidence.components) {
    if (
      !isRecord(component) ||
      ![
        'secondary_probe',
        'lifecycle_probe',
        'fault_injection',
        'infrastructure',
      ].includes(component.kind as string) ||
      !Number.isFinite(component.amountUsd) ||
      (component.amountUsd as number) < 0 ||
      !isEvidenceRef(component.evidenceRef) ||
      refs.has(component.evidenceRef)
    ) {
      return undefined;
    }
    requiredKinds.delete(component.kind as string);
    refs.add(component.evidenceRef);
    componentTotal += component.amountUsd as number;
  }
  return requiredKinds.size === 0 &&
    approximatelyEqual(componentTotal, evidence.amountUsd)
    ? evidence
    : undefined;
}

function validateSecondaryProbes(input: {
  probes: readonly LiveProviderProbeEvidence[];
  channels: readonly LiveProviderChannel[];
  primaryProbes: readonly LiveProviderProbeEvidence[];
  runNonce: string | undefined;
  observedAt: string;
}): Set<LiveProviderProbeEvidence> {
  const valid = new Set<LiveProviderProbeEvidence>();
  if (!isRunNonce(input.runNonce)) return valid;
  const primaryTaskRefs = new Set(
    input.primaryProbes.flatMap((probe) =>
      probe.providerTaskRef ? [probe.providerTaskRef] : [],
    ),
  );
  const primaryEvidenceRefs = new Set(
    input.primaryProbes.map((probe) => probe.evidenceRef),
  );
  const taskRefs = new Set<string>();
  const evidenceRefs = new Set<string>();
  const requestHashes = new Set<string>();
  const idempotencyHashes = new Set<string>();
  const resultHashes = new Set<string>();
  for (const operation of SECONDARY_FAULT_INJECTION_OPERATIONS) {
    const operationProbes = input.probes.filter(
      (probe) => probe.operation === operation,
    );
    for (const probe of operationProbes) {
      const operationEvidence = probe.operationEvidence;
      const bound = input.channels.some((channel) =>
        secondaryEvidenceMatchesChannel(probe, channel),
      );
      if (
        !bound ||
        !isLiveVerifiedProbe(probe) ||
        !isFreshObservedAt(probe.observedAt, input.observedAt) ||
        !probe.providerTaskRef ||
        !isEvidenceRef(probe.providerTaskRef) ||
        primaryTaskRefs.has(probe.providerTaskRef) ||
        taskRefs.has(probe.providerTaskRef) ||
        primaryEvidenceRefs.has(probe.evidenceRef) ||
        evidenceRefs.has(probe.evidenceRef) ||
        !operationEvidence ||
        operationEvidence.operation !== operation ||
        operationEvidence.runNonce !== input.runNonce ||
        !isSha256(operationEvidence.requestIdempotencyKeySha256) ||
        !isSha256(operationEvidence.requestPayloadSha256) ||
        !isSha256(operationEvidence.resultPayloadSha256) ||
        idempotencyHashes.has(operationEvidence.requestIdempotencyKeySha256) ||
        requestHashes.has(operationEvidence.requestPayloadSha256) ||
        resultHashes.has(operationEvidence.resultPayloadSha256)
      ) {
        continue;
      }
      taskRefs.add(probe.providerTaskRef);
      evidenceRefs.add(probe.evidenceRef);
      idempotencyHashes.add(operationEvidence.requestIdempotencyKeySha256);
      requestHashes.add(operationEvidence.requestPayloadSha256);
      resultHashes.add(operationEvidence.resultPayloadSha256);
      valid.add(probe);
    }
  }
  return valid;
}

function isRunNonce(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(value)
  );
}

function isFreshObservedAt(value: unknown, now: string): boolean {
  if (!isObservedAt(value)) return false;
  const delta = Date.parse(now) - Date.parse(value);
  return delta >= -5 * 60_000 && delta <= 60 * 60_000;
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(1e-9, Math.abs(right) * 1e-6);
}

function isEvidenceRef(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9:._/-]{7,255}$/u.test(value)
  );
}

function isObservedAt(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isLiveVerifiedProbe(
  evidence: LiveProviderProbeEvidence,
): boolean {
  const lifecycleVerified =
    evidence.modality === 'llm'
      ? evidence.lifecycle.pollStatus === 'completed' &&
        (evidence.providerCost.usage?.inputTokens ?? 0) > 0 &&
        (evidence.providerCost.usage?.outputTokens ?? 0) > 0
      : evidence.lifecycle.recovered &&
        evidence.lifecycle.pollStatus === 'completed' &&
        evidence.lifecycle.downloaded &&
        (evidence.lifecycle.downloadedBytes ?? 0) > 0 &&
        /^[a-f0-9]{64}$/u.test(evidence.lifecycle.assetSha256 ?? '') &&
        (evidence.providerCost.usage?.mediaUnits ?? 0) > 0 &&
        (evidence.modality !== 'video' ||
          (evidence.providerCost.usage?.outputTokens ?? 0) > 0);
  return (
    evidence.adapterExecuted &&
    evidence.providerCallSucceeded &&
    evidence.acceptance === 'accepted' &&
    Boolean(evidence.providerTaskRef) &&
    evidence.lifecycle.submitted &&
    isEvidenceRef(evidence.evidenceRef) &&
    isObservedAt(evidence.observedAt) &&
    /^[a-f0-9]{64}$/u.test(evidence.accountIdentityFingerprint) &&
    /^[a-f0-9]{64}$/u.test(evidence.endpointFingerprint) &&
    lifecycleVerified
  );
}

function toLiveProviderActivationEvidence(
  probe: LiveProviderProbeEvidence,
  boundToConfiguredChannel: boolean,
): LiveProviderActivationEvidence {
  return {
    operation: probe.operation,
    modality: probe.modality,
    channelKind: probe.channelKind,
    deploymentId: probe.deploymentId,
    catalogModelId: probe.catalogModelId,
    providerProfileId: probe.providerProfileId,
    adapterKind: probe.adapterKind,
    activationStatus: boundToConfiguredChannel && isLiveVerifiedProbe(probe)
      ? 'live_verified'
      : 'documented',
    evidenceRef: probe.evidenceRef,
    verifiedAt: probe.observedAt,
    adapterExecuted: probe.adapterExecuted,
    providerCallSucceeded: probe.providerCallSucceeded,
    accountIdentityFingerprint: probe.accountIdentityFingerprint,
    endpointFingerprint: probe.endpointFingerprint,
  };
}

function deploymentEvidence(
  channel: LiveProviderChannel,
  evidence: LiveProviderActivationEvidence | undefined,
): QualifiedDeploymentEvidence {
  return qualifiedDeployment({
    deploymentId:
      evidence?.deploymentId ??
      `unverified-${channel.model.modality}-${channel.model.channelKind}`,
    catalogModelId: channel.model.catalogModelId,
    providerProfileId: channel.model.providerProfileId,
    executionChannelId: `live-${channel.model.channelKind}`,
    channelKind: channel.model.channelKind,
    activationStatus: evidence?.activationStatus ?? 'documented',
    manufacturer: channel.model.manufacturer,
    accountIdentity: evidence?.accountIdentityFingerprint,
    endpointFingerprint: evidence?.endpointFingerprint,
  });
}
