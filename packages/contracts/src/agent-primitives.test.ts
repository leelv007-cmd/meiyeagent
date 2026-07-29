import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGENT_PRIMITIVE_IDS,
  agentPrimitiveInputSchemas,
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
