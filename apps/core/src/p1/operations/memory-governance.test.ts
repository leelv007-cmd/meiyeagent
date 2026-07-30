import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MemoryReuseMemoryRepository,
  ReuseMemoryService,
} from './reuse-memory-service.js';

const now = '2026-07-30T06:00:00.000Z';

test('memory pages stay bounded while source and entry deletion have separate lifecycles', async () => {
  const repository = new MemoryReuseMemoryRepository();
  const service = new ReuseMemoryService(
    repository,
    { async verifyCandidate() {}, async verifyRevision() {} },
    () => now,
  );
  const sourceConversation = {
    workspaceId: 'workspace-a',
    conversationId: 'conversation-a',
    turnId: 'turn-a',
    observedAt: '2026-07-30T05:00:00.000Z',
    messages: [
      { index: 0, text: '以后文案要克制，' },
      { index: 1, text: '像熟客分享。' },
    ],
  };
  await repository.saveMemorySourceConversation(sourceConversation);
  await repository.saveMemoryWorkLog(sourceConversation);
  await service.proposePreference({
    candidateId: 'candidate-a',
    workspaceId: 'workspace-a',
    semanticKey: 'tone.default',
    proposedValue: '克制、像熟客分享',
    defaultScope: { storeId: 'store-a' },
    evidenceDecisionIds: ['decision-a'],
    evidenceTaskIds: ['task-a'],
    trigger: 'explicit_long_term_intent',
    status: 'pending',
    proposedAt: now,
    source: {
      conversationId: 'conversation-a',
      sourceTurnId: 'turn-a',
      messageRange: { start: 0, end: 1 },
    },
  });

  const available = await service.memoryEntriesPage('workspace-a', {
    limit: 1,
  });
  assert.equal(available.items.length, 1);
  assert.deepEqual(available.items[0]?.source, {
    conversationId: 'conversation-a',
    sourceTurnId: 'turn-a',
    messageRange: { start: 0, end: 1 },
    status: 'available',
    observedAt: '2026-07-30T05:00:00.000Z',
    preview: '以后文案要克制， 像熟客分享。',
    deletedAt: null,
  });

  await service.markMemorySourceDeleted('workspace-a', 'conversation-a');
  const sourceDeleted = await service.memoryEntriesPage('workspace-a', {
    limit: 1,
  });
  assert.equal(sourceDeleted.items.length, 1);
  assert.deepEqual(sourceDeleted.items[0]?.source, {
    conversationId: 'conversation-a',
    sourceTurnId: 'turn-a',
    messageRange: { start: 0, end: 1 },
    status: 'deleted',
    observedAt: null,
    preview: null,
    deletedAt: now,
  });
  assert.equal(await repository.getMemoryWorkLog('workspace-a', 'turn-a'), null);

  assert.equal(
    await service.deleteMemoryEntry(
      { workspaceId: 'workspace-a', userId: 'owner-a' },
      'candidate-a',
    ),
    'deleted',
  );
  assert.deepEqual(
    await service.memoryEntriesPage('workspace-a', { limit: 1 }),
    { items: [], nextCursor: null },
  );
});

test('work logs are idempotent per turn and allow multiple turns per conversation', async () => {
  const repository = new MemoryReuseMemoryRepository();
  for (const turnId of ['turn-a', 'turn-b']) {
    await repository.saveMemoryWorkLog({
      workspaceId: 'workspace-a',
      conversationId: 'conversation-a',
      turnId,
      observedAt: now,
      messages: [{ index: 0, text: turnId }],
    });
  }
  assert.equal(
    (await repository.getMemoryWorkLog('workspace-a', 'turn-a'))?.turnId,
    'turn-a',
  );
  assert.equal(
    (await repository.getMemoryWorkLog('workspace-a', 'turn-b'))?.turnId,
    'turn-b',
  );
});
