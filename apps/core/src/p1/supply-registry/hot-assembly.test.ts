import assert from 'node:assert/strict';
import test from 'node:test';
import type { ModelCapabilityRequirementAxis } from '@meiye/contracts';
import {
  createCredentialAccount,
  type CredentialAccount,
} from './credential-account.js';
import { transitionCredentialLifecycle } from './credential-lifecycle.js';
import {
  putCredentialSecret,
  RequestTimeSecretBroker,
  SecretBrokerError,
} from './secret-broker.js';
import type { SecretStorePort } from '../integrations/contracts.js';
import {
  assertRuntimeCapabilityCompatible,
  CapabilityHotAssemblyRegistry,
  constrainDeploymentsToCapability,
  createSharedProcessHotAssemblyPair,
  decideChannelAdmission,
  defaultAdapterKey,
  diffCapabilityRevisions,
  HotAssemblyError,
  initialChannelLifecycle,
  isCatalogOnlyHotSwitch,
  matchRuntimeCapabilityRequirement,
  MemoryEffectiveCapabilityRevisionStore,
  projectCapabilityRevision,
  resolveFrozenCapabilityEntry,
  shouldInvalidateAssemblyCache,
  supportsRuntimeCapability,
  toRuntimeCapabilityEntry,
  transitionChannelLifecycle,
  type RuntimeCapabilityEntry,
  type RuntimeCapabilityMatchInput,
  type RuntimeCapabilityRevision,
} from './hot-assembly.js';

test('capability matching honors explicit overrides and audits unknown fallback', () => {
  const requirement: ModelCapabilityRequirementAxis = {
    axisId: 'briefImage',
    vocabularyVersion: 'model-capability-v1',
    requiredProtocolCapabilities: ['structured-output'],
    requiredModalities: ['text/plain'],
    requiredBusinessTags: [],
    requiredModalityCapabilities: [],
    unknownPolicy: 'conservative_always_available',
  };
  const supported = deployment({
    id: 'structured-direct',
    capabilityProfile: {
      vocabularyVersion: 'model-capability-v1',
      protocolCapabilities: {
        'structured-output': {
          value: true,
          basis: 'inferred',
          evidenceRef: 'catalog://structured-output',
        },
      },
      modalities: [
        {
          mime: 'text/plain',
          supported: true,
          basis: 'inferred',
          evidenceRef: 'catalog://text',
        },
      ],
      businessTags: [],
      modalityCapabilities: [],
    },
  });

  assert.deepEqual(
    matchRuntimeCapabilityRequirement(supported, requirement),
    {
      axisId: 'briefImage',
      deploymentId: 'structured-direct',
      outcome: 'eligible',
      reasons: [],
      evidenceRefs: [
        'catalog://structured-output',
        'catalog://text',
      ],
    },
  );

  const denied = structuredClone(supported);
  denied.capabilityProfile!.protocolCapabilities['structured-output'] = {
    value: false,
    basis: 'explicit_override',
    evidenceRef: 'operator://deny-structured-output',
  };
  assert.deepEqual(
    matchRuntimeCapabilityRequirement(denied, requirement),
    {
      axisId: 'briefImage',
      deploymentId: 'structured-direct',
      outcome: 'ineligible',
      reasons: ['explicit_override_denied:protocol:structured-output'],
      evidenceRefs: [
        'operator://deny-structured-output',
        'catalog://text',
      ],
    },
  );

  const unknown = deployment({ id: 'unknown-direct' });
  assert.deepEqual(
    matchRuntimeCapabilityRequirement(unknown, requirement),
    {
      axisId: 'briefImage',
      deploymentId: 'unknown-direct',
      outcome: 'conservative_fallback',
      reasons: [
        'capability_unknown:protocol:structured-output',
        'capability_unknown:modality:text/plain',
      ],
      evidenceRefs: [],
    },
  );
});

