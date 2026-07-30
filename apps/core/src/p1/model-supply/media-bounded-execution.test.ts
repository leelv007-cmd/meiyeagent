import assert from 'node:assert/strict';
import test from 'node:test';
import type { ModelCapabilityProfile } from '@meiye/contracts';

import {
  MemoryModelAssetStorage,
  ModelSupplyApplicationService,
  RecordedAdapterRouter,
  createDefaultCatalogModels,
  createDefaultDeployments,
  type ModelSupplyLedgerPort,
  type ModelSupplyProviderAdmissionPort,
  type ModelSupplySubmission,
  type ProviderAttempt,
  type RouteSnapshot,
} from './index.js';

interface SideEffectCounters {
  admissions: number;
  checkpoints: number;
  freezes: number;
  releases: number;
  settlements: number;
}

function emptyCounters(): SideEffectCounters {
  return {
    admissions: 0,
    checkpoints: 0,
    freezes: 0,
    releases: 0,
    settlements: 0,
  };
}

function boundedSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'bounded-execution-snapshot/v1',
    maxIterations: 1,
    maxCostCents: 100,
    maxWallClockMs: 60_000,
    maxDelegations: 'unset',
    requiredLimits: [
      'maxIterations',
      'maxCostCents',
      'maxWallClockMs',
    ],
    consumption: {
      iterations: 0,
      costCents: 0,
      wallClockMs: 0,
      delegations: 0,
    },
    stopReason: null,
    triggeredLimit: null,
    ...overrides,
  };
}

function boundedSubmission(
  overrides: Record<string, unknown> = {},
): ModelSupplySubmission {
  return {
    actorId: 'owner-a',
    dataClass: [],
    idempotencyKey: 'bounded-image-a',
    operation: 'image.generate',
    prompt: '生成一张门店项目图',
    selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
    workspaceId: 'workspace-a',
    mediaBoundedExecution: {
      schemaVersion: 'media-bounded-execution/v1',
      snapshot: boundedSnapshot(),
      countedAttemptIds: [],
      countedProviderCostIds: [],
      ...overrides,
    },
  } as ModelSupplySubmission;
}

function createBoundedModels(counters: SideEffectCounters) {
  const ledger: ModelSupplyLedgerPort = {
    async checkpointAttempt() {
      counters.checkpoints += 1;
      return { replayed: false };
    },
    async freezeAttempt() {
      counters.freezes += 1;
      return { persisted: true };
    },
    async settleAttempt() {
      counters.settlements += 1;
    },
  };
  const providerAdmission: ModelSupplyProviderAdmissionPort = {
    async admit() {
      counters.admissions += 1;
      return {
        status: 'admitted',
        leaseId: 'capacity:bounded-image-a',
        supplyPoolId: 'pool-a',
        entitlementPolicyRevision: 'entitlement-r1',
        appliedAllocationIds: [],
      };
    },
    async release() {
      counters.releases += 1;
    },
  };
  return new ModelSupplyApplicationService({
    assetStorage: new MemoryModelAssetStorage(),
    deployments: createDefaultDeployments({
      activatedDeploymentIds: ['gpt-image-2-managed'],
      activationEvidenceStatus: 'recorded',
      deploymentPricingById: {
        'gpt-image-2-managed': {
          priceRevision: 'gpt-image-cny-v1',
          unitPrice: {
            amountMicros: 12_345,
            currency: 'CNY',
            unit: 'image',
          },
        },
      },
    }),
    execution: new RecordedAdapterRouter(),
    ledger,
    models: createDefaultCatalogModels(),
    providerAdmission,
  });
}

