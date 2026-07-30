import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MemoryReuseMemoryRepository,
  ReuseMemoryService,
} from './reuse-memory-service.js';
import { ReuseMemoryRecordProposalPort } from './record-proposal-port.js';
import { MemorySedimentationPipeline } from './memory-sedimentation-pipeline.js';

test('sedimentation applies all four interceptor states and isolates every failed item', async () => {
  const repository = new MemoryReuseMemoryRepository();
  const service = new ReuseMemoryService(repository, {
    async verifyCandidate() {},
    async verifyRevision() {},
  });
  const pipeline = new MemorySedimentationPipeline(
    repository,
    {
      async extract() {
        return [
          {
            itemId: 'allow-a',
            candidate: {
              semanticKey: 'format.default',
              proposedValue: 'short',
              defaultScope: { storeId: 'store-a' },
              decisionEventId: 'decision-allow',
              taskId: 'task-allow',
              messageRange: { start: 0, end: 0 },
            },
          },
          {
            itemId: 'rewrite-a',
            candidate: {
              semanticKey: 'tone.default',
              proposedValue: 'raw',
              defaultScope: { storeId: 'store-a' },
              decisionEventId: 'decision-a',
              taskId: 'task-a',
              messageRange: { start: 0, end: 0 },
            },
          },
          {
            itemId: 'discard-a',
            candidate: {
              semanticKey: 'discard.default',
              proposedValue: 'discarded',
              defaultScope: { storeId: 'store-a' },
              decisionEventId: 'decision-discard',
              taskId: 'task-discard',
              messageRange: { start: 1, end: 1 },
            },
          },
          {
            itemId: 'throws-a',
            candidate: {
              semanticKey: 'throws.default',
              proposedValue: 'throws',
              defaultScope: { storeId: 'store-a' },
              decisionEventId: 'decision-throws',
              taskId: 'task-throws',
              messageRange: { start: 1, end: 1 },
            },
          },
          { itemId: 'bad-a', candidate: { semanticKey: '' } },
          {
            itemId: 'redline-a',
            candidate: {
              semanticKey: 'claim.default',
              proposedValue: 'guaranteed-result',
              defaultScope: { storeId: 'store-a' },
              decisionEventId: 'decision-b',
              taskId: 'task-b',
              messageRange: { start: 1, end: 1 },
            },
          },
          {
            itemId: 'pending-a',
            candidate: {
              semanticKey: 'voice.default',
              proposedValue: 'friendly',
              defaultScope: { storeId: 'store-a' },
              decisionEventId: 'decision-c',
              taskId: 'task-c',
              messageRange: { start: 1, end: 1 },
            },
          },
        ];
      },
    },
    {
      async decide({ itemId, candidate }) {
        if (itemId === 'allow-a') {
          return { state: 'allow', candidate };
        }
        if (itemId === 'rewrite-a') {
          return {
            state: 'rewrite',
            candidate: { ...candidate, proposedValue: 'rewritten' },
          };
        }
        if (itemId === 'discard-a') {
          return { state: 'discard', reason: 'not_stable' };
        }
        if (itemId === 'throws-a') {
          throw new Error('isolated interceptor failure');
        }
        return { state: 'to_pending_confirmation', candidate };
      },
    },
    {
      async check(candidate) {
        return candidate.proposedValue === 'guaranteed-result'
          ? { allowed: false, reason: 'unsupported_claim' }
          : { allowed: true };
      },
    },
    new ReuseMemoryRecordProposalPort(
      service,
      { async check() { return { allowed: true, failures: [] }; } },
      () => '2026-07-30T07:00:00.000Z',
    ),
    () => '2026-07-30T07:00:00.000Z',
  );

  await pipeline.complete({
    workspaceId: 'workspace-a',
    conversationId: 'conversation-a',
    turnId: 'turn-a',
    observedAt: '2026-07-30T06:59:00.000Z',
    messages: [
      { index: 0, text: '以后用重写后的语气。' },
      { index: 1, text: '另一条偏好。' },
    ],
  });

  const page = await service.memoryEntriesPage('workspace-a', { limit: 10 });
  assert.deepEqual(
    page.items.map((item) => item.value).sort(),
    ['friendly', 'rewritten', 'short'],
  );
  const audits = await repository.listMemorySedimentationAudits('workspace-a');
  assert.deepEqual(
    audits.map(({ itemId, outcome, decision }) => ({
      itemId,
      outcome,
      decision,
    })),
    [
      { itemId: 'allow-a', outcome: 'persisted', decision: 'allow' },
      { itemId: 'rewrite-a', outcome: 'persisted', decision: 'rewrite' },
      { itemId: 'discard-a', outcome: 'aborted', decision: 'discard' },
      { itemId: 'throws-a', outcome: 'failed', decision: 'item_failed' },
      { itemId: 'bad-a', outcome: 'failed', decision: 'parse_failed' },
      {
        itemId: 'redline-a',
        outcome: 'aborted',
        decision: 'redline_aborted',
      },
      {
        itemId: 'pending-a',
        outcome: 'persisted',
        decision: 'to_pending_confirmation',
      },
    ],
  );
});

test('summarize returns structured candidates without touching memory storage', async () => {
  let repositoryCalls = 0;
  const repository = new Proxy(new MemoryReuseMemoryRepository(), {
    get(target, property, receiver) {
      if (property !== 'constructor') repositoryCalls += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  const service = new ReuseMemoryService(repository, {
    async verifyCandidate() {},
    async verifyRevision() {},
  });
  const pipeline = new MemorySedimentationPipeline(
    repository,
    {
      async extract() {
        return [
          {
            itemId: 'candidate-a',
            candidate: {
              semanticKey: 'tone.default',
              proposedValue: '克制',
              defaultScope: { storeId: 'store-a' },
              decisionEventId: 'decision-a',
              taskId: 'task-a',
              messageRange: { start: 0, end: 0 },
            },
          },
        ];
      },
    },
    {
      async decide({ candidate }) {
        return { state: 'allow', candidate };
      },
    },
    { async check() { return { allowed: true }; } },
    new ReuseMemoryRecordProposalPort(service, {
      async check() {
        return { allowed: true, failures: [] };
      },
    }),
  );

  const summarized = await pipeline.summarize({
    workspaceId: 'workspace-a',
    conversationId: 'conversation-a',
    turnId: 'turn-a',
    observedAt: '2026-07-30T06:59:00.000Z',
    messages: [{ index: 0, text: '以后文案要克制。' }],
  });

  assert.equal(repositoryCalls, 0);
  assert.equal(summarized.length, 1);
  assert.equal(summarized[0]?.itemId, 'candidate-a');
});
