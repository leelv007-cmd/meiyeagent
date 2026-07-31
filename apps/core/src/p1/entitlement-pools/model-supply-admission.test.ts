import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProductEntitlementPolicy } from '../foundation/entitlement-policy.js';
import {
  ModelSupplyApplicationService,
  type ProviderExecutionPort,
} from '../model-supply/index.js';
import type { AccountAllocation, EntitlementPolicyRevision } from './contracts.js';
import { PostgresModelSupplyProviderAdmission } from './model-supply-admission.js';
import type {
  AcquireFairPostgresCapacityLeaseInput,
  AcquirePostgresCapacityLeaseInput,
  PersistedSupplyPool,
} from './postgres-repository.js';

const productPolicy: ProductEntitlementPolicy = {
  revision: 'product:growth:r1',
  tier: 'growth',
  allowance: { copy: 10, image: 2, video: 1, audio: 1 },
  concurrencyLimit: 3,
  queuePriority: 4,
  supportLabel: 'priority',
  addOns: [],
  autoTopUp: {
    enabled: false,
    monthlyCapMicros: 0,
    spentThisMonthMicros: 0,
  },
};

const durablePolicy: EntitlementPolicyRevision = {
  id: 'entitlement:growth:r7',
  tier: 'growth',
  body: {
    tier: 'growth',
    allowance: { copy: 10, image: 2, video: 1, audio: 1 },
    concurrencyLimit: 2,
    queuePriority: 5,
    supportLabel: 'priority',
    rateLabel: 'elevated',
    allowedCatalogModelIds: ['copy-governed'],
    allowedQualityTiers: ['quality', 'balanced'],
    availableSupplyPoolIds: ['pool-shared'],
    overage: { mode: 'block' },
    validity: { validFrom: null, validUntil: null },
  },
  revision: 7,
  stage: 'published',
  actorId: 'admin-a',
  reason: 'Publish growth policy',
  correlationId: 'corr-policy-7',
  createdAt: '2026-07-20T00:00:00.000Z',
  rolledBackToRevision: null,
};

const model = {
  id: 'copy-governed',
  modality: 'llm' as const,
  operations: ['copy.generate' as const],
  displayName: 'Governed copy',
  qualityRank: 90,
};

const deployment = {
  id: 'deployment-governed',
  catalogModelId: model.id,
  apiFamily: 'openai' as const,
  channel: 'direct' as const,
  region: 'domestic' as const,
  status: 'active' as const,
  credentialVersion: 'credential-v3',
  unitPrice: {
    amountMicros: 1_200,
    currency: 'CNY' as const,
    unit: 'request',
  },
};

function allocation(
  overrides: Partial<AccountAllocation> = {},
): AccountAllocation {
  return {
    id: 'allocation:copy-restrict',
    accountId: 'account-a',
    workspaceId: 'workspace-a',
    kind: 'restrict',
    target: { type: 'catalog_model', catalogModelId: model.id },
    delta: { mode: 'set', enabled: false },
    source: 'risk_control',
    reason: 'Temporary model restriction',
    actorId: 'admin-a',
    startsAt: '2026-07-20T00:00:00.000Z',
    endsAt: null,
    status: 'active',
    rolledBackAt: null,
    correlationId: 'corr-allocation',
    createdAt: '2026-07-20T00:00:00.000Z',
    ...overrides,
  };
}

function admissionHarness(
  activeAllocations: AccountAllocation[],
  options: {
    policy?: EntitlementPolicyRevision;
    pools?: PersistedSupplyPool[];
    defaultSupplyPoolId?: string;
  } = {},
) {
  const acquired: AcquirePostgresCapacityLeaseInput[] = [];
  const released: string[] = [];
  const admission = new PostgresModelSupplyProviderAdmission({
    productEntitlements: {
      async resolve() {
        return productPolicy;
      },
    },
    entitlementPolicies: {
      async getPublished() {
        return options.policy ?? durablePolicy;
      },
    },
    accountAllocations: {
      async listActive() {
        return activeAllocations;
      },
    },
    supplyPools: {
      async list() {
        return options.pools ?? [
          {
            id: 'pool-shared',
            kind: 'shared' as const,
            displayName: 'Shared',
            credentialAccountIds: ['credential-shared'],
            deploymentIds: [deployment.id],
            capacity: {
              supplyAccount: { concurrency: 8 },
              productAccount: { concurrency: 6 },
              systemTotal: { concurrency: 20 },
            },
            revisionId: 'pool-shared:r1',
          },
        ];
      },
    },
    capacityLeases: {
      async tryAcquire(input) {
        acquired.push(input);
        return {
          status: 'admitted' as const,
          lease: {
            leaseId: input.leaseId,
            supplyAccountId: input.supplyAccountId,
            productAccountId: input.productAccountId,
            workspaceId: input.workspaceId,
            acquiredAt: input.acquiredAt,
          },
        };
      },
      async tryAcquireFair(input) {
        acquired.push(input);
        return {
          status: 'admitted' as const,
          lease: {
            leaseId: input.leaseId,
            supplyAccountId: input.supplyAccountId,
            productAccountId: input.productAccountId,
            workspaceId: input.workspaceId,
            acquiredAt: input.acquiredAt,
          },
        };
      },
      async release(leaseId) {
        released.push(leaseId);
        return true;
      },
    },
    ...(options.defaultSupplyPoolId
      ? { defaultSupplyPoolId: options.defaultSupplyPoolId }
      : {}),
  });
  return { acquired, admission, released };
}

