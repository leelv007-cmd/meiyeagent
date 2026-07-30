import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AdminConfigFoundationModule,
  HARNESS_WOZ_RECIPE_CONFIG_KEY,
  MemoryAdminConfigRepository,
} from '../admin-config/foundation-module.js';
import { MemoryContextBundleRepository } from '../operations/context-bundle-repository.js';
import { MemoryContextSourceRevisionRepository } from '../operations/context-source-revisions.js';
import { MemoryMarketingIdentityRepository } from '../operations/marketing-identity.js';
import {
  MemoryReuseMemoryRepository,
  ReuseMemoryService,
} from '../operations/reuse-memory-service.js';
import {
  type AppendStoreFactInput,
  MemoryStoreFactLedger,
} from '../operations/store-fact-ledger.js';
import { createCreationExecutionSnapshot } from '../execution-spine/creation-execution-snapshot.js';
import { SourceContentPackageUnavailableError } from '../execution-spine/source-content-package-resolver.js';
import {
  briefContextBundleSchema,
  type IntentDeclaration,
} from './structured-nodes.js';
import {
  HarnessSnapshotIdentityError,
  LedgerBackedFactRightsAuthorizationPort,
  LedgerBackedHarnessContextPort,
} from './production-context-port.js';
import { createHarnessCandidateValidator } from './policy-gates.js';

test('production fact rights re-resolve the frozen fact and rights head fail closed', async () => {
  const facts = new MemoryStoreFactLedger();
  const heads = new MemoryContextSourceRevisionRepository();
  const fact = await facts.append({
    workspaceId: 'workspace-1',
    factId: 'price-rights',
    kind: 'price',
    key: 'offer.price',
    value: 398,
    scope: { storeId: 'workspace-1' },
    source: {
      kind: 'user_confirmation',
      referenceId: 'decision-price',
      capturedAt: '2026-07-18T00:00:00.000Z',
    },
    effectiveFrom: '2026-07-18T00:00:00.000Z',
    expiresAt: null,
    expectedRevision: 0,
    recordedAt: '2026-07-18T00:00:00.000Z',
    recordedBy: 'owner-1',
  });
  const rights = new LedgerBackedFactRightsAuthorizationPort(
    facts,
    heads,
    () => '2026-07-18T00:01:00.000Z',
  );
  const frozenFact = {
    factId: fact.factId,
    kind: fact.kind,
    revision: fact.revision,
    source: fact.source,
    effectiveFrom: fact.effectiveFrom,
    expiresAt: fact.expiresAt,
  };

  assert.equal(
    await rights.isAuthorized({
      workspaceId: 'workspace-1',
      rightsRevision: 0,
      fact: frozenFact,
    }),
    true,
  );
  await heads.advance({
    workspaceId: 'workspace-1',
    key: 'rights',
    expectedRevision: 0,
  });
  assert.equal(
    await rights.isAuthorized({
      workspaceId: 'workspace-1',
      rightsRevision: 0,
      fact: frozenFact,
    }),
    false,
  );
  assert.equal(
    await rights.isAuthorized({
      workspaceId: 'workspace-other',
      rightsRevision: 1,
      fact: frozenFact,
    }),
    false,
  );
});

test('production context port freezes the real #32 bundle and fact references', async () => {
  const facts = new MemoryStoreFactLedger();
  await facts.append({
    workspaceId: 'workspace-1',
    factId: 'price-1',
    kind: 'price',
    key: 'group_buy_price',
    value: 398,
    scope: { storeId: 'workspace-1', serviceId: 'scalp-clean' },
    source: {
      kind: 'user_confirmation',
      referenceId: 'decision-1',
      capturedAt: '2026-07-18T00:00:00.000Z',
    },
    effectiveFrom: '2026-07-18T00:00:00.000Z',
    expiresAt: null,
    expectedRevision: 0,
    recordedAt: '2026-07-18T00:00:00.000Z',
    recordedBy: 'owner-1',
  });
  const bundles = new MemoryContextBundleRepository();
  const port = new LedgerBackedHarnessContextPort(
    facts,
    bundles,
    () => '2026-07-18T00:01:00.000Z',
  );
  const input = {
    workflowId: 'task-context-1',
    request: taskInput(),
    declaration: customizedDeclaration(
      'promotion_groupbuy_conversion',
      ['不得编造价格'],
    ),
  };

  const first = await port.compileAndFreeze(input);
  const replay = await port.compileAndFreeze(input);

  assert.deepEqual(replay, first);
  assert.equal(first.bundle.revision, 1);
  assert.equal(first.bundle.workspaceId, 'workspace-1');
  const firstFactsRevision = first.bundle.sourceRevisions.facts;
  assert.equal(typeof firstFactsRevision, 'string');
  assert.deepEqual(first.bundle.referencedFactRevisions, [
    { factId: 'price-1', revision: 1 },
  ]);
  assert.equal(briefContextBundleSchema.safeParse(first.bundle).success, true);
  assert.equal(
    first.bundle.dimensions.promotion_task.requested_intent?.value,
    '把新团购做一套能发的',
  );
  assert.deepEqual(first.policyReferences.sourceRefs, [
    {
      id: 'store_fact:price-1:1',
      workspaceId: 'workspace-1',
      revision: 1,
      status: 'current',
    },
    {
      id: 'decision:question-1:decision-1',
      workspaceId: 'workspace-1',
      revision: 1,
      status: 'current',
    },
  ]);
  const validation = createHarnessCandidateValidator({
    phase: 'execution',
    bundle: { workspaceId: 'workspace-1', revision: first.bundle.revision },
    brief: {},
    ...first.policyReferences,
  }).validate({
    candidateId: 'c01',
    workspaceId: 'workspace-1',
    intendedUse: 'public_content',
    factClaims: [
      {
        kind: 'price',
        value: '当前团购价 398 元',
        sourceRef: 'decision:question-1:decision-1',
      },
    ],
    assetRefs: [],
  });
  assert.equal(validation.passed, true);

  await facts.append({
    workspaceId: 'workspace-1',
    factId: 'price-1',
    kind: 'price',
    key: 'group_buy_price',
    value: 368,
    scope: { storeId: 'workspace-1', serviceId: 'scalp-clean' },
    source: {
      kind: 'user_confirmation',
      referenceId: 'decision-2',
      capturedAt: '2026-07-18T00:02:00.000Z',
    },
    effectiveFrom: '2026-07-18T00:00:00.000Z',
    expiresAt: null,
    expectedRevision: 1,
    recordedAt: '2026-07-18T00:02:00.000Z',
    recordedBy: 'owner-1',
  });
  const recompiled = await port.fence({ ...input, context: first });
  assert.equal(recompiled.bundle.revision, 2);
  assert.equal(recompiled.bundle.previousRevision, 1);
  assert.notEqual(recompiled.bundle.sourceRevisions.facts, firstFactsRevision);
  assert.deepEqual(recompiled.bundle.referencedFactRevisions, [
    { factId: 'price-1', revision: 2 },
  ]);
});

