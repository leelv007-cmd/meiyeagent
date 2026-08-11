/**
 * V31-09 Plan Compiler contract tests.
 *
 * Seam: deterministic PlanCompiler + memory store + fixture ports.
 * Covers: model contamination ignore, append-only adjust, readiness projection,
 * retry default-off, cache key workspace+releaseId, A18, unit-type registration
 * boundary, no grammar interpreter.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { PlanProposal } from './turn-contracts.js';
import {
  assertUnitTypeRegistrationComplete,
  buildExecutionUnitCacheKey,
  createCanonicalExecutionUnitRegistry,
  ExecutionUnitRegistry,
  ExecutionUnitRegistryError,
} from './execution-unit-registry.js';
import { MemoryMarketingPlanStore } from './memory-plan-store.js';
import {
  assertNoConditionalSideEffects,
  createFixturePlanCompilerPorts,
  createProductionPlanCompiler,
  PlanCompiler,
  PlanCompilerError,
} from './plan-compiler.js';
import { projectMarketingPlanReadiness } from './plan-readiness.js';
import { createProductionPlanCompilerPorts } from './plan-compiler-production-ports.js';
import {
  compileFinalizeExecutionPlanFreezes,
  recipeAuthorityHintFromSubmission,
} from './composer-plan-session.js';
import { createCreationExecutionSnapshot } from '../execution-spine/creation-execution-snapshot.js';
import type { CreationSubmissionRecord } from '../execution-spine/submission-coordinator.js';
import { briefSourceRevisionId } from '../creation-experience/postgres-brief-revision-context.js';
import {
  CatalogProductQuoteAuthority,
  type PackageQuoteAuthority,
} from '../product-billing/server-quote-authority.js';
import { ProductQuoteService } from '../product-billing/quote-service.js';

const TS = '2026-08-08T12:00:00.000Z';

function productionSkillAuthority(
  skill: {
    skillId: string;
    skillRevisionRef: string;
    contentHash: string;
  } | null = {
    skillId: 'skill.beauty-copywriting',
    skillRevisionRef: 'skill.beauty-copywriting@1',
    contentHash: 'a'.repeat(64),
  },
) {
  return {
    async resolveSkill() {
      return skill;
    },
  };
}

const RECIPE_AUTHORITY_HINT: {
  recipeRevisionIds: string[];
  catalogRevisionId: string;
  sourceRevisionIds: string[];
} = {
  recipeRevisionIds: ['recipe-service-promotion@7'],
  catalogRevisionId: 'catalog-route-r4',
  sourceRevisionIds: ['asset-before@3'],
};

test('production compiler freezes the authoritative live rights policy revision', async () => {
  const ports = createProductionPlanCompilerPorts({
    rights: {
      async resolve() {
        return { knownAssetIds: ['asset-1'], unauthorizedAssetIds: [] };
      },
      async resolveWithRevision() {
        return {
          knownAssetIds: ['asset-1'],
          rightsRevision: 'rights:ws-1:policy-current',
          unauthorizedAssetIds: [],
        };
      },
    },
    models: {
      async getCatalog() {
        return { revisionId: 'model-r1', models: [{ id: 'model-1' }] };
      },
    },
    skills: productionSkillAuthority(),
  });

  const rights = await ports.rights.resolveRights({
    workspaceId: 'ws-1',
    assetIntentions: ['asset-1'],
    factIntentions: [],
    deliverables: [
      {
        deliverableId: 'deliverable-1',
        kind: 'note',
        platform: 'xiaohongshu',
        quantity: 1,
        purpose: '案例种草笔记',
      },
    ],
  });

  assert.deepEqual(rights.rightsRevisionIds, [
    'rights:ws-1:policy-current',
  ]);
});

test('production compiler refuses a multi-carrier plan without a server package quote authority', async () => {
  const ports = productionRecipePorts();
  await assert.rejects(
    () =>
      ports.quote.resolveQuote({
        workspaceId: 'ws-1',
        planId: 'plan-package-1',
        planRevision: 1,
        harnessReleaseId: 'release-1',
        deliverables: [
          {
            deliverableId: 'note-1',
            kind: 'note',
            platform: 'xiaohongshu',
            quantity: 2,
            purpose: '笔记',
          },
          {
            deliverableId: 'copy-1',
            kind: 'copy',
            platform: 'xiaohongshu',
            quantity: 1,
            purpose: '文案',
          },
        ],
        quoteResolutionHint: {
          quoteRef: { id: 'single-preview', revision: '1' },
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
      }),
    (error: unknown) =>
      error instanceof PlanCompilerError &&
      error.code === 'INVALID_STATE' &&
      /explicit server package quote authorities/u.test(error.message),
  );
});

test('production quote port prices and persists a fully-authorized multi-carrier package', async () => {
  const quoteAuthority = new CatalogProductQuoteAuthority(
    {
      async getCatalog(_workspaceId, operation) {
        if (operation === 'image.generate') {
          return {
            revisionId: 'catalog-note-r2',
            models: [
              {
                id: 'note-model',
                creditPricing: {
                  'image.generate': {
                    creditCost: 5,
                    failureRefundsCredits: true,
                  },
                },
              },
            ],
          };
        }
        return {
          revisionId: 'catalog-copy-r4',
          models: [
            {
              id: 'copy-model',
              creditPricing: {
                'copy.generate': {
                  creditCost: 2,
                  failureRefundsCredits: false,
                },
              },
            },
          ],
        };
      },
    },
    () => new Date('2099-08-08T12:00:00.000Z'),
  );
  const billing = new ProductQuoteService();
  const ports = productionRecipePorts({
    packageQuotes: quoteAuthority,
    billing,
  });
  const resolution = await ports.quote.resolveQuote({
    workspaceId: 'ws-1',
    planId: 'plan-package-1',
    planRevision: 1,
    harnessReleaseId: 'release-1',
    deliverables: [
      {
        deliverableId: 'note-1',
        kind: 'note',
        platform: 'xiaohongshu',
        quantity: 4,
        purpose: '笔记',
      },
      {
        deliverableId: 'copy-1',
        kind: 'copy',
        platform: 'xiaohongshu',
        quantity: 1,
        purpose: '文案',
      },
    ],
    packageQuoteInput: {
      quoteId: 'plan-package-1:r1',
      workspaceId: 'ws-1',
      carrierAuthorities: [
        {
          allocationId: 'note-allocation',
          carrierUnitId: 'note-make',
          carrier: 'note',
          catalogModelId: 'note-model',
          operation: 'image.generate',
          routeSnapshotRef: 'route-note-r2',
          rightsRevisionRefs: ['rights-note-r2'],
        },
        {
          allocationId: 'copy-allocation',
          carrierUnitId: 'copy-make',
          carrier: 'copy',
          catalogModelId: 'copy-model',
          operation: 'copy.generate',
          routeSnapshotRef: 'route-copy-r4',
          rightsRevisionRefs: ['rights-copy-r4'],
        },
      ],
      finalDeliverables: [
        {
          allocationId: 'note-allocation',
          carrier: 'note',
          deliveryUnits: 4,
        },
        {
          allocationId: 'copy-allocation',
          carrier: 'copy',
          deliveryUnits: 1,
        },
      ],
    },
  });

  assert.equal(resolution.summary?.creditCost, 22);
  assert.equal(resolution.summary?.outputCount, 5);
  assert.deepEqual(
    resolution.packageBilling?.allocations.map((allocation) => ({
      allocationId: allocation.allocationId,
      carrierUnitId: allocation.carrierUnitId,
      creditCost: allocation.creditCost,
    })),
    [
      { allocationId: 'copy-allocation', carrierUnitId: 'copy-make', creditCost: 2 },
      { allocationId: 'note-allocation', carrierUnitId: 'note-make', creditCost: 20 },
    ],
  );
  const persisted = billing.getQuote('plan-package-1:r1');
  assert.equal(persisted?.creditCost, 22);
  assert.equal(persisted?.outputCount, 5);
  assert.equal(persisted?.packageContract?.allocations.length, 2);
});

test('PlanCompiler carries packageBilling through durable artifact and every carrier freeze', async () => {
  const quoteAuthority = new CatalogProductQuoteAuthority(
    {
      async getCatalog(_workspaceId, operation) {
        return {
          revisionId: `catalog-${operation}`,
          models: [
            {
              id: operation === 'image.generate' ? 'note-model' : 'copy-model',
              creditPricing: {
                [operation]: {
                  creditCost: operation === 'image.generate' ? 5 : 2,
                  failureRefundsCredits: operation !== 'copy.generate',
                },
              },
            },
          ],
        };
      },
    },
    () => new Date('2099-08-08T12:00:00.000Z'),
  );
  const billing = new ProductQuoteService();
  const ports = productionRecipePorts({
    packageQuotes: quoteAuthority,
    billing,
  });
  const store = new MemoryMarketingPlanStore();
  const compiler = new PlanCompiler({ store, ports });
  const result = await compiler.compile({
    workspaceId: 'ws-1',
    threadId: 'thread-package-1',
    planId: 'plan-package-compiler-1',
    proposal: baseProposal({
      recommendedDeliverables: [
        { carrier: 'copy', quantity: 1, purpose: '文案' },
        { carrier: 'note', quantity: 2, purpose: '笔记' },
      ],
    }),
    intentRevision: 1,
    contextBundleId: 'bundle-package-1',
    contextRevision: '1',
    harnessReleaseId: 'release-package-1',
    recipeAuthorityHint: RECIPE_AUTHORITY_HINT,
    packageQuoteInput: {
      quoteId: 'plan-package-compiler-1:r1',
      workspaceId: 'ws-1',
      carrierAuthorities: [
        {
          allocationId: 'copy-allocation',
          carrierUnitId: 'copy-make',
          carrier: 'copy',
          catalogModelId: 'copy-model',
          operation: 'copy.generate',
          routeSnapshotRef: 'route-copy-r1',
          rightsRevisionRefs: ['rights-copy-r1'],
        },
        {
          allocationId: 'note-allocation',
          carrierUnitId: 'note-make',
          carrier: 'note',
          catalogModelId: 'note-model',
          operation: 'image.generate',
          routeSnapshotRef: 'route-note-r1',
          rightsRevisionRefs: ['rights-note-r1'],
        },
      ],
      finalDeliverables: [
        { allocationId: 'copy-allocation', carrier: 'copy', deliveryUnits: 1 },
        { allocationId: 'note-allocation', carrier: 'note', deliveryUnits: 2 },
      ],
    },
    now: TS,
  });

  assert.equal(result.packageBilling?.allocations.length, 2);
  const replay = await compiler.compile({
    workspaceId: 'ws-1',
    threadId: 'thread-package-1',
    planId: 'plan-package-compiler-1',
    proposal: baseProposal({
      recommendedDeliverables: [
        { carrier: 'copy', quantity: 1, purpose: '文案' },
        { carrier: 'note', quantity: 2, purpose: '笔记' },
      ],
    }),
    intentRevision: 1,
    contextBundleId: 'bundle-package-1',
    contextRevision: '1',
    harnessReleaseId: 'release-package-1',
    recipeAuthorityHint: RECIPE_AUTHORITY_HINT,
    now: TS,
  });
  assert.deepEqual(replay.packageBilling, result.packageBilling);

  const freezes = compileFinalizeExecutionPlanFreezes({
    result,
    contextBundleId: 'bundle-package-1',
    contextRevision: '1',
    approvalBasis: 'merchant_confirmed',
  });
  assert.deepEqual(
    freezes.map((freeze) => freeze.carrier),
    ['copy', 'note'],
  );
  assert.deepEqual(
    freezes.map((freeze) => freeze.carrierUnitId),
    ['copy-make', 'note-make'],
  );
  for (const freeze of freezes) {
    assert.deepEqual(freeze.packageBilling, result.packageBilling);
  }
});

function baseProposal(overrides: Partial<PlanProposal> = {}): PlanProposal {
  return {
    goalNarrative: '小红书护理案例种草',
    whyNow: '暑期新客',
    recommendedDeliverables: [
      {
        carrier: 'note',
        platform: 'xiaohongshu',
        quantity: 1,
        purpose: '案例种草笔记',
      },
    ],
    expressionStrategy: {
      voice: '专业温和',
      promotionIntensity: 'soft',
    },
    factIntentions: ['门店地址'],
    assetIntentions: ['before_after_case'],
    assumptions: [
      { key: 'tone', statement: '少一点硬广', risk: 'low' },
    ],
    ...overrides,
  };
}

function compileInput(
  store: MemoryMarketingPlanStore,
  overrides: Record<string, unknown> = {},
) {
  const ports = createFixturePlanCompilerPorts();
  const compiler = new PlanCompiler({ store, ports });
  return {
    compiler,
    ports,
    input: {
      workspaceId: 'ws-1',
      threadId: 'thread-1',
      goalIds: ['goal-1'],
      proposal: baseProposal(),
      intentRevision: 1,
      contextBundleId: 'bundle-1',
      contextRevision: 'ctx-1',
      harnessReleaseId: 'release-1',
      now: TS,
      planId: 'plan-fixed-1',
      ...overrides,
    },
  };
}

// ─── Deterministic authority overrides model contamination ──────────────────

test('projector crash repairs the same revision instead of appending a phantom revision', async () => {
  const store = new MemoryMarketingPlanStore();
  const projected: string[] = [];
  let failOnce = true;
  const compiler = new PlanCompiler({
    store,
    ports: createFixturePlanCompilerPorts(),
    semanticEvents: {
      async project(candidate) {
        if (failOnce) {
          failOnce = false;
          throw new Error('projector unavailable after plan commit');
        }
        projected.push(candidate.eventId);
        return { event: candidate, replayed: false };
      },
    },
  });
  const input = {
    workspaceId: 'ws-repair',
    resourceId: 'ws-repair',
    threadId: 'thread-repair',
    proposal: baseProposal(),
    intentRevision: 7,
    contextBundleId: 'bundle-repair',
    contextRevision: 'ctx-7',
    harnessReleaseId: 'release-repair',
    now: TS,
    planId: 'plan-repair-1',
  };

  await assert.rejects(() => compiler.compile(input), /projector unavailable/u);
  assert.equal((await store.listRevisions(input.planId)).length, 1);
  const repaired = await compiler.compile(input);
  assert.equal(repaired.revision.revision, 1);
  assert.equal((await store.listRevisions(input.planId)).length, 1);
  assert.deepEqual(projected, ['plan:plan-repair-1:r1']);
});

test('compiler ignores model quote/balance/rights/availability contamination', async () => {
  const store = new MemoryMarketingPlanStore();
  let quoteCalls = 0;
  let rightsCalls = 0;
  let modelCalls = 0;

  const ports = createFixturePlanCompilerPorts({
    quote: {
      async resolveQuote() {
        quoteCalls += 1;
        return {
          quoteRef: { id: 'authority-quote', revision: 9 },
          expiresAt: '2026-08-08T13:00:00.000Z',
          summary: { source: 'authority' },
        };
      },
    },
    rights: {
      async resolveRights() {
        rightsCalls += 1;
        return {
          rightsSummary: { status: 'authority_rights', ok: true },
          rightsRevisionIds: ['rights-auth-1'],
          assetUsages: [{ assetRef: 'a1' }],
          factUsages: [{ factRef: 'f1' }],
        };
      },
    },
    models: {
      async resolveAvailability() {
        modelCalls += 1;
        return {
          capabilitySummary: { models: ['catalog-model-1'] },
          modelRevisionIds: ['model-auth-1'],
          available: true,
        };
      },
    },
  });

  const compiler = new PlanCompiler({ store, ports });
  const result = await compiler.compile({
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    proposal: baseProposal(),
    intentRevision: 1,
    contextBundleId: 'bundle-1',
    contextRevision: 'ctx-1',
    harnessReleaseId: 'release-1',
    now: TS,
    planId: 'plan-contam-1',
    modelContamination: {
      quote: { id: 'model-forged-quote', revision: 1, amount: 999 },
      quoteRef: { id: 'model-forged-quote', revision: 1 },
      balance: 0,
      rightsStatus: 'granted_by_model',
      rightsSummary: { status: 'model_lie' },
      modelAvailability: { available: false },
      expiresAt: '2099-01-01T00:00:00.000Z',
    },
  });

  assert.equal(quoteCalls, 1);
  assert.equal(rightsCalls, 1);
  assert.equal(modelCalls, 1);
  assert.equal(result.revision.quoteRef.id, 'authority-quote');
  assert.equal(result.revision.quoteRef.revision, 9);
  assert.equal(result.revision.expiresAt, '2026-08-08T13:00:00.000Z');
  assert.deepEqual(result.revision.rightsSummary, {
    status: 'authority_rights',
    ok: true,
  });
  assert.equal(
    (result.revision.capabilitySummary as { models?: string[] }).models?.[0],
    'catalog-model-1',
  );
  assert.equal(result.revision.boundRevisions.rightsRevisionIds[0], 'rights-auth-1');
  assert.equal(result.revision.boundRevisions.modelRevisionIds[0], 'model-auth-1');
  // Model forgery must not leak into stored revision keys.
  assert.equal(
    JSON.stringify(result.revision).includes('model-forged-quote'),
    false,
  );
  assert.equal(JSON.stringify(result.revision).includes('model_lie'), false);
});

// ─── Append-only NL adjust ──────────────────────────────────────────────────

test('natural-language adjust only appends a new revision; old is intact', async () => {
  const store = new MemoryMarketingPlanStore();
  const { compiler, input } = compileInput(store, { planId: 'plan-adjust-1' });

  const first = await compiler.compile(input);
  assert.equal(first.revision.revision, 1);
  const firstHash = first.revision.contentHash;

  const second = await compiler.adjust({
    ...input,
    existingPlanId: 'plan-adjust-1',
    patch: {
      summary: '只做小红书',
      instructions: '去掉抖音，语气再自然一点',
    },
    proposal: baseProposal({
      goalNarrative: '小红书护理案例种草',
      recommendedDeliverables: [
        {
          carrier: 'note',
          platform: 'xiaohongshu',
          quantity: 1,
          purpose: '案例种草笔记',
        },
      ],
    }),
  });

  assert.equal(second.revision.revision, 2);
  assert.equal(second.revision.planId, first.revision.planId);
  assert.notEqual(second.revision.contentHash, firstHash);
  assert.match(second.revision.goal.summary, /只做小红书/);

  const revisions = await store.listRevisions('plan-adjust-1');
  assert.equal(revisions.length, 2);
  assert.equal(revisions[0]!.revision, 1);
  assert.equal(revisions[0]!.contentHash, firstHash);
  store.assertNotOverwritten('plan-adjust-1', 1, firstHash);

  // No status column on either revision.
  assert.equal('status' in revisions[0]!, false);
  assert.equal('readiness' in revisions[0]!, false);
  assert.equal('status' in revisions[1]!, false);
});

test('live binding refresh appends one durable revision and replays the same successor', async () => {
  const store = new MemoryMarketingPlanStore();
  const { compiler, input } = compileInput(store, {
    planId: 'plan-live-refresh-1',
  });
  const first = await compiler.compile(input);

  const refresh = {
    planId: first.revision.planId,
    expectedRevision: first.revision.revision,
    quoteRef: { id: 'authority-quote-live', revision: 'quote-r2' },
    rightsRevisionRefs: ['rights-live-2'],
    factRevisionRefs: ['identity:identity-1@2', 'brief:bundle-1@2'],
    now: '2026-08-08T12:30:00.000Z',
    workspaceId: input.workspaceId,
  };
  const successor = await compiler.refreshLiveBindings(refresh);
  const replay = await compiler.refreshLiveBindings(refresh);

  assert.equal(successor.revision.revision, 2);
  assert.equal(replay.revision.contentHash, successor.revision.contentHash);
  assert.deepEqual(successor.revision.quoteRef, refresh.quoteRef);
  assert.deepEqual(
    successor.revision.boundRevisions.rightsRevisionIds,
    refresh.rightsRevisionRefs,
  );
  assert.deepEqual(successor.factRevisionRefs, refresh.factRevisionRefs);
  assert.deepEqual(
    successor.revision.factUsages,
    refresh.factRevisionRefs.map((factRef) => ({ factRef })),
  );
  assert.equal((await store.listRevisions(refresh.planId)).length, 2);
  store.assertNotOverwritten(
    first.revision.planId,
    first.revision.revision,
    first.revision.contentHash,
  );
});

test('live binding refresh projects plan.revised so Living Plan can show plan-diff', async () => {
  const { MemoryAgentSemanticEventStore } = await import(
    '../agent-semantic-events/memory-semantic-event-store.js'
  );
  const { AgentSemanticEventProjector } = await import(
    '../agent-semantic-events/semantic-event-projector.js'
  );
  const store = new MemoryMarketingPlanStore();
  const eventStore = new MemoryAgentSemanticEventStore();
  const projector = new AgentSemanticEventProjector(eventStore);
  const { input } = compileInput(store, { planId: 'plan-live-emit-1' });
  const compiler = new PlanCompiler({
    store,
    ports: createFixturePlanCompilerPorts(),
    semanticEvents: projector,
  });
  const first = await compiler.compile({
    ...input,
    workspaceId: 'ws-live',
    resourceId: 'ws-live',
    threadId: 'thread-live',
  });
  const refresh = {
    planId: first.revision.planId,
    expectedRevision: first.revision.revision,
    quoteRef: { id: 'authority-quote-live', revision: 'quote-r2' },
    rightsRevisionRefs: ['rights-live-2'],
    factRevisionRefs: ['identity:identity-1@2', 'brief:bundle-1@2'],
    now: '2026-08-08T12:30:00.000Z',
    workspaceId: 'ws-live',
  };
  await compiler.refreshLiveBindings(refresh);
  const events = await eventStore.listByThread({
    resourceId: 'ws-live',
    threadId: 'thread-live',
  });
  assert.equal(events.length, 2);
  assert.equal(events[0]?.eventType, 'plan.created');
  assert.equal(events[1]?.eventType, 'plan.revised');
  const payload = events[1]?.payload as Record<string, unknown>;
  assert.match(String(payload.adjustmentSummary ?? ''), /重新确认/u);
});

// ─── Readiness is projection only ───────────────────────────────────────────

test('readiness is projection: ready → stale → reprice_required → blocked', async () => {
  const store = new MemoryMarketingPlanStore();
  const { compiler, input } = compileInput(store, { planId: 'plan-ready-1' });
  const compiled = await compiler.compile(input);

  assert.equal(compiled.readiness, 'ready');

  assert.equal(
    projectMarketingPlanReadiness({
      revision: compiled.revision,
      facts: { contextRevision: 'ctx-2' },
      now: TS,
    }),
    'stale',
  );

  assert.equal(
    projectMarketingPlanReadiness({
      revision: compiled.revision,
      facts: { quoteExpired: true },
      now: TS,
    }),
    'reprice_required',
  );

  assert.equal(
    projectMarketingPlanReadiness({
      revision: compiled.revision,
      facts: {},
      now: '2026-08-09T12:00:00.000Z', // past default fixture expiry window if any
    }),
    // fixture ports expire 1h after nowIso at call time — bound expiresAt from compile
    Date.parse(compiled.revision.expiresAt) <=
      Date.parse('2026-08-09T12:00:00.000Z')
      ? 'reprice_required'
      : 'ready',
  );

  assert.equal(
    projectMarketingPlanReadiness({
      revision: compiled.revision,
      facts: { modelUnavailable: true },
      now: TS,
    }),
    'blocked',
  );

  // Projection never mutates revision.
  assert.equal(compiled.revision.revision, 1);
  assert.equal('readiness' in compiled.revision, false);
});

// ─── plan-as-data: retry off, dependency groups, cache key ──────────────────

test('compiled plan is data: retry default off, dependency groups, cache key has releaseId', async () => {
  const store = new MemoryMarketingPlanStore();
  const { compiler, input } = compileInput(store, {
    planId: 'plan-exec-1',
    proposal: baseProposal({
      recommendedDeliverables: [
        { carrier: 'note', platform: 'xiaohongshu', quantity: 2, purpose: '笔记' },
      ],
    }),
  });
  const result = await compiler.compile(input);
  const plan = result.executionPlan;

  assert.equal(plan.schemaVersion, 'compiled-execution-plan/v1');
  assert.ok(plan.units.length >= 4);
  assert.ok(plan.dependencyGroups.length >= 3);

  for (const unit of plan.units) {
    const retry = plan.boundedRetry[unit.unitId];
    assert.ok(retry);
    assert.equal(retry!.retry.enabled, false);
    assert.equal(retry!.maxAttempts, 1);
  }

  // Cacheable units (context.read / compliance.check) expose workspace keys.
  const cacheable = Object.entries(result.unitCacheKeys);
  assert.ok(cacheable.length >= 1);
  for (const [unitId, key] of cacheable) {
    assert.match(key, /^ws:ws-1:/);
    assert.match(key, /:rel:release-1$/);
    assert.ok(plan.units.some((unit) => unit.unitId === unitId));
  }

  // Sensitive/generation units are not cacheable by default.
  const generateUnits = plan.units.filter((unit) =>
    unit.unitType.endsWith('.generate'),
  );
  for (const unit of generateUnits) {
    assert.equal(result.unitCacheKeys[unit.unitId], undefined);
    assert.equal(plan.cachePolicies?.[unit.unitId], undefined);
  }

  // Every cacheable unit carries its own policy, not just context.read. When
  // only the context unit was wired the check unit silently lost its policy.
  const cacheableTypes = plan.units
    .filter((unit) => plan.cachePolicies?.[unit.unitId])
    .map((unit) => unit.unitType)
    .sort();
  assert.deepEqual(cacheableTypes, ['compliance.check', 'context.read']);

  // Direct cache key helper contract.
  const key = buildExecutionUnitCacheKey({
    workspaceId: 'ws-a',
    unitType: 'context.read',
    inputHash: 'abc',
    harnessReleaseId: 'rel-9',
  });
  assert.equal(key, 'ws:ws-a:unit:context.read:in:abc:rel:rel-9');
  assert.throws(
    () =>
      buildExecutionUnitCacheKey({
        workspaceId: '',
        unitType: 'context.read',
        inputHash: 'x',
        harnessReleaseId: 'rel',
      }),
    ExecutionUnitRegistryError,
  );
});

// ─── P0-C: quantity actually compiles ───────────────────────────────────────

async function compileNotePlan(quantity: number) {
  const { compiler, input } = compileInput(new MemoryMarketingPlanStore(), {
    planId: `plan-qty-${quantity}`,
    proposal: baseProposal({
      recommendedDeliverables: [
        { carrier: 'note', platform: 'xiaohongshu', quantity, purpose: '笔记' },
      ],
    }),
  });
  return (await compiler.compile(input)).executionPlan;
}

test('P0-C: requested quantity expands the repeatable step instead of producing the same plan', async () => {
  const one = await compileNotePlan(1);
  const seven = await compileNotePlan(7);

  const pageUnits = (plan: Awaited<ReturnType<typeof compileNotePlan>>) =>
    plan.units.filter((unit) => unit.unitId.startsWith('unit-note-pages'));
  assert.equal(pageUnits(one).length, 1);
  assert.equal(pageUnits(seven).length, 7);

  // Distinct unit ids, and each instance names which deliverable unit it is —
  // the executor keys its durable effects on exactly these fields.
  const ids = pageUnits(seven).map((unit) => unit.unitId);
  assert.equal(new Set(ids).size, 7);
  assert.deepEqual(
    pageUnits(seven).map(
      (unit) => (unit.input as { deliverableIndex?: number }).deliverableIndex,
    ),
    [0, 1, 2, 3, 4, 5, 6],
  );
  for (const unit of pageUnits(seven)) {
    assert.equal(
      (unit.input as { deliverableId?: string }).deliverableId,
      'd1-note',
    );
  }

  // The expanded units are scheduled, not orphaned.
  const scheduled = seven.dependencyGroups.flatMap((group) => group.unitIds);
  assert.equal(scheduled.length, seven.units.length);
  assert.equal(new Set(scheduled).size, scheduled.length);
  for (const id of ids) assert.ok(scheduled.includes(id));

  // The plan a merchant is quoted for differs; it used to be byte-identical.
  assert.notDeepEqual(one.units, seven.units);
  assert.notEqual(JSON.stringify(one), JSON.stringify(seven));
});

test('P0-C: a multi-carrier plan compiles one execution plan per carrier', async () => {
  // Restores the deliverable line that was deleted to keep this fixture
  // single-carrier, which is what hid the per-carrier constant. The Plan is
  // allowed to span carriers; one Make execution is not, so compilation splits
  // rather than rejecting the revision.
  const { compiler, input } = compileInput(new MemoryMarketingPlanStore(), {
    planId: 'plan-multi-carrier-1',
    proposal: baseProposal({
      recommendedDeliverables: [
        { carrier: 'copy', quantity: 1, purpose: '纯文案' },
        { carrier: 'note', platform: 'xiaohongshu', quantity: 2, purpose: '笔记' },
      ],
    }),
  });
  const result = await compiler.compile(input);

  assert.deepEqual(
    result.executionPlans.map((compiled) => compiled.carrier),
    ['copy', 'note'],
  );
  // Both carriers are quoted on one revision.
  assert.deepEqual(
    result.revision.deliverables.map((item) => `${item.kind}:${item.quantity}`),
    ['copy:1', 'note:2'],
  );
  // Each plan carries only its own carrier's units, so neither can execute the
  // other's steps under the wrong effect-key namespace.
  const [copyPlan, notePlan] = result.executionPlans;
  assert.ok(copyPlan && notePlan);
  for (const unit of copyPlan.executionPlan.units) {
    assert.match(unit.unitId, /^unit-copy-/);
  }
  for (const unit of notePlan.executionPlan.units) {
    assert.match(unit.unitId, /^unit-note-/);
  }
  // The note carrier asked for 2, so its repeatable step expanded to 2.
  assert.equal(
    notePlan.executionPlan.units.filter((unit) =>
      unit.unitId.startsWith('unit-note-pages'),
    ).length,
    2,
  );
  // The convenience field is the first carrier's plan, not a merged one.
  assert.deepEqual(result.executionPlan, copyPlan.executionPlan);
});

// ─── A18 + no grammar interpreter ───────────────────────────────────────────

test('A18: conditional side-effect unit types rejected; no grammar nodes', async () => {
  assert.throws(
    () =>
      new ExecutionUnitRegistry([
        {
          unitType: 'evil.conditional_write',
          description: 'illegal',
          sideEffectClass: 'bounded_write',
          mayAppearInConditional: true,
          inputSchema: createCanonicalExecutionUnitRegistry().resolve(
            'context.read',
          ).inputSchema,
          cacheDefault: { cacheable: false, reason: 'x' },
          policyTags: ['x'],
        },
      ]),
    /mayAppearInConditional|A18|sideEffectClass/u,
  );

  const store = new MemoryMarketingPlanStore();
  const { compiler, input } = compileInput(store, { planId: 'plan-a18-1' });
  const result = await compiler.compile(input);
  assert.doesNotThrow(() =>
    assertNoConditionalSideEffects(
      result.executionPlan,
      createCanonicalExecutionUnitRegistry(),
    ),
  );

  const blob = JSON.stringify(result.executionPlan);
  assert.equal(blob.includes('ConditionalNode'), false);
  assert.equal(blob.includes('grammar'), false);
  assert.equal(blob.includes('ifElse'), false);
});

// ─── Unit type registration boundary ────────────────────────────────────────

test('new unit type requires registry + schema + policy + test evidence', () => {
  const candidate = {
    unitType: 'custom.report.generate',
    description: 'Custom report',
    primitive: 'generate' as const,
    sideEffectClass: 'none' as const,
    mayAppearInConditional: false,
    inputSchema: createCanonicalExecutionUnitRegistry().resolve('copy.generate')
      .inputSchema,
    cacheDefault: {
      cacheable: false as const,
      reason: 'generation',
    },
    policyTags: ['billed', 'custom'],
  };

  assert.throws(
    () =>
      assertUnitTypeRegistrationComplete({
        definition: candidate,
        hasSchema: true,
        hasPolicy: true,
        hasTest: false,
      }),
    /missing registration test/u,
  );

  assert.doesNotThrow(() =>
    assertUnitTypeRegistrationComplete({
      definition: candidate,
      hasSchema: true,
      hasPolicy: true,
      hasTest: true,
    }),
  );

  // Canonical set is registered and resolvable.
  const registry = createCanonicalExecutionUnitRegistry();
  for (const unitType of [
    'context.read',
    'copy.generate',
    'note.generate',
    'media.generate',
    'compliance.check',
  ]) {
    assert.equal(registry.has(unitType), true);
    assert.ok(registry.resolve(unitType).policyTags.length > 0);
  }
});

// ─── V31-38: recipe / source / catalog / skill authority (fail closed) ──────

function productionRecipePorts(options?: {
  skills?: ReturnType<typeof productionSkillAuthority>;
  packageQuotes?: PackageQuoteAuthority;
  billing?: ProductQuoteService;
}) {
  return createProductionPlanCompilerPorts({
    rights: {
      async resolve() {
        return { knownAssetIds: [], unauthorizedAssetIds: [] };
      },
      async resolveWithRevision() {
        return {
          knownAssetIds: [],
          rightsRevision: 'rights:ws-1:policy-current',
          unauthorizedAssetIds: [],
        };
      },
    },
    models: {
      async getCatalog() {
        return { revisionId: 'model-r1', models: [{ id: 'model-1' }] };
      },
    },
    skills: options?.skills ?? productionSkillAuthority(),
    ...(options?.packageQuotes
      ? { packageQuotes: options.packageQuotes }
      : {}),
    ...(options?.billing ? { billing: options.billing } : {}),
  });
}

const RECIPE_SKILL_INPUT = {
  workspaceId: 'ws-1',
  deliverables: [
    {
      deliverableId: 'd1',
      kind: 'copy' as const,
      platform: 'xiaohongshu' as const,
      quantity: 1,
      purpose: '种草文案',
    },
  ],
  harnessReleaseId: 'release-1',
  now: TS,
};

test('V31-38: missing recipe authority rejects plan compile', async () => {
  const ports = productionRecipePorts();
  await assert.rejects(
    () => ports.recipeSkills.resolveRecipeSkills(RECIPE_SKILL_INPUT),
    (error: unknown) =>
      error instanceof PlanCompilerError &&
      error.code === 'INVALID_STATE' &&
      /recipe\/source\/catalog authority/u.test(error.message),
  );
  await assert.rejects(
    () =>
      ports.recipeSkills.resolveRecipeSkills({
        ...RECIPE_SKILL_INPUT,
        recipeAuthorityHint: {
          recipeRevisionIds: [],
          catalogRevisionId: 'catalog-r1',
          sourceRevisionIds: ['source-r1'],
        },
      }),
    (error: unknown) =>
      error instanceof PlanCompilerError &&
      error.code === 'INVALID_STATE' &&
      /recipe revision/u.test(error.message),
  );
});

test('V31-38: missing source authority rejects plan compile', async () => {
  const ports = productionRecipePorts();
  await assert.rejects(
    () =>
      ports.recipeSkills.resolveRecipeSkills({
        ...RECIPE_SKILL_INPUT,
        recipeAuthorityHint: {
          recipeRevisionIds: ['recipe-r1'],
          catalogRevisionId: 'catalog-r1',
          sourceRevisionIds: [],
        },
      }),
    (error: unknown) =>
      error instanceof PlanCompilerError &&
      error.code === 'INVALID_STATE' &&
      /source revision/u.test(error.message),
  );
});

test('V31-38: missing catalog authority rejects plan compile', async () => {
  const ports = productionRecipePorts();
  await assert.rejects(
    () =>
      ports.recipeSkills.resolveRecipeSkills({
        ...RECIPE_SKILL_INPUT,
        recipeAuthorityHint: {
          recipeRevisionIds: ['recipe-r1'],
          catalogRevisionId: '   ',
          sourceRevisionIds: ['source-r1'],
        },
      }),
    (error: unknown) =>
      error instanceof PlanCompilerError &&
      error.code === 'INVALID_STATE' &&
      /catalog revision/u.test(error.message),
  );
});

test('V31-38: missing skill authority rejects plan compile', async () => {
  const ports = productionRecipePorts({
    skills: productionSkillAuthority(null),
  });
  await assert.rejects(
    () =>
      ports.recipeSkills.resolveRecipeSkills({
        ...RECIPE_SKILL_INPUT,
        recipeAuthorityHint: { ...RECIPE_AUTHORITY_HINT },
      }),
    (error: unknown) =>
      error instanceof PlanCompilerError &&
      error.code === 'INVALID_STATE' &&
      /skill authority/u.test(error.message),
  );
});

test('V31-38: a mismatched skill authority cannot be recorded as the platform skill', async () => {
  const ports = productionRecipePorts({
    skills: productionSkillAuthority({
      skillId: 'skill.capture-store-workflow',
      skillRevisionRef: 'skill.capture-store-workflow@7',
      contentHash: 'mismatched-skill-hash'.padEnd(64, '0'),
    }),
  });
  await assert.rejects(
    () =>
      ports.recipeSkills.resolveRecipeSkills({
        ...RECIPE_SKILL_INPUT,
        recipeAuthorityHint: { ...RECIPE_AUTHORITY_HINT },
      }),
    (error: unknown) =>
      error instanceof PlanCompilerError &&
      error.code === 'INVALID_STATE' &&
      /skill authority/u.test(error.message),
  );
});

test('V31-38: skillRevisionRef and contentHash come from skill authority', async () => {
  const authority = {
    skillId: 'skill.beauty-copywriting',
    skillRevisionRef: 'skill.beauty-copywriting@9',
    contentHash: 'authority-hash-9'.padEnd(64, '0'),
  };
  const ports = productionRecipePorts({
    skills: productionSkillAuthority(authority),
  });
  const resolved = await ports.recipeSkills.resolveRecipeSkills({
    ...RECIPE_SKILL_INPUT,
    recipeAuthorityHint: { ...RECIPE_AUTHORITY_HINT },
  });
  assert.equal(resolved.skillInvocationReceipts.length, 1);
  assert.equal(
    resolved.skillInvocationReceipts[0]!.skillRevisionRef,
    authority.skillRevisionRef,
  );
  assert.equal(
    resolved.skillInvocationReceipts[0]!.contentHash,
    authority.contentHash,
  );
  assert.match(
    resolved.skillInvocationReceipts[0]!.skillRevisionRef,
    /^skill\.beauty-copywriting@\d+$/u,
  );

  // Mutation: change authority return → receipt follows.
  const mutated = {
    skillId: 'skill.beauty-copywriting',
    skillRevisionRef: 'skill.beauty-copywriting@10',
    contentHash: 'authority-hash-10'.padEnd(64, '0'),
  };
  const portsMutated = productionRecipePorts({
    skills: productionSkillAuthority(mutated),
  });
  const resolvedMutated = await portsMutated.recipeSkills.resolveRecipeSkills({
    ...RECIPE_SKILL_INPUT,
    recipeAuthorityHint: { ...RECIPE_AUTHORITY_HINT },
  });
  assert.equal(
    resolvedMutated.skillInvocationReceipts[0]!.skillRevisionRef,
    mutated.skillRevisionRef,
  );
  assert.equal(
    resolvedMutated.skillInvocationReceipts[0]!.contentHash,
    mutated.contentHash,
  );
});

test('V31-38: plan revision binds true recipe/source/catalog from authority hint', async () => {
  const store = new MemoryMarketingPlanStore();
  const ports = productionRecipePorts({
    skills: productionSkillAuthority({
      skillId: 'skill.beauty-copywriting',
      skillRevisionRef: 'skill.beauty-copywriting@3',
      contentHash: 'b'.repeat(64),
    }),
  });
  // Production quote port needs an admitted quote snapshot.
  const quoteHint = {
    quoteRef: { id: 'quote-1', revision: 'quote-r1' },
    expiresAt: '2026-08-09T12:00:00.000Z',
    summary: { source: 'test_quote' },
  };
  const compiler = new PlanCompiler({
    store,
    ports: {
      ...ports,
      quote: {
        async resolveQuote(input) {
          if (!input.quoteResolutionHint) {
            throw new Error('missing quote');
          }
          return input.quoteResolutionHint;
        },
      },
    },
  });
  const result = await compiler.compile({
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    goalIds: ['goal-1'],
    proposal: baseProposal(),
    intentRevision: 1,
    contextBundleId: 'bundle-1',
    contextRevision: 'ctx-1',
    harnessReleaseId: 'release-1',
    now: TS,
    planId: 'plan-recipe-auth-1',
    quoteResolutionHint: quoteHint,
    recipeAuthorityHint: { ...RECIPE_AUTHORITY_HINT },
  });

  assert.deepEqual(
    result.revision.boundRevisions.recipeRevisionIds,
    [...RECIPE_AUTHORITY_HINT.recipeRevisionIds],
  );
  assert.equal(
    result.revision.boundRevisions.catalogRevisionId,
    RECIPE_AUTHORITY_HINT.catalogRevisionId,
  );
  assert.deepEqual(
    result.revision.boundRevisions.sourceRevisionIds,
    [...RECIPE_AUTHORITY_HINT.sourceRevisionIds],
  );
  assert.ok(result.revision.boundRevisions.recipeRevisionIds.length > 0);
  assert.ok(result.revision.boundRevisions.sourceRevisionIds.length > 0);
  assert.equal(
    result.skillInvocationReceipts[0]!.skillRevisionRef,
    'skill.beauty-copywriting@3',
  );
  assert.equal(result.skillInvocationReceipts[0]!.contentHash, 'b'.repeat(64));
});

test('V31-38: recipeAuthorityHintFromSubmission reads true snapshot revisions (no literals, no empties)', () => {
  const submission = submissionRecord({
    recipe: { id: 'recipe-1', revision: 'recipe-promotion@7' },
    route: { id: 'route-1', revision: 'catalog-route-r4' },
    sources: {
      assets: [
        { id: 'asset-before', revision: 'asset-before@3', role: 'source' },
        { id: 'asset-after', revision: 'asset-after@2', role: 'source' },
      ],
      contentPackage: { id: 'pkg-1', revision: 'pkg-r1' },
    },
  });
  const hint = recipeAuthorityHintFromSubmission(submission);
  assert.deepEqual(hint.recipeRevisionIds, ['recipe-promotion@7']);
  assert.equal(hint.catalogRevisionId, 'catalog-route-r4');
  assert.deepEqual(hint.sourceRevisionIds, ['asset-before@3', 'asset-after@2', 'pkg-r1']);
  // Never empty and never a literal: every value round-trips to a snapshot ref.
  assert.ok(hint.recipeRevisionIds.length > 0);
  assert.ok(hint.catalogRevisionId.length > 0);
  assert.ok(hint.sourceRevisionIds.length > 0);
});

test('V31-38: free-copy submission without assets still binds a deterministic brief source revision', () => {
  const submission = submissionRecord({
    recipe: { id: 'recipe-1', revision: 'recipe-r1' },
    route: { id: 'route-1', revision: 'route-r1' },
    sources: { assets: [] },
  });
  const hint = recipeAuthorityHintFromSubmission(submission);
  assert.deepEqual(hint.recipeRevisionIds, ['recipe-r1']);
  assert.equal(hint.catalogRevisionId, 'route-r1');
  // The same source-set hash the brief domain freezes, not a fabricated value.
  assert.equal(
    hint.sourceRevisionIds[0],
    briefSourceRevisionId([]),
  );
  assert.equal(hint.sourceRevisionIds.length, 1);
});

function submissionRecord(input: {
  recipe: { id: string; revision: string };
  route: { id: string; revision: string };
  sources: {
    assets: Array<{
      id: string;
      revision: string;
      role: 'source' | 'reference' | 'subject' | 'style';
    }>;
    contentPackage?: { id: string; revision: string };
  };
}): CreationSubmissionRecord {
  const snapshot = createCreationExecutionSnapshot(
    {
      actorId: 'owner-1',
      workspaceId: 'workspace-1',
      idempotencyKey: 'submission-authority-hint',
      taskId: 'task-authority-hint',
      workId: 'work-authority-hint',
      contentPackageId: 'package-authority-hint',
      expectedContentPackageRevision: 0,
      creationMode: 'customized',
      intent: '为夏日护理做图文',
      surface: { id: 'surface-1', revision: 'surface-r1' },
      recipe: input.recipe,
      lens: 'image_text_note',
      platform: { id: 'xiaohongshu' },
      contentPackagePlatform: 'xiaohongshu',
      distributionTarget: 'manual_copy',
      deliverable: {
        kind: 'image_set',
        quantity: 3,
        aspectRatio: '3:4',
        notePageBound: 3,
      },
      deliverables: [
        {
          id: 'note-main',
          kind: 'image_text_note',
          order: 0,
          quantity: 3,
          aspectRatio: '3:4',
          notePageBound: 3,
        },
      ],
      sources: input.sources,
      rights: { revision: 'rights-r1', summary: 'authorized' },
      identity: { id: 'identity-1', revision: 'identity-r1' },
      modelPolicy: { id: 'policy-1', revision: 'policy-r1', mode: 'fixed' },
      catalogModel: { id: 'model-1', revision: 'model-r1' },
      quote: { id: 'quote-authority-hint', revision: 'quote-r1' },
      route: input.route,
      briefContext: { id: 'context-authority-hint', revision: 1 },
      contentModules: ['social_cover'],
    },
    TS,
  );
  return {
    snapshot,
    task: { id: 'task-authority-hint' },
    work: { id: 'work-authority-hint' },
    contentPackage: { id: 'package-authority-hint', expectedRevision: 0 },
    usageReservation: {
      id: 'usage-authority-hint',
      units: [{ resource: 'image', quantity: 3 }],
    },
  };
}

// ─── Skill invocation receipt + production assembly fail-closed ─────────────

test('compiler records skill invocation receipts; production assembly requires ports', async () => {
  const store = new MemoryMarketingPlanStore();
  const { compiler, input } = compileInput(store, { planId: 'plan-skill-1' });
  const result = await compiler.compile(input);
  assert.ok(result.skillInvocationReceipts.length >= 1);
  assert.equal(result.skillInvocationReceipts[0]!.stage, 'plan_compile');
  assert.equal(
    result.skillInvocationReceipts[0]!.harnessReleaseId,
    'release-1',
  );

  assert.throws(
    () =>
      createProductionPlanCompiler({
        store,
        ports: createFixturePlanCompilerPorts({
          quote: undefined as never,
        }),
      }),
    PlanCompilerError,
  );

  const wired = createProductionPlanCompiler({
    store,
    ports: createFixturePlanCompilerPorts(),
  });
  assert.ok(wired.unitRegistry.has('copy.generate'));
});

// ─── A8: domain enums do not enter primitive signatures on units ────────────

test('harness service surface exposes compilePlan/adjustPlan after bindPlanCompiler', async () => {
  const { AgentSessionHarnessService } = await import('./service.js');
  const { FixtureAgentKernel } = await import('./agent-kernel.js');
  const { MemoryAgentSessionStore } = await import(
    './memory-agent-session-store.js'
  );

  const harness = new AgentSessionHarnessService({
    store: new MemoryAgentSessionStore(),
    kernel: new FixtureAgentKernel({
      decision: {
        merchantMessage: 'noop',
        action: { kind: 'finish_turn' as const },
        evidenceRefs: [],
        assumptions: [],
      },
    }),
    resolveRelease: async () => ({
      controlLimits: {
        maxLlmSteps: 4,
        maxToolCalls: 6,
        maxRetrievalCalls: 4,
        maxMerchantQuestions: 1,
        maxReplans: 1,
        maxSchemaRepairs: 1,
        maxContextTokens: 8_000,
        maxDelegations: 1,
      },
    }),
  });

  await assert.rejects(
    () =>
      harness.compilePlan({
        workspaceId: 'ws-1',
        threadId: 'thread-1',
        proposal: baseProposal(),
        intentRevision: 1,
        contextBundleId: 'b',
        contextRevision: '1',
        harnessReleaseId: 'r',
        now: TS,
        planId: 'plan-harness-1',
      }),
    /PlanCompiler is not bound/u,
  );

  const store = new MemoryMarketingPlanStore();
  harness.bindPlanCompiler(
    createProductionPlanCompiler({
      store,
      ports: createFixturePlanCompilerPorts(),
    }),
  );

  const compiled = await harness.compilePlan({
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    proposal: baseProposal(),
    intentRevision: 1,
    contextBundleId: 'b',
    contextRevision: '1',
    harnessReleaseId: 'r',
    now: TS,
    planId: 'plan-harness-1',
  });
  assert.equal(compiled.revision.revision, 1);

  const adjusted = await harness.adjustPlan({
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    existingPlanId: 'plan-harness-1',
    proposal: baseProposal(),
    patch: { summary: '减到 4 页', instructions: '减到 4 页' },
    intentRevision: 1,
    contextBundleId: 'b',
    contextRevision: '1',
    harnessReleaseId: 'r',
    now: TS,
  });
  assert.equal(adjusted.revision.revision, 2);
  assert.equal(adjusted.revision.deliverables[0]?.quantity, 4);

  const steered = await harness.revisePlanFromMerchantInstruction({
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    existingPlanId: 'plan-harness-1',
    proposal: baseProposal(),
    merchantInstruction: '改成更克制的口吻',
    intentRevision: 1,
    contextBundleId: 'b',
    contextRevision: '1',
    harnessReleaseId: 'r',
    now: TS,
  });
  assert.equal(steered.revision.revision, 3);
  assert.equal(steered.revision.expression.narrativeStructure, '改成更克制的口吻');
  assert.equal(harness.getPlanCompiler()?.unitRegistry.has('note.generate'), true);
});

test('A8: execution units use free unitType + optional six-primitive only', async () => {
  const store = new MemoryMarketingPlanStore();
  const { compiler, input } = compileInput(store, {
    planId: 'plan-a8-1',
    proposal: baseProposal({
      recommendedDeliverables: [
        { carrier: 'media', quantity: 1, purpose: '短视频' },
      ],
    }),
  });
  const result = await compiler.compile(input);
  for (const unit of result.executionPlan.units) {
    // unitType is registry string, not a domain carrier enum field on primitive.
    assert.equal(typeof unit.unitType, 'string');
    if (unit.primitive !== undefined) {
      assert.ok(
        [
          'read_context',
          'generate',
          'revise',
          'record',
          'check',
          'ask_merchant',
        ].includes(unit.primitive),
      );
    }
    // No carrier/kind domain enum smuggled onto the unit root beyond typed input.
    assert.equal('carrier' in unit, false);
    assert.equal('kind' in unit, false);
  }
});

test('note CompiledExecutionPlan carries the six primitive program with explicit prior-output dependencies', async () => {
  const store = new MemoryMarketingPlanStore();
  const { compiler, input } = compileInput(store, {
    planId: 'plan-six-primitives',
    proposal: baseProposal({
      recommendedDeliverables: [
        { carrier: 'note', quantity: 4, purpose: '四页笔记' },
      ],
    }),
  });

  const plan = (await compiler.compile(input)).executionPlan;
  // The repeatable "pages" step runs once per requested deliverable unit
  // (plan-compiler.ts ~:792-801), so quantity 4 expands into 4 generate
  // instances instead of one unit carrying a scalar quantity.
  assert.deepEqual(
    plan.units.map((unit) => unit.primitive),
    [
      'read_context',
      'generate',
      'ask_merchant',
      'generate',
      'generate',
      'generate',
      'generate',
      'check',
      'revise',
      'record',
    ],
  );
  // Dependency groups are the compiler's actual "explicit dependencies"
  // mechanism — units run group by group, and a group can hold more than one
  // unit (brief + style ask share one; all 4 expanded pages instances share
  // the execute group with check/revise). There is no separate per-unit
  // `priorOutputUnitIds` field on `input` (it does not exist anywhere in the
  // compiler or the ExecutionUnit contract); the executor threads prior
  // outputs at runtime off this group ordering (compiled-carrier-executor.ts
  // `priorOutputs`).
  assert.deepEqual(
    plan.dependencyGroups.map((group) => group.unitIds),
    [
      ['unit-note-context'],
      ['unit-note-brief', 'unit-note-style-ask'],
      [
        'unit-note-pages-1',
        'unit-note-pages-2',
        'unit-note-pages-3',
        'unit-note-pages-4',
        'unit-note-check',
        'unit-note-revise',
      ],
      ['unit-note-assemble'],
    ],
  );
  const pagesUnits = plan.units.filter((unit) =>
    unit.unitId.startsWith('unit-note-pages'),
  );
  assert.equal(pagesUnits.length, 4);
  for (const unit of pagesUnits) {
    assert.equal(
      (unit.input as { deliverables?: Array<{ quantity?: number }> })
        .deliverables?.[0]?.quantity,
      4,
    );
  }
});
