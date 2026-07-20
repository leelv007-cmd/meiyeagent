import assert from 'node:assert/strict';
import test from 'node:test';
import { P1ApplicationService } from '../foundation/application-service.js';
import {
  CompositeProductEntitlementPolicy,
  P1DomainError,
  ProductEntitlementApplicationService,
  ProductEntitlementFoundationModule,
  WorkspaceProvisionService,
  MemoryGrantLotLedger,
} from '../foundation/index.js';
import { MemoryFoundationRepository } from '../foundation/memory-repository.js';
import {
  MemoryProductUsageLedger,
  ProductBillingLifecycle,
  ProductQuoteService,
  type BillingLifecyclePort,
} from '../product-billing/index.js';
import type { SupplyRequestFreeze } from '../entitlement-pools/supply-ledger-fields.js';
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

test('uses the Operations billing task as the single ProductUsage and ProviderCost lifecycle', async () => {
  const repository = new MemoryFoundationRepository();
  repository.grantOwner(context.workspaceId, context.userId);
  const foundation = new P1ApplicationService(repository);
  await foundation.appendUsageEvent(
    context,
    {
      action: 'adjust',
      amount: 10,
      id: 'single-ledger-image-entitlement',
      reason: 'opening entitlement',
      resource: 'image',
    },
    'single-ledger-image-entitlement',
  );
  const productUsage = new MemoryProductUsageLedger();
  const quotes = new ProductQuoteService({ usageLedger: productUsage });
  const quote = quotes.buildQuote({
    billingMode: 'per_request',
    catalogModelId: model.id,
    frozenCandidateDeploymentIds: [deployment.id],
    quoteId: 'operations-quote-1',
    quotePolicyRevision: 'product-policy-1',
    unitRate: 1,
    workspaceId: context.workspaceId,
  });
  quotes.confirm({ quoteId: quote.quoteId, taskId: 'creative-work-1' });
  const canonicalBilling = new ProductBillingLifecycle(quotes);
  canonicalBilling.beforeSubmit({
    quoteRevision: quote.revision,
    resource: 'image',
    taskId: 'creative-work-1',
    workspaceId: context.workspaceId,
  });
  let settleAttempts = 0;
  const billingLifecycle: BillingLifecyclePort = {
    beforeSubmit: (input) => canonicalBilling.beforeSubmit(input),
    dispatchAttempt: (input) => canonicalBilling.dispatchAttempt(input),
    settleTask(input) {
      settleAttempts += 1;
      if (settleAttempts === 1) throw new Error('billing settle response lost');
      return canonicalBilling.settleTask(input);
    },
  };
  const ledger = new FoundationModelSupplyLedger(
    foundation,
    undefined,
    undefined,
    { billingLifecycle, productUsage },
  );
  const application = new ModelSupplyApplicationService({
    deployments: [deployment],
    execution: new RecordedProviderExecutionPort(),
    ledger,
    models: [model],
  });
  const submission = {
    actorId: context.userId,
    billingQuoteRevision: quote.revision,
    billingTaskId: 'creative-work-1',
    dataClass: [],
    idempotencyKey: 'single-product-ledger-submit',
    operation: 'image.generate' as const,
    prompt: '单一账本生成',
    selection: { catalogModelId: model.id, mode: 'fixed' as const },
    workspaceId: context.workspaceId,
  };

  await assert.rejects(
    application.submit(submission),
    /billing settle response lost/,
  );
  const replay = await application.submit(submission);

  assert.equal(productUsage.listByWorkspace(context.workspaceId).length, 1);
  assert.equal(productUsage.getByTask('creative-work-1')?.status, 'committed');
  assert.equal(quotes.getQuoteByTask('creative-work-1')?.lifecycleStatus, 'settled');
  assert.deepEqual(
    quotes.listProviderCosts('creative-work-1').map((cost) => cost.attemptId),
    [replay.attempt.id],
  );
  assert.equal(settleAttempts, 2);
  assert.equal(
    ledger.getSupplyFreeze('creative-work-1')?.productUsageTaskId,
    'creative-work-1',
  );
});

