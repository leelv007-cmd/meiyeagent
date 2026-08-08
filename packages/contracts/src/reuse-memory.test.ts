import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assetRevisionSchema,
  confirmMemoryCandidateCommandSchema,
  deleteMemoryEntryCommandSchema,
  memoryEntriesPageQuerySchema,
  memoryTaskSourceConversationId,
  preferenceCandidateSchema,
  preferenceSignalSchema,
  preferenceSchema,
  rejectMemoryCandidateCommandSchema,
  reuseTaskSeedSchema,
  sourcedPreferenceCandidateSchema,
} from './reuse-memory.js';

test('current-task memory source conversation id is shared by Core and Web', () => {
  assert.equal(
    memoryTaskSourceConversationId('work-current', 'task-current'),
    'work-current:task-current',
  );
});

test('memory entry queries are strictly bounded and have no all-items semantic', () => {
  assert.deepEqual(memoryEntriesPageQuerySchema.parse({}), { limit: 20 });
  assert.deepEqual(memoryEntriesPageQuerySchema.parse({ limit: 50 }), {
    limit: 50,
  });
  for (const input of [
    { limit: 0 },
    { limit: 51 },
    { all: true },
    { includeAll: true },
    { cursor: '' },
    { cursor: 'x'.repeat(513) },
  ]) {
    assert.throws(() => memoryEntriesPageQuerySchema.parse(input));
  }
  assert.deepEqual(deleteMemoryEntryCommandSchema.parse({ entryId: 'entry-a' }), {
    entryId: 'entry-a',
  });
  assert.throws(() =>
    deleteMemoryEntryCommandSchema.parse({ entryId: 'entry-a', all: true }),
  );
  assert.deepEqual(
    confirmMemoryCandidateCommandSchema.parse({ entryId: 'entry-a' }),
    {
      entryId: 'entry-a',
      positiveExamples: [],
      negativeExamples: [],
    },
  );
  assert.deepEqual(
    rejectMemoryCandidateCommandSchema.parse({
      entryId: 'entry-a',
      reason: 'Not representative.',
    }),
    { entryId: 'entry-a', reason: 'Not representative.' },
  );
});

test('reuse task seeds carry provenance and structure but reject copied deliverable content', () => {
  const seed = {
    assetId: 'asset-series-a',
    assetRevision: 2,
    sourcePackageId: 'package-a',
    sourceVersionId: 'version-a',
    sourcePackageRevision: 3,
    assetRevisionId: 'asset-revision-a',
    fixedItemKeys: ['structure.three-part'],
    variableSlotKeys: ['offer.price', 'service.name'],
  };
  assert.deepEqual(reuseTaskSeedSchema.parse(seed), seed);
  for (const forbidden of [
    'body',
    'title',
    'topics',
    'orderedAssetIds',
    'price',
    'customerName',
    'activityDate',
  ]) {
    assert.throws(() =>
      reuseTaskSeedSchema.parse({ ...seed, [forbidden]: 'must-not-copy' }),
    );
  }
});

test('temporary business facts cannot be stored as reusable fixed items', () => {
  assert.throws(() =>
    assetRevisionSchema.parse({
      assetId: 'series-a',
      revisionId: 'series-a:1',
      candidateId: 'candidate-a',
      revision: 1,
      workspaceId: 'workspace-a',
      kind: 'series',
      name: 'unsafe series',
      fixedItems: [
        { key: 'offer.price', value: 199, sourceRef: 'package-a:version-a' },
      ],
      variableSlots: [
        { key: 'service.name', source: 'current_fact', required: true },
      ],
      defaultScope: { storeId: 'store-a' },
      finalScope: { storeId: 'store-a' },
      scopeDecision: {
        mode: 'accepted_default',
        decisionId: 'decision-a',
        decidedBy: 'owner-a',
        decidedAt: '2026-07-18T03:00:00.000Z',
      },
      provenance: {
        sourcePackageId: 'package-a',
        sourceVersionId: 'version-a',
        sourcePackageRevision: 1,
        contextBundleId: 'bundle-a',
        contextBundleRevision: 1,
      },
      rights: { assetIds: [], status: 'authorized' },
      nextSuggestions: [],
      createdAt: '2026-07-18T03:00:00.000Z',
      createdBy: 'owner-a',
    }),
  );
});

