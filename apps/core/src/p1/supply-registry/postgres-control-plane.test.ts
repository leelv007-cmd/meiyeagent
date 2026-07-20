import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Pool } from 'pg';
import { P1DomainError } from '../foundation/domain.js';
import type { CredentialAccount } from './credential-account.js';
import type { ExpandedSupplyRegistrySnapshot } from './expand.js';
import {
  CapabilityHotAssemblyRegistry,
  type RuntimeCapabilityRevision,
} from './hot-assembly.js';
import {
  PostgresEffectiveCapabilityRevisionStore,
  PostgresSupplyControlPlaneRepository,
} from './postgres-control-plane.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

function registryRevision(
  revisionId: string,
  revisionNumber: number
): ExpandedSupplyRegistrySnapshot {
  return {
    catalogRevisionId: revisionId,
    catalogRevisionNumber: revisionNumber,
    models: [
      {
        id: 'z-order-sentinel',
        modality: 'llm',
        operations: ['copy.generate'],
        displayName: 'Order sentinel',
      },
      {
        id: 'seedream-5',
        modality: 'image',
        operations: ['image.generate'],
        displayName: 'Seedream 5',
        manufacturer: 'ByteDance',
      },
    ],
    providerProfiles: [
      {
        id: 'provider-ark',
        displayName: 'Volcengine Ark',
        counterparty: 'ByteDance',
        gatewayFingerprint: 'none',
        revisionId: 'provider-ark:r1',
      },
    ],
    executionChannels: [
      {
        id: 'channel-ark-cn',
        providerProfileId: 'provider-ark',
        kind: 'official_direct',
        region: 'domestic',
        protocolFamily: 'ark-image',
        accountOwnership: 'platform',
        revisionId: 'channel-ark-cn:r1',
      },
    ],
    deployments: [
      {
        id: 'seedream-5-ark-cn',
        catalogModelId: 'seedream-5',
        providerProfileId: 'provider-ark',
        executionChannelId: 'channel-ark-cn',
        endpointRevision: 'ark-image:v1',
        lifecycleStatus: 'active',
        credentialAccountId: 'credential-account:ark-platform',
        revisionId: 'seedream-5-ark-cn:r1',
      },
    ],
    contracts: [
      {
        id: 'contract-ark',
        providerProfileId: 'provider-ark',
        termsRevisionId: 'contract-ark:terms:r1',
        effectiveFrom: '2026-07-20T00:00:00.000Z',
      },
    ],
    source: {
      providerProfileRevisions: [],
      executionChannelRevisions: [],
      publishedDeployments: [],
    },
  };
}

function credentialAccount(
  workspaceId: string,
  version: number
): CredentialAccount {
  const timestamp = `2026-07-20T00:00:0${version}.000Z`;
  return {
    id: 'credential-account:ark-platform',
    label: 'Ark platform account',
    providerProfileId: 'provider-ark',
    projectRegion: 'cn-beijing',
    type: 'api_key',
    scope: 'platform',
    secretReference: `secret://ark-platform/v${version}`,
    version: String(version),
    status: 'active',
    drainSubstate: 'none',
    source: 'registry',
    verifiedAt: timestamp,
    lastTestEvidenceRef: `probe://ark-platform/v${version}`,
    lastTest: {
      status: 'passed',
      testedAt: timestamp,
      evidenceRef: `probe://ark-platform/v${version}`,
    },
    connectionId: 'platform:model.direct',
    workspaceId,
    provider: 'model',
    credentialId: 'ark-platform',
    secretVersion: version,
    versionHistory: [
      {
        version: String(version),
        secretReference: `secret://ark-platform/v${version}`,
        secretVersion: version,
        createdAt: timestamp,
        source: 'registry',
        mask: '••••••••',
      },
    ],
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: timestamp,
  };
}

function capabilityRevision(
  revisionId: string,
  number: number,
  credentialVersion: string,
  previousRevisionId?: string
): RuntimeCapabilityRevision {
  return {
    revisionId,
    number,
    entries: [
      {
        deploymentId: 'seedream-5-ark-cn',
        catalogModelId: 'seedream-5',
        apiFamily: 'ark-image',
        channel: 'direct',
        region: 'domestic',
        executionChannelId: 'channel-ark-cn',
        credentialAccountId: 'credential-account:ark-platform',
        credentialVersion,
        adapterKey: 'ark-media',
        adapterBindingRevision: `ark-media:${credentialVersion}`,
      },
    ],
    publishedAt: `2026-07-20T00:00:0${number}.000Z`,
    ...(previousRevisionId ? { previousRevisionId } : {}),
  };
}