test('rejects a permanently invalid route before consuming a grant lot', async () => {
  const repository = new MemoryFoundationRepository();
  repository.grantOwner(context.workspaceId, context.userId);
  const grantLots = new MemoryGrantLotLedger();
  grantLots.grant({
    id: 'invalid-route-image-grant',
    workspaceId: context.workspaceId,
    resource: 'image',
    amount: 1,
    expirationDate: null,
    transactionType: 'PURCHASE_PACKAGE',
    createdAt: '2026-07-19T00:00:00.000Z',
  });
  let providerExecutions = 0;
  const application = new ModelSupplyApplicationService({
    models: [model],
    deployments: [deployment],
    execution: {
      async execute(request) {
        providerExecutions += 1;
        return new RecordedProviderExecutionPort().execute(request);
      },
    },
    ledger: new FoundationModelSupplyLedger(
      new P1ApplicationService(repository),
      undefined,
      grantLots,
    ),
  });

  await assert.rejects(
    application.submit({
      workspaceId: context.workspaceId,
      actorId: context.userId,
      idempotencyKey: 'invalid-sensitive-overseas-route',
      operation: 'image.generate',
      selection: { mode: 'fixed', catalogModelId: model.id },
      dataClass: ['pii'],
      prompt: 'Must not charge an invalid route',
    }),
    /requested data class is not allowed/,
  );
  assert.equal(providerExecutions, 0);
  assert.equal(grantLots.listLots(context.workspaceId, 'image')[0]?.remainingAmount, 1);
  assert.equal(
    grantLots
      .listTransactions(context.workspaceId)
      .some((transaction) => transaction.transactionType === 'USAGE'),
    false,
  );
});

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

test('persists one immutable supply freeze before provider I/O and links settlement cost', async () => {
  const { repository, foundation } = await fixture();
  const freezes = new Map<string, SupplyRequestFreeze>();
  const supplyFreezes = {
    async append(freeze: SupplyRequestFreeze) {
      const existing = freezes.get(freeze.id);
      if (existing) {
        assert.deepEqual(freeze, existing);
        return structuredClone(existing);
      }
      freezes.set(freeze.id, structuredClone(freeze));
      return structuredClone(freeze);
    },
    async get(freezeId: string) {
      const freeze = freezes.get(freezeId);
      return freeze ? structuredClone(freeze) : null;
    },
  };
  let freezeObservedBeforeProvider = false;
  const ledger = new FoundationModelSupplyLedger(
    foundation,
    undefined,
    undefined,
    {
      defaultSupplyPoolId: 'pool-shared',
      supplyFreezes,
    },
  );
  const application = new ModelSupplyApplicationService({
    models: [model],
    deployments: [deployment],
    ledger,
    execution: {
      async execute(request) {
        const [freeze] = [...freezes.values()];
        freezeObservedBeforeProvider =
          freeze?.workspaceId === request.submission.workspaceId &&
          freeze.providerCostAttemptId?.startsWith('model-attempt-') === true &&
          freeze.productUsageTaskId === request.jobId;
        return new RecordedProviderExecutionPort().execute(request);
      },
    },
  });

  const result = await application.submit({
    workspaceId: context.workspaceId,
    actorId: context.userId,
    correlationId: context.correlationId,
    idempotencyKey: 'durable-supply-freeze',
    operation: 'image.generate',
    selection: { mode: 'fixed', catalogModelId: model.id },
    dataClass: [],
    prompt: '持久供应冻结',
  });

  assert.equal(freezeObservedBeforeProvider, true);
  assert.equal(freezes.size, 1);
  const [freeze] = [...freezes.values()];
  assert.ok(freeze);
  assert.equal(freeze.routeSnapshotRef, result.snapshot.id);
  assert.equal(freeze.providerCostAttemptId, result.attempt.id);
  assert.equal(freeze.supplyPoolId, 'pool-shared');
  const providerCosts = await repository.listProviderCosts(
    context.workspaceId,
    result.attempt.id,
  );
  assert.match(providerCosts[0]?.evidence ?? '', /supplyPoolId=pool-shared/);
  assert.match(
    providerCosts[0]?.evidence ?? '',
    new RegExp(`routeSnapshotRef=${result.snapshot.id}`),
  );
});