test('reusable fixed items accept only controlled structural tokens', () => {
  const base = {
    assetId: 'series-a',
    revisionId: 'series-a:1',
    candidateId: 'candidate-a',
    revision: 1,
    workspaceId: 'workspace-a',
    kind: 'series' as const,
    name: 'safe series',
    fixedItems: [
      {
        key: 'structure.three-part',
        value: ['experience', 'evidence', 'cta'],
        sourceRef: 'package-a:version-a',
      },
    ],
    variableSlots: [
      { key: 'offer.price', source: 'current_fact' as const, required: true },
    ],
    defaultScope: { storeId: 'store-a' },
    finalScope: { storeId: 'store-a' },
    scopeDecision: {
      mode: 'accepted_default' as const,
      decisionId: 'decision-a',
      decidedBy: 'owner-a',
      decidedAt: '2026-07-18T03:00:00.000Z',
    },
    provenance: {
      sourcePackageId: 'package-a',
      sourceVersionId: 'version-a',
      sourcePackageRevision: 1,
      contextBundleId: 'bundle-a',
      contextBundleRevision: 1,
    },
    rights: { assetIds: [], status: 'authorized' as const },
    nextSuggestions: [],
    createdAt: '2026-07-18T03:00:00.000Z',
    createdBy: 'owner-a',
  };
  assert.deepEqual(assetRevisionSchema.parse(base), base);
  for (const value of [
    '旧正文，旧价格 199，顾客张三，7月18日活动',
    ['experience', 'old-price-199', 'cta'],
    { body: '旧正文', customer: '张三' },
  ]) {
    assert.throws(() =>
      assetRevisionSchema.parse({
        ...base,
        fixedItems: [
          { key: 'structure.body', value, sourceRef: 'package-a:version-a' },
        ],
      }),
    );
  }
});

test('AssetRevision freezes reusable structure, variable slots, provenance, rights and narrow scope', () => {
  const revision = assetRevisionSchema.parse({
    assetId: 'series-a',
    revisionId: 'series-a:1',
    candidateId: 'reusable-candidate-a',
    revision: 1,
    workspaceId: 'workspace-a',
    kind: 'series',
    name: '主理人日常三图团购',
    fixedItems: [
      {
        key: 'structure.three-part',
        value: ['experience', 'evidence', 'cta'],
        sourceRef: 'package-a:version-a',
      },
    ],
    variableSlots: [
      { key: 'offer.price', source: 'current_fact', required: true },
    ],
    defaultScope: {
      storeId: 'store-a',
      personaId: 'persona-a',
      scene: 'group-buy',
    },
    finalScope: { storeId: 'store-a', scene: 'group-buy' },
    scopeDecision: {
      mode: 'explicitly_expanded',
      decisionId: 'decision-expand-scope',
      decidedBy: 'owner-a',
      decidedAt: '2026-07-18T03:00:00.000Z',
    },
    provenance: {
      sourcePackageId: 'package-a',
      sourceVersionId: 'version-a',
      sourcePackageRevision: 3,
      contextBundleId: 'bundle-a',
      contextBundleRevision: 2,
    },
    rights: { assetIds: ['asset-a'], status: 'authorized' },
    nextSuggestions: [
      {
        suggestionId: 'suggestion-a',
        explanation: '沿用三段结构，替换为当前项目与价格。',
        variableSlotKeys: ['offer.price'],
      },
    ],
    createdAt: '2026-07-18T03:00:00.000Z',
    createdBy: 'owner-a',
  });
  assert.equal(revision.kind, 'series');
  assert.equal(revision.variableSlots[0]?.source, 'current_fact');
});

