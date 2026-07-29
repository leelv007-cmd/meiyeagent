import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  PreferenceCandidate,
  ReusableAssetCandidate,
} from '@meiye/contracts';
import {
  MemoryReuseMemoryRepository,
  ReuseMemoryError,
  ReuseMemoryService,
} from './reuse-memory-service.js';

const context = { workspaceId: 'workspace-a', userId: 'owner-a' };
const sourceVerifier = {
  verifyCandidate: async () => {},
  verifyRevision: async () => {},
};

function reusableCandidate(
  overrides: Partial<ReusableAssetCandidate> = {},
): ReusableAssetCandidate {
  return {
    candidateId: 'reusable-candidate-a',
    assetId: 'series-a',
    workspaceId: context.workspaceId,
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
      { key: 'service.name', source: 'current_fact', required: true },
    ],
    defaultScope: {
      storeId: 'store-a',
      personaId: 'persona-a',
      scene: 'group-buy',
    },
    provenance: {
      sourcePackageId: 'package-a',
      sourceVersionId: 'version-a',
      sourcePackageRevision: 3,
      contextBundleId: 'bundle-a',
      contextBundleRevision: 2,
    },
    rights: { assetIds: ['asset-a'], status: 'authorized' },
    status: 'pending',
    createdAt: '2026-07-18T03:00:00.000Z',
    createdBy: context.userId,
    ...overrides,
  };
}

function preferenceCandidate(
  overrides: Partial<PreferenceCandidate> = {},
): PreferenceCandidate {
  return {
    candidateId: 'preference-candidate-a',
    workspaceId: context.workspaceId,
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
    trigger: 'explicit_long_term_intent',
    status: 'pending',
    proposedAt: '2026-07-18T03:00:00.000Z',
    ...overrides,
  };
}

test('confirmed reusable candidates create immutable AssetRevision and content-free Task seeds', async () => {
  const repository = new MemoryReuseMemoryRepository();
  const service = new ReuseMemoryService(
    repository,
    sourceVerifier,
    () => '2026-07-18T03:01:00.000Z',
  );
  await service.proposeReusableAsset(reusableCandidate());
  const revision = await service.confirmReusableAsset(context, {
    candidateId: 'reusable-candidate-a',
    expectedAssetRevision: 0,
    revisionId: 'series-a:1',
    nextSuggestions: [
      {
        suggestionId: 'suggestion-a',
        explanation: '沿用三段结构，以当前项目和价格续写。',
        variableSlotKeys: ['offer.price', 'service.name'],
      },
    ],
    idempotencyKey: 'confirm-series-a',
  });
  assert.equal(revision.revision, 1);
  assert.deepEqual(revision.defaultScope, reusableCandidate().defaultScope);
  assert.deepEqual(revision.finalScope, reusableCandidate().defaultScope);
  assert.equal(revision.scopeDecision.mode, 'accepted_default');
  assert.deepEqual(
    await service.confirmReusableAsset(context, {
      candidateId: 'reusable-candidate-a',
      expectedAssetRevision: 0,
      revisionId: 'series-a:1',
      nextSuggestions: revision.nextSuggestions,
      idempotencyKey: 'confirm-series-a',
    }),
    revision,
  );
  await assert.rejects(
    service.confirmReusableAsset(context, {
      candidateId: 'reusable-candidate-a',
      expectedAssetRevision: 1,
      revisionId: 'series-a:2-forged',
      nextSuggestions: [],
      idempotencyKey: 'promote-candidate-twice',
    }),
    /already promoted/,
  );

  const seed = await service.createReuseTaskSeed(
    context.workspaceId,
    'series-a',
    1,
  );
  assert.deepEqual(seed, {
    assetId: 'series-a',
    assetRevision: 1,
    sourcePackageId: 'package-a',
    sourceVersionId: 'version-a',
    sourcePackageRevision: 3,
    assetRevisionId: 'series-a:1',
    fixedItemKeys: ['structure.three-part'],
    variableSlotKeys: ['offer.price', 'service.name'],
  });
  assert.equal('body' in seed, false);
  assert.equal('title' in seed, false);
  assert.equal('orderedAssetIds' in seed, false);
  assert.equal(
    (await service.verifyReuseTaskSeed(context.workspaceId, seed)).revisionId,
    'series-a:1',
  );
});

