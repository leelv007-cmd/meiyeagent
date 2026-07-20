import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLOUDFLARE_DEEP_LINK_RESOURCE_KINDS,
  CLOUDFLARE_FORBIDDEN_PERMISSIONS,
  CLOUDFLARE_HANDOFF_TTL_MS,
  CLOUDFLARE_INVENTORY_CACHE_TTL_MS,
  CLOUDFLARE_INVENTORY_FORBIDDEN_METHODS,
  CLOUDFLARE_INVENTORY_READ_METHODS,
  CLOUDFLARE_MIN_READ_PERMISSIONS,
  CLOUDFLARE_WRITE_ACTIONS,
  CloudflareDeepLinkError,
  CloudflareInventoryAdapter,
  CloudflareWriteDeniedError,
  HYPERDRIVE_PLACEHOLDER_ID,
  assertCloudflareWriteDenied,
  assertNoSensitiveDeepLinkFields,
  assertReadOnlyPermissionSet,
  buildCloudflareDeepLinkEnvelope,
  defaultRepoConfigRisks,
  findForbiddenMethodsOnAdapter,
  hasMinimumInventoryPermissions,
  isAllowedDeepLinkResourceKind,
  isCloudflareWriteAction,
  isHyperdrivePlaceholder,
  listAdapterAllowedMethods,
  listDeniedWriteActions,
  listForbiddenPermissionIds,
  listMinReadPermissionIds,
  normalizeDeploymentsFromApi,
  normalizeVersionsFromApi,
  projectCloudflareConfigRisks,
  resolveCloudflareDeepLink,
  runCloudflareSelfProbes,
  runMappingReadinessProbe,
  shouldShowCloudflareQueueCard,
  type CloudflareHttpFetch,
  type CloudflareResourceMapping,
} from './index.js';

const VERIFIED_MAPPING: CloudflareResourceMapping = {
  internalRef: 'shell-prod',
  accountId: 'acct_test',
  scriptName: 'mkfast-template',
  r2BucketName: 'mkfast-template',
  hyperdriveConfigId: 'hd-real-001',
  verified: true,
};

const UNVERIFIED_MAPPING: CloudflareResourceMapping = {
  internalRef: 'shell-unverified',
  verified: false,
};

// ── permissions ──────────────────────────────────────────────────────

test('min permission list covers inventory REST surfaces only', () => {
  const ids = listMinReadPermissionIds();
  assert.ok(ids.includes('workers_scripts_read'));
  assert.ok(ids.includes('workers_r2_storage_read'));
  assert.ok(ids.includes('hyperdrive_read'));
  assert.ok(ids.includes('workers_observability_read'));
  assert.equal(ids.length, CLOUDFLARE_MIN_READ_PERMISSIONS.length);

  // GraphQL analytics-read is deferred — not in min inventory set as required.
  assert.ok(!ids.some((id) => id.includes('analytics')));
});

test('forbidden permission list blocks all control-plane writes + observability write', () => {
  const forbidden = listForbiddenPermissionIds();
  assert.ok(forbidden.includes('workers_scripts_write'));
  assert.ok(forbidden.includes('workers_observability_write'));
  assert.ok(forbidden.includes('dns_write'));
  assert.ok(forbidden.includes('zone_waf_write'));
  assert.ok(forbidden.includes('workers_r2_storage_write'));
  assert.ok(forbidden.includes('billing_write'));
  assert.ok(forbidden.includes('hyperdrive_write'));
  assert.equal(forbidden.length, CLOUDFLARE_FORBIDDEN_PERMISSIONS.length);
});

test('assertReadOnlyPermissionSet flags write grants', () => {
  const clean = assertReadOnlyPermissionSet([
    'Workers Scripts Read',
    'Workers R2 Storage Read',
    'Hyperdrive Read',
    'Workers Observability Read',
  ]);
  assert.deepEqual(clean, []);

  const dirty = assertReadOnlyPermissionSet([
    'Workers Scripts Read',
    'Workers Scripts Write',
    'DNS Write',
  ]);
  assert.ok(dirty.includes('workers_scripts_write'));
  assert.ok(dirty.includes('dns_write'));
});

