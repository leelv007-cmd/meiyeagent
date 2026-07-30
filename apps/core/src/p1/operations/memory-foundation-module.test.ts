import assert from 'node:assert/strict';
import test from 'node:test';

import { requiredP1Capability } from '@meiye/contracts';

import type { P1Context } from '../foundation/domain.js';
import { MemoryFoundationModule } from './memory-foundation-module.js';
import {
  MemoryReuseMemoryRepository,
  ReuseMemoryService,
} from './reuse-memory-service.js';

const context: P1Context = {
  actor: 'owner',
  correlationId: 'memory-module',
  userId: 'owner-a',
  workspaceId: 'workspace-a',
};

test('memory exposes bounded pages, candidate decisions, and memory-owned provenance tombstones', async () => {
  const service = new ReuseMemoryService(
    new MemoryReuseMemoryRepository(),
    { async verifyCandidate() {}, async verifyRevision() {} },
    () => '2026-07-30T06:00:00.000Z',
  );
  const module = new MemoryFoundationModule(service);

  assert.equal(
    requiredP1Capability('query', 'memory', 'entries_page'),
    'workspace.read',
  );
  assert.equal(
    requiredP1Capability('command', 'memory', 'delete_entry'),
    'personal.preferences.manage',
  );
  assert.equal(
    requiredP1Capability('command', 'memory', 'confirm_candidate'),
    'personal.preferences.manage',
  );
  assert.equal(
    requiredP1Capability('command', 'memory', 'reject_candidate'),
    'personal.preferences.manage',
  );
  assert.equal(
    requiredP1Capability('query', 'asset-memory', 'memory_entries_page'),
    null,
  );
  assert.equal(
    requiredP1Capability('command', 'asset-memory', 'delete_memory_entry'),
    null,
  );
  assert.deepEqual(
    await module.query({
      context,
      input: { action: 'entries_page', payload: { limit: 10 } },
    }),
    { items: [], nextCursor: null },
  );
  await assert.rejects(
    module.query({
      context,
      input: { action: 'entries_page', payload: { all: true } },
    }),
    /Invalid memory payload/u,
  );
  for (const candidateId of ['candidate-confirm', 'candidate-reject']) {
    await service.proposePreference({
      candidateId,
      workspaceId: context.workspaceId,
      semanticKey: `tone.${candidateId}`,
      proposedValue: candidateId,
      defaultScope: { storeId: 'store-a' },
      evidenceDecisionIds: [`decision-${candidateId}`],
      evidenceTaskIds: [`task-${candidateId}`],
      trigger: 'explicit_long_term_intent',
      status: 'pending',
      proposedAt: '2026-07-30T05:59:00.000Z',
      source: {
        conversationId: 'conversation-a',
        sourceTurnId: 'turn-a',
        messageRange: { start: 0, end: 0 },
      },
    });
  }
  const sourceConversation = {
    workspaceId: context.workspaceId,
    conversationId: 'conversation-a',
    turnId: 'turn-a',
    observedAt: '2026-07-30T05:58:00.000Z',
    messages: [{ index: 0, text: 'source conversation' }],
  };
  await service.saveMemorySourceConversation(sourceConversation);
  await service.saveMemoryWorkLog(sourceConversation);
  const confirmed = await module.execute({
    context,
    idempotencyKey: 'confirm-candidate',
    input: {
      action: 'confirm_candidate',
      payload: { entryId: 'candidate-confirm' },
    },
  });
  assert.equal(
    (confirmed as { candidateId: string }).candidateId,
    'candidate-confirm',
  );
  assert.equal(
    await module.execute({
      context,
      idempotencyKey: 'reject-candidate',
      input: {
        action: 'reject_candidate',
        payload: {
          entryId: 'candidate-reject',
          reason: 'Not my usual voice.',
        },
      },
    }),
    'rejected',
  );
  assert.deepEqual(
    (await service.memoryEntriesPage(context.workspaceId, { limit: 10 })).items
      .map(({ entryId, status }) => ({ entryId, status }))
      .sort((left, right) => left.entryId.localeCompare(right.entryId)),
    [
      { entryId: 'candidate-confirm', status: 'confirmed' },
      { entryId: 'candidate-reject', status: 'rejected' },
    ],
  );
  assert.equal(
    await module.execute({
      context,
      idempotencyKey: 'delete-source',
      input: {
        action: 'delete_source_conversation',
        payload: { conversationId: 'conversation-a' },
      },
    }),
    'deleted',
  );
  assert.equal(
    (
      await service.memoryEntriesPage(context.workspaceId, { limit: 10 })
    ).items[0]?.source?.status,
    'deleted',
  );
  assert.equal(
    await module.execute({
      context,
      idempotencyKey: 'delete-missing',
      input: { action: 'delete_entry', payload: { entryId: 'missing-a' } },
    }),
    'not_found',
  );
  for (const action of ['export', 'download', 'all']) {
    await assert.rejects(
      module.query({ context, input: { action, payload: {} } }),
      /Unknown memory query/u,
    );
    assert.equal(requiredP1Capability('query', 'memory', action), null);
    await assert.rejects(
      module.execute({
        context,
        idempotencyKey: `unknown-${action}`,
        input: { action, payload: {} },
      }),
      /Unknown memory command/u,
    );
    assert.equal(requiredP1Capability('command', 'memory', action), null);
  }
});