test('a confirmed merchant preference is consumed by the next context bundle', async () => {
  const memory = new ReuseMemoryService(
    new MemoryReuseMemoryRepository(),
    { async verifyCandidate() {}, async verifyRevision() {} },
    () => '2026-07-30T06:30:00.000Z',
  );
  await memory.proposePreference({
    candidateId: 'candidate-tone',
    workspaceId: 'workspace-1',
    semanticKey: 'tone.default',
    proposedValue: '克制、像熟客分享',
    defaultScope: { storeId: 'workspace-1' },
    evidenceDecisionIds: ['decision-tone'],
    evidenceTaskIds: ['task-tone'],
    trigger: 'explicit_long_term_intent',
    status: 'pending',
    proposedAt: '2026-07-30T06:20:00.000Z',
    source: {
      conversationId: 'conversation-tone',
      sourceTurnId: 'turn-tone',
      messageRange: { start: 0, end: 1 },
    },
  });
  await memory.confirmPreference(
    { workspaceId: 'workspace-1', userId: 'owner-1' },
    {
      candidateId: 'candidate-tone',
      preferenceId: 'preference-tone',
      expectedRevision: 0,
      positiveExamples: [],
      negativeExamples: [],
      idempotencyKey: 'confirm-tone',
    },
  );
  await memory.proposePreference({
    candidateId: 'candidate-tone-latest',
    workspaceId: 'workspace-1',
    semanticKey: 'tone.default',
    proposedValue: '更克制、避免夸张',
    defaultScope: { storeId: 'workspace-1' },
    evidenceDecisionIds: ['decision-tone-latest'],
    evidenceTaskIds: ['task-tone-latest'],
    trigger: 'explicit_long_term_intent',
    status: 'pending',
    proposedAt: '2026-07-30T06:22:00.000Z',
    source: {
      conversationId: 'conversation-tone',
      sourceTurnId: 'turn-tone',
      messageRange: { start: 0, end: 1 },
    },
  });
  await memory.confirmPreference(
    { workspaceId: 'workspace-1', userId: 'owner-1' },
    {
      candidateId: 'candidate-tone-latest',
      preferenceId: 'preference-tone-z',
      expectedRevision: 0,
      positiveExamples: [],
      negativeExamples: [],
      idempotencyKey: 'confirm-tone-latest',
    },
  );
  for (const candidate of [
    {
      candidateId: 'candidate-rejected',
      semanticKey: 'voice.rejected',
      proposedValue: '夸张',
      storeId: 'workspace-1',
    },
    {
      candidateId: 'candidate-deleted',
      semanticKey: 'voice.deleted',
      proposedValue: '已删除',
      storeId: 'workspace-1',
    },
    {
      candidateId: 'candidate-other-store',
      semanticKey: 'voice.other_store',
      proposedValue: '其他门店',
      storeId: 'workspace-other',
    },
  ]) {
    await memory.proposePreference({
      candidateId: candidate.candidateId,
      workspaceId: 'workspace-1',
      semanticKey: candidate.semanticKey,
      proposedValue: candidate.proposedValue,
      defaultScope: { storeId: candidate.storeId },
      evidenceDecisionIds: [`decision-${candidate.candidateId}`],
      evidenceTaskIds: [`task-${candidate.candidateId}`],
      trigger: 'explicit_long_term_intent',
      status: 'pending',
      proposedAt: '2026-07-30T06:21:00.000Z',
      source: {
        conversationId: 'conversation-tone',
        sourceTurnId: 'turn-tone',
        messageRange: { start: 0, end: 1 },
      },
    });
  }
  await memory.rejectPreferenceCandidate(
    { workspaceId: 'workspace-1', userId: 'owner-1' },
    {
      candidateId: 'candidate-rejected',
      reason: 'Not representative.',
      idempotencyKey: 'reject-candidate',
    },
  );
  for (const candidateId of [
    'candidate-deleted',
    'candidate-other-store',
  ]) {
    await memory.confirmPreference(
      { workspaceId: 'workspace-1', userId: 'owner-1' },
      {
        candidateId,
        preferenceId: `preference-${candidateId}`,
        expectedRevision: 0,
        positiveExamples: [],
        negativeExamples: [],
        idempotencyKey: `confirm-${candidateId}`,
      },
    );
  }
  await memory.deleteMemoryEntry(
    { workspaceId: 'workspace-1', userId: 'owner-1' },
    'candidate-deleted',
  );
  const port = new LedgerBackedHarnessContextPort(
    new MemoryStoreFactLedger(),
    new MemoryContextBundleRepository(),
    () => '2026-07-30T06:31:00.000Z',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    memory,
  );

  const context = await port.compileAndFreeze({
    workflowId: 'task-after-confirmation',
    request: taskInput(),
    declaration: customizedDeclaration('brand_personal_ip'),
  });

  assert.deepEqual(
    context.bundle.dimensions.expression_identity.preference_tone_default,
    {
      value: '更克制、避免夸张',
      layer: 'confirmed_preference',
      pool: 'store_personal',
      sourceRef: 'preference:preference-tone-z:r1',
    },
  );
  assert.notEqual(context.bundle.sourceRevisions.preferences, 0);
  assert.equal(
    context.bundle.dimensions.expression_identity.preference_voice_rejected,
    undefined,
  );
  assert.equal(
    context.bundle.dimensions.expression_identity.preference_voice_deleted,
    undefined,
  );
  assert.equal(
    context.bundle.dimensions.expression_identity.preference_voice_other_store,
    undefined,
  );
});

