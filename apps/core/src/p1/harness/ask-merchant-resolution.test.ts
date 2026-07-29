import assert from 'node:assert/strict';
import test from 'node:test';

import {
  askMerchantAnswerSchema,
  askMerchantQuestionRequestSchema,
} from '@meiye/contracts';

import { resolveAskMerchantAnswer } from './ask-merchant-resolution.js';

test('offered labels enter resume data without their merchant-only descriptions', () => {
  const request = askMerchantQuestionRequestSchema.parse({
    requestId: 'request-1',
    runId: 'run-1',
    step: 'intent_naming',
    revision: 3,
    kind: 'ask_merchant',
    questions: [
      {
        itemId: 'service',
        question: '这次主推哪个项目？',
        options: [
          {
            label: '头皮护理',
            description: '适合本周团购活动。',
          },
          { label: '染发' },
        ],
        fallback: { kind: 'deferred' },
      },
    ],
    groupSkip: true,
    presentation: {
      carriers: ['conversation'],
      blocking: 'none',
      notification: 'none',
    },
  });
  const answer = askMerchantAnswerSchema.parse({
    requestId: 'request-1',
    revision: 3,
    idempotencyKey: 'answer-1',
    resume: { runId: 'run-1', step: 'intent_naming' },
    response: {
      kind: 'answer',
      items: [
        {
          itemId: 'service',
          result: { kind: 'answer', value: '头皮护理' },
        },
      ],
    },
  });

  assert.deepEqual(resolveAskMerchantAnswer(request, answer), {
    kind: 'resume',
    runId: 'run-1',
    step: 'intent_naming',
    resumeData: {
      kind: 'answer',
      items: [
        {
          itemId: 'service',
          result: { kind: 'answer', value: '头皮护理' },
        },
      ],
    },
  });
});

test('one skipped response resumes the whole question group', () => {
  const request = askMerchantQuestionRequestSchema.parse({
    requestId: 'request-2',
    runId: 'run-2',
    step: 'context_injection',
    revision: 1,
    kind: 'ask_merchant',
    questions: [
      {
        itemId: 'service',
        question: '这次主推哪个项目？',
        fallback: { kind: 'deferred' },
      },
      {
        itemId: 'window',
        question: '活动到哪天结束？',
        fallback: { kind: 'deferred' },
      },
    ],
    groupSkip: true,
    presentation: {
      carriers: ['conversation'],
      blocking: 'none',
      notification: 'none',
    },
  });
  const answer = askMerchantAnswerSchema.parse({
    requestId: 'request-2',
    revision: 1,
    idempotencyKey: 'answer-2',
    resume: { runId: 'run-2', step: 'context_injection' },
    response: { kind: 'skipped' },
  });

  assert.deepEqual(resolveAskMerchantAnswer(request, answer), {
    kind: 'resume',
    runId: 'run-2',
    step: 'context_injection',
    resumeData: { kind: 'skipped' },
  });
});

test('malformed answers become a new question revision without throwing', () => {
  const request = askMerchantQuestionRequestSchema.parse({
    requestId: 'request-3',
    runId: 'run-3',
    step: 'context_injection',
    revision: 4,
    kind: 'ask_merchant',
    questions: [
      {
        itemId: 'window',
        question: '活动到哪天结束？',
        fallback: { kind: 'deferred' },
      },
    ],
    groupSkip: true,
    presentation: {
      carriers: ['store_page'],
      blocking: 'none',
      notification: 'none',
    },
  });

  assert.deepEqual(resolveAskMerchantAnswer(request, { unexpected: true }), {
    kind: 'reask',
    request: { ...request, revision: 5 },
  });
});

