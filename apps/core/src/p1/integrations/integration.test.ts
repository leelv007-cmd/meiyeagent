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
  RecordedByokExecutionAdapter,
  RecordedFeishuMcpAdapter,
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

describe('IntegrationApplicationService', () => {
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