async function assertBlockedBeforeProviderEffects(input: {
  submission: ModelSupplySubmission;
  message: RegExp;
  routeSnapshot?: RouteSnapshot;
  previousAttempts?: ProviderAttempt[];
  expectedCheckpoints?: number;
}) {
  const counters = emptyCounters();
  const models = createBoundedModels(counters);
  let providerCalls = 0;

  await assert.rejects(
    models.executeMediaProviderEffect({
      submission: input.submission,
      effectIdempotencyKey: 'provider-effect-blocked',
      stage: 'submit',
      ...(input.routeSnapshot ? { routeSnapshot: input.routeSnapshot } : {}),
      ...(input.previousAttempts
        ? { previousAttempts: input.previousAttempts }
        : {}),
      async execute() {
        providerCalls += 1;
        return { acceptance: 'accepted' as const };
      },
    }),
    input.message,
  );

  assert.deepEqual(
    {
      providerCalls,
      admissions: counters.admissions,
      freezes: counters.freezes,
      checkpoints: counters.checkpoints,
      settlements: counters.settlements,
    },
    {
      providerCalls: 0,
      admissions: 0,
      freezes: 0,
      checkpoints: input.expectedCheckpoints ?? 0,
      settlements: 0,
    },
  );
}

test('media bounded authorization refuses an exhausted iteration before admission or provider I/O', async () => {
  const counters = {
    admissions: 0,
    checkpoints: 0,
    freezes: 0,
    releases: 0,
    settlements: 0,
  };
  const models = createBoundedModels(counters);
  let providerCalls = 0;
  const submission = boundedSubmission({
    snapshot: boundedSnapshot({ maxIterations: 0 }),
  });

  await assert.rejects(
    models.executeMediaProviderEffect({
      submission,
      effectIdempotencyKey: 'provider-effect-a',
      stage: 'submit',
      async execute() {
        providerCalls += 1;
        return { acceptance: 'accepted' as const };
      },
    }),
    /iteration/iu,
  );

  assert.equal(providerCalls, 0);
  assert.equal(counters.admissions, 0);
  assert.equal(counters.freezes, 0);
  assert.equal(counters.checkpoints, 0);
});

test('Harness media cannot strip its bounded authorization before provider admission', async () => {
  const submission = boundedSubmission();
  submission.idempotencyKey = 'harness-media:authorization-stripped';
  delete submission.mediaBoundedExecution;

  await assertBlockedBeforeProviderEffects({
    submission,
    message: /bounded execution authorization/iu,
  });
});

test('application service forwards a bounded media raise to the attached durable job', async () => {
  const models = createBoundedModels(emptyCounters());
  const authorization = boundedSubmission().mediaBoundedExecution!;
  const calls: Array<{
    workspaceId: string;
    jobId: string;
    authorization: typeof authorization;
  }> = [];
  models.attachDurableMediaRuntime({
    async submit() {
      throw new Error('not used');
    },
    async resumeBoundedMediaJob(input) {
      calls.push(structuredClone(input));
      return {
        jobId: input.jobId,
        workspaceId: input.workspaceId,
        status: 'queued',
        providerLifecycleLatencyMs: 0,
        result: { jobId: input.jobId } as never,
      };
    },
    async get() {
      throw new Error('not used');
    },
    async cancel() {
      throw new Error('not used');
    },
    async reconcileCancelledProviderTerminal() {
      throw new Error('not used');
    },
  });

  const resumed = await models.resumeBoundedMediaJob({
    workspaceId: 'workspace-a',
    jobId: 'durable-media-a',
    authorization,
  });

  assert.equal(resumed.jobId, 'durable-media-a');
  assert.deepEqual(calls, [
    {
      workspaceId: 'workspace-a',
      jobId: 'durable-media-a',
      authorization,
    },
  ]);
});

