import assert from 'node:assert/strict';
import test from 'node:test';
import type { IntegrationConnection } from '../integrations/contracts.js';
import { FakeKmsSecretStore } from '../integrations/secret-store.js';
import {
  assertNoSecretEcho,
  createCredentialAccount,
  specializeCredentialAccount,
  toPublicMetadata,
  type CredentialAccount,
} from './credential-account.js';
import {
  CredentialLifecycleError,
  isActivationGateSatisfied,
  resolveFrozenCredentialVersion,
  transitionCredentialLifecycle,
} from './credential-lifecycle.js';
import {
  RequestTimeSecretBroker,
  normalizeConnectivityTestResult,
  putCredentialSecret,
  redactCredentialLogDetails,
  SecretBrokerError,
} from './secret-broker.js';
import {
  buildEnvFallbackMonitorView,
  classifyBootCredentialSource,
  projectEnvFallbackRisk,
} from './env-fallback-monitor.js';
import {
  assertCredentialSensitiveActionsAudited,
  CREDENTIAL_GOVERN_PERMISSION,
  CREDENTIAL_SENSITIVE_ACTIONS,
  projectCredentialSensitiveAudit,
} from './credential-sensitive-audit.js';

function fixtureConnection(
  overrides: Partial<IntegrationConnection> = {}
): IntegrationConnection {
  return {
    id: 'platform:model.direct',
    workspaceId: '__global__',
    provider: 'model',
    identityMode: 'service',
    requestedCapabilities: ['model.direct'],
    grantedCapabilities: ['model.direct'],
    degradedCapabilities: {},
    capabilityEvidence: {},
    status: 'available',
    subject: 'model.direct',
    secretRef: 'kms://__global__/cred-model-direct/v1',
    credential: {
      id: 'cred-model-direct',
      version: 1,
      mask: '••••••••',
      scope: ['models.read'],
      status: 'active',
    },
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
}

function activeAccount(seed?: Partial<CredentialAccount>): CredentialAccount {
  const base = createCredentialAccount({
    id: 'credential-account:platform:model.direct',
    label: 'Platform model.direct',
    providerProfileId: 'provider-tu-zi',
    type: 'model.direct',
    scope: 'platform',
    secretReference: 'kms://__global__/cred-model-direct/v1',
    version: '1',
    secretVersion: 1,
    credentialId: 'cred-model-direct',
    connectionId: 'platform:model.direct',
    workspaceId: '__global__',
    provider: 'model',
    source: 'registry',
    status: 'pending',
    now: '2026-07-18T00:00:00.000Z',
  });
  return { ...base, ...seed };
}

// ---------------------------------------------------------------------------
// Specialization from IntegrationConnection / CredentialMetadata
// ---------------------------------------------------------------------------

test('specializes IntegrationConnection into CredentialAccount metadata without secret values', () => {
  const connection = fixtureConnection({
    credential: {
      id: 'cred-model-direct',
      version: 3,
      mask: '••••••••',
      scope: ['models.read'],
      status: 'active',
      testedAt: '2026-07-18T10:00:00.000Z',
      testStatus: 'passed',
      expiresAt: '2027-01-01T00:00:00.000Z',
    },
  });
  const account = specializeCredentialAccount({
    connection,
    label: 'Platform model.direct',
    providerProfileId: 'provider-tu-zi',
    type: 'model.direct',
    projectRegion: 'cn',
    publicQuotaHint: 'rpm=600',
  });

  assert.equal(account.id, 'credential-account:platform:model.direct');
  assert.equal(account.label, 'Platform model.direct');
  assert.equal(account.providerProfileId, 'provider-tu-zi');
  assert.equal(account.projectRegion, 'cn');
  assert.equal(account.type, 'model.direct');
  assert.equal(account.scope, 'platform');
  assert.equal(account.secretReference, connection.secretRef);
  assert.equal(account.version, '3');
  assert.equal(account.status, 'active');
  assert.equal(account.drainSubstate, 'none');
  assert.equal(account.publicQuotaHint, 'rpm=600');
  assert.equal(account.expiresAt, '2027-01-01T00:00:00.000Z');
  assert.equal(account.verifiedAt, '2026-07-18T10:00:00.000Z');
  assert.equal(account.versionHistory.length, 1);

  const publicMeta = toPublicMetadata(account);
  assertNoSecretEcho(publicMeta);
  assert.equal(publicMeta.secretReference, connection.secretRef);
  assert.equal(JSON.stringify(publicMeta).includes('sk-'), false);
  // Ensure specialization did not invent a second vault field.
  assert.equal('vault' in account, false);
  assert.equal('secretValue' in account, false);
});

// ---------------------------------------------------------------------------
// Three-state SM + activation gate + draining sub-state
// ---------------------------------------------------------------------------

test('lifecycle trunk pending → active → retired with tested activation gate', () => {
  let account = activeAccount({ status: 'pending' });
  const now = '2026-07-18T12:00:00.000Z';

  // Activate without test evidence fails.
  assert.throws(
    () => transitionCredentialLifecycle(account, { kind: 'activate' }, { now }),
    (err: unknown) =>
      err instanceof CredentialLifecycleError &&
      err.code === 'ACTIVATION_GATE_FAILED'
  );

  // Failed probe does not open the gate.
  account = transitionCredentialLifecycle(
    account,
    {
      kind: 'record_test',
      evidence: {
        status: 'unauthorized',
        testedAt: now,
        evidenceRef: 'test://acc/v1/fail',
        errorCode: 'http_401',
      },
    },
    { now }
  );
  assert.equal(isActivationGateSatisfied(account, { now }), false);
  assert.throws(
    () => transitionCredentialLifecycle(account, { kind: 'activate' }, { now }),
    /ACTIVATION_GATE_FAILED|recent passed/
  );

  // Passed probe opens the gate.
  account = transitionCredentialLifecycle(
    account,
    {
      kind: 'record_test',
      evidence: {
        status: 'passed',
        testedAt: now,
        evidenceRef: 'test://acc/v1/pass',
      },
    },
    { now }
  );
  assert.equal(isActivationGateSatisfied(account, { now }), true);
  account = transitionCredentialLifecycle(
    account,
    { kind: 'activate' },
    { now }
  );
  assert.equal(account.status, 'active');
  assert.equal(account.drainSubstate, 'none');
  assert.equal(account.verifiedAt, now);

  // Drain is a sub-state of active, not a trunk state.
  account = transitionCredentialLifecycle(
    account,
    { kind: 'start_drain' },
    { now }
  );
  assert.equal(account.status, 'active');
  assert.equal(account.drainSubstate, 'draining');

  account = transitionCredentialLifecycle(
    account,
    { kind: 'complete_drain' },
    { now }
  );
  assert.equal(account.drainSubstate, 'none');

  account = transitionCredentialLifecycle(account, { kind: 'retire' }, { now });
  assert.equal(account.status, 'retired');
  assert.equal(account.drainSubstate, 'none');
});

test('rotation appends version history and never rewrites prior snapshots', () => {
  let account = activeAccount({ status: 'active' });
  const now = '2026-07-18T13:00:00.000Z';
  const prior = structuredClone(account.versionHistory[0]!);

  account = transitionCredentialLifecycle(
    account,
    {
      kind: 'rotate',
      next: {
        version: '2',
        secretReference: 'kms://__global__/cred-model-direct/v2',
        secretVersion: 2,
      },
    },
    { now }
  );

  assert.equal(account.version, '2');
  assert.equal(account.status, 'pending');
  assert.equal(account.verifiedAt, undefined);
  assert.equal(account.lastTest, undefined);
  assert.equal(account.versionHistory.length, 2);
  // Historical snapshot frozen.
  assert.deepEqual(account.versionHistory[0], prior);
  assert.equal(account.versionHistory[1]?.version, '2');
  // In-flight tasks can still resolve the frozen prior version.
  const frozen = resolveFrozenCredentialVersion(account, '1');
  assert.ok(frozen);
  assert.equal(frozen.secretReference, prior.secretReference);
  assert.equal(frozen.secretVersion, 1);

  // Cannot rewrite existing version.
  assert.throws(
    () =>
      transitionCredentialLifecycle(
        account,
        {
          kind: 'rotate',
          next: {
            version: '1',
            secretReference: 'kms://rewrite',
            secretVersion: 1,
          },
        },
        { now }
      ),
    (err: unknown) =>
      err instanceof CredentialLifecycleError &&
      err.code === 'VERSION_ALREADY_EXISTS'
  );
});

test('drain rejected outside active; revoke from pending retires', () => {
  const pending = activeAccount({ status: 'pending' });
  assert.throws(
    () =>
      transitionCredentialLifecycle(
        pending,
        { kind: 'start_drain' },
        {
          now: '2026-07-18T14:00:00.000Z',
        }
      ),
    /Drain is only allowed on active/
  );

  const retired = transitionCredentialLifecycle(
    pending,
    { kind: 'revoke' },
    { now: '2026-07-18T14:00:00.000Z' }
  );
  assert.equal(retired.status, 'retired');
});

// ---------------------------------------------------------------------------
// Request-time secret broker + no echo / log redaction
// ---------------------------------------------------------------------------

test('secret broker assembles by frozen version and product projection never echoes secrets', async () => {
  const secrets = new FakeKmsSecretStore();
  const put1 = await putCredentialSecret({
    secrets,
    workspaceId: '__global__',
    credentialId: 'cred-model-direct',
    secretVersion: 1,
    provider: 'model',
    value: 'fixture-secret-version-one',
  });
  const put2 = await putCredentialSecret({
    secrets,
    workspaceId: '__global__',
    credentialId: 'cred-model-direct',
    secretVersion: 2,
    provider: 'model',
    value: 'fixture-secret-version-two',
  });

  let account = createCredentialAccount({
    id: 'credential-account:platform:model.direct',
    label: 'Platform model.direct',
    providerProfileId: 'provider-tu-zi',
    type: 'model.direct',
    scope: 'platform',
    secretReference: put1.secretReference,
    version: '1',
    secretVersion: 1,
    credentialId: 'cred-model-direct',
    connectionId: 'platform:model.direct',
    workspaceId: '__global__',
    provider: 'model',
    status: 'active',
    now: '2026-07-18T00:00:00.000Z',
  });
  account = transitionCredentialLifecycle(
    account,
    {
      kind: 'rotate',
      next: {
        version: '2',
        secretReference: put2.secretReference,
        secretVersion: 2,
      },
    },
    { now: '2026-07-18T01:00:00.000Z' }
  );

  const directory = {
    get: (id: string) => (id === account.id ? account : null),
  };
  const broker = new RequestTimeSecretBroker(directory, secrets);

  await assert.rejects(
    () =>
      broker.assembleForRequest({
        credentialAccountId: account.id,
        requiredScope: 'platform',
      }),
    (err: unknown) =>
      err instanceof SecretBrokerError && err.code === 'ACCOUNT_PENDING'
  );

  const connectivityCredential = await broker.assembleForConnectivityTest({
    credentialAccountId: account.id,
    requiredScope: 'platform',
    version: '2',
  });
  assert.equal(
    connectivityCredential.secret,
    await secrets.use(put2.secretReference, {
      workspaceId: '__global__',
      credentialId: 'cred-model-direct',
      version: 2,
      provider: 'model',
    })
  );
  await assert.rejects(
    () =>
      broker.assembleForConnectivityTest({
        credentialAccountId: account.id,
        requiredScope: 'platform',
        version: '1',
      }),
    (err: unknown) =>
      err instanceof SecretBrokerError && err.code === 'VERSION_NOT_CURRENT'
  );

  account = transitionCredentialLifecycle(
    account,
    {
      kind: 'record_test',
      evidence: {
        status: 'passed',
        testedAt: '2026-07-18T01:01:00.000Z',
        evidenceRef: 'test://acc/v2/pass',
      },
    },
    { now: '2026-07-18T01:01:00.000Z' }
  );
  account = transitionCredentialLifecycle(
    account,
    { kind: 'activate' },
    { now: '2026-07-18T01:01:00.000Z' }
  );

  // In-flight task frozen on v1 keeps v1 secret (no silent upgrade to v2).
  const assembledV1 = await broker.assembleForRequest({
    credentialAccountId: account.id,
    frozenVersion: '1',
    requiredScope: 'platform',
  });
  assert.equal(assembledV1.secret, 'fixture-secret-version-one');
  assert.equal(assembledV1.version, '1');

  const assembledV2 = await broker.assembleForRequest({
    credentialAccountId: account.id,
    frozenVersion: '2',
    requiredScope: 'platform',
  });
  assert.equal(assembledV2.secret, 'fixture-secret-version-two');

  const assembledHead = await broker.assembleForRequest({
    credentialAccountId: account.id,
    requiredScope: 'platform',
  });
  assert.equal(assembledHead.secret, assembledV2.secret);
  assert.equal(assembledHead.version, '2');

  // Unknown frozen version refuses silent upgrade.
  await assert.rejects(
    () =>
      broker.assembleForRequest({
        credentialAccountId: account.id,
        frozenVersion: '99',
        requiredScope: 'platform',
      }),
    (err: unknown) =>
      err instanceof SecretBrokerError && err.code === 'VERSION_NOT_FOUND'
  );

  // Scope isolation (platform task must not read workspace_byok).
  await assert.rejects(
    () =>
      broker.assembleForRequest({
        credentialAccountId: account.id,
        frozenVersion: '2',
        requiredScope: 'workspace_byok',
      }),
    (err: unknown) =>
      err instanceof SecretBrokerError && err.code === 'SCOPE_ISOLATION'
  );

  const publicMeta = await broker.projectPublic(account.id);
  assertNoSecretEcho(publicMeta);
  assert.equal(JSON.stringify(publicMeta).includes('fixture-secret'), false);
});

test('secret broker pending/drain allow frozen history but reject head assembly', async () => {
  const secrets = new FakeKmsSecretStore();
  const put1 = await putCredentialSecret({
    secrets,
    workspaceId: '__global__',
    credentialId: 'cred-model-direct',
    secretVersion: 1,
    provider: 'model',
    value: 'fixture-secret-version-one',
  });
  const put2 = await putCredentialSecret({
    secrets,
    workspaceId: '__global__',
    credentialId: 'cred-model-direct',
    secretVersion: 2,
    provider: 'model',
    value: 'fixture-secret-version-two',
  });

  let account = createCredentialAccount({
    id: 'credential-account:platform:model.direct',
    label: 'Platform model.direct',
    providerProfileId: 'provider-tu-zi',
    type: 'model.direct',
    scope: 'platform',
    secretReference: put1.secretReference,
    version: '1',
    secretVersion: 1,
    credentialId: 'cred-model-direct',
    connectionId: 'platform:model.direct',
    workspaceId: '__global__',
    provider: 'model',
    status: 'active',
    now: '2026-07-18T00:00:00.000Z',
  });
  account = transitionCredentialLifecycle(
    account,
    {
      kind: 'rotate',
      next: {
        version: '2',
        secretReference: put2.secretReference,
        secretVersion: 2,
      },
    },
    { now: '2026-07-18T01:00:00.000Z' },
  );
  assert.equal(account.status, 'pending');

  let current = account;
  const broker = new RequestTimeSecretBroker(
    { get: (id) => (id === current.id ? current : null) },
    secrets,
  );

  // F-G-01: in-flight frozen v1 must still assemble while pending.
  const inflight = await broker.assembleForRequest({
    credentialAccountId: current.id,
    frozenVersion: '1',
    requiredScope: 'platform',
  });
  assert.equal(inflight.version, '1');
  assert.equal(inflight.secret, 'fixture-secret-version-one');

  // New head assembly without freeze is rejected while pending.
  await assert.rejects(
    () =>
      broker.assembleForRequest({
        credentialAccountId: current.id,
        requiredScope: 'platform',
      }),
    (err: unknown) =>
      err instanceof SecretBrokerError && err.code === 'ACCOUNT_PENDING',
  );

  // Drain sub-state: same rule for frozen history vs head.
  current = {
    ...current,
    status: 'active',
    drainSubstate: 'draining',
  };
  const drainFrozen = await broker.assembleForRequest({
    credentialAccountId: current.id,
    frozenVersion: '1',
    requiredScope: 'platform',
  });
  assert.equal(drainFrozen.version, '1');
  await assert.rejects(
    () =>
      broker.assembleForRequest({
        credentialAccountId: current.id,
        requiredScope: 'platform',
      }),
    (err: unknown) =>
      err instanceof SecretBrokerError && err.code === 'ACCOUNT_PENDING',
  );
});

test('secret broker rejects retired accounts including frozen versions', async () => {
  const account = activeAccount({ status: 'retired' });
  const broker = new RequestTimeSecretBroker(
    { get: () => account },
    new FakeKmsSecretStore()
  );

  await assert.rejects(
    () =>
      broker.assembleForRequest({
        credentialAccountId: account.id,
        frozenVersion: '1',
        requiredScope: 'platform',
      }),
    (err: unknown) =>
      err instanceof SecretBrokerError && err.code === 'ACCOUNT_RETIRED'
  );
});

test('secret broker rejects expired active accounts', async () => {
  const account = activeAccount({
    status: 'active',
    expiresAt: '2026-07-18T00:30:00.000Z',
  });
  const broker = new RequestTimeSecretBroker(
    { get: () => account },
    new FakeKmsSecretStore(),
    () => new Date('2026-07-18T01:00:00.000Z')
  );

  await assert.rejects(
    () =>
      broker.assembleForRequest({
        credentialAccountId: account.id,
        requiredScope: 'platform',
      }),
    (err: unknown) =>
      err instanceof SecretBrokerError && err.code === 'ACCOUNT_EXPIRED'
  );
});

test('connectivity test normalizes without logging upstream response / Authorization / query', () => {
  const result = normalizeConnectivityTestResult({
    credentialAccountId: 'credential-account:platform:model.direct',
    credentialVersion: '1',
    status: 'passed',
    testedAt: '2026-07-18T15:00:00.000Z',
    upstreamResponse: {
      data: [{ id: 'model-x' }],
      secret: 'fixture-should-not-leak',
    },
    authorizationHeader: 'Bearer fixture-secret-version-one',
    endpointWithQuery:
      'https://api.example.test/v1/models?api_key=fixture-secret-version-one',
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.errorCode, undefined);
  assertNoSecretEcho(result);
  const json = JSON.stringify(result);
  assert.equal(json.includes('fixture-secret'), false);
  assert.equal(json.includes('Bearer'), false);
  assert.equal(json.includes('api_key='), false);
  assert.equal(json.includes('model-x'), false);

  const redacted = redactCredentialLogDetails({
    status: 'passed',
    authorization: 'Bearer fixture-secret-version-one',
    upstreamResponse: { ok: true, body: 'secret-body' },
    endpoint: 'https://api.example.test/v1/models?token=abc',
    errorCode: undefined,
    note: 'Bearer fixture-secret-version-one used',
  });
  assert.equal('authorization' in redacted, false);
  assert.equal('upstreamResponse' in redacted, false);
  assert.equal(redacted.endpoint, 'https://api.example.test/v1/models');
  assert.match(String(redacted.note), /\[REDACTED\]/);
  assertNoSecretEcho(redacted);
});

// ---------------------------------------------------------------------------
// env_fallback monitoring projection
// ---------------------------------------------------------------------------

test('bare env is projected as monitored env_fallback with migration entry', () => {
  const bare = projectEnvFallbackRisk('model.direct', { kind: 'env' });
  assert.equal(bare.effectiveSource, 'env_fallback');
  assert.equal(bare.riskLevel, 'bare_env');
  assert.ok(bare.migrationEntry);
  assert.equal(bare.migrationEntry?.action, 'migrate_to_vault');
  assert.equal(bare.migrationEntry?.workerSecretsNotRegistry, true);
  assert.equal(bare.migrationEntry?.target, 'credential_account_registry');

  const monitored = projectEnvFallbackRisk('ark.media', {
    kind: 'env_fallback',
  });
  assert.equal(monitored.riskLevel, 'monitored_fallback');
  assert.ok(monitored.migrationEntry);

  const vault = projectEnvFallbackRisk('model.direct', {
    kind: 'vault',
    credentialVersion: 2,
  });
  assert.equal(vault.riskLevel, 'none');
  assert.equal(vault.migrationEntry, null);

  const view = buildEnvFallbackMonitorView({
    'model.direct': { assembly: { kind: 'env' } },
    'ark.media': { assembly: { kind: 'env_fallback' } },
  });
  assert.equal(view.workerSecretsAreNotRegistryTruth, true);
  assert.equal(view.bareEnvCount, 1);
  assert.equal(view.monitoredFallbackCount, 1);
  assert.equal(view.notWiredCount, 0);
  assert.deepEqual(view.migrationRequiredSlots, ['model.direct', 'ark.media']);

  const classified = classifyBootCredentialSource({ source: 'env' });
  assert.equal(classified.monitoredAs, 'env_fallback');
  assert.equal(classified.assembly.kind, 'env');
});

// ---------------------------------------------------------------------------
// High-sensitivity permission audit (D-057 / K1 helpers)
// ---------------------------------------------------------------------------

test('high-sensitivity credential actions each produce credential.govern audits', () => {
  const account = activeAccount({ status: 'active' });
  const audits = CREDENTIAL_SENSITIVE_ACTIONS.map((action) =>
    projectCredentialSensitiveAudit({
      action,
      actor: { userId: 'admin-1', role: 'admin' },
      account,
      correlationId: `corr-${action}`,
      occurredAt: '2026-07-18T16:00:00.000Z',
      details: {
        authorization: 'Bearer sk-must-not-appear',
        note: 'rotation',
      },
    })
  );

  assertCredentialSensitiveActionsAudited(audits);
  for (const audit of audits) {
    assert.equal(audit.permission, CREDENTIAL_GOVERN_PERMISSION);
    assert.equal(audit.target.module, 'supply-registry.credential');
    assert.ok(
      (CREDENTIAL_SENSITIVE_ACTIONS as readonly string[]).includes(
        audit.target.action
      )
    );
    assertNoSecretEcho(audit);
    assert.equal(JSON.stringify(audit).includes('sk-must-not-appear'), false);
  }

  // Distinct action coverage (view_meta / write_rotate / test / activate / drain / revoke).
  assert.deepEqual(
    audits.map((a) => a.target.action).sort(),
    [...CREDENTIAL_SENSITIVE_ACTIONS].sort()
  );
});