test('preference confirmation can only create an inactive_stage2 record', () => {
  const candidate = preferenceCandidateSchema.parse({
    candidateId: 'preference-candidate-a',
    workspaceId: 'workspace-a',
    semanticKey: 'tone.less-promotional',
    proposedValue: true,
    defaultScope: {
      storeId: 'store-a',
      personaId: 'persona-a',
      scene: 'group-buy',
      platform: 'xiaohongshu',
    },
    evidenceDecisionIds: ['decision-a', 'decision-b', 'decision-c'],
    evidenceTaskIds: ['task-a', 'task-b', 'task-c'],
    trigger: 'repeated_signal',
    status: 'pending',
    proposedAt: '2026-07-18T03:00:00.000Z',
    source: {
      conversationId: 'conversation-a',
      sourceTurnId: 'turn-a',
      messageRange: { start: 12, end: 19 },
    },
  });
  assert.equal(candidate.status, 'pending');
  assert.deepEqual(candidate.source?.messageRange, { start: 12, end: 19 });

  const preference = {
    preferenceId: 'preference-a',
    revision: 1,
    workspaceId: 'workspace-a',
    candidateId: candidate.candidateId,
    semanticKey: candidate.semanticKey,
    value: true,
    defaultScope: candidate.defaultScope,
    finalScope: candidate.defaultScope,
    scopeDecision: {
      mode: 'accepted_default',
      decisionId: 'decision-confirm-preference',
      decidedBy: 'owner-a',
      decidedAt: '2026-07-18T03:01:00.000Z',
    },
    positiveExamples: ['弱化强促销词'],
    negativeExamples: ['限时疯抢'],
    evidenceDecisionIds: candidate.evidenceDecisionIds,
    status: 'inactive_stage2',
    recordState: 'current',
    confirmedBy: 'owner-a',
    confirmedAt: '2026-07-18T03:01:00.000Z',
    revokedAt: null,
    supersededByPreferenceId: null,
    changedBy: 'owner-a',
    changedAt: '2026-07-18T03:01:00.000Z',
    changeReason: 'candidate_confirmed',
  };
  assert.deepEqual(preferenceSchema.parse(preference), preference);
  assert.throws(() =>
    preferenceSchema.parse({ ...preference, status: 'enabled' }),
  );
});

test('V31-18 preference ledger accepts kind/authority/memoryState/decay expansion', () => {
  const candidate = preferenceCandidateSchema.parse({
    candidateId: 'preference-candidate-b',
    workspaceId: 'workspace-a',
    semanticKey: 'name.display',
    proposedValue: '小林不是老板娘',
    defaultScope: { storeId: 'store-a' },
    evidenceDecisionIds: ['decision-x'],
    evidenceTaskIds: ['task-x'],
    trigger: 'explicit_long_term_intent',
    status: 'pending',
    proposedAt: '2026-08-08T03:00:00.000Z',
    kind: 'correction',
    authority: 'observation',
    memoryState: 'proposed',
    decay: { mode: 'none' },
    confidence: 0.95,
    statement: '小林不是老板娘',
    channel: 'cross_thread',
  });
  assert.equal(candidate.kind, 'correction');
  assert.equal(candidate.memoryState, 'proposed');
  assert.equal(candidate.decay?.mode, 'none');

  const preference = preferenceSchema.parse({
    preferenceId: 'preference-b',
    revision: 1,
    workspaceId: 'workspace-a',
    candidateId: candidate.candidateId,
    semanticKey: candidate.semanticKey,
    value: candidate.proposedValue,
    defaultScope: candidate.defaultScope,
    finalScope: candidate.defaultScope,
    scopeDecision: {
      mode: 'accepted_default',
      decisionId: 'decision-confirm-b',
      decidedBy: 'owner-a',
      decidedAt: '2026-08-08T03:01:00.000Z',
    },
    positiveExamples: [],
    negativeExamples: [],
    evidenceDecisionIds: candidate.evidenceDecisionIds,
    status: 'inactive_stage2',
    recordState: 'current',
    confirmedBy: 'owner-a',
    confirmedAt: '2026-08-08T03:01:00.000Z',
    revokedAt: null,
    supersededByPreferenceId: null,
    changedBy: 'owner-a',
    changedAt: '2026-08-08T03:01:00.000Z',
    changeReason: 'candidate_confirmed',
    kind: 'correction',
    authority: 'confirmed',
    memoryState: 'active',
    decay: { mode: 'none' },
    confidence: 0.95,
    statement: '小林不是老板娘',
    channel: 'cross_thread',
  });
  assert.equal(preference.kind, 'correction');
  assert.equal(preference.authority, 'confirmed');
  assert.equal(preference.memoryState, 'active');
});