test('application service freezes auto-quality text execution as one fixed no-fallback route', async () => {
  const referenceImageCapabilityProfile: ModelCapabilityProfile = {
    vocabularyVersion: 'model-capability-v1',
    protocolCapabilities: {},
    modalities: [
      {
        mime: 'text/plain',
        supported: true,
        basis: 'explicit_override',
        evidenceRef: 'test:exact-text:text',
      },
      {
        mime: 'image/*',
        supported: true,
        basis: 'explicit_override',
        evidenceRef: 'test:exact-text:reference-image',
      },
    ],
    businessTags: [],
    modalityCapabilities: [],
  };
  const models = new ModelSupplyApplicationService({
    assetStorage: new MemoryModelAssetStorage(),
    deployments: [
      {
        id: 'text-quality-direct',
        catalogModelId: 'text-quality',
        apiFamily: 'openai',
        channel: 'direct',
        region: 'domestic',
        status: 'active',
        priceRevision: 'approved-text-price-r1',
        unitPrice: {
          amountMicros: 20_000,
          currency: 'CNY',
          unit: 'request',
        },
        capabilityProfile: referenceImageCapabilityProfile,
      },
      {
        id: 'text-balanced-direct',
        catalogModelId: 'text-balanced',
        apiFamily: 'openai',
        channel: 'direct',
        region: 'domestic',
        status: 'active',
        priceRevision: 'approved-text-price-r1',
        unitPrice: {
          amountMicros: 10_000,
          currency: 'CNY',
          unit: 'request',
        },
        capabilityProfile: referenceImageCapabilityProfile,
      },
    ],
    execution: new RecordedAdapterRouter(),
    models: [
      {
        id: 'text-quality',
        modality: 'llm',
        operations: ['text.respond'],
        displayName: 'Text quality',
        qualityRank: 100,
      },
      {
        id: 'text-balanced',
        modality: 'llm',
        operations: ['text.respond'],
        displayName: 'Text balanced',
        qualityRank: 80,
      },
    ],
  });

  const route = await models.freezeAutoTextRouteForExecution({
    workspaceId: 'workspace-text-route',
    dataClass: [],
  });

  assert.deepEqual(route.requestedSelection, {
    mode: 'fixed',
    catalogModelId: 'text-quality',
    fallbackConsent: false,
  });
  assert.deepEqual(route.candidateCatalogModelIds, ['text-quality']);
  assert.equal(route.actualCatalogModelId, 'text-quality');
  assert.equal(route.deploymentId, 'text-quality-direct');
  assert.equal(route.maxAttempts, 1);
  assert.equal(route.fallbackAuthorized, false);
  assert.equal(route.fallbackConsent, false);
  assert.equal(route.allowedCandidates?.length, 1);
  assert.equal(route.reason, 'fixed_selection');
});

test('media bounded authorization conservatively rounds frozen CNY price before provider I/O', async () => {
  const counters = {
    admissions: 0,
    checkpoints: 0,
    freezes: 0,
    releases: 0,
    settlements: 0,
  };
  const models = createBoundedModels(counters);
  let providerCalls = 0;

  await assert.rejects(
    models.executeMediaProviderEffect({
      submission: boundedSubmission({
        snapshot: boundedSnapshot({ maxCostCents: 1 }),
      }),
      effectIdempotencyKey: 'provider-effect-cost',
      stage: 'submit',
      async execute() {
        providerCalls += 1;
        return { acceptance: 'accepted' as const };
      },
    }),
    /cost/iu,
  );

  assert.equal(providerCalls, 0);
  assert.equal(counters.admissions, 0);
  assert.equal(counters.freezes, 0);
  assert.equal(counters.checkpoints, 0);
});

test('media bounded authorization fails closed for unset or exhausted execution axes', async (t) => {
  const cases = [
    {
      name: 'iteration limit unset',
      snapshot: boundedSnapshot({ maxIterations: 'unset' }),
      message: /iteration/iu,
    },
    {
      name: 'cost limit unset',
      snapshot: boundedSnapshot({ maxCostCents: 'unset' }),
      message: /cost/iu,
    },
    {
      name: 'wall-clock limit unset',
      snapshot: boundedSnapshot({ maxWallClockMs: 'unset' }),
      message: /wall-clock/iu,
    },
    {
      name: 'wall-clock limit exhausted',
      snapshot: boundedSnapshot({
        consumption: {
          iterations: 0,
          costCents: 0,
          wallClockMs: 60_000,
          delegations: 0,
        },
      }),
      message: /wall-clock/iu,
    },
    {
      name: 'cost limit exhausted',
      snapshot: boundedSnapshot({
        consumption: {
          iterations: 0,
          costCents: 100,
          wallClockMs: 0,
          delegations: 0,
        },
      }),
      message: /cost/iu,
    },
  ] as const;

  for (const item of cases) {
    await t.test(item.name, async () => {
      await assertBlockedBeforeProviderEffects({
        submission: boundedSubmission({ snapshot: item.snapshot }),
        message: item.message,
      });
    });
  }
});

