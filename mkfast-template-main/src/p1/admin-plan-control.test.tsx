import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdminPlanControl } from './admin-plan-control';
import { p1QueryKeys } from './query-keys';

test('renders audio allowance and add-on resources in the plan catalog', () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(p1QueryKeys.request('entitlements', 'catalog'), {
    addOns: [
      {
        amountMicros: 100_000,
        currency: 'CNY',
        id: 'audio-100',
        quantity: 100,
        resource: 'audio',
      },
    ],
    mode: 'recorded',
    plans: [
      {
        allowance: { audio: 8, copy: 30, image: 10, video: 5 },
        concurrencyLimit: 1,
        id: 'starter',
        queuePriority: 1,
        supportLabel: 'standard',
      },
    ],
  });

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminPlanControl />
    </QueryClientProvider>
  );

  assert.match(html, /音频/u);
  assert.match(html, /8 段/u);
  assert.match(html, /audio-100/u);
});
