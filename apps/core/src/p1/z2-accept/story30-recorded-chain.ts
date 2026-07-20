/**
 * Story 30 recorded main-chain smoke (Z2-ACCEPT / D-068).
 *
 * procurement → publish → allocate → task → ledger → audit
 * Uses in-memory domain services + recorded/fake ports only.
 * Live provider matrix is env-gated and tracked in the gap file.
 */
import { createCredentialAccount } from '../supply-registry/credential-account.js';
import {
  transitionCredentialLifecycle,
  type CredentialTestEvidence,
} from '../supply-registry/credential-lifecycle.js';
import { assertNoSecretEcho } from '../supply-registry/credential-account.js';
import { RoutePolicyRegistry } from '../supply-registry/route-policy.js';
import { AccountAllocationStore } from '../entitlement-pools/account-allocation.js';
import { SupplyPoolRegistry } from '../entitlement-pools/supply-pool.js';
import { buildSupplyRequestFreeze } from '../entitlement-pools/supply-ledger-fields.js';
import {
  dualChannelActivationGateReady,
} from '../model-supply/provider-conformance/activation-evidence-input.js';
import { runRecordedTextDualChannelConformance } from '../model-supply/provider-conformance/text/dual-channel.js';
import {
  createDualChannelHarnesses as createImageDualChannelHarnesses,
} from '../model-supply/provider-conformance/image/fake-channel.js';
import {
  runImageLifecycleConformance,
} from '../model-supply/provider-conformance/image/suite.js';
import {
  createDualChannelHarnesses as createVideoDualChannelHarnesses,
} from '../model-supply/provider-conformance/video/fake-channel.js';
import {
  runVideoLifecycleConformance,
} from '../model-supply/provider-conformance/video/suite.js';
import {
  evaluateMultiChannelPublishGate,
} from './publish-gate.js';

export type Story30StepId =
  | 'procurement'
  | 'credential'
  | 'conformance'
  | 'publish'
  | 'allocate'
  | 'task_ledger'
  | 'audit';

export interface Story30StepResult {
  step: Story30StepId;
  ok: boolean;
  detail: string;
  evidence?: Record<string, unknown>;
}

export interface Story30ChainResult {
  modality: 'llm' | 'image' | 'video';
  operation: 'copy.generate' | 'image.generate' | 'video.generate';
  steps: Story30StepResult[];
  passed: boolean;
  dualChannelReady: boolean;
  multiChannelPublishAllowed: boolean;
}

const NOW = '2026-07-20T12:00:00.000Z';

function procurementEntities(modality: Story30ChainResult['modality']) {
  const suffix = modality;
  return {
    providerOfficial: {
      id: `provider-ark-${suffix}`,
      displayName: '方舟官方',
      counterparty: 'volcengine-ark',
      revisionId: `pp-ark-${suffix}:r1`,
    },
    providerReseller: {
      id: `provider-tuzi-${suffix}`,
      displayName: '兔子中转',
      counterparty: 'tuzi-reseller',
      revisionId: `pp-tuzi-${suffix}:r1`,
    },
    contractOfficial: {
      id: `contract-ark-${suffix}`,
      providerProfileId: `provider-ark-${suffix}`,
      termsRevisionId: `terms-ark-${suffix}:r1`,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    },
    contractReseller: {
      id: `contract-tuzi-${suffix}`,
      providerProfileId: `provider-tuzi-${suffix}`,
      termsRevisionId: `terms-tuzi-${suffix}:r1`,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    },
    channelOfficial: {
      id: `channel-ark-direct-${suffix}`,
      providerProfileId: `provider-ark-${suffix}`,
      kind: 'official_direct' as const,
      region: 'domestic',
      accountOwnership: 'platform' as const,
      revisionId: `ch-ark-${suffix}:r1`,
    },
    channelReseller: {
      id: `channel-tuzi-reseller-${suffix}`,
      providerProfileId: `provider-tuzi-${suffix}`,
      kind: 'upstream_reseller' as const,
      region: 'overseas',
      accountOwnership: 'platform' as const,
      revisionId: `ch-tuzi-${suffix}:r1`,
    },
    catalogModelId: `model-${suffix}-core`,
    deploymentOfficial: `dep-${suffix}-ark`,
    deploymentReseller: `dep-${suffix}-tuzi`,
  };
}

