import assert from 'node:assert/strict';
import test from 'node:test';

import type { ObservabilityEvent } from '@meiye/contracts';

import { submitObservabilityEvent } from './observability-event-command.js';

const event: ObservabilityEvent = {
  eventType: 'delivery_rating.recorded',
  taskId: 'task-248',
  skillRevision: 'copywriter@rev-17',
  promptVersion: 'marketing/copy@v4',
  catalogRevision: 'catalog-2026-07-29',
  scene: 'opening-campaign',
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
    'feedback-248',
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
