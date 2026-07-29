import assert from 'node:assert/strict';
import test from 'node:test';

import type { AgentPrimitiveServerContext } from './runtime.js';
import {
  AskMerchantPrimitiveHandler,
  type MerchantQuestionRequestPort,
} from './ask-merchant-handler.js';

const serverContext: AgentPrimitiveServerContext = {
  actorId: 'worker-agent-primitives',
  correlationId: 'correlation-ask-1',
  idempotencyKey: 'primitive-ask-1',
  observability: {
    catalogRevision: 'catalog-2026-07-29',
    promptVersion: 'marketing/copy@v4',
    scene: 'copy.ask_merchant',
    skillRevision: 'copywriter@rev-17',
  },
  workspaceId: 'workspace-a',
};

test('ask_merchant returns after the nonblocking request is registered without waiting for an answer', async () => {
  const unresolvedAnswer = new Promise<never>(() => {});
  const requests: Parameters<MerchantQuestionRequestPort['request']>[0][] = [];
  const handler = new AskMerchantPrimitiveHandler({
    async request(input) {
      requests.push(input);
      return {
        answer: unresolvedAnswer,
        requestRef: 'merchant-question:question-1',
      };
    },
  });

  const result = await handler.execute({
    input: {
      options: [
        {
          description: 'Feature the current introductory package.',
          label: 'New customer offer',
        },
      ],
      question: 'Which offer should this post feature?',
    },
    serverContext,
  });

  assert.deepEqual(result, {
    requestRef: 'merchant-question:question-1',
    status: 'requested',
  });
  assert.deepEqual(requests, [
    {
      options: [
        {
          description: 'Feature the current introductory package.',
          label: 'New customer offer',
        },
      ],
      question: 'Which offer should this post feature?',
      serverContext,
    },
  ]);
});

test('ask_merchant fails closed when request registration returns no reference', async () => {
  const handler = new AskMerchantPrimitiveHandler({
    async request() {
      return { requestRef: '   ' };
    },
  });

  await assert.rejects(
    handler.execute({
      input: { question: 'Which offer should this post feature?' },
      serverContext,
    }),
    /request reference/u,
  );
});
