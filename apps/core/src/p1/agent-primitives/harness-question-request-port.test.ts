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

test('the production question adapter validates and durably groups the canonical card', async () => {
  const registered: unknown[] = [];
  const port = new HarnessQuestionRequestPort({
    async register(workspaceId, request) {
      registered.push({ request, workspaceId });
    },
  });

  const result = await port.request({
    options: question.options.map(({ description, label }) => ({
      description,
      label,
    })),
    question: question.question,
    serverContext,
  });

  assert.deepEqual(result, { requestRef: question.questionId });
  assert.deepEqual(registered, [
    {
      workspaceId: 'workspace-a',
      request: {
        requestId: question.questionId,
        runId: question.workflowId,
        step: 'intent_naming',
        revision: question.workflowRevision,
        kind: 'ask_merchant',
        questions: [
          {
            itemId: 'offer',
            question: question.question,
            options: [
              {
                description:
                  'Feature the current introductory package.',
                label: 'New customer offer',
              },
            ],
            fallback: { kind: 'deferred' },
          },
        ],
        groupSkip: true,
        timeoutPolicy: {
          kind: 'hold',
          reason: 'unknown',
          serverEvaluated: true,
        },
        presentation: {
          carriers: ['conversation', 'store_page'],
          blocking: 'none',
          notification: 'none',
          renderer: 'ask_merchant_group',
        },
      },
    },
  ]);
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
    const port = new HarnessQuestionRequestPort({
      async register() {
        throw new Error('invalid input must not be registered');
      },
    });

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
  const port = new HarnessQuestionRequestPort({
    async register() {
      throw new Error('invalid input must not be registered');
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
});