test('production context fence recompiles when the applied recipe revision changes', async () => {
  const repository = new MemoryAdminConfigRepository();
  const admin = new AdminConfigFoundationModule(repository);
  const adminContext = {
    actor: 'owner' as const,
    correlationId: 'recipe-fence',
    userId: 'owner-1',
    workspaceId: 'workspace-1',
  };
  const applyRecipe = (value: unknown, expectedRevision: number | null) =>
    admin.execute({
      context: adminContext,
      input: {
        action: 'config_apply',
        payload: {
          key: HARNESS_WOZ_RECIPE_CONFIG_KEY,
          value,
          expectedRevision,
          reason: 'update WOZ recipe',
        },
      },
    });
  const port = new LedgerBackedHarnessContextPort(
    new MemoryStoreFactLedger(),
    new MemoryContextBundleRepository(),
    () => '2026-07-18T03:00:00.000Z',
    undefined,
    async (workspaceId) =>
      (
        await repository.get(
          'workspace',
          workspaceId,
          HARNESS_WOZ_RECIPE_CONFIG_KEY,
        )
      )?.revision ?? 0,
  );
  const input = {
    workflowId: 'task-recipe-fence',
    request: taskInput(),
    declaration: customizedDeclaration('promotion_groupbuy_conversion'),
  };

  await applyRecipe({ markdown: 'recipe v1' }, null);
  const first = await port.compileAndFreeze(input);
  assert.equal(first.bundle.sourceRevisions.recipe, 1);
  await applyRecipe({ markdown: 'recipe v2' }, 1);

  const recompiled = await port.fence({ ...input, context: first });
  assert.equal(recompiled.bundle.revision, 2);
  assert.equal(recompiled.bundle.previousRevision, 1);
  assert.equal(recompiled.bundle.sourceRevisions.recipe, 2);
});

test('production context fence drops an expired price without dropping the service', async () => {
  const facts = new MemoryStoreFactLedger();
  const factInputs: Array<
    Pick<
      AppendStoreFactInput,
      'factId' | 'kind' | 'key' | 'value' | 'expiresAt'
    >
  > = [
    {
      factId: 'limited-price',
      kind: 'price' as const,
      key: 'offer.price',
      value: { amount: 199, currency: 'CNY' },
      expiresAt: '2026-07-18T02:00:00.000Z',
    },
    {
      factId: 'service-name',
      kind: 'service' as const,
      key: 'service.name',
      value: { name: '头皮舒缓护理' },
      expiresAt: null,
    },
  ];
  for (const input of factInputs) {
    await facts.append({
      ...input,
      workspaceId: 'workspace-1',
      scope: { storeId: 'workspace-1' },
      source: {
        kind: 'user_confirmation',
        referenceId: `decision-${input.factId}`,
        capturedAt: '2026-07-18T00:00:00.000Z',
      },
      effectiveFrom: '2026-07-18T00:00:00.000Z',
      expectedRevision: 0,
      recordedAt: '2026-07-18T00:00:00.000Z',
      recordedBy: 'owner-1',
    });
  }
  let now = '2026-07-18T01:00:00.000Z';
  const port = new LedgerBackedHarnessContextPort(
    facts,
    new MemoryContextBundleRepository(),
    () => now,
  );
  const input = {
    workflowId: 'task-price-window',
    request: taskInput(),
    declaration: customizedDeclaration('promotion_groupbuy_conversion'),
  };

  const inside = await port.compileAndFreeze(input);
  assert.deepEqual(inside.bundle.referencedFactRevisions, [
    { factId: 'limited-price', revision: 1 },
    { factId: 'service-name', revision: 1 },
  ]);

  now = '2026-07-18T02:00:00.001Z';
  const outside = await port.fence({ ...input, context: inside });
  assert.equal(outside.bundle.revision, 2);
  assert.equal(outside.bundle.previousRevision, 1);
  assert.deepEqual(outside.bundle.referencedFactRevisions, [
    { factId: 'service-name', revision: 1 },
  ]);
});

