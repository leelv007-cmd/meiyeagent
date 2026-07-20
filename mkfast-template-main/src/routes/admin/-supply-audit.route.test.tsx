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
