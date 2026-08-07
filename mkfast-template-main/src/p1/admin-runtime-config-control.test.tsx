import assert from 'node:assert/strict';
import test from 'node:test';
import { NOTE_STYLE_CONFIG_KEY } from '@meiye/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { p1QueryKeys } from './query-keys';
import {
  adminConfigApplyRequest,
  AdminRuntimeConfigControl,
  editableAdminConfigItems,
} from './admin-runtime-config-control';
import { defaultAdminConfigValue } from './admin-config-field-model';
import { ADMIN_CONFIG_KEYS } from './admin-config-view-model';

/**
 * U05 的硬门在这里有一条全量镜像断言，**穿过生产控制器**跑：
 * 控制器自己决定一个键走常驻单选还是走下拉挑选，所以只有从这里进去，
 * 才能证明「26 个键全都落在新渲染层上」——直接喂表单组件会绕过这道分流。
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

/**
 * 热加载这句提醒得说到点子上：讲套餐的那句「只影响新结账、新门店登记」，
 * 配在笔记风格上答非所问——风格改完影响的是下一篇笔记怎么写，不是谁下次付钱。
 */
test('the note style key explains itself in note terms, not in checkout terms', () => {
  const html = renderControlForKey(NOTE_STYLE_CONFIG_KEY);
  assert.match(html, /之后新写的笔记会按新风格来/);
  assert.doesNotMatch(html, /新结账/);
});