test('production preference proposals require a complete conversation pointer', () => {
  const candidate = {
    candidateId: 'candidate-a',
    workspaceId: 'workspace-a',
    semanticKey: 'tone.default',
    proposedValue: '克制',
    defaultScope: { storeId: 'store-a' },
    evidenceDecisionIds: ['decision-a'],
    evidenceTaskIds: ['task-a'],
    trigger: 'explicit_long_term_intent',
    status: 'pending',
    proposedAt: '2026-07-30T03:50:00.000Z',
  } as const;
  assert.throws(() => sourcedPreferenceCandidateSchema.parse(candidate));
  assert.throws(() =>
    sourcedPreferenceCandidateSchema.parse({
      ...candidate,
      source: {
        conversationId: 'conversation-a',
        sourceTurnId: 'turn-a',
      },
    }),
  );
  assert.deepEqual(
    sourcedPreferenceCandidateSchema.parse({
      ...candidate,
      source: {
        conversationId: 'conversation-a',
        sourceTurnId: 'turn-a',
        messageRange: { start: 2, end: 4 },
      },
    }).source.messageRange,
    { start: 2, end: 4 },
  );
});

test('scope decisions reject silent widening and cross-store changes', () => {
  const base = {
    assetId: 'series-a',
    revisionId: 'series-a:1',
    candidateId: 'candidate-a',
    revision: 1,
    workspaceId: 'workspace-a',
    kind: 'series' as const,
    name: 'series',
    fixedItems: [
      {
        key: 'structure.a',
        value: ['experience', 'cta'],
        sourceRef: 'package-a:version-a',
      },
    ],
    variableSlots: [
      { key: 'offer.price', source: 'current_fact' as const, required: true },
    ],
    defaultScope: { storeId: 'store-a', personaId: 'persona-a' },
    finalScope: { storeId: 'store-a' },
    scopeDecision: {
      mode: 'explicitly_expanded' as const,
      decisionId: 'decision-a',
      decidedBy: 'owner-a',
      decidedAt: '2026-07-18T03:00:00.000Z',
    },
    provenance: {
      sourcePackageId: 'package-a',
      sourceVersionId: 'version-a',
      sourcePackageRevision: 1,
      contextBundleId: 'bundle-a',
      contextBundleRevision: 1,
    },
    rights: { assetIds: [], status: 'authorized' as const },
    nextSuggestions: [],
    createdAt: '2026-07-18T03:00:00.000Z',
    createdBy: 'owner-a',
  };
  assert.deepEqual(assetRevisionSchema.parse(base), base);
  assert.throws(() =>
    assetRevisionSchema.parse({
      ...base,
      scopeDecision: { ...base.scopeDecision, mode: 'accepted_default' },
    }),
  );
  assert.throws(() =>
    assetRevisionSchema.parse({
      ...base,
      finalScope: { storeId: 'store-b' },
    }),
  );
});

test('preference signals remain task-bound domain records', () => {
  const signal = {
    signalId: 'signal-a',
    workspaceId: 'workspace-a',
    decisionId: 'decision-a',
    taskId: 'task-a',
    semanticKey: 'tone.less-promotional',
    value: true,
    defaultScope: { storeId: 'store-a' },
    kind: 'modified' as const,
    occurredAt: '2026-07-18T04:00:00.000Z',
  };
  assert.deepEqual(preferenceSignalSchema.parse(signal), signal);
  assert.throws(() =>
    preferenceSignalSchema.parse({
      ...signal,
      taskId: '',
    }),
  );
});