test('business-tag requirements participate in matching and unknown audit evidence', () => {
  const requirement: ModelCapabilityRequirementAxis = {
    axisId: 'skill:beauty-brand-voice',
    vocabularyVersion: 'model-capability-v1',
    requiredProtocolCapabilities: [],
    requiredModalities: [],
    requiredBusinessTags: ['beauty-brand-voice'],
    requiredModalityCapabilities: [],
    unknownPolicy: 'conservative_always_available',
  };
  const supported = deployment({
    id: 'beauty-brand-voice-direct',
    capabilityProfile: {
      vocabularyVersion: 'model-capability-v1',
      protocolCapabilities: {},
      modalities: [],
      businessTags: [
        {
          tag: 'beauty-brand-voice',
          supported: true,
          basis: 'inferred',
          evidenceRef: 'catalog://beauty-brand-voice',
        },
      ],
      modalityCapabilities: [],
    },
  });

  assert.deepEqual(
    matchRuntimeCapabilityRequirement(supported, requirement),
    {
      axisId: 'skill:beauty-brand-voice',
      deploymentId: 'beauty-brand-voice-direct',
      outcome: 'eligible',
      reasons: [],
      evidenceRefs: ['catalog://beauty-brand-voice'],
    },
  );
  assert.deepEqual(
    matchRuntimeCapabilityRequirement(
      deployment({ id: 'beauty-brand-voice-unknown' }),
      requirement,
    ),
    {
      axisId: 'skill:beauty-brand-voice',
      deploymentId: 'beauty-brand-voice-unknown',
      outcome: 'conservative_fallback',
      reasons: ['capability_unknown:business-tag:beauty-brand-voice'],
      evidenceRefs: [],
    },
  );
});