test('reask advances the frozen semantic-default condition revision', () => {
  const request = askMerchantQuestionRequestSchema.parse({
    requestId: 'request-semantic-reask',
    runId: 'run-semantic-reask',
    step: 'context_injection',
    revision: 4,
    kind: 'ask_merchant',
    questions: [
      {
        itemId: 'window',
        question: '活动到哪天结束？',
        fallback: { kind: 'deferred' },
      },
    ],
    groupSkip: true,
    timeoutPolicy: {
      kind: 'semantic_default',
      timeoutSeconds: 30,
      eligibility: {
        kind: 'safe',
        serverEvaluated: true,
        effect: 'none',
        quota: 'not_applicable',
        defaultResponse: {
          kind: 'answer',
          items: [
            { itemId: 'window', result: { kind: 'deferred' } },
          ],
        },
        defaultResponseFingerprint: '0'.repeat(64),
        policyRevision: 'ask-semantic-default/v1',
        conditionRevision: 'request-semantic-reask:r4',
      },
    },
    presentation: {
      carriers: ['conversation'],
      blocking: 'none',
      notification: 'none',
      renderer: 'ask_merchant_group',
    },
  });

  const resolution = resolveAskMerchantAnswer(request, {
    unexpected: true,
  });

  assert.equal(resolution.kind, 'reask');
  assert.equal(
    resolution.kind === 'reask'
      ? resolution.request.timeoutPolicy?.kind === 'semantic_default'
        ? resolution.request.timeoutPolicy.eligibility.conditionRevision
        : null
      : null,
    'request-semantic-reask:r5',
  );
});

test('free text and per-item deferred results resume together', () => {
  const request = askMerchantQuestionRequestSchema.parse({
    requestId: 'request-4',
    runId: 'run-4',
    step: 'context_injection',
    revision: 2,
    kind: 'ask_merchant',
    questions: [
      {
        itemId: 'service',
        question: '这次主推哪个项目？',
        fallback: { kind: 'deferred' },
      },
      {
        itemId: 'window',
        question: '活动到哪天结束？',
        fallback: { kind: 'deferred' },
      },
    ],
    groupSkip: true,
    presentation: {
      carriers: ['conversation'],
      blocking: 'none',
      notification: 'none',
    },
  });
  const answer = {
    requestId: 'request-4',
    revision: 2,
    idempotencyKey: 'answer-4',
    resume: { runId: 'run-4', step: 'context_injection' },
    response: {
      kind: 'answer',
      items: [
        {
          itemId: 'service',
          result: { kind: 'answer', value: '自定义护理项目' },
        },
        { itemId: 'window', result: { kind: 'deferred' } },
      ],
    },
  } as const;

  assert.deepEqual(resolveAskMerchantAnswer(request, answer), {
    kind: 'resume',
    runId: 'run-4',
    step: 'context_injection',
    resumeData: answer.response,
  });
});

test('invalid offered labels reask while stale resume identities fail closed', () => {
  const request = askMerchantQuestionRequestSchema.parse({
    requestId: 'request-5',
    runId: 'run-5',
    step: 'intent_naming',
    revision: 7,
    kind: 'ask_merchant',
    questions: [
      {
        itemId: 'service',
        question: '这次主推哪个项目？',
        options: [{ label: '头皮护理' }],
        fallback: { kind: 'deferred' },
      },
    ],
    groupSkip: true,
    presentation: {
      carriers: ['conversation'],
      blocking: 'none',
      notification: 'none',
    },
  });
  const answer = {
    requestId: 'request-5',
    revision: 7,
    idempotencyKey: 'answer-5',
    resume: { runId: 'run-5', step: 'intent_naming' },
    response: {
      kind: 'answer',
      items: [
        {
          itemId: 'service',
          result: { kind: 'answer', value: '浏览器伪造选项' },
        },
      ],
    },
  } as const;

  assert.deepEqual(resolveAskMerchantAnswer(request, answer), {
    kind: 'reask',
    request: { ...request, revision: 8 },
  });
  assert.deepEqual(
    resolveAskMerchantAnswer(request, { ...answer, revision: 6 }),
    { kind: 'stale' },
  );
});
