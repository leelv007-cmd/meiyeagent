import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertNoSecretEcho,
  buildCredentialUiPanel,
  isActivationGateSatisfied,
  projectCredentialAccountUi,
} from './admin-supply-credential-model';
import { buildDefaultSupplyControlSnapshot } from './admin-supply-fixture';

test('projects three-state trunk, tested gate, and draining sub-state', () => {
  const snapshot = buildDefaultSupplyControlSnapshot();
  const panel = buildCredentialUiPanel(snapshot, {
    enrichments: new Map([
      [
        'cred-provider-ark',
        {
          testStatus: 'passed',
          testedAt: '2026-07-20T08:00:00.000Z',
          evidenceRef: 'test://ark',
        },
      ],
      [
        'cred-provider-tuzi',
        {
          testStatus: 'passed',
          testedAt: '2026-07-20T08:00:00.000Z',
        },
      ],
      ['cred-provider-openai', { testStatus: 'pending' }],
    ]),
    now: '2026-07-20T12:00:00.000Z',
  });

  const ark = panel.accounts.find((a) => a.id === 'cred-provider-ark');
  const tuzi = panel.accounts.find((a) => a.id === 'cred-provider-tuzi');
  const openai = panel.accounts.find((a) => a.id === 'cred-provider-openai');

  assert.ok(ark);
  assert.equal(ark.status, 'active');
  assert.equal(ark.activationGate.satisfied, true);
  assert.equal(ark.drainSubstate, 'none');

  assert.ok(tuzi);
  assert.equal(tuzi.status, 'active');
  assert.equal(tuzi.drainSubstate, 'draining');
  assert.equal(tuzi.rotateDrainFlow.canCompleteDrain, true);

  assert.ok(openai);
  assert.equal(openai.status, 'pending');
  assert.equal(openai.activationGate.satisfied, false);
  assert.equal(openai.envFallbackRisk, true);
  assert.equal(openai.migrationEntryVisible, true);
  assert.match(openai.migrationEntryLabel ?? '', /迁移到保险箱/);
});

test('env_fallback risk and migration entry always visible on panel', () => {
  const snapshot = buildDefaultSupplyControlSnapshot();
  const panel = buildCredentialUiPanel(snapshot, {
    now: '2026-07-20T12:00:00.000Z',
  });
  assert.equal(panel.envFallbackRiskAlwaysVisible, true);
  assert.ok(panel.envFallbackCount >= 1);
  for (const account of panel.accounts) {
    if (account.source === 'env_fallback') {
      assert.equal(account.envFallbackRisk, true);
      assert.equal(account.migrationEntryVisible, true);
    }
  }
});

test('secret no-echo: raw keys and bearer tokens rejected', () => {
  assert.throws(() =>
    assertNoSecretEcho({ apiKey: 'fixture-secret' }),
  );
  assert.throws(() =>
    assertNoSecretEcho({ authorization: 'Bearer abcdefghijklmnop' }),
  );

  const snapshot = buildDefaultSupplyControlSnapshot();
  const panel = buildCredentialUiPanel(snapshot);
  assert.doesNotThrow(() => assertNoSecretEcho(panel));
  assert.doesNotMatch(JSON.stringify(panel), /sk-[A-Za-z0-9]{8,}/);
  assert.doesNotMatch(JSON.stringify(panel), /"password"\s*:/);
});

test('activation gate requires recent passed probe', () => {
  assert.equal(
    isActivationGateSatisfied({
      status: 'passed',
      testedAt: '2026-07-20T11:00:00.000Z',
      label: '探针通过',
    }, { now: '2026-07-20T12:00:00.000Z' }),
    true,
  );
  assert.equal(
    isActivationGateSatisfied({
      status: 'unauthorized',
      testedAt: '2026-07-20T11:00:00.000Z',
      label: '鉴权失败',
    }),
    false,
  );
  assert.equal(
    isActivationGateSatisfied({
      status: 'passed',
      testedAt: '2026-06-01T00:00:00.000Z',
      label: '探针通过',
    }, { now: '2026-07-20T12:00:00.000Z' }),
    false,
  );
});

test('binding projects deployments and pools without secret material', () => {
  const snapshot = buildDefaultSupplyControlSnapshot();
  const meta = snapshot.credentials[0]!;
  const view = projectCredentialAccountUi(meta, {
    snapshot,
    enrichment: {
      testStatus: 'passed',
      testedAt: '2026-07-18T00:00:00.000Z',
    },
    now: '2026-07-20T12:00:00.000Z',
  });
  assert.ok(view.binding.deploymentIds.length >= 1);
  assert.ok(view.binding.poolIds.length >= 1);
  assert.equal(view.secretReference.startsWith('secret://'), true);
  assert.doesNotThrow(() => assertNoSecretEcho(view));
});
