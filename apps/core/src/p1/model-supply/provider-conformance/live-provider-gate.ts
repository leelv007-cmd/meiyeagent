import type {
  ActivationEvidenceStatus,
  SupplyChannelKind,
  SupplyOperation,
} from '@meiye/contracts';
import {
  CORE_FAULT_INJECTION_OPERATIONS,
  FAULT_INJECTION_SCENARIOS,
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
    | 'complete_lifecycle_conformance';
  status: 'blocked';
  reason: string;
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
}

export async function runLiveProviderGate(input: {
  channels: readonly LiveProviderChannel[];
  probe: (channel: LiveProviderChannel) => Promise<LiveProviderProbeEvidence>;
  onProbe?: (probes: readonly LiveProviderProbeEvidence[]) => Promise<void>;
  costCapUsd: number;
  externalEvidenceCostReservationUsd?: number;
  lifecycleEvidence?: readonly LiveProviderLifecycleEvidence[];
  transportFaultEvidence?: readonly LiveTransportFaultEvidence[];
}): Promise<LiveProviderGateReport> {
  const observedAt = new Date().toISOString();
  const probes: LiveProviderProbeEvidence[] = [];
  // Keep paid calls serial so the workflow cost cap remains observable and
  // providers are not burst-tested by the conformance gate.
  const externalEvidenceCostReservationUsd =
    input.externalEvidenceCostReservationUsd ?? 0;
  const lifecycleEvidence = Array.isArray(input.lifecycleEvidence)
    ? input.lifecycleEvidence
    : [];
  const transportFaultEvidence = Array.isArray(input.transportFaultEvidence)
    ? input.transportFaultEvidence
    : [];
  const hasExternalEvidence =
    lifecycleEvidence.length > 0 || transportFaultEvidence.length > 0;
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
    (hasExternalEvidence && externalEvidenceCostReservationUsd <= 0);
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
  for (const channel of input.channels) {
    probes.push(await input.probe(channel));
    await input.onProbe?.([...probes]);
  }
  const activationEvidence = probes.map((probe) =>
    toLiveProviderActivationEvidence(
      probe,
      input.channels.some((channel) => probeMatchesChannel(probe, channel)),
    ),
  );
  const publishGates: MultiChannelPublishGateResult[] = [];
  const liveMatrixReports: FaultInjectionMatrixReport[] = [];
  const skippedOperations: SupplyOperation[] = [];
  const blockedChecks: LiveProviderBlockedCheck[] = [];
  const externalEvidenceRefs = new Set<string>();

  for (const operation of CORE_FAULT_INJECTION_OPERATIONS) {
    let operationBlocked = false;
    const configured = input.channels.filter(
      (channel) => channel.model.operation === operation,
    );
    const operationEvidence = activationEvidence.filter(
      (evidence) => evidence.operation === operation,
    );
    const deployments = configured.map((channel) =>
      deploymentEvidence(
        channel,
        operationEvidence.find(
          (evidence) => activationMatchesChannel(evidence, channel),
        ),
      ),
    );
    const catalogModelIds = new Set(
      configured.map((channel) => channel.model.catalogModelId),
    );
    const alignedCatalogModelId =
      catalogModelIds.size === 1
        ? configured[0]?.model.catalogModelId ?? null
        : null;
    if (catalogModelIds.size > 1) {
      operationBlocked = true;
      blockedChecks.push({
        operation,
        check: 'catalog_model_alignment',
        status: 'blocked',
        reason:
          'Official and reseller probes do not represent the same CatalogModel.',
      });
    }
    const identitiesIndependent =
      configured.length >= 2 &&
      new Set(
        configured.map((channel) => channel.accountIdentityFingerprint),
      ).size === configured.length &&
      new Set(configured.map((channel) => channel.endpointFingerprint)).size ===
        configured.length;
    if (configured.length >= 2 && !identitiesIndependent) {
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
      deployments:
        alignedCatalogModelId && identitiesIndependent ? deployments : [],
      requireLiveVerified: true,
    });
    publishGates.push(gate);
    const matchedLifecycleEvidence = configured.map((channel) =>
      findCompleteLifecycleEvidence(lifecycleEvidence, channel),
    );
    const lifecycleComplete =
      configured.length === 2 && matchedLifecycleEvidence.every(Boolean);
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

    const official = configured.find(
      (channel) => channel.model.channelKind === 'official_direct',
    );
    const reseller = configured.find(
      (channel) => channel.model.channelKind === 'upstream_reseller',
    );
    const transportEvidence =
      alignedCatalogModelId && official && reseller
        ? transportFaultEvidence.find((evidence) =>
            isValidTransportFaultEvidence(
              evidence,
              operation,
              alignedCatalogModelId,
              official,
              reseller,
            ),
          )
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

  return {
    observedAt,
    probes,
    activationEvidence,
    publishGates,
    liveMatrixReports,
    skippedOperations,
    blockedChecks,
    externalEvidenceRefs: [...externalEvidenceRefs],
  };
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
    probe.deploymentId ===
      `live-${channel.model.modality}-${channel.model.channelKind}` &&
    probe.adapterKind === channel.adapterKind &&
    probe.accountIdentityFingerprint === channel.accountIdentityFingerprint &&
    probe.endpointFingerprint === channel.endpointFingerprint
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
    evidence.deploymentId ===
      `live-${channel.model.modality}-${channel.model.channelKind}` &&
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
): LiveProviderLifecycleEvidence | undefined {
  const evidence = allEvidence.find(
    (candidate) =>
      isRecord(candidate) &&
      candidate.source === 'provider_lifecycle_injector' &&
      candidate.operation === channel.model.operation &&
      candidate.modality === channel.model.modality &&
      candidate.channelKind === channel.model.channelKind &&
      candidate.catalogModelId === channel.model.catalogModelId &&
      candidate.providerProfileId === channel.model.providerProfileId &&
      candidate.deploymentId ===
        `live-${channel.model.modality}-${channel.model.channelKind}` &&
      candidate.adapterKind === channel.adapterKind &&
      candidate.accountIdentityFingerprint ===
        channel.accountIdentityFingerprint &&
      candidate.endpointFingerprint === channel.endpointFingerprint &&
      isEvidenceRef(candidate.evidenceRef) &&
      isObservedAt(candidate.observedAt) &&
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
): boolean {
  if (
    !isRecord(evidence) ||
    evidence.source !== 'provider_transport_injector' ||
    evidence.operation !== operation ||
    evidence.catalogModelId !== catalogModelId ||
    evidence.officialDeploymentId !==
      `live-${official.model.modality}-${official.model.channelKind}` ||
    evidence.resellerDeploymentId !==
      `live-${reseller.model.modality}-${reseller.model.channelKind}` ||
    evidence.officialAccountIdentityFingerprint !==
      official.accountIdentityFingerprint ||
    evidence.officialEndpointFingerprint !== official.endpointFingerprint ||
    evidence.resellerAccountIdentityFingerprint !==
      reseller.accountIdentityFingerprint ||
    evidence.resellerEndpointFingerprint !== reseller.endpointFingerprint ||
    !isEvidenceRef(evidence.evidenceRef) ||
    !isObservedAt(evidence.observedAt) ||
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
    !isObservedAt(report.observedAt) ||
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
        isObservedAt(scenario.observedAt),
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
