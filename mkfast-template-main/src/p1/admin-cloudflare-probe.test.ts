import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adminCfProbeStatusLabel,
  defaultAdminCfProbes,
  projectAdminCfProbe,
  summarizeProbeSuite,
} from './admin-cloudflare-probe';

test('default probes are honest not_ready and non-mutating', () => {
  const probes = defaultAdminCfProbes(new Date('2026-07-20T00:00:00Z'));
  assert.equal(probes.length, 4);
  for (const p of probes) {
    assert.equal(p.status, 'not_ready');
    assert.equal(p.mutatesCloudflare, false);
    assert.ok(p.businessImpact.length > 0);
    assert.ok(p.title.length > 0);
  }
  const summary = summarizeProbeSuite(probes);
  assert.equal(summary.overall, 'not_ready');
  assert.equal(summary.allNonMutating, true);
  assert.equal(summary.okCount, 0);
});

test('probe projection and summary prioritize failed over degraded', () => {
  const probes = [
    projectAdminCfProbe({
      kind: 'shell_http',
      status: 'ok',
      businessImpact: 'ok',
      observedAt: '2026-07-20T00:00:00Z',
    }),
    projectAdminCfProbe({
      kind: 'database_connectivity',
      status: 'degraded',
      businessImpact: 'slow',
      observedAt: '2026-07-20T00:00:00Z',
    }),
    projectAdminCfProbe({
      kind: 'object_storage_binding',
      status: 'failed',
      businessImpact: 'down',
      observedAt: '2026-07-20T00:00:00Z',
    }),
  ];
  const summary = summarizeProbeSuite(probes);
  assert.equal(summary.overall, 'failed');
  assert.equal(summary.okCount, 1);
  assert.equal(summary.attentionCount, 2);
  assert.equal(adminCfProbeStatusLabel('failed'), '失败');
});
