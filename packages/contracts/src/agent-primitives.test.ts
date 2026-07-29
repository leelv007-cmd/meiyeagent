import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGENT_PRIMITIVE_IDS,
  agentPrimitiveInputSchemas,
  askMerchantAnswerSchema,
  askMerchantQuestionRequestSchema,
} from './index.js';

const EXPECTED_AGENT_PRIMITIVE_IDS = [
  'read_context',
  'generate',
  'revise',
  'record',
  'check',
  'ask_merchant',
] as const;

const VALID_PAYLOADS = {
  read_context: {
    scope: 'workspace.current-facts',
    query: {
      text: '本周有效的团购事实',
      offset: 0,
      limit: 20,
    },
  },
  generate: {
    kind: 'material.parse.v2',
    brief: { sourceAssetRef: 'asset-1' },
  },
  revise: {
    target_ref: 'content-package:package-1@3',
    instruction: '保留事实，只缩短标题。',
  },
  record: {
    kind: 'preference.proposal.v2',
    payload: { tone: 'concise' },
    provenance: { sourceRef: 'task-1' },
  },
  check: {
    target_ref: 'candidate:candidate-1',
    rulesets: ['platform.xiaohongshu.latest', 'structure.note.v2'],
  },
  ask_merchant: {
    question: '这次主推哪个项目？',
    options: [
      {
        label: '头皮护理',
        description: '适合本周团购活动。',
      },
      { label: '暂未确定' },
    ],
  },
} as const;

test('exports the exact six substrate primitive contracts', () => {
  assert.deepEqual(AGENT_PRIMITIVE_IDS, EXPECTED_AGENT_PRIMITIVE_IDS);
  assert.deepEqual(
    Object.keys(agentPrimitiveInputSchemas),
    EXPECTED_AGENT_PRIMITIVE_IDS,
  );

  for (const primitiveId of EXPECTED_AGENT_PRIMITIVE_IDS) {
    assert.deepEqual(
      agentPrimitiveInputSchemas[primitiveId].parse(
        VALID_PAYLOADS[primitiveId],
      ),
      VALID_PAYLOADS[primitiveId],
    );
  }
});

test('keeps domain vocabulary open in primitive payloads', () => {
  assert.equal(
    agentPrimitiveInputSchemas.generate.parse({
      kind: 'future-output-kind.not-known-to-core',
      brief: {},
    }).kind,
    'future-output-kind.not-known-to-core',
  );
  assert.equal(
    agentPrimitiveInputSchemas.read_context.parse({
      scope: 'future-context-scope',
    }).scope,
    'future-context-scope',
  );
  assert.equal(
    agentPrimitiveInputSchemas.record.parse({
      kind: 'future-proposal-kind',
      payload: {},
      provenance: {},
    }).kind,
    'future-proposal-kind',
  );
  assert.deepEqual(
    agentPrimitiveInputSchemas.check.parse({
      target_ref: 'candidate:future',
      rulesets: ['future.ruleset'],
    }).rulesets,
    ['future.ruleset'],
  );
});

test('keeps read pagination bounded inside the optional query', () => {
  assert.deepEqual(
    agentPrimitiveInputSchemas.read_context.parse({
      scope: 'workspace.assets',
      query: { offset: 20, limit: 10 },
    }),
    {
      scope: 'workspace.assets',
      query: { offset: 20, limit: 10 },
    },
  );
  assert.throws(
    () =>
      agentPrimitiveInputSchemas.read_context.parse({
        scope: 'workspace.assets',
        query: { offset: -1, limit: 10 },
      }),
    /offset/u,
  );
  assert.throws(
    () =>
      agentPrimitiveInputSchemas.read_context.parse({
        scope: 'workspace.assets',
        query: { offset: 0, limit: 0 },
      }),
    /limit/u,
  );
});

test('accepts only JSON values for opaque model payloads', () => {
  assert.throws(
    () =>
      agentPrimitiveInputSchemas.generate.parse({
        kind: 'copy',
        brief: undefined,
      }),
    /brief/u,
  );
  assert.throws(
    () =>
      agentPrimitiveInputSchemas.record.parse({
        kind: 'preference.proposal',
        payload: () => 'not-json',
        provenance: {},
      }),
    /payload/u,
  );
});

test('requires every field named by the primitive signatures', () => {
  assert.throws(
    () => agentPrimitiveInputSchemas.read_context.parse({}),
    /scope/u,
  );
  assert.throws(
    () => agentPrimitiveInputSchemas.generate.parse({ kind: 'copy' }),
    /brief/u,
  );
  assert.throws(
    () =>
      agentPrimitiveInputSchemas.revise.parse({
        target_ref: 'candidate:1',
      }),
    /instruction/u,
  );
  assert.throws(
    () =>
      agentPrimitiveInputSchemas.record.parse({
        kind: 'preference.proposal',
        provenance: {},
      }),
    /payload/u,
  );
  assert.throws(
    () =>
      agentPrimitiveInputSchemas.record.parse({
        kind: 'preference.proposal',
        payload: {},
      }),
    /provenance/u,
  );
  assert.throws(
    () => agentPrimitiveInputSchemas.check.parse({}),
    /target_ref/u,
  );
  assert.throws(
    () => agentPrimitiveInputSchemas.ask_merchant.parse({}),
    /question/u,
  );
});