test('production context preserves pre-fold references for same-scope fact conflicts', async () => {
  const facts = new MemoryStoreFactLedger();
  for (const [factId, amount] of [
    ['price-old', 199],
    ['price-new', 239],
  ] as const) {
    await facts.append({
      workspaceId: 'workspace-1',
      factId,
      kind: 'price',
      key: 'offer.price',
      value: { amount, currency: 'CNY' },
      scope: { storeId: 'workspace-1', serviceId: 'scalp-clean' },
      source: {
        kind: 'user_confirmation',
        referenceId: `decision-${factId}`,
        capturedAt: '2026-07-18T00:00:00.000Z',
      },
      effectiveFrom: '2026-07-18T00:00:00.000Z',
      expiresAt: null,
      expectedRevision: 0,
      recordedAt: '2026-07-18T00:00:00.000Z',
      recordedBy: 'owner-1',
    });
  }
  const snapshot = await new LedgerBackedHarnessContextPort(
    facts,
    new MemoryContextBundleRepository(),
    () => '2026-07-18T00:01:00.000Z',
  ).compileAndFreeze({
    workflowId: 'task-conflicting-facts',
    request: taskInput(),
    declaration: customizedDeclaration(
      'promotion_groupbuy_conversion',
      ['价格必须唯一'],
    ),
  });

  assert.equal(
    Object.keys(snapshot.bundle.dimensions.store_facts_assets).length,
    1,
  );
  assert.deepEqual(snapshot.activeFactReferences, [
    { key: 'offer.price', sourceRef: 'store_fact:price-new:1' },
    { key: 'offer.price', sourceRef: 'store_fact:price-old:1' },
  ]);
});

test('a decision accepted after the preflight freeze creates a new exact bundle revision', async () => {
  const bundles = new MemoryContextBundleRepository();
  const port = new LedgerBackedHarnessContextPort(
    new MemoryStoreFactLedger(),
    bundles,
    () => '2026-07-18T00:01:00.000Z',
  );
  const { decisionReferences: _decisions, ...requestWithoutDecision } =
    taskInput();
  const input = {
    workflowId: 'task-decision-refreeze',
    request: requestWithoutDecision,
    declaration: customizedDeclaration('promotion_groupbuy_conversion'),
  };
  const preflight = await port.compileAndFreeze(input);
  assert.equal(preflight.bundle.revision, 1);

  // Simulate a suspended workflow resuming after process-local state is lost.
  const decided = await port.compileAndFreeze({
    ...input,
    request: { ...requestWithoutDecision, decisionReferences: taskInput().decisionReferences },
  });

  assert.equal(decided.bundle.revision, 2);
  assert.equal(decided.bundle.previousRevision, 1);
  assert.equal(
    decided.bundle.dimensions.promotion_task.confirmed_intent?.sourceRef,
    'decision:question-1:decision-1',
  );
  assert.deepEqual(
    (await bundles.history('workspace-1', 'context-task-decision-refreeze')).map(
      (bundle) => bundle.revision,
    ),
    [1, 2],
  );
});

