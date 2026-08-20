import assert from 'node:assert/strict';
import test from 'node:test';
import { LateBound, sealLateBounds } from './late-bound.js';

test('LateBound bind then seal returns the port', () => {
  const bound = new LateBound<string>('operationsService');
  bound.bind('ready');
  assert.equal(bound.bound, true);
  assert.equal(bound.seal(), 'ready');
  assert.equal(bound.sealed, true);
  assert.equal(bound.value, 'ready');
});

test('seal fails closed when a required LateBound is missing', () => {
  const bound = new LateBound<string>('sessionRetrievalExperience');
  assert.equal(bound.bound, false);
  assert.throws(() => bound.seal(), {
    message: 'missing required port: sessionRetrievalExperience',
  });
  assert.throws(() => bound.value, {
    message: 'sessionRetrievalExperience is not bound',
  });
});

test('bind is refused after seal', () => {
  const bound = new LateBound<number>('jobRuntime');
  bound.bind(1);
  bound.seal();
  assert.throws(() => bound.bind(2), { message: 'jobRuntime is sealed' });
});

test('sealLateBounds reports every missing required port', () => {
  const experience = new LateBound<string>('sessionRetrievalExperience');
  const operations = new LateBound<string>('operationsService');
  operations.bind('ops');
  assert.throws(() => sealLateBounds([experience, operations]), {
    message: 'missing required port: sessionRetrievalExperience',
  });
  experience.bind('memory');
  sealLateBounds([experience, operations]);
  assert.equal(experience.sealed, true);
  assert.equal(operations.sealed, true);
});
