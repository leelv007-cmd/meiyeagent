import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTelemetryEvent,
  normalizeTelemetryPath,
} from './product-telemetry';

test('keeps telemetry on an allowlist and strips object ids, queries, and content', () => {
  const event = buildTelemetryEvent(
    'api_request',
    {
      durationMs: 12.345,
      endpoint: '/api/core/p1/query?prompt=private-content',
      method: 'POST',
      prompt: 'must never leave the browser',
      status: 403,
    },
    { releaseVersion: 'candidate-a', schemaRevision: 'uiux-p1-v1' }
  );

  assert.deepEqual(event, {
    durationMs: 12.3,
    endpoint: '/api/core/p1/query',
    event: 'api_request',
    method: 'POST',
    releaseVersion: 'candidate-a',
    schemaRevision: 'uiux-p1-v1',
    schemaVersion: 'uiux-telemetry-v1',
    status: 403,
  });
  assert.equal(JSON.stringify(event).includes('private-content'), false);
  assert.equal(JSON.stringify(event).includes('must never'), false);
});

test('normalizes canonical object routes without retaining private ids', () => {
  assert.equal(
    normalizeTelemetryPath('/dashboard/jobs/job-private?tab=result'),
    '/dashboard/jobs/:id'
  );
  assert.equal(
    normalizeTelemetryPath('/dashboard/handoff/private-token'),
    '/dashboard/handoff/:token'
  );
});

test('identity state telemetry records only the explicit three-state outcome', () => {
  const event = buildTelemetryEvent(
    'identity_state',
    {
      identityId: 'private-identity-id',
      state: 'query_failed',
    },
    { releaseVersion: 'candidate-a', schemaRevision: 'uiux-p1-v1' }
  );

  assert.equal(event.state, 'query_failed');
  assert.equal('identityId' in event, false);
});