test('production context fence compares every mutable source head and carries reuse structure only', async () => {
  const facts = new MemoryStoreFactLedger();
  const bundles = new MemoryContextBundleRepository();
  const heads = new MemoryContextSourceRevisionRepository();
  await heads.advance({
    workspaceId: 'workspace-1',
    key: 'assets',
    expectedRevision: 0,
  });
  const seed = {
    assetId: 'series-a',
    assetRevision: 1,
    sourcePackageId: 'package-source',
    sourceVersionId: 'version-source',
    sourcePackageRevision: 2,
    assetRevisionId: 'series-a:1',
    fixedItemKeys: ['structure.three-part'],
    variableSlotKeys: ['offer.price'],
  };
  const port = new LedgerBackedHarnessContextPort(
    facts,
    bundles,
    () => '2026-07-18T00:01:00.000Z',
    heads,
    undefined,
    {
      async verifyReuseTaskSeed() {
        return {
          assetId: 'series-a',
          revisionId: 'series-a:1',
          candidateId: 'candidate-a',
          revision: 1,
          workspaceId: 'workspace-1',
          kind: 'series' as const,
          name: '三段式系列',
          fixedItems: [
            {
              key: 'structure.three-part',
              value: ['experience', 'evidence', 'cta'],
              sourceRef: 'package-source:version-source',
            },
          ],
          variableSlots: [
            {
              key: 'offer.price',
              source: 'current_fact' as const,
              required: true,
            },
          ],
          defaultScope: { storeId: 'workspace-1' },
          finalScope: { storeId: 'workspace-1' },
          scopeDecision: {
            mode: 'accepted_default' as const,
            decisionId: 'decision-a',
            decidedBy: 'owner-1',
            decidedAt: '2026-07-18T00:00:00.000Z',
          },
          provenance: {
            sourcePackageId: 'package-source',
            sourceVersionId: 'version-source',
            sourcePackageRevision: 2,
            contextBundleId: 'bundle-source',
            contextBundleRevision: 1,
          },
          rights: { assetIds: ['asset-a'], status: 'authorized' as const },
          nextSuggestions: [],
          createdAt: '2026-07-18T00:00:00.000Z',
          createdBy: 'owner-1',
        };
      },
    },
    {
      async resolve({ assetIds }) {
        assert.deepEqual(assetIds, ['asset-current']);
        return {
          knownAssetIds: ['asset-current'],
          unauthorizedAssetIds: [],
        };
      },
    },
  );
  const baseTask = taskInput();
  const input = {
    workflowId: 'task-reuse-context',
    request: {
      ...baseTask,
      reuseSeed: seed,
      intent: { ...baseTask.intent, assetReferences: ['asset-current'] },
    },
    declaration: customizedDeclaration('promotion_groupbuy_conversion'),
  };
  const first = await port.compileAndFreeze(input);
  assert.equal(first.bundle.sourceRevisions.assets, 1);
  assert.deepEqual(
    first.bundle.dimensions.promotion_task['reuse_structure.three-part']?.value,
    ['experience', 'evidence', 'cta'],
  );
  assert.equal('body' in first.bundle.dimensions.promotion_task, false);
  assert.deepEqual(first.policyReferences.rightsRefs, [
    {
      assetId: 'asset-current',
      workspaceId: 'workspace-1',
      status: 'authorized',
      allowedUses: ['public_content'],
    },
  ]);

  await heads.advance({
    workspaceId: 'workspace-1',
    key: 'rights',
    expectedRevision: 0,
  });
  const fenced = await port.fence({ ...input, context: first });
  assert.equal(fenced.bundle.revision, 2);
  assert.equal(fenced.bundle.sourceRevisions.rights, 1);
});

test('production context rejects forged free-form copy in reusable fixed items', async () => {
  const port = new LedgerBackedHarnessContextPort(
    new MemoryStoreFactLedger(),
    new MemoryContextBundleRepository(),
    () => '2026-07-18T00:01:00.000Z',
    undefined,
    undefined,
    {
      async verifyReuseTaskSeed() {
        return {
          assetId: 'series-a',
          revisionId: 'series-a:1',
          candidateId: 'candidate-a',
          revision: 1,
          workspaceId: 'workspace-1',
          kind: 'series' as const,
          name: 'forged series',
          fixedItems: [
            {
              key: 'structure.body',
              value: '旧正文，旧价格 199，顾客张三，7月18日活动',
              sourceRef: 'package-source:version-source',
            },
          ],
          variableSlots: [
            { key: 'offer.price', source: 'current_fact' as const, required: true },
          ],
          defaultScope: { storeId: 'workspace-1' },
          finalScope: { storeId: 'workspace-1' },
          scopeDecision: {
            mode: 'accepted_default' as const,
            decisionId: 'decision-a',
            decidedBy: 'owner-1',
            decidedAt: '2026-07-18T00:00:00.000Z',
          },
          provenance: {
            sourcePackageId: 'package-source',
            sourceVersionId: 'version-source',
            sourcePackageRevision: 2,
            contextBundleId: 'bundle-source',
            contextBundleRevision: 1,
          },
          rights: { assetIds: [], status: 'authorized' as const },
          nextSuggestions: [],
          createdAt: '2026-07-18T00:00:00.000Z',
          createdBy: 'owner-1',
        } as never;
      },
    },
  );
  const request = taskInput();
  await assert.rejects(
    port.compileAndFreeze({
      workflowId: 'task-forged-reuse',
      request: {
        ...request,
        reuseSeed: {
          assetId: 'series-a',
          assetRevision: 1,
          sourcePackageId: 'package-source',
          sourceVersionId: 'version-source',
          sourcePackageRevision: 2,
          assetRevisionId: 'series-a:1',
          fixedItemKeys: ['structure.body'],
          variableSlotKeys: ['offer.price'],
        },
      },
      declaration: customizedDeclaration('promotion_groupbuy_conversion'),
    }),
  );
});

