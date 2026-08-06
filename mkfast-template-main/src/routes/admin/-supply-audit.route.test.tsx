import assert from 'node:assert/strict';
import test from 'node:test';

import { renderToStaticMarkup } from 'react-dom/server';

import { SupplyAuditTable } from '@/components/admin/supply/supply-audit-table';

test('supply audit renders the immutable operator reason and correlation', () => {
  const html = renderToStaticMarkup(
    <SupplyAuditTable
      changes={[
        {
          action: 'isolate',
          actorId: 'admin-a',
          at: '2026-07-20T00:00:00.000Z',
          correlationId: 'corr-isolate-a',
          id: 'audit-isolate-a',
          summary: 'provider error rate exceeded threshold',
          targetId: 'channel-a',
          targetType: 'channel',
        },
      ]}
    />
  );

  assert.match(html, /provider error rate exceeded threshold/u);
  assert.match(html, /corr-isolate-a/u);
  assert.match(html, /channel-a/u);
  assert.match(html, /admin-a/u);
});

test('historical stop_new_tasks audit rows remain readable after D6 retirement', () => {
  const html = renderToStaticMarkup(
    <SupplyAuditTable
      changes={[
        {
          action: 'stop_new_tasks',
          actorId: 'admin-legacy',
          at: '2026-06-01T12:00:00.000Z',
          correlationId: 'corr-stop-new-tasks-legacy',
          id: 'audit-stop-new-tasks-legacy',
          summary: 'legacy stop_new_tasks before isolate consolidation',
          targetId: 'channel-legacy',
          targetType: 'channel',
        },
      ]}
    />
  );

  assert.match(html, /stop_new_tasks/u);
  assert.match(html, /legacy stop_new_tasks before isolate consolidation/u);
  assert.match(html, /corr-stop-new-tasks-legacy/u);
  assert.match(html, /channel-legacy/u);
  assert.match(html, /admin-legacy/u);
});
