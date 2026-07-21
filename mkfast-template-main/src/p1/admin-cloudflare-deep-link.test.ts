import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADMIN_CF_DEEP_LINK_RESOURCE_KINDS,
  AdminCfDeepLinkError,
  adminCfDeepLinkLabel,
  buildAdminCloudflareDeepLink,
  isAdminCfDeepLinkResourceKind,
} from './admin-cloudflare-deep-link';

test('deep-link builder carries redacted time range, script-deployment, correlation, capability', () => {
  const envelope = buildAdminCloudflareDeepLink({
    resourceKind: 'worker_logs',
    resourceRef: 'shell-prod',
    from: '2026-07-19T10:00:00+08:00',
    to: '2026-07-19T10:15:00+08:00',
    signal: 'error_rate_spike',
    capabilityId: 'observability_audit',
    capabilityLabel: '观测告警审计',
    scriptRef: 'shell-prod',
    deploymentRef: 'dep-1',
    versionRef: 'ver-9',
    correlationId: 'corr-abc',
    traceHint: 'trace-hint',
    returnTo: '/admin/cloudflare',
  });

  assert.equal(envelope.provider, 'cloudflare');
  assert.equal(envelope.resourceKind, 'worker_logs');
  assert.equal(envelope.from, '2026-07-19T10:00:00+08:00');
  assert.equal(envelope.to, '2026-07-19T10:15:00+08:00');
  assert.equal(envelope.capabilityContext?.capabilityId, 'observability_audit');
  assert.equal(envelope.scriptDeployment?.deploymentRef, 'dep-1');
  assert.equal(envelope.correlation?.correlationId, 'corr-abc');
  assert.equal(envelope.mutatesCloudflare, false);
  assert.equal(envelope.operatorAction, 'open_cloudflare_dashboard');
  assert.equal(
    adminCfDeepLinkLabel('worker_logs'),
    '到 Cloudflare 查看日志明细'
  );
});

test('deep-link allowlist + sensitive rejection', () => {
  assert.equal(isAdminCfDeepLinkResourceKind('worker_traces'), true);
  assert.equal(isAdminCfDeepLinkResourceKind('sql_console'), false);
  assert.ok(ADMIN_CF_DEEP_LINK_RESOURCE_KINDS.length >= 8);

  assert.throws(
    () =>
      buildAdminCloudflareDeepLink({
        resourceKind: 'not-allowed',
        resourceRef: 'x',
      }),
    (err: unknown) =>
      err instanceof AdminCfDeepLinkError &&
      err.code === 'resource_kind_not_allowed'
  );

  assert.throws(
    () =>
      buildAdminCloudflareDeepLink({
        resourceKind: 'worker_logs',
        resourceRef: '',
      }),
    (err: unknown) =>
      err instanceof AdminCfDeepLinkError &&
      err.code === 'resource_ref_required'
  );

  assert.throws(
    () =>
      buildAdminCloudflareDeepLink({
        resourceKind: 'worker_logs',
        resourceRef: 'shell',
        // @ts-expect-error intentional sensitive smuggle
        token: 'cf-api-token',
      }),
    /Sensitive field/
  );
});