test('deactivated series disappear from automatic suggestions while exact history remains reusable', async () => {
  const service = new ReuseMemoryService(
    new MemoryReuseMemoryRepository(),
    sourceVerifier,
    () => '2026-07-18T03:01:00.000Z',
  );
  await service.proposeReusableAsset(reusableCandidate());
  await service.confirmReusableAsset(context, {
    candidateId: 'reusable-candidate-a',
    expectedAssetRevision: 0,
    revisionId: 'series-a:1',
    nextSuggestions: [
      {
        suggestionId: 'suggestion-a',
        explanation: '下一条换当前项目。',
        variableSlotKeys: ['service.name'],
      },
    ],
    idempotencyKey: 'confirm-series',
  });
  assert.equal(
    (await service.listAutomaticSeriesSuggestions(context.workspaceId)).length,
    1,
  );
  await service.deactivateSeries(context, {
    assetId: 'series-a',
    revisionId: 'series-a:1',
    reason: '栏目暂时停用',
    idempotencyKey: 'deactivate-series',
  });
  assert.deepEqual(
    await service.listAutomaticSeriesSuggestions(context.workspaceId),
    [],
  );
  assert.equal(
    (
      await service.createReuseTaskSeed(
        context.workspaceId,
        'series-a',
        1,
      )
    ).assetRevisionId,
    'series-a:1',
  );
});

test('repeated preference signals require three independent tasks and confirmation stays inactive_stage2', async () => {
  const repository = new MemoryReuseMemoryRepository();
  const service = new ReuseMemoryService(
    repository,
    sourceVerifier,
    () => '2026-07-18T03:01:00.000Z',
  );
  await assert.rejects(
    service.proposePreference(
      preferenceCandidate({
        trigger: 'repeated_signal',
        evidenceDecisionIds: ['decision-a', 'decision-b'],
        evidenceTaskIds: ['task-a', 'task-b'],
      }),
    ),
    (error: unknown) =>
      error instanceof ReuseMemoryError &&
      error.code === 'INSUFFICIENT_INDEPENDENT_TASKS',
  );
  await assert.rejects(
    service.proposePreference(
      preferenceCandidate({ trigger: 'repeated_signal' }),
    ),
    (error: unknown) =>
      error instanceof ReuseMemoryError &&
      error.code === 'INSUFFICIENT_INDEPENDENT_TASKS',
  );
  await service.proposePreference(preferenceCandidate());
  const preference = await service.confirmPreference(context, {
    candidateId: 'preference-candidate-a',
    preferenceId: 'preference-a',
    expectedRevision: 0,
    positiveExamples: ['弱化强促销词'],
    negativeExamples: ['限时疯抢'],
    idempotencyKey: 'confirm-preference',
  });
  assert.equal(preference.status, 'inactive_stage2');
  assert.equal(preference.recordState, 'current');
  assert.equal('enabled' in preference, false);
  assert.equal('enable' in service, false);
  await assert.rejects(
    service.confirmPreference(context, {
      candidateId: 'preference-candidate-a',
      preferenceId: 'preference-b',
      expectedRevision: 0,
      positiveExamples: [],
      negativeExamples: [],
      idempotencyKey: 'promote-preference-candidate-twice',
    }),
    /already promoted/,
  );

  const revoked = await service.revokePreference(context, {
    preferenceId: 'preference-a',
    expectedRevision: 1,
    idempotencyKey: 'revoke-preference',
  });
  assert.equal(revoked.revision, 2);
  assert.equal(revoked.status, 'inactive_stage2');
  assert.equal(revoked.recordState, 'revoked');
  assert.equal(
    (await repository.preferenceHistory(context.workspaceId, 'preference-a'))
      .length,
    2,
  );
  const view = await service.preferenceView(context.workspaceId);
  assert.equal(view.candidates.length, 1);
  assert.equal(view.preferences[0]?.recordState, 'revoked');
  assert.equal(view.preferences[0]?.changedBy, context.userId);
  assert.equal(view.preferences[0]?.changeReason, 'user_revoked');
});

test('three independent modification signals create one deterministic pending candidate', async () => {
  let nowCalls = 0;
  const service = new ReuseMemoryService(
    new MemoryReuseMemoryRepository(),
    sourceVerifier,
    () =>
      new Date(Date.UTC(2026, 6, 18, 3, 1, nowCalls++)).toISOString(),
  );
  for (const suffix of ['a', 'b']) {
    const result = await service.recordPreferenceSignal(context, {
      signalId: `signal-${suffix}`,
      decisionId: `decision-${suffix}`,
      taskId: `task-${suffix}`,
      semanticKey: 'tone.less-promotional',
      value: true,
      defaultScope: { storeId: 'store-a' },
      kind: 'modified',
    });
    assert.equal(result.candidate, null);
  }
  const third = await service.recordPreferenceSignal(context, {
    signalId: 'signal-c',
    decisionId: 'decision-c',
    taskId: 'task-c',
    semanticKey: 'tone.less-promotional',
    value: true,
    defaultScope: { storeId: 'store-a' },
    kind: 'modified',
  });
  assert.equal(third.candidate?.status, 'pending');
  assert.deepEqual(third.candidate?.evidenceTaskIds, [
    'task-a',
    'task-b',
    'task-c',
  ]);
  assert.deepEqual(
    await service.recordPreferenceSignal(context, {
      signalId: 'signal-c',
      decisionId: 'decision-c',
      taskId: 'task-c',
      semanticKey: 'tone.less-promotional',
      value: true,
      defaultScope: { storeId: 'store-a' },
      kind: 'modified',
    }),
    third,
  );
  const fourth = await service.recordPreferenceSignal(context, {
    signalId: 'signal-d',
    decisionId: 'decision-d',
    taskId: 'task-d',
    semanticKey: 'tone.less-promotional',
    value: true,
    defaultScope: { storeId: 'store-a' },
    kind: 'modified',
  });
  assert.deepEqual(fourth.candidate, third.candidate);
  const view = await service.preferenceView(context.workspaceId);
  assert.equal(view.signals.length, 4);
  assert.equal(view.candidates.length, 1);
});

