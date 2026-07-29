import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluatePurePredicate } from './pure-predicate.js';

test('pure predicates receive a frozen fact snapshot and cannot mutate caller state', () => {
  const facts = {
    limit: 2,
    consumption: {
      iterations: 2,
    },
  };

  const matched = evaluatePurePredicate(facts, (snapshot) => {
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.consumption), true);
    assert.throws(() => {
      (snapshot.consumption as { iterations: number }).iterations = 3;
    }, TypeError);
    return snapshot.consumption.iterations >= snapshot.limit;
  });

  assert.equal(matched, true);
  assert.equal(facts.consumption.iterations, 2);
});

test('pure predicates reject async and non-boolean decisions', () => {
  assert.throws(
    () =>
      evaluatePurePredicate(
        { value: 1 },
        (async () => true) as unknown as () => boolean,
      ),
    /synchronously return a boolean/u,
  );
  assert.throws(
    () =>
      evaluatePurePredicate(
        { value: 1 },
        (() => 'yes') as unknown as () => boolean,
      ),
    /synchronously return a boolean/u,
  );
});
