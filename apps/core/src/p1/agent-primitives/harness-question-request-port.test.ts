import assert from 'node:assert/strict';
import test from 'node:test';

import type { QuestionCard } from '@meiye/contracts';

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
  taskId: 'task-ask-1',
  observability: {
    axisScope: 'execution_child',
    catalogRevision: { kind: 'bound', value: 'catalog-2026-07-29' },
    promptVersion: { kind: 'bound', value: 'marketing/copy@v4' },
    scene: { kind: 'bound', value: 'copy.ask_merchant' },
    skillRevision: { kind: 'bound', value: 'copywriter@rev-17' },
  },
  workspaceId: 'workspace-a',
};

test('the production question adapter validates without becoming a pending writer', async () => {
  const port = new HarnessQuestionRequestPort();

  const result = await port.request({
    options: question.options.map(({ label }) => ({ label })),
    question: question.question,
    serverContext,
  });

  assert.deepEqual(result, { requestRef: question.questionId });
});

test('the production question adapter rejects model text that differs from the canonical card', async () => {
  for (const modelInput of [
    {
      options: question.options.map(({ label }) => ({ label })),
      question: 'Which service should this post feature?',
    },
    {
      options: [{ label: 'Legacy offer' }],
      question: question.question,
    },
    {
      options: question.options.map(({ description, label }) => ({
        description,
        label,
      })),
      question: question.question,
    },
    {
      question: question.question,
    },
  ]) {
    const port = new HarnessQuestionRequestPort();

    await assert.rejects(
      port.request({
        ...modelInput,
        serverContext,
      }),
      /does not match the canonical Harness QuestionCard/u,
    );
  }
});

test('the production question adapter requires server-owned canonical Harness context', async () => {
  const port = new HarnessQuestionRequestPort();
  const { harness: _harness, ...withoutHarness } = serverContext;

  await assert.rejects(
    port.request({
      question: question.question,
      serverContext: withoutHarness,
    }),
    /Canonical Harness question context is required/u,
  );
});
