import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { p1QueryKeys } from './query-keys';
import {
  adminConfigApplyRequest,
  AdminRuntimeConfigControl,
} from './admin-runtime-config-control';
import { defaultAdminConfigValue } from './admin-config-field-model';
import { ADMIN_CONFIG_KEYS } from './admin-config-view-model';

/**
 * U05 的硬门在这里有一条全量镜像断言，**穿过生产控制器**跑：
 * 控制器自己决定一个键走常驻单选还是走下拉挑选，所以只有从这里进去，
 * 才能证明「19 个键全都落在新渲染层上」——直接喂表单组件会绕过这道分流。
 */
function renderControlForKey(key: string) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(p1QueryKeys.request('admin-config', 'config_list'), [
    {
      activationEvidenceStatus: 'recorded_only',
      actorId: 'platform-admin',
      correlationId: `all-keys-${key}`,
      createdAt: '2026-07-27T00:00:00.000Z',
      effectiveValue: defaultAdminConfigValue(key),
      key,
      reason: 'coverage',
      revision: 1,
      rolledBackToRevision: null,
      scope: 'global',
      status: 'applied',
      storedValue: defaultAdminConfigValue(key),
      wired: true,
    },
  ]);
  queryClient.setQueryData(
    p1QueryKeys.request('admin-config', 'config_history', { key }),
    []
  );
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminRuntimeConfigControl keys={[key]} />
    </QueryClientProvider>
  );
}

test('every admin config key reaches the schema renderer through the production control', () => {
  assert.equal(ADMIN_CONFIG_KEYS.length, 19);
  for (const key of ADMIN_CONFIG_KEYS) {
    const html = renderControlForKey(key);
    assert.match(
      html,
      new RegExp(`admin-config-form-${key.replaceAll('.', '\\.')}`),
      `${key} did not reach the schema renderer`
    );
    // 后台任何一个配置项都不该再出现「自己拼一段 JSON」的输入框。
    assert.doesNotMatch(
      html,
      /<textarea[^>]*font-mono/,
      `${key} kept a code editor`
    );
    assert.doesNotMatch(
      html,
      /admin_runtime_config_value.*<textarea/,
      `${key} kept a raw value editor`
    );
  }
});

/** 四个执行模式/装配键必须常驻展开，而不是被塞进「先选一项」的下拉里。 */
test('mode and assembly keys stay expanded instead of hiding behind the key picker', () => {
  for (const key of [
    'model.execution.mode',
    'model.media.execution.mode',
    'byok.adapter.assembly',
    'douyin.adapter.assembly',
  ]) {
    const html = renderControlForKey(key);
    assert.match(
      html,
      new RegExp(`admin-runtime-config-inline-${key.replaceAll('.', '\\.')}`),
      `${key} lost its expanded card`
    );
    assert.doesNotMatch(
      html,
      /id="admin-runtime-config-key"/,
      `${key} was pushed behind the key picker`
    );
  }
});

test('shows HTTP and worker effective runtime states independently', () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(p1QueryKeys.request('admin-config', 'config_list'), [
    {
      activationEvidenceStatus: 'recorded_only',
      actorId: 'platform-admin',
      correlationId: 'config-mode-2',
      createdAt: '2026-07-15T10:02:00.000Z',
      effectiveSnapshots: [
        {
          bootedAt: '2026-07-15T10:00:00.000Z',
          effectiveValue: 'recorded',
          fallbackReason: null,
          processKind: 'http',
          source: { source: 'db_revision', revision: 1 },
        },
        {
          bootedAt: '2026-07-15T10:01:00.000Z',
          effectiveValue: 'direct',
          fallbackReason: null,
          processKind: 'job-worker',
          source: { source: 'db_revision', revision: 2 },
        },
      ],
      effectiveValue: 'recorded',
      key: 'model.execution.mode',
      reason: 'enable direct',
      revision: 2,
      rolledBackToRevision: null,
      scope: 'global',
      status: 'applied',
      storedValue: 'direct',
      wired: true,
    },
  ]);
  queryClient.setQueryData(
    p1QueryKeys.request('admin-config', 'config_history', {
      key: 'model.execution.mode',
    }),
    []
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminRuntimeConfigControl keys={['model.execution.mode']} />
    </QueryClientProvider>
  );

  assert.match(html, /HTTP 进程/);
  assert.match(html, /任务进程/);
  assert.match(html, /已保存，重启后生效/);
  assert.match(html, /当前生效配置/);
});

