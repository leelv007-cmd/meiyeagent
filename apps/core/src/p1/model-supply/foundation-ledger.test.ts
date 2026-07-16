import assert from 'node:assert/strict';
import test from 'node:test';
import { P1ApplicationService } from '../foundation/application-service.js';
import { MemoryFoundationRepository } from '../foundation/memory-repository.js';
import { FoundationModelSupplyLedger } from './foundation-ledger.js';
import {
  ModelSupplyApplicationService,
  RecordedProviderExecutionPort,
  type CatalogModel,
  type ModelDeployment,
  type ModelSupplyLedgerPort,
  type ProviderExecutionPort,
} from './index.js';

const context = {
  workspaceId: 'workspace-ledger',
  userId: 'owner-ledger',
  correlationId: 'correlation-ledger',
} as const;

const model: CatalogModel = {
  id: 'gpt-image-2',
  modality: 'image',
  operations: ['image.generate'],
  displayName: 'GPT Image 2',
  qualityRank: 100,
};

const deployment: ModelDeployment = {
  id: 'gpt-image-2-managed',
  catalogModelId: model.id,
  apiFamily: 'image',
  channel: 'managed',
  region: 'overseas',
  status: 'active',
  policyRevision: 'policy-image-v3',
  priceRevision: 'price-image-v5',
  credentialMode: 'platform',
  credentialVersion: 'credential-7',
  unitPrice: {
    amountMicros: 120_000,
    currency: 'USD',
    unit: 'image',
  },
};

async function fixture() {
  const repository = new MemoryFoundationRepository();
  repository.grantOwner(context.workspaceId, context.userId);
  const foundation = new P1ApplicationService(repository);
  await foundation.appendUsageEvent(
    context,
    {
      id: 'image-entitlement',
      resource: 'image',
      action: 'adjust',
      amount: 10,
      reason: 'opening entitlement',
    },
    'image-entitlement',
  );
  return {
    repository,
    foundation,
    ledger: new FoundationModelSupplyLedger(foundation),
  };
}

test('checkpoints route, job, reservation and pending attempt before provider execution', async () => {
  const { repository, foundation, ledger } = await fixture();
  let inspected = false;
  const execution: ProviderExecutionPort = {
    async execute(request) {
      const job = await repository.getGenerationJob(context.workspaceId, request.jobId);
      assert.equal(job?.status, 'running');
      const attempts = await repository.listProviderAttempts(
        context.workspaceId,
        request.jobId,
      );
      assert.equal(attempts.length, 1);
      assert.equal(attempts[0]?.acceptance, 'pending');
      assert.equal(attempts[0]?.status, 'pending');
      const usage = await foundation.getUsageProjection(context, 'image');
      assert.deepEqual(usage, {
        allowance: 10,
        reserved: 1,
        committed: 0,
        released: 0,
        available: 9,
      });
      const snapshot = await repository.getRouteSnapshot(
        context.workspaceId,
        job?.routeSnapshotId ?? '',
      );
      assert.equal(snapshot?.policyRevision, 'policy-image-v3');
      assert.equal(snapshot?.priceRevision, 'price-image-v5');
      assert.equal(snapshot?.fallbackConsent, false);
      assert.deepEqual(snapshot?.dataClasses, ['public']);
      assert.deepEqual(snapshot?.allowedCandidates[0], {
        catalogModelId: 'gpt-image-2',
        deploymentId: 'gpt-image-2-managed',
        region: 'global',
        credentialMode: 'platform',
        credentialVersion: 'credential-7',
        policyRevision: 'policy-image-v3',
        priceRevision: 'price-image-v5',
        unitPriceMicros: 120_000,
        currency: 'USD',
        unit: 'image',
        fallbackRank: 1,
      });
      inspected = true;
      return new RecordedProviderExecutionPort().execute(request);
    },
  };
  const application = new ModelSupplyApplicationService({
    models: [model],
    deployments: [deployment],
    execution,
    ledger,
    catalogRevisionId: 'catalog-image-v9',
  });

  const result = await application.submit({
    workspaceId: context.workspaceId,
    actorId: context.userId,
    correlationId: context.correlationId,
    idempotencyKey: 'image-ledger-1',
    operation: 'image.generate',
    selection: { mode: 'fixed', catalogModelId: model.id },
    dataClass: [],
    prompt: '门店环境氛围图',
  });

  assert.equal(inspected, true);
  assert.equal(result.status, 'completed');
  assert.equal(
    (await repository.getGenerationJob(context.workspaceId, result.jobId))
      ?.usageReservationId,
    result.usage.id,
  );
  assert.equal(
    (await repository.getGenerationJob(context.workspaceId, result.jobId))?.status,
    'completed',
  );
  assert.equal(
    (await repository.getGenerationJob(context.workspaceId, result.jobId))?.result?.jobId,
    result.jobId,
  );
  const [attempt] = await repository.listProviderAttempts(
    context.workspaceId,
    result.jobId,
  );
  assert.equal(attempt?.acceptance, 'accepted');
  assert.equal(attempt?.status, 'completed');
  assert.equal(
    (await repository.listProviderCosts(context.workspaceId, attempt?.id ?? '')).length,
    1,
  );
  assert.equal(
    (await repository.getOwnedAsset(context.workspaceId, result.asset?.id ?? ''))?.sha256,
    result.asset?.sha256,
  );
  assert.deepEqual(await foundation.getUsageProjection(context, 'image'), {
    allowance: 10,
    reserved: 0,
    committed: 1,
    released: 0,
    available: 9,
  });
});

