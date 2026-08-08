/**
 * V31-18 P1 action boundary tests:
 * candidate generate / confirm / revoke / decay, cross-store isolation,
 * correction priority, injection list + post-revoke exclusion,
 * A11 separate deletion, migration → proposed only, false persistence=0.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { PreferenceCandidate } from '@meiye/contracts';

import {
  AgentMemoryPlatform,
  DefaultWorkingMemoryExtractStrategy,
  WORKING_MEMORY_CHECKPOINT_WRITE_HOOK,
  applyMemoryDecay,
  memoryScopeMatches,
  projectPreferenceToAgentMemoryEntry,
} from './agent-memory-platform.js';
import {
  MemoryReuseMemoryRepository,
  ReuseMemoryError,
  ReuseMemoryService,
} from './reuse-memory-service.js';

const now = '2026-08-08T10:00:00.000Z';
const later = '2026-11-06T10:00:00.000Z'; // ~90 days later

const context = { workspaceId: 'workspace-a', userId: 'owner-a' };
const otherWorkspace = { workspaceId: 'workspace-b', userId: 'owner-b' };

const sourceVerifier = {
  verifyCandidate: async () => {},
  verifyRevision: async () => {},
};

function platform(clock: () => string = () => now) {
  const repository = new MemoryReuseMemoryRepository();
  const reuse = new ReuseMemoryService(repository, sourceVerifier, clock);
  return {
    repository,
    reuse,
    platform: new AgentMemoryPlatform(reuse, undefined, undefined, clock),
  };
}

function source(conversationId = 'conversation-a') {
  return {
    conversationId,
    sourceTurnId: 'turn-a',
    messageRange: { start: 0, end: 1 },
  };
}

test('onExtracted always lands proposed candidates and never activates heads', async () => {
  const { platform: mem, reuse } = platform();
  const extracted = await mem.onExtracted({
    workspaceId: context.workspaceId,
    idempotencyPrefix: 'extract-1',
    items: [
      {
        itemId: 'item-1',
        kind: 'preference',
        semanticKey: 'tone.less-promotional',
        proposedValue: '少一点强促销感',
        defaultScope: { storeId: 'store-a', platform: 'xiaohongshu' },
        decisionEventId: 'decision-1',
        taskId: 'task-1',
        source: source(),
        statement: '小红书少一点强促销感',
        confidence: 0.7,
      },
    ],
  });
  const candidate = extracted[0];
  assert.ok(candidate);
  assert.equal(candidate.status, 'pending');
  assert.equal(candidate.memoryState, 'proposed');
  assert.equal(candidate.authority, 'observation');
  assert.equal(candidate.channel, 'cross_thread');
  assert.equal(candidate.kind, 'preference');
  assert.equal(candidate.decay?.mode, 'soft_preference');

  const heads = await reuse.listConfirmedPreferences(context.workspaceId);
  assert.equal(heads.length, 0);

  // Idempotent onExtracted with same prefix+item does not create a second active head path.
  const again = await mem.onExtracted({
    workspaceId: context.workspaceId,
    idempotencyPrefix: 'extract-1',
    items: [
      {
        itemId: 'item-1',
        kind: 'preference',
        semanticKey: 'tone.less-promotional',
        proposedValue: '少一点强促销感',
        defaultScope: { storeId: 'store-a', platform: 'xiaohongshu' },
        decisionEventId: 'decision-1',
        taskId: 'task-1',
        source: source(),
      },
    ],
  });
  assert.equal(again[0]?.candidateId, candidate.candidateId);
  assert.equal(
    (await reuse.listConfirmedPreferences(context.workspaceId)).length,
    0,
  );
});

test('dual channel: session activates immediately; cross-thread needs confirm', async () => {
  const { platform: mem, reuse } = platform();
  const session = await mem.activateSessionScoped({
    workspaceId: context.workspaceId,
    threadId: 'thread-a',
    kind: 'preference',
    semanticKey: 'tone.this-thread',
    proposedValue: '本次温柔一点',
    defaultScope: { storeId: 'store-a' },
    decisionEventId: 'decision-session',
    taskId: 'task-session',
    idempotencyKey: 'session-1',
    statement: '本次温柔一点',
  });
  assert.equal(session.authority, 'session');
  assert.equal(session.memoryState, 'active');
  assert.equal(session.channel, 'session');
  assert.equal(session.threadId, 'thread-a');
  assert.equal(
    (await reuse.listConfirmedPreferences(context.workspaceId)).length,
    0,
  );

  const injectable = await mem.retrieveForInjection({
    workspaceId: context.workspaceId,
    scope: { storeId: 'store-a' },
    threadId: 'thread-a',
  });
  assert.equal(injectable.length, 1);
  assert.equal(injectable[0]?.authority, 'session');
  assert.equal(injectable[0]?.memoryId, session.candidateId);

  // Other thread does not see session memory.
  assert.equal(
    (
      await mem.retrieveForInjection({
        workspaceId: context.workspaceId,
        scope: { storeId: 'store-a' },
        threadId: 'thread-b',
      })
    ).length,
    0,
  );

  // Direct confirm of session candidate is rejected.
  await assert.rejects(
    mem.confirmMemoryCandidate(context, {
      candidateId: session.candidateId,
      preferenceId: 'pref-session',
      idempotencyKey: 'confirm-session-direct',
    }),
    (error: unknown) =>
      error instanceof ReuseMemoryError && error.code === 'INVALID_STATE',
  );

  const cross = await mem.proposeSessionPromotion({
    workspaceId: context.workspaceId,
    sessionCandidateId: session.candidateId,
    idempotencyKey: 'promote-session-1',
  });
  assert.equal(cross.authority, 'observation');
  assert.equal(cross.memoryState, 'proposed');
  assert.equal(cross.channel, 'cross_thread');

  const confirmed = await mem.confirmMemoryCandidate(context, {
    candidateId: cross.candidateId,
    preferenceId: 'pref-long-term',
    idempotencyKey: 'confirm-cross-1',
    positiveExamples: ['温柔'],
  });
  assert.equal(confirmed.recordState, 'current');
  assert.equal(confirmed.authority, 'confirmed');
  assert.equal(confirmed.memoryState, 'active');
  assert.equal(confirmed.kind, 'preference');
  assert.equal(confirmed.channel, 'cross_thread');
});

test('correction priority is always above soft preference; soft prefs decay', async () => {
  const { platform: mem } = platform();
  const soft = (
    await mem.onExtracted({
      workspaceId: context.workspaceId,
      idempotencyPrefix: 'soft',
      items: [
        {
          itemId: 'soft',
          kind: 'preference',
          semanticKey: 'name.display',
          proposedValue: '叫小林老板娘也行',
          defaultScope: { storeId: 'store-a', scene: 'group-buy' },
          decisionEventId: 'd-soft',
          taskId: 't-soft',
          source: source('c-soft'),
          confidence: 0.9,
        },
      ],
    })
  )[0];
  const correction = (
    await mem.onExtracted({
      workspaceId: context.workspaceId,
      idempotencyPrefix: 'corr',
      items: [
        {
          itemId: 'corr',
          kind: 'correction',
          semanticKey: 'name.display',
          proposedValue: '小林不是老板娘',
          defaultScope: { storeId: 'store-a' },
          decisionEventId: 'd-corr',
          taskId: 't-corr',
          source: source('c-corr'),
          confidence: 0.5,
          statement: '小林不是老板娘',
        },
      ],
    })
  )[0];
  assert.ok(soft);
  assert.ok(correction);
  await mem.confirmMemoryCandidate(context, {
    candidateId: soft.candidateId,
    preferenceId: 'pref-soft',
    idempotencyKey: 'confirm-soft',
  });
  await mem.confirmMemoryCandidate(context, {
    candidateId: correction.candidateId,
    preferenceId: 'pref-corr',
    idempotencyKey: 'confirm-corr',
  });

  const ranked = await mem.retrieveForInjection({
    workspaceId: context.workspaceId,
    scope: { storeId: 'store-a', scene: 'group-buy' },
    // Similarity would prefer soft if it could decide authority — it must not.
    similarityByMemoryId: {
      'pref-soft': 0.99,
      'pref-corr': 0.01,
    },
    now: later,
  });
  assert.equal(ranked[0]?.memoryId, 'pref-corr');
  assert.equal(ranked[0]?.kind, 'correction');
  assert.equal(ranked[1]?.memoryId, 'pref-soft');
  // Soft preference decayed over ~half life; correction did not.
  assert.ok((ranked[1]?.confidence ?? 1) < 0.9);
  assert.equal(ranked[0]?.confidence, 0.5);

  const decayed = applyMemoryDecay({
    kind: 'preference',
    confidence: 1,
    decay: { mode: 'soft_preference', halfLifeDays: 90 },
    effectiveFrom: now,
    now: later,
  });
  assert.ok(decayed < 0.6 && decayed > 0.4);
  assert.equal(
    applyMemoryDecay({
      kind: 'correction',
      confidence: 0.8,
      decay: { mode: 'soft_preference', halfLifeDays: 1 },
      effectiveFrom: now,
      now: later,
    }),
    0.8,
  );
});

test('cross-store isolation: other workspace memories never inject', async () => {
  const { platform: mem } = platform();
  const a = (
    await mem.onExtracted({
      workspaceId: context.workspaceId,
      idempotencyPrefix: 'ws-a',
      items: [
        {
          itemId: 'a',
          kind: 'preference',
          semanticKey: 'tone.a',
          proposedValue: 'A店风格',
          defaultScope: { storeId: 'store-a' },
          decisionEventId: 'd-a',
          taskId: 't-a',
          source: source('c-a'),
        },
      ],
    })
  )[0];
  const b = (
    await mem.onExtracted({
      workspaceId: otherWorkspace.workspaceId,
      idempotencyPrefix: 'ws-b',
      items: [
        {
          itemId: 'b',
          kind: 'preference',
          semanticKey: 'tone.b',
          proposedValue: 'B店风格',
          defaultScope: { storeId: 'store-b' },
          decisionEventId: 'd-b',
          taskId: 't-b',
          source: source('c-b'),
        },
      ],
    })
  )[0];
  assert.ok(a);
  assert.ok(b);
  await mem.confirmMemoryCandidate(context, {
    candidateId: a.candidateId,
    preferenceId: 'pref-a',
    idempotencyKey: 'confirm-a',
  });
  await mem.confirmMemoryCandidate(otherWorkspace, {
    candidateId: b.candidateId,
    preferenceId: 'pref-b',
    idempotencyKey: 'confirm-b',
  });

  const forA = await mem.retrieveForInjection({
    workspaceId: context.workspaceId,
    scope: { storeId: 'store-a' },
  });
  assert.deepEqual(
    forA.map((entry) => entry.memoryId),
    ['pref-a'],
  );
  // Even with store-b scope, workspace-a must not see workspace-b rows.
  const leakProbe = await mem.retrieveForInjection({
    workspaceId: context.workspaceId,
    scope: { storeId: 'store-b' },
  });
  assert.equal(leakProbe.length, 0);
});

test('scope filter rejects mismatched store; narrowest scope ranks first', async () => {
  assert.equal(
    memoryScopeMatches({ storeId: 'store-a' }, { storeId: 'store-a' }),
    true,
  );
  assert.equal(
    memoryScopeMatches({ storeId: 'store-a' }, { storeId: 'store-b' }),
    false,
  );
  assert.equal(
    memoryScopeMatches(
      { storeId: 'store-a', platform: 'xiaohongshu' },
      { storeId: 'store-a' },
    ),
    false,
  );
  assert.equal(
    memoryScopeMatches(
      { storeId: 'store-a' },
      { storeId: 'store-a', platform: 'xiaohongshu' },
    ),
    true,
  );

  const { platform: mem } = platform();
  const wide = (
    await mem.onExtracted({
      workspaceId: context.workspaceId,
      idempotencyPrefix: 'wide',
      items: [
        {
          itemId: 'wide',
          kind: 'preference',
          semanticKey: 'tone.wide',
          proposedValue: '宽范围',
          defaultScope: { storeId: 'store-a' },
          decisionEventId: 'd-wide',
          taskId: 't-wide',
          source: source('c-wide'),
          confidence: 1,
        },
      ],
    })
  )[0];
  const narrow = (
    await mem.onExtracted({
      workspaceId: context.workspaceId,
      idempotencyPrefix: 'narrow',
      items: [
        {
          itemId: 'narrow',
          kind: 'preference',
          semanticKey: 'tone.narrow',
          proposedValue: '窄范围',
          defaultScope: {
            storeId: 'store-a',
            scene: 'group-buy',
            platform: 'xiaohongshu',
          },
          decisionEventId: 'd-narrow',
          taskId: 't-narrow',
          source: source('c-narrow'),
          confidence: 0.2,
        },
      ],
    })
  )[0];
  assert.ok(wide);
  assert.ok(narrow);
  await mem.confirmMemoryCandidate(context, {
    candidateId: wide.candidateId,
    preferenceId: 'pref-wide',
    idempotencyKey: 'confirm-wide',
  });
  await mem.confirmMemoryCandidate(context, {
    candidateId: narrow.candidateId,
    preferenceId: 'pref-narrow',
    idempotencyKey: 'confirm-narrow',
  });

  const ranked = await mem.retrieveForInjection({
    workspaceId: context.workspaceId,
    scope: {
      storeId: 'store-a',
      scene: 'group-buy',
      platform: 'xiaohongshu',
    },
    // High similarity on wide must not beat narrower scope ranking.
    similarityByMemoryId: {
      'pref-wide': 1,
      'pref-narrow': 0,
    },
  });
  assert.equal(ranked[0]?.memoryId, 'pref-narrow');
  assert.equal(ranked[1]?.memoryId, 'pref-wide');
});

test('injection receipt is visible; revoke excludes memory from future injection', async () => {
  const { platform: mem } = platform();
  const candidate = (
    await mem.onExtracted({
      workspaceId: context.workspaceId,
      idempotencyPrefix: 'inject',
      items: [
        {
          itemId: 'inj',
          kind: 'preference',
          semanticKey: 'tone.inject',
          proposedValue: '克制',
          defaultScope: { storeId: 'store-a' },
          decisionEventId: 'd-inj',
          taskId: 't-inj',
          source: source('c-inj'),
          statement: '文案要克制',
        },
      ],
    })
  )[0];
  assert.ok(candidate);
  const preference = await mem.confirmMemoryCandidate(context, {
    candidateId: candidate.candidateId,
    preferenceId: 'pref-inject',
    idempotencyKey: 'confirm-inject',
  });
  const entries = await mem.retrieveForInjection({
    workspaceId: context.workspaceId,
    scope: { storeId: 'store-a' },
  });
  assert.equal(entries.length, 1);

  const receipt = await mem.recordInjectionReceipt({
    taskId: 'task-gen-1',
    runId: 'run-1',
    harnessReleaseId: 'release-1',
    entries,
  });
  assert.equal(receipt.taskId, 'task-gen-1');
  assert.equal(receipt.runId, 'run-1');
  assert.equal(receipt.harnessReleaseId, 'release-1');
  assert.equal(receipt.entries[0]?.memoryId, 'pref-inject');
  assert.equal(receipt.entries[0]?.revision, preference.revision);
  assert.equal(receipt.entries[0]?.statement, '文案要克制');

  const loaded = await mem.getInjectionReceiptByTask('task-gen-1');
  assert.deepEqual(loaded, receipt);
  assert.deepEqual(await mem.getInjectionReceiptByRun('run-1'), receipt);

  await mem.revokeMemory(context, {
    preferenceId: 'pref-inject',
    expectedRevision: 1,
    idempotencyKey: 'revoke-inject',
  });
  // Historical receipt remains (trace).
  assert.equal((await mem.getInjectionReceiptByTask('task-gen-1'))?.entries.length, 1);
  // Future injection no longer includes revoked memory.
  assert.equal(
    (
      await mem.retrieveForInjection({
        workspaceId: context.workspaceId,
        scope: { storeId: 'store-a' },
      })
    ).length,
    0,
  );
});

test('A11 separate deletion: source deleted marks entry; memory delete keeps approval receipts', async () => {
  const { platform: mem, reuse, repository } = platform();
  await repository.saveMemorySourceConversation({
    workspaceId: context.workspaceId,
    conversationId: 'conversation-a',
    turnId: 'turn-a',
    observedAt: now,
    messages: [
      { index: 0, text: '以后都温柔一点' },
      { index: 1, text: '长期这样' },
    ],
  });
  await repository.saveMemoryWorkLog({
    workspaceId: context.workspaceId,
    conversationId: 'conversation-a',
    turnId: 'turn-a',
    observedAt: now,
    messages: [
      { index: 0, text: '以后都温柔一点' },
      { index: 1, text: '长期这样' },
    ],
  });
  const candidate = (
    await mem.onExtracted({
      workspaceId: context.workspaceId,
      idempotencyPrefix: 'a11',
      items: [
        {
          itemId: 'a11',
          kind: 'preference',
          semanticKey: 'tone.warm',
          proposedValue: '温柔',
          defaultScope: { storeId: 'store-a' },
          decisionEventId: 'd-a11',
          taskId: 't-a11',
          source: source('conversation-a'),
        },
      ],
    })
  )[0];
  assert.ok(candidate);
  await mem.confirmMemoryCandidate(context, {
    candidateId: candidate.candidateId,
    preferenceId: 'pref-a11',
    idempotencyKey: 'confirm-a11',
  });
  const receiptsBefore = await reuse.listMemoryApprovalReceipts(
    context.workspaceId,
  );
  assert.equal(receiptsBefore.length, 1);

  await mem.markSourceDeleted(context.workspaceId, 'conversation-a');
  const page = await reuse.memoryEntriesPage(context.workspaceId, { limit: 10 });
  const entry = page.items.find((row) => row.entryId === candidate.candidateId);
  assert.ok(entry);
  assert.equal(entry.source?.status, 'deleted');
  // Memory row itself is not cascade-deleted.
  assert.equal(entry.status, 'confirmed');

  const { deleted, approvalReceipts } = await mem.deleteMemoryKeepingReceipts(
    context,
    candidate.candidateId,
  );
  assert.equal(deleted, 'deleted');
  assert.equal(approvalReceipts.length, 1);
  assert.equal(approvalReceipts[0]?.candidateId, candidate.candidateId);
  assert.equal(approvalReceipts[0]?.status, 'approved');
});

test('historical migration only produces proposed candidates', async () => {
  const { platform: mem, reuse } = platform();
  const migrated = await mem.migrateLegacyAsProposed({
    workspaceId: context.workspaceId,
    migrationBatchId: 'batch-1',
    rows: [
      {
        semanticKey: 'legacy.tone',
        value: '旧偏好',
        defaultScope: { storeId: 'store-a' },
        evidenceDecisionId: 'legacy-d1',
        evidenceTaskId: 'legacy-t1',
        statement: '历史迁移偏好',
      },
    ],
  });
  assert.equal(migrated.length, 1);
  assert.equal(migrated[0]?.status, 'pending');
  assert.equal(migrated[0]?.memoryState, 'proposed');
  assert.equal(migrated[0]?.authority, 'observation');
  assert.equal(
    (await reuse.listConfirmedPreferences(context.workspaceId)).length,
    0,
  );
});

test('working memory strategy extracts projection without writing checkpoint', async () => {
  const strategy = new DefaultWorkingMemoryExtractStrategy();
  const projection = await strategy.extract({
    threadId: 'thread-w',
    messages: [
      { role: 'user', text: '先写小红书' },
      { role: 'assistant', text: '好的，偏种草' },
    ],
  });
  assert.equal(projection.kind, 'working');
  assert.equal(projection.revision, 1);
  assert.match(projection.statement, /小红书/);
  // Hook is documented for V31-06 sole writer — platform must not implement write.
  assert.equal(
    WORKING_MEMORY_CHECKPOINT_WRITE_HOOK,
    'v31-06.session-harness.compaction.write-working-memory',
  );
});

test('offline retrieval precision scorer and kill switches', async () => {
  assert.equal(
    AgentMemoryPlatform.scoreRetrievalPrecision({
      retrievedIds: ['a', 'b', 'c'],
      relevantIds: ['a', 'c', 'd'],
    }),
    2 / 3,
  );

  const lockedReuse = new ReuseMemoryService(
    new MemoryReuseMemoryRepository(),
    sourceVerifier,
    () => now,
  );
  const locked = new AgentMemoryPlatform(
    lockedReuse,
    undefined,
    { disableMemoryWrite: true, disableMemoryRead: false },
    () => now,
  );
  await assert.rejects(
    locked.onExtracted({
      workspaceId: context.workspaceId,
      idempotencyPrefix: 'locked',
      items: [
        {
          itemId: 'x',
          kind: 'preference',
          semanticKey: 'tone.x',
          proposedValue: true,
          defaultScope: { storeId: 'store-a' },
          decisionEventId: 'd-x',
          taskId: 't-x',
          source: source('c-x'),
        },
      ],
    }),
    /kill switch/,
  );

  // Project helper maps confirmed preference expansion fields.
  const { platform: mem2 } = platform();
  const c = (
    await mem2.onExtracted({
      workspaceId: context.workspaceId,
      idempotencyPrefix: 'proj',
      items: [
        {
          itemId: 'p',
          kind: 'correction',
          semanticKey: 'fact.price-note',
          proposedValue: '不是199',
          defaultScope: { storeId: 'store-a' },
          decisionEventId: 'd-p',
          taskId: 't-p',
          source: source('c-p'),
          statement: '这个项目不是199',
        },
      ],
    })
  )[0];
  assert.ok(c);
  const pref = await mem2.confirmMemoryCandidate(context, {
    candidateId: c.candidateId,
    preferenceId: 'pref-proj',
    idempotencyKey: 'confirm-proj',
  });
  const entry = projectPreferenceToAgentMemoryEntry(pref);
  assert.equal(entry.kind, 'correction');
  assert.equal(entry.authority, 'confirmed');
  assert.equal(entry.state, 'active');
  assert.equal(entry.statement, '这个项目不是199');
});

test('procedure cannot activate on session channel (L3 confirm gate)', async () => {
  const { platform: mem } = platform();
  await assert.rejects(
    mem.activateSessionScoped({
      workspaceId: context.workspaceId,
      threadId: 'thread-a',
      kind: 'procedure',
      semanticKey: 'flow.checkout',
      proposedValue: '先确认再发',
      defaultScope: { storeId: 'store-a' },
      decisionEventId: 'd-proc',
      taskId: 't-proc',
      idempotencyKey: 'proc-session',
    }),
    (error: unknown) =>
      error instanceof ReuseMemoryError && error.code === 'INVALID_STATE',
  );
});

// Keep a type-level anchor so PreferenceCandidate expansion is imported for TDD.
void (null as unknown as PreferenceCandidate);
