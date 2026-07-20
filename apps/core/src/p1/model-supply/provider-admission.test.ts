import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ModelSupplyApplicationService,
  type ModelSupplyProviderAdmissionPort,
  type ProviderExecutionPort,
} from './index.js';

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

function submission(idempotencyKey: string) {
  return {
    workspaceId: 'workspace-a',
    actorId: 'account-a',
    idempotencyKey,
    operation: 'copy.generate' as const,
    selection: { mode: 'fixed' as const, catalogModelId: model.id },
    dataClass: [],
    prompt: '生成一条美业文案',
  };
}

test('provider admission rejects before the provider is invoked', async () => {
  let providerCalls = 0;
  const provider: ProviderExecutionPort = {
    async execute() {
      providerCalls += 1;
      throw new Error('provider must not be invoked');
    },
  };
  const admission: ModelSupplyProviderAdmissionPort = {
    async admit() {
      return {
        status: 'rejected',
        errorCode: 'CAPACITY_EXHAUSTED',
        message: 'Product-account concurrency exhausted.',
      };
    },
    async release() {
      throw new Error('rejected admissions have no lease');
    },
  };
  const service = new ModelSupplyApplicationService({
    models: [model],
    deployments: [deployment],
    execution: provider,
    providerAdmission: admission,
  });

  const result = await service.submit(submission('admission-rejected'));

  assert.equal(providerCalls, 0);
  assert.equal(result.status, 'failed');
  assert.equal(result.failureCode, 'CAPACITY_EXHAUSTED');
  assert.equal(result.attempt.acceptance, 'rejected_before_accept');
});

test('provider admission freezes pool facts and releases its lease after execution', async () => {
  const released: string[] = [];
  const admission: ModelSupplyProviderAdmissionPort = {
    async admit() {
      return {
        status: 'admitted',
        leaseId: 'capacity:model-attempt-a',
        supplyPoolId: 'pool-shared',
        entitlementPolicyRevision: 'entitlement:growth:r7',
        appliedAllocationIds: ['allocation:campaign'],
      };
    },
    async release(leaseId) {
      released.push(leaseId);
    },
  };
  const service = new ModelSupplyApplicationService({
    models: [model],
    deployments: [deployment],
    execution: {
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
    },
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

  const result = await service.submit(submission('admission-released'));

  assert.equal(result.status, 'completed');
  assert.equal(result.snapshot.supplyPoolId, 'pool-shared');
  assert.equal(
    result.snapshot.entitlementPolicyRevision,
    'entitlement:growth:r7',
  );
  assert.deepEqual(result.snapshot.appliedAllocationIds, [
    'allocation:campaign',
  ]);
  assert.deepEqual(released, ['capacity:model-attempt-a']);
});

test('freeze persistence failure releases capacity and stays rejected before provider I/O', async () => {
  const released: string[] = [];
  let providerCalls = 0;
  const service = new ModelSupplyApplicationService({
    models: [model],
    deployments: [deployment],
    execution: {
      async execute() {
        providerCalls += 1;
        throw new Error('provider must not be invoked');
      },
    },
    providerAdmission: {
      async admit() {
        return {
          status: 'admitted',
          leaseId: 'capacity:freeze-failure',
          supplyPoolId: 'pool-shared',
          entitlementPolicyRevision: 'entitlement:growth:r7',
          appliedAllocationIds: [],
        };
      },
      async release(leaseId) {
        released.push(leaseId);
      },
    },
    ledger: {
      async checkpointAttempt() {
        return { replayed: false };
      },
      async freezeAttempt() {
        throw new Error('freeze store unavailable');
      },
      async settleAttempt() {},
    },
  });

  const result = await service.submit(submission('freeze-failure'));

  assert.equal(providerCalls, 0);
  assert.equal(result.status, 'failed');
  assert.equal(result.attempt.acceptance, 'rejected_before_accept');
  assert.deepEqual(released, ['capacity:freeze-failure']);
});

test('lease release failure does not rewrite a completed provider outcome', async () => {
  const service = new ModelSupplyApplicationService({
    models: [model],
    deployments: [deployment],
    execution: {
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
    },
    providerAdmission: {
      async admit() {
        return {
          status: 'admitted',
          leaseId: 'capacity:release-failure',
          supplyPoolId: 'pool-shared',
          entitlementPolicyRevision: 'entitlement:growth:r7',
          appliedAllocationIds: [],
        };
      },
      async release() {
        throw new Error('lease release unavailable');
      },
    },
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

  const result = await service.submit(submission('release-failure'));

  assert.equal(result.status, 'completed');
  assert.equal(result.attempt.acceptance, 'accepted');
  assert.equal(result.providerCost.status, 'observed');
});
