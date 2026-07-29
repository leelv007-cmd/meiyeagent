import assert from 'node:assert/strict';
import test from 'node:test';

import type { QuestionCard } from '@meiye/contracts';

import type { HarnessDecisionStore } from '../harness/decision-service.js';
import {
  HarnessQuestionRequestPort,
} from './harness-question-request-port.js';
import type { AgentPrimitiveServerContext } from './runtime.js';

const question: QuestionCard = {
  freeText: {
    enabled: true,
    placeholder: 'Tell us what should lead.',
  },
  options: [
    {
      description: 'Feature the current introductory package.',
      id: 'offer-new-customer',
      label: 'New customer offer',
    },
  ],
  question: 'Which offer should this post feature?',
  questionId: 'question-1',
  response: {
    field: 'offer',
    reason: 'The creative needs a merchant-confirmed offer.',
  },
  scope: 'current_task',
  unattended: 'hold',
  workflowId: 'workflow-1',
  workflowRevision: 3,
};

const serverContext: AgentPrimitiveServerContext = {
  actorId: 'worker-agent-primitives',
  correlationId: 'correlation-ask-1',
  harness: {
    question,
    stage: 'intent_naming',
  },
  idempotencyKey: 'primitive-ask-1',
  observability: {
    catalogRevision: 'catalog-2026-07-29',
    promptVersion: 'marketing/copy@v4',
    scene: 'copy.ask_merchant',
    skillRevision: 'copywriter@rev-17',
  },
  workspaceId: 'workspace-a',
};

test('the production question adapter registers the canonical card without a projection', async () => {
  const calls: unknown[][] = [];
  const store: Pick<HarnessDecisionStore, 'registerPending'> = {
    async registerPending(...args) {
      calls.push(args);
      return { timeoutSeconds: 120 };
    },
  };
  const port = new HarnessQuestionRequestPort(store);

  const result = await port.request({
    options: question.options.map(({ description, label }) => ({
      description,
      label,
    })),
    question: question.question,
    serverContext,
  });

  assert.deepEqual(result, { requestRef: question.questionId });
  assert.equal(calls[0]?.length, 2);
  assert.deepEqual(calls[0], [serverContext.workspaceId, question]);
});

test('the production question adapter rejects model text that differs from the canonical card', async () => {
  for (const modelInput of [
    {
      options: question.options.map(({ description, label }) => ({
        description,
        label,
      })),
      question: 'Which service should this post feature?',
    },
    {
      options: [{ label: 'New customer offer' }],
      question: question.question,
    },
    {
      question: question.question,
    },
  ]) {
    let registrations = 0;
    const port = new HarnessQuestionRequestPort({
      async registerPending() {
        registrations += 1;
      },
    });

    await assert.rejects(
      port.request({
        ...modelInput,
        serverContext,
      }),
      /does not match the canonical Harness QuestionCard/u,
    );
    assert.equal(registrations, 0);
  }
});

test('the production question adapter requires server-owned canonical Harness context', async () => {
  let registrations = 0;
  const port = new HarnessQuestionRequestPort({
    async registerPending() {
      registrations += 1;
    },
  });
  const { harness: _harness, ...withoutHarness } = serverContext;

  await assert.rejects(
    port.request({
      question: question.question,
      serverContext: withoutHarness,
    }),
    /Canonical Harness question context is required/u,
  );
  assert.equal(registrations, 0);
});