function activateCredential(input: {
  id: string;
  label: string;
  providerProfileId: string;
}) {
  let account = createCredentialAccount({
    id: input.id,
    label: input.label,
    providerProfileId: input.providerProfileId,
    type: 'api_key',
    scope: 'platform',
    secretReference: `secret://${input.id}/v1`,
    version: 'v1',
    secretVersion: 1,
    credentialId: `cred-inner-${input.id}`,
    connectionId: `conn-${input.id}`,
    workspaceId: 'ws-platform',
    provider: 'model',
    status: 'pending',
    source: 'registry',
    now: NOW,
  });

  const evidence: CredentialTestEvidence = {
    status: 'passed',
    testedAt: NOW,
    evidenceRef: `probe:${input.id}`,
  };
  account = transitionCredentialLifecycle(
    account,
    { kind: 'record_test', evidence },
    { now: NOW },
  );
  account = transitionCredentialLifecycle(
    account,
    { kind: 'activate' },
    { now: NOW },
  );
  assertNoSecretEcho(account);
  return account;
}

/**
 * Run story 30 recorded chain for one modality.
 * Image/video use lifecycle harnesses; text uses dual-channel recorded suite.
 */
export async function runStory30RecordedChain(
  modality: Story30ChainResult['modality'],
): Promise<Story30ChainResult> {
  const operation =
    modality === 'llm'
      ? 'copy.generate'
      : modality === 'image'
        ? 'image.generate'
        : 'video.generate';
  const entities = procurementEntities(modality);
  const steps: Story30StepResult[] = [];

  // 1. procurement: structured ProviderProfile + SupplyContract + channels
  steps.push({
    step: 'procurement',
    ok: true,
    detail: 'ProviderProfile/SupplyContract/ExecutionChannel assembled',
    evidence: {
      providers: [
        entities.providerOfficial.id,
        entities.providerReseller.id,
      ],
      contracts: [
        entities.contractOfficial.id,
        entities.contractReseller.id,
      ],
      channels: [entities.channelOfficial.id, entities.channelReseller.id],
      catalogModelId: entities.catalogModelId,
      deployments: [
        entities.deploymentOfficial,
        entities.deploymentReseller,
      ],
    },
  });

  // 2. credential: secret reference write + test + activate (no secret echo)
  const credOfficial = activateCredential({
    id: `cred-${modality}-ark`,
    label: `方舟 ${modality}`,
    providerProfileId: entities.providerOfficial.id,
  });
  const credReseller = activateCredential({
    id: `cred-${modality}-tuzi`,
    label: `兔子 ${modality}`,
    providerProfileId: entities.providerReseller.id,
  });
  steps.push({
    step: 'credential',
    ok:
      credOfficial.status === 'active' &&
      credReseller.status === 'active' &&
      !JSON.stringify(credOfficial).includes('sk-') &&
      !JSON.stringify(credReseller).includes('sk-'),
    detail: 'CredentialAccount tested + activated; secrets never echoed',
    evidence: {
      official: {
        id: credOfficial.id,
        status: credOfficial.status,
        version: credOfficial.version,
      },
      reseller: {
        id: credReseller.id,
        status: credReseller.status,
        version: credReseller.version,
      },
    },
  });

  // 3. conformance: dual-channel recorded / fake
  let dualChannelReady = false;
  let activationInputs: Parameters<typeof dualChannelActivationGateReady>[0] =
    [];
  let imageVideoCases = 0;

  if (modality === 'llm') {
    const dual = await runRecordedTextDualChannelConformance({
      operation: 'copy.generate',
      observedAt: NOW,
    });
    dualChannelReady = dual.dualChannelReady;
    activationInputs = dual.activationEvidenceInputs;
    steps.push({
      step: 'conformance',
      ok: dual.dualChannelReady && dual.channels.every((c) => c.passed),
      detail: 'MP-04T recorded dual-channel conformance',
      evidence: {
        dualChannelReady: dual.dualChannelReady,
        channels: dual.channels.map((c) => ({
          kind: c.channelKind,
          passed: c.passed,
          deploymentId: c.deploymentId,
        })),
      },
    });
  } else if (modality === 'image') {
    const harnesses = createImageDualChannelHarnesses();
    const officialReport = await runImageLifecycleConformance(harnesses.official);
    const resellerReport = await runImageLifecycleConformance(harnesses.reseller);
    imageVideoCases =
      officialReport.cases.length + resellerReport.cases.length;
    dualChannelReady =
      officialReport.channelKind === 'official_direct' &&
      resellerReport.channelKind === 'upstream_reseller' &&
      officialReport.cases.length > 0 &&
      resellerReport.cases.length > 0;
    steps.push({
      step: 'conformance',
      ok: dualChannelReady,
      detail: 'MP-04I fake dual-channel lifecycle conformance',
      evidence: {
        officialCases: officialReport.cases.length,
        resellerCases: resellerReport.cases.length,
        dualChannelReady,
      },
    });
  } else {
    const harnesses = createVideoDualChannelHarnesses();
    const officialReport = await runVideoLifecycleConformance(harnesses.official);
    const resellerReport = await runVideoLifecycleConformance(harnesses.reseller);
    imageVideoCases =
      officialReport.cases.length + resellerReport.cases.length;
    dualChannelReady =
      officialReport.channelKind === 'official_direct' &&
      resellerReport.channelKind === 'upstream_reseller' &&
      officialReport.cases.length > 0 &&
      resellerReport.cases.length > 0;
    steps.push({
      step: 'conformance',
      ok: dualChannelReady,
      detail: 'MP-04V fake dual-channel lifecycle conformance',
      evidence: {
        officialCases: officialReport.cases.length,
        resellerCases: resellerReport.cases.length,
        dualChannelReady,
      },
    });
  }

  // 4. publish: RoutePolicy candidate → simulate → approve → publish
  const registry = new RoutePolicyRegistry();
  const candidate = registry.createCandidate(
    {
      operation,
      qualityTier: 'quality',
      hardConstraints: ['deployment_active', 'operation_supported'],
      candidateDeploymentIds: [
        entities.deploymentOfficial,
        entities.deploymentReseller,
      ],
      maxAttempts: 2,
      fallbackAuthorized: true,
    },
    { actorId: 'admin-z2a', correlationId: `corr-${modality}-publish` },
  );
  const simulated = registry.simulate(
    candidate.id,
    {
      eligibleDeploymentIds: [
        entities.deploymentOfficial,
        entities.deploymentReseller,
      ],
      excluded: [],
      estimatedMaximumCostMicros: 50_000,
      simulatedAt: NOW,
    },
    { actorId: 'admin-z2a', correlationId: `corr-${modality}-publish` },
  );
  const approved = registry.approve(simulated.id, {
    actorId: 'admin-z2a',
    correlationId: `corr-${modality}-publish`,
    reason: 'z2-accept story30 recorded',
  });
  const published = registry.publish(approved.id, null, {
    actorId: 'admin-z2a',
    correlationId: `corr-${modality}-publish`,
    reason: 'z2-accept story30 recorded',
  });
  const head = registry.getEffectiveHead(operation, 'quality');
  steps.push({
    step: 'publish',
    ok: published.stage === 'published' && head?.id === published.id,
    detail: 'RoutePolicy published as sole effective head',
    evidence: {
      revisionId: published.id,
      candidateDeploymentIds: published.payload.candidateDeploymentIds,
      stage: published.stage,
    },
  });

  // Publish gate: multi-channel claim with 2 fault domains must pass;
  // claim with 1 must reject.
  const dualGate = evaluateMultiChannelPublishGate({
    operation,
    catalogModelId: entities.catalogModelId,
    claim: 'multi_channel_ready',
    qualifiedDeployments: [
      {
        deploymentId: entities.deploymentOfficial,
        channelKind: 'official_direct',
        faultDomainKey: `${entities.providerOfficial.id}::official_direct`,
        activationStatus: 'recorded',
      },
      {
        deploymentId: entities.deploymentReseller,
        channelKind: 'upstream_reseller',
        faultDomainKey: `${entities.providerReseller.id}::upstream_reseller`,
        activationStatus: 'recorded',
      },
    ],
  });
  const singleGate = evaluateMultiChannelPublishGate({
    operation,
    catalogModelId: entities.catalogModelId,
    claim: 'multi_channel_ready',
    qualifiedDeployments: [
      {
        deploymentId: entities.deploymentOfficial,
        channelKind: 'official_direct',
        faultDomainKey: `${entities.providerOfficial.id}::official_direct`,
        activationStatus: 'recorded',
      },
    ],
  });
  const multiChannelPublishAllowed =
    dualGate.allowed === true && singleGate.allowed === false;

  // 5. allocate: SupplyPool + AccountAllocation
  const pools = new SupplyPoolRegistry();
  const pool = pools.registerShared({
    id: `pool-shared-${modality}`,
    displayName: `共享池 ${modality}`,
    credentialAccountIds: [credOfficial.id, credReseller.id],
    deploymentIds: [entities.deploymentOfficial, entities.deploymentReseller],
    revisionId: `pool-${modality}:r1`,
  });
  const allocations = new AccountAllocationStore();
  const allocation = allocations.append({
    accountId: 'acct-test-merchant',
    workspaceId: 'ws-test-merchant',
    kind: 'grant',
    target: { type: 'catalog_model', catalogModelId: entities.catalogModelId },
    delta: { mode: 'set', enabled: true },
    source: 'account_override',
    reason: 'z2-accept story30 test allocation',
    actorId: 'admin-z2a',
    startsAt: NOW,
    endsAt: null,
    correlationId: `corr-${modality}-alloc`,
  });
  steps.push({
    step: 'allocate',
    ok: pool.kind === 'shared' && allocation.id.length > 0,
    detail: 'SupplyPool registered + AccountAllocation granted',
    evidence: {
      poolId: pool.id,
      allocationId: allocation.id,
      workspaceId: allocation.workspaceId,
    },
  });

  // 6. task → ledger freeze (RouteSnapshot ref + credential version + supplier task)
  const freeze = buildSupplyRequestFreeze({
    id: `freeze-${modality}-001`,
    workspaceId: 'ws-test-merchant',
    routeSnapshotRef: `route-snap:${published.id}:${entities.deploymentOfficial}`,
    credentialAccountVersion: credOfficial.version,
    supplierRequestTaskId: `supplier-task-${modality}-001`,
    usage: {
      resource:
        modality === 'llm' ? 'copy' : modality === 'image' ? 'image' : 'video',
      quantity: 1,
      unit: modality === 'video' ? 'second' : 'request',
    },
    supplierPriceRevision: {
      id: `price-${modality}-r1`,
      deploymentId: entities.deploymentOfficial,
      amountMicros: 12_000,
      currency: 'CNY',
      unit: modality === 'video' ? 'second' : 'request',
      evidence: {
        source: 'observed_usage',
        observedAt: NOW,
      },
      revisionId: `price-${modality}:r1`,
    },
    supplyPoolId: pool.id,
    productUsageTaskId: `task-${modality}-001`,
    frozenAt: NOW,
  });
  steps.push({
    step: 'task_ledger',
    ok:
      freeze.routeSnapshotRef.includes(published.id) &&
      freeze.credentialAccountVersion === credOfficial.version &&
      freeze.supplyPoolId === pool.id,
    detail: 'SupplyRequestFreeze captured RouteSnapshot + credential version',
    evidence: {
      freezeId: freeze.id,
      routeSnapshotRef: freeze.routeSnapshotRef,
      supplierRequestTaskId: freeze.supplierRequestTaskId,
    },
  });

  // 7. audit drilldown projection (immutable trail)
  const auditTrail = {
    correlationId: `corr-${modality}-publish`,
    routePolicyRevisionId: published.id,
    poolId: pool.id,
    allocationId: allocation.id,
    freezeId: freeze.id,
    credentialVersions: [credOfficial.version, credReseller.version],
    dualChannelReady,
    multiChannelPublishAllowed,
    conformanceNote:
      modality === 'llm'
        ? 'text dual-channel recorded'
        : `${modality} dual-channel fake lifecycle (${imageVideoCases} cases)`,
    activationGate:
      modality === 'llm'
        ? dualChannelActivationGateReady(activationInputs)
        : dualChannelReady,
  };
  steps.push({
    step: 'audit',
    ok:
      auditTrail.routePolicyRevisionId === published.id &&
      auditTrail.freezeId === freeze.id &&
      multiChannelPublishAllowed,
    detail: 'Audit trail links publish → allocate → freeze; publish gate enforced',
    evidence: auditTrail,
  });

  const passed = steps.every((step) => step.ok);

  return {
    modality,
    operation,
    steps,
    passed,
    dualChannelReady,
    multiChannelPublishAllowed,
  };
}

/** Run story 30 for all three core modalities (recorded/fake). */
export async function runStory30TriModalRecorded(): Promise<{
  results: Story30ChainResult[];
  allPassed: boolean;
}> {
  const results: Story30ChainResult[] = [];
  for (const modality of ['llm', 'image', 'video'] as const) {
    results.push(await runStory30RecordedChain(modality));
  }
  return {
    results,
    allPassed: results.every((r) => r.passed),
  };
}
