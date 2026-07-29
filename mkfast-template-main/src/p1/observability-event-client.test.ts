import assert from 'node:assert/strict';
import test from 'node:test';

import {
  submitObservabilityEvent,
  type MerchantObservabilityEvent,
} from './observability-event-command.js';

const event: MerchantObservabilityEvent = {
  eventType: 'delivery_rating.recorded',
  taskId: 'task-248',
  payload: {
    packageId: 'package-248',
    versionId: 'version-3',
    revision: 3,
    verdict: 'up',
  },
};

test('the observability client reuses the authenticated P1 command route', async () => {
  const calls: unknown[] = [];
  const result = await submitObservabilityEvent(
    async (...args) => {
      calls.push(args);
      return { accepted: true };
    },
    event,
    'feedback-248'
  );

  assert.deepEqual(result, { accepted: true });
  assert.deepEqual(calls, [
    [
      'creation-experience',
      {
        action: 'event_append',
        payload: event,
      },
      'feedback-248',
    ],
  ]);
});
