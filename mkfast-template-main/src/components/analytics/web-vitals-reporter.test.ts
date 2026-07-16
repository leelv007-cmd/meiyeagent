import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildWebVitalPayload,
  normalizeRumRoute,
  webVitalRating,
} from './web-vitals-reporter';

test('normalizes object routes and removes query or fragment data', () => {
  assert.equal(
    normalizeRumRoute('/dashboard/works/work-private?tab=canvas#selection'),
    '/dashboard/works/:id'
  );
  assert.equal(
    normalizeRumRoute('/dashboard/handoff/private-token'),
    '/dashboard/handoff/:token'
  );
  assert.equal(
    normalizeRumRoute('/settings/models?section=byok'),
    '/settings/models'
  );
});

test('builds a minimal route and device payload without user content', () => {
  assert.deepEqual(
    buildWebVitalPayload({
      delta: 234.5678,
      id: 'v5-visit-id',
      name: 'LCP',
      pathname: '/dashboard/jobs/job-private',
      value: 1_234.5678,
      viewportWidth: 390,
    }),
    {
      delta: 234.568,
      device: 'mobile',
      id: 'v5-visit-id',
      name: 'LCP',
      rating: 'good',
      route: '/dashboard/jobs/:id',
      value: 1_234.568,
    }
  );
});

test('uses the locked Web Vitals thresholds', () => {
  assert.equal(webVitalRating('LCP', 2_500), 'good');
  assert.equal(webVitalRating('LCP', 2_501), 'needs-improvement');
  assert.equal(webVitalRating('INP', 200), 'good');
  assert.equal(webVitalRating('INP', 201), 'needs-improvement');
  assert.equal(webVitalRating('CLS', 0.1), 'good');
  assert.equal(webVitalRating('CLS', 0.101), 'needs-improvement');
});