test('hasMinimumInventoryPermissions requires all min-read grants', () => {
  assert.equal(
    hasMinimumInventoryPermissions(['Workers Scripts Read']),
    false,
  );
  assert.equal(
    hasMinimumInventoryPermissions([
      'workers_scripts_read',
      'workers_r2_storage_read',
      'hyperdrive_read',
      'workers_observability_read',
    ]),
    true,
  );
});

// ── deep-link ────────────────────────────────────────────────────────

test('deep-link builder carries redacted time range / script-deployment / correlation / capability', () => {
  const envelope = buildCloudflareDeepLinkEnvelope({
    resourceKind: 'worker_logs',
    resourceRef: 'shell-prod',
    from: '2026-07-19T10:00:00+08:00',
    to: '2026-07-19T10:15:00+08:00',
    signal: 'error_rate_spike',
    incidentRef: 'inc-42',
    capabilityContext: {
      capabilityId: 'observability_audit',
      capabilityLabel: '观测告警审计',
    },
    scriptDeployment: {
      scriptRef: 'shell-prod',
      deploymentRef: 'dep-1',
      versionRef: 'ver-9',
    },
    correlation: {
      correlationId: 'corr-abc',
      traceHint: 'trace-hint-only',
    },
    returnTo: '/admin/system-health',
  });

  assert.equal(envelope.provider, 'cloudflare');
  assert.equal(envelope.resourceKind, 'worker_logs');
  assert.equal(envelope.resourceRef, 'shell-prod');
  assert.equal(envelope.from, '2026-07-19T10:00:00+08:00');
  assert.equal(envelope.to, '2026-07-19T10:15:00+08:00');
  assert.equal(envelope.capabilityContext?.capabilityId, 'observability_audit');
  assert.equal(envelope.scriptDeployment?.deploymentRef, 'dep-1');
  assert.equal(envelope.correlation?.correlationId, 'corr-abc');
  assert.equal(envelope.returnTo, '/admin/system-health');
  assert.ok(envelope.snapshotAt);
});

test('deep-link rejects unknown resource kinds and sensitive fields', () => {
  assert.equal(isAllowedDeepLinkResourceKind('worker_logs'), true);
  assert.equal(isAllowedDeepLinkResourceKind('arbitrary_sql'), false);
  assert.ok(CLOUDFLARE_DEEP_LINK_RESOURCE_KINDS.includes('worker_traces'));

  assert.throws(
    () =>
      buildCloudflareDeepLinkEnvelope({
        resourceKind: 'not_a_kind',
        resourceRef: 'x',
      }),
    (err: unknown) =>
      err instanceof CloudflareDeepLinkError &&
      err.code === 'resource_kind_not_allowed',
  );

  assert.throws(
    () => assertNoSensitiveDeepLinkFields({ token: 'cf-secret' }),
    (err: unknown) =>
      err instanceof CloudflareDeepLinkError &&
      err.code === 'sensitive_context_rejected',
  );

  assert.throws(
    () =>
      buildCloudflareDeepLinkEnvelope({
        resourceKind: 'worker_logs',
        resourceRef: 'shell-prod',
        extra: { secret: 'nope' },
      }),
    /Sensitive field/,
  );

  assert.throws(
    () =>
      buildCloudflareDeepLinkEnvelope({
        resourceKind: 'worker_logs',
        resourceRef: 'shell-prod',
        from: '2026-07-20T12:00:00Z',
        to: '2026-07-20T11:00:00Z',
      }),
    (err: unknown) =>
      err instanceof CloudflareDeepLinkError &&
      err.code === 'time_range_invalid',
  );
});

test('resolveDeepLink builds official Dashboard URL only for verified mapping', () => {
  const envelope = buildCloudflareDeepLinkEnvelope({
    resourceKind: 'worker_deployments',
    resourceRef: 'shell-prod',
    from: '2026-07-19T02:00:00Z',
    to: '2026-07-19T02:15:00Z',
  });

  const resolved = resolveCloudflareDeepLink(envelope, VERIFIED_MAPPING);
  assert.match(
    resolved.dashboardUrl,
    /dash\.cloudflare\.com\/acct_test\/workers\/services\/view\/mkfast-template\/production\/deployments/,
  );
  assert.match(resolved.dashboardUrl, /from=2026-07-19T02%3A00%3A00Z/);
  assert.equal(resolved.ttlMs, CLOUDFLARE_HANDOFF_TTL_MS);
  assert.equal(resolved.singleUse, true);

  assert.throws(
    () => resolveCloudflareDeepLink(envelope, UNVERIFIED_MAPPING),
    (err: unknown) =>
      err instanceof CloudflareDeepLinkError &&
      err.code === 'mapping_not_verified',
  );
});