test('atomically seeds an explicit plan allowance on first reserve without defaulting to unlimited usage', async () => {
  const repository = new MemoryFoundationRepository();
  repository.grantOwner(context.workspaceId, context.userId);
  const foundation = new P1ApplicationService(repository);
  let policyReads = 0;
  const ledger = new FoundationModelSupplyLedger(foundation, {
    async resolve() {
      policyReads += 1;
      if (policyReads > 1) throw new Error('plan service unavailable on replay');
      return {
        revision: 'growth-2026-07',
        tier: 'growth',
        allowance: { audio: 0, copy: 4, image: 2, video: 1 },
        concurrencyLimit: 1,
        queuePriority: 10,
        supportLabel: 'standard',
        addOns: [
          { purchaseId: 'addon-image-1', resource: 'image', quantity: 1 },
          { purchaseId: 'addon-image-1', resource: 'image', quantity: 1 },
        ],
        autoTopUp: {
          enabled: true,
          monthlyCapMicros: 5_000_000,
          spentThisMonthMicros: 0,
        },
      };
    },
  });
  const application = new ModelSupplyApplicationService({
    models: [model],
    deployments: [deployment],
    execution: new RecordedProviderExecutionPort(),
    ledger,
  });
  const submission = {
    workspaceId: context.workspaceId,
    actorId: context.userId,
    idempotencyKey: 'plan-seed-1',
    operation: 'image.generate' as const,
    selection: { mode: 'fixed' as const, catalogModelId: model.id },
    dataClass: [],
    prompt: '显式套餐首次开账',
  };

  await application.submit(submission);
  assert.deepEqual(await foundation.getUsageProjection(context, 'image'), {
    allowance: 3,
    reserved: 0,
    committed: 1,
    released: 0,
    available: 2,
  });
  const restarted = new ModelSupplyApplicationService({
    models: [model],
    deployments: [deployment],
    execution: new RecordedProviderExecutionPort(),
    ledger,
  });
  await restarted.submit(submission);
  assert.deepEqual(await foundation.getUsageProjection(context, 'image'), {
    allowance: 3,
    reserved: 0,
    committed: 1,
    released: 0,
    available: 2,
  });
  assert.equal(policyReads, 1);
});

test('keeps one reservation and one frozen candidate set across a safe pre-accept fallback', async () => {
  const repository = new MemoryFoundationRepository();
  repository.grantOwner(context.workspaceId, context.userId);
  const foundation = new P1ApplicationService(repository);
  await foundation.appendUsageEvent(
    context,
    {
      id: 'copy-entitlement',
      resource: 'copy',
      action: 'adjust',
      amount: 3,
      reason: 'copy plan',
    },
    'copy-entitlement',
  );
  const copyModels: CatalogModel[] = [
    {
      id: 'copy-quality',
      modality: 'llm',
      operations: ['copy.generate'],
      displayName: 'Copy quality',
      qualityRank: 100,
    },
    {
      id: 'copy-backup',
      modality: 'llm',
      operations: ['copy.generate'],
      displayName: 'Copy backup',
      qualityRank: 90,
    },
  ];
  const copyDeployments: ModelDeployment[] = copyModels.map((candidate) => ({
    id: `${candidate.id}-direct`,
    catalogModelId: candidate.id,
    apiFamily: 'openai',
    channel: 'direct',
    region: 'domestic',
    status: 'active',
  }));
  const execution = new RecordedProviderExecutionPort();
  execution.failNext('copy-quality', 'rejected_before_accept');
  const application = new ModelSupplyApplicationService({
    models: copyModels,
    deployments: copyDeployments,
    execution,
    ledger: new FoundationModelSupplyLedger(foundation),
  });

  const result = await application.submit({
    workspaceId: context.workspaceId,
    actorId: context.userId,
    idempotencyKey: 'copy-fallback-ledger',
    operation: 'copy.generate',
    selection: { mode: 'auto', profile: 'quality' },
    dataClass: [],
    prompt: '安全回退',
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.attempts.length, 2);
  const attempts = await repository.listProviderAttempts(
    context.workspaceId,
    result.jobId,
  );
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0]?.acceptance, 'rejected_before_accept');
  assert.equal(attempts[1]?.acceptance, 'accepted');
  assert.deepEqual(await foundation.getUsageProjection(context, 'copy'), {
    allowance: 3,
    reserved: 0,
    committed: 1,
    released: 0,
    available: 2,
  });
  assert.equal(
    (
      await Promise.all(
        attempts.map((attempt) =>
          repository.listProviderCosts(context.workspaceId, attempt.id),
        ),
      )
    ).flat().length,
    2,
  );
});