describe(
  'Postgres supply control-plane persistence',
  { skip: databaseUrl ? false : 'TEST_DATABASE_URL is not configured' },
  () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 6 });
    const repository = new PostgresSupplyControlPlaneRepository(pool);
    const registryWorkspaceId = `supply-registry-${randomUUID()}`;
    const credentialWorkspaceId = `supply-credential-${randomUUID()}`;
    const capabilityWorkspaceId = `supply-capability-${randomUUID()}`;

    before(async () => repository.migrate());

    after(async () => {
      await repository.deleteWorkspaceForTest(registryWorkspaceId);
      await repository.deleteWorkspaceForTest(credentialWorkspaceId);
      await repository.deleteWorkspaceForTest(capabilityWorkspaceId);
      await pool.end();
    });

    it('rebuilds the normalized registry from relational rows after restart and rejects a stale head', async () => {
      const first = registryRevision('catalog-r1', 1);
      await repository.setCurrentRegistryRevision(
        registryWorkspaceId,
        first,
        null
      );

      const restarted = new PostgresSupplyControlPlaneRepository(pool);
      assert.deepEqual(
        await restarted.getCurrentRegistryRevision(registryWorkspaceId),
        first
      );

      const candidates = [
        registryRevision('catalog-r2-a', 2),
        registryRevision('catalog-r2-b', 2),
      ];
      const results = await Promise.allSettled(
        candidates.map((candidate) =>
          restarted.setCurrentRegistryRevision(
            registryWorkspaceId,
            candidate,
            first.catalogRevisionId ?? null
          )
        )
      );

      assert.equal(
        results.filter((result) => result.status === 'fulfilled').length,
        1
      );
      const rejected = results.find((result) => result.status === 'rejected');
      assert.ok(
        rejected?.status === 'rejected' &&
          rejected.reason instanceof P1DomainError &&
          rejected.reason.code === 'IDEMPOTENCY_CONFLICT'
      );
      const current =
        await restarted.getCurrentRegistryRevision(registryWorkspaceId);
      assert.ok(
        candidates.some(
          (candidate) =>
            candidate.catalogRevisionId === current?.catalogRevisionId
        )
      );
      assert.equal(
        (await restarted.listRegistryRevisions(registryWorkspaceId)).length,
        2
      );

      const collision = structuredClone(current);
      assert.ok(collision);
      const firstModel = collision.models[0];
      assert.ok(firstModel);
      collision.models[0] = {
        ...firstModel,
        displayName: 'Conflicting immutable body',
      };
      await assert.rejects(
        () =>
          restarted.setCurrentRegistryRevision(
            registryWorkspaceId,
            collision,
            collision.catalogRevisionId
          ),
        (error) =>
          error instanceof P1DomainError &&
          error.code === 'IDEMPOTENCY_CONFLICT'
      );
    });

    it('persists CredentialAccount metadata across restart and allows only one writer per record revision', async () => {
      const first = credentialAccount(credentialWorkspaceId, 1);
      assert.equal(
        await repository.saveCredentialAccount(
          credentialWorkspaceId,
          first,
          null
        ),
        1
      );

      const restarted = new PostgresSupplyControlPlaneRepository(pool);
      assert.deepEqual(
        await restarted.getCredentialAccount(credentialWorkspaceId, first.id),
        { account: first, recordRevision: 1 }
      );

      const results = await Promise.allSettled([
        restarted.saveCredentialAccount(
          credentialWorkspaceId,
          credentialAccount(credentialWorkspaceId, 2),
          1
        ),
        restarted.saveCredentialAccount(
          credentialWorkspaceId,
          credentialAccount(credentialWorkspaceId, 3),
          1
        ),
      ]);

      assert.equal(
        results.filter((result) => result.status === 'fulfilled').length,
        1
      );
      const rejected = results.find((result) => result.status === 'rejected');
      assert.ok(
        rejected?.status === 'rejected' &&
          rejected.reason instanceof P1DomainError &&
          rejected.reason.code === 'IDEMPOTENCY_CONFLICT'
      );
      const stored = await restarted.getCredentialAccount(
        credentialWorkspaceId,
        first.id
      );
      assert.equal(stored?.recordRevision, 2);
      assert.ok(
        stored?.account.version === '2' || stored?.account.version === '3'
      );
    });

    it('shares effective capability history across store instances and CAS-protects the head', async () => {
      const first = capabilityRevision('capability-r1', 1, '1');
      await repository.setEffectiveCapabilityRevision(
        capabilityWorkspaceId,
        first,
        null
      );

      const httpStore = new PostgresEffectiveCapabilityRevisionStore(
        repository,
        capabilityWorkspaceId
      );
      const workerStore = new PostgresEffectiveCapabilityRevisionStore(
        new PostgresSupplyControlPlaneRepository(pool),
        capabilityWorkspaceId
      );
      assert.deepEqual(await httpStore.get(), first);
      assert.deepEqual(await workerStore.getById(first.revisionId), first);
      const runtimeRegistry = new CapabilityHotAssemblyRegistry(
        await workerStore.loadRuntimeStore()
      );
      assert.equal(runtimeRegistry.getEffectiveRevisionId(), first.revisionId);

      const candidates = [
        capabilityRevision('capability-r2-a', 2, '2', first.revisionId),
        capabilityRevision('capability-r2-b', 2, '3', first.revisionId),
      ];
      const results = await Promise.allSettled(
        candidates.map((candidate) =>
          repository.setEffectiveCapabilityRevision(
            capabilityWorkspaceId,
            candidate,
            first.revisionId
          )
        )
      );

      assert.equal(
        results.filter((result) => result.status === 'fulfilled').length,
        1
      );
      const rejected = results.find((result) => result.status === 'rejected');
      assert.ok(
        rejected?.status === 'rejected' &&
          rejected.reason instanceof P1DomainError &&
          rejected.reason.code === 'IDEMPOTENCY_CONFLICT'
      );
      const workerHead = await workerStore.get();
      assert.ok(
        candidates.some(
          (candidate) => candidate.revisionId === workerHead?.revisionId
        )
      );
      assert.equal((await workerStore.listHistory()).length, 2);

      assert.ok(workerHead);
      await assert.rejects(
        () =>
          workerStore.compareAndSet(
            {
              ...workerHead,
              entries: workerHead.entries.map((entry) => ({
                ...entry,
                adapterKey: 'conflicting-adapter',
              })),
            },
            workerHead.revisionId
          ),
        (error) =>
          error instanceof P1DomainError &&
          error.code === 'IDEMPOTENCY_CONFLICT'
      );
    });
  }
);
