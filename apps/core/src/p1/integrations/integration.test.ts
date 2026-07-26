import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MemoryFoundationRepository,
  P1ApplicationService,
  ProductEntitlementApplicationService,
} from '../foundation/index.js';
import {
  FakeKmsSecretStore,
  FoundationStrictByokLedger,
  IntegrationApplicationService,
  IntegrationError,
  MemoryIntegrationRepository,
  RecordedDouyinAdapter,
  RecordedByokExecutionAdapter,
  RecordedFeishuMcpAdapter,
  type CapabilityActivationEvidence,
  type PublishableContentSnapshot,
  type PublishContentSnapshotPort,
  type SecretContext,
} from './index.js';

const owner = {
  workspaceId: 'workspace-a',
  userId: 'owner-a',
  role: 'owner' as const,
  correlationId: 'corr-a',
};

const admin = { ...owner, role: 'admin' as const, userId: 'admin-a' };
const worker = { ...owner, role: 'worker' as const, userId: 'worker-a' };

class TestPublishContentSnapshotPort implements PublishContentSnapshotPort {
  private readonly snapshots = new Map<string, PublishableContentSnapshot>();

  constructor(ids: string[]) {
    for (const id of ids) this.setRevision(id, `revision:${id}:1`);
  }

  setRevision(id: string, revision: string) {
    this.snapshots.set(id, {
      artifactId: `artifact:${id}`,
      contentId: `content:${id}`,
      contentVersionId: `version:${id}`,
      createdAt: '2026-07-11T00:00:00.000Z',
      id,
      platform: 'douyin',
      revision,
      source: 'product_handoff',
      title: `Snapshot ${id}`,
    });
  }

  remove(id: string) {
    this.snapshots.delete(id);
  }

  async list(_workspaceId: string) {
    return structuredClone([...this.snapshots.values()]);
  }

  async resolve(_workspaceId: string, snapshotId: string) {
    const snapshot = this.snapshots.get(snapshotId);
    return snapshot ? structuredClone(snapshot) : undefined;
  }
}

async function grantDouyinCapability(
  service: IntegrationApplicationService,
  connectionId: string,
  capability:
    | 'publish'
    | 'observe'
    | 'publish.poi'
    | 'publish.mini_program',
  evidence: CapabilityActivationEvidence
) {
  await service.handleDouyinAuthorizationEvent(owner, {
    capability,
    connectionId,
    eventId: `${connectionId}:${capability}:${evidence.revision}`,
    evidence,
    type: 'contract_authorize',
  });
  return service.activateDouyinCapability(owner, {
    capability,
    connectionId,
  });
}