test('production context hydrates complete active brand and person identities for generation', async () => {
  const identities = new MemoryMarketingIdentityRepository();
  await identities.register({
    workspaceId: 'workspace-1',
    actorId: 'owner-1',
    occurredAt: '2026-07-18T00:00:00.000Z',
    command: {
      identityId: 'brand-1',
      kind: 'brand',
      expectedVersion: 0,
      displayName: '门店官方',
      owner: '门店',
      professionalBoundaries: ['只表达已核验项目与品牌主张'],
      allowedPlatforms: ['xiaohongshu'],
      allowedScenes: ['brand_personal_ip'],
      expressionSamples: ['用专业和克制的方式说明项目价值。'],
      effectiveFrom: '2026-07-18T00:00:00.000Z',
      expiresAt: null,
      departureHandling: '品牌停用后停止生成新内容。',
      sourceRef: 'brand-policy-1',
      fieldProvenance: {
        displayName: 'ai_suggestion',
        sourceRef: 'user',
        allowedPlatforms: 'user',
        allowedScenes: 'user',
        portraitAuthorization: 'user',
        voiceAuthorization: 'user',
      },
      brandClaims: ['专注染发与护发'],
      forbiddenClaims: ['疗效保证'],
      visualPrinciples: ['真实发丝细节'],
      seriesAnchors: ['发色选择指南'],
    },
  });
  await identities.register({
    workspaceId: 'workspace-1',
    actorId: 'owner-1',
    occurredAt: '2026-07-18T00:00:00.000Z',
    command: {
      identityId: 'person-1',
      kind: 'person',
      expectedVersion: 0,
      displayName: '小林老师',
      owner: '林晓',
      professionalBoundaries: ['只分享真实从业经验'],
      allowedPlatforms: ['xiaohongshu'],
      allowedScenes: ['brand_personal_ip'],
      expressionSamples: ['先判断发质，再讨论适合的发色。'],
      effectiveFrom: '2026-07-18T00:00:00.000Z',
      expiresAt: null,
      departureHandling: '离职后停止生成新内容。',
      sourceRef: 'person-authorization-1',
      realWorldRole: '染发师',
      portraitAuthorization: 'authorized',
      voiceAuthorization: 'not_authorized',
      historicalContentPermission: 'review_required',
    },
  });
  const port = new LedgerBackedHarnessContextPort(
    new MemoryStoreFactLedger(),
    new MemoryContextBundleRepository(),
    () => '2026-07-18T00:01:00.000Z',
    undefined,
    undefined,
    undefined,
    undefined,
    identities,
  );
  const snapshot = await port.compileAndFreeze({
    workflowId: 'task-brand-identity',
    request: taskInput(),
    declaration: customizedDeclaration('brand_personal_ip'),
  });

  assert.deepEqual(snapshot.policyReferences.identityRefs, [
    {
      id: 'marketing_identity:brand-1:1',
      workspaceId: 'workspace-1',
      status: 'registered',
    },
    {
      id: 'marketing_identity:person-1:1',
      workspaceId: 'workspace-1',
      status: 'registered',
    },
  ]);
  assert.deepEqual(
    snapshot.bundle.dimensions.expression_identity['identity_brand-1']?.value,
    {
      identityId: 'brand-1',
      kind: 'brand',
      version: 1,
      displayName: '门店官方',
      professionalBoundaries: ['只表达已核验项目与品牌主张'],
      allowedPlatforms: ['xiaohongshu'],
      allowedScenes: ['brand_personal_ip'],
      expressionSamples: ['用专业和克制的方式说明项目价值。'],
      brandClaims: ['专注染发与护发'],
      forbiddenClaims: ['疗效保证'],
      visualPrinciples: ['真实发丝细节'],
      seriesAnchors: ['发色选择指南'],
      fieldProvenance: {
        displayName: 'ai_suggestion',
        sourceRef: 'user',
        allowedPlatforms: 'user',
        allowedScenes: 'user',
        portraitAuthorization: 'user',
        voiceAuthorization: 'user',
      },
    },
  );
  assert.deepEqual(
    snapshot.bundle.dimensions.expression_identity['identity_person-1']
      ?.value,
    {
      identityId: 'person-1',
      kind: 'person',
      version: 1,
      displayName: '小林老师',
      professionalBoundaries: ['只分享真实从业经验'],
      allowedPlatforms: ['xiaohongshu'],
      allowedScenes: ['brand_personal_ip'],
      expressionSamples: ['先判断发质，再讨论适合的发色。'],
      fieldProvenance: null,
      realWorldRole: '染发师',
      portraitAuthorization: 'authorized',
      voiceAuthorization: 'not_authorized',
      historicalContentPermission: 'review_required',
    },
  );
});