function service(
  admission: PostgresModelSupplyProviderAdmission,
  execution: ProviderExecutionPort,
) {
  return new ModelSupplyApplicationService({
    models: [model],
    deployments: [deployment],
    execution,
    providerAdmission: admission,
    ledger: {
      async checkpointAttempt() {
        return { replayed: false };
      },
      async freezeAttempt() {
        return { persisted: true };
      },
      async settleAttempt() {},
    },
  });
}

test('durable account restriction blocks the selected CatalogModel before provider I/O', async () => {
  const harness = admissionHarness([allocation()]);
  let providerCalls = 0;
  const result = await service(harness.admission, {
    async execute() {
      providerCalls += 1;
      throw new Error('provider must not be called');
    },
  }).submit({
    workspaceId: 'workspace-a',
    actorId: 'account-a',
    idempotencyKey: 'restricted-model',
    operation: 'copy.generate',
    selection: { mode: 'fixed', catalogModelId: model.id },
    dataClass: [],
    prompt: '生成文案',
  });

  assert.equal(providerCalls, 0);
  assert.equal(result.failureCode, 'CATALOG_MODEL_NOT_ENTITLED');
  assert.deepEqual(harness.acquired, []);
});

test('effective concurrency acquires and releases a durable capacity lease', async () => {
  const grant = allocation({
    id: 'allocation:concurrency-cap',
    target: { type: 'concurrency' },
    delta: { mode: 'cap', amount: 1 },
  });
  const harness = admissionHarness([grant]);
  const result = await service(harness.admission, {
    async execute() {
      return {
        kind: 'completed',
        providerCost: {
          amount: 0.0012,
          currency: 'CNY',
          usage: { outputTokens: 20 },
        },
      };
    },
  }).submit({
    workspaceId: 'workspace-a',
    actorId: 'account-a',
    idempotencyKey: 'capacity-admitted',
    operation: 'copy.generate',
    selection: { mode: 'fixed', catalogModelId: model.id },
    dataClass: [],
    prompt: '生成文案',
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.snapshot.entitlementPolicyRevision, durablePolicy.id);
  assert.deepEqual(result.snapshot.appliedAllocationIds, [grant.id]);
  assert.equal(harness.acquired.length, 1);
  assert.equal(
    (harness.acquired[0] as AcquireFairPostgresCapacityLeaseInput)
      .queueRequestId,
    harness.acquired[0]?.leaseId.replace('capacity:', 'capacity-queue:'),
  );
  assert.match(
    harness.acquired[0]?.leaseId ?? '',
    /:deployment-governed:pool-shared:credential-shared:account-a$/,
  );
  assert.equal(
    (harness.acquired[0]?.limits as {
      productAccount: { concurrency: number };
    }).productAccount.concurrency,
    1,
  );
  assert.deepEqual(harness.released, [harness.acquired[0]?.leaseId]);
});

test('capacity admission starts a fresh lease when a frozen route resumes after its interaction deadline', async () => {
  const harness = admissionHarness([]);
  const frozenAt = '2026-07-20T00:00:00.000Z';
  const admissionStartedAt = Date.now();

  const decision = await harness.admission.admit({
    submission: {
      workspaceId: 'workspace-a',
      actorId: 'account-a',
      idempotencyKey: 'resumed-after-interaction-deadline',
      operation: 'copy.generate',
      selection: { mode: 'fixed', catalogModelId: model.id },
      dataClass: [],
      prompt: 'Generate copy after the merchant question expires',
    },
    jobId: 'job-resumed-after-interaction-deadline',
    attemptId: 'attempt-resumed-after-interaction-deadline',
    snapshot: {
      id: 'snapshot-resumed-after-interaction-deadline',
      catalogRevisionId: 'catalog-r1',
      requestedSelection: { mode: 'fixed', catalogModelId: model.id },
      candidateCatalogModelIds: [model.id],
      actualCatalogModelId: model.id,
      deploymentId: deployment.id,
      credentialAccountId: 'credential-shared',
      fallbackConsent: false,
      reason: 'fixed_selection',
      dataClass: [],
      createdAt: frozenAt,
    },
    model,
    deployment,
  });

  assert.equal(decision.status, 'admitted');
  assert.equal(harness.acquired.length, 1);
  const acquiredAt = Date.parse(harness.acquired[0]?.acquiredAt ?? '');
  assert.ok(acquiredAt >= admissionStartedAt);
  assert.notEqual(harness.acquired[0]?.acquiredAt, frozenAt);
});

test('each provider candidate gets a distinct fair-queue and lease identity in the same pool', async () => {
  const secondDeployment = {
    ...deployment,
    id: 'deployment-governed-fallback',
  };
  const harness = admissionHarness([], {
    pools: [
      {
        id: 'pool-shared',
        kind: 'shared',
        displayName: 'Shared',
        credentialAccountIds: [
          'credential-shared',
          'credential-shared-fallback',
        ],
        deploymentIds: [deployment.id, secondDeployment.id],
        revisionId: 'pool-shared:r1',
      },
    ],
  });
  const submission = {
    workspaceId: 'workspace-a',
    actorId: 'account-a',
    idempotencyKey: 'candidate-fallback',
    operation: 'copy.generate' as const,
    selection: { mode: 'fixed' as const, catalogModelId: model.id },
    dataClass: [],
    prompt: 'Generate copy',
  };
  const snapshot = {
    id: 'snapshot-candidate-fallback',
    catalogRevisionId: 'catalog-r1',
    requestedSelection: submission.selection,
    candidateCatalogModelIds: [model.id],
    actualCatalogModelId: model.id,
    deploymentId: deployment.id,
    credentialAccountId: 'credential-shared',
    fallbackConsent: true,
    reason: 'fixed_selection' as const,
    dataClass: [],
    createdAt: new Date().toISOString(),
  };

  const first = await harness.admission.admit({
    submission,
    jobId: 'job-candidate-fallback',
    attemptId: 'provider-attempt-1',
    snapshot,
    model,
    deployment,
  });
  const second = await harness.admission.admit({
    submission,
    jobId: 'job-candidate-fallback',
    attemptId: 'provider-attempt-2',
    snapshot: { ...snapshot, deploymentId: secondDeployment.id },
    model,
    deployment: secondDeployment,
  });
  const changedAccount = await harness.admission.admit({
    submission,
    jobId: 'job-candidate-fallback',
    attemptId: 'provider-attempt-3',
    snapshot: {
      ...snapshot,
      deploymentId: secondDeployment.id,
      credentialAccountId: 'credential-shared-fallback',
    },
    model,
    deployment: secondDeployment,
  });

  assert.equal(first.status, 'admitted');
  assert.equal(second.status, 'admitted');
  assert.equal(changedAccount.status, 'admitted');
  assert.equal(harness.acquired.length, 3);
  const [firstAcquire, secondAcquire, changedAccountAcquire] =
    harness.acquired as [
      AcquireFairPostgresCapacityLeaseInput,
      AcquireFairPostgresCapacityLeaseInput,
      AcquireFairPostgresCapacityLeaseInput,
    ];
  assert.notEqual(firstAcquire.queueRequestId, secondAcquire.queueRequestId);
  assert.notEqual(
    secondAcquire.queueRequestId,
    changedAccountAcquire.queueRequestId,
  );
  assert.notEqual(firstAcquire.leaseId, secondAcquire.leaseId);
  assert.notEqual(secondAcquire.leaseId, changedAccountAcquire.leaseId);
  assert.match(firstAcquire.queueRequestId, /provider-attempt-1/);
  assert.match(secondAcquire.queueRequestId, /provider-attempt-2/);
  assert.match(
    changedAccountAcquire.queueRequestId,
    /provider-attempt-3:.*:credential-shared-fallback:/,
  );
});

test('denies shared-to-dedicated fallback without explicit data-policy authorization', async () => {
  const dedicatedGrant = allocation({
    id: 'allocation:dedicated-pool',
    kind: 'grant',
    target: { type: 'supply_pool', supplyPoolId: 'pool-dedicated' },
    delta: { mode: 'set', enabled: true },
  });
  const admission = new PostgresModelSupplyProviderAdmission({
    productEntitlements: { async resolve() { return productPolicy; } },
    entitlementPolicies: {
      async getPublished() {
        return {
          ...durablePolicy,
          body: {
            ...durablePolicy.body,
            availableSupplyPoolIds: ['pool-shared', 'pool-dedicated'],
          },
        };
      },
    },
    accountAllocations: { async listActive() { return [dedicatedGrant]; } },
    supplyPools: {
      async list() {
        return [
          {
            id: 'pool-shared',
            kind: 'shared' as const,
            displayName: 'Shared',
            credentialAccountIds: ['credential-shared'],
            deploymentIds: [deployment.id],
            revisionId: 'pool-shared:r1',
          },
          {
            id: 'pool-dedicated',
            kind: 'dedicated' as const,
            displayName: 'Dedicated',
            credentialAccountIds: ['credential-dedicated'],
            deploymentIds: [deployment.id],
            authorizedWorkspaceIds: ['workspace-a'],
            revisionId: 'pool-dedicated:r1',
          },
        ];
      },
    },
    capacityLeases: {
      async tryAcquire() { throw new Error('capacity must not be acquired'); },
      async release() { return false; },
    },
  });

  const decision = await admission.admit({
    submission: {
      workspaceId: 'workspace-a',
      actorId: 'account-a',
      idempotencyKey: 'dedicated-fallback-denied',
      operation: 'copy.generate',
      selection: { mode: 'fixed', catalogModelId: model.id },
      dataClass: [],
      prompt: 'Generate copy',
    },
    jobId: 'job-dedicated-fallback',
    attemptId: 'attempt-dedicated-fallback',
    snapshot: {
      id: 'snapshot-dedicated-fallback',
      catalogRevisionId: 'catalog-r1',
      requestedSelection: { mode: 'fixed', catalogModelId: model.id },
      candidateCatalogModelIds: [model.id],
      actualCatalogModelId: model.id,
      deploymentId: deployment.id,
      credentialAccountId: 'credential-dedicated',
      fallbackConsent: false,
      reason: 'fixed_selection',
      dataClass: [],
      createdAt: new Date().toISOString(),
    },
    model,
    deployment,
  });

  assert.equal(decision.status, 'rejected');
  if (decision.status === 'rejected') {
    assert.equal(decision.errorCode, 'CROSS_KIND_FALLBACK_DENIED');
  }
});

test('dedicated pool rejects a data class outside its explicit restriction', async () => {
  const policy: EntitlementPolicyRevision = {
    ...durablePolicy,
    body: {
      ...durablePolicy.body,
      availableSupplyPoolIds: ['pool-dedicated'],
    },
  };
  const harness = admissionHarness([], {
    policy,
    defaultSupplyPoolId: 'pool-dedicated',
    pools: [
      {
        id: 'pool-dedicated',
        kind: 'dedicated',
        displayName: 'Dedicated',
        credentialAccountIds: ['credential-dedicated'],
        deploymentIds: [deployment.id],
        contractRef: 'contract-a',
        authorizedWorkspaceIds: ['workspace-a'],
        regionRestriction: ['domestic'],
        dataClassRestriction: ['public'],
        revisionId: 'pool-dedicated:r1',
      },
    ],
  });

  const result = await service(harness.admission, {
    async execute() {
      throw new Error('restricted data must not reach provider');
    },
  }).submit({
    workspaceId: 'workspace-a',
    actorId: 'account-a',
    idempotencyKey: 'dedicated-data-restricted',
    operation: 'copy.generate',
    selection: { mode: 'fixed', catalogModelId: model.id },
    dataClass: ['pii'],
    prompt: '受限数据',
  });

  assert.equal(result.failureCode, 'SUPPLY_POOL_NOT_ENTITLED');
  assert.deepEqual(harness.acquired, []);
});

test('shared and dedicated pools never cross-fallback without contract and data-policy authorization', async () => {
  const policy: EntitlementPolicyRevision = {
    ...durablePolicy,
    body: {
      ...durablePolicy.body,
      availableSupplyPoolIds: ['pool-dedicated', 'pool-shared'],
    },
  };
  const harness = admissionHarness([], {
    policy,
    defaultSupplyPoolId: 'pool-dedicated',
    pools: [
      {
        id: 'pool-dedicated',
        kind: 'dedicated',
        displayName: 'Dedicated',
        credentialAccountIds: ['credential-dedicated'],
        deploymentIds: [deployment.id],
        contractRef: 'contract-a',
        authorizedWorkspaceIds: ['another-workspace'],
        revisionId: 'pool-dedicated:r1',
      },
      {
        id: 'pool-shared',
        kind: 'shared',
        displayName: 'Shared',
        credentialAccountIds: ['credential-shared'],
        deploymentIds: [deployment.id],
        revisionId: 'pool-shared:r1',
      },
    ],
  });

  const result = await service(harness.admission, {
    async execute() {
      throw new Error('unauthorized cross-kind fallback must not execute');
    },
  }).submit({
    workspaceId: 'workspace-a',
    actorId: 'account-a',
    idempotencyKey: 'cross-kind-fallback-denied',
    operation: 'copy.generate',
    selection: { mode: 'fixed', catalogModelId: model.id },
    dataClass: [],
    prompt: '不允许静默降级',
  });

  assert.equal(result.failureCode, 'CROSS_KIND_FALLBACK_DENIED');
  assert.deepEqual(harness.acquired, []);
});