test('reusable assets and preferences remain workspace scoped', async () => {
  const service = new ReuseMemoryService(
    new MemoryReuseMemoryRepository(),
    sourceVerifier,
  );
  await service.proposeReusableAsset(reusableCandidate());
  await service.proposePreference(preferenceCandidate());
  await assert.rejects(
    service.confirmReusableAsset(
      { workspaceId: 'workspace-b', userId: 'owner-b' },
      {
        candidateId: 'reusable-candidate-a',
        expectedAssetRevision: 0,
        revisionId: 'series-a:1',
        nextSuggestions: [],
        idempotencyKey: 'cross-workspace-confirm',
      },
    ),
    (error: unknown) =>
      error instanceof ReuseMemoryError && error.code === 'NOT_FOUND',
  );
});

test('asset promotion fails closed until source package provenance and rights are verified', async () => {
  const repository = new MemoryReuseMemoryRepository();
  const service = new ReuseMemoryService(repository, {
    verifyCandidate: async () => {
      throw new ReuseMemoryError(
        'INVALID_STATE',
        'Source package rights are not verified.',
      );
    },
    verifyRevision: async () => {},
  });
  await assert.rejects(
    service.proposeReusableAsset(reusableCandidate()),
    /rights are not verified/,
  );
  assert.equal(
    await repository.getReusableCandidate(
      context.workspaceId,
      'reusable-candidate-a',
    ),
    null,
  );
});

test('rights are reverified at confirmation and every explicit reuse', async () => {
  const repository = new MemoryReuseMemoryRepository();
  let allowed = true;
  const service = new ReuseMemoryService(repository, {
    verifyCandidate: async () => {
      if (!allowed) throw new ReuseMemoryError('INVALID_STATE', 'rights revoked');
    },
    verifyRevision: async () => {
      if (!allowed) throw new ReuseMemoryError('INVALID_STATE', 'rights revoked');
    },
  });
  await service.proposeReusableAsset(reusableCandidate());
  allowed = false;
  await assert.rejects(
    service.confirmReusableAsset(context, {
      candidateId: 'reusable-candidate-a',
      expectedAssetRevision: 0,
      revisionId: 'series-a:1',
      nextSuggestions: [],
      idempotencyKey: 'confirm-after-revoke',
    }),
    /rights revoked/,
  );
  allowed = true;
  await service.confirmReusableAsset(context, {
    candidateId: 'reusable-candidate-a',
    expectedAssetRevision: 0,
    revisionId: 'series-a:1',
    nextSuggestions: [],
    idempotencyKey: 'confirm-before-revoke',
  });
  allowed = false;
  await assert.rejects(
    service.createReuseTaskSeed(context.workspaceId, 'series-a', 1),
    /rights revoked/,
  );
});

test('scope widening requires and records an explicit decision', async () => {
  const service = new ReuseMemoryService(
    new MemoryReuseMemoryRepository(),
    sourceVerifier,
    () => '2026-07-18T03:01:00.000Z',
  );
  await service.proposeReusableAsset(reusableCandidate());
  await assert.rejects(
    service.confirmReusableAsset(context, {
      candidateId: 'reusable-candidate-a',
      expectedAssetRevision: 0,
      revisionId: 'series-a:1',
      nextSuggestions: [],
      finalScope: { storeId: 'store-a', scene: 'group-buy' },
      idempotencyKey: 'expand-without-decision',
    }),
    /explicit confirmation decision/,
  );
  const revision = await service.confirmReusableAsset(context, {
    candidateId: 'reusable-candidate-a',
    expectedAssetRevision: 0,
    revisionId: 'series-a:1',
    nextSuggestions: [],
    finalScope: { storeId: 'store-a', scene: 'group-buy' },
    scopeDecisionId: 'decision-expand-series-scope',
    idempotencyKey: 'expand-with-decision',
  });
  assert.equal(revision.scopeDecision.mode, 'explicitly_expanded');
  assert.equal(revision.scopeDecision.decisionId, 'decision-expand-series-scope');
  assert.deepEqual(revision.finalScope, {
    storeId: 'store-a',
    scene: 'group-buy',
  });
});