test('Composer context binds only its frozen identity revision', async () => {
  const identities = new MemoryMarketingIdentityRepository();
  await registerBrandIdentity(identities, 'identity-target', '目标身份');
  await registerBrandIdentity(identities, 'identity-other', '其他身份');
  const port = new LedgerBackedHarnessContextPort(
    new MemoryStoreFactLedger(),
    new MemoryContextBundleRepository(),
    () => '2026-07-22T09:01:00.000Z',
    undefined,
    undefined,
    undefined,
    undefined,
    identities,
  );
  const snapshot = composerSnapshot('task-snapshot-identity', 'identity-target', '1');
  const request = composerRequest(snapshot);

  const context = await port.compileAndFreeze({
    workflowId: snapshot.task.id,
    request,
    declaration: customizedDeclaration('brand_personal_ip'),
  });

  assert.deepEqual(context.policyReferences.identityRefs, [
    {
      id: 'marketing_identity:identity-target:1',
      workspaceId: 'workspace-1',
      status: 'registered',
    },
  ]);
  assert.deepEqual(
    Object.keys(context.bundle.dimensions.expression_identity),
    ['identity_identity-target'],
  );

  const forgedContext = structuredClone(context);
  const targetIdentity =
    forgedContext.bundle.dimensions.expression_identity['identity_identity-target'];
  if (!targetIdentity) throw new Error('Expected the frozen target identity.');
  forgedContext.bundle.dimensions.expression_identity['identity_identity-other'] = {
    ...targetIdentity,
    sourceRef: 'marketing_identity:identity-other:1',
  };
  await assert.rejects(
    port.fence({
      workflowId: snapshot.task.id,
      request,
      declaration: customizedDeclaration('brand_personal_ip'),
      context: forgedContext,
    }),
    HarnessSnapshotIdentityError,
  );

  const unavailableSnapshot = composerSnapshot(
    'task-snapshot-identity-missing',
    'identity-target',
    '2',
  );
  await assert.rejects(
    port.compileAndFreeze({
      workflowId: unavailableSnapshot.task.id,
      request: composerRequest(unavailableSnapshot),
      declaration: customizedDeclaration('brand_personal_ip'),
    }),
    HarnessSnapshotIdentityError,
  );
});

test('Composer context carries safe source-package metadata and fences it again', async () => {
  const identities = new MemoryMarketingIdentityRepository();
  await registerBrandIdentity(identities, 'identity-source', '来源内容身份');
  let available = true;
  const source = { id: 'source-package-1', revision: '3' };
  const port = new LedgerBackedHarnessContextPort(
    new MemoryStoreFactLedger(),
    new MemoryContextBundleRepository(),
    () => '2026-07-22T09:01:00.000Z',
    undefined,
    undefined,
    undefined,
    {
      async resolve({ assetIds }) {
        return { knownAssetIds: assetIds, unauthorizedAssetIds: [] };
      },
    },
    identities,
    {
      async resolve() {
        if (!available) throw new SourceContentPackageUnavailableError(source);
        return {
          reference: source,
          structure: {
            slots: ['headline', 'body', 'conversion_hook'],
          },
          style: { kind: 'image_text' as const, sourcePlatform: 'xiaohongshu' as const },
          assets: [
            { id: 'source-asset-1', role: 'source' as const },
            { id: 'selected-asset-1', role: 'selected' as const },
          ],
        };
      },
    },
  );
  const snapshot = composerSnapshot(
    'task-source-package',
    'identity-source',
    '1',
    source,
  );
  const input = {
    workflowId: snapshot.task.id,
    request: composerRequest(snapshot),
    declaration: customizedDeclaration('brand_personal_ip'),
  };

  const context = await port.compileAndFreeze(input);

  assert.deepEqual(
    context.bundle.dimensions.store_facts_assets.source_content_package_structure,
    {
      value: {
        packageId: 'source-package-1',
        revision: '3',
        slots: ['headline', 'body', 'conversion_hook'],
      },
      layer: 'current_instruction',
      pool: 'current_signal',
      sourceRef: 'content_package:source-package-1:3',
    },
  );
  assert.deepEqual(
    context.bundle.dimensions.store_facts_assets.source_content_package_assets?.value,
    {
      packageId: 'source-package-1',
      revision: '3',
      assets: [
        { id: 'selected-asset-1', role: 'selected' },
      ],
    },
  );
  assert.deepEqual(
    context.bundle.dimensions.platform_mechanism.source_content_package_style?.value,
    {
      packageId: 'source-package-1',
      revision: '3',
      kind: 'image_text',
      sourcePlatform: 'xiaohongshu',
    },
  );
  assert.deepEqual(context.policyReferences.rightsRefs, [
    {
      assetId: 'selected-asset-1',
      workspaceId: 'workspace-1',
      status: 'authorized',
      allowedUses: ['public_content'],
    },
  ]);

  available = false;
  await assert.rejects(
    port.fence({ ...input, context }),
    SourceContentPackageUnavailableError,
  );
});

test('Composer context does not self-authorize a selected source-package asset', async () => {
  const identities = new MemoryMarketingIdentityRepository();
  await registerBrandIdentity(identities, 'identity-source-rights', '来源素材身份');
  const source = { id: 'source-package-1', revision: '3' };
  const port = new LedgerBackedHarnessContextPort(
    new MemoryStoreFactLedger(),
    new MemoryContextBundleRepository(),
    () => '2026-07-22T09:01:00.000Z',
    undefined,
    undefined,
    undefined,
    {
      async resolve({ assetIds }) {
        assert.deepEqual(assetIds, ['selected-asset-1']);
        return {
          knownAssetIds: ['selected-asset-1'],
          unauthorizedAssetIds: ['selected-asset-1'],
        };
      },
    },
    identities,
    {
      async resolve() {
        return {
          reference: source,
          structure: { slots: ['headline', 'body'] },
          style: { kind: 'image_text' as const, sourcePlatform: 'douyin' as const },
          assets: [{ id: 'selected-asset-1', role: 'selected' as const }],
        };
      },
    },
  );
  const snapshot = composerSnapshot(
    'task-source-package-rights',
    'identity-source-rights',
    '1',
    source,
  );

  const context = await port.compileAndFreeze({
    workflowId: snapshot.task.id,
    request: composerRequest(snapshot),
    declaration: customizedDeclaration('brand_personal_ip'),
  });

  assert.deepEqual(context.policyReferences.rightsRefs, [
    {
      assetId: 'selected-asset-1',
      workspaceId: 'workspace-1',
      status: 'unknown',
      allowedUses: [],
    },
  ]);
});