test('media bounded authorization fails closed when the current frozen candidate is not priceable', async (t) => {
  const cases = [
    {
      name: 'zero price',
      mutate(snapshot: RouteSnapshot) {
        snapshot.allowedCandidates![0]!.unitPriceMicros = 0;
      },
      message: /price/iu,
    },
    {
      name: 'unknown price',
      mutate(snapshot: RouteSnapshot) {
        snapshot.allowedCandidates![0]!.pricingStatus = 'unknown';
      },
      message: /price/iu,
    },
    {
      name: 'missing price revision',
      mutate(snapshot: RouteSnapshot) {
        snapshot.allowedCandidates![0]!.priceRevision = '';
      },
      message: /price/iu,
    },
    {
      name: 'unknown price unit',
      mutate(snapshot: RouteSnapshot) {
        snapshot.allowedCandidates![0]!.unit = 'token';
      },
      message: /price unit/iu,
    },
    {
      name: 'missing current candidate',
      mutate(snapshot: RouteSnapshot) {
        snapshot.allowedCandidates = [];
      },
      message: /price/iu,
    },
  ] as const;

  for (const item of cases) {
    await t.test(item.name, async () => {
      const submission = boundedSubmission();
      const counters = emptyCounters();
      const models = createBoundedModels(counters);
      const routeSnapshot = structuredClone(
        models.previewMediaSubmission(submission).snapshot,
      );
      item.mutate(routeSnapshot);

      await assertBlockedBeforeProviderEffects({
        submission,
        routeSnapshot,
        message: item.message,
      });
    });
  }
});

test('media bounded authorization requires and applies a frozen FX revision for USD pricing', async () => {
  const submission = boundedSubmission({
    snapshot: boundedSnapshot({ maxCostCents: 83 }),
  });
  const counters = emptyCounters();
  const models = createBoundedModels(counters);
  const routeSnapshot = structuredClone(
    models.previewMediaSubmission(submission).snapshot,
  );
  const candidate = routeSnapshot.allowedCandidates?.[0];
  assert.ok(candidate);
  candidate.currency = 'USD';
  candidate.unitPriceMicros = 120_000;
  candidate.priceRevision = 'gpt-image-usd-v1';

  await assertBlockedBeforeProviderEffects({
    submission,
    routeSnapshot,
    message: /exchange-rate/iu,
  });
  await assertBlockedBeforeProviderEffects({
    submission: boundedSubmission({
      snapshot: boundedSnapshot({ maxCostCents: 83 }),
      fx: {
        revision: 'fx-cny-usd-v1',
        cnyPerUsdMicros: 7_000_000,
      },
    }),
    routeSnapshot,
    message: /cost/iu,
  });

  const allowedCounters = emptyCounters();
  const allowedModels = createBoundedModels(allowedCounters);
  let providerCalls = 0;
  await allowedModels.executeMediaProviderEffect({
    submission: boundedSubmission({
      snapshot: boundedSnapshot({ maxCostCents: 84 }),
      fx: {
        revision: 'fx-cny-usd-v1',
        cnyPerUsdMicros: 7_000_000,
      },
    }),
    effectIdempotencyKey: 'provider-effect-usd-allowed',
    routeSnapshot,
    stage: 'submit',
    async execute() {
      providerCalls += 1;
      return { acceptance: 'accepted' as const };
    },
  });

  assert.equal(providerCalls, 1);
  assert.equal(allowedCounters.admissions, 1);
  assert.equal(allowedCounters.freezes, 1);
  assert.equal(allowedCounters.checkpoints, 1);
});