test('every admin config key reaches the schema renderer through the production control', () => {
  assert.equal(ADMIN_CONFIG_KEYS.length, 23);
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

test('the merchant hold control is editable and described as hot-read', () => {
  const html = renderControlForKey(
    'harness.confirmation_card.hold_timeout_seconds'
  );
  assert.match(html, /商家决策保留期（秒）/);
  assert.match(html, /data-slot="config-number-field"/);
  assert.match(html, /热加载已生效/);
});

test('credit plan configuration is described as hot-read and commerce-governed', () => {
  const html = renderControlForKey('plan.credits.cycle_coefficients');
  assert.match(html, /热加载已生效/);
  assert.match(html, /新结账/);
});

/** 三个执行模式/装配键必须常驻展开，而不是被塞进「先选一项」的下拉里。 */
test('mode and assembly keys stay expanded instead of hiding behind the key picker', () => {
  for (const key of [
    'model.execution.mode',
    'model.media.execution.mode',
    'byok.adapter.assembly',
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
          runtimeEnvironment: {
            appEnv: 'development',
            modelExecutionMode: 'recorded',
          },
          source: { source: 'db_revision', revision: 1 },
        },
        {
          bootedAt: '2026-07-15T10:01:00.000Z',
          effectiveValue: 'direct',
          fallbackReason: null,
          processKind: 'job-worker',
          runtimeEnvironment: {
            appEnv: 'development',
            modelExecutionMode: 'recorded',
          },
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
  assert.match(html, /来源：落库版本 1/);
  assert.match(html, /来源：落库版本 2/);
  assert.match(html, /开机时间：/);
  assert.match(html, /已保存，重启后生效/);
  assert.match(html, /当前生效配置/);
  assert.doesNotMatch(html, /当前环境开机不读落库值/);
});

test('shows fixture skip notice only for e2e+fixture env-fallback boots', () => {
  const fixtureSnapshots = [
    {
      bootedAt: '2026-08-06T12:00:00.000Z',
      effectiveValue: 'fixture',
      fallbackReason: null,
      processKind: 'http' as const,
      runtimeEnvironment: {
        appEnv: 'e2e',
        modelExecutionMode: 'fixture',
      },
      source: { source: 'env_fallback' as const },
    },
  ];
  const developmentSnapshots = [
    {
      bootedAt: '2026-08-06T12:30:00.000Z',
      effectiveValue: 'recorded',
      fallbackReason: null,
      processKind: 'http' as const,
      runtimeEnvironment: {
        appEnv: 'development',
        modelExecutionMode: 'recorded',
      },
      source: { source: 'db_revision' as const, revision: 1 },
    },
  ];

  const renderFor = (
    key: string,
    snapshots: typeof fixtureSnapshots | typeof developmentSnapshots,
    effectiveValue: string,
    storedValue: string
  ) => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      p1QueryKeys.request('admin-config', 'config_list'),
      [
        {
          activationEvidenceStatus: 'recorded_only',
          actorId: 'platform-admin',
          correlationId: `fixture-label-${key}`,
          createdAt: '2026-08-06T12:00:00.000Z',
          effectiveSnapshots: snapshots,
          effectiveValue,
          key,
          reason: 'label honesty',
          revision: 1,
          rolledBackToRevision: null,
          scope: 'global',
          status: 'applied',
          storedValue,
          wired: true,
        },
      ]
    );
    queryClient.setQueryData(
      p1QueryKeys.request('admin-config', 'config_history', { key }),
      []
    );
    return renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <AdminRuntimeConfigControl keys={[key]} />
      </QueryClientProvider>
    );
  };

  for (const key of [
    'model.execution.mode',
    'model.media.execution.mode',
    'byok.adapter.assembly',
  ]) {
    const fixtureHtml = renderFor(
      key,
      key === 'byok.adapter.assembly'
        ? [
            {
              ...fixtureSnapshots[0]!,
              effectiveValue: 'recorded',
            },
          ]
        : key === 'model.media.execution.mode'
          ? [
              {
                ...fixtureSnapshots[0]!,
                effectiveValue: 'disabled',
              },
            ]
          : fixtureSnapshots,
      key === 'byok.adapter.assembly'
        ? 'recorded'
        : key === 'model.media.execution.mode'
          ? 'disabled'
          : 'fixture',
      key === 'byok.adapter.assembly'
        ? 'live'
        : key === 'model.media.execution.mode'
          ? 'disabled'
          : 'recorded'
    );
    assert.match(fixtureHtml, /当前环境开机不读落库值/);
    assert.match(fixtureHtml, /HTTP 进程/);
    assert.match(fixtureHtml, /来源：环境变量回退/);
    assert.match(
      fixtureHtml,
      new RegExp(
        key === 'byok.adapter.assembly'
          ? 'recorded'
          : key === 'model.media.execution.mode'
            ? 'disabled'
            : 'fixture'
      )
    );
    assert.match(fixtureHtml, /开机时间：/);

    const developmentHtml = renderFor(
      key,
      key === 'byok.adapter.assembly'
        ? developmentSnapshots
        : key === 'model.media.execution.mode'
          ? [
              {
                ...developmentSnapshots[0]!,
                effectiveValue: 'disabled',
              },
            ]
          : developmentSnapshots,
      key === 'model.media.execution.mode' ? 'disabled' : 'recorded',
      key === 'model.media.execution.mode' ? 'disabled' : 'recorded'
    );
    assert.doesNotMatch(developmentHtml, /当前环境开机不读落库值/);
    assert.match(developmentHtml, /来源：落库版本 1/);
  }
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

test('shows selectable adapter assembly controls', () => {
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
  ]);

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminRuntimeConfigControl keys={['byok.adapter.assembly']} />
    </QueryClientProvider>
  );

  assert.match(html, /BYOK 适配器装配/);
  assert.doesNotMatch(html, /id="byok\.adapter\.assembly-live"[^>]*disabled/);
  assert.doesNotMatch(html, /<textarea/);
  assert.equal((html.match(/role="radio"/g) ?? []).length, 2);
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

test('labels credit commerce config as hot-read while disclosing the legacy Product fallback', () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(p1QueryKeys.request('admin-config', 'config_list'), [
    {
      activationEvidenceStatus: 'recorded_only',
      actorId: 'platform-admin',
      correlationId: 'growth-hot-read',
      createdAt: '2026-07-15T10:02:00.000Z',
      effectiveValue: {
        concurrencyLimit: 5,
        credits: 1_300,
        currency: 'HKD',
        monthlyPriceMicros: 580_000_000,
        queuePriority: 6,
        storageMb: 5120,
        supportLabel: 'priority',
      },
      key: 'plan.credits.growth',
      reason: 'Update growth credits',
      revision: 1,
      rolledBackToRevision: null,
      scope: 'global',
      status: 'applied',
      storedValue: {
        concurrencyLimit: 5,
        credits: 1_300,
        currency: 'HKD',
        monthlyPriceMicros: 580_000_000,
        queuePriority: 6,
        storageMb: 5120,
        supportLabel: 'priority',
      },
      wired: true,
    },
  ]);
  queryClient.setQueryData(
    p1QueryKeys.request('admin-config', 'config_history', {
      key: 'plan.credits.growth',
    }),
    []
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminRuntimeConfigControl keys={['plan.credits.growth']} />
    </QueryClientProvider>
  );

  assert.match(html, /热加载已生效/);
  assert.match(html, /新结账/);
  assert.match(html, /旧 Product 兜底仍由部署配置治理/);
  assert.match(html, /admin-runtime-config-value/);
  assert.match(html, /审阅并记录/);
  // U05：受控配置一律走结构化表单，后台不再留手敲 JSON 的口子（D-107）。
  assert.match(html, /admin-config-form-plan\.credits\.growth/);
  assert.doesNotMatch(html, /<textarea/);
  assert.match(html, /data-slot="config-number-field"/);
});

function retiredPlanConfigItem(key: 'plan.addons' | 'plan.trial.enabled') {
  const storedValue = key === 'plan.trial.enabled' ? false : [];
  return {
    activationEvidenceStatus: 'recorded_only',
    actorId: 'platform-admin',
    correlationId: `readonly-${key}`,
    createdAt: '2026-08-07T00:00:00.000Z',
    effectiveValue: storedValue,
    key,
    reason: 'retired',
    revision: 1,
    rolledBackToRevision: null,
    scope: 'global' as const,
    status: 'applied' as const,
    storedValue,
    wired: false,
    readOnly: true,
  };
}

test('retired plan keys render as locked read-only rows, not unwired or editable', () => {
  const queryClient = new QueryClient();
  const retiredKeys = ['plan.addons', 'plan.trial.enabled'] as const;
  queryClient.setQueryData(
    p1QueryKeys.request('admin-config', 'config_list'),
    retiredKeys.map(retiredPlanConfigItem)
  );
  for (const key of retiredKeys) {
    queryClient.setQueryData(
      p1QueryKeys.request('admin-config', 'config_history', { key }),
      []
    );
  }

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminRuntimeConfigControl keys={[...retiredKeys]} />
    </QueryClientProvider>
  );

  for (const key of retiredKeys) {
    assert.match(
      html,
      new RegExp(`admin-runtime-config-readonly-${key.replaceAll('.', '\\.')}`),
      `${key} missing read-only row`
    );
    assert.doesNotMatch(
      html,
      new RegExp(`admin-config-form-${key.replaceAll('.', '\\.')}`),
      `${key} still rendered an edit form`
    );
  }
  assert.match(html, /只读/);
  assert.doesNotMatch(html, /已记录（未接线）/);
  // Save must stay inert when the filtered set is all read-only.
  assert.match(
    html,
    /disabled[^>]*>[\s\S]*审阅并记录|审阅并记录[\s\S]*disabled/
  );
});

