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

test('shows the most recent provider credential rotation time', () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    p1QueryKeys.request('integrations', 'admin_provider_credentials'),
    [
      {
        effectiveSource: 'vault',
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
    ]
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminProviderCredentialControl />
    </QueryClientProvider>
  );

  // Match the runtime locale/timezone used by Date#toLocaleString (CI is UTC).
  const expectedRotation = `最近轮换时间: ${new Date(
    '2026-07-15T10:00:00.000Z'
  ).toLocaleString()}`;
  assert.match(
    html,
    new RegExp(expectedRotation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  );
  assert.doesNotMatch(html, /2026-07-15T10:00:00.000Z/);
});

test('does not show a rotation time when updatedAt is absent', () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    p1QueryKeys.request('integrations', 'admin_provider_credentials'),
    [
      {
        effectiveSource: 'vault',
        id: 'platform:model.direct',
        status: 'available',
        credential: {
          mask: '••••••••',
          scope: ['models.read'],
          status: 'active',
          testedAt: '2026-07-15T10:00:00.000Z',
          version: 2,
        },
      },
    ]
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminProviderCredentialControl />
    </QueryClientProvider>
  );

  assert.match(html, /最近测试/);
  assert.doesNotMatch(html, /最近轮换时间/);
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
    ]
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminProviderCredentialControl />
    </QueryClientProvider>
  );

  assert.match(html, /当前生效来源：保险箱/);
  assert.match(html, /当前生效来源：环境变量/);
  assert.match(html, /环境变量回退（保险箱未接管）/);
});

test('shows boot-time sources while all vault slots are empty', () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    p1QueryKeys.request('integrations', 'admin_provider_credentials'),
    [
      {
        effectiveSource: 'env_fallback',
        id: 'platform:model.direct',
      },
      {
        effectiveSource: 'env_fallback',
        id: 'platform:ark.media',
      },
      {
        effectiveSource: 'env',
        id: 'platform:douyin.platform',
      },
    ]
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminProviderCredentialControl />
    </QueryClientProvider>
  );

  assert.equal((html.match(/环境变量回退（保险箱未接管）/g) ?? []).length, 2);
  assert.equal((html.match(/当前生效来源：环境变量(?!回退)/g) ?? []).length, 1);
  assert.equal((html.match(/(?:未保存|Not stored)/g) ?? []).length, 3);
  assert.doesNotMatch(html, /••••••••/);
});

test('J5: three-state trunk, tested gate, draining, env_fallback migration entry', () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    p1QueryKeys.request('integrations', 'admin_provider_credentials'),
    [
      {
        effectiveSource: 'vault',
        id: 'platform:model.direct',
        accountStatus: 'active',
        drainSubstate: 'none',
        credential: {
          mask: '••••••••',
          scope: ['models.read'],
          status: 'active',
          testedAt: '2026-07-15T10:00:00.000Z',
          testStatus: 'passed',
          version: 2,
        },
        updatedAt: '2026-07-15T10:00:00.000Z',
      },
      {
        effectiveSource: 'env_fallback',
        id: 'platform:ark.media',
        accountStatus: 'pending',
        drainSubstate: 'draining',
        credential: {
          mask: '••••••••',
          scope: ['media.generate'],
          status: 'pending',
          version: 1,
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

  assert.match(html, /data-trunk-status="active"/);
  assert.match(html, /data-trunk-status="pending"/);
  assert.match(html, /已激活/);
  assert.match(html, /待激活/);
  assert.match(html, /data-drain="draining"/);
  assert.match(html, /排空中/);
  assert.match(html, /data-testid="provider-credential-activation-gate"/);
  assert.match(html, /激活门：满足/);
  assert.match(html, /data-testid="provider-credential-migration-entry"/);
  assert.match(html, /迁移到保险箱/);
  assert.doesNotMatch(
    html,
    /sk-[A-Za-z0-9]{8,}|provider-test-secret|secretRef/
  );
});
