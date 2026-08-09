import assert from 'node:assert/strict';
import test from 'node:test';

import { requiredP1Capability } from '@meiye/contracts';

import { P1DomainError, type P1Context } from '../foundation/domain.js';
import { AgentMemoryPlatform } from './agent-memory-platform.js';
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

const otherWorkspace: P1Context = {
  actor: 'owner',
  correlationId: 'memory-module',
  userId: 'owner-b',
  workspaceId: 'workspace-b',
};

const sourceVerifier = {
  async verifyCandidate() {},
  async verifyRevision() {},
};

const now = '2026-08-08T10:00:00.000Z';

/**
 * V31-18 module wiring: a memory platform whose receipt store carries one
 * workspace-a receipt (task-gen-1 / run-1) for a confirmed preference.
 */
async function moduleWithReceipt() {
  const repository = new MemoryReuseMemoryRepository();
  const reuse = new ReuseMemoryService(repository, sourceVerifier, () => now);
  const platform = new AgentMemoryPlatform(
    reuse,
    undefined,
    undefined,
    () => now,
  );
  const candidate = (
    await platform.onExtracted({
      workspaceId: context.workspaceId,
      idempotencyPrefix: 'receipt-module',
      items: [
        {
          itemId: 'a',
          kind: 'preference',
          semanticKey: 'tone.inject',
          proposedValue: '克制',
          defaultScope: { storeId: 'store-a' },
          decisionEventId: 'd-inject',
          taskId: 't-inject',
          source: {
            conversationId: 'c-inject',
            sourceTurnId: 'turn-inject',
            messageRange: { start: 0, end: 1 },
          },
          statement: '文案要克制',
        },
      ],
    })
  )[0];
  assert.ok(candidate);
  await platform.confirmMemoryCandidate(context, {
    candidateId: candidate.candidateId,
    preferenceId: 'pref-inject',
    idempotencyKey: 'confirm-inject',
  });
  const entries = await platform.retrieveForInjection({
    workspaceId: context.workspaceId,
    scope: { storeId: 'store-a' },
  });
  assert.equal(entries.length, 1);
  await platform.recordInjectionReceipt({
    taskId: 'task-gen-1',
    runId: 'run-1',
    harnessReleaseId: 'release-1',
    entries,
  });
  const module = new MemoryFoundationModule(reuse, platform);
  return { module, platform, reuse, repository };
}

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

test('V31-18 injection receipt query is workspace-authenticated', async () => {
  const { module } = await moduleWithReceipt();

  assert.equal(
    requiredP1Capability('query', 'memory', 'injection_receipt'),
    'workspace.read',
  );
  assert.equal(
    requiredP1Capability('command', 'memory', 'revoke_memory'),
    'personal.preferences.manage',
  );

  const byTask = await module.query({
    context,
    input: { action: 'injection_receipt', payload: { taskId: 'task-gen-1' } },
  });
  const receiptByTask = (byTask as {
    receipt: { taskId: string; runId: string; harnessReleaseId: string };
  }).receipt;
  assert.equal(receiptByTask.taskId, 'task-gen-1');
  assert.equal(receiptByTask.runId, 'run-1');
  assert.equal(receiptByTask.harnessReleaseId, 'release-1');
  const byRun = await module.query({
    context,
    input: { action: 'injection_receipt', payload: { runId: 'run-1' } },
  });
  assert.equal(
    (byRun as { receipt: { taskId: string } }).receipt.taskId,
    'task-gen-1',
  );

  const missing = await module.query({
    context,
    input: { action: 'injection_receipt', payload: { runId: 'run-missing' } },
  });
  assert.deepEqual(missing, { receipt: null });

  // Cross-workspace lookup must be rejected, not served.
  await assert.rejects(
    module.query({
      context: otherWorkspace,
      input: {
        action: 'injection_receipt',
        payload: { taskId: 'task-gen-1' },
      },
    }),
    (error: unknown) =>
      error instanceof P1DomainError && error.code === 'FORBIDDEN',
  );
  await assert.rejects(
    module.query({
      context: otherWorkspace,
      input: { action: 'injection_receipt', payload: { runId: 'run-1' } },
    }),
    (error: unknown) =>
      error instanceof P1DomainError && error.code === 'FORBIDDEN',
  );

  // Ambiguous payload (both ids) is an invalid input.
  await assert.rejects(
    module.query({
      context,
      input: {
        action: 'injection_receipt',
        payload: { taskId: 'task-gen-1', runId: 'run-1' },
      },
    }),
    /Invalid memory payload/u,
  );
});

test('V31-18 revoke_memory command excludes the memory from future injection', async () => {
  const { module, platform } = await moduleWithReceipt();

  const receipt = (
    await module.query({
      context,
      input: { action: 'injection_receipt', payload: { taskId: 'task-gen-1' } },
    })
  ) as { receipt: { entries: Array<{ memoryId: string; revision: number }> } };
  const entry = receipt.receipt.entries[0];
  assert.equal(entry?.memoryId, 'pref-inject');

  const revoked = await module.execute({
    context,
    idempotencyKey: 'revoke-inject-module',
    input: {
      action: 'revoke_memory',
      payload: { memoryId: entry.memoryId, expectedRevision: entry.revision },
    },
  });
  assert.equal(
    (revoked as { recordState: string }).recordState,
    'revoked',
  );

  // Historical receipt stays visible (trace) in the owning workspace.
  const after = await module.query({
    context,
    input: { action: 'injection_receipt', payload: { taskId: 'task-gen-1' } },
  });
  assert.equal(
    (after as { receipt: { entries: unknown[] } }).receipt.entries.length,
    1,
  );
  // Future injection no longer includes the revoked memory.
  assert.equal(
    (
      await platform.retrieveForInjection({
        workspaceId: context.workspaceId,
        scope: { storeId: 'store-a' },
      })
    ).length,
    0,
  );
});