// ── normalize ────────────────────────────────────────────────────────

test('normalize deployments and versions strip to safe projection fields', () => {
  const deployments = normalizeDeploymentsFromApi({
    result: [
      {
        id: 'dep-1',
        version_id: 'ver-1',
        created_on: '2026-07-19T00:00:00Z',
        source: 'wrangler',
        author_email: 'ops@example.com',
        versions: [{ version_id: 'ver-1', percentage: 100 }],
      },
    ],
  });
  assert.equal(deployments.length, 1);
  assert.equal(deployments[0]?.deploymentId, 'dep-1');
  assert.equal(deployments[0]?.versionId, 'ver-1');
  assert.equal(deployments[0]?.trafficPercent, 100);
  assert.equal(deployments[0]?.notDataRollback, true);

  const versions = normalizeVersionsFromApi([
    {
      id: 'ver-9',
      created_on: '2026-07-18T00:00:00Z',
      annotations: { 'workers/message': 'ship it' },
    },
  ]);
  assert.equal(versions[0]?.versionId, 'ver-9');
  assert.equal(versions[0]?.annotations?.['workers/message'], 'ship it');
});

// ── inventory adapter: query / cache / freshness / unknown ───────────

function mockFetch(routes: Record<string, unknown>): CloudflareHttpFetch {
  // Longest-suffix match so /workers/scripts/x/secrets wins over /workers/scripts.
  const entries = Object.entries(routes).sort(
    (a, b) => b[0].length - a[0].length,
  );
  return async (input, init) => {
    assert.equal(init?.method, 'GET');
    const url = String(input);
    for (const [suffix, body] of entries) {
      if (url.endsWith(suffix)) {
        if (body && typeof body === 'object' && 'status' in (body as object)) {
          const statusBody = body as {
            status: number;
            json?: unknown;
          };
          return new Response(JSON.stringify(statusBody.json ?? {}), {
            status: statusBody.status,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ success: true, result: body }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    return new Response(JSON.stringify({ success: false, errors: [] }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  };
}

test('inventory adapter normalizes REST deployments/versions/resources', async () => {
  const fetchImpl = mockFetch({
    '/deployments': [
      {
        id: 'dep-1',
        version_id: 'ver-1',
        created_on: '2026-07-19T00:00:00Z',
        source: 'api',
      },
    ],
    '/versions': [{ id: 'ver-1', created_on: '2026-07-18T00:00:00Z' }],
    '/workers/scripts': [{ id: 'mkfast-template' }],
    '/r2/buckets': [{ name: 'mkfast-template', location: 'apac' }],
    '/hyperdrive/configs': [{ id: 'hd-real-001', name: 'pg-pool' }],
    '/secrets': [{ name: 'SESSION_SECRET', type: 'secret_text' }],
    '/observability/destinations': [],
  });

  const adapter = new CloudflareInventoryAdapter({
    apiToken: 'test-token-not-for-browser',
    mapping: VERIFIED_MAPPING,
    fetchImpl,
    now: () => new Date('2026-07-20T00:00:00Z'),
  });

  const snapshot = await adapter.refreshInventory();
  assert.equal(snapshot.freshness, 'fresh');
  assert.equal(snapshot.cloudflareQueuesEnabled, false);
  assert.equal(snapshot.graphqlAnalyticsDeferred, true);
  assert.equal(snapshot.deployments.status, 'known');
  if (snapshot.deployments.status === 'known') {
    assert.equal(snapshot.deployments.value[0]?.deploymentId, 'dep-1');
    assert.equal(snapshot.deployments.value[0]?.notDataRollback, true);
  }
  assert.equal(snapshot.versions.status, 'known');
  assert.ok(
    snapshot.resources.some(
      (r) => r.kind === 'worker_script' && r.readiness === 'verified',
    ),
  );
  assert.ok(
    snapshot.resources.some(
      (r) => r.kind === 'r2_bucket' && r.name === 'mkfast-template',
    ),
  );
  assert.ok(
    snapshot.resources.some(
      (r) => r.kind === 'hyperdrive' && r.readiness === 'verified',
    ),
  );
  // No Cloudflare Queue resource invented
  assert.ok(!snapshot.resources.some((r) => String(r.kind).includes('queue')));
  // Hyperdrive origin credentials never present as structured fields
  for (const r of snapshot.resources) {
    assert.equal(
      'origin' in (r as object) || 'originHost' in (r as object),
      false,
    );
    assert.ok(!('host' in (r as object)));
    assert.ok(!r.detail?.includes('password'));
  }
});

test('inventory cache serves fresh then stale honestly', async () => {
  let nowMs = Date.parse('2026-07-20T00:00:00Z');
  let calls = 0;
  const fetchImpl: CloudflareHttpFetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ success: true, result: [] }), {
      status: 200,
    });
  };

  const adapter = new CloudflareInventoryAdapter({
    apiToken: 't',
    mapping: VERIFIED_MAPPING,
    fetchImpl,
    cacheTtlMs: CLOUDFLARE_INVENTORY_CACHE_TTL_MS,
    now: () => new Date(nowMs),
  });

  await adapter.refreshInventory();
  const firstCalls = calls;
  assert.ok(firstCalls > 0);

  // Within TTL → cache hit, no new network for getInventory
  const fresh = await adapter.getInventory();
  assert.equal(fresh.freshness, 'fresh');
  assert.equal(fresh.cache.hit, true);
  assert.equal(calls, firstCalls);

  // Advance past TTL
  nowMs += CLOUDFLARE_INVENTORY_CACHE_TTL_MS + 1;
  const cached = adapter.getCachedInventory();
  assert.ok(cached);
  assert.equal(cached.freshness, 'stale');
  assert.equal(cached.cache.hit, true);
  assert.ok((cached.cache.ageMs ?? 0) > CLOUDFLARE_INVENTORY_CACHE_TTL_MS);
});

test('inventory returns unknown for unverified mapping, missing token, rate limit', async () => {
  const unverified = new CloudflareInventoryAdapter({
    mapping: UNVERIFIED_MAPPING,
    apiToken: 't',
  });
  const u = await unverified.refreshInventory();
  assert.equal(u.freshness, 'not_verified');
  assert.equal(u.deployments.status, 'unknown');
  if (u.deployments.status === 'unknown') {
    assert.equal(u.deployments.reason, 'mapping_not_verified');
  }

  const noToken = new CloudflareInventoryAdapter({
    mapping: VERIFIED_MAPPING,
  });
  const n = await noToken.refreshInventory();
  assert.equal(n.freshness, 'unknown');
  if (n.deployments.status === 'unknown') {
    assert.equal(n.deployments.reason, 'token_missing');
  }

  const rateLimited = new CloudflareInventoryAdapter({
    apiToken: 't',
    mapping: VERIFIED_MAPPING,
    fetchImpl: async () =>
      new Response(JSON.stringify({ success: false }), { status: 429 }),
  });
  const r = await rateLimited.refreshInventory();
  assert.equal(r.deployments.status, 'unknown');
  if (r.deployments.status === 'unknown') {
    assert.equal(r.deployments.reason, 'rate_limited');
    assert.equal(r.deployments.freshness, 'unavailable');
  }
});

test('placeholder Hyperdrive surfaces as not_ready in inventory resources', async () => {
  const adapter = new CloudflareInventoryAdapter({
    apiToken: 't',
    mapping: {
      ...VERIFIED_MAPPING,
      hyperdriveConfigId: HYPERDRIVE_PLACEHOLDER_ID,
    },
    fetchImpl: mockFetch({
      '/deployments': [],
      '/versions': [],
      '/workers/scripts': [{ id: 'mkfast-template' }],
      '/r2/buckets': [],
      '/hyperdrive/configs': [],
      '/secrets': [],
      '/observability/destinations': [],
    }),
  });
  const snapshot = await adapter.refreshInventory();
  const hd = snapshot.resources.find((r) => r.kind === 'hyperdrive');
  assert.ok(hd);
  assert.equal(hd.readiness, 'not_ready');
  assert.match(hd.businessImpact, /未就绪|占位/);
});

// ── write-op denied negatives ────────────────────────────────────────

test('adapter method whitelist is read-only; forbidden methods absent', () => {
  const adapter = new CloudflareInventoryAdapter({
    mapping: UNVERIFIED_MAPPING,
  });
  const allowed = listAdapterAllowedMethods(adapter);
  assert.deepEqual(allowed, [...CLOUDFLARE_INVENTORY_READ_METHODS]);

  const forbiddenPresent = findForbiddenMethodsOnAdapter(adapter);
  assert.deepEqual(forbiddenPresent, []);

  for (const method of CLOUDFLARE_INVENTORY_FORBIDDEN_METHODS) {
    assert.equal(
      typeof (adapter as unknown as Record<string, unknown>)[method],
      'undefined',
      `forbidden method ${method} must not exist`,
    );
  }
});

test('write actions are denied (negatives)', () => {
  for (const action of CLOUDFLARE_WRITE_ACTIONS) {
    assert.equal(isCloudflareWriteAction(action), true);
    assert.throws(
      () => assertCloudflareWriteDenied(action),
      (err: unknown) =>
        err instanceof CloudflareWriteDeniedError && err.action === action,
    );
  }

  for (const method of CLOUDFLARE_INVENTORY_FORBIDDEN_METHODS) {
    assert.throws(
      () => assertCloudflareWriteDenied(method),
      CloudflareWriteDeniedError,
    );
  }

  // Non-write action does not throw
  assert.doesNotThrow(() => assertCloudflareWriteDenied('getInventory'));

  const denied = listDeniedWriteActions();
  assert.ok(denied.includes('cloudflare_deploy'));
  assert.ok(denied.includes('publish'));
  assert.ok(denied.includes('rollback'));
  assert.ok(denied.includes('executeGraphql'));
  assert.ok(denied.includes('queryObservability'));
});

// ── config risk ──────────────────────────────────────────────────────

test('100% sampling and Hyperdrive placeholder are config_risk / not_ready', () => {
  const risks = projectCloudflareConfigRisks({
    traceHeadSamplingRate: 1,
    hyperdriveId: HYPERDRIVE_PLACEHOLDER_ID,
    cloudflareQueueBindingPresent: false,
    r2BucketBindingDeclared: true,
    otelDestinationConfigured: false,
  });

  const sampling = risks.find((r) => r.id === 'trace_sampling_100pct');
  assert.ok(sampling);
  assert.equal(sampling.severity, 'config_risk');
  assert.match(sampling.businessImpact, /费用|敏感/);

  const hd = risks.find((r) => r.id === 'hyperdrive_placeholder');
  assert.ok(hd);
  assert.equal(hd.severity, 'not_ready');

  assert.equal(isHyperdrivePlaceholder(HYPERDRIVE_PLACEHOLDER_ID), true);
  assert.equal(isHyperdrivePlaceholder('real-id'), false);

  // No fictional Queue card
  assert.equal(
    shouldShowCloudflareQueueCard({ cloudflareQueueBindingPresent: false }),
    false,
  );

  const repo = defaultRepoConfigRisks();
  assert.ok(repo.some((r) => r.id === 'trace_sampling_100pct'));
  assert.ok(repo.some((r) => r.id === 'hyperdrive_placeholder'));
});

// ── self probes ──────────────────────────────────────────────────────

test('self probes report functional status without mutating Cloudflare', async () => {
  const results = await runCloudflareSelfProbes({
    shellBaseUrl: 'https://shell.example',
    request: async () => new Response('ok', { status: 200 }),
    databasePing: async () => ({ ok: true }),
    objectStoragePing: async () => ({ ok: false, detail: 'timeout' }),
    mapping: UNVERIFIED_MAPPING,
    hyperdriveId: HYPERDRIVE_PLACEHOLDER_ID,
    now: () => new Date('2026-07-20T00:00:00Z'),
  });

  assert.equal(results.length, 4);
  for (const r of results) {
    assert.equal(r.mutatesCloudflare, false);
    assert.ok(r.businessImpact.length > 0);
  }

  const shell = results.find((r) => r.kind === 'shell_http');
  assert.equal(shell?.status, 'ok');

  const db = results.find((r) => r.kind === 'database_connectivity');
  assert.equal(db?.status, 'ok');

  const storage = results.find((r) => r.kind === 'object_storage_binding');
  assert.equal(storage?.status, 'failed');

  const mapping = runMappingReadinessProbe({
    mapping: UNVERIFIED_MAPPING,
  });
  assert.equal(mapping.status, 'not_ready');
  assert.match(mapping.businessImpact, /未核验|映射/);
});
