import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MemoryFoundationRepository,
  P1ApplicationService,
  ProductEntitlementApplicationService,
} from '../foundation/index.js';
import {
  FakeKmsSecretStore,
  FoundationStrictByokLedger,
  IntegrationApplicationService,
  MemoryIntegrationRepository,
  RecordedByokExecutionAdapter,
} from './index.js';

const owner = {
  workspaceId: 'workspace-byok-ledger',
  userId: 'owner-byok-ledger',
  role: 'owner' as const,
  correlationId: 'corr-byok-ledger',
};

async function fixture() {
  const foundationRepository = new MemoryFoundationRepository();
  foundationRepository.grantOwner(owner.workspaceId, owner.userId);
  const foundation = new P1ApplicationService(foundationRepository);
  const entitlements = new ProductEntitlementApplicationService(
    foundationRepository,
  );
  await entitlements.activatePlan(
    owner,
    {
      paymentEventId: 'payment-growth',
      policy: {
        revision: 'growth-v1',
        tier: 'growth',
        periodId: '2026-07',
        periodStartsAt: '2026-07-01T00:00:00.000Z',
        periodEndsAt: '2026-08-01T00:00:00.000Z',
        allowance: { audio: 0, copy: 3, image: 2, video: 1 },
        concurrencyLimit: 2,
        queuePriority: 20,
        supportLabel: 'standard',
      },
    },
    'activate-plan',
  );
  const byok = new RecordedByokExecutionAdapter();
  const service = new IntegrationApplicationService({
    repository: new MemoryIntegrationRepository(),
    secrets: new FakeKmsSecretStore(),
    byok,
    byokLedger: new FoundationStrictByokLedger(foundation),
    endpointProfiles: [
      {
        id: 'openai-controlled',
        apiFamily: 'openai',
        endpoint: 'https://api.openai.com/v1',
        permittedModels: ['copy-quality'],
        region: 'global',
      },
    ],
  });
  await service.createConnection(
    owner,
    {
      id: 'byok-a',
      provider: 'model',
      identityMode: 'byok',
      requestedCapabilities: ['model.invoke'],
      grantedCapabilities: ['model.invoke'],
      credential: {
        value: 'sk-workspace-secret',
        scope: ['model.invoke'],
        status: 'unverified',
      },
    },
    'create-byok',
  );
  return { byok, foundation, foundationRepository, service };
}

