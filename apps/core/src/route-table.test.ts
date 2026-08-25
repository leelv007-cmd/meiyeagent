import assert from 'node:assert/strict';
import test from 'node:test';
import { CORE_ROUTE_AUTH_CLASSES, RouteTable } from './route-table.js';

test('every Core route declares its auth class', () => {
  assert.deepEqual(Object.fromEntries(CORE_ROUTE_AUTH_CLASSES), {
    'agent-semantic-events': 'service-token',
    'agent-semantic-replay': 'service-token',
    assets: 'service-token',
    capabilities: 'public',
    'campaign-paid-work-start': 'service-token',
    'campaign-paid-work-status': 'service-token',
    'canvas-text-stream': 'service-token',
    'composer-content-package': 'service-token',
    'composer-destination-map': 'service-token',
    'composer-submissions': 'service-token',
    'composer-task-answer': 'service-token',
    'composer-task-cancel': 'service-token',
    'composer-task-events': 'service-token',
    'composer-task-revise': 'service-token',
    'composer-task-start': 'service-token',
    'diagnostic-events': 'service-token',
    'diagnostic-resume-retired': 'service-token',
    'diagnostics-create-retired': 'service-token',
    'e2e-credit-detail-fixture': 'service-token',
    'e2e-interrupt-expiry-fixture': 'service-token',
    'e2e-stalled-work-expiry-fixture': 'service-token',
    'e2e-prepare-terminal-rejection-fixture': 'service-token',
    'e2e-user-selected-skill-evidence': 'service-token',
    'e2e-user-selected-skill-fixture': 'service-token',
    health: 'public',
    'health-assembly': 'public',
    'health-ready': 'public',
    'health-worker': 'public',
    'harness-active-tasks': 'service-token',
    'harness-decision': 'service-token',
    'confirmation-create': 'service-token',
    'confirmation-list-pending': 'service-token',
    'confirmation-decide': 'service-token',
    'confirmation-expire': 'service-token',
    'harness-interaction': 'service-token',
    'harness-interaction-editing': 'service-token',
    'harness-interaction-message': 'service-token',
    'harness-interaction-renderer': 'service-token',
    'harness-product-metrics': 'service-token',
    'harness-recommendation': 'service-token',
    'harness-task-admission': 'service-token',
    'p1-commands': 'service-token',
    'p1-query': 'service-token',
    'pending-actions': 'service-token',
    'pending-interrupts-list': 'service-token',
    'pending-interrupts-resume': 'service-token',
    'product-commands': 'service-token',
    'product-state': 'service-token',
    'public-plan-catalog': 'service-token',
    'commerce-plan-catalog': 'service-token',
    'workspace-bootstrap': 'service-token',
    'workflow-events': 'service-token',
    'assistant-stream': 'service-token',
  });
  assert.equal(new Set(CORE_ROUTE_AUTH_CLASSES.map(([id]) => id)).size, 53);
});

test('two dispatches share the same sealed route table identity', async () => {
  const seen: object[] = [];
  const table = new RouteTable();
  table.add('health', [
    'GET',
    ({ url }) => url.pathname === '/health',
    'public',
    () => {
      seen.push(table.identity);
    },
  ]);
  table.seal();

  const url = new URL('http://core.local/health');
  await table.dispatch({
    authorized: false,
    ctx: undefined,
    method: 'GET',
    onUnauthorized() {
      assert.fail('public health must not authorize');
    },
    url,
  });
  await table.dispatch({
    authorized: false,
    ctx: undefined,
    method: 'GET',
    onUnauthorized() {
      assert.fail('public health must not authorize');
    },
    url,
  });

  assert.equal(table.isSealed, true);
  assert.equal(seen.length, 2);
  assert.equal(seen[0], table);
  assert.equal(seen[1], table);
  assert.equal(seen[0], seen[1]);
});

test('mutating a sealed route table fails closed', () => {
  const table = new RouteTable();
  table.add('health', [
    'GET',
    ({ url }) => url.pathname === '/health',
    'public',
    () => undefined,
  ]);
  table.seal();

  assert.throws(
    () =>
      table.add('capabilities', [
        'GET',
        ({ url }) => url.pathname === '/capabilities',
        'public',
        () => undefined,
      ]),
    { message: 'Route table is sealed.' },
  );
  assert.throws(
    () =>
      (
        table as unknown as { entries: unknown[] }
      ).entries.push({}),
    TypeError,
  );
});
