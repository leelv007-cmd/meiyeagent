import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdminProviderCredentialControl } from './admin-provider-credential-control';
import { p1QueryKeys } from './query-keys';

test('shows redacted provider credential test results without claiming activation', () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    p1QueryKeys.request('integrations', 'admin_provider_credentials'),
    [
      {
        id: 'platform:model.direct',
        status: 'available',
        credential: {
          mask: '••••••••',
          scope: ['models.read'],
          status: 'active',
          testedAt: '2026-07-15T10:00:00.000Z',
          testErrorCode: 'http_401',
          testStatus: 'unauthorized',
          version: 2,
        },
        updatedAt: '2026-07-15T10:00:00.000Z',
      },
    ]
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminProviderCredentialControl />
    </QueryClientProvider>
  );

  assert.match(html, /测试连接/);
  assert.match(html, /鉴权失败/);
  assert.match(html, /连接测试不等于模型激活/);
  assert.match(html, /重启后生效/);
  assert.doesNotMatch(html, /provider-test-secret|secretRef/);
});

test('shows boot-time credential sources and flags env fallback', () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    p1QueryKeys.request('integrations', 'admin_provider_credentials'),
    [
      {
        effectiveSource: 'env_fallback',
        id: 'platform:model.direct',
        status: 'available',
        credential: {
          mask: '••••••••',
          scope: ['models.read'],
          status: 'active',
          version: 2,
        },
        updatedAt: '2026-07-15T10:00:00.000Z',
      },
      {
        effectiveSource: 'vault',
        id: 'platform:ark.media',
        status: 'available',
        credential: {
          mask: '••••••••',
          scope: ['media.generate'],
          status: 'active',
          version: 3,
        },
        updatedAt: '2026-07-15T10:00:00.000Z',
      },
      {
        effectiveSource: 'env',
        id: 'platform:douyin.platform',
        status: 'available',
        credential: {
          mask: '••••••••',
          scope: ['provider.connect'],
          status: 'active',
          version: 1,
        },
        updatedAt: '2026-07-15T10:00:00.000Z',
      },
    ],
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminProviderCredentialControl />
    </QueryClientProvider>,
  );

  assert.match(html, /当前生效来源：保险箱/);
  assert.match(html, /当前生效来源：环境变量/);
  assert.match(html, /环境变量回退（保险箱未接管）/);
});