describe('FoundationStrictByokLedger', () => {
  it('seeds the same explicit Product policy when a new workspace starts with strict BYOK', async () => {
    const foundationRepository = new MemoryFoundationRepository();
    foundationRepository.grantOwner(owner.workspaceId, owner.userId);
    const foundation = new P1ApplicationService(foundationRepository);
    const entitlementPolicy = {
      async resolve() {
        return {
          revision: 'growth-product-state-v1',
          tier: 'growth' as const,
          allowance: { audio: 0, copy: 3, image: 2, video: 1 },
          concurrencyLimit: 2,
          queuePriority: 20,
          supportLabel: 'standard' as const,
          addOns: [],
          autoTopUp: {
            enabled: false,
            monthlyCapMicros: 0,
            spentThisMonthMicros: 0,
          },
        };
      },
    };
    const service = new IntegrationApplicationService({
      repository: new MemoryIntegrationRepository(),
      secrets: new FakeKmsSecretStore(),
      byok: new RecordedByokExecutionAdapter(),
      byokLedger: new FoundationStrictByokLedger(
        foundation,
        entitlementPolicy,
      ),
      endpointProfiles: [
        {
          id: 'openai-controlled',
          apiFamily: 'openai',
          endpoint: 'https://api.openai.com/v1',
          permittedModels: ['copy-quality'],
          region: 'global',
        },
      ],
    });
    await service.createConnection(
      owner,
      {
        id: 'byok-first-action',
        provider: 'model',
        identityMode: 'byok',
        requestedCapabilities: ['model.invoke'],
        grantedCapabilities: ['model.invoke'],
        credential: {
          value: 'test-workspace-first-action-secret',
          scope: ['model.invoke'],
          status: 'unverified',
        },
      },
      'create-first-action-byok',
    );

    assert.equal((await service.getStrictByokOptions(owner)).usage.available, 3);
    const result = await service.submitStrictByok(owner, {
      connectionId: 'byok-first-action',
      endpointProfileId: 'openai-controlled',
      catalogModelId: 'copy-quality',
      prompt: '首次动作直接走 BYOK',
      idempotencyKey: 'byok-first-action',
    });

    assert.equal(result.status, 'completed');
    assert.deepEqual(await foundation.getUsageProjection(owner, 'copy'), {
      allowance: 3,
      reserved: 0,
      committed: 1,
      released: 0,
      available: 2,
    });
    assert.equal(
      (
        await foundationRepository.listProductEntitlementEvents(
          owner.workspaceId,
        )
      ).length,
      0,
    );
  });

  it('settles strict BYOK against the one Product Usage ledger and records externally billed cost without a fake zero', async () => {
    const { byok, foundation, foundationRepository, service } = await fixture();
    const options = await service.getStrictByokOptions(owner);
    assert.deepEqual(options.profiles, [
      {
        apiFamily: 'openai',
        id: 'openai-controlled',
        permittedModels: ['copy-quality'],
      },
    ]);
    assert.equal(options.usage.available, 3);
    assert.match(options.billingNotice, /供应商/);

    const completed = await service.submitStrictByok(owner, {
      connectionId: 'byok-a',
      endpointProfileId: 'openai-controlled',
      catalogModelId: 'copy-quality',
      prompt: '生成门店文案',
      idempotencyKey: 'byok-submit-1',
    });
    const replayed = await service.submitStrictByok(owner, {
      connectionId: 'byok-a',
      endpointProfileId: 'openai-controlled',
      catalogModelId: 'copy-quality',
      prompt: '生成门店文案',
      idempotencyKey: 'byok-submit-1',
    });

    assert.deepEqual(replayed, completed);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.usage.status, 'committed');
    assert.equal(completed.usage.available, 2);
    assert.equal(completed.providerCost.status, 'externally_billed');
    assert.equal(byok.attempts().length, 1);
    assert.deepEqual(await foundation.getUsageProjection(owner, 'copy'), {
      allowance: 3,
      available: 2,
      committed: 1,
      released: 0,
      reserved: 0,
    });
    const attemptId = `${completed.routeSnapshot.id}:attempt`;
    const costs = await foundationRepository.listProviderCosts(
      owner.workspaceId,
      attemptId,
    );
    assert.equal(costs.length, 1);
    assert.equal(costs[0]?.billingStatus, 'externally_billed');
    assert.equal(costs[0]?.amountMicros, null);
    assert.equal(costs[0]?.payer, 'workspace_byok');
  });

  it('refunds explicit authorization rejection but keeps an unknown provider failure reserved for reconciliation', async () => {
    const { byok, foundation, service } = await fixture();
    byok.failNext('unauthorized');
    const denied = await service.submitStrictByok(owner, {
      connectionId: 'byok-a',
      endpointProfileId: 'openai-controlled',
      catalogModelId: 'copy-quality',
      prompt: '授权失败',
      idempotencyKey: 'byok-denied',
    });
    assert.equal(denied.status, 'failed');
    assert.equal(denied.usage.status, 'refunded');

    byok.failNext('failed');
    const unknown = await service.submitStrictByok(owner, {
      connectionId: 'byok-a',
      endpointProfileId: 'openai-controlled',
      catalogModelId: 'copy-quality',
      prompt: '响应不明',
      idempotencyKey: 'byok-unknown',
    });
    assert.equal(unknown.status, 'unknown');
    assert.equal(unknown.usage.status, 'reserved');
    assert.equal(unknown.providerCost.status, 'unknown');
    assert.equal((await foundation.getUsageProjection(owner, 'copy')).reserved, 1);
  });
});