test('media bounded authorization reconciles counted, accepted, or unknown attempts instead of resubmitting', async (t) => {
  for (const acceptance of ['accepted', 'acceptance_unknown'] as const) {
    await t.test(`previous ${acceptance}`, async () => {
      const submission = boundedSubmission();
      const counters = emptyCounters();
      const models = createBoundedModels(counters);
      const preview = models.previewMediaSubmission(submission);
      const previousAttempt: ProviderAttempt = {
        ...preview.attempt,
        acceptance,
        status: acceptance === 'accepted' ? 'completed' : 'unknown',
      };

      await assertBlockedBeforeProviderEffects({
        submission,
        previousAttempts: [previousAttempt],
        message: /reconcile/iu,
      });
    });
  }

  await t.test('current attempt already counted', async () => {
    const counters = emptyCounters();
    const models = createBoundedModels(counters);
    const initial = boundedSubmission();
    const currentAttemptId = models.previewMediaSubmission(initial).attempt.id;

    await assertBlockedBeforeProviderEffects({
      submission: boundedSubmission({
        countedAttemptIds: [currentAttemptId],
      }),
      message: /reconcile/iu,
      expectedCheckpoints: 1,
    });
  });
});

test('media bounded authorization is strict when present and preserves legacy direct media callers when omitted', async () => {
  const validCounters = emptyCounters();
  const validModels = createBoundedModels(validCounters);
  let validProviderCalls = 0;

  await validModels.executeMediaProviderEffect({
    submission: boundedSubmission({
      snapshot: boundedSnapshot({ maxCostCents: 2 }),
    }),
    effectIdempotencyKey: 'provider-effect-valid',
    stage: 'submit',
    async execute() {
      validProviderCalls += 1;
      return { acceptance: 'accepted' as const };
    },
  });

  assert.equal(validProviderCalls, 1);
  assert.equal(validCounters.admissions, 1);
  assert.equal(validCounters.freezes, 1);
  assert.equal(validCounters.checkpoints, 1);

  await assertBlockedBeforeProviderEffects({
    submission: boundedSubmission({
      countedAttemptIds: ['duplicate-attempt', 'duplicate-attempt'],
    }),
    message: /authorization/iu,
  });

  for (const invalidAuthorization of [null, false, '']) {
    const invalidSubmission = {
      ...boundedSubmission(),
      mediaBoundedExecution: invalidAuthorization,
    } as unknown as ModelSupplySubmission;
    await assertBlockedBeforeProviderEffects({
      submission: invalidSubmission,
      message: /authorization/iu,
    });
  }

  await assertBlockedBeforeProviderEffects({
    submission: boundedSubmission({
      snapshot: boundedSnapshot({
        maxDelegations: 'unset',
        requiredLimits: [
          'maxIterations',
          'maxCostCents',
          'maxWallClockMs',
          'maxDelegations',
        ],
      }),
    }),
    message: /delegation.*limit/iu,
  });

  const legacyCounters = emptyCounters();
  const legacyModels = createBoundedModels(legacyCounters);
  const legacySubmission = boundedSubmission();
  delete legacySubmission.mediaBoundedExecution;
  let legacyProviderCalls = 0;

  await legacyModels.executeMediaProviderEffect({
    submission: legacySubmission,
    effectIdempotencyKey: 'provider-effect-legacy',
    stage: 'submit',
    async execute() {
      legacyProviderCalls += 1;
      return { acceptance: 'accepted' as const };
    },
  });

  assert.equal(legacyProviderCalls, 1);
  assert.equal(legacyCounters.admissions, 1);
  assert.equal(legacyCounters.freezes, 1);
  assert.equal(legacyCounters.checkpoints, 1);
});