test('does not repeat the provider side effect after a crash between execution and settlement', async () => {
  const { repository, foundation, ledger } = await fixture();
  let executions = 0;
  const execution: ProviderExecutionPort = {
    async execute(request) {
      executions += 1;
      return new RecordedProviderExecutionPort().execute(request);
    },
  };
  let failSettlement = true;
  const crashingLedger: ModelSupplyLedgerPort = {
    checkpointAttempt: (input) => ledger.checkpointAttempt(input),
    async settleAttempt(input) {
      if (failSettlement) {
        failSettlement = false;
        throw new Error('simulated process loss after provider effect');
      }
      return ledger.settleAttempt(input);
    },
  };
  const submission = {
    workspaceId: context.workspaceId,
    actorId: context.userId,
    correlationId: context.correlationId,
    idempotencyKey: 'crash-window-1',
    operation: 'image.generate' as const,
    selection: { mode: 'fixed' as const, catalogModelId: model.id },
    dataClass: [],
    prompt: '不可重复生成',
  };
  const crashed = new ModelSupplyApplicationService({
    models: [model],
    deployments: [deployment],
    execution,
    ledger: crashingLedger,
  });
  await assert.rejects(crashed.submit(submission), /simulated process loss/);
  assert.equal(executions, 1);

  const restarted = new ModelSupplyApplicationService({
    models: [model],
    deployments: [deployment],
    execution,
    ledger,
  });
  const recovered = await restarted.submit(submission);

  assert.equal(executions, 1);
  assert.equal(recovered.status, 'unknown');
  assert.equal(recovered.attempt.acceptance, 'acceptance_unknown');
  const persisted = await repository.getGenerationJob(
    context.workspaceId,
    recovered.jobId,
  );
  assert.equal(persisted?.status, 'unknown');
  assert.equal(persisted?.result?.status, 'unknown');
  assert.deepEqual(await foundation.getUsageProjection(context, 'image'), {
    allowance: 10,
    reserved: 1,
    committed: 0,
    released: 0,
    available: 9,
  });
});

test('reconciles acceptance-unknown to late success without deleting estimated cost or the reservation history', async () => {
  const { repository, foundation, ledger } = await fixture();
  const execution = new RecordedProviderExecutionPort();
  execution.failNext(model.id, 'acceptance_unknown');
  const application = new ModelSupplyApplicationService({
    models: [model],
    deployments: [deployment],
    execution,
    ledger,
  });
  const submission = {
    workspaceId: context.workspaceId,
    actorId: context.userId,
    idempotencyKey: 'late-success-1',
    operation: 'image.generate' as const,
    selection: { mode: 'fixed' as const, catalogModelId: model.id },
    dataClass: [],
    prompt: '稍后成功',
  };
  const unknown = await application.submit(submission);
  assert.equal(unknown.status, 'unknown');
  const observedCost = {
    id: 'late-success-observed-cost',
    status: 'observed' as const,
    amount: 0.12,
    currency: 'USD' as const,
    usage: { mediaUnits: 1 },
  };
  const completed = {
    ...unknown,
    status: 'completed' as const,
    attempt: {
      ...unknown.attempt,
      acceptance: 'accepted' as const,
      providerTaskRef: 'late-provider-task-1',
      status: 'completed' as const,
    },
    attempts: [
      {
        ...unknown.attempt,
        acceptance: 'accepted' as const,
        providerTaskRef: 'late-provider-task-1',
        status: 'completed' as const,
      },
    ],
    asset: {
      id: 'late-asset-1',
      objectKey: `${context.workspaceId}/generated/late-asset-1.png`,
      sha256: 'b'.repeat(64),
      sizeBytes: 4096,
      contentType: 'image/png' as const,
      sourceTaskRef: 'late-provider-task-1',
    },
    usage: { ...unknown.usage, status: 'committed' as const },
    providerCost: observedCost,
    providerCosts: [...unknown.providerCosts, observedCost],
  };

  await application.reconcileProviderResult(submission, completed);

  assert.equal(
    (await repository.getGenerationJob(context.workspaceId, unknown.jobId))?.status,
    'completed',
  );
  assert.equal(
    (
      await repository.getProviderAttempt(
        context.workspaceId,
        unknown.attempt.id,
      )
    )?.acceptance,
    'accepted',
  );
  assert.equal(
    (
      await repository.listProviderCosts(
        context.workspaceId,
        unknown.attempt.id,
      )
    ).length,
    2,
  );
  assert.deepEqual(await foundation.getUsageProjection(context, 'image'), {
    allowance: 10,
    reserved: 0,
    committed: 1,
    released: 0,
    available: 9,
  });
});

