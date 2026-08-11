import assert from 'node:assert/strict';
import test from 'node:test';
import { P1ApplicationService } from '../../../foundation/application-service.js';
import { MemoryFoundationRepository } from '../../../foundation/memory-repository.js';
import type { SupplyRequestFreeze } from '../../../entitlement-pools/supply-ledger-fields.js';
import { FoundationModelSupplyLedger } from '../../foundation-ledger.js';
import {
  ModelSupplyApplicationService,
  RecordedProviderExecutionPort,
  type Acceptance,
  type CatalogModel,
  type ModelDeployment,
} from '../../index.js';
import { pinnedPromptResolver } from '../../prompt-pin.testing.js';

const workspaceId = 'provider-conformance-workspace';
const actorId = 'provider-conformance-owner';

const model: CatalogModel = {
  id: 'copy-provider-conformance',
  modality: 'llm',
  operations: ['copy.generate'],
  displayName: 'Copy provider conformance',
  qualityRank: 100,
};

const deployments: ModelDeployment[] = ['primary', 'fallback'].map(
  (channel, index) => ({
    id: `copy-provider-conformance-${channel}`,
    catalogModelId: model.id,
    executionChannelId: `channel-${channel}`,
    providerProfileId: `provider-${channel}`,
    accountIdentity: `account-${channel}`,
    endpointFingerprint: `endpoint-${channel}`,
    apiFamily: 'openai',
    channel: 'direct',
    region: 'domestic',
    status: 'active',
    priceRevision: `price-${channel}`,
    unitPrice: {
      amountMicros: index + 1,
      currency: 'CNY',
      unit: 'request',
    },
  }),
);

async function createFixture(failure: Acceptance) {
  const repository = new MemoryFoundationRepository();
  repository.grantOwner(workspaceId, actorId);
  const foundation = new P1ApplicationService(repository);
  await foundation.appendUsageEvent(
    {
      workspaceId,
      userId: actorId,
      correlationId: `provider-conformance-${failure}`,
    },
    {
      id: `copy-entitlement-${failure}`,
      resource: 'copy',
      action: 'adjust',
      amount: 3,
      reason: 'provider conformance',
    },
    `copy-entitlement-${failure}`,
  );

  const freezes: SupplyRequestFreeze[] = [];
  const execution = new RecordedProviderExecutionPort();
  execution.failNext(model.id, failure);
  let executions = 0;
  const application = new ModelSupplyApplicationService({
    promptResolver: pinnedPromptResolver,
    models: [model],
    deployments,
    execution: {
      async execute(request) {
        executions += 1;
        return execution.execute(request);
      },
    },
    ledger: new FoundationModelSupplyLedger(
      foundation,
      undefined,
      undefined,
      {
        supplyFreezes: {
          async append(freeze) {
            const existing = freezes.find((candidate) => candidate.id === freeze.id);
            if (existing) return structuredClone(existing);
            freezes.push(structuredClone(freeze));
            return structuredClone(freeze);
          },
          async get(freezeId) {
            return structuredClone(
              freezes.find((candidate) => candidate.id === freezeId) ?? null,
            );
          },
          async getByProductUsageTask(freezeWorkspaceId, productUsageTaskId) {
            return structuredClone(
              freezes.find(
                (candidate) =>
                  candidate.workspaceId === freezeWorkspaceId &&
                  candidate.productUsageTaskId === productUsageTaskId,
              ) ?? null,
            );
          },
        },
      },
    ),
  });

  return {
    application,
    executions: () => executions,
    freezes,
    repository,
  };
}

for (const scenario of [
  {
    failure: 'rejected_before_accept' as const,
    expectedExecutions: 2,
    expectedStatus: 'completed' as const,
  },
  {
    failure: 'acceptance_unknown' as const,
    expectedExecutions: 1,
    expectedStatus: 'unknown' as const,
  },
]) {
  test(`production supply path handles ${scenario.failure} without duplicate effects`, async () => {
    const fixture = await createFixture(scenario.failure);
    const submission = {
      workspaceId,
      actorId,
      idempotencyKey: `provider-conformance-${scenario.failure}`,
      operation: 'copy.generate' as const,
      selection: { mode: 'auto' as const, profile: 'quality' as const },
      dataClass: [],
      prompt: `Exercise ${scenario.failure}`,
    };

    const result = await fixture.application.submit(submission);
    const replay = await fixture.application.submit(submission);

    assert.equal(result.status, scenario.expectedStatus);
    assert.equal(replay.jobId, result.jobId);
    assert.equal(fixture.executions(), scenario.expectedExecutions);

    const attempts = await fixture.repository.listProviderAttempts(
      workspaceId,
      result.jobId,
    );
    assert.equal(attempts.length, scenario.expectedExecutions);
    assert.equal(attempts[0]?.acceptance, scenario.failure);
    assert.equal(
      attempts[1]?.acceptance,
      scenario.failure === 'rejected_before_accept' ? 'accepted' : undefined,
    );
    assert.deepEqual(
      fixture.freezes.map((freeze) => ({
        executionChannelId: freeze.supplierPriceRevision.executionChannelId,
        priceRevisionId: freeze.supplierPriceRevision.id,
      })),
      deployments.slice(0, scenario.expectedExecutions).map((deployment) => ({
        executionChannelId: deployment.executionChannelId,
        priceRevisionId: deployment.priceRevision,
      })),
    );

    if (result.status === 'completed') {
      assert.equal(result.attempts.length, 2);
      assert.equal(result.providerCosts[1]?.failover?.kind, 'same_model_channel');
      assert.equal(
        result.failoverAvailabilityEvents?.[0]?.eventType,
        'provider_failover',
      );
    } else {
      assert.equal(result.attempt.acceptance, 'acceptance_unknown');
    }
  });
}