describe('IntegrationApplicationService', () => {
  it('reports recorded Douyin assembly as not integrated', () => {
    const service = new IntegrationApplicationService({
      repository: new MemoryIntegrationRepository(),
      secrets: new FakeKmsSecretStore(),
      douyin: new RecordedDouyinAdapter(),
    });

    assert.deepEqual(service.getDouyinIntegrationStatus(owner), {
      provider: 'douyin',
      integrated: false,
      executionMode: 'recorded',
    });
    assert.deepEqual(service.getDouyinIntegrationStatus(admin), {
      provider: 'douyin',
      integrated: false,
      executionMode: 'recorded',
    });
  });

  it('keeps connection credentials write-only and bound to workspace AAD', async () => {
    const repository = new MemoryIntegrationRepository();
    const secrets = new FakeKmsSecretStore();
    const service = new IntegrationApplicationService({ repository, secrets });

    const created = await service.createConnection(
      owner,
      {
        id: 'douyin-a',
        provider: 'douyin',
        identityMode: 'oauth_user',
        requestedCapabilities: ['publish', 'observe'],
        grantedCapabilities: ['publish'],
        credential: {
          value: JSON.stringify({
            accessToken: 'access-secret',
            refreshToken: 'refresh-secret',
          }),
          expiresAt: '2030-01-01T00:00:00.000Z',
          scope: ['video.create.bind'],
        },
      },
      'create-douyin-a'
    );

    assert.equal(created.workspaceId, 'workspace-a');
    assert.equal(created.credential.mask, '••••••••');
    assert.equal(created.credential.version, 1);
    assert.equal('value' in created.credential, false);
    assert.equal(JSON.stringify(created).includes('access-secret'), false);

    await assert.rejects(
      service.getConnection(
        { ...owner, workspaceId: 'workspace-b', userId: 'owner-b' },
        'douyin-a'
      ),
      (error: unknown) =>
        error instanceof IntegrationError && error.code === 'NOT_FOUND'
    );

    await assert.rejects(
      secrets.use(created.secretRef, {
        workspaceId: 'workspace-b',
        credentialId: created.credential.id,
        version: created.credential.version,
        provider: 'douyin',
      }),
      (error: unknown) =>
        error instanceof IntegrationError &&
        error.code === 'SECRET_CONTEXT_MISMATCH'
    );
    await assert.rejects(
      service.listDouyinContentSnapshots(owner),
      (error: unknown) =>
        error instanceof IntegrationError &&
        error.code === 'CONTENT_SNAPSHOT_PORT_MISSING'
    );
  });

  it('makes connection creation idempotent without persisting plaintext in the key record', async () => {
    const repository = new MemoryIntegrationRepository();
    const secrets = new FakeKmsSecretStore();
    const service = new IntegrationApplicationService({ repository, secrets });
    const input = {
      id: 'idempotent-connection',
      provider: 'feishu' as const,
      identityMode: 'oauth_user' as const,
      requestedCapabilities: ['mcp.tools'],
      grantedCapabilities: ['mcp.tools'],
      credential: {
        value: 'never-store-this-token',
        scope: ['docx:document:readonly'],
      },
    };
    const first = await service.createConnection(
      owner,
      input,
      'connection-create-once'
    );
    const replay = await service.createConnection(
      owner,
      input,
      'connection-create-once'
    );
    assert.deepEqual(replay, first);
    await assert.rejects(
      service.createConnection(
        owner,
        {
          ...input,
          credential: { ...input.credential, value: 'changed-token' },
        },
        'connection-create-once'
      ),
      (error: unknown) =>
        error instanceof IntegrationError &&
        error.code === 'IDEMPOTENCY_CONFLICT'
    );
    assert.equal(
      JSON.stringify(repository).includes('never-store-this-token'),
      false
    );
  });

  it('revokes an unbound create secret after a DB failure and resumes with the same submission', async () => {
    class FailFirstCreateRepository extends MemoryIntegrationRepository {
      private failed = false;

      override async createConnectionIfAbsent(
        connection: Parameters<
          MemoryIntegrationRepository['createConnectionIfAbsent']
        >[0]
      ) {
        if (!this.failed) {
          this.failed = true;
          throw new Error('connection insert failed');
        }
        return super.createConnectionIfAbsent(connection);
      }
    }

    const repository = new FailFirstCreateRepository();
    const secrets = new FakeKmsSecretStore();
    const input = {
      id: 'recoverable-create',
      provider: 'model' as const,
      identityMode: 'byok' as const,
      requestedCapabilities: ['model.invoke'],
      grantedCapabilities: ['model.invoke'],
      credential: {
        value: 'recoverable-create-secret',
        scope: ['model.invoke'],
      },
    };
    const secretContext: SecretContext = {
      credentialId: `${input.id}:credential`,
      provider: input.provider,
      version: 1,
      workspaceId: owner.workspaceId,
    };

    await assert.rejects(
      new IntegrationApplicationService({ repository, secrets }).createConnection(
        owner,
        input,
        'recoverable-create-key'
      ),
      /connection insert failed/
    );
    assert.equal(await repository.getConnection(owner.workspaceId, input.id), undefined);
    await assert.rejects(
      secrets.use(secrets.reference(secretContext), secretContext),
      (error: unknown) =>
        error instanceof IntegrationError && error.code === 'SECRET_NOT_FOUND'
    );

    const recovered = await new IntegrationApplicationService({
      repository,
      secrets,
    }).createConnection(owner, input, 'recoverable-create-key');
    assert.equal(recovered.id, input.id);
    assert.equal(
      await secrets.use(recovered.secretRef, secretContext),
      input.credential.value
    );
    assert.equal((await repository.listConnections(owner.workspaceId)).length, 1);
  });

  it('recovers a committed connection when the create DB response is lost', async () => {
    class CommitThenThrowRepository extends MemoryIntegrationRepository {
      private failed = false;

      override async createConnectionIfAbsent(
        connection: Parameters<
          MemoryIntegrationRepository['createConnectionIfAbsent']
        >[0]
      ) {
        const result = await super.createConnectionIfAbsent(connection);
        if (result.created && !this.failed) {
          this.failed = true;
          throw new Error('connection commit response lost');
        }
        return result;
      }
    }

    const repository = new CommitThenThrowRepository();
    const secrets = new FakeKmsSecretStore();
    const input = {
      id: 'response-loss-create',
      provider: 'feishu' as const,
      identityMode: 'oauth_user' as const,
      requestedCapabilities: ['mcp.tools'],
      grantedCapabilities: ['mcp.tools'],
      credential: {
        value: 'response-loss-create-secret',
        scope: ['mcp.tools'],
      },
    };

    await assert.rejects(
      new IntegrationApplicationService({ repository, secrets }).createConnection(
        owner,
        input,
        'response-loss-create-key'
      ),
      /connection commit response lost/
    );
    await assert.rejects(
      new IntegrationApplicationService({ repository, secrets }).createConnection(
        owner,
        {
          ...input,
          credential: { ...input.credential, value: 'changed-after-loss' },
        },
        'response-loss-create-key'
      ),
      (error: unknown) =>
        error instanceof IntegrationError &&
        error.code === 'IDEMPOTENCY_CONFLICT'
    );

    const recovered = await new IntegrationApplicationService({
      repository,
      secrets,
    }).createConnection(owner, input, 'response-loss-create-key');
    assert.equal(recovered.id, input.id);
    assert.equal((await repository.listConnections(owner.workspaceId)).length, 1);
    assert.equal(
      (await repository.listAudits(owner.workspaceId)).filter(
        (event) => event.action === 'connection.created'
      ).length,
      1
    );
  });

  it('admits only one create operation for a connection identifier', async () => {
    class BlockingSecretStore extends FakeKmsSecretStore {
      private enteredResolver: () => void = () => undefined;
      private readonly entered = new Promise<void>((resolve) => {
        this.enteredResolver = resolve;
      });
      private releaseResolver: () => void = () => undefined;
      private readonly releaseBarrier = new Promise<void>((resolve) => {
        this.releaseResolver = resolve;
      });
      writes = 0;

      waitUntilEntered() {
        return this.entered;
      }

      release() {
        this.releaseResolver();
      }

      override async put(context: SecretContext, value: string) {
        this.writes += 1;
        this.enteredResolver();
        await this.releaseBarrier;
        return super.put(context, value);
      }
    }

    const repository = new MemoryIntegrationRepository();
    const secrets = new BlockingSecretStore();
    const service = new IntegrationApplicationService({ repository, secrets });
    const input = {
      id: 'single-owner-create',
      provider: 'model' as const,
      identityMode: 'byok' as const,
      requestedCapabilities: ['model.invoke'],
      grantedCapabilities: ['model.invoke'],
      credential: { value: 'winner-secret', scope: ['model.invoke'] },
    };

    const winner = service.createConnection(owner, input, 'create-owner-a');
    await secrets.waitUntilEntered();
    await assert.rejects(
      service.createConnection(
        owner,
        {
          ...input,
          credential: { ...input.credential, value: 'loser-secret' },
        },
        'create-owner-b'
      ),
      (error: unknown) =>
        error instanceof IntegrationError &&
        error.code === 'CONNECTION_CREATE_IN_PROGRESS'
    );
    secrets.release();
    await winner;
    assert.equal(secrets.writes, 1);
    assert.equal((await repository.listConnections(owner.workspaceId)).length, 1);
  });

  it('rotates and disconnects a connection without retaining usable secrets', async () => {
    const repository = new MemoryIntegrationRepository();
    const secrets = new FakeKmsSecretStore();
    const service = new IntegrationApplicationService({ repository, secrets });
    const created = await service.createConnection(
      owner,
      {
        id: 'rotating-feishu',
        provider: 'feishu',
        identityMode: 'oauth_user',
        requestedCapabilities: ['mcp.tools'],
        grantedCapabilities: ['mcp.tools'],
        credential: {
          value: 'old-uat-secret',
          scope: ['docx:document:readonly'],
        },
      },
      'create-rotating-feishu'
    );
    const rotated = await service.rotateConnectionCredential(
      owner,
      'rotating-feishu',
      { value: 'new-uat-secret', scope: ['docx:document:readonly'] },
      'rotate-feishu'
    );
    assert.equal(rotated.credential.version, 2);
    assert.deepEqual(
      await service.rotateConnectionCredential(
        owner,
        'rotating-feishu',
        { value: 'new-uat-secret', scope: ['docx:document:readonly'] },
        'rotate-feishu'
      ),
      rotated
    );
    await assert.rejects(
      secrets.use(created.secretRef, {
        workspaceId: owner.workspaceId,
        credentialId: created.credential.id,
        version: 1,
        provider: 'feishu',
      }),
      (error: unknown) =>
        error instanceof IntegrationError && error.code === 'SECRET_NOT_FOUND'
    );

    const disconnected = await service.disconnectConnection(
      owner,
      'rotating-feishu',
      'disconnect-feishu'
    );
    assert.equal(disconnected.status, 'revoked');
    assert.equal(disconnected.credential.status, 'revoked');
    assert.deepEqual(
      await service.disconnectConnection(
        owner,
        'rotating-feishu',
        'disconnect-feishu'
      ),
      disconnected
    );
    await assert.rejects(
      secrets.use(rotated.secretRef, {
        workspaceId: owner.workspaceId,
        credentialId: rotated.credential.id,
        version: 2,
        provider: 'feishu',
      }),
      (error: unknown) =>
        error instanceof IntegrationError && error.code === 'SECRET_NOT_FOUND'
    );
    const auditJson = JSON.stringify(await service.listIntegrationAudit(owner));
    assert.equal(auditJson.includes('old-uat-secret'), false);
    assert.equal(auditJson.includes('new-uat-secret'), false);
    assert.equal(auditJson.includes('kms://'), false);
  });

  it('admits only one overlapping credential rotation version', async () => {
    class ReadBarrierRepository extends MemoryIntegrationRepository {
      private release: () => void = () => undefined;
      private readonly barrier = new Promise<void>((resolve) => {
        this.release = resolve;
      });
      private reads = 0;

      override async getConnection(workspaceId: string, id: string) {
        const connection = await super.getConnection(workspaceId, id);
        if (
          id === 'concurrent-rotation' &&
          connection?.credential.version === 1 &&
          !connection.credentialTransition
        ) {
          this.reads += 1;
          if (this.reads === 2) this.release();
          await this.barrier;
        }
        return connection;
      }
    }

    class CountingSecretStore extends FakeKmsSecretStore {
      versionTwoWrites = 0;

      override async put(context: SecretContext, value: string) {
        if (context.version === 2) this.versionTwoWrites += 1;
        return super.put(context, value);
      }
    }

    const repository = new ReadBarrierRepository();
    const secrets = new CountingSecretStore();
    const service = new IntegrationApplicationService({ repository, secrets });
    await service.createConnection(
      owner,
      {
        id: 'concurrent-rotation',
        provider: 'feishu',
        identityMode: 'oauth_user',
        requestedCapabilities: ['mcp.tools'],
        grantedCapabilities: ['mcp.tools'],
        credential: { value: 'version-one', scope: ['scope:v1'] },
      },
      'create-concurrent-rotation'
    );

    const results = await Promise.allSettled([
      service.rotateConnectionCredential(
        owner,
        'concurrent-rotation',
        { value: 'candidate-a', scope: ['scope:a'] },
        'rotate-concurrent-a'
      ),
      service.rotateConnectionCredential(
        owner,
        'concurrent-rotation',
        { value: 'candidate-b', scope: ['scope:b'] },
        'rotate-concurrent-b'
      ),
    ]);

    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
    assert.equal(
      results.some(
        (result) =>
          result.status === 'rejected' &&
          result.reason instanceof IntegrationError &&
          result.reason.code === 'CREDENTIAL_VERSION_CONFLICT'
      ),
      true
    );
    const current = await service.getConnection(owner, 'concurrent-rotation');
    assert.equal(current.credential.version, 2);
    assert.equal(current.credentialTransition, undefined);
    assert.equal(secrets.versionTwoWrites, 1);
    assert.equal(
      ['candidate-a', 'candidate-b'].includes(
        await secrets.use(current.secretRef, {
          workspaceId: owner.workspaceId,
          credentialId: current.credential.id,
          version: 2,
          provider: 'feishu',
        })
      ),
      true
    );
  });

  it('cleans a partially written new secret and resumes the staged rotation', async () => {
    class PutThenThrowSecretStore extends FakeKmsSecretStore {
      private failed = false;

      override async put(context: SecretContext, value: string) {
        const ref = await super.put(context, value);
        if (context.version === 2 && !this.failed) {
          this.failed = true;
          throw new Error('secret transport failed after write');
        }
        return ref;
      }
    }

    const repository = new MemoryIntegrationRepository();
    const secrets = new PutThenThrowSecretStore();
    const service = new IntegrationApplicationService({ repository, secrets });
    const created = await service.createConnection(
      owner,
      {
        id: 'partial-secret-rotation',
        provider: 'model',
        identityMode: 'byok',
        requestedCapabilities: ['generate'],
        grantedCapabilities: ['generate'],
        credential: { value: 'old-key', scope: ['generate'] },
      },
      'create-partial-secret-rotation'
    );
    const nextContext: SecretContext = {
      workspaceId: owner.workspaceId,
      credentialId: created.credential.id,
      version: 2,
      provider: 'model',
    };

    await assert.rejects(
      service.rotateConnectionCredential(
        owner,
        created.id,
        { value: 'new-key', scope: ['generate'] },
        'partial-secret-rotation'
      ),
      /secret transport failed after write/
    );
    const staged = await service.getConnection(owner, created.id);
    assert.equal(staged.status, 'disabled');
    assert.equal(staged.credential.version, 1);
    assert.equal(staged.credentialTransition?.kind, 'rotate');
    await assert.rejects(
      secrets.use(secrets.reference(nextContext), nextContext),
      (error: unknown) =>
        error instanceof IntegrationError && error.code === 'SECRET_NOT_FOUND'
    );
    assert.equal(
      await secrets.use(created.secretRef, {
        ...nextContext,
        version: 1,
      }),
      'old-key'
    );

    const recovered = await service.rotateConnectionCredential(
      owner,
      created.id,
      { value: 'new-key', scope: ['generate'] },
      'partial-secret-rotation'
    );
    assert.equal(recovered.status, 'available');
    assert.equal(recovered.credential.version, 2);
    assert.equal(recovered.credentialTransition, undefined);
  });

  it('requires the original idempotency key to resume a staged rotation', async () => {
    class FailFirstVersionTwoPut extends FakeKmsSecretStore {
      private failed = false;

      override async put(context: SecretContext, value: string) {
        if (context.version === 2 && !this.failed) {
          this.failed = true;
          throw new Error('temporary secret-store failure');
        }
        return super.put(context, value);
      }
    }

    const repository = new MemoryIntegrationRepository();
    const secrets = new FailFirstVersionTwoPut();
    const service = new IntegrationApplicationService({ repository, secrets });
    const created = await service.createConnection(
      owner,
      {
        id: 'staged-rotation-owner',
        provider: 'model',
        identityMode: 'byok',
        requestedCapabilities: ['generate'],
        grantedCapabilities: ['generate'],
        credential: { value: 'old-key', scope: ['generate'] },
      },
      'create-staged-rotation-owner'
    );
    const credential = { value: 'new-key', scope: ['generate'] };

    await assert.rejects(
      service.rotateConnectionCredential(
        owner,
        created.id,
        credential,
        'rotation-owner-key'
      ),
      /temporary secret-store failure/
    );
    await assert.rejects(
      service.rotateConnectionCredential(
        owner,
        created.id,
        credential,
        'rotation-takeover-key'
      ),
      (error: unknown) =>
        error instanceof IntegrationError &&
        error.code === 'CREDENTIAL_TRANSITION_IN_PROGRESS'
    );

    const recovered = await service.rotateConnectionCredential(
      owner,
      created.id,
      credential,
      'rotation-owner-key'
    );
    assert.equal(recovered.credential.version, 2);
    assert.equal(recovered.credentialTransition, undefined);
    assert.equal(
      await secrets.use(recovered.secretRef, {
        credentialId: recovered.credential.id,
        provider: recovered.provider,
        version: 2,
        workspaceId: recovered.workspaceId,
      }),
      'new-key'
    );
  });

  it('fences stale connection writes across credential rotation and disconnect', async () => {
    class BlockingFeishuAdapter extends RecordedFeishuMcpAdapter {
      private enteredResolver: (() => void) | undefined;
      private releaseResolver: (() => void) | undefined;
      private enteredPromise = Promise.resolve();
      private releasePromise = Promise.resolve();

      constructor() {
        super([]);
      }

      blockNextDiscovery() {
        this.enteredPromise = new Promise<void>((resolve) => {
          this.enteredResolver = resolve;
        });
        this.releasePromise = new Promise<void>((resolve) => {
          this.releaseResolver = resolve;
        });
      }

      waitUntilEntered() {
        return this.enteredPromise;
      }

      release() {
        this.releaseResolver?.();
      }

      override async discover(
        request: Parameters<RecordedFeishuMcpAdapter['discover']>[0]
      ) {
        this.enteredResolver?.();
        await this.releasePromise;
        return super.discover(request);
      }
    }

    const repository = new MemoryIntegrationRepository();
    const secrets = new FakeKmsSecretStore();
    const feishu = new BlockingFeishuAdapter();
    const service = new IntegrationApplicationService({
      feishu,
      repository,
      secrets,
    });
    const created = await service.createConnection(
      owner,
      {
        credential: {
          scope: ['mcp.tools'],
          status: 'unverified',
          value: 'uat-v1',
        },
        grantedCapabilities: [],
        id: 'stale-connection-write',
        identityMode: 'oauth_user',
        provider: 'feishu',
        requestedCapabilities: ['mcp.tools'],
      },
      'create-stale-connection-write'
    );

    feishu.blockNextDiscovery();
    const staleVerification = service.verifyFeishuConnection(
      owner,
      created.id
    );
    await feishu.waitUntilEntered();
    const rotated = await service.rotateConnectionCredential(
      owner,
      created.id,
      { scope: ['mcp.tools'], value: 'uat-v2' },
      'rotate-stale-connection-write'
    );
    feishu.release();
    await assert.rejects(
      staleVerification,
      (error: unknown) =>
        error instanceof IntegrationError &&
        error.code === 'CONNECTION_WRITE_CONFLICT'
    );
    assert.equal(
      (await service.getConnection(owner, created.id)).credential.version,
      2
    );

    feishu.blockNextDiscovery();
    const staleAfterDisconnect = service.verifyFeishuConnection(
      owner,
      created.id
    );
    await feishu.waitUntilEntered();
    await service.disconnectConnection(
      owner,
      created.id,
      'disconnect-stale-connection-write'
    );
    feishu.release();
    await assert.rejects(
      staleAfterDisconnect,
      (error: unknown) =>
        error instanceof IntegrationError &&
        error.code === 'CONNECTION_WRITE_CONFLICT'
    );
    const disconnected = await service.getConnection(owner, created.id);
    assert.equal(disconnected.status, 'revoked');
    assert.equal(disconnected.credential.status, 'revoked');
    assert.equal(disconnected.credential.version, 2);
    await assert.rejects(
      secrets.use(rotated.secretRef, {
        credentialId: rotated.credential.id,
        provider: 'feishu',
        version: 2,
        workspaceId: owner.workspaceId,
      }),
      (error: unknown) =>
        error instanceof IntegrationError && error.code === 'SECRET_NOT_FOUND'
    );
  });

  it('reconciles a committed credential switch before revoking any secret', async () => {
    class CommitThenThrowRepository extends MemoryIntegrationRepository {
      private failed = false;

      override async compareAndSwapConnection(
        connection: Parameters<
          MemoryIntegrationRepository['compareAndSwapConnection']
        >[0],
        expected: Parameters<
          MemoryIntegrationRepository['compareAndSwapConnection']
        >[1]
      ) {
        const saved = await super.compareAndSwapConnection(connection, expected);
        if (
          saved &&
          connection.credentialTransition?.kind === 'rotate' &&
          connection.credentialTransition.phase ===
            'old_secret_revoke_pending' &&
          !this.failed
        ) {
          this.failed = true;
          throw new Error('connection CAS response lost after commit');
        }
        return saved;
      }
    }

    const repository = new CommitThenThrowRepository();
    const secrets = new FakeKmsSecretStore();
    const service = new IntegrationApplicationService({ repository, secrets });
    const created = await service.createConnection(
      owner,
      {
        id: 'uncertain-switch',
        provider: 'feishu',
        identityMode: 'oauth_user',
        requestedCapabilities: ['mcp.tools'],
        grantedCapabilities: ['mcp.tools'],
        credential: { value: 'old-uat', scope: ['docx:read'] },
      },
      'create-uncertain-switch'
    );

    const rotated = await service.rotateConnectionCredential(
      owner,
      created.id,
      { value: 'new-uat', scope: ['docx:read'] },
      'rotate-uncertain-switch'
    );
    assert.equal(rotated.credential.version, 2);
    assert.equal(
      await secrets.use(rotated.secretRef, {
        workspaceId: owner.workspaceId,
        credentialId: rotated.credential.id,
        version: 2,
        provider: 'feishu',
      }),
      'new-uat'
    );
  });

  it('persists disconnect as unavailable before retrying a failed revoke', async () => {
    class RevokeOnceSecretStore extends FakeKmsSecretStore {
      private failed = false;

      override async revoke(secretRef: string, context: SecretContext) {
        if (context.version === 1 && !this.failed) {
          this.failed = true;
          throw new Error('secret revoke temporarily unavailable');
        }
        return super.revoke(secretRef, context);
      }
    }

    const repository = new MemoryIntegrationRepository();
    const secrets = new RevokeOnceSecretStore();
    const service = new IntegrationApplicationService({ repository, secrets });
    const created = await service.createConnection(
      owner,
      {
        id: 'retry-disconnect',
        provider: 'feishu',
        identityMode: 'oauth_user',
        requestedCapabilities: ['mcp.tools'],
        grantedCapabilities: ['mcp.tools'],
        credential: { value: 'disconnect-me', scope: ['docx:read'] },
      },
      'create-retry-disconnect'
    );

    await assert.rejects(
      service.disconnectConnection(
        owner,
        created.id,
        'disconnect-first-attempt'
      ),
      /secret revoke temporarily unavailable/
    );
    const pending = await service.getConnection(owner, created.id);
    assert.equal(pending.status, 'revoked');
    assert.equal(pending.credential.status, 'revoked');
    assert.equal(pending.credentialTransition?.kind, 'disconnect');
    assert.equal(
      await secrets.use(created.secretRef, {
        workspaceId: owner.workspaceId,
        credentialId: created.credential.id,
        version: 1,
        provider: 'feishu',
      }),
      'disconnect-me'
    );

    const disconnected = await service.disconnectConnection(
      owner,
      created.id,
      'disconnect-retry'
    );
    assert.equal(disconnected.status, 'revoked');
    assert.equal(disconnected.credentialTransition, undefined);
    await assert.rejects(
      secrets.use(created.secretRef, {
        workspaceId: owner.workspaceId,
        credentialId: created.credential.id,
        version: 1,
        provider: 'feishu',
      }),
      (error: unknown) =>
        error instanceof IntegrationError && error.code === 'SECRET_NOT_FOUND'
    );
  });

  it('replays a duplicate Douyin unauthorize event until secret revoke settles', async () => {
    class RevokeOnceSecretStore extends FakeKmsSecretStore {
      private failed = false;

      override async revoke(secretRef: string, context: SecretContext) {
        if (!this.failed) {
          this.failed = true;
          throw new Error('Douyin secret revoke temporarily unavailable');
        }
        return super.revoke(secretRef, context);
      }
    }

    const repository = new MemoryIntegrationRepository();
    const secrets = new RevokeOnceSecretStore();
    const service = new IntegrationApplicationService({ repository, secrets });
    const created = await service.createConnection(
      owner,
      {
        id: 'douyin-unauthorize-replay',
        provider: 'douyin',
        identityMode: 'oauth_user',
        requestedCapabilities: ['publish'],
        grantedCapabilities: ['publish'],
        subject: 'open-id-unauthorize-replay',
        credential: {
          value: JSON.stringify({ accessToken: 'a1', refreshToken: 'r1' }),
          scope: ['video.create.bind'],
        },
      },
      'create-douyin-unauthorize-replay'
    );
    const event = {
      connectionId: created.id,
      eventId: 'douyin-unauthorize-event',
      type: 'unauthorize' as const,
    };

    await assert.rejects(
      service.handleDouyinAuthorizationEvent(owner, event),
      /Douyin secret revoke temporarily unavailable/
    );
    assert.equal(
      (await service.getConnection(owner, created.id)).credentialTransition
        ?.kind,
      'disconnect'
    );

    const replayed = await service.handleDouyinAuthorizationEvent(owner, event);
    assert.equal(replayed.status, 'revoked');
    assert.equal(replayed.credentialTransition, undefined);
    await assert.rejects(
      secrets.use(created.secretRef, {
        credentialId: created.credential.id,
        provider: 'douyin',
        version: created.credential.version,
        workspaceId: created.workspaceId,
      }),
      (error: unknown) =>
        error instanceof IntegrationError && error.code === 'SECRET_NOT_FOUND'
    );
  });

  it('freezes strict BYOK credential ownership and never falls back to a platform key', async () => {
    const repository = new MemoryIntegrationRepository();
    const secrets = new FakeKmsSecretStore();
    const byok = new RecordedByokExecutionAdapter();
    const foundationRepository = new MemoryFoundationRepository();
    foundationRepository.grantOwner(owner.workspaceId, owner.userId);
    const foundation = new P1ApplicationService(foundationRepository);
    await new ProductEntitlementApplicationService(
      foundationRepository
    ).activatePlan(
      owner,
      {
        paymentEventId: 'byok-test-plan-payment',
        policy: {
          revision: 'growth-v1',
          tier: 'growth',
          periodId: '2026-07',
          periodStartsAt: '2026-07-01T00:00:00.000Z',
          periodEndsAt: '2026-08-01T00:00:00.000Z',
          allowance: { audio: 0, copy: 5, image: 2, video: 1 },
          concurrencyLimit: 2,
          queuePriority: 20,
          supportLabel: 'standard',
        },
      },
      'activate-byok-test-plan'
    );
    const service = new IntegrationApplicationService({
      repository,
      secrets,
      byok,
      byokExecutionMode: 'recorded',
      byokLedger: new FoundationStrictByokLedger(foundation),
      endpointProfiles: [
        {
          id: 'openai-controlled',
          apiFamily: 'openai',
          endpoint: 'https://api.openai.com/v1',
          permittedModels: ['copy-quality'],
        },
      ],
    });
    assert.equal(
      (await service.getStrictByokOptions(owner)).executionMode,
      'recorded',
    );
    await service.createConnection(
      owner,
      {
        id: 'byok-a',
        provider: 'model',
        identityMode: 'byok',
        requestedCapabilities: ['model.invoke'],
        grantedCapabilities: ['model.invoke'],
        credential: {
          value: 'sk-workspace-secret',
          scope: ['model.invoke'],
          status: 'unverified',
        },
      },
      'create-byok-a'
    );

    const completed = await service.submitStrictByok(owner, {
      connectionId: 'byok-a',
      endpointProfileId: 'openai-controlled',
      catalogModelId: 'copy-quality',
      prompt: '生成门店文案',
      idempotencyKey: 'byok-submit-1',
    });
    assert.equal(completed.status, 'completed');
    assert.equal(completed.routeSnapshot.credentialMode, 'byok_strict');
    assert.equal(completed.routeSnapshot.credentialVersion, 1);
    assert.equal(completed.routeSnapshot.fallbackConsent, false);
    assert.equal(completed.usage.status, 'committed');
    assert.equal(completed.providerCost.status, 'externally_billed');
    assert.equal('secret' in completed.routeSnapshot, false);
    const replayed = await service.submitStrictByok(owner, {
      connectionId: 'byok-a',
      endpointProfileId: 'openai-controlled',
      catalogModelId: 'copy-quality',
      prompt: '生成门店文案',
      idempotencyKey: 'byok-submit-1',
    });
    assert.deepEqual(replayed, completed);
    assert.equal(byok.attempts().length, 1);

    byok.failNext('unauthorized');
    const failed = await service.submitStrictByok(owner, {
      connectionId: 'byok-a',
      endpointProfileId: 'openai-controlled',
      catalogModelId: 'copy-quality',
      prompt: '再次生成门店文案',
      idempotencyKey: 'byok-submit-2',
    });
    assert.equal(failed.status, 'failed');
    assert.equal(failed.usage.status, 'refunded');
    assert.equal(failed.providerCost.status, 'unknown');
    assert.equal(
      (await service.getConnection(owner, 'byok-a')).status,
      'permission_missing'
    );
    assert.equal(byok.attempts().length, 2);
  });

  it('binds Douyin publish confirmation and never republishes an accepted item', async () => {
    const repository = new MemoryIntegrationRepository();
    const secrets = new FakeKmsSecretStore();
    const douyin = new RecordedDouyinAdapter();
    const contentSnapshots = new TestPublishContentSnapshotPort(['content-v3']);
    const service = new IntegrationApplicationService({
      contentSnapshots,
      repository,
      secrets,
      douyin,
    });
    await service.createConnection(
      owner,
      {
        id: 'douyin-publish',
        provider: 'douyin',
        identityMode: 'oauth_user',
        requestedCapabilities: ['publish', 'observe', 'publish.poi'],
        grantedCapabilities: ['publish'],
        subject: 'open-id-a',
        credential: {
          value: JSON.stringify({
            accessToken: 'access',
            refreshToken: 'refresh',
          }),
          scope: ['video.create.bind'],
          expiresAt: '2030-01-01T00:00:00.000Z',
        },
      },
      'douyin-oauth'
    );
    await grantDouyinCapability(service, 'douyin-publish', 'publish', {
      revision: 'console-grant-2026-07-11',
      verifiedAt: '2026-07-11T00:00:00.000Z',
      scopes: ['video.create.bind'],
    });
    await grantDouyinCapability(service, 'douyin-publish', 'publish.poi', {
      qualified: false,
      revision: 'poi-console-unqualified-r1',
      verifiedAt: '2026-07-11T00:00:00.000Z',
      scopes: ['video.poi.bind'],
    });
    await assert.rejects(
      service.confirmDouyinPublish(owner, {
        accountSubject: 'open-id-a',
        anchor: { id: 'poi-100', kind: 'poi' },
        connectionId: 'douyin-publish',
        contentSnapshotId: 'content-v3',
        scheduledAt: '2026-07-12T02:00:00.000Z',
      }),
      (error: unknown) =>
        error instanceof IntegrationError &&
        error.code === 'PUBLISH_ANCHOR_UNAVAILABLE'
    );
    await service.handleDouyinAuthorizationEvent(owner, {
      capability: 'publish.poi',
      connectionId: 'douyin-publish',
      eventId: 'douyin-publish:publish.poi:qualified-r2',
      evidence: {
        qualified: true,
        revision: 'poi-console-qualified-r2',
        scopes: ['video.poi.bind'],
        verifiedAt: '2026-07-11T00:01:00.000Z',
      },
      type: 'contract_authorize',
    });
    await service.activateDouyinCapability(owner, {
      capability: 'publish.poi',
      connectionId: 'douyin-publish',
    });
    const confirmation = await service.confirmDouyinPublish(owner, {
      anchor: { id: 'poi-100', kind: 'poi' },
      connectionId: 'douyin-publish',
      contentSnapshotId: 'content-v3',
      scheduledAt: '2026-07-12T02:00:00.000Z',
      accountSubject: 'open-id-a',
    });
    assert.equal(confirmation.contentSnapshotRevision, 'revision:content-v3:1');
    assert.deepEqual(confirmation.anchor, { id: 'poi-100', kind: 'poi' });

    await assert.rejects(
      service.submitDouyinPublish(owner, {
        confirmationId: confirmation.id,
        contentSnapshotId: 'content-v4',
        scheduledAt: '2026-07-12T02:00:00.000Z',
        idempotencyKey: 'publish-changed',
      }),
      (error: unknown) =>
        error instanceof IntegrationError &&
        error.code === 'PUBLISH_CONFIRMATION_INVALID'
    );

    contentSnapshots.setRevision('content-v3', 'revision:content-v3:2');
    await assert.rejects(
      service.submitDouyinPublish(owner, {
        confirmationId: confirmation.id,
        contentSnapshotId: 'content-v3',
        scheduledAt: '2026-07-12T02:00:00.000Z',
        idempotencyKey: 'publish-revision-changed',
      }),
      (error: unknown) =>
        error instanceof IntegrationError &&
        error.code === 'PUBLISH_CONFIRMATION_INVALID'
    );
    assert.equal(douyin.publishAttempts().length, 0);
    contentSnapshots.setRevision('content-v3', 'revision:content-v3:1');

    contentSnapshots.remove('content-v3');
    await assert.rejects(
      service.submitDouyinPublish(owner, {
        confirmationId: confirmation.id,
        contentSnapshotId: 'content-v3',
        scheduledAt: '2026-07-12T02:00:00.000Z',
        idempotencyKey: 'publish-snapshot-missing',
      }),
      (error: unknown) =>
        error instanceof IntegrationError &&
        error.code === 'PUBLISH_CONFIRMATION_INVALID'
    );
    assert.equal(douyin.publishAttempts().length, 0);
    contentSnapshots.setRevision('content-v3', 'revision:content-v3:1');

    douyin.setNextPublishResult({
      acceptance: 'accepted',
      itemId: 'item-100',
      videoId: 'video-100',
      status: 'reviewing',
    });
    const submitted = await service.submitDouyinPublish(owner, {
      confirmationId: confirmation.id,
      contentSnapshotId: 'content-v3',
      scheduledAt: '2026-07-12T02:00:00.000Z',
      idempotencyKey: 'publish-content-v3',
    });
    assert.equal(submitted.status, 'reviewing');
    assert.equal(submitted.itemId, 'item-100');
    assert.equal(submitted.pollAttempts, 0);
    assert.equal(submitted.pollLimit, 12);
    assert.equal(submitted.pollingState, 'scheduled');
    assert.ok(submitted.pollDeadlineAt);
    assert.ok(submitted.nextPollAt);
    assert.equal(
      douyin.publishAttempts()[0]?.contentSnapshotRevision,
      'revision:content-v3:1'
    );
    assert.deepEqual(douyin.publishAttempts()[0]?.anchor, {
      id: 'poi-100',
      kind: 'poi',
    });

    const replayed = await service.submitDouyinPublish(owner, {
      confirmationId: confirmation.id,
      contentSnapshotId: 'content-v3',
      scheduledAt: '2026-07-12T02:00:00.000Z',
      idempotencyKey: 'publish-content-v3',
    });
    assert.deepEqual(replayed, submitted);
    assert.equal(douyin.publishAttempts().length, 1);

    const replayedWithAnotherCommandKey = await service.submitDouyinPublish(
      owner,
      {
        confirmationId: confirmation.id,
        contentSnapshotId: 'content-v3',
        scheduledAt: '2026-07-12T02:00:00.000Z',
        idempotencyKey: 'publish-content-v3-another-command-key',
      }
    );
    assert.equal(replayedWithAnotherCommandKey.id, submitted.id);
    assert.equal(douyin.publishAttempts().length, 1);

    douyin.setNextInspectResult({ status: 'reviewing' });
    const polled = await service.pollDouyinPublishStatus(
      worker,
      submitted.id,
      submitted.nextPollAt!
    );
    assert.equal(polled.status, 'reviewing');
    assert.equal(polled.pollAttempts, 1);
    assert.equal(polled.pollingState, 'scheduled');
    assert.ok(Date.parse(polled.nextPollAt!) > Date.parse(submitted.nextPollAt!));

    douyin.setNextInspectResult({ status: 'published' });
    const refreshed = await service.refreshDouyinPublishStatus(
      owner,
      submitted.id
    );
    assert.equal(refreshed.status, 'published');
    assert.equal(refreshed.itemId, 'item-100');
    assert.equal(refreshed.pollingState, 'completed');
    assert.equal(refreshed.nextPollAt, undefined);
    assert.equal(douyin.publishAttempts().length, 1);
  });

  it('invalidates Douyin publish confirmation when the bound account changes', async () => {
    const repository = new MemoryIntegrationRepository();
    const douyin = new RecordedDouyinAdapter();
    const service = new IntegrationApplicationService({
      contentSnapshots: new TestPublishContentSnapshotPort([
        'content-account-change',
      ]),
      douyin,
      repository,
      secrets: new FakeKmsSecretStore(),
    });
    await service.createConnection(
      owner,
      {
        credential: {
          scope: ['video.create.bind'],
          value: JSON.stringify({ accessToken: 'access' }),
        },
        grantedCapabilities: ['publish'],
        id: 'douyin-account-change',
        identityMode: 'oauth_user',
        provider: 'douyin',
        requestedCapabilities: ['publish'],
        subject: 'open-id-before',
      },
      'create-douyin-account-change'
    );
    await grantDouyinCapability(
      service,
      'douyin-account-change',
      'publish',
      {
        revision: 'publish-account-change-r1',
        scopes: ['video.create.bind'],
        verifiedAt: '2026-07-11T00:00:00.000Z',
      }
    );
    const confirmation = await service.confirmDouyinPublish(owner, {
      accountSubject: 'open-id-before',
      connectionId: 'douyin-account-change',
      contentSnapshotId: 'content-account-change',
      scheduledAt: '2026-07-12T02:00:00.000Z',
    });
    const connection = await service.getConnection(
      owner,
      'douyin-account-change'
    );
    connection.subject = 'open-id-after';
    await repository.saveConnection(connection);

    await assert.rejects(
      service.submitDouyinPublish(owner, {
        confirmationId: confirmation.id,
        contentSnapshotId: confirmation.contentSnapshotId,
        idempotencyKey: 'publish-after-account-change',
        scheduledAt: confirmation.scheduledAt,
      }),
      (error: unknown) =>
        error instanceof IntegrationError &&
        error.code === 'PUBLISH_CONFIRMATION_INVALID'
    );
    assert.equal(douyin.publishAttempts().length, 0);
  });

  it('claims Douyin publish before the provider effect and reconciles a crash without resubmitting', async () => {
    class CrashOnceRepository extends MemoryIntegrationRepository {
      private crash = true;

      override async settleDouyinPublishJob(
        job: Parameters<
          MemoryIntegrationRepository['settleDouyinPublishJob']
        >[0],
        expectedStatus: Parameters<
          MemoryIntegrationRepository['settleDouyinPublishJob']
        >[1]
      ) {
        if (this.crash && job.status === 'reviewing') {
          this.crash = false;
          throw new Error('simulated process crash after provider acceptance');
        }
        return super.settleDouyinPublishJob(job, expectedStatus);
      }
    }

    const repository = new CrashOnceRepository();
    const secrets = new FakeKmsSecretStore();
    const douyin = new RecordedDouyinAdapter();
    const service = new IntegrationApplicationService({
      contentSnapshots: new TestPublishContentSnapshotPort([
        'content-crash-safe-v1',
      ]),
      douyin,
      repository,
      secrets,
    });
    await service.createConnection(
      owner,
      {
        credential: {
          scope: ['video.create.bind'],
          value: JSON.stringify({
            accessToken: 'access',
            refreshToken: 'refresh',
          }),
        },
        grantedCapabilities: ['publish'],
        id: 'douyin-crash-safe',
        identityMode: 'oauth_user',
        provider: 'douyin',
        requestedCapabilities: ['publish'],
        subject: 'open-id-crash-safe',
      },
      'create-douyin-crash-safe'
    );
    await grantDouyinCapability(service, 'douyin-crash-safe', 'publish', {
      revision: 'publish-crash-safe-r1',
      scopes: ['video.create.bind'],
      verifiedAt: '2026-07-11T00:00:00.000Z',
    });
    const confirmation = await service.confirmDouyinPublish(owner, {
      accountSubject: 'open-id-crash-safe',
      connectionId: 'douyin-crash-safe',
      contentSnapshotId: 'content-crash-safe-v1',
      scheduledAt: '2026-07-12T03:00:00.000Z',
    });
    douyin.setNextPublishResult({
      acceptance: 'accepted',
      itemId: 'item-crash-safe',
      status: 'reviewing',
      videoId: 'video-crash-safe',
    });
    const command = {
      confirmationId: confirmation.id,
      contentSnapshotId: 'content-crash-safe-v1',
      idempotencyKey: 'publish-crash-safe-v1',
      scheduledAt: '2026-07-12T03:00:00.000Z',
    };

    await assert.rejects(
      service.submitDouyinPublish(owner, command),
      /simulated process crash/
    );
    const recovered = await service.submitDouyinPublish(owner, command);
    assert.equal(recovered.status, 'unknown');
    assert.equal(recovered.effectState, 'reconciliation_required');
    assert.equal(douyin.publishAttempts().length, 1);

    const reconciled = await service.handleDouyinPublishStatusEvent(owner, {
      connectionId: 'douyin-crash-safe',
      eventId: 'publish-event-crash-safe-1',
      itemId: 'item-crash-safe',
      jobId: recovered.id,
      occurredAt: '2026-07-13T03:00:00.000Z',
      status: 'published',
      videoId: 'video-crash-safe',
    });
    assert.equal(reconciled.status, 'published');
    assert.equal(reconciled.effectState, 'settled');
    assert.equal(
      (
        await service.handleDouyinPublishStatusEvent(owner, {
          connectionId: 'douyin-crash-safe',
          eventId: 'publish-event-crash-safe-1',
          itemId: 'item-crash-safe',
          jobId: recovered.id,
          occurredAt: '2026-07-13T03:00:00.000Z',
          status: 'published',
        })
      ).status,
      'published'
    );
    const snapshot = await service.getDouyinOperationsSnapshot(
      owner,
      'douyin-crash-safe'
    );
    assert.equal(snapshot.publishJobs[0]?.status, 'published');
  });

  it('does not let a submit response overwrite a callback that already published the job', async () => {
    const repository = new MemoryIntegrationRepository();
    const secrets = new FakeKmsSecretStore();
    let service!: IntegrationApplicationService;
    class CallbackBeforeResponseDouyinAdapter extends RecordedDouyinAdapter {
      override async submit(
        request: Parameters<RecordedDouyinAdapter['submit']>[0]
      ) {
        await service.handleDouyinPublishStatusEvent(owner, {
          connectionId: request.connectionId,
          eventId: 'publish-before-submit-response',
          itemId: 'item-callback-first',
          jobId: request.idempotencyKey,
          occurredAt: '2026-07-13T04:00:00.000Z',
          status: 'published',
          videoId: 'video-callback-first',
        });
        return super.submit(request);
      }
    }
    const douyin = new CallbackBeforeResponseDouyinAdapter();
    service = new IntegrationApplicationService({
      contentSnapshots: new TestPublishContentSnapshotPort([
        'content-callback-first',
      ]),
      douyin,
      repository,
      secrets,
    });
    await service.createConnection(
      owner,
      {
        credential: {
          scope: ['video.create.bind'],
          value: JSON.stringify({ accessToken: 'access' }),
        },
        grantedCapabilities: ['publish'],
        id: 'douyin-callback-first',
        identityMode: 'oauth_user',
        provider: 'douyin',
        requestedCapabilities: ['publish'],
        subject: 'open-id-callback-first',
      },
      'create-douyin-callback-first'
    );
    await grantDouyinCapability(service, 'douyin-callback-first', 'publish', {
      revision: 'publish-callback-first-r1',
      scopes: ['video.create.bind'],
      verifiedAt: '2026-07-11T00:00:00.000Z',
    });
    const confirmation = await service.confirmDouyinPublish(owner, {
      accountSubject: 'open-id-callback-first',
      connectionId: 'douyin-callback-first',
      contentSnapshotId: 'content-callback-first',
      scheduledAt: '2026-07-12T04:00:00.000Z',
    });
    douyin.setNextPublishResult({
      acceptance: 'accepted',
      itemId: 'item-callback-first',
      status: 'reviewing',
      videoId: 'video-callback-first',
    });

    const published = await service.submitDouyinPublish(owner, {
      confirmationId: confirmation.id,
      contentSnapshotId: 'content-callback-first',
      idempotencyKey: 'submit-douyin-callback-first',
      scheduledAt: '2026-07-12T04:00:00.000Z',
    });

    assert.equal(published.status, 'published');
    assert.equal(published.providerEventId, 'publish-before-submit-response');
    assert.equal(douyin.publishAttempts().length, 1);
  });

  it('keeps publish callbacks monotonic under races and recovers callback audit failure', async () => {
    class AuditCrashRepository extends MemoryIntegrationRepository {
      private crash = true;

      override async appendAudit(
        event: Parameters<MemoryIntegrationRepository['appendAudit']>[0]
      ) {
        if (
          this.crash &&
          event.action === 'douyin.publish_callback_reconciled'
        ) {
          this.crash = false;
          throw new Error('simulated callback audit crash');
        }
        return super.appendAudit(event);
      }
    }

    const repository = new AuditCrashRepository();
    const service = new IntegrationApplicationService({
      repository,
      secrets: new FakeKmsSecretStore(),
    });
    await repository.saveDouyinPublishJob({
      acceptance: 'acceptance_unknown',
      confirmationId: 'confirmation-callback-race',
      connectionId: 'douyin-callback-race',
      createdAt: '2026-07-11T00:00:00.000Z',
      effectState: 'reconciliation_required',
      id: 'job-callback-race',
      status: 'unknown',
      updatedAt: '2026-07-11T00:00:00.000Z',
      workspaceId: owner.workspaceId,
    });
    const publishedEvent = {
      connectionId: 'douyin-callback-race',
      eventId: 'callback-race-published',
      itemId: 'item-callback-race',
      jobId: 'job-callback-race',
      occurredAt: '2026-07-11T03:00:00.000Z',
      status: 'published' as const,
    };

    await assert.rejects(
      service.handleDouyinPublishStatusEvent(owner, publishedEvent),
      /simulated callback audit crash/
    );
    assert.equal(
      (await service.handleDouyinPublishStatusEvent(owner, publishedEvent))
        .status,
      'published'
    );
    await repository.saveDouyinPublishJob({
      acceptance: 'acceptance_unknown',
      confirmationId: 'confirmation-callback-order',
      connectionId: 'douyin-callback-order',
      createdAt: '2026-07-11T00:00:00.000Z',
      effectState: 'reconciliation_required',
      id: 'job-callback-order',
      status: 'unknown',
      updatedAt: '2026-07-11T00:00:00.000Z',
      workspaceId: owner.workspaceId,
    });
    const [published, olderReview] = await Promise.all([
      service.handleDouyinPublishStatusEvent(owner, {
        ...publishedEvent,
        connectionId: 'douyin-callback-order',
        eventId: 'callback-race-published-duplicate',
        jobId: 'job-callback-order',
      }),
      service.handleDouyinPublishStatusEvent(owner, {
        ...publishedEvent,
        connectionId: 'douyin-callback-order',
        eventId: 'callback-race-reviewing-older',
        jobId: 'job-callback-order',
        occurredAt: '2026-07-11T02:00:00.000Z',
        status: 'reviewing',
      }),
    ]);
    assert.equal(published.status, 'published');
    assert.equal(olderReview.status, 'published');
    assert.equal(
      (
        await repository.getDouyinPublishJob(
          owner.workspaceId,
          'job-callback-order'
        )
      )?.status,
      'published'
    );
    assert.equal(
      (await repository.listAudits(owner.workspaceId)).filter(
        (event) =>
          event.action === 'douyin.publish_callback_reconciled' &&
          event.details.eventId === 'callback-race-published'
      ).length,
      1
    );
  });

  it('rotates Douyin OAuth tokens and scopes revocation to the affected grant', async () => {
    const repository = new MemoryIntegrationRepository();
    const secrets = new FakeKmsSecretStore();
    const douyin = new RecordedDouyinAdapter();
    const service = new IntegrationApplicationService({
      repository,
      secrets,
      douyin,
    });
    await service.createConnection(
      owner,
      {
        id: 'douyin-oauth-lifecycle',
        provider: 'douyin',
        identityMode: 'oauth_user',
        requestedCapabilities: ['publish', 'observe'],
        grantedCapabilities: ['publish', 'observe'],
        subject: 'open-id-oauth',
        credential: {
          value: JSON.stringify({
            accessToken: 'access-v1',
            refreshToken: 'refresh-v1',
          }),
          scope: ['video.create.bind', 'observe-current-scope'],
          expiresAt: '2026-07-20T00:00:00.000Z',
          refreshExpiresAt: '2026-07-14T00:00:00.000Z',
        },
      },
      'oauth-lifecycle-create'
    );
    await grantDouyinCapability(service, 'douyin-oauth-lifecycle', 'publish', {
      revision: 'publish-grant-r1',
      verifiedAt: '2026-07-11T00:00:00.000Z',
      scopes: ['video.create.bind'],
    });
    await grantDouyinCapability(service, 'douyin-oauth-lifecycle', 'observe', {
      revision: 'observe-grant-r1',
      verifiedAt: '2026-07-11T00:00:00.000Z',
      scopes: ['observe-current-scope'],
      endpoint: 'recorded://observe/current',
    });
    assert.equal(
      (
        await service.getDouyinConnectionProjection(
          owner,
          'douyin-oauth-lifecycle',
          '2026-07-11T12:00:00.000Z'
        )
      ).refreshReauthorizationReminder,
      true
    );

    douyin.setNextRefreshResult({
      status: 'ok',
      accessToken: 'access-v2',
      refreshToken: 'refresh-v2',
      scopes: ['video.create.bind', 'observe-current-scope'],
      accessExpiresAt: '2030-01-01T00:00:00.000Z',
      refreshExpiresAt: '2026-08-10T00:00:00.000Z',
    });
    const refreshed = await service.refreshDouyinOAuth(
      owner,
      'douyin-oauth-lifecycle',
      'refresh-oauth-v2'
    );
    assert.equal(refreshed.credential.version, 2);
    assert.equal(
      refreshed.credential.refreshExpiresAt,
      '2026-08-10T00:00:00.000Z'
    );

    await service.handleDouyinAuthorizationEvent(owner, {
      connectionId: 'douyin-oauth-lifecycle',
      eventId: 'contract-revoke-1',
      type: 'contract_unauthorize',
      capability: 'publish',
    });
    const partiallyRevoked = await service.getConnection(
      owner,
      'douyin-oauth-lifecycle'
    );
    assert.equal(partiallyRevoked.capabilityEvidence.publish, undefined);
    assert.equal(
      partiallyRevoked.capabilityEvidence.observe?.revision,
      'observe-grant-r1'
    );

    await service.handleDouyinAuthorizationEvent(owner, {
      connectionId: 'douyin-oauth-lifecycle',
      eventId: 'account-revoke-1',
      type: 'unauthorize',
    });
    assert.equal(
      (await service.getConnection(owner, 'douyin-oauth-lifecycle')).status,
      'revoked'
    );
  });

  it('replays one OAuth provider effect after response loss and service restart', async () => {
    class LoseFirstProviderResponse extends RecordedDouyinAdapter {
      private lost = false;

      override async refreshOAuth(
        request: Parameters<RecordedDouyinAdapter['refreshOAuth']>[0]
      ) {
        const result = await super.refreshOAuth(request);
        if (!this.lost) {
          this.lost = true;
          throw new Error('provider response lost after refresh effect');
        }
        return result;
      }
    }

    const repository = new MemoryIntegrationRepository();
    const secrets = new FakeKmsSecretStore();
    const douyin = new LoseFirstProviderResponse();
    douyin.setNextRefreshResult({
      accessExpiresAt: '2026-08-01T00:00:00.000Z',
      accessToken: 'access-v2-response-loss',
      refreshExpiresAt: '2026-09-01T00:00:00.000Z',
      refreshToken: 'refresh-v2-response-loss',
      scopes: ['video.create.bind'],
      status: 'ok',
    });
    const createService = () =>
      new IntegrationApplicationService({ douyin, repository, secrets });
    await createService().createConnection(
      owner,
      {
        credential: {
          scope: ['video.create.bind'],
          value: JSON.stringify({
            accessToken: 'access-v1-response-loss',
            refreshToken: 'refresh-v1-response-loss',
          }),
        },
        grantedCapabilities: [],
        id: 'oauth-provider-response-loss',
        identityMode: 'oauth_user',
        provider: 'douyin',
        requestedCapabilities: ['publish'],
        subject: 'open-id-response-loss',
      },
      'create-oauth-provider-response-loss'
    );

    await assert.rejects(
      createService().refreshDouyinOAuth(
        owner,
        'oauth-provider-response-loss',
        'refresh-response-loss'
      ),
      /provider response lost after refresh effect/
    );
    const recovered = await createService().refreshDouyinOAuth(
      owner,
      'oauth-provider-response-loss',
      'refresh-response-loss'
    );
    assert.equal(recovered.credential.version, 2);
    assert.equal(douyin.refreshEffectCount(), 1);
  });

  it('serializes distinct OAuth refresh commands for one connection', async () => {
    class BlockingRefreshAdapter extends RecordedDouyinAdapter {
      private enteredResolver: (() => void) | undefined;
      private releaseResolver: (() => void) | undefined;
      readonly entered = new Promise<void>((resolve) => {
        this.enteredResolver = resolve;
      });
      private readonly released = new Promise<void>((resolve) => {
        this.releaseResolver = resolve;
      });

      release() {
        this.releaseResolver?.();
      }

      override async refreshOAuth(
        request: Parameters<RecordedDouyinAdapter['refreshOAuth']>[0]
      ) {
        this.enteredResolver?.();
        await this.released;
        return super.refreshOAuth(request);
      }
    }

    const repository = new MemoryIntegrationRepository();
    const secrets = new FakeKmsSecretStore();
    const douyin = new BlockingRefreshAdapter();
    douyin.setNextRefreshResult({
      accessExpiresAt: '2026-08-01T00:00:00.000Z',
      accessToken: 'access-v2-concurrent-refresh',
      refreshExpiresAt: '2026-09-01T00:00:00.000Z',
      refreshToken: 'refresh-v2-concurrent-refresh',
      scopes: ['video.create.bind'],
      status: 'ok',
    });
    const service = new IntegrationApplicationService({
      douyin,
      repository,
      secrets,
    });
    await service.createConnection(
      owner,
      {
        credential: {
          scope: ['video.create.bind'],
          value: JSON.stringify({
            accessToken: 'access-v1-concurrent-refresh',
            refreshToken: 'refresh-v1-concurrent-refresh',
          }),
        },
        grantedCapabilities: [],
        id: 'oauth-concurrent-refresh',
        identityMode: 'oauth_user',
        provider: 'douyin',
        requestedCapabilities: ['publish'],
        subject: 'open-id-concurrent-refresh',
      },
      'create-oauth-concurrent-refresh'
    );

    const first = service.refreshDouyinOAuth(
      owner,
      'oauth-concurrent-refresh',
      'oauth-concurrent-refresh-a'
    );
    await douyin.entered;
    await assert.rejects(
      service.refreshDouyinOAuth(
        owner,
        'oauth-concurrent-refresh',
        'oauth-concurrent-refresh-b'
      ),
      (error: unknown) =>
        error instanceof IntegrationError &&
        error.code === 'OAUTH_REFRESH_IN_PROGRESS'
    );
    douyin.release();
    assert.equal((await first).credential.version, 2);
    assert.equal(douyin.refreshEffectCount(), 1);
  });

  it('does not resurrect a connection disconnected during OAuth refresh', async () => {
    class BlockingRefreshAdapter extends RecordedDouyinAdapter {
      private enteredResolver: (() => void) | undefined;
      private releaseResolver: (() => void) | undefined;
      readonly entered = new Promise<void>((resolve) => {
        this.enteredResolver = resolve;
      });
      private readonly released = new Promise<void>((resolve) => {
        this.releaseResolver = resolve;
      });

      release() {
        this.releaseResolver?.();
      }

      override async refreshOAuth(
        request: Parameters<RecordedDouyinAdapter['refreshOAuth']>[0]
      ) {
        this.enteredResolver?.();
        await this.released;
        return super.refreshOAuth(request);
      }
    }

    const repository = new MemoryIntegrationRepository();
    const secrets = new FakeKmsSecretStore();
    const douyin = new BlockingRefreshAdapter();
    douyin.setNextRefreshResult({
      accessExpiresAt: '2026-08-01T00:00:00.000Z',
      accessToken: 'access-v2-disconnect-race',
      refreshExpiresAt: '2026-09-01T00:00:00.000Z',
      refreshToken: 'refresh-v2-disconnect-race',
      scopes: ['video.create.bind'],
      status: 'ok',
    });
    const service = new IntegrationApplicationService({
      douyin,
      repository,
      secrets,
    });
    const created = await service.createConnection(
      owner,
      {
        credential: {
          scope: ['video.create.bind'],
          value: JSON.stringify({
            accessToken: 'access-v1-disconnect-race',
            refreshToken: 'refresh-v1-disconnect-race',
          }),
        },
        grantedCapabilities: [],
        id: 'oauth-disconnect-race',
        identityMode: 'oauth_user',
        provider: 'douyin',
        requestedCapabilities: ['publish'],
        subject: 'open-id-disconnect-race',
      },
      'create-oauth-disconnect-race'
    );

    const refresh = service.refreshDouyinOAuth(
      owner,
      created.id,
      'oauth-disconnect-race-refresh'
    );
    await douyin.entered;
    await service.disconnectConnection(
      owner,
      created.id,
      'oauth-disconnect-race-disconnect'
    );
    douyin.release();
    const refreshResult = await refresh;
    assert.equal(refreshResult.status, 'revoked');
    const disconnected = await service.getConnection(owner, created.id);
    assert.equal(disconnected.status, 'revoked');
    assert.equal(disconnected.credential.version, 1);
    assert.equal(douyin.refreshEffectCount(), 1);
    await assert.rejects(
      secrets.use(secrets.reference({
        credentialId: created.credential.id,
        provider: 'douyin',
        version: 2,
        workspaceId: owner.workspaceId,
      }), {
        credentialId: created.credential.id,
        provider: 'douyin',
        version: 2,
        workspaceId: owner.workspaceId,
      }),
      (error: unknown) =>
        error instanceof IntegrationError && error.code === 'SECRET_NOT_FOUND'
    );
  });

  it('runs due OAuth lifecycle with a stable worker key and exposes refresh expiry reminder', async () => {
    class RevokeOldSecretOnce extends FakeKmsSecretStore {
      private failed = false;

      override async revoke(secretRef: string, context: SecretContext) {
        if (context.version === 1 && !this.failed) {
          this.failed = true;
          throw new Error('lifecycle old secret revoke failed');
        }
        return super.revoke(secretRef, context);
      }
    }

    const repository = new MemoryIntegrationRepository();
    const secrets = new RevokeOldSecretOnce();
    const douyin = new RecordedDouyinAdapter();
    douyin.setNextRefreshResult({
      accessExpiresAt: '2026-08-01T00:00:00.000Z',
      accessToken: 'access-v2-lifecycle',
      refreshExpiresAt: '2026-09-01T00:00:00.000Z',
      refreshToken: 'refresh-v2-lifecycle',
      scopes: ['video.create.bind'],
      status: 'ok',
    });
    const createService = () =>
      new IntegrationApplicationService({ douyin, repository, secrets });
    await createService().createConnection(
      owner,
      {
        credential: {
          expiresAt: '2026-07-11T12:04:00.000Z',
          refreshExpiresAt: '2026-07-13T12:00:00.000Z',
          scope: ['video.create.bind'],
          value: JSON.stringify({
            accessToken: 'access-v1-lifecycle',
            refreshToken: 'refresh-v1-lifecycle',
          }),
        },
        grantedCapabilities: [],
        id: 'oauth-worker-lifecycle',
        identityMode: 'oauth_user',
        provider: 'douyin',
        requestedCapabilities: ['publish'],
        subject: 'open-id-lifecycle',
      },
      'create-oauth-worker-lifecycle'
    );
    const listed = await createService().listConnections(owner);
    assert.equal(
      (
        listed.find((connection) => connection.id === 'oauth-worker-lifecycle') as
          | { refreshReauthorizationReminder?: boolean }
          | undefined
      )?.refreshReauthorizationReminder,
      true
    );
    const lifecycleContext = {
      ...worker,
      correlationId: 'oauth-worker-lifecycle-run',
    };

    await assert.rejects(
      createService().runDouyinOAuthLifecycle(
        lifecycleContext,
        'oauth-worker-lifecycle',
        '2026-07-11T12:05:00.000Z'
      ),
      /lifecycle old secret revoke failed/
    );
    const recovered = await createService().runDouyinOAuthLifecycle(
      lifecycleContext,
      'oauth-worker-lifecycle',
      '2026-07-11T12:05:00.000Z'
    );
    assert.equal(recovered.status, 'refreshed');
    assert.equal(recovered.credentialVersion, 2);
    assert.equal(douyin.refreshEffectCount(), 1);

    const notDue = await createService().runDouyinOAuthLifecycle(
      lifecycleContext,
      'oauth-worker-lifecycle',
      '2026-07-11T12:05:00.000Z'
    );
    assert.equal(notDue.status, 'not_due');
    assert.equal(notDue.credentialVersion, 2);
    assert.equal(douyin.refreshEffectCount(), 1);
  });

  it('resumes OAuth rotation after old-secret revoke fails without another provider effect', async () => {
    class RevokeOldSecretOnce extends FakeKmsSecretStore {
      private failed = false;

      override async revoke(secretRef: string, context: SecretContext) {
        if (context.version === 1 && !this.failed) {
          this.failed = true;
          throw new Error('old OAuth secret revoke failed');
        }
        return super.revoke(secretRef, context);
      }
    }

    const repository = new MemoryIntegrationRepository();
    const secrets = new RevokeOldSecretOnce();
    const douyin = new RecordedDouyinAdapter();
    douyin.setNextRefreshResult({
      accessExpiresAt: '2026-08-01T00:00:00.000Z',
      accessToken: 'access-v2-revoke-retry',
      refreshExpiresAt: '2026-09-01T00:00:00.000Z',
      refreshToken: 'refresh-v2-revoke-retry',
      scopes: ['video.create.bind'],
      status: 'ok',
    });
    const createService = () =>
      new IntegrationApplicationService({ douyin, repository, secrets });
    const created = await createService().createConnection(
      owner,
      {
        credential: {
          scope: ['video.create.bind'],
          value: JSON.stringify({
            accessToken: 'access-v1-revoke-retry',
            refreshToken: 'refresh-v1-revoke-retry',
          }),
        },
        grantedCapabilities: [],
        id: 'oauth-old-revoke-retry',
        identityMode: 'oauth_user',
        provider: 'douyin',
        requestedCapabilities: ['publish'],
        subject: 'open-id-revoke-retry',
      },
      'create-oauth-old-revoke-retry'
    );

    await assert.rejects(
      createService().refreshDouyinOAuth(
        owner,
        created.id,
        'refresh-old-revoke-retry'
      ),
      /old OAuth secret revoke failed/
    );
    const pending = await createService().getConnection(owner, created.id);
    assert.equal(pending.credential.version, 2);
    assert.equal(pending.credentialTransition?.kind, 'rotate');

    const recovered = await createService().refreshDouyinOAuth(
      owner,
      created.id,
      'refresh-old-revoke-retry'
    );
    assert.equal(recovered.credential.version, 2);
    assert.equal(recovered.credentialTransition, undefined);
    assert.equal(douyin.refreshEffectCount(), 1);
    await assert.rejects(
      secrets.use(created.secretRef, {
        credentialId: created.credential.id,
        provider: 'douyin',
        version: 1,
        workspaceId: owner.workspaceId,
      }),
      (error: unknown) =>
        error instanceof IntegrationError && error.code === 'SECRET_NOT_FOUND'
    );
  });

  it('replays a completed OAuth refresh when the durable completion response is lost', async () => {
    class CommitOAuthCompletionThenThrow extends MemoryIntegrationRepository {
      private lost = false;

      override async advanceDouyinOAuthRefresh(
        operation: Parameters<
          MemoryIntegrationRepository['advanceDouyinOAuthRefresh']
        >[0]
      ) {
        const saved = await super.advanceDouyinOAuthRefresh(operation);
        if (operation.phase === 'completed' && !this.lost) {
          this.lost = true;
          throw new Error('OAuth completion response lost after commit');
        }
        return saved;
      }
    }

    const repository = new CommitOAuthCompletionThenThrow();
    const secrets = new FakeKmsSecretStore();
    const douyin = new RecordedDouyinAdapter();
    douyin.setNextRefreshResult({
      accessExpiresAt: '2026-08-01T00:00:00.000Z',
      accessToken: 'access-v2-completion-loss',
      refreshExpiresAt: '2026-09-01T00:00:00.000Z',
      refreshToken: 'refresh-v2-completion-loss',
      scopes: ['video.create.bind'],
      status: 'ok',
    });
    const createService = () =>
      new IntegrationApplicationService({ douyin, repository, secrets });
    await createService().createConnection(
      owner,
      {
        credential: {
          scope: ['video.create.bind'],
          value: JSON.stringify({
            accessToken: 'access-v1-completion-loss',
            refreshToken: 'refresh-v1-completion-loss',
          }),
        },
        grantedCapabilities: [],
        id: 'oauth-completion-response-loss',
        identityMode: 'oauth_user',
        provider: 'douyin',
        requestedCapabilities: ['publish'],
        subject: 'open-id-completion-loss',
      },
      'create-oauth-completion-response-loss'
    );

    await assert.rejects(
      createService().refreshDouyinOAuth(
        owner,
        'oauth-completion-response-loss',
        'refresh-completion-response-loss'
      ),
      /OAuth completion response lost after commit/
    );
    const replayed = await createService().refreshDouyinOAuth(
      owner,
      'oauth-completion-response-loss',
      'refresh-completion-response-loss'
    );
    assert.equal(replayed.credential.version, 2);
    assert.equal(douyin.refreshEffectCount(), 1);
  });

  it('validates Douyin authorization events before atomically claiming them', async () => {
    const service = new IntegrationApplicationService({
      repository: new MemoryIntegrationRepository(),
      secrets: new FakeKmsSecretStore(),
    });
    await service.createConnection(
      owner,
      {
        credential: { scope: ['video.create.bind'], value: 'recorded-oauth' },
        grantedCapabilities: [],
        id: 'douyin-authorization-events',
        identityMode: 'oauth_user',
        provider: 'douyin',
        requestedCapabilities: ['publish'],
        subject: 'open-id-events',
      },
      'douyin-authorization-events-create'
    );

    await assert.rejects(
      service.handleDouyinAuthorizationEvent(owner, {
        connectionId: 'douyin-authorization-events',
        eventId: 'event-missing-capability',
        type: 'contract_authorize',
      }),
      (error: unknown) =>
        error instanceof IntegrationError &&
        error.code === 'CAPABILITY_EVENT_INVALID'
    );
    await assert.rejects(
      service.handleDouyinAuthorizationEvent(owner, {
        connectionId: 'douyin-authorization-events',
        eventId: '   ',
        type: 'authorize',
      }),
      (error: unknown) =>
        error instanceof IntegrationError &&
        error.code === 'EXTERNAL_EVENT_INVALID'
    );
    await service.handleDouyinAuthorizationEvent(owner, {
      capability: 'publish',
      connectionId: 'douyin-authorization-events',
      eventId: 'event-missing-capability',
      evidence: {
        revision: 'publish-event-r1',
        scopes: ['video.create.bind'],
        verifiedAt: '2026-07-11T00:00:00.000Z',
      },
      type: 'contract_authorize',
    });

    await assert.rejects(
      service.handleDouyinAuthorizationEvent(owner, {
        capability: 'publish',
        connectionId: 'douyin-authorization-events',
        eventId: 'event-missing-evidence',
        type: 'contract_authorize',
      }),
      (error: unknown) =>
        error instanceof IntegrationError &&
        error.code === 'CAPABILITY_EVIDENCE_MISSING'
    );
    await service.handleDouyinAuthorizationEvent(owner, {
      capability: 'publish',
      connectionId: 'douyin-authorization-events',
      eventId: 'event-missing-evidence',
      evidence: {
        revision: 'publish-event-r2',
        scopes: ['video.create.bind'],
        verifiedAt: '2026-07-11T00:01:00.000Z',
      },
      type: 'contract_authorize',
    });

    await assert.rejects(
      service.handleDouyinAuthorizationEvent(owner, {
        capability: 'observe',
        connectionId: 'douyin-authorization-events',
        eventId: 'event-unrequested-capability',
        evidence: {
          endpoint: 'recorded://douyin/observe',
          revision: 'observe-event-r1',
          scopes: ['observe.current'],
          verifiedAt: '2026-07-11T00:02:00.000Z',
        },
        type: 'contract_authorize',
      }),
      (error: unknown) =>
        error instanceof IntegrationError &&
        error.code === 'CAPABILITY_NOT_REQUESTED'
    );
    await service.handleDouyinAuthorizationEvent(owner, {
      capability: 'publish',
      connectionId: 'douyin-authorization-events',
      eventId: 'event-unrequested-capability',
      evidence: {
        revision: 'publish-event-r3',
        scopes: ['video.create.bind'],
        verifiedAt: '2026-07-11T00:03:00.000Z',
      },
      type: 'contract_authorize',
    });

    await assert.rejects(
      service.handleDouyinAuthorizationEvent(owner, {
        connectionId: 'douyin-authorization-events',
        eventId: 'event-invalid-type',
        type: 'unexpected_event' as never,
      }),
      (error: unknown) =>
        error instanceof IntegrationError &&
        error.code === 'EXTERNAL_EVENT_INVALID'
    );
    await service.handleDouyinAuthorizationEvent(owner, {
      capability: 'publish',
      connectionId: 'douyin-authorization-events',
      eventId: 'event-invalid-type',
      evidence: {
        revision: 'publish-event-r3',
        scopes: ['video.create.bind'],
        verifiedAt: '2026-07-11T00:03:00.000Z',
      },
      type: 'contract_authorize',
    });

    const concurrentEvent = {
      capability: 'publish' as const,
      connectionId: 'douyin-authorization-events',
      eventId: 'event-concurrent-publish',
      evidence: {
        revision: 'publish-event-r4',
        scopes: ['video.create.bind'],
        verifiedAt: '2026-07-11T00:04:00.000Z',
      },
      type: 'contract_authorize' as const,
    };
    await Promise.all(
      Array.from({ length: 8 }, () =>
        service.handleDouyinAuthorizationEvent(owner, concurrentEvent)
      )
    );
    await service.handleDouyinAuthorizationEvent(owner, concurrentEvent);

    const connection = await service.getConnection(
      owner,
      'douyin-authorization-events'
    );
    assert.deepEqual(connection.grantedCapabilities, ['publish']);
    assert.equal(
      connection.capabilityEvidence.publish?.revision,
      'publish-event-r4'
    );
  });

  it('deactivates one Douyin capability without revoking the other grant', async () => {
    const repository = new MemoryIntegrationRepository();
    const service = new IntegrationApplicationService({
      repository,
      secrets: new FakeKmsSecretStore(),
    });
    await service.createConnection(
      owner,
      {
        credential: { scope: ['publish', 'observe'], value: 'recorded-oauth' },
        grantedCapabilities: ['publish', 'observe'],
        id: 'douyin-independent-capabilities',
        identityMode: 'oauth_user',
        provider: 'douyin',
        requestedCapabilities: ['publish', 'observe'],
        subject: 'open-id-independent',
      },
      'douyin-independent-create'
    );
    for (const capability of ['publish', 'observe'] as const) {
      await grantDouyinCapability(
        service,
        'douyin-independent-capabilities',
        capability,
        {
          revision: `${capability}-r1`,
          scopes: [capability],
          verifiedAt: '2026-07-11T00:00:00.000Z',
        }
      );
    }

    const connection = await service.deactivateDouyinCapability(owner, {
      capability: 'publish',
      connectionId: 'douyin-independent-capabilities',
    });

    assert.equal(connection.capabilityEvidence.publish?.revision, 'publish-r1');
    assert.equal(connection.capabilityEvidence.observe?.revision, 'observe-r1');
    assert.deepEqual(connection.grantedCapabilities, ['publish', 'observe']);
    assert.equal(connection.degradedCapabilities.publish, 'disabled_by_owner');
  });

  it('blocks deactivated Douyin capabilities before calling Publish or Observe', async () => {
    const repository = new MemoryIntegrationRepository();
    const douyin = new RecordedDouyinAdapter();
    const service = new IntegrationApplicationService({
      contentSnapshots: new TestPublishContentSnapshotPort([
        'content-disabled-v1',
      ]),
      repository,
      secrets: new FakeKmsSecretStore(),
      douyin,
    });
    await service.createConnection(
      owner,
      {
        credential: {
          scope: ['video.create.bind', 'observe.current'],
          value: JSON.stringify({
            accessToken: 'access',
            refreshToken: 'refresh',
          }),
        },
        grantedCapabilities: [],
        id: 'douyin-disabled-capabilities',
        identityMode: 'oauth_user',
        provider: 'douyin',
        requestedCapabilities: ['publish', 'observe'],
        subject: 'open-id-disabled',
      },
      'douyin-disabled-create'
    );
    await grantDouyinCapability(
      service,
      'douyin-disabled-capabilities',
      'publish',
      {
        revision: 'publish-disabled-r1',
        scopes: ['video.create.bind'],
        verifiedAt: '2026-07-11T00:00:00.000Z',
      }
    );
    await grantDouyinCapability(
      service,
      'douyin-disabled-capabilities',
      'observe',
      {
        endpoint: 'recorded://douyin/observe',
        revision: 'observe-disabled-r1',
        scopes: ['observe.current'],
        verifiedAt: '2026-07-11T00:00:00.000Z',
      }
    );
    const confirmation = await service.confirmDouyinPublish(owner, {
      accountSubject: 'open-id-disabled',
      connectionId: 'douyin-disabled-capabilities',
      contentSnapshotId: 'content-disabled-v1',
      scheduledAt: '2026-07-12T02:00:00.000Z',
    });

    await service.deactivateDouyinCapability(owner, {
      capability: 'publish',
      connectionId: 'douyin-disabled-capabilities',
    });
    const publish = await service.submitDouyinPublish(owner, {
      confirmationId: confirmation.id,
      contentSnapshotId: 'content-disabled-v1',
      scheduledAt: '2026-07-12T02:00:00.000Z',
      idempotencyKey: 'publish-disabled-v1',
    });
    assert.equal(publish.status, 'manual_required');
    assert.equal(publish.fallback?.reason, 'publish_disabled_by_owner');
    assert.equal(douyin.publishAttempts().length, 0);

    await service.deactivateDouyinCapability(owner, {
      capability: 'observe',
      connectionId: 'douyin-disabled-capabilities',
    });
    await assert.rejects(
      service.syncDouyinObserve(owner, 'douyin-disabled-capabilities'),
      (error: unknown) =>
        error instanceof IntegrationError &&
        error.code === 'OBSERVE_CAPABILITY_UNAVAILABLE'
    );
    const connection = await service.getConnection(
      owner,
      'douyin-disabled-capabilities'
    );
    assert.equal(connection.degradedCapabilities.publish, 'disabled_by_owner');
    assert.equal(connection.degradedCapabilities.observe, 'disabled_by_owner');
  });

  it('keeps Douyin Observe revisioned, monotonic and isolated from Publish health', async () => {
    const repository = new MemoryIntegrationRepository();
    const secrets = new FakeKmsSecretStore();
    const douyin = new RecordedDouyinAdapter();
    const service = new IntegrationApplicationService({
      repository,
      secrets,
      douyin,
    });
    await service.createConnection(
      owner,
      {
        id: 'douyin-observe',
        provider: 'douyin',
        identityMode: 'oauth_user',
        requestedCapabilities: ['publish', 'observe'],
        grantedCapabilities: ['publish', 'observe'],
        subject: 'open-id-observe',
        credential: {
          value: JSON.stringify({
            accessToken: 'access',
            refreshToken: 'refresh',
          }),
          scope: ['publish-scope-from-console', 'observe-scope-from-console'],
        },
      },
      'douyin-observe-oauth'
    );
    await grantDouyinCapability(service, 'douyin-observe', 'publish', {
      revision: 'publish-console-r1',
      verifiedAt: '2026-07-11T00:00:00.000Z',
      scopes: ['video.create.bind'],
    });
    await grantDouyinCapability(service, 'douyin-observe', 'observe', {
      revision: 'observe-console-r7',
      verifiedAt: '2026-07-11T00:00:00.000Z',
      scopes: ['observe-scope-from-console'],
      endpoint: 'recorded://douyin/observe/r7',
      fields: ['item_id', 'view_count', 'comment_count'],
      frequency: 'recorded-daily',
    });

    douyin.setNextObserveResult({
      status: 'ok',
      observedAt: '2026-07-11T08:00:00.000Z',
      items: [
        {
          externalId: 'external-2',
          platformTime: '2026-07-10T05:00:00.000Z',
          fields: { view_count: 21 },
          missingReasons: { comment_count: 'not_returned_by_grant' },
        },
      ],
    });
    const newest = await service.syncDouyinObserve(
      owner,
      'douyin-observe',
      '2026-07-11T08:00:00.000Z'
    );
    assert.equal(newest[0]?.source, 'external');
    assert.equal(newest[0]?.evidenceRevision, 'observe-console-r7');
    assert.equal(
      newest[0]?.missingReasons.comment_count,
      'not_returned_by_grant'
    );

    douyin.setNextObserveResult({
      status: 'ok',
      observedAt: '2026-07-11T07:00:00.000Z',
      items: [
        {
          externalId: 'external-2',
          platformTime: '2026-07-10T05:00:00.000Z',
          fields: { view_count: 1 },
          missingReasons: {},
        },
      ],
    });
    const afterOlderResult = await service.syncDouyinObserve(
      owner,
      'douyin-observe',
      '2026-07-12T08:01:00.000Z'
    );
    assert.equal(afterOlderResult[0]?.fields.view_count, 21);

    douyin.setNextObserveResult({
      status: 'rate_limited',
      retryAfterSeconds: 60,
    });
    await service.syncDouyinObserve(
      owner,
      'douyin-observe',
      '2026-07-13T08:02:00.000Z'
    );
    const degraded = await service.getConnection(owner, 'douyin-observe');
    assert.equal(degraded.degradedCapabilities.observe, 'rate_limited');
    assert.equal(
      degraded.capabilityEvidence.publish?.revision,
      'publish-console-r1'
    );
    assert.equal(degraded.degradedCapabilities.publish, undefined);
  });

  it('persists explicit Observe empty/unavailable state and throttles by evidence frequency', async () => {
    const repository = new MemoryIntegrationRepository();
    const secrets = new FakeKmsSecretStore();
    const douyin = new RecordedDouyinAdapter();
    const service = new IntegrationApplicationService({
      repository,
      secrets,
      douyin,
    });
    await service.createConnection(
      owner,
      {
        credential: {
          scope: ['observe.current'],
          value: JSON.stringify({ accessToken: 'access', refreshToken: 'refresh' }),
        },
        grantedCapabilities: [],
        id: 'douyin-observe-state',
        identityMode: 'oauth_user',
        provider: 'douyin',
        requestedCapabilities: ['observe'],
        subject: 'open-id-observe-state',
      },
      'douyin-observe-state-create'
    );
    await grantDouyinCapability(service, 'douyin-observe-state', 'observe', {
      endpoint: 'recorded://douyin/observe/state',
      frequency: 'PT1H',
      revision: 'observe-state-r1',
      scopes: ['observe.current'],
      verifiedAt: '2026-07-11T00:00:00.000Z',
    });

    douyin.setNextObserveResult({
      items: [],
      observedAt: '2026-07-11T08:00:00.000Z',
      status: 'ok',
    });
    await service.syncDouyinObserve(
      owner,
      'douyin-observe-state',
      '2026-07-11T08:00:00.000Z'
    );
    let snapshot = await service.getDouyinOperationsSnapshot(
      owner,
      'douyin-observe-state'
    );
    assert.deepEqual(snapshot.observeState, {
      connectionId: 'douyin-observe-state',
      evidenceRevision: 'observe-state-r1',
      lastAttemptAt: '2026-07-11T08:00:00.000Z',
      lastSuccessfulAt: '2026-07-11T08:00:00.000Z',
      nextSyncAt: '2026-07-11T09:00:00.000Z',
      status: 'empty',
      workspaceId: 'workspace-a',
    });
    assert.deepEqual(
      await repository.listDouyinObserveSyncTargets(
        '2026-07-11T08:59:59.999Z'
      ),
      []
    );
    assert.deepEqual(
      await repository.listDouyinObserveSyncTargets(
        '2026-07-11T09:00:00.000Z'
      ),
      [
        {
          connectionId: 'douyin-observe-state',
          workspaceId: owner.workspaceId,
        },
      ]
    );

    douyin.setNextObserveResult({
      items: [
        {
          externalId: 'must-not-sync-before-due',
          fields: {},
          missingReasons: {},
          platformTime: '2026-07-11T08:10:00.000Z',
        },
      ],
      observedAt: '2026-07-11T08:30:00.000Z',
      status: 'ok',
    });
    const throttled = await service.syncDouyinObserve(
      owner,
      'douyin-observe-state',
      '2026-07-11T08:30:00.000Z'
    );
    assert.equal(throttled.length, 0);
    assert.equal(douyin.observeCallCount(), 1);

    douyin.setNextObserveResult({ status: 'unauthorized' });
    await service.syncDouyinObserve(
      owner,
      'douyin-observe-state',
      '2026-07-11T09:01:00.000Z'
    );
    snapshot = await service.getDouyinOperationsSnapshot(
      owner,
      'douyin-observe-state'
    );
    assert.ok(snapshot.observeState);
    assert.equal(snapshot.observeState.status, 'unavailable');
    assert.equal(snapshot.observeState.reason, 'unauthorized');
    assert.equal(
      snapshot.observeState.lastSuccessfulAt,
      '2026-07-11T08:00:00.000Z'
    );
    assert.equal(snapshot.observeState.nextSyncAt, undefined);
    assert.deepEqual(
      await repository.listDouyinObserveSyncTargets(
        '2026-07-12T09:00:00.000Z'
      ),
      []
    );
  });

  it('publishes vendored Feishu schema before a UAT read and retries only safe reads', async () => {
    const repository = new MemoryIntegrationRepository();
    const secrets = new FakeKmsSecretStore();
    const feishu = new RecordedFeishuMcpAdapter([
      {
        id: 'docx.v1.document.rawContent',
        remoteRevision: 'official-2026-07-11',
        source:
          'https://open.feishu.cn/document/mcp_open_tools/supported-tools',
        risk: 'read',
        inputSchema: {
          type: 'object',
          properties: { document_id: { type: 'string' } },
          required: ['document_id'],
        },
      },
    ]);
    const service = new IntegrationApplicationService({
      repository,
      secrets,
      feishu,
    });
    await service.createConnection(
      owner,
      {
        id: 'feishu-a',
        provider: 'feishu',
        identityMode: 'oauth_user',
        requestedCapabilities: ['mcp.tools'],
        grantedCapabilities: ['mcp.tools'],
        subject: 'feishu-user-a',
        credential: { value: 'uat-secret', scope: ['docx:document:readonly'] },
      },
      'feishu-oauth'
    );

    const discovered = await service.syncFeishuToolCatalog(admin, 'feishu-a');
    assert.equal(discovered[0]?.status, 'draft');
    assert.equal(discovered[0]?.schemaHash.length, 64);
    const safeCatalog = await service.listFeishuToolCatalog(owner, 'feishu-a');
    assert.equal(safeCatalog[0]?.id, 'docx.v1.document.rawContent');
    assert.equal('inputSchema' in safeCatalog[0]!, false);
    assert.equal('source' in safeCatalog[0]!, false);
    await service.publishFeishuToolRevision(
      admin,
      'docx.v1.document.rawContent',
      discovered[0]!.revision
    );

    await assert.rejects(
      service.executeFeishuIntent(owner, {
        arguments: { document_id: 'doc-a', injected: true },
        connectionId: 'feishu-a',
        fields: ['injected'],
        idempotencyKey: 'read-doc-a-injected',
        sideEffect: 'read',
        source: 'explicit_user',
        targetObjectId: 'doc-a',
        toolId: 'docx.v1.document.rawContent',
      }),
      (error: unknown) =>
        error instanceof IntegrationError &&
        error.code === 'TOOL_ARGUMENTS_INVALID'
    );
    await assert.rejects(
      service.executeFeishuIntent(owner, {
        arguments: { document_id: 'doc-b' },
        connectionId: 'feishu-a',
        fields: [],
        idempotencyKey: 'read-doc-a-target-changed',
        sideEffect: 'read',
        source: 'explicit_user',
        targetObjectId: 'doc-a',
        toolId: 'docx.v1.document.rawContent',
      }),
      (error: unknown) =>
        error instanceof IntegrationError &&
        error.code === 'INTENT_SCOPE_VIOLATION'
    );

    feishu.queueCallResult({ status: 'rate_limited', retryAfterSeconds: 1 });
    feishu.queueCallResult({
      status: 'ok',
      objectId: 'doc-a',
      externalUrl: 'https://example.feishu.cn/docx/doc-a',
      content: 'sensitive document body',
      output: { document_id: 'doc-a', revision: 'doc-revision-7' },
    });
    const request = {
      connectionId: 'feishu-a',
      toolId: 'docx.v1.document.rawContent',
      sideEffect: 'read' as const,
      source: 'explicit_user' as const,
      targetObjectId: 'doc-a',
      fields: ['raw_content'],
      arguments: { document_id: 'doc-a' },
      idempotencyKey: 'read-doc-a',
    };
    const result = await service.executeFeishuIntent(owner, request);
    assert.equal(result.status, 'completed');
    assert.equal(result.content, 'sensitive document body');
    assert.deepEqual(result.output, {
      document_id: 'doc-a',
      revision: 'doc-revision-7',
    });
    assert.deepEqual(feishu.calls()[0]?.allowedTools, [
      'docx.v1.document.rawContent',
    ]);
    assert.equal(feishu.calls().length, 2);
    const replay = await service.executeFeishuIntent(owner, request);
    assert.equal(replay.status, 'completed');
    assert.equal(replay.content, undefined);
    assert.equal(replay.output, undefined);
    assert.deepEqual(replay.intent, result.intent);
    assert.equal(feishu.calls().length, 2);
    const activity = await service.listFeishuActivity(owner, 'feishu-a');
    assert.equal(
      activity[0]?.externalUrl,
      'https://example.feishu.cn/docx/doc-a'
    );
    assert.equal(
      JSON.stringify(activity).includes('sensitive document body'),
      false
    );
    await service.disconnectConnection(owner, 'feishu-a', 'disconnect-feishu-a');
    await assert.rejects(
      service.executeFeishuIntent(owner, request),
      (error: unknown) =>
        error instanceof IntegrationError &&
        error.code === 'CONNECTION_UNAVAILABLE'
    );
  });

  it('bridges 401, 403, 429, revocation, and recovery into anomaly task events', async () => {
    const repository = new MemoryIntegrationRepository();
    const secrets = new FakeKmsSecretStore();
    const feishu = new RecordedFeishuMcpAdapter([
      {
        id: 'docx.v1.document.rawContent',
        remoteRevision: 'official-anomaly-r1',
        source:
          'https://open.feishu.cn/document/mcp_open_tools/supported-tools',
        risk: 'read',
        inputSchema: {
          type: 'object',
          properties: { document_id: { type: 'string' } },
          required: ['document_id'],
        },
      },
    ]);
    const taskEvents: Array<{
      type: 'report' | 'resolve';
      status?: string;
      reason?: string;
    }> = [];
    const service = new IntegrationApplicationService({
      anomalyTasks: {
        async report(input) {
          taskEvents.push({
            reason: input.reason,
            status: input.status,
            type: 'report',
          });
          return { taskId: `anomaly:${input.connectionId}` };
        },
        async resolve() {
          taskEvents.push({ type: 'resolve' });
        },
      },
      feishu,
      repository,
      secrets,
    });
    await service.createConnection(
      owner,
      {
        credential: {
          scope: ['docx:document:readonly'],
          value: 'uat-anomaly-secret',
        },
        grantedCapabilities: ['mcp.tools'],
        id: 'feishu-anomaly',
        identityMode: 'oauth_user',
        provider: 'feishu',
        requestedCapabilities: ['mcp.tools'],
      },
      'feishu-anomaly-create'
    );
    const [revision] = await service.syncFeishuToolCatalog(
      admin,
      'feishu-anomaly'
    );
    await service.publishFeishuToolRevision(
      admin,
      revision!.id,
      revision!.revision
    );
    taskEvents.length = 0;

    const execute = (idempotencyKey: string) =>
      service.executeFeishuIntent(owner, {
        arguments: { document_id: idempotencyKey },
        connectionId: 'feishu-anomaly',
        fields: ['raw_content'],
        idempotencyKey,
        sideEffect: 'read',
        source: 'explicit_user',
        targetObjectId: idempotencyKey,
        toolId: 'docx.v1.document.rawContent',
      });

    feishu.queueCallResult({ status: 'unauthorized' });
    await execute('anomaly-401');
    assert.deepEqual(taskEvents.at(-1), {
      reason: 'unauthorized',
      status: 'reauthorize_required',
      type: 'report',
    });
    await service.rotateConnectionCredential(
      owner,
      'feishu-anomaly',
      { scope: ['docx:document:readonly'], value: 'uat-after-401' },
      'recover-401'
    );
    assert.equal(taskEvents.at(-1)?.type, 'resolve');

    feishu.queueCallResult({ status: 'forbidden' });
    await execute('anomaly-403');
    assert.deepEqual(taskEvents.at(-1), {
      reason: 'forbidden',
      status: 'degraded',
      type: 'report',
    });
    feishu.queueCallResult({ objectId: 'doc-ok-403', status: 'ok' });
    await execute('recover-403');
    assert.equal(taskEvents.at(-1)?.type, 'resolve');

    feishu.queueCallResult({ status: 'rate_limited' });
    feishu.queueCallResult({ status: 'rate_limited' });
    await execute('anomaly-429');
    assert.deepEqual(taskEvents.at(-1), {
      reason: 'rate_limited',
      status: 'rate_limited',
      type: 'report',
    });
    feishu.queueCallResult({ objectId: 'doc-ok-429', status: 'ok' });
    await execute('recover-429');
    assert.equal(taskEvents.at(-1)?.type, 'resolve');

    await service.disconnectConnection(
      owner,
      'feishu-anomaly',
      'anomaly-revoke'
    );
    assert.deepEqual(taskEvents.at(-1), {
      reason: 'connection_revoked',
      status: 'revoked',
      type: 'report',
    });
    await service.rotateConnectionCredential(
      owner,
      'feishu-anomaly',
      { scope: ['docx:document:readonly'], value: 'uat-after-revoke' },
      'recover-revoke'
    );
    assert.equal(taskEvents.at(-1)?.type, 'resolve');
  });

  it('pins Feishu shortcuts and requires confirmation for autonomous high-risk writes', async () => {
    const repository = new MemoryIntegrationRepository();
    const secrets = new FakeKmsSecretStore();
    const tools = [
      {
        id: 'docx.v1.document.create',
        remoteRevision: 'official-r1',
        source:
          'https://open.feishu.cn/document/mcp_open_tools/supported-tools',
        risk: 'write' as const,
        inputSchema: {
          type: 'object',
          properties: { title: { type: 'string' } },
        },
      },
      {
        id: 'docx.v1.document.delete',
        remoteRevision: 'official-r1',
        source:
          'https://open.feishu.cn/document/mcp_open_tools/supported-tools',
        risk: 'destructive' as const,
        inputSchema: {
          type: 'object',
          properties: { document_id: { type: 'string' } },
        },
      },
    ];
    const feishu = new RecordedFeishuMcpAdapter(tools);
    const confirmationTasks: Array<{ taskId: string; confirmed: boolean }> = [];
    const service = new IntegrationApplicationService({
      repository,
      secrets,
      feishu,
      confirmationTasks: {
        async create(input) {
          const task = {
            taskId: `content-task:${input.intentId}`,
            confirmed: false,
          };
          confirmationTasks.push(task);
          return { taskId: task.taskId };
        },
        async confirm(input) {
          const task = confirmationTasks.find(
            (candidate) => candidate.taskId === input.taskId
          );
          if (!task) throw new Error('confirmation task missing');
          task.confirmed = true;
        },
      },
    });
    await service.createConnection(
      owner,
      {
        id: 'feishu-writes',
        provider: 'feishu',
        identityMode: 'oauth_user',
        requestedCapabilities: ['mcp.tools'],
        grantedCapabilities: ['mcp.tools'],
        credential: { value: 'uat-write-secret', scope: ['docx:document'] },
      },
      'feishu-write-oauth'
    );
    const revisions = await service.syncFeishuToolCatalog(
      admin,
      'feishu-writes'
    );
    for (const revision of revisions) {
      await service.publishFeishuToolRevision(
        admin,
        revision.id,
        revision.revision
      );
    }
    await service.setFeishuShortcuts(owner, 'feishu-writes', [
      { toolId: 'docx.v1.document.create', order: 1, hidden: false },
      { toolId: 'docx.v1.document.delete', order: 2, hidden: true },
    ]);

    await assert.rejects(
      service.executeFeishuIntent(owner, {
        arguments: { title: '未授权字段扩张' },
        connectionId: 'feishu-writes',
        fields: [],
        idempotencyKey: 'create-with-expanded-field',
        sideEffect: 'create',
        source: 'explicit_user',
        toolId: 'docx.v1.document.create',
      }),
      (error: unknown) =>
        error instanceof IntegrationError &&
        error.code === 'INTENT_SCOPE_VIOLATION'
    );

    feishu.queueCallResult({
      status: 'ok',
      objectId: 'new-doc',
      output: {
        untrusted_suggestion: {
          tool: 'docx.v1.document.delete',
          fields: ['all'],
        },
      },
    });
    const created = await service.executeFeishuIntent(owner, {
      connectionId: 'feishu-writes',
      toolId: 'docx.v1.document.create',
      sideEffect: 'delete',
      source: 'autonomous',
      fields: ['title'],
      arguments: { title: '周内容计划' },
      idempotencyKey: 'create-weekly-doc',
    });
    assert.equal(created.status, 'completed');
    assert.equal(created.intent.toolId, 'docx.v1.document.create');
    assert.deepEqual(created.intent.fields, ['title']);
    assert.equal(created.intent.sideEffect, 'create');
    assert.equal(created.intent.source, 'explicit_user');

    await assert.rejects(
      service.executeFeishuIntent(worker, {
        arguments: { document_id: 'unbound-doc' },
        connectionId: 'feishu-writes',
        fields: [],
        idempotencyKey: 'autonomous-delete-without-trusted-target',
        sideEffect: 'delete',
        source: 'explicit_user',
        toolId: 'docx.v1.document.delete',
      }),
      (error: unknown) =>
        error instanceof IntegrationError &&
        error.code === 'INTENT_SCOPE_VIOLATION'
    );

    const pending = await service.executeFeishuIntent(worker, {
      connectionId: 'feishu-writes',
      toolId: 'docx.v1.document.delete',
      sideEffect: 'delete',
      source: 'explicit_user',
      targetObjectId: 'old-doc',
      fields: [],
      arguments: { document_id: 'old-doc' },
      idempotencyKey: 'autonomous-delete-old-doc',
    });
    assert.equal(pending.status, 'confirmation_pending');
    assert.equal(pending.intent.source, 'autonomous');
    assert.ok('confirmationTaskId' in pending);
    assert.ok(pending.confirmationTaskId);
    assert.equal(
      pending.confirmationTaskId,
      `content-task:${pending.intent.id}`
    );
    assert.equal(confirmationTasks[0]?.confirmed, false);
    assert.equal(feishu.calls().length, 1);

    feishu.queueCallResult({
      status: 'unknown',
      errorCode: 'transport_after_send',
    });
    const confirmed = await service.confirmFeishuIntent(owner, {
      intentId: pending.intent.id,
      arguments: { document_id: 'old-doc' },
      idempotencyKey: 'confirm-delete-old-doc',
    });
    assert.equal(confirmed.status, 'unknown');
    assert.equal(confirmationTasks[0]?.confirmed, true);
    assert.equal(feishu.calls().length, 2);
    const confirmedReplay = await service.confirmFeishuIntent(owner, {
      arguments: { document_id: 'old-doc' },
      idempotencyKey: 'confirm-delete-old-doc-replayed',
      intentId: pending.intent.id,
    });
    assert.equal(confirmedReplay.status, 'unknown');
    assert.equal(feishu.calls().length, 2);
    const executeReplayAfterConfirmation = await service.executeFeishuIntent(
      worker,
      {
        connectionId: 'feishu-writes',
        toolId: 'docx.v1.document.delete',
        sideEffect: 'delete',
        source: 'explicit_user',
        targetObjectId: 'old-doc',
        fields: [],
        arguments: { document_id: 'old-doc' },
        idempotencyKey: 'autonomous-delete-old-doc',
      }
    );
    assert.equal(executeReplayAfterConfirmation.status, 'unknown');
    assert.equal(feishu.calls().length, 2);

    const riskPinned = await service.executeFeishuIntent(worker, {
      arguments: { document_id: 'another-old-doc' },
      connectionId: 'feishu-writes',
      fields: [],
      idempotencyKey: 'autonomous-delete-disguised-as-read',
      sideEffect: 'read',
      source: 'explicit_user',
      targetObjectId: 'another-old-doc',
      toolId: 'docx.v1.document.delete',
    });
    assert.equal(riskPinned.status, 'confirmation_pending');
    assert.equal(riskPinned.intent.sideEffect, 'delete');
    assert.equal(feishu.calls().length, 2);

    feishu.setTools([
      {
        ...tools[0]!,
        remoteRevision: 'official-r2',
        inputSchema: { ...tools[0]!.inputSchema, additionalProperties: false },
      },
      tools[1]!,
    ]);
    const changed = await service.syncFeishuToolCatalog(
      admin,
      'feishu-writes'
    );
    const newCreateRevision = changed.find(
      (revision) =>
        revision.id === 'docx.v1.document.create' && revision.status === 'draft'
    );
    assert.ok(newCreateRevision);
    await service.publishFeishuToolRevision(
      admin,
      newCreateRevision.id,
      newCreateRevision.revision
    );
    assert.deepEqual(
      await service.listFeishuShortcuts(owner, 'feishu-writes'),
      [
        { toolId: 'docx.v1.document.create', order: 1, hidden: false },
        { toolId: 'docx.v1.document.delete', order: 2, hidden: true },
      ]
    );
  });

  it('recovers a claimed Feishu effect after a crash without calling MCP twice', async () => {
    class CrashAfterFeishuEffectRepository extends MemoryIntegrationRepository {
      private crash = true;

      override async saveIntent(
        intent: Parameters<MemoryIntegrationRepository['saveIntent']>[0]
      ) {
        if (this.crash && intent.status === 'executed') {
          this.crash = false;
          throw new Error('simulated crash after Feishu effect');
        }
        return super.saveIntent(intent);
      }
    }

    const repository = new CrashAfterFeishuEffectRepository();
    const secrets = new FakeKmsSecretStore();
    const feishu = new RecordedFeishuMcpAdapter([
      {
        id: 'docx.v1.document.create',
        inputSchema: {
          properties: { title: { type: 'string' } },
          type: 'object',
        },
        remoteRevision: 'official-crash-r1',
        risk: 'write',
        source: 'recorded://feishu',
      },
    ]);
    const service = new IntegrationApplicationService({
      feishu,
      repository,
      secrets,
    });
    await service.createConnection(
      owner,
      {
        credential: { scope: ['docx:document'], value: 'uat-crash' },
        grantedCapabilities: ['mcp.tools'],
        id: 'feishu-crash-safe',
        identityMode: 'oauth_user',
        provider: 'feishu',
        requestedCapabilities: ['mcp.tools'],
      },
      'create-feishu-crash-safe'
    );
    const [revision] = await service.syncFeishuToolCatalog(
      admin,
      'feishu-crash-safe'
    );
    await service.publishFeishuToolRevision(
      admin,
      revision!.id,
      revision!.revision
    );
    feishu.queueCallResult({ objectId: 'doc-crash-safe', status: 'ok' });
    const request = {
      arguments: { title: '周内容计划' },
      connectionId: 'feishu-crash-safe',
      fields: ['title'],
      idempotencyKey: 'feishu-effect-crash-safe',
      sideEffect: 'create' as const,
      source: 'explicit_user' as const,
      toolId: 'docx.v1.document.create',
    };

    await assert.rejects(
      service.executeFeishuIntent(owner, request),
      /simulated crash after Feishu effect/
    );
    const recovered = await service.executeFeishuIntent(owner, request);
    assert.equal(recovered.status, 'reconciliation_required');
    assert.equal(recovered.intent.effectState, 'reconciliation_required');
    assert.equal(feishu.calls().length, 1);
    const recovery = await service.listFeishuIntentRecovery(
      owner,
      'feishu-crash-safe'
    );
    assert.equal(recovery[0]?.status, 'unknown');
  });

  it('persists a thrown Feishu transport as unknown and never retries the effect', async () => {
    let calls = 0;
    const reconciliations: Array<Record<string, unknown>> = [];
    const repository = new MemoryIntegrationRepository();
    const feishu = {
      async discover() {
        return [
          {
            id: 'docx.v1.document.create',
            inputSchema: { type: 'object' },
            remoteRevision: 'official-transport-r1',
            risk: 'write' as const,
            source: 'recorded://feishu',
          },
        ];
      },
      async call() {
        calls += 1;
        throw new Error('socket closed with private endpoint details');
      },
      async reconcile(request: Record<string, unknown>) {
        const { uat: _uat, ...safeEnvelope } = request;
        reconciliations.push(safeEnvelope);
        return {
          externalUrl: 'https://example.feishu.cn/docx/reconciled-doc',
          objectId: 'reconciled-doc',
          providerLogId: 'provider-log-safe',
          status: 'completed' as const,
        };
      },
    };
    const service = new IntegrationApplicationService({
      feishu,
      repository,
      secrets: new FakeKmsSecretStore(),
    });
    await service.createConnection(
      owner,
      {
        credential: { scope: ['docx:document'], value: 'uat-transport' },
        grantedCapabilities: ['mcp.tools'],
        id: 'feishu-transport-unknown',
        identityMode: 'oauth_user',
        provider: 'feishu',
        requestedCapabilities: ['mcp.tools'],
      },
      'create-feishu-transport-unknown'
    );
    const [revision] = await service.syncFeishuToolCatalog(
      admin,
      'feishu-transport-unknown'
    );
    await service.publishFeishuToolRevision(
      admin,
      revision!.id,
      revision!.revision
    );
    const request = {
      arguments: { title: '周内容计划' },
      connectionId: 'feishu-transport-unknown',
      fields: ['title'],
      idempotencyKey: 'feishu-transport-unknown-effect',
      sideEffect: 'create' as const,
      source: 'explicit_user' as const,
      toolId: 'docx.v1.document.create',
    };

    const unknown = await service.executeFeishuIntent(owner, request);
    assert.equal(unknown.status, 'unknown');
    assert.equal(unknown.intent.effectState, 'reconciliation_required');
    assert.equal(unknown.intent.lastErrorCode, 'mcp_transport_unknown');
    const replay = await service.executeFeishuIntent(owner, request);
    assert.equal(replay.status, 'unknown');
    assert.deepEqual(replay.intent, unknown.intent);
    assert.equal(replay.content, undefined);
    assert.equal(replay.output, undefined);
    assert.equal(calls, 1);
    assert.deepEqual(
      await repository.listFeishuReconciliationTargets(
        unknown.intent.nextReconcileAt!
      ),
      [
        {
          intentId: unknown.intent.id,
          workspaceId: owner.workspaceId,
        },
      ]
    );
    const reconciled = await service.reconcileFeishuIntent(
      owner,
      unknown.intent.id,
      '2026-07-11T06:00:00.000Z'
    );
    assert.equal(reconciled.status, 'completed');
    assert.equal(reconciled.intent.effectState, 'settled');
    assert.equal(reconciled.intent.outcomeStatus, 'completed');
    assert.equal(calls, 1);
    assert.deepEqual(reconciliations, [
      {
        argumentHash: unknown.intent.argumentHash,
        fields: ['title'],
        intentId: unknown.intent.id,
        schemaHash: unknown.intent.schemaHash,
        sideEffect: 'create',
        toolId: unknown.intent.toolId,
        toolRevision: unknown.intent.toolRevision,
      },
    ]);
    assert.equal(JSON.stringify(reconciliations).includes('周内容计划'), false);
    assert.deepEqual(
      await repository.listFeishuReconciliationTargets(
        '2026-07-12T00:00:00.000Z'
      ),
      []
    );
    const activity = await service.listFeishuActivity(
      owner,
      'feishu-transport-unknown'
    );
    assert.equal(activity.at(-1)?.status, 'completed');
    assert.equal(activity.at(-1)?.providerLogId, 'provider-log-safe');
  });
});
