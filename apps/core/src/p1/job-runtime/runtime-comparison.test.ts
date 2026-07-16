import assert from 'node:assert/strict';
import { it } from 'node:test';
import { POSTGRES_JOB_RUNTIME_COMPARISON } from './runtime-comparison.js';

it('records the evidence-backed pg-boss versus Graphile Worker decision', () => {
  assert.equal(POSTGRES_JOB_RUNTIME_COMPARISON.recommendation, 'pg-boss');
  assert.deepEqual(
    POSTGRES_JOB_RUNTIME_COMPARISON.dimensions.map((item) => item.dimension),
    ['migration', 'connection_pool', 'cron', 'lease', 'retry_dlq', 'cancellation', 'observability']
  );
  assert.match(POSTGRES_JOB_RUNTIME_COMPARISON.summary, /Graphile Worker.*control/i);
});