function taskInput() {
  return {
    actorId: 'owner-1',
    workspaceId: 'workspace-1',
    packageId: 'package-1',
    expectedRevision: 0,
    workflowRevision: 1,
    creationMode: 'customized' as const,
    rawInput: '把新团购做一套能发的',
    factScope: { storeId: 'workspace-1', serviceId: 'scalp-clean' },
    intent: {
      context: {
        workId: 'work-1',
        intent: '把新团购做一套能发的',
        sourceSummaries: [],
      },
      assetReferences: [],
    },
    decisionReferences: [
      {
        id: 'decision:question-1:decision-1',
        field: 'intent' as const,
        value: '当前团购价 398 元',
        revision: 1,
      },
    ],
  };
}

function customizedDeclaration(
  taskType: IntentDeclaration['taskType'],
  implicitConstraints: string[] = [],
): IntentDeclaration {
  const category =
    taskType === 'brand_personal_ip'
      ? ('personal_ip' as const)
      : ('promotion_activity' as const);
  return {
    normalizedIntent: '完成本次美业内容创作',
    taskType,
    deliveryLayer: 'copy',
    relevantAssetCategories: [category],
    usedAssetCategories: [category],
    route: 'customized',
    routingSource: 'model',
    implicitConstraints,
  };
}

function composerSnapshot(
  taskId: string,
  identityId: string,
  identityRevision: string,
  sourceContentPackage?: { id: string; revision: string },
) {
  return createCreationExecutionSnapshot(
    {
      actorId: 'owner-1',
      briefConfirmation: { id: 'brief-1', revision: 'brief-r1' },
      briefContext: { id: 'brief-context-1', revision: 1 },
      catalogModel: { id: 'model-1', revision: 'model-r1' },
      contentModules: ['social_cover'],
      contentPackageId: `package-${taskId}`,
      deliverables: [
        { id: 'copy-main', kind: 'copy', order: 0, quantity: 1 },
      ],
      expectedContentPackageRevision: 0,
      identity: { id: identityId, revision: identityRevision },
      idempotencyKey: `submission-${taskId}`,
      creationMode: 'customized',
      intent: '写一条预约文案',
      lens: 'copy',
      modelPolicy: { id: 'policy-1', mode: 'fixed', revision: 'policy-r1' },
      platform: { id: 'douyin' },
      quote: { id: 'quote-1', revision: 'quote-r1' },
      recipe: { id: 'recipe-1', revision: 'recipe-r1' },
      rights: { revision: 'rights-r1', summary: 'authorized source assets' },
      route: { id: 'route-1', revision: 'route-r1' },
      sources: {
        assets: [],
        ...(sourceContentPackage ? { contentPackage: sourceContentPackage } : {}),
      },
      surface: { id: 'surface-1', revision: 'surface-r1' },
      taskId,
      workId: `work-${taskId}`,
      workspaceId: 'workspace-1',
    },
    '2026-07-22T09:00:00.000Z',
  );
}

function composerRequest(
  snapshot: ReturnType<typeof composerSnapshot>,
) {
  return {
    actorId: snapshot.actorId,
    workspaceId: snapshot.workspaceId,
    packageId: snapshot.contentPackage.id,
    expectedRevision: snapshot.contentPackage.expectedRevision,
    workflowRevision: snapshot.revision,
    creationMode: snapshot.creationMode,
    rawInput: snapshot.intent.text,
    factScope: { storeId: snapshot.workspaceId },
    intent: {
      context: {
        workId: snapshot.work.id,
        intent: snapshot.intent.text,
        sourceSummaries: [],
      },
      assetReferences: [],
    },
    executionSnapshot: snapshot,
  };
}

async function registerBrandIdentity(
  identities: MemoryMarketingIdentityRepository,
  identityId: string,
  displayName: string,
) {
  await identities.register({
    workspaceId: 'workspace-1',
    actorId: 'owner-1',
    occurredAt: '2026-07-22T09:00:00.000Z',
    command: {
      identityId,
      kind: 'brand',
      expectedVersion: 0,
      displayName,
      owner: '门店',
      professionalBoundaries: ['只表达已核验项目与品牌主张'],
      allowedPlatforms: ['douyin'],
      allowedScenes: ['brand_personal_ip'],
      expressionSamples: ['以专业克制的方式说明项目价值。'],
      effectiveFrom: '2026-07-22T09:00:00.000Z',
      expiresAt: null,
      departureHandling: '品牌停用后停止生成新内容。',
      sourceRef: `${identityId}-policy`,
      brandClaims: ['专业护理服务'],
      forbiddenClaims: ['疗效保证'],
      visualPrinciples: ['真实服务细节'],
      seriesAnchors: ['门店护理指南'],
    },
  });
}