test('editableAdminConfigItems drops readOnly keys from the submit set', () => {
  const items = [
    { key: 'plan.credits.growth', readOnly: false },
    { key: 'plan.addons', readOnly: true },
    { key: 'plan.trial.enabled', readOnly: true },
    { key: 'plan.payment-mapping' },
  ];
  assert.deepEqual(
    editableAdminConfigItems(items).map((item) => item.key),
    ['plan.credits.growth', 'plan.payment-mapping']
  );
});

test('mixed list keeps editable forms while locking retired plan keys', () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(p1QueryKeys.request('admin-config', 'config_list'), [
    {
      activationEvidenceStatus: 'recorded_only',
      actorId: 'platform-admin',
      correlationId: 'growth-editable',
      createdAt: '2026-08-07T00:00:00.000Z',
      effectiveValue: defaultAdminConfigValue('plan.credits.growth'),
      key: 'plan.credits.growth',
      reason: 'live',
      revision: 2,
      rolledBackToRevision: null,
      scope: 'global',
      status: 'applied',
      storedValue: defaultAdminConfigValue('plan.credits.growth'),
      wired: true,
      readOnly: false,
    },
    retiredPlanConfigItem('plan.addons'),
    retiredPlanConfigItem('plan.trial.enabled'),
  ]);
  queryClient.setQueryData(
    p1QueryKeys.request('admin-config', 'config_history', {
      key: 'plan.credits.growth',
    }),
    []
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminRuntimeConfigControl
        keys={['plan.credits.growth', 'plan.addons', 'plan.trial.enabled']}
      />
    </QueryClientProvider>
  );

  assert.match(html, /admin-config-form-plan\.credits\.growth/);
  assert.match(html, /admin-runtime-config-readonly-plan\.addons/);
  assert.match(html, /admin-runtime-config-readonly-plan\.trial\.enabled/);
  assert.doesNotMatch(html, /admin-config-form-plan\.addons/);
  assert.doesNotMatch(html, /admin-config-form-plan\.trial\.enabled/);
  assert.doesNotMatch(html, /已记录（未接线）/);
});