test('revoke replay succeeds after the preference is already revoked', async () => {
  const service = new ReuseMemoryService(
    new MemoryReuseMemoryRepository(),
    sourceVerifier,
  );
  await service.proposePreference(preferenceCandidate());
  await service.confirmPreference(context, {
    candidateId: 'preference-candidate-a',
    preferenceId: 'preference-a',
    expectedRevision: 0,
    positiveExamples: [],
    negativeExamples: [],
    idempotencyKey: 'confirm-for-replay',
  });
  const input = {
    preferenceId: 'preference-a',
    expectedRevision: 1,
    idempotencyKey: 'revoke-replay',
  };
  const first = await service.revokePreference(context, input);
  assert.deepEqual(await service.revokePreference(context, input), first);
});

test('memory reuse identities cannot collide across colon-delimited workspaces', async () => {
  const repository = new MemoryReuseMemoryRepository();
  const service = new ReuseMemoryService(repository, sourceVerifier);
  await service.proposeReusableAsset(
    reusableCandidate({
      workspaceId: 'a',
      candidateId: 'b:c',
      assetId: 'asset-a',
    }),
  );
  await service.proposeReusableAsset(
    reusableCandidate({
      workspaceId: 'a:b',
      candidateId: 'c',
      assetId: 'asset-b',
    }),
  );
  assert.equal((await repository.getReusableCandidate('a', 'b:c'))?.assetId, 'asset-a');
  assert.equal((await repository.getReusableCandidate('a:b', 'c'))?.assetId, 'asset-b');
});

test('confirmed preferences remain inactive until the stage-two activation path exists', async () => {
  const repository = new MemoryReuseMemoryRepository();
  const service = new ReuseMemoryService(
    repository,
    sourceVerifier,
    () => '2026-07-18T03:01:00.000Z',
  );
  await service.proposePreference(preferenceCandidate());
  const preference = await service.confirmPreference(context, {
    candidateId: 'preference-candidate-a',
    preferenceId: 'preference-a',
    expectedRevision: 0,
    positiveExamples: [],
    negativeExamples: [],
    idempotencyKey: 'confirm-inactive-preference',
  });
  assert.equal(preference.status, 'inactive_stage2');
  assert.equal(preference.semanticKey, 'tone.less-promotional');
  assert.deepEqual(
    await repository.preferenceHistory(context.workspaceId, 'preference-a'),
    [preference],
  );
});

test('concurrent AssetRevision and Preference writers preserve one CAS winner', async () => {
  const repository = new MemoryReuseMemoryRepository();
  const service = new ReuseMemoryService(repository, sourceVerifier);
  await service.proposeReusableAsset(reusableCandidate());
  const assetAttempts = await Promise.allSettled([
    service.confirmReusableAsset(context, {
      candidateId: 'reusable-candidate-a',
      expectedAssetRevision: 0,
      revisionId: 'series-a:1',
      nextSuggestions: [],
      idempotencyKey: 'confirm-series-writer-a',
    }),
    service.confirmReusableAsset(context, {
      candidateId: 'reusable-candidate-a',
      expectedAssetRevision: 0,
      revisionId: 'series-a:1-competing',
      nextSuggestions: [],
      idempotencyKey: 'confirm-series-writer-b',
    }),
  ]);
  assert.deepEqual(
    assetAttempts.map((attempt) => attempt.status).sort(),
    ['fulfilled', 'rejected'],
  );

  await service.proposePreference(preferenceCandidate());
  const preferenceAttempts = await Promise.allSettled([
    service.confirmPreference(context, {
      candidateId: 'preference-candidate-a',
      preferenceId: 'preference-a',
      expectedRevision: 0,
      positiveExamples: [],
      negativeExamples: [],
      idempotencyKey: 'confirm-preference-writer-a',
    }),
    service.confirmPreference(context, {
      candidateId: 'preference-candidate-a',
      preferenceId: 'preference-a',
      expectedRevision: 0,
      positiveExamples: ['competing'],
      negativeExamples: [],
      idempotencyKey: 'confirm-preference-writer-b',
    }),
  ]);
  assert.deepEqual(
    preferenceAttempts.map((attempt) => attempt.status).sort(),
    ['fulfilled', 'rejected'],
  );
});