test('records unknown pricing explicitly instead of fabricating a zero estimate', async () => {
  const { ledger } = await fixture();
  const application = new ModelSupplyApplicationService({
    models: [model],
    deployments: [
      {
        ...deployment,
        priceRevision: undefined,
        unitPrice: undefined,
      },
    ],
    execution: new RecordedProviderExecutionPort(),
    ledger,
  });

  const result = await application.submit({
    workspaceId: context.workspaceId,
    actorId: context.userId,
    idempotencyKey: 'unknown-price-is-not-zero',
    operation: 'image.generate',
    selection: { mode: 'fixed', catalogModelId: model.id },
    dataClass: [],
    prompt: 'Unknown supplier price',
  });

  const candidate = result.snapshot.allowedCandidates?.[0];
  assert.equal(candidate?.pricingStatus, 'unknown');
  assert.equal(candidate?.priceRevision, 'recorded-price-v1');
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

test('lets a newly provisioned trial workspace generate through the production composite policy seam', async () => {
  const repository = new MemoryFoundationRepository();
  repository.grantOwner(context.workspaceId, context.userId);
  let now = new Date('2026-07-19T08:00:00.000Z');
  const clock = () => now;
  const entitlements = new ProductEntitlementApplicationService(
    repository,
    undefined,
    clock,
  );
  await new WorkspaceProvisionService(entitlements, { clock }).provisionTrial(
    context,
  );
  const productBootstrap = {
    async resolve() {
      return {
        addOns: [],
        allowance: { audio: 0, copy: 0, image: 0, video: 0 },
        autoTopUp: {
          enabled: false,
          monthlyCapMicros: 0,
          spentThisMonthMicros: 0,
        },
        concurrencyLimit: 1,
        queuePriority: 1,
        revision: 'product-entitlement:starter:bootstrap',
        supportLabel: 'standard' as const,
        tier: 'starter' as const,
      };
    },
  };
  const ledger = new FoundationModelSupplyLedger(
    new P1ApplicationService(repository),
    new CompositeProductEntitlementPolicy(productBootstrap, entitlements),
  );
  const application = new ModelSupplyApplicationService({
    models: [model],
    deployments: [deployment],
    execution: new RecordedProviderExecutionPort(),
    ledger,
  });

  const result = await application.submit({
    workspaceId: context.workspaceId,
    actorId: context.userId,
    idempotencyKey: 'trial-first-generation',
    operation: 'image.generate',
    selection: { mode: 'fixed', catalogModelId: model.id },
    dataClass: [],
    prompt: '新建工作区首次生成',
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(
    await new P1ApplicationService(repository).getUsageProjection(
      context,
      'image',
    ),
    {
      allowance: 5,
      reserved: 0,
      committed: 1,
      released: 0,
      available: 4,
    },
  );

  now = new Date('2026-07-27T08:00:00.000Z');
  await assert.rejects(
    application.submit({
      workspaceId: context.workspaceId,
      actorId: context.userId,
      idempotencyKey: 'trial-generation-after-expiry',
      operation: 'image.generate',
      selection: { mode: 'fixed', catalogModelId: model.id },
      dataClass: [],
      prompt: '试用到期后不应生成',
    }),
    (error: unknown) =>
      error instanceof P1DomainError &&
      error.code === 'INSUFFICIENT_ENTITLEMENT',
  );
  assert.equal(
    (
      await repository.listProductEntitlementEvents(context.workspaceId)
    ).filter((event) => event.kind === 'plan_expired').length,
    1,
  );
  assert.deepEqual(
    await new P1ApplicationService(repository).getUsageProjection(
      context,
      'image',
    ),
    {
      allowance: 0,
      available: 0,
      committed: 1,
      released: 0,
      reserved: 0,
    },
  );
});

test('lets a trusted payment grant generate when recorded owner checkout is disabled', async () => {
  const repository = new MemoryFoundationRepository();
  repository.grantOwner(context.workspaceId, context.userId);
  const entitlements = new ProductEntitlementApplicationService(repository);
  const foundation = new P1ApplicationService(repository, {
    operations: [
      new ProductEntitlementFoundationModule(entitlements, undefined, {
        recordedCommerceEnabled: false,
      }),
    ],
  });
  await foundation.executeModule(
    {
      actor: 'payment',
      correlationId: 'stripe:evt_paid_execution',
      userId: 'payment-service',
      workspaceId: context.workspaceId,
    },
    'entitlements',
    {
      action: 'payment_grant',
      payload: {
        interval: 'month',
        lifecycle: 'activate',
        paymentEventId: 'stripe:evt_paid_execution',
        paymentProductId: 'price_growth_month',
        periodEndsAt: '2026-08-15T00:00:00.000Z',
        periodStartsAt: '2026-07-15T00:00:00.000Z',
      },
    },
    'stripe:evt_paid_execution'
  );
  const productBootstrap = {
    async resolve() {
      return {
        addOns: [],
        allowance: { audio: 0, copy: 0, image: 0, video: 0 },
        autoTopUp: {
          enabled: false,
          monthlyCapMicros: 0,
          spentThisMonthMicros: 0,
        },
        concurrencyLimit: 1,
        queuePriority: 1,
        revision: 'product-entitlement:starter:bootstrap',
        supportLabel: 'standard' as const,
        tier: 'starter' as const,
      };
    },
  };
  const application = new ModelSupplyApplicationService({
    deployments: [deployment],
    execution: new RecordedProviderExecutionPort(),
    ledger: new FoundationModelSupplyLedger(
      foundation,
      new CompositeProductEntitlementPolicy(productBootstrap, entitlements, {
        allowFoundationPlan: true,
      })
    ),
    models: [model],
  });

  const result = await application.submit({
    actorId: context.userId,
    dataClass: [],
    idempotencyKey: 'paid-first-generation',
    operation: 'image.generate',
    prompt: '付费工作区首次生成',
    selection: { catalogModelId: model.id, mode: 'fixed' },
    workspaceId: context.workspaceId,
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(await foundation.getUsageProjection(context, 'image'), {
    allowance: 40,
    available: 39,
    committed: 1,
    released: 0,
    reserved: 0,
  });
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

test('refunds the Foundation copy reservation after acceptance-unknown partial delivery', async () => {
  const repository = new MemoryFoundationRepository();
  repository.grantOwner(context.workspaceId, context.userId);
  const foundation = new P1ApplicationService(repository);
  await foundation.appendUsageEvent(
    context,
    {
      id: 'copy-unknown-entitlement',
      resource: 'copy',
      action: 'adjust',
      amount: 2,
      reason: 'copy plan',
    },
    'copy-unknown-entitlement',
  );
  const grantLots = new MemoryGrantLotLedger();
  grantLots.grant({
    id: 'copy-unknown-package',
    workspaceId: context.workspaceId,
    resource: 'copy',
    amount: 2,
    expirationDate: null,
    transactionType: 'PURCHASE_PACKAGE',
    createdAt: '2026-07-19T00:00:00.000Z',
  });
  const copyModel: CatalogModel = {
    id: 'copy-acceptance-unknown',
    modality: 'llm',
    operations: ['copy.generate'],
    displayName: 'Copy acceptance unknown',
    qualityRank: 100,
  };
  const copyDeployment: ModelDeployment = {
    id: 'copy-acceptance-unknown-direct',
    catalogModelId: copyModel.id,
    apiFamily: 'openai',
    channel: 'direct',
    region: 'domestic',
    status: 'active',
  };
  const execution = new RecordedProviderExecutionPort();
  execution.failNext(copyModel.id, 'acceptance_unknown');
  const application = new ModelSupplyApplicationService({
    models: [copyModel],
    deployments: [copyDeployment],
    execution,
    ledger: new FoundationModelSupplyLedger(foundation, undefined, grantLots),
  });

  const result = await application.submit({
    workspaceId: context.workspaceId,
    actorId: context.userId,
    correlationId: context.correlationId,
    idempotencyKey: 'copy-acceptance-unknown-refund',
    operation: 'copy.generate',
    selection: { mode: 'fixed', catalogModelId: copyModel.id },
    dataClass: [],
    prompt: '部分输出后中断',
  });

  assert.equal(result.status, 'unknown');
  assert.equal(result.attempt.acceptance, 'acceptance_unknown');
  assert.equal(result.usage.status, 'refunded');
  assert.deepEqual(await foundation.getUsageProjection(context, 'copy'), {
    allowance: 2,
    reserved: 0,
    committed: 0,
    released: 0,
    available: 2,
  });
  assert.deepEqual(
    (await repository.listUsageEvents(context.workspaceId, 'copy'))
      .filter((event) => event.reservationId === result.usage.id)
      .map((event) => event.action),
    ['reserve', 'refund'],
  );
  const grantTransactions = grantLots.listTransactions(context.workspaceId);
  const usage = grantTransactions.find(
    (transaction) => transaction.transactionType === 'USAGE'
  );
  const refund = grantTransactions.find(
    (transaction) => transaction.transactionType === 'REFUND'
  );
  assert.ok(usage);
  assert.equal(refund?.relatedTransactionId, usage.id);
  assert.equal(grantLots.listLots(context.workspaceId, 'copy')[0]?.remainingAmount, 2);
});

test('retries a missed grant refund from a persisted failed result without repeating the provider call', async () => {
  class RefundOutageLedger extends MemoryGrantLotLedger {
    private failRefund = true;

    override refundUsageOperation(
      input: Parameters<MemoryGrantLotLedger['refundUsageOperation']>[0]
    ) {
      if (this.failRefund) {
        this.failRefund = false;
        throw new Error('temporary grant refund outage');
      }
      return super.refundUsageOperation(input);
    }
  }

  const repository = new MemoryFoundationRepository();
  repository.grantOwner(context.workspaceId, context.userId);
  const foundation = new P1ApplicationService(repository);
  const grantLots = new RefundOutageLedger();
  grantLots.grant({
    id: 'copy-refund-recovery-package',
    workspaceId: context.workspaceId,
    resource: 'copy',
    amount: 1,
    expirationDate: null,
    transactionType: 'PURCHASE_PACKAGE',
    createdAt: '2026-07-19T00:00:00.000Z',
  });
  const copyModel: CatalogModel = {
    id: 'copy-refund-recovery',
    modality: 'llm',
    operations: ['copy.generate'],
    displayName: 'Copy refund recovery',
    qualityRank: 100,
  };
  const copyDeployment: ModelDeployment = {
    id: 'copy-refund-recovery-direct',
    catalogModelId: copyModel.id,
    apiFamily: 'openai',
    channel: 'direct',
    region: 'domestic',
    status: 'active',
  };
  const recordedExecution = new RecordedProviderExecutionPort();
  recordedExecution.failNext(copyModel.id, 'acceptance_unknown');
  let providerExecutions = 0;
  const execution: ProviderExecutionPort = {
    async execute(request) {
      providerExecutions += 1;
      return recordedExecution.execute(request);
    },
  };
  const submission = {
    workspaceId: context.workspaceId,
    actorId: context.userId,
    correlationId: context.correlationId,
    idempotencyKey: 'copy-refund-recovery-submission',
    operation: 'copy.generate' as const,
    selection: { mode: 'fixed' as const, catalogModelId: copyModel.id },
    dataClass: [],
    prompt: '退款短暂失败后重试',
  };
  const firstApplication = new ModelSupplyApplicationService({
    models: [copyModel],
    deployments: [copyDeployment],
    execution,
    ledger: new FoundationModelSupplyLedger(foundation, undefined, grantLots),
  });

  await assert.rejects(
    firstApplication.submit(submission),
    /temporary grant refund outage/
  );
  assert.equal(providerExecutions, 1);
  assert.equal(
    grantLots.listLots(context.workspaceId, 'copy')[0]?.remainingAmount,
    0
  );

  const restartedApplication = new ModelSupplyApplicationService({
    models: [copyModel],
    deployments: [copyDeployment],
    execution,
    ledger: new FoundationModelSupplyLedger(foundation, undefined, grantLots),
  });
  const recovered = await restartedApplication.submit(submission);

  assert.equal(providerExecutions, 1);
  assert.equal(recovered.status, 'unknown');
  assert.equal(recovered.usage.status, 'refunded');
  const grantTransactions = grantLots.listTransactions(context.workspaceId);
  const usage = grantTransactions.find(
    (transaction) => transaction.transactionType === 'USAGE'
  );
  const refund = grantTransactions.find(
    (transaction) => transaction.transactionType === 'REFUND'
  );
  assert.ok(usage);
  assert.equal(refund?.relatedTransactionId, usage.id);
  assert.equal(
    grantLots.listLots(context.workspaceId, 'copy')[0]?.remainingAmount,
    1
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

test('replays a pre-grant-lot ordinal-one checkpoint without changing its payload or charging again', async () => {
  const { foundation, ledger: legacyLedger } = await fixture();
  const submission = {
    workspaceId: context.workspaceId,
    actorId: context.userId,
    correlationId: context.correlationId,
    idempotencyKey: 'legacy-checkpoint-replay',
    operation: 'image.generate' as const,
    selection: { mode: 'fixed' as const, catalogModelId: model.id },
    dataClass: [],
    prompt: 'Resume an old ordinal-one checkpoint',
  };
  const checkpointOnly: ModelSupplyLedgerPort = {
    async checkpointAttempt(input) {
      await legacyLedger.checkpointAttempt(input);
      throw new Error('simulated old process loss after checkpoint');
    },
    settleAttempt: (input) => legacyLedger.settleAttempt(input),
  };
  await assert.rejects(
    new ModelSupplyApplicationService({
      models: [model],
      deployments: [deployment],
      execution: new RecordedProviderExecutionPort(),
      ledger: checkpointOnly,
    }).submit(submission),
    /simulated old process loss/
  );

  const grantLots = new MemoryGrantLotLedger();
  grantLots.grant({
    id: 'post-upgrade-image-balance',
    workspaceId: context.workspaceId,
    resource: 'image',
    amount: 9,
    expirationDate: null,
    transactionType: 'PURCHASE_PACKAGE',
    createdAt: '2026-07-19T00:00:00.000Z',
  });
  const recovered = await new ModelSupplyApplicationService({
    models: [model],
    deployments: [deployment],
    execution: new RecordedProviderExecutionPort(),
    ledger: new FoundationModelSupplyLedger(foundation, undefined, grantLots),
  }).submit(submission);

  assert.equal(recovered.status, 'unknown');
  assert.equal(grantLots.listLots(context.workspaceId, 'image')[0]?.remainingAmount, 9);
  assert.equal(
    grantLots
      .listTransactions(context.workspaceId)
      .some((transaction) => transaction.transactionType === 'USAGE'),
    false
  );
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