test('shows dedicated selectable controls for model and media execution modes', () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(p1QueryKeys.request('admin-config', 'config_list'), [
    {
      activationEvidenceStatus: 'recorded_only',
      actorId: 'platform-admin',
      correlationId: 'model-mode-1',
      createdAt: '2026-07-15T10:02:00.000Z',
      effectiveValue: 'recorded',
      key: 'model.execution.mode',
      reason: 'keep demo mode',
      revision: 1,
      rolledBackToRevision: null,
      scope: 'global',
      status: 'applied',
      storedValue: 'recorded',
      wired: true,
    },
    {
      activationEvidenceStatus: 'disabled',
      actorId: 'platform-admin',
      correlationId: 'media-mode-1',
      createdAt: '2026-07-15T10:03:00.000Z',
      effectiveValue: 'disabled',
      key: 'model.media.execution.mode',
      modeAvailability: [
        { assemblable: true, missingRequirements: [], value: 'disabled' },
        { assemblable: true, missingRequirements: [], value: 'ark' },
        {
          assemblable: false,
          missingRequirements: ['TUZI_MEDIA_API_KEY'],
          value: 'tuzi',
        },
        {
          assemblable: false,
          missingRequirements: ['TUZI_MEDIA_API_KEY'],
          value: 'ark,tuzi',
        },
      ],
      reason: 'keep media disabled',
      revision: 1,
      rolledBackToRevision: null,
      scope: 'global',
      status: 'applied',
      storedValue: 'disabled',
      wired: true,
    },
  ]);
  queryClient.setQueryData(
    p1QueryKeys.request('admin-config', 'config_history', {
      key: 'model.execution.mode',
    }),
    []
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminRuntimeConfigControl />
    </QueryClientProvider>
  );

  assert.match(html, /模型执行模式/);
  assert.match(html, /媒体执行模式/);
  assert.match(html, /停用/);
  assert.match(html, /演示录制/);
  assert.match(html, /E2E 固定样例/);
  assert.match(html, /网关 PoC/);
  assert.match(html, /真实直连/);
  assert.match(html, /火山 Ark 真实生成/);
  assert.match(html, /Tuzi 真实生成/);
  assert.match(html, /Ark \+ Tuzi 真实生成/);
  assert.match(html, /暂不可用，缺少：TUZI_MEDIA_API_KEY/);
  assert.match(html, /id="model\.media\.execution\.mode-tuzi"[^>]*disabled/);
  assert.equal((html.match(/role="radio"/g) ?? []).length, 9);
});

test('shows selectable adapter assembly controls and keeps Douyin live unavailable before pilot', () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(p1QueryKeys.request('admin-config', 'config_list'), [
    {
      activationEvidenceStatus: 'live_verified',
      actorId: 'platform-admin',
      correlationId: 'byok-assembly-1',
      createdAt: '2026-07-15T10:02:00.000Z',
      effectiveValue: 'recorded',
      key: 'byok.adapter.assembly',
      reason: 'keep recorded assembly',
      revision: 1,
      rolledBackToRevision: null,
      scope: 'global',
      status: 'applied',
      storedValue: 'recorded',
      wired: true,
    },
    {
      activationEvidenceStatus: 'recorded_only',
      actorId: 'platform-admin',
      correlationId: 'douyin-assembly-1',
      createdAt: '2026-07-15T10:03:00.000Z',
      effectiveValue: 'recorded',
      key: 'douyin.adapter.assembly',
      reason: 'pilot not started',
      revision: 1,
      rolledBackToRevision: null,
      scope: 'global',
      status: 'applied',
      storedValue: 'recorded',
      wired: true,
    },
  ]);

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminRuntimeConfigControl
        keys={['byok.adapter.assembly', 'douyin.adapter.assembly']}
      />
    </QueryClientProvider>
  );

  assert.match(html, /BYOK 适配器装配/);
  assert.match(html, /抖音适配器装配/);
  assert.match(html, /未接入（pilot 前）/);
  assert.match(html, /id="douyin\.adapter\.assembly-live"[^>]*disabled/);
  assert.doesNotMatch(html, /id="byok\.adapter\.assembly-live"[^>]*disabled/);
  assert.doesNotMatch(html, /<textarea/);
  assert.equal((html.match(/role="radio"/g) ?? []).length, 4);
});

test('submits Tuzi and mixed radio values through the audited config apply contract', () => {
  const item = {
    key: 'model.media.execution.mode',
    revision: 7,
  };

  assert.deepEqual(adminConfigApplyRequest(item, '"tuzi"', 'enable relay'), {
    action: 'config_apply',
    payload: {
      expectedRevision: 7,
      key: 'model.media.execution.mode',
      reason: 'enable relay',
      value: 'tuzi',
    },
  });
  assert.deepEqual(adminConfigApplyRequest(item, '"ark,tuzi"', 'enable both'), {
    action: 'config_apply',
    payload: {
      expectedRevision: 7,
      key: 'model.media.execution.mode',
      reason: 'enable both',
      value: 'ark,tuzi',
    },
  });
});

test('labels commerce config as hot-read while disclosing the legacy Product fallback', () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(p1QueryKeys.request('admin-config', 'config_list'), [
    {
      activationEvidenceStatus: 'recorded_only',
      actorId: 'platform-admin',
      correlationId: 'growth-hot-read',
      createdAt: '2026-07-15T10:02:00.000Z',
      effectiveValue: {
        allowance: { copy: 120, image: 48, video: 24 },
        concurrencyLimit: 5,
        queuePriority: 6,
        supportLabel: 'priority',
      },
      key: 'plan.allowances.growth',
      reason: 'Update growth allowance',
      revision: 1,
      rolledBackToRevision: null,
      scope: 'global',
      status: 'applied',
      storedValue: {
        allowance: { copy: 120, image: 48, video: 24 },
        concurrencyLimit: 5,
        queuePriority: 6,
        supportLabel: 'priority',
      },
      wired: true,
    },
  ]);
  queryClient.setQueryData(
    p1QueryKeys.request('admin-config', 'config_history', {
      key: 'plan.allowances.growth',
    }),
    []
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminRuntimeConfigControl keys={['plan.allowances.growth']} />
    </QueryClientProvider>
  );

  assert.match(html, /热加载已生效/);
  assert.match(html, /新结账/);
  assert.match(html, /旧 Product 兜底仍由部署配置治理/);
  assert.match(html, /admin-runtime-config-value/);
  assert.match(html, /审阅并记录/);
  // U05：受控配置一律走结构化表单，后台不再留手敲 JSON 的口子（D-107）。
  assert.match(html, /admin-config-form-plan\.allowances\.growth/);
  assert.doesNotMatch(html, /<textarea/);
  assert.match(html, /data-slot="number-stepper"/);
});
