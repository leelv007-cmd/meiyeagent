import assert from 'node:assert/strict';
import test from 'node:test';

import { HarnessCheckTargetScope } from '../agent-primitives/harness-check-target-scope.js';
import {
  MemoryReuseMemoryRepository,
  ReuseMemoryService,
} from './reuse-memory-service.js';
import { ReuseMemoryRecordProposalPort } from './record-proposal-port.js';
import { ProductionMemorySedimentationCoordinator } from './production-memory-sedimentation.js';

test('production sedimentation replays all four decisions idempotently through the proposal seam', async () => {
  const repository = new MemoryReuseMemoryRepository();
  const service = new ReuseMemoryService(
    repository,
    { async verifyCandidate() {}, async verifyRevision() {} },
    () => '2026-07-30T07:30:00.000Z',
  );
  const record = new ReuseMemoryRecordProposalPort(
    service,
    { async check() { return { allowed: true, failures: [] }; } },
    () => '2026-07-30T07:30:00.000Z',
  );
  const coordinator = new ProductionMemorySedimentationCoordinator(
    repository,
    {
      create() {
        return {
          async run(request) {
            return {
              output: request.schema.parse({
                items: [
                  item('allow', 'allow', 'short'),
                  item('rewrite', 'rewrite', 'restrained'),
                  item('discard', 'discard', 'temporary'),
                  {
                    itemId: 'invalid',
                    decision: {
                      state: 'allow',
                      reason: 'invalid_candidate',
                    },
                    candidate: 'not-an-object',
                  },
                  item('pending', 'to_pending_confirmation', 'friendly'),
                ],
              }),
              attempts: 1,
              providerTaskRef: 'memory-model',
              replayed: false,
              usage: { inputTokens: 1, outputTokens: 1 },
            };
          },
        };
      },
    },
    ({ proposal }) => record.propose(proposal),
    new HarnessCheckTargetScope(),
    () => '2026-07-30T07:30:00.000Z',
  );

  await coordinator.complete(productionInput());
  await coordinator.complete(productionInput());

  assert.deepEqual(
    (await service.memoryEntriesPage('workspace-a', { limit: 10 })).items
      .map((entry) => entry.value)
      .sort(),
    ['friendly', 'restrained', 'short'],
  );
  assert.deepEqual(
    (await repository.listMemorySedimentationAudits('workspace-a')).map(
      ({ decision }) => decision,
    ),
    [
      'allow',
      'rewrite',
      'discard',
      'parse_failed',
      'to_pending_confirmation',
    ],
  );
});

test('production sedimentation records a durable failure without rejecting delivery', async () => {
  const repository = new MemoryReuseMemoryRepository();
  const coordinator = new ProductionMemorySedimentationCoordinator(
    repository,
    {
      create() {
        return {
          async run() {
            throw new Error('extractor unavailable');
          },
        };
      },
    },
    async () => ({ status: 'proposed' }),
    new HarnessCheckTargetScope(),
  );

  await assert.doesNotReject(
    coordinator.complete(productionInput()),
  );
  assert.deepEqual(
    await repository.listMemorySedimentationAudits('workspace-a'),
    [
      {
        auditId: 'task-memory-production:pipeline',
        workspaceId: 'workspace-a',
        conversationId:
          'conversation-a:task-memory-production',
        itemId: 'pipeline',
        outcome: 'failed',
        decision: 'item_failed',
        reason: 'extractor unavailable',
        occurredAt: '2026-07-30T07:20:00.000Z',
      },
    ],
  );
});

test('production summarize returns candidates without memory or proposal side effects', async () => {
  let repositoryCalls = 0;
  let proposalCalls = 0;
  const repository = new Proxy(new MemoryReuseMemoryRepository(), {
    get(target, property, receiver) {
      if (property !== 'constructor') repositoryCalls += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  const coordinator = new ProductionMemorySedimentationCoordinator(
    repository,
    {
      create() {
        return {
          async run(request) {
            return {
              output: request.schema.parse({
                items: [item('candidate-a', 'allow', 'restrained')],
              }),
              attempts: 1,
              providerTaskRef: 'memory-model',
              replayed: false,
              usage: { inputTokens: 1, outputTokens: 1 },
            };
          },
        };
      },
    },
    async () => {
      proposalCalls += 1;
      return { status: 'proposed' };
    },
    new HarnessCheckTargetScope(),
  );

  assert.deepEqual(await coordinator.summarize(productionInput()), [
    {
      itemId: 'candidate-a',
      decision: {
        state: 'allow',
        reason: 'allow_reason',
      },
      candidate: {
        semanticKey: 'tone.candidate-a',
        proposedValue: 'restrained',
        defaultScope: {
          storeId: 'store-a',
          platform: 'douyin',
        },
        decisionEventId:
          'memory:task-memory-production:candidate-a',
        taskId: 'task-memory-production',
        messageRange: { start: 0, end: 0 },
      },
    },
  ]);
  assert.equal(repositoryCalls, 0);
  assert.equal(proposalCalls, 0);
});

function item(
  itemId: string,
  state: 'allow' | 'rewrite' | 'discard' | 'to_pending_confirmation',
  proposedValue: string,
) {
  return {
    itemId,
    decision: {
      state,
      reason: `${state}_reason`,
    },
    candidate: {
      semanticKey: `tone.${itemId}`,
      proposedValue,
      messageRange: { start: 0, end: 0 },
    },
  };
}

function productionInput() {
  return {
    workflowId: 'task-memory-production',
    request: {
      actorId: 'owner-a',
      workspaceId: 'workspace-a',
      rawInput: '以后都用克制语气。',
      factScope: { storeId: 'store-a' },
      intent: {
        context: { intent: 'write', sourceSummaries: [] },
        assetReferences: [],
      },
      executionSnapshot: {
        createdAt: '2026-07-30T07:20:00.000Z',
        task: { id: 'task-memory-production' },
        quote: { revision: 'quote-r1' },
        platform: { id: 'douyin' },
        work: { id: 'conversation-a' },
      },
      executionAssembly: { rootAxes: {} },
    },
    context: {
      bundle: { revision: 1 },
      policyReferences: {
        sourceRefs: [],
        rightsRefs: [],
        identityRefs: [],
      },
    },
    brief: { assetRefs: [] },
    selection: {
      winner: {
        candidateId: 'winner-a',
        title: 'title',
        body: 'body',
        conversionHook: 'cta',
      },
    },
  } as never;
}