test('rejects tenant and billing identity fields from every model payload', () => {
  for (const primitiveId of EXPECTED_AGENT_PRIMITIVE_IDS) {
    for (const forbiddenField of [
      'workspaceId',
      'actorId',
      'productUsageTaskId',
      'quoteId',
    ]) {
      assert.throws(
        () =>
          agentPrimitiveInputSchemas[primitiveId].parse({
            ...VALID_PAYLOADS[primitiveId],
            [forbiddenField]: 'forged-by-model',
          }),
        /Unrecognized key/u,
      );
    }
  }
});

test('allows only label and description in merchant options', () => {
  assert.throws(
    () =>
      agentPrimitiveInputSchemas.ask_merchant.parse({
        question: '请选择',
        options: [
          {
            label: '选项一',
            description: '给商家看的说明',
            value: 'model-controlled-value',
          },
        ],
      }),
    /Unrecognized key/u,
  );
});

test('merchant question requests group free-text items under one durable resume identity', () => {
  const request = {
    requestId: 'request-1',
    runId: 'run-1',
    step: 'intent_naming',
    revision: 3,
    kind: 'ask_merchant',
    questions: [
      {
        itemId: 'service',
        question: '这次主推哪个项目？',
        fallback: { kind: 'deferred' },
      },
    ],
    groupSkip: true,
    presentation: {
      carriers: ['conversation', 'store_page'],
      blocking: 'none',
      notification: 'none',
    },
  } as const;

  assert.deepEqual(askMerchantQuestionRequestSchema.parse(request), request);
  assert.equal(
    askMerchantQuestionRequestSchema.safeParse({
      ...request,
      questions: [{ ...request.questions[0], options: [] }],
    }).success,
    false,
  );
  assert.equal(
    askMerchantQuestionRequestSchema.safeParse({
      ...request,
      questions: [request.questions[0], request.questions[0]],
    }).success,
    false,
  );
  assert.equal(
    askMerchantQuestionRequestSchema.safeParse({
      ...request,
      questions: [
        {
          ...request.questions[0],
          options: [
            { label: '头皮护理' },
            { label: '头皮护理', description: '重复语义值' },
          ],
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    askMerchantQuestionRequestSchema.safeParse({
      ...request,
      questions: [
        {
          ...request.questions[0],
          options: [{ label: 'a'.repeat(501) }],
        },
      ],
    }).success,
    false,
  );
});

test('merchant semantic defaults require explicit server-owned safe authority', () => {
  const request = {
    requestId: 'request-safe-default',
    runId: 'run-safe-default',
    step: 'context_injection',
    revision: 1,
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
      },
    },
    presentation: {
      carriers: ['conversation'],
      blocking: 'none',
      notification: 'none',
      renderer: 'ask_merchant_group',
    },
  } as const;

  assert.deepEqual(askMerchantQuestionRequestSchema.parse(request), request);
  assert.equal(
    askMerchantQuestionRequestSchema.safeParse({
      ...request,
      timeoutPolicy: {
        kind: 'semantic_default',
        timeoutSeconds: 30,
      },
    }).success,
    false,
  );
});

test('merchant answers separate item results from one group-level skip', () => {
  const base = {
    requestId: 'request-1',
    revision: 3,
    idempotencyKey: 'answer-1',
    resume: { runId: 'run-1', step: 'intent_naming' },
  } as const;
  const answer = {
    ...base,
    response: {
      kind: 'answer',
      items: [
        {
          itemId: 'service',
          result: { kind: 'answer', value: '头皮护理' },
        },
        {
          itemId: 'campaign_window',
          result: { kind: 'deferred' },
        },
      ],
    },
  } as const;

  assert.deepEqual(askMerchantAnswerSchema.parse(answer), answer);
  assert.deepEqual(
    askMerchantAnswerSchema.parse({
      ...base,
      response: { kind: 'skipped' },
    }).response,
    { kind: 'skipped' },
  );
  assert.equal(
    askMerchantAnswerSchema.safeParse({
      ...answer,
      response: {
        ...answer.response,
        items: [
          {
            itemId: 'service',
            result: {
              kind: 'answer',
              value: '头皮护理',
              description: '只给商家看的说明',
            },
          },
        ],
      },
    }).success,
    false,
  );
  assert.equal(
    askMerchantAnswerSchema.safeParse({
      ...answer,
      response: {
        ...answer.response,
        items: [answer.response.items[0], answer.response.items[0]],
      },
    }).success,
    false,
  );
});
