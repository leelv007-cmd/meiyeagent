import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';

import { p1QueryKeys } from '@/p1/query-keys';

import { DashboardBalanceCard } from './dashboard-balance-card';

test('dashboard renders the three public balances without provider metering', () => {
  const client = new QueryClient();
  client.setQueryData(p1QueryKeys.request('entitlements', 'balance'), {
    copy: {
      allowance: 12,
      available: 9,
      committed: 2,
      released: 0,
      reserved: 1,
    },
    image: {
      allowance: 7,
      available: 5,
      committed: 2,
      released: 0,
      reserved: 0,
    },
    video: {
      allowance: 2,
      available: 1,
      committed: 1,
      released: 0,
      reserved: 0,
    },
  });

  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <DashboardBalanceCard />
    </QueryClientProvider>
  );

  assert.match(html, /data-testid="dashboard-balance"/u);
  assert.match(html, /data-bucket="copy"[^>]*>[\s\S]*文案[\s\S]*9/u);
  assert.match(html, /data-bucket="image"[^>]*>[\s\S]*图片[\s\S]*5/u);
  assert.match(html, /data-bucket="video"[^>]*>[\s\S]*视频[\s\S]*1/u);
  assert.doesNotMatch(
    html,
    /provider|billingMode|cost|micros|token|second|audio/iu
  );
});