test('image cjk-text-render requirements participate in matching and unknown audit evidence', () => {
  const requirement: ModelCapabilityRequirementAxis = {
    axisId: 'skill:image-cjk-text',
    vocabularyVersion: 'model-capability-v1',
    requiredProtocolCapabilities: [],
    requiredModalities: [],
    requiredBusinessTags: [],
    requiredModalityCapabilities: [
      {
        modality: 'image/*',
        capability: 'cjk-text-render',
      },
    ],
    unknownPolicy: 'conservative_always_available',
  };
  const supported = deployment({
    id: 'image-cjk-text-direct',
    capabilityProfile: {
      vocabularyVersion: 'model-capability-v1',
      protocolCapabilities: {},
      modalities: [],
      businessTags: [],
      modalityCapabilities: [
        {
          modality: 'image/*',
          capability: 'cjk-text-render',
          supported: true,
          channelBound: true,
          basis: 'inferred',
          evidenceRef: 'catalog://image-cjk-text-render',
        },
      ],
    },
  });

  assert.deepEqual(
    matchRuntimeCapabilityRequirement(supported, requirement),
    {
      axisId: 'skill:image-cjk-text',
      deploymentId: 'image-cjk-text-direct',
      outcome: 'eligible',
      reasons: [],
      evidenceRefs: ['catalog://image-cjk-text-render'],
    },
  );
  assert.deepEqual(
    matchRuntimeCapabilityRequirement(
      deployment({ id: 'image-cjk-text-unknown' }),
      requirement,
    ),
    {
      axisId: 'skill:image-cjk-text',
      deploymentId: 'image-cjk-text-unknown',
      outcome: 'conservative_fallback',
      reasons: [
        'capability_unknown:modality-capability:image/*:cjk-text-render',
      ],
      evidenceRefs: [],
    },
  );
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

class FakeKmsSecretStore implements SecretStorePort {
  private readonly values = new Map<string, string>();

  reference(context: {
    workspaceId: string;
    credentialId: string;
    version: number;
    provider: string;
  }): string {
    return `kms://${context.workspaceId}/${context.credentialId}/v${context.version}`;
  }

  async put(
    context: {
      workspaceId: string;
      credentialId: string;
      version: number;
      provider: string;
    },
    value: string,
  ): Promise<string> {
    const ref = this.reference(context);
    this.values.set(ref, value);
    return ref;
  }

  async use(secretRef: string): Promise<string> {
    const value = this.values.get(secretRef);
    if (value === undefined) throw new Error(`missing secret ${secretRef}`);
    return value;
  }

  async revoke(secretRef: string): Promise<void> {
    this.values.delete(secretRef);
  }
}

function deployment(
  partial: Partial<RuntimeCapabilityMatchInput> & { id: string },
): RuntimeCapabilityMatchInput {
  return {
    catalogModelId: partial.catalogModelId ?? 'copy-domestic',
    apiFamily: partial.apiFamily ?? 'openai',
    channel: partial.channel ?? 'direct',
    region: partial.region ?? 'domestic',
    status: partial.status ?? 'active',
    executionChannelId:
      partial.executionChannelId ?? 'channel-domestic-direct',
    providerModel: partial.providerModel ?? 'qwen-plus',
    endpointRevision: partial.endpointRevision ?? 'endpoint-v1',
    lifecycleRevision: partial.lifecycleRevision ?? 'lifecycle-v1',
    credentialVersion: partial.credentialVersion ?? 'cred-v1',
    ...partial,
  };
}

function entryFrom(
  dep: RuntimeCapabilityMatchInput,
  extra: Partial<RuntimeCapabilityEntry> = {},
): RuntimeCapabilityEntry {
  return {
    ...toRuntimeCapabilityEntry({
      ...dep,
      adapterKey: extra.adapterKey ?? defaultAdapterKey(dep),
      credentialAccountId: extra.credentialAccountId,
      adapterBindingRevision: extra.adapterBindingRevision,
    }),
    ...extra,
  };
}

function revision(
  id: string,
  number: number,
  entries: RuntimeCapabilityEntry[],
  previousRevisionId?: string,
): RuntimeCapabilityRevision {
  return projectCapabilityRevision({
    revisionId: id,
    number,
    entries,
    publishedAt: `2026-07-20T0${number}:00:00.000Z`,
    previousRevisionId,
  });
}

async function seededAccount(
  secrets: FakeKmsSecretStore,
): Promise<CredentialAccount> {
  const put1 = await putCredentialSecret({
    secrets,
    workspaceId: '__global__',
    credentialId: 'cred-model-direct',
    secretVersion: 1,
    provider: 'model',
    value: 'sk-live-secret-v1',
  });
  const put2 = await putCredentialSecret({
    secrets,
    workspaceId: '__global__',
    credentialId: 'cred-model-direct',
    secretVersion: 2,
    provider: 'model',
    value: 'sk-live-secret-v2',
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
  account = transitionCredentialLifecycle(
    account,
    {
      kind: 'record_test',
      evidence: {
        status: 'passed',
        testedAt: '2026-07-18T01:01:00.000Z',
        evidenceRef: 'test://hot-assembly/v2/pass',
      },
    },
    { now: '2026-07-18T01:01:00.000Z' },
  );
  account = transitionCredentialLifecycle(
    account,
    { kind: 'activate' },
    { now: '2026-07-18T01:01:00.000Z' },
  );
  return account;
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

test('supportsRuntimeCapability matches effective fingerprint dynamically', () => {
  const dep = deployment({ id: 'qwen-direct' });
  const entries = [entryFrom(dep)];
  assert.equal(supportsRuntimeCapability(entries, dep), true);

  assert.equal(
    supportsRuntimeCapability(entries, {
      ...dep,
      credentialVersion: 'cred-v2',
    }),
    false,
  );
  assert.equal(
    supportsRuntimeCapability(entries, deployment({ id: 'other' })),
    false,
  );
});

test('assertRuntimeCapabilityCompatible rejects active deployments outside effective revision', () => {
  const active = deployment({ id: 'qwen-direct' });
  const outside = deployment({
    id: 'gpt-image-2-managed',
    catalogModelId: 'gpt-image-2',
    apiFamily: 'image',
    channel: 'managed',
  });
  const entries = [entryFrom(active)];

  assert.doesNotThrow(() =>
    assertRuntimeCapabilityCompatible(entries, [active]),
  );
  assert.throws(
    () => assertRuntimeCapabilityCompatible(entries, [active, outside]),
    (err: unknown) =>
      err instanceof HotAssemblyError &&
      err.code === 'DEPLOYMENT_OUTSIDE_CAPABILITY' &&
      /gpt-image-2-managed/.test(err.message),
  );
  // Inactive outside capability is fine.
  assert.doesNotThrow(() =>
    assertRuntimeCapabilityCompatible(entries, [
      active,
      { ...outside, status: 'inactive' },
    ]),
  );
});

test('constrainDeploymentsToCapability demotes unsupported active deployments', () => {
  const supported = deployment({ id: 'qwen-direct' });
  const unsupported = deployment({ id: 'new-deploy' });
  const constrained = constrainDeploymentsToCapability(
    [entryFrom(supported)],
    [supported, unsupported],
  );
  assert.equal(constrained[0]?.status, 'active');
  assert.equal(constrained[1]?.status, 'inactive');
});

test('diffCapabilityRevisions tracks add/remove/credential/adapter changes', () => {
  const dep = deployment({ id: 'qwen-direct', credentialVersion: 'cred-v1' });
  const v1 = revision('cap-v1', 1, [
    entryFrom(dep, { adapterKey: 'direct-llm' }),
  ]);
  const v2 = revision(
    'cap-v2',
    2,
    [
      entryFrom(
        { ...dep, credentialVersion: 'cred-v2' },
        { adapterKey: 'direct-llm-v2', credentialAccountId: 'ca-1' },
      ),
      entryFrom(deployment({ id: 'second' }), { adapterKey: 'ark-media' }),
    ],
    'cap-v1',
  );
  const diff = diffCapabilityRevisions(v1, v2);
  assert.deepEqual(diff.addedDeploymentIds, ['second']);
  assert.deepEqual(diff.removedDeploymentIds, []);
  assert.ok(diff.changedDeploymentIds.includes('qwen-direct'));
  assert.equal(diff.credentialVersionChanges[0]?.to, 'cred-v2');
  assert.equal(diff.adapterKeyChanges[0]?.to, 'direct-llm-v2');
  assert.equal(shouldInvalidateAssemblyCache(v1, v2), true);
  assert.equal(shouldInvalidateAssemblyCache(v1, v1), false);
});

test('resolveFrozenCapabilityEntry never silent-upgrades missing history', () => {
  const dep = deployment({ id: 'qwen-direct', credentialVersion: 'cred-v1' });
  const v1 = revision('cap-v1', 1, [entryFrom(dep)]);
  const v2 = revision(
    'cap-v2',
    2,
    [entryFrom({ ...dep, credentialVersion: 'cred-v2' })],
    'cap-v1',
  );
  const frozen = resolveFrozenCapabilityEntry([v1, v2], 'cap-v1', 'qwen-direct');
  assert.equal(frozen?.entry.credentialVersion, 'cred-v1');
  assert.equal(
    resolveFrozenCapabilityEntry([v1, v2], 'cap-missing', 'qwen-direct'),
    null,
  );
  assert.equal(
    resolveFrozenCapabilityEntry([v1, v2], 'cap-v1', 'unknown'),
    null,
  );
});

// ---------------------------------------------------------------------------
// Catalog-only hot switch regression (orthogonal to capability)
// ---------------------------------------------------------------------------

test('catalog-only hot switch does not change capability revision or invalidate assembly cache', async () => {
  const secrets = new FakeKmsSecretStore();
  const account = await seededAccount(secrets);
  const broker = new RequestTimeSecretBroker(
    { get: (id) => (id === account.id ? account : null) },
    secrets,
  );
  const registry = new CapabilityHotAssemblyRegistry(
    new MemoryEffectiveCapabilityRevisionStore(),
    broker,
  );

  const dep = deployment({
    id: 'qwen-direct',
    credentialVersion: '1',
  });
  const cap = revision('cap-v1', 1, [
    entryFrom(dep, {
      adapterKey: 'direct-llm',
      credentialAccountId: account.id,
    }),
  ]);
  registry.applyCapabilityRevision(cap);
  registry.applyCatalogRevisionHead('catalog-v1');

  const before = await registry.assembleForRequest({
    deploymentId: 'qwen-direct',
    frozenCredentialVersion: '1',
    requiredScope: 'platform',
  });
  assert.equal(before.credential?.secret, 'sk-live-secret-v1');
  const statsBefore = registry.getAssemblyCacheStats();
  assert.equal(statsBefore.size, 0);

  // Catalog-only hot switch (existing applyCatalogRevision behavior).
  const previousCatalog = registry.getCatalogRevisionHead();
  const previousCap = registry.getEffectiveRevisionId();
  registry.applyCatalogRevisionHead('catalog-v2');
  assert.equal(
    isCatalogOnlyHotSwitch({
      previousCatalogRevisionId: previousCatalog,
      nextCatalogRevisionId: 'catalog-v2',
      previousCapabilityRevisionId: previousCap,
      nextCapabilityRevisionId: registry.getEffectiveRevisionId(),
    }),
    true,
  );

  // Capability head and assembly cache generation unchanged.
  assert.equal(registry.getEffectiveRevisionId(), 'cap-v1');
  assert.equal(
    registry.getAssemblyCacheStats().generation,
    statsBefore.generation,
  );

  const after = await registry.assembleForRequest({
    deploymentId: 'qwen-direct',
    frozenCredentialVersion: '1',
    requiredScope: 'platform',
  });
  assert.equal(after.capabilityRevisionId, 'cap-v1');
  assert.equal(after.credential?.secret, 'sk-live-secret-v1');
  assert.equal(after.adapterKey, 'direct-llm');
});

// ---------------------------------------------------------------------------
// NEW: credential / adapter hot switch without restart
// ---------------------------------------------------------------------------

test('credential and adapter hot switch: next task sees new version without restart', async () => {
  const secrets = new FakeKmsSecretStore();
  const account = await seededAccount(secrets);
  const broker = new RequestTimeSecretBroker(
    { get: (id) => (id === account.id ? account : null) },
    secrets,
  );
  const adapters = {
    get: (deploymentId: string) =>
      deploymentId === 'qwen-direct'
        ? {
            deploymentId: 'qwen-direct',
            adapterKey: 'direct-llm',
            adapterBindingRevision: 'adapter-bind-v1',
          }
        : null,
  };
  // Mutable adapter directory to simulate hot rebind.
  let adapterKey = 'direct-llm';
  let adapterRev = 'adapter-bind-v1';
  const liveAdapters = {
    get: (deploymentId: string) =>
      deploymentId === 'qwen-direct'
        ? {
            deploymentId,
            adapterKey,
            adapterBindingRevision: adapterRev,
          }
        : null,
  };

  const registry = new CapabilityHotAssemblyRegistry(
    new MemoryEffectiveCapabilityRevisionStore(),
    broker,
    liveAdapters,
  );

  const depV1 = deployment({
    id: 'qwen-direct',
    credentialVersion: '1',
  });
  registry.applyCapabilityRevision(
    revision('cap-v1', 1, [
      entryFrom(depV1, {
        adapterKey: 'direct-llm',
        credentialAccountId: account.id,
        adapterBindingRevision: 'adapter-bind-v1',
      }),
    ]),
  );

  const task1 = await registry.assembleForRequest({
    deploymentId: 'qwen-direct',
    frozenCredentialVersion: '1',
    requiredScope: 'platform',
  });
  assert.equal(task1.credential?.secret, 'sk-live-secret-v1');
  assert.equal(task1.adapterKey, 'direct-llm');
  assert.equal(task1.resolvedFromHistory, false);

  // Publish new Deployment/credential version + adapter binding (no restart).
  adapterKey = 'direct-llm-rotated';
  adapterRev = 'adapter-bind-v2';
  const depV2 = deployment({
    id: 'qwen-direct',
    credentialVersion: '2',
    endpointRevision: 'endpoint-v2',
  });
  const applied = registry.applyCapabilityRevision(
    revision(
      'cap-v2',
      2,
      [
        entryFrom(depV2, {
          adapterKey: 'direct-llm-rotated',
          credentialAccountId: account.id,
          adapterBindingRevision: 'adapter-bind-v2',
        }),
      ],
      'cap-v1',
    ),
  );
  assert.equal(applied.appliedRevisionId, 'cap-v2');
  assert.equal(applied.cacheInvalidated, true);
  assert.ok(
    applied.diff.credentialVersionChanges.some((row) => row.to === '2'),
  );

  // Next task (no frozen revision) picks up cap-v2 + credential v2 + new adapter.
  const task2 = await registry.assembleForRequest({
    deploymentId: 'qwen-direct',
    frozenCredentialVersion: '2',
    requiredScope: 'platform',
  });
  assert.equal(task2.capabilityRevisionId, 'cap-v2');
  assert.equal(task2.credential?.secret, 'sk-live-secret-v2');
  assert.equal(task2.credential?.version, '2');
  assert.equal(task2.adapterKey, 'direct-llm-rotated');
  assert.equal(task2.adapterBindingRevision, 'adapter-bind-v2');
  assert.equal(task2.resolvedFromHistory, false);

  // Publish gate now accepts the new active deployment fingerprint.
  assert.equal(registry.supportsDeployment(depV2), true);
  assert.equal(registry.supportsDeployment(depV1), false);
  assert.doesNotThrow(() => registry.assertCompatible([depV2]));
  assert.throws(
    () => registry.assertCompatible([depV1]),
    (err: unknown) =>
      err instanceof HotAssemblyError &&
      err.code === 'DEPLOYMENT_OUTSIDE_CAPABILITY',
  );

  // In-flight task frozen on cap-v1 / credential v1 keeps prior assembly.
  const inflight = await registry.assembleForRequest({
    deploymentId: 'qwen-direct',
    frozenCapabilityRevisionId: 'cap-v1',
    frozenCredentialVersion: '1',
    requiredScope: 'platform',
  });
  assert.equal(inflight.capabilityRevisionId, 'cap-v1');
  assert.equal(inflight.credential?.secret, 'sk-live-secret-v1');
  assert.equal(inflight.resolvedFromHistory, true);

  // Unknown frozen capability revision refuses silent upgrade.
  await assert.rejects(
    () =>
      registry.assembleForRequest({
        deploymentId: 'qwen-direct',
        frozenCapabilityRevisionId: 'cap-never',
        frozenCredentialVersion: '1',
        requiredScope: 'platform',
      }),
    (err: unknown) =>
      err instanceof HotAssemblyError &&
      err.code === 'CAPABILITY_REVISION_NOT_FOUND',
  );

  // Unknown frozen credential still refused by G2 broker.
  await assert.rejects(
    () =>
      registry.assembleForRequest({
        deploymentId: 'qwen-direct',
        frozenCredentialVersion: '99',
        requiredScope: 'platform',
      }),
    (err: unknown) =>
      err instanceof SecretBrokerError && err.code === 'VERSION_NOT_FOUND',
  );

  void adapters;
});

test('HTTP and Worker domain pair report the same effective capability revision', () => {
  const { http, worker } = createSharedProcessHotAssemblyPair();
  const dep = deployment({ id: 'qwen-direct' });
  const cap = revision('cap-shared-v1', 1, [entryFrom(dep)]);

  http.applyCapabilityRevision(cap);
  http.applyCatalogRevisionHead('catalog-shared-v3');

  // Worker reads the same store head without its own apply.
  assert.equal(worker.getEffectiveRevisionId(), 'cap-shared-v1');
  assert.equal(http.getEffectiveRevisionId(), 'cap-shared-v1');

  // Catalog head is process-local (applyCatalogRevision is per application
  // service); capability head is the shared contract for Z2 dual-process wiring.
  const httpView = http.reportProcessView('http');
  const workerView = worker.reportProcessView('job-worker');
  assert.equal(
    httpView.effectiveCapabilityRevisionId,
    workerView.effectiveCapabilityRevisionId,
  );
  assert.equal(httpView.capabilityRevisionNumber, 1);
  assert.equal(workerView.capabilityRevisionNumber, 1);
  assert.equal(httpView.effectiveCatalogRevisionId, 'catalog-shared-v3');
  // Worker has not applied a local catalog head — proves independence.
  assert.equal(workerView.effectiveCatalogRevisionId, null);
});

// ---------------------------------------------------------------------------
// Isolate / drain semantic contracts (no restart)
// ---------------------------------------------------------------------------

test('channel isolate/drain/restore semantic contract without restart', () => {
  const registry = new CapabilityHotAssemblyRegistry();
  const channelId = 'channel-domestic-direct';
  const dep = deployment({
    id: 'qwen-direct',
    executionChannelId: channelId,
  });
  registry.applyCapabilityRevision(
    revision('cap-v1', 1, [entryFrom(dep)]),
  );

  // Default accepting.
  assert.equal(
    registry.decideAdmission(channelId, 'new_submit').admitted,
    true,
  );
  assert.equal(
    registry.decideAdmission(channelId, 'in_flight').admitted,
    true,
  );

  // Isolate — new tasks rejected; in-flight continues; no restart.
  const isolated = registry.isolateChannel(channelId, 'manual_isolate', {
    now: '2026-07-20T10:00:00.000Z',
    inFlightCount: 2,
  });
  assert.equal(isolated.mode, 'isolated');
  assert.equal(isolated.drainMode, 'accepting');
  assert.equal(isolated.inFlightCount, 2);

  const isoNew = registry.decideAdmission(channelId, 'new_submit');
  assert.equal(isoNew.admitted, false);
  assert.equal(isoNew.errorCode, 'channel_isolated');
  assert.equal(
    registry.decideAdmission(channelId, 'in_flight').admitted,
    true,
  );

  // Restore accepting.
  const restored = registry.restoreChannel(channelId, 'manual_restore', {
    now: '2026-07-20T10:05:00.000Z',
  });
  assert.equal(restored.mode, 'accepting');
  assert.equal(
    registry.decideAdmission(channelId, 'new_submit').admitted,
    true,
  );

  // Drain — reject new submit, continue poll/download/cancel for in-flight.
  registry.acquireChannelSubmission(channelId, 'drain-flight-1');
  registry.acquireChannelSubmission(channelId, 'drain-flight-2');
  registry.acquireChannelSubmission(channelId, 'drain-flight-3');
  const draining = registry.startChannelDrain(channelId, 'rotate_credential', {
    now: '2026-07-20T11:00:00.000Z',
  });
  assert.equal(draining.mode, 'draining');
  assert.equal(draining.drainMode, 'draining');
  assert.equal(draining.inFlightCount, 3);

  const drainNew = registry.decideAdmission(channelId, 'new_submit');
  assert.equal(drainNew.admitted, false);
  assert.equal(drainNew.errorCode, 'channel_draining');
  assert.match(drainNew.message ?? '', /in-flight tasks continue/i);
  assert.equal(
    registry.decideAdmission(channelId, 'in_flight').admitted,
    true,
  );

  // Complete drain → accepting, in-flight cleared.
  registry.releaseChannelSubmission(channelId, 'drain-flight-1');
  registry.releaseChannelSubmission(channelId, 'drain-flight-2');
  registry.releaseChannelSubmission(channelId, 'drain-flight-3');
  const completed = registry.completeChannelDrain(
    channelId,
    'drain_complete',
    { now: '2026-07-20T12:00:00.000Z' },
  );
  assert.equal(completed.mode, 'accepting');
  assert.equal(completed.drainMode, 'accepting');
  assert.equal(completed.inFlightCount, 0);
  assert.equal(
    registry.decideAdmission(channelId, 'new_submit').admitted,
    true,
  );

  // complete_drain outside draining is rejected.
  assert.throws(
    () => registry.completeChannelDrain(channelId, 'again'),
    (err: unknown) =>
      err instanceof HotAssemblyError && err.code === 'CHANNEL_NOT_ACCEPTING',
  );

  // Isolate/drain invalidate assembly cache (generation bumps).
  const genBefore = registry.getAssemblyCacheStats().generation;
  registry.isolateChannel(channelId, 'again');
  assert.ok(registry.getAssemblyCacheStats().generation > genBefore);
});

test('pure decideChannelAdmission and transitionChannelLifecycle contracts', () => {
  const base = initialChannelLifecycle('ch-1', '2026-07-20T00:00:00.000Z');
  assert.equal(base.lifecycleRevision, 'ch-1:lifecycle:r0');
  assert.equal(decideChannelAdmission(base, 'new_submit').admitted, true);

  const isolated = transitionChannelLifecycle(
    base,
    { kind: 'isolate', reason: 'ops' },
    { channelId: 'ch-1', now: '2026-07-20T01:00:00.000Z', inFlightCount: 1 },
  );
  assert.equal(isolated.mode, 'isolated');
  assert.equal(isolated.lifecycleRevision, 'ch-1:lifecycle:r1');
  assert.equal(decideChannelAdmission(isolated, 'new_submit').admitted, false);
  assert.equal(decideChannelAdmission(isolated, 'in_flight').admitted, true);

  const draining = transitionChannelLifecycle(
    isolated,
    { kind: 'start_drain', reason: 'rotate' },
    { channelId: 'ch-1', now: '2026-07-20T02:00:00.000Z' },
  );
  assert.equal(draining.drainMode, 'draining');
  assert.equal(draining.lifecycleRevision, 'ch-1:lifecycle:r2');
  assert.equal(
    decideChannelAdmission(draining, 'new_submit').errorCode,
    'channel_draining',
  );
});

test('channel submission leases enforce stop-new and maintain drain count', async () => {
  const registry = new CapabilityHotAssemblyRegistry();
  const channelId = 'channel-production-submit';

  const acquired = await registry.acquireChannelSubmission(
    channelId,
    'attempt-1',
  );
  assert.equal(acquired.admitted, true);
  assert.equal(acquired.inFlightCount, 1);
  assert.equal(registry.getChannelLifecycle(channelId).inFlightCount, 1);

  registry.startChannelDrain(channelId, 'operator drain');
  const blocked = await registry.acquireChannelSubmission(
    channelId,
    'attempt-2',
  );
  assert.equal(blocked.admitted, false);
  assert.equal(blocked.errorCode, 'channel_draining');
  assert.equal(blocked.inFlightCount, 1);

  const released = await registry.releaseChannelSubmission(
    channelId,
    'attempt-1',
  );
  assert.equal(released.mode, 'draining');
  assert.equal(released.inFlightCount, 0);
});

test('channel lifecycle transitions reject stale expected revisions', () => {
  const registry = new CapabilityHotAssemblyRegistry();
  const channelId = 'channel-lifecycle-cas';
  const initial = registry.getChannelLifecycle(channelId);
  const isolated = registry.isolateChannel(channelId, 'operator isolate', {
    expectedLifecycleRevision: initial.lifecycleRevision,
  });
  assert.equal(isolated.lifecycleRevision, `${channelId}:lifecycle:r1`);

  assert.throws(
    () =>
      registry.restoreChannel(channelId, 'stale operator restore', {
        expectedLifecycleRevision: initial.lifecycleRevision,
      }),
    (error: unknown) =>
      error instanceof HotAssemblyError &&
      error.code === 'LIFECYCLE_REVISION_CONFLICT',
  );
  assert.equal(
    registry.getChannelLifecycle(channelId).lifecycleRevision,
    isolated.lifecycleRevision,
  );
});

test('defaultAdapterKey maps common channels without wiring live ports', () => {
  assert.equal(
    defaultAdapterKey({
      channel: 'direct',
      apiFamily: 'openai',
    }),
    'direct-llm',
  );
  assert.equal(
    defaultAdapterKey({
      channel: 'direct',
      apiFamily: 'image',
      executionChannelId: 'channel-ark-image',
    }),
    'ark-media',
  );
  assert.equal(
    defaultAdapterKey({
      channel: 'managed',
      apiFamily: 'image',
      executionChannelId: 'channel-tuzi-relay',
    }),
    'tuzi-media',
  );
  assert.equal(
    defaultAdapterKey({
      channel: 'bifrost',
      apiFamily: 'openai',
    }),
    'gateway-bifrost',
  );
});
