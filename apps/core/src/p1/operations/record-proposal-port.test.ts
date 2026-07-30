import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MemoryReuseMemoryRepository,
  ReuseMemoryService,
} from './reuse-memory-service.js';
import { ReuseMemoryRecordProposalPort } from './record-proposal-port.js';
import { CanonicalMemoryProposalRedline } from './canonical-memory-redline.js';

const execution = {
  actorId: 'memory-worker',
  correlationId: 'decision-event-a',
  taskId: 'task-a',
};

test('record proposes a preference with server-owned identity and a conversation pointer', async () => {
  const repository = new MemoryReuseMemoryRepository();
  const service = new ReuseMemoryService(repository, {
    async verifyCandidate() {},
    async verifyRevision() {},
  });
  const port = new ReuseMemoryRecordProposalPort(
    service,
    { async check() { return { allowed: true, failures: [] }; } },
    () => '2026-07-30T03:50:00.000Z',
  );

  const outcome = await port.propose({
    kind: 'propose_preference',
    payload: {
      defaultScope: {
        storeId: 'store-a',
        scene: 'daily-copy',
      },
      proposedValue: '克制、像熟客分享',
      semanticKey: 'tone.default',
    },
    provenance: {
      messageRange: { start: 12, end: 19 },
      sourceConversationId: 'conversation-a',
      sourceTurnId: 'turn-a',
    },
    workspaceId: 'workspace-a',
    idempotencyKey: 'record-preference-a',
    execution,
  });

  assert.equal(outcome.status, 'proposed');
  assert.match(outcome.proposalRef ?? '', /^preference-candidate-/u);
  const candidate = await repository.getPreferenceCandidate(
    'workspace-a',
    outcome.proposalRef ?? '',
  );
  assert.deepEqual(candidate, {
    candidateId: outcome.proposalRef,
    workspaceId: 'workspace-a',
    semanticKey: 'tone.default',
    proposedValue: '克制、像熟客分享',
    defaultScope: {
      storeId: 'store-a',
      scene: 'daily-copy',
    },
    evidenceDecisionIds: ['decision-event-a'],
    evidenceTaskIds: ['task-a'],
    trigger: 'explicit_long_term_intent',
    status: 'pending',
    proposedAt: '2026-07-30T03:50:00.000Z',
    source: {
      conversationId: 'conversation-a',
      sourceTurnId: 'turn-a',
      messageRange: { start: 12, end: 19 },
    },
  });
});

test('record rejects every preference proposal without a complete conversation pointer', async () => {
  const service = new ReuseMemoryService(
    new MemoryReuseMemoryRepository(),
    { async verifyCandidate() {}, async verifyRevision() {} },
  );
  const port = new ReuseMemoryRecordProposalPort(service, {
    async check() {
      return { allowed: true, failures: [] };
    },
  });
  const base = {
    kind: 'propose_preference',
    payload: {
      defaultScope: { storeId: 'store-a' },
      proposedValue: '克制',
      semanticKey: 'tone.default',
    },
    workspaceId: 'workspace-a',
    idempotencyKey: 'record-preference-a',
  };
  const incompleteProvenance: Record<string, string>[] = [
    {},
    {
      sourceConversationId: 'conversation-a',
      sourceTurnId: 'turn-a',
    },
  ];
  for (const provenance of incompleteProvenance) {
    await assert.rejects(port.propose({ ...base, provenance, execution }));
  }
});

test('record blocks a canonical redline before candidate persistence and audits the gate', async () => {
  const repository = new MemoryReuseMemoryRepository();
  const service = new ReuseMemoryService(
    repository,
    { async verifyCandidate() {}, async verifyRevision() {} },
  );
  const violations: Array<{ gateId: string; candidateId: string }> = [];
  const port = new ReuseMemoryRecordProposalPort(
    service,
    new CanonicalMemoryProposalRedline(
      {
        async resolve({ workspaceId, candidateId }) {
          return {
            phase: 'execution',
            bundle: { workspaceId, revision: 1 },
            brief: {},
            candidate: {
              candidateId,
              workspaceId,
              intendedUse: 'internal_draft',
              factClaims: [],
              assetRefs: [],
            },
            sourceRefs: [],
            rightsRefs: [],
            identityRefs: [],
          };
        },
      },
      {
        async append({ gateId, candidateId }) {
          violations.push({ gateId, candidateId });
        },
      },
    ),
  );

  await assert.rejects(
    port.propose({
      kind: 'propose_preference',
      payload: {
        defaultScope: { storeId: 'store-a' },
        proposedValue: '本月买一送一，名额有限',
        semanticKey: 'offer.default',
      },
      provenance: {
        messageRange: { start: 0, end: 0 },
        sourceConversationId: 'conversation-a',
        sourceTurnId: 'turn-a',
      },
      workspaceId: 'workspace-a',
      idempotencyKey: 'redline-a',
      execution,
    }),
    /critical_fact_source/u,
  );

  assert.deepEqual(
    await repository.listPreferenceCandidates('workspace-a'),
    [],
  );
  assert.deepEqual(violations, [
    {
      candidateId:
        'preference-candidate-50a1801e2d9799fc836c474a',
      gateId: 'critical_fact_source',
    },
  ]);
});
