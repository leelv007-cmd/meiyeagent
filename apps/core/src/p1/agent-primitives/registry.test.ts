import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGENT_PRIMITIVE_IDS,
  agentPrimitiveInputSchemas,
} from '@meiye/contracts';
import {
  AGENT_PRIMITIVE_DEFINITIONS,
  AgentPrimitiveRegistry,
  type AgentPrimitiveDefinition,
} from './registry.js';

const EXPECTED_DEFINITIONS = [
  {
    id: 'read_context',
    sideEffectClass: 'read',
    billed: false,
  },
  {
    id: 'generate',
    sideEffectClass: 'none',
    billed: true,
  },
  {
    id: 'revise',
    sideEffectClass: 'bounded_write',
    billed: true,
  },
  {
    id: 'record',
    sideEffectClass: 'bounded_write',
    billed: false,
  },
  {
    id: 'check',
    sideEffectClass: 'none',
    billed: false,
  },
  {
    id: 'ask_merchant',
    sideEffectClass: 'none',
    billed: false,
  },
] as const;

test('registers exactly the six substrate primitives with canonical contracts', () => {
  const registry = new AgentPrimitiveRegistry(AGENT_PRIMITIVE_DEFINITIONS);

  assert.deepEqual(
    registry.list().map(({ id, sideEffectClass, billed }) => ({
      id,
      sideEffectClass,
      billed,
    })),
    EXPECTED_DEFINITIONS,
  );
  assert.deepEqual(
    registry.list().map(({ id }) => id),
    AGENT_PRIMITIVE_IDS,
  );

  for (const primitiveId of AGENT_PRIMITIVE_IDS) {
    assert.equal(
      registry.resolve(primitiveId).inputSchema,
      agentPrimitiveInputSchemas[primitiveId],
    );
  }
});

test('fails closed for unknown and merchant-only tool identifiers', () => {
  const registry = new AgentPrimitiveRegistry(AGENT_PRIMITIVE_DEFINITIONS);

  assert.throws(
    () => registry.resolve('unknown_tool'),
    /Agent primitive is not registered: unknown_tool/u,
  );
  assert.throws(
    () => registry.resolve('confirm_store'),
    /Agent primitive is not registered: confirm_store/u,
  );
  assert.throws(
    () =>
      new AgentPrimitiveRegistry([
        {
          ...AGENT_PRIMITIVE_DEFINITIONS[0],
          id: 'confirm_store',
        } as unknown as AgentPrimitiveDefinition,
      ]),
    /Agent primitive identifier is not allowed: confirm_store/u,
  );
});

test('rejects duplicate primitive identifiers', () => {
  assert.throws(
    () =>
      new AgentPrimitiveRegistry([
        ...AGENT_PRIMITIVE_DEFINITIONS,
        AGENT_PRIMITIVE_DEFINITIONS[0],
      ]),
    /Agent primitive is registered more than once: read_context/u,
  );
});

test('returns a mutation-safe inventory snapshot', () => {
  const registry = new AgentPrimitiveRegistry(AGENT_PRIMITIVE_DEFINITIONS);
  const listed = registry.list();

  listed.pop();

  assert.deepEqual(
    registry.list().map(({ id }) => id),
    AGENT_PRIMITIVE_IDS,
  );
});
