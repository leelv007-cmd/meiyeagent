import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGENT_CANONICAL_OWNERSHIP_MATRIX,
  AGENT_SEMANTIC_FACTS,
  findDuplicateSemanticFactWriters,
} from './agent-ownership.js';

test('ownership matrix covers every declared semantic fact exactly once', () => {
  const facts = AGENT_CANONICAL_OWNERSHIP_MATRIX.map(
    (entry) => entry.semanticFact,
  );
  assert.deepEqual([...facts].sort(), [...AGENT_SEMANTIC_FACTS].sort());
  assert.equal(new Set(facts).size, facts.length);
});

test('ownership matrix has one writer per semantic fact (no dual-write)', () => {
  assert.deepEqual(findDuplicateSemanticFactWriters(), []);
});

test('constructive dual-writer matrix is detected', () => {
  const poisoned = [
    ...AGENT_CANONICAL_OWNERSHIP_MATRIX,
    {
      semanticFact: 'agent_thread' as const,
      writer: 'AgentRunStore' as const,
      note: 'illegal second writer',
    },
  ];
  assert.deepEqual(findDuplicateSemanticFactWriters(poisoned), [
    'agent_thread',
  ]);
});