test('recovers the authoritative result without regeneration when the read-model sink failed', async () => {
  const { ledger } = await fixture();
  let executions = 0;
  let sinkWrites = 0;
  const execution: ProviderExecutionPort = {
    async execute(request) {
      executions += 1;
      return new RecordedProviderExecutionPort().execute(request);
    },
  };
  const submission = {
    workspaceId: context.workspaceId,
    actorId: context.userId,
    correlationId: context.correlationId,
    idempotencyKey: 'projection-crash-1',
    operation: 'image.generate' as const,
    selection: { mode: 'fixed' as const, catalogModelId: model.id },
    dataClass: [],
    prompt: '读模型失败仍可恢复',
  };
  const crashed = new ModelSupplyApplicationService({
    models: [model],
    deployments: [deployment],
    execution,
    ledger,
    resultSink: {
      async saveResult() {
        sinkWrites += 1;
        throw new Error('projection unavailable');
      },
    },
  });
  await assert.rejects(crashed.submit(submission), /projection unavailable/);

  const restarted = new ModelSupplyApplicationService({
    models: [model],
    deployments: [deployment],
    execution,
    ledger,
    resultSink: {
      async saveResult() {
        sinkWrites += 1;
      },
    },
  });
  const recovered = await restarted.submit(submission);

  assert.equal(recovered.status, 'completed');
  assert.equal(recovered.asset?.sha256.length, 64);
  assert.equal(executions, 1);
  assert.equal(sinkWrites, 2);
});

test('records a zero-product-usage generation without skipping provider or Foundation evidence', async () => {
  const repository = new MemoryFoundationRepository();
  repository.grantOwner(context.workspaceId, context.userId);
  const foundation = new P1ApplicationService(repository);
  const ledger = new FoundationModelSupplyLedger(foundation);
  const application = new ModelSupplyApplicationService({
    models: [model],
    deployments: [deployment],
    execution: new RecordedProviderExecutionPort(),
    ledger,
  });

  const result = await application.submit({
    workspaceId: context.workspaceId,
    actorId: context.userId,
    correlationId: context.correlationId,
    idempotencyKey: 'quality-retry-zero-usage',
    operation: 'image.generate',
    productUsageQuantity: 0,
    selection: { mode: 'fixed', catalogModelId: model.id },
    dataClass: [],
    prompt: '质量重试仍需要完整成本证据',
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.usage.quantity, 0);
  assert.deepEqual(await foundation.getUsageProjection(context, 'image'), {
    allowance: 0,
    reserved: 0,
    committed: 0,
    released: 0,
    available: 0,
  });
  const events = await repository.listUsageEvents(
    context.workspaceId,
    'image',
  );
  assert.deepEqual(
    events
      .filter((event) => event.reservationId === result.usage.id)
      .map((event) => [event.action, event.amount]),
    [
      ['reserve', 0],
      ['commit', 0],
    ],
  );
  const attempts = await repository.listProviderAttempts(
    context.workspaceId,
    result.jobId,
  );
  assert.equal(attempts.length, 1);
  assert.equal(
    (await repository.listProviderCosts(context.workspaceId, attempts[0]!.id))
      .length,
    1,
  );
  assert.equal(
    (await repository.getGenerationJob(context.workspaceId, result.jobId))
      ?.status,
    'completed',
  );
});
