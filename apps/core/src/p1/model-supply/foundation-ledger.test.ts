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
  type ModelSupplyProviderAdmissionPort,
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
  pricingTier: 'standard',
  executionChannelId: 'channel-image-managed',
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

function createStrictSupplyFreezeStore(
  initial: readonly SupplyRequestFreeze[] = [],
) {
  const freezes = new Map(
    initial.map((freeze) => [freeze.id, structuredClone(freeze)]),
  );
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
    async getByProductUsageTask(workspaceId: string, taskId: string) {
      const freeze = [...freezes.values()].find(
        (candidate) =>
          candidate.workspaceId === workspaceId &&
          candidate.productUsageTaskId === taskId,
      );
      return freeze ? structuredClone(freeze) : null;
    },
  };
  return { freezes, supplyFreezes };
}

test('settles one initial video through the production ledger across a fresh application replay', async () => {
  const videoModel: CatalogModel = {
    displayName: 'Seedance 2',
    id: 'seedance-2',
    modality: 'video',
    operations: ['video.generate'],
    qualityRank: 100,
  };
  const videoDeployment: ModelDeployment = {
    apiFamily: 'media',
    catalogModelId: videoModel.id,
    channel: 'managed',
    credentialMode: 'platform',
    credentialVersion: 'credential-video-1',
    executionChannelId: 'channel-video-managed',
    id: 'seedance-2-managed',
    policyRevision: 'policy-video-v1',
    priceRevision: 'price-video-v1',
    pricingTier: 'standard',
    region: 'domestic',
    status: 'active',
    unitPrice: {
      amountMicros: 200_000,
      currency: 'CNY',
      unit: 'request',
    },
  };
  const repository = new MemoryFoundationRepository();
  repository.grantOwner(context.workspaceId, context.userId);
  const foundation = new P1ApplicationService(repository);
  await foundation.appendUsageEvent(
    context,
    {
      action: 'adjust',
      amount: 10,
      id: 'single-ledger-video-entitlement',
      reason: 'opening entitlement',
      resource: 'video',
    },
    'single-ledger-video-entitlement',
  );
  const productUsage = new MemoryProductUsageLedger();
  const quotes = new ProductQuoteService({ usageLedger: productUsage });
  const quote = quotes.buildQuote({
    billingMode: 'per_request',
    catalogModelId: videoModel.id,
    frozenCandidateDeploymentIds: [videoDeployment.id],
    quoteId: 'operations-quote-1',
    quotePolicyRevision: 'product-policy-1',
    unitRate: 1,
    workspaceId: context.workspaceId,
  });
  quotes.confirm({ quoteId: quote.quoteId, taskId: 'creative-work-1' });
  const canonicalBilling = new ProductBillingLifecycle(quotes);
  canonicalBilling.beforeSubmit({
    quoteRevision: quote.revision,
    resource: 'video',
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
  const { freezes, supplyFreezes } = createStrictSupplyFreezeStore();
  const durableProductUsage = {
    async getUsage(taskId: string, workspaceId: string) {
      assert.equal(workspaceId, context.workspaceId);
      return productUsage.getByTask(taskId);
    },
  };
  const createApplication = () => {
    const processLedger = new FoundationModelSupplyLedger(
      foundation,
      undefined,
      undefined,
      {
        billingLifecycle,
        productUsage: durableProductUsage,
        supplyFreezes,
      },
    );
    return new ModelSupplyApplicationService({
      deployments: [videoDeployment],
      execution: new RecordedProviderExecutionPort(),
      ledger: {
        checkpointAttempt: (input) => processLedger.checkpointAttempt(input),
        settleAttempt: (input) => processLedger.settleAttempt(input),
      },
      models: [videoModel],
    });
  };
  const submission = {
    actorId: context.userId,
    billingQuoteRevision: quote.revision,
    billingTaskId: 'creative-work-1',
    dataClass: [],
    input: { durationSeconds: 15 },
    idempotencyKey: 'single-product-ledger-submit',
    operation: 'video.generate' as const,
    prompt: '单一账本生成',
    selection: { catalogModelId: videoModel.id, mode: 'fixed' as const },
    workspaceId: context.workspaceId,
  };

  await assert.rejects(
    createApplication().submit(submission),
    /billing settle response lost/,
  );
  const replay = await createApplication().submit(submission);

  assert.equal(productUsage.listByWorkspace(context.workspaceId).length, 1);
  assert.equal(productUsage.getByTask('creative-work-1')?.status, 'committed');
  assert.equal(quotes.getQuoteByTask('creative-work-1')?.lifecycleStatus, 'settled');
  assert.deepEqual(
    quotes.listProviderCosts('creative-work-1').map((cost) => cost.attemptId),
    [replay.attempt.id],
  );
  assert.equal(settleAttempts, 2);
  const workerLedger = new FoundationModelSupplyLedger(
    foundation,
    undefined,
    undefined,
    {
      productUsage: durableProductUsage,
      supplyFreezes,
    },
  );
  assert.deepEqual(
    await workerLedger.freezeAttempt({
      attemptId: replay.attempt.id,
      deployment: videoDeployment,
      jobId: replay.jobId,
      model: videoModel,
      ordinal: 1,
      previousAttempts: [],
      previousProviderCosts: [],
      snapshot: replay.snapshot,
      submission,
    }),
    [...freezes.values()][0],
  );
  assert.equal(
    (
      await workerLedger.getSupplyFreeze(
        context.workspaceId,
        'creative-work-1',
      )
    )?.productUsageTaskId,
    'creative-work-1',
  );
});

test('replays a pre-upgrade job-linked freeze without mutating immutable facts', async () => {
  const { foundation } = await fixture();
  const productUsage = new MemoryProductUsageLedger();
  productUsage.reserve({
    billingMode: 'per_request',
    createdAt: '2026-07-21T00:00:00.000Z',
    id: 'legacy-rollout-usage',
    quantity: 1,
    quoteId: 'legacy-rollout-quote',
    resource: 'image',
    taskId: 'legacy-rollout-task',
    workspaceId: context.workspaceId,
  });
  const { freezes, supplyFreezes } = createStrictSupplyFreezeStore();
  const bilateral = {
    productUsage: {
      getUsage(taskId: string, workspaceId: string) {
        const usage = productUsage.getByTask(taskId);
        return usage?.workspaceId === workspaceId ? usage : null;
      },
    },
    supplyFreezes,
  };
  const ledger = new FoundationModelSupplyLedger(
    foundation,
    undefined,
    undefined,
    bilateral,
  );
  const submission = {
    actorId: context.userId,
    billingTaskId: 'legacy-rollout-task',
    dataClass: [],
    idempotencyKey: 'legacy-rollout-submit',
    operation: 'image.generate' as const,
    prompt: '滚动升级重放',
    selection: { catalogModelId: model.id, mode: 'fixed' as const },
    workspaceId: context.workspaceId,
  };
  const preview = new ModelSupplyApplicationService({
    deployments: [deployment],
    execution: new RecordedProviderExecutionPort(),
    models: [model],
  }).previewMediaSubmission(submission);
  const checkpoint = {
    attemptId: preview.attempt.id,
    deployment,
    jobId: preview.jobId,
    model,
    ordinal: 1,
    previousAttempts: [],
    previousProviderCosts: [],
    snapshot: preview.snapshot,
    submission,
  };
  const current = await ledger.freezeAttempt(checkpoint);
  assert.ok(current);
  const {
    executionChannelId: _executionChannelId,
    pricingTier: _pricingTier,
    ...legacyPriceRevision
  } = current.supplierPriceRevision;
  const legacy = {
    ...current,
    productUsageTaskId: preview.jobId,
    supplierPriceRevision: legacyPriceRevision,
  };
  freezes.set(legacy.id, structuredClone(legacy));

  const replay = await new FoundationModelSupplyLedger(
    foundation,
    undefined,
    undefined,
    bilateral,
  ).freezeAttempt(checkpoint);

  assert.deepEqual(replay, legacy);
  assert.equal(
    await supplyFreezes.getByProductUsageTask(
      context.workspaceId,
      'legacy-rollout-task',
    ),
    null,
  );
});

test('replays a pre-upgrade ordinary freeze without mutating immutable facts', async () => {
  const { foundation } = await fixture();
  const { freezes, supplyFreezes } = createStrictSupplyFreezeStore();
  const ledger = new FoundationModelSupplyLedger(
    foundation,
    undefined,
    undefined,
    { supplyFreezes },
  );
  const submission = {
    actorId: context.userId,
    dataClass: [],
    idempotencyKey: 'legacy-ordinary-freeze-submit',
    operation: 'image.generate' as const,
    prompt: '普通历史冻结重放',
    selection: { catalogModelId: model.id, mode: 'fixed' as const },
    workspaceId: context.workspaceId,
  };
  const preview = new ModelSupplyApplicationService({
    deployments: [deployment],
    execution: new RecordedProviderExecutionPort(),
    models: [model],
  }).previewMediaSubmission(submission);
  const checkpoint = {
    attemptId: preview.attempt.id,
    deployment,
    jobId: preview.jobId,
    model,
    ordinal: 1,
    previousAttempts: [],
    previousProviderCosts: [],
    snapshot: preview.snapshot,
    submission,
  };
  const current = await ledger.freezeAttempt(checkpoint);
  assert.ok(current);
  const {
    executionChannelId: _executionChannelId,
    pricingTier: _pricingTier,
    ...legacyPriceRevision
  } = current.supplierPriceRevision;
  const legacy = {
    ...current,
    supplierPriceRevision: legacyPriceRevision,
  };
  freezes.set(legacy.id, structuredClone(legacy));

  const replay = await ledger.freezeAttempt(checkpoint);

  assert.deepEqual(replay, legacy);
});

test('re-reads a competing durable freeze when ProductUsage settles after a miss', async () => {
  const { foundation } = await fixture();
  const productUsage = new MemoryProductUsageLedger();
  const reserved = productUsage.reserve({
    billingMode: 'per_request',
    createdAt: '2026-07-21T00:00:00.000Z',
    id: 'freeze-race-usage',
    quantity: 1,
    quoteId: 'freeze-race-quote',
    resource: 'image',
    taskId: 'freeze-race-task',
    workspaceId: context.workspaceId,
  });
  const submission = {
    actorId: context.userId,
    billingTaskId: reserved.taskId,
    dataClass: [],
    idempotencyKey: 'freeze-race-submit',
    operation: 'image.generate' as const,
    prompt: '冻结竞争重放',
    selection: { catalogModelId: model.id, mode: 'fixed' as const },
    workspaceId: context.workspaceId,
  };
  const preview = await new ModelSupplyApplicationService({
    deployments: [deployment],
    execution: new RecordedProviderExecutionPort(),
    models: [model],
  }).submit(submission);
  const checkpoint = {
    attemptId: preview.attempt.id,
    deployment,
    jobId: preview.jobId,
    model,
    ordinal: 1,
    previousAttempts: [],
    previousProviderCosts: [],
    snapshot: preview.snapshot,
    submission,
  };
  let captured: SupplyRequestFreeze | null = null;
  await new FoundationModelSupplyLedger(
    foundation,
    undefined,
    undefined,
    {
      productUsage: {
        getUsage() {
          return reserved;
        },
      },
      supplyFreezes: {
        async append(freeze) {
          captured = structuredClone(freeze);
          return structuredClone(freeze);
        },
        async get() {
          return null;
        },
        async getByProductUsageTask() {
          return null;
        },
      },
    },
  ).freezeAttempt(checkpoint);
  assert.ok(captured);
  const competingFreeze = captured as SupplyRequestFreeze;

  function racingStore(competing: SupplyRequestFreeze) {
    let reads = 0;
    return {
      async append(freeze: SupplyRequestFreeze) {
        if (freeze.routeSnapshotRef !== competing.routeSnapshotRef) {
          throw new P1DomainError(
            'IDEMPOTENCY_CONFLICT',
            'Competing freeze has different immutable facts.',
          );
        }
        return structuredClone(competing);
      },
      async get() {
        reads += 1;
        return reads === 1 ? null : structuredClone(competing);
      },
      async getByProductUsageTask() {
        return structuredClone(competing);
      },
    };
  }
  const committedLookup = {
    getUsage() {
      return { ...reserved, status: 'committed' as const };
    },
  };
  const replay = await new FoundationModelSupplyLedger(
    foundation,
    undefined,
    undefined,
    {
      productUsage: committedLookup,
      supplyFreezes: racingStore(competingFreeze),
    },
  ).freezeAttempt(checkpoint);
  assert.deepEqual(replay, competingFreeze);

  await assert.rejects(
    new FoundationModelSupplyLedger(
      foundation,
      undefined,
      undefined,
      {
        productUsage: committedLookup,
        supplyFreezes: racingStore({
          ...competingFreeze,
          routeSnapshotRef: 'competing-route-snapshot',
        }),
      },
    ).freezeAttempt(checkpoint),
    (error: unknown) =>
      error instanceof P1DomainError &&
      error.code === 'IDEMPOTENCY_CONFLICT',
  );

  const settlementLedger = new FoundationModelSupplyLedger(
    foundation,
    undefined,
    undefined,
    {
      billingLifecycle: {
        beforeSubmit() {},
        dispatchAttempt() {},
        settleTask() {},
      },
      productUsage: committedLookup,
      supplyFreezes: racingStore(competingFreeze),
    },
  );
  await settlementLedger.checkpointAttempt(checkpoint);
  await settlementLedger.settleAttempt({
    evidence: 'settlement_freeze_race',
    result: preview,
    submission,
  });
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

test('persists one immutable supply freeze before provider I/O and links settlement cost', async () => {
  const { repository, foundation } = await fixture();
  const { freezes, supplyFreezes } = createStrictSupplyFreezeStore();
  let freezeObservedBeforeProvider = false;
  const pricedDeployment = {
    ...deployment,
    executionChannelId: 'channel-image-cache',
  };
  const cachePriceRevision =
    'gpt-image-2:channel-image-cache:cache_hit:price-v1';
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
    deployments: [pricedDeployment],
    prices: [{
      id: cachePriceRevision,
      catalogModelId: model.id,
      executionChannelId: 'channel-image-cache',
      pricingTier: 'cache_hit',
      amount: 0.12,
      currency: 'USD',
      unit: 'image',
      revision: 1,
    }],
    ledger,
    execution: {
      async execute(request) {
        const [freeze] = [...freezes.values()];
        freezeObservedBeforeProvider =
          freeze?.workspaceId === request.submission.workspaceId &&
          freeze.providerCostAttemptId?.startsWith('model-attempt-') === true &&
          freeze.productUsageTaskId === undefined;
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
    pricingTier: 'cache_hit',
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
  assert.deepEqual(
    {
      executionChannelId:
        freeze.supplierPriceRevision.executionChannelId,
      id: freeze.supplierPriceRevision.id,
      pricingTier: freeze.supplierPriceRevision.pricingTier,
    },
    {
      executionChannelId: 'channel-image-cache',
      id: cachePriceRevision,
      pricingTier: 'cache_hit',
    },
  );
  const providerCosts = await repository.listProviderCosts(
    context.workspaceId,
    result.attempt.id,
  );
  assert.deepEqual(
    {
      currency: providerCosts[0]?.snapshot?.currency,
      deploymentId: providerCosts[0]?.snapshot?.deploymentId,
      supplierPriceRevision:
        providerCosts[0]?.snapshot?.supplierPriceRevision,
      unit: providerCosts[0]?.snapshot?.unit,
      unitPriceMicros: providerCosts[0]?.snapshot?.unitPriceMicros,
    },
    {
      currency: 'USD',
      deploymentId: pricedDeployment.id,
      supplierPriceRevision: cachePriceRevision,
      unit: 'image',
      unitPriceMicros: 120_000,
    },
  );
  assert.match(providerCosts[0]?.evidence ?? '', /supplyPoolId=pool-shared/);
  assert.match(
    providerCosts[0]?.evidence ?? '',
    new RegExp(`routeSnapshotRef=${result.snapshot.id}`),
  );
});

test('rejects a fresh supplier freeze without an explicit execution channel before provider I/O', async () => {
  const { foundation } = await fixture();
  const { freezes, supplyFreezes } = createStrictSupplyFreezeStore();
  let providerExecutions = 0;
  const application = new ModelSupplyApplicationService({
    models: [model],
    deployments: [{ ...deployment, executionChannelId: undefined }],
    ledger: new FoundationModelSupplyLedger(
      foundation,
      undefined,
      undefined,
      { supplyFreezes },
    ),
    execution: {
      async execute(request) {
        providerExecutions += 1;
        return new RecordedProviderExecutionPort().execute(request);
      },
    },
  });

  await assert.rejects(
    application.submit({
      workspaceId: context.workspaceId,
      actorId: context.userId,
      idempotencyKey: 'missing-execution-channel',
      operation: 'image.generate',
      selection: { mode: 'fixed', catalogModelId: model.id },
      dataClass: [],
      prompt: 'Missing channel must fail closed.',
    }),
    /requires an explicit execution channel and pricing tier/,
  );
  assert.equal(providerExecutions, 0);
  assert.equal(freezes.size, 0);
});

test('replays a pre-upgrade settlement without rewriting its provider cost fact', async () => {
  const { repository, foundation } = await fixture();
  const currentSettleProviderOutcome =
    foundation.settleProviderOutcome.bind(foundation);
  foundation.settleProviderOutcome = (settlementContext, input, key) => {
    const { snapshot: _snapshot, ...legacyProviderCost } =
      input.providerCost;
    return currentSettleProviderOutcome(
      settlementContext,
      { ...input, providerCost: legacyProviderCost },
      key,
    );
  };
  const submission = {
    actorId: context.userId,
    dataClass: [],
    idempotencyKey: 'legacy-settlement-replay',
    operation: 'image.generate' as const,
    prompt: '历史结算重放',
    selection: { catalogModelId: model.id, mode: 'fixed' as const },
    workspaceId: context.workspaceId,
  };
  const result = await new ModelSupplyApplicationService({
    deployments: [deployment],
    execution: new RecordedProviderExecutionPort(),
    ledger: new FoundationModelSupplyLedger(foundation),
    models: [model],
  }).submit(submission);
  foundation.settleProviderOutcome = currentSettleProviderOutcome;
  const [legacyCost] = await repository.listProviderCosts(
    context.workspaceId,
    result.attempt.id,
  );
  assert.ok(legacyCost);
  assert.equal(legacyCost.snapshot, undefined);

  const { supplyFreezes } = createStrictSupplyFreezeStore();
  const upgradedLedger = new FoundationModelSupplyLedger(
    foundation,
    undefined,
    undefined,
    { supplyFreezes },
  );
  await upgradedLedger.freezeAttempt({
    attemptId: result.attempt.id,
    deployment,
    jobId: result.jobId,
    model,
    ordinal: 1,
    previousAttempts: [],
    previousProviderCosts: [],
    snapshot: result.snapshot,
    submission,
  });

  await upgradedLedger.settleAttempt({
    evidence: 'provider_response',
    result,
    submission,
  });

  assert.deepEqual(
    await repository.listProviderCosts(
      context.workspaceId,
      result.attempt.id,
    ),
    [legacyCost],
  );
});

test('retries with the winning legacy cost fact during a rolling-upgrade settlement race', async () => {
  const { repository, foundation } = await fixture();
  const currentSettleProviderOutcome =
    foundation.settleProviderOutcome.bind(foundation);
  let legacyWriterInjected = false;
  foundation.settleProviderOutcome = async (
    settlementContext,
    input,
    key,
  ) => {
    if (!legacyWriterInjected) {
      legacyWriterInjected = true;
      const { snapshot: _snapshot, ...legacyProviderCost } =
        input.providerCost;
      await currentSettleProviderOutcome(
        settlementContext,
        { ...input, providerCost: legacyProviderCost },
        key,
      );
    }
    return currentSettleProviderOutcome(settlementContext, input, key);
  };
  const { supplyFreezes } = createStrictSupplyFreezeStore();
  const submission = {
    actorId: context.userId,
    dataClass: [],
    idempotencyKey: 'rolling-upgrade-settlement-race',
    operation: 'image.generate' as const,
    prompt: '滚动升级结算竞争',
    selection: { catalogModelId: model.id, mode: 'fixed' as const },
    workspaceId: context.workspaceId,
  };

  const result = await new ModelSupplyApplicationService({
    deployments: [deployment],
    execution: new RecordedProviderExecutionPort(),
    ledger: new FoundationModelSupplyLedger(
      foundation,
      undefined,
      undefined,
      { supplyFreezes },
    ),
    models: [model],
  }).submit(submission);
  foundation.settleProviderOutcome = currentSettleProviderOutcome;

  assert.equal(legacyWriterInjected, true);
  const costs = await repository.listProviderCosts(
    context.workspaceId,
    result.attempt.id,
  );
  assert.equal(costs.length, 1);
  assert.equal(costs[0]?.snapshot, undefined);
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
        executionChannelId: 'channel-image-managed',
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
  const entitlements = new ProductEntitlementApplicationService(
    repository,
    undefined,
    () => new Date('2026-07-28T00:00:00.000Z'),
  );
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
  // growth 图 100 (D-123 中级 seed), one image committed by this run.
  assert.deepEqual(await foundation.getUsageProjection(context, 'image'), {
    allowance: 100,
    available: 99,
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
  ];
  const copyDeployments: ModelDeployment[] = ['primary', 'fallback'].map(
    (channel, index) => ({
    id: `copy-quality-${channel}`,
    catalogModelId: 'copy-quality',
    executionChannelId: `channel-${channel}`,
    providerProfileId: `provider-${channel}`,
    accountIdentity: `account-${channel}`,
    endpointFingerprint: `endpoint-${channel}`,
    apiFamily: 'openai',
    channel: 'direct',
    region: 'domestic',
    status: 'active',
    priceRevision: `price-${channel}`,
    unitPrice: { amountMicros: index + 1, currency: 'CNY', unit: 'request' },
  }));
  const execution = new RecordedProviderExecutionPort();
  execution.failNext('copy-quality', 'rejected_before_accept');
  const freezes: SupplyRequestFreeze[] = [];
  const application = new ModelSupplyApplicationService({
    models: copyModels,
    deployments: copyDeployments,
    execution,
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
          async getByProductUsageTask(workspaceId, productUsageTaskId) {
            return structuredClone(
              freezes.find(
                (candidate) =>
                  candidate.workspaceId === workspaceId &&
                  candidate.productUsageTaskId === productUsageTaskId,
              ) ?? null,
            );
          },
        },
      },
    ),
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
  assert.equal(result.providerCosts[1]?.failover?.kind, 'same_model_channel');
  assert.equal(
    result.failoverAvailabilityEvents?.[0]?.eventType,
    'provider_failover',
  );
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
  const foundationCosts = (
    await Promise.all(
      attempts.map((attempt) =>
        repository.listProviderCosts(context.workspaceId, attempt.id),
      ),
    )
  ).flat();
  assert.equal(foundationCosts.length, 2);
  assert.equal(
    foundationCosts[1]?.snapshot?.supplierPriceRevision,
    'price-fallback',
  );
  assert.equal(
    foundationCosts[1]?.snapshot?.failover?.kind,
    'same_model_channel',
  );
  assert.deepEqual(
    freezes.map((freeze) => ({
      executionChannelId:
        freeze.supplierPriceRevision.executionChannelId,
      priceRevisionId: freeze.supplierPriceRevision.id,
    })),
    [
      {
        executionChannelId: 'channel-primary',
        priceRevisionId: 'price-primary',
      },
      {
        executionChannelId: 'channel-fallback',
        priceRevisionId: 'price-fallback',
      },
    ],
  );
});

test('refunds canonical billing when a cross-model fallback is rejected', async () => {
  const repository = new MemoryFoundationRepository();
  repository.grantOwner(context.workspaceId, context.userId);
  const foundation = new P1ApplicationService(repository);
  await foundation.appendUsageEvent(
    context,
    {
      id: 'invalid-fallback-copy-entitlement',
      resource: 'copy',
      action: 'adjust',
      amount: 1,
      reason: 'copy plan',
    },
    'invalid-fallback-copy-entitlement',
  );
  const copyModels: CatalogModel[] = [
    {
      id: 'copy-primary',
      modality: 'llm',
      operations: ['copy.generate'],
      displayName: 'Copy primary',
      qualityRank: 100,
    },
    {
      id: 'copy-fallback',
      modality: 'llm',
      operations: ['copy.generate'],
      displayName: 'Copy fallback',
      qualityRank: 90,
    },
  ];
  const copyDeployments: ModelDeployment[] = copyModels.map((copyModel) => ({
    id: `${copyModel.id}-direct`,
    catalogModelId: copyModel.id,
    executionChannelId: `channel-${copyModel.id}`,
    providerProfileId: `provider-${copyModel.id}`,
    accountIdentity: `account-${copyModel.id}`,
    endpointFingerprint: `endpoint-${copyModel.id}`,
    apiFamily: 'openai',
    channel: 'direct',
    region: 'domestic',
    status: 'active',
    priceRevision: `price-${copyModel.id}`,
    unitPrice: { amountMicros: 1, currency: 'CNY', unit: 'request' },
  }));
  const productUsage = new MemoryProductUsageLedger();
  const quotes = new ProductQuoteService({ usageLedger: productUsage });
  const quote = quotes.buildQuote({
    billingMode: 'per_request',
    catalogModelId: copyModels[0]!.id,
    frozenCandidateDeploymentIds: copyDeployments.map(
      (candidate) => candidate.id,
    ),
    quoteId: 'invalid-fallback-quote',
    quotePolicyRevision: 'product-policy-invalid-fallback',
    unitRate: 1,
    workspaceId: context.workspaceId,
  });
  const billingTaskId = 'invalid-fallback-task';
  quotes.confirm({ quoteId: quote.quoteId, taskId: billingTaskId });
  const billingLifecycle = new ProductBillingLifecycle(quotes);
  billingLifecycle.beforeSubmit({
    quoteRevision: quote.revision,
    resource: 'copy',
    taskId: billingTaskId,
    workspaceId: context.workspaceId,
  });
  const execution = new RecordedProviderExecutionPort();
  execution.failNext(copyModels[0]!.id, 'rejected_before_accept');
  let providerExecutions = 0;
  const result = await new ModelSupplyApplicationService({
    models: copyModels,
    deployments: copyDeployments,
    execution: {
      async execute(request) {
        providerExecutions += 1;
        return execution.execute(request);
      },
    },
    ledger: new FoundationModelSupplyLedger(
      foundation,
      undefined,
      undefined,
      { billingLifecycle },
    ),
    planningControlPlane: {
      async readPlanningState() {
        return {
          routePolicyRevisionId: 'route-policy:invalid-fallback:r1',
          routePolicy: {
            operation: 'copy.generate' as const,
            qualityTier: 'quality' as const,
            hardConstraints: ['deployment_active'],
            candidateDeploymentIds: copyDeployments.map(
              (candidate) => candidate.id,
            ),
            maxAttempts: 2,
            fallbackAuthorized: true,
          },
        };
      },
    },
  }).submit({
    actorId: context.userId,
    billingQuoteRevision: quote.revision,
    billingTaskId,
    dataClass: [],
    idempotencyKey: 'invalid-cross-model-fallback',
    operation: 'copy.generate',
    prompt: '跨模型回退必须先声明降级面',
    selection: { mode: 'auto', profile: 'quality' },
    workspaceId: context.workspaceId,
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.usage.status, 'refunded');
  assert.equal(providerExecutions, 1);
  assert.equal(quotes.getQuoteByTask(billingTaskId)?.lifecycleStatus, 'refunded');
  assert.equal(productUsage.getByTask(billingTaskId)?.status, 'refunded');
  assert.equal(quotes.listProviderCosts(billingTaskId).length, 1);
});

test('refunds grant-lot copy usage after acceptance-unknown partial delivery', async () => {
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
    [],
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
    [],
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

test('persists and refunds a pre-provider rejection for a cold workspace', async () => {
  const repository = new MemoryFoundationRepository();
  const foundation = new P1ApplicationService(repository);
  const grantLots = new MemoryGrantLotLedger();
  grantLots.grant({
    id: 'cold-workspace-copy-grant',
    workspaceId: context.workspaceId,
    resource: 'copy',
    amount: 1,
    expirationDate: null,
    transactionType: 'REGISTER_GIFT',
    createdAt: '2026-07-31T00:00:00.000Z',
  });
  let providerCalls = 0;
  const execution: ProviderExecutionPort = {
    async execute() {
      providerCalls += 1;
      throw new Error('provider must not be invoked');
    },
  };
  const providerAdmission: ModelSupplyProviderAdmissionPort = {
    async admit() {
      return {
        status: 'rejected',
        errorCode: 'CAPACITY_EXHAUSTED',
        message: 'Product-account concurrency exhausted.',
      };
    },
    async release() {
      throw new Error('rejected admission has no lease');
    },
  };
  const copyModel: CatalogModel = {
    id: 'cold-workspace-copy',
    modality: 'llm',
    operations: ['copy.generate'],
    displayName: 'Cold workspace copy',
    qualityRank: 100,
  };
  const copyDeployment: ModelDeployment = {
    id: 'cold-workspace-copy-direct',
    catalogModelId: copyModel.id,
    apiFamily: 'openai',
    channel: 'direct',
    region: 'domestic',
    status: 'active',
  };
  const submission = {
    workspaceId: context.workspaceId,
    actorId: context.userId,
    correlationId: context.correlationId,
    idempotencyKey: 'cold-workspace-admission-rejection',
    operation: 'copy.generate' as const,
    selection: { mode: 'fixed' as const, catalogModelId: copyModel.id },
    dataClass: [],
    prompt: '冷启动门店文案',
  };
  const createApplication = () =>
    new ModelSupplyApplicationService({
      models: [copyModel],
      deployments: [copyDeployment],
      execution,
      providerAdmission,
      ledger: new FoundationModelSupplyLedger(
        foundation,
        undefined,
        grantLots,
      ),
    });

  const first = await createApplication().submit(submission);
  const replay = await createApplication().submit(submission);

  assert.equal(providerCalls, 0);
  assert.equal(first.status, 'failed');
  assert.equal(first.failureCode, 'CAPACITY_EXHAUSTED');
  assert.equal(first.attempt.acceptance, 'rejected_before_accept');
  assert.equal(first.usage.status, 'refunded');
  assert.equal(first.providerCost.amount, 0);
  assert.deepEqual(replay, first);
  assert.equal(
    grantLots.listLots(context.workspaceId, 'copy')[0]?.remainingAmount,
    1,
  );
  assert.deepEqual(
    grantLots
      .listTransactions(context.workspaceId)
      .map((transaction) => transaction.transactionType),
    ['REGISTER_GIFT', 'USAGE', 'REFUND'],
  );
  const job = await repository.getGenerationJob(
    context.workspaceId,
    first.jobId,
  );
  assert.equal(job?.status, 'failed');
  assert.deepEqual(job?.result, first);
  await assert.rejects(
    foundation.getGenerationJob(context, first.jobId),
    (error: unknown) =>
      error instanceof P1DomainError &&
      error.code === 'NOT_FOUND',
  );
});
