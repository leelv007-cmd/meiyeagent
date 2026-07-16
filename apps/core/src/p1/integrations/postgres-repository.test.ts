import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import type {
  DouyinObserveSnapshot,
  DouyinPublishConfirmation,
  DouyinPublishJob,
  ExternalActionIntent,
  FeishuToolActivity,
  FeishuToolRevision,
  IntegrationConnection,
} from './contracts.js';
import { PostgresIntegrationRepository } from './postgres-repository.js';
import {
  FakeKmsSecretStore,
  IntegrationApplicationService,
  IntegrationError,
  RecordedDouyinAdapter,
  RecordedFeishuMcpAdapter,
} from './index.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'Postgres integration repository isolates workspaces and persists no secret values',
  {
    skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
  },
  async (t) => {
    const pool = new Pool({ connectionString });
    const suffix = randomUUID();
    const workspaceA = `integration-a-${suffix}`;
    const workspaceB = `integration-b-${suffix}`;
    const connectionId = `connection-${suffix}`;
    const toolId = `tool-${suffix}`;
    const repository = new PostgresIntegrationRepository(pool);
    await repository.migrate();
    t.after(async () => {
      await repository.deleteWorkspaceFacts(workspaceA);
      await repository.deleteWorkspaceFacts(workspaceB);
      await pool.query(
        'DELETE FROM integration_tool_revisions WHERE tool_id = $1',
        [toolId]
      );
      await pool.end();
    });

    const connection = (
      workspaceId: string,
      subject: string
    ): IntegrationConnection => ({
      id: connectionId,
      workspaceId,
      provider: 'douyin',
      identityMode: 'oauth_user',
      requestedCapabilities: ['publish', 'observe'],
      grantedCapabilities: ['publish'],
      degradedCapabilities: {},
      capabilityEvidence: {},
      status: 'available',
      subject,
      secretRef: `aws-sm://${workspaceId}/credential/v1`,
      credential: {
        id: `credential-${suffix}`,
        version: 1,
        mask: '••••••••',
        scope: ['video.create.bind'],
        status: 'active',
      },
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z',
    });
    await repository.saveConnection(connection(workspaceA, 'open-id-a'));
    await repository.saveConnection(connection(workspaceB, 'open-id-b'));
    assert.equal(
      (await repository.getConnection(workspaceA, connectionId))?.subject,
      'open-id-a'
    );
    assert.equal(
      (await repository.getConnection(workspaceB, connectionId))?.subject,
      'open-id-b'
    );
    const currentA = (await repository.getConnection(
      workspaceA,
      connectionId
    ))!;
    const connectionCasResults = await Promise.all([
      repository.compareAndSwapConnection(
        {
          ...currentA,
          subject: 'cas-winner-a',
          updatedAt: '2026-07-11T00:00:01.000Z',
        },
        {
          credentialVersion: currentA.credential.version,
          updatedAt: currentA.updatedAt,
        }
      ),
      repository.compareAndSwapConnection(
        {
          ...currentA,
          subject: 'cas-winner-b',
          updatedAt: '2026-07-11T00:00:02.000Z',
        },
        {
          credentialVersion: currentA.credential.version,
          updatedAt: currentA.updatedAt,
        }
      ),
    ]);
    assert.equal(connectionCasResults.filter(Boolean).length, 1);
    assert.equal(
      ['cas-winner-a', 'cas-winner-b'].includes(
        (await repository.getConnection(workspaceA, connectionId))!.subject!
      ),
      true
    );

    const confirmation: DouyinPublishConfirmation = {
      id: `confirmation-${suffix}`,
      workspaceId: workspaceA,
      connectionId,
      accountSubject: 'open-id-a',
      contentSnapshotId: 'content-v1',
      contentSnapshotRevision: 'content-v1-r1',
      scheduledAt: '2026-07-12T00:00:00.000Z',
      confirmedBy: 'owner-a',
      confirmedAt: '2026-07-11T00:00:00.000Z',
    };
    await repository.saveDouyinConfirmation(confirmation);
    assert.equal(
      (await repository.getDouyinConfirmation(workspaceA, confirmation.id))
        ?.contentSnapshotId,
      'content-v1'
    );
    const publishJob: DouyinPublishJob = {
      id: `publish-${suffix}`,
      workspaceId: workspaceA,
      connectionId,
      confirmationId: confirmation.id,
      status: 'reviewing',
      acceptance: 'accepted',
      itemId: 'item-a',
      nextPollAt: '2026-07-11T00:02:00.000Z',
      pollAttempts: 0,
      pollDeadlineAt: '2026-07-11T06:01:00.000Z',
      pollingState: 'scheduled',
      pollLimit: 12,
      videoId: 'video-a',
      createdAt: '2026-07-11T00:01:00.000Z',
      updatedAt: '2026-07-11T00:01:00.000Z',
    };
    await repository.saveDouyinPublishJob(publishJob);
    assert.equal(
      (await repository.getDouyinPublishJob(workspaceA, publishJob.id))?.itemId,
      'item-a'
    );
    assert.equal(
      await repository.hasProductPublishItem(workspaceA, 'item-a'),
      true
    );
    assert.deepEqual(
      await repository.listDouyinPublishPollingTargets(
        '2026-07-11T00:01:59.000Z'
      ),
      []
    );
    assert.deepEqual(
      await repository.listDouyinPublishPollingTargets(
        '2026-07-11T00:02:00.000Z'
      ),
      [{ jobId: publishJob.id, workspaceId: workspaceA }]
    );
    const claimJob: DouyinPublishJob = {
      acceptance: 'acceptance_unknown',
      confirmationId: `${confirmation.id}:claim`,
      connectionId,
      createdAt: '2026-07-11T00:02:00.000Z',
      effectState: 'claimed',
      id: `publish-claim-${suffix}`,
      status: 'submitting',
      updatedAt: '2026-07-11T00:02:00.000Z',
      workspaceId: workspaceA,
    };
    const publishClaims = await Promise.all(
      Array.from({ length: 8 }, () =>
        repository.claimDouyinPublishJob(claimJob)
      )
    );
    assert.equal(publishClaims.filter((claim) => claim.claimed).length, 1);
    assert.equal(
      (await repository.listDouyinPublishJobs(workspaceA, connectionId)).length,
      2
    );
    const publishSettlements = await Promise.all(
      Array.from({ length: 8 }, () =>
        repository.settleDouyinPublishJob(
          {
            ...claimJob,
            acceptance: 'accepted',
            effectState: 'settled',
            itemId: `claim-item-${suffix}`,
            status: 'reviewing',
            updatedAt: '2026-07-11T00:03:00.000Z',
          },
          'submitting'
        )
      )
    );
    assert.equal(
      publishSettlements.filter((settlement) => settlement.settled).length,
      1
    );
    const publishReconciliations = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        repository.reconcileDouyinPublishJob(
          {
            ...claimJob,
            acceptance: 'accepted',
            effectState: 'settled',
            itemId: `claim-item-${suffix}`,
            providerEventId: `publish-event-${index}`,
            providerOccurredAt: '2026-07-11T00:04:00.000Z',
            status: 'published',
            updatedAt: '2026-07-11T00:04:00.000Z',
          },
          '2026-07-11T00:03:00.000Z'
        )
      )
    );
    assert.equal(
      publishReconciliations.filter(
        (reconciliation) => reconciliation.reconciled
      ).length,
      1
    );
    const claimedEvents = await Promise.all(
      Array.from({ length: 8 }, () =>
        repository.claimExternalEvent(workspaceA, 'douyin', `event-${suffix}`)
      )
    );
    assert.equal(claimedEvents.filter(Boolean).length, 1);

    const observeConnection = (await repository.getConnection(
      workspaceA,
      connectionId
    ))!;
    await repository.saveConnection({
      ...observeConnection,
      capabilityEvidence: {
        ...observeConnection.capabilityEvidence,
        observe: {
          endpoint: 'recorded://douyin/observe',
          frequency: 'PT1H',
          revision: 'observe-r1',
          scopes: ['observe.current'],
          verifiedAt: '2026-07-11T00:00:00.000Z',
        },
      },
      grantedCapabilities: ['publish', 'observe'],
    });

    const newer: DouyinObserveSnapshot = {
      workspaceId: workspaceA,
      connectionId,
      externalId: 'item-1',
      source: 'external',
      platformTime: '2026-07-10T00:00:00.000Z',
      observedAt: '2026-07-11T08:00:00.000Z',
      evidenceRevision: 'observe-r1',
      fields: { view_count: 20 },
      missingReasons: { comment_count: 'not_returned' },
    };
    await repository.saveDouyinObserveSnapshot(newer);
    await repository.saveDouyinObserveSnapshot({
      ...newer,
      observedAt: '2026-07-11T07:00:00.000Z',
      fields: { view_count: 1 },
    });
    assert.equal(
      (await repository.listDouyinObserveSnapshots(workspaceA, connectionId))[0]
        ?.fields.view_count,
      20
    );
    await repository.saveDouyinObserveState({
      connectionId,
      evidenceRevision: 'observe-r1',
      lastAttemptAt: '2026-07-11T08:00:00.000Z',
      lastSuccessfulAt: '2026-07-11T08:00:00.000Z',
      nextSyncAt: '2026-07-11T09:00:00.000Z',
      status: 'available',
      workspaceId: workspaceA,
    });
    await repository.saveDouyinObserveState({
      connectionId,
      evidenceRevision: 'observe-r1',
      lastAttemptAt: '2026-07-11T07:00:00.000Z',
      reason: 'stale_result_must_not_overwrite',
      status: 'unknown',
      workspaceId: workspaceA,
    });
    assert.deepEqual(
      await repository.getDouyinObserveState(workspaceA, connectionId),
      {
        connectionId,
        evidenceRevision: 'observe-r1',
        lastAttemptAt: '2026-07-11T08:00:00.000Z',
        lastSuccessfulAt: '2026-07-11T08:00:00.000Z',
        nextSyncAt: '2026-07-11T09:00:00.000Z',
        status: 'available',
        workspaceId: workspaceA,
      }
    );
    assert.equal(
      await repository.getDouyinObserveState(workspaceB, connectionId),
      undefined
    );
    assert.deepEqual(
      (
        await repository.listDouyinObserveSyncTargets(
          '2026-07-11T08:59:59.999Z'
        )
      ).filter((target) => target.workspaceId === workspaceA),
      []
    );
    assert.deepEqual(
      (
        await repository.listDouyinObserveSyncTargets(
          '2026-07-11T09:00:00.000Z'
        )
      ).filter((target) => target.workspaceId === workspaceA),
      [{ connectionId, workspaceId: workspaceA }]
    );

    const revision: FeishuToolRevision = {
      id: toolId,
      remoteRevision: 'official-r1',
      source: 'https://mcp.feishu.cn/mcp',
      risk: 'read',
      inputSchema: {
        type: 'object',
        properties: { document_id: { type: 'string' } },
      },
      revision: 'official-r1:hash',
      schemaHash: 'a'.repeat(64),
      status: 'published',
      discoveredAt: '2026-07-11T00:00:00.000Z',
      publishedAt: '2026-07-11T00:00:00.000Z',
    };
    await repository.saveToolRevision(revision);
    assert.equal(
      (await repository.getPublishedTool(toolId))?.schemaHash,
      'a'.repeat(64)
    );
    const intent: ExternalActionIntent = {
      argumentHash: 'b'.repeat(64),
      confirmationTaskId: `task-${suffix}`,
      connectionId,
      createdAt: '2026-07-11T00:04:00.000Z',
      createdBy: 'owner-a',
      fields: ['title'],
      id: `intent-claim-${suffix}`,
      schemaHash: revision.schemaHash,
      sideEffect: 'delete',
      source: 'autonomous',
      status: 'confirmation_pending',
      toolId,
      toolRevision: revision.revision,
      workspaceId: workspaceA,
    };
    const intentClaims = await Promise.all(
      Array.from({ length: 8 }, () => repository.claimIntent(intent))
    );
    assert.equal(intentClaims.filter((claim) => claim.claimed).length, 1);
    const executionClaims = await Promise.all(
      Array.from({ length: 8 }, () =>
        repository.claimIntentExecution(
          { ...intent, effectState: 'claimed', status: 'authorized' },
          'confirmation_pending'
        )
      )
    );
    assert.equal(executionClaims.filter((claim) => claim.claimed).length, 1);
    assert.equal(
      (await repository.getIntent(workspaceA, intent.id))?.status,
      'authorized'
    );
    await repository.saveIntent({
      ...intent,
      effectState: 'reconciliation_required',
      nextReconcileAt: '2026-07-11T00:06:00.000Z',
      outcomeStatus: 'unknown',
      status: 'unknown',
    });
    assert.deepEqual(
      await repository.listFeishuReconciliationTargets(
        '2026-07-11T00:05:59.999Z'
      ),
      []
    );
    assert.deepEqual(
      await repository.listFeishuReconciliationTargets(
        '2026-07-11T00:06:00.000Z'
      ),
      [{ intentId: intent.id, workspaceId: workspaceA }]
    );
    const activity: FeishuToolActivity = {
      id: `activity-${suffix}`,
      workspaceId: workspaceA,
      connectionId,
      toolId,
      intentId: `intent-${suffix}`,
      objectId: 'doc-a',
      externalUrl: 'https://example.feishu.cn/docx/doc-a',
      status: 'completed',
      executedAt: '2026-07-11T00:00:00.000Z',
    };
    await repository.appendActivity(activity);

    const feishu = new RecordedFeishuMcpAdapter([]);
    const secrets = new FakeKmsSecretStore();
    const service = new IntegrationApplicationService({
      repository,
      secrets,
      feishu,
    });
    const owner = {
      workspaceId: workspaceA,
      userId: 'owner-a',
      role: 'owner' as const,
      correlationId: 'corr-postgres-integration',
    };
    await service.createConnection(
      owner,
      {
        id: `feishu-${suffix}`,
        provider: 'feishu',
        identityMode: 'oauth_user',
        requestedCapabilities: ['mcp.tools'],
        grantedCapabilities: ['mcp.tools'],
        credential: {
          value: 'uat-must-not-persist',
          scope: ['docx:document:readonly'],
        },
      },
      'feishu-create'
    );
    await service.verifyFeishuConnection(owner, `feishu-${suffix}`);
    feishu.queueCallResult({
      status: 'ok',
      objectId: 'doc-sensitive',
      content: 'document body must not persist',
      output: { document_id: 'doc-sensitive', revision: 'revision-9' },
    });
    const readRequest = {
      connectionId: `feishu-${suffix}`,
      toolId,
      sideEffect: 'read' as const,
      source: 'explicit_user' as const,
      fields: ['raw_content'],
      arguments: { document_id: 'doc-sensitive' },
      idempotencyKey: 'read-sensitive-document',
    };
    const firstRead = await service.executeFeishuIntent(owner, readRequest);
    const replayedRead = await service.executeFeishuIntent(owner, readRequest);
    assert.equal(replayedRead.status, firstRead.status);
    assert.deepEqual(replayedRead.intent, firstRead.intent);
    assert.equal('content' in replayedRead, false);
    assert.equal('output' in replayedRead, false);
    assert.equal(feishu.calls().length, 1);

    const raw = await pool.query(
      `SELECT row_to_json(c)::text AS value
       FROM integration_connections c WHERE workspace_id = $1
     UNION ALL
     SELECT row_to_json(b)::text AS value
       FROM integration_credential_bindings b WHERE workspace_id = $1
     UNION ALL
     SELECT row_to_json(v)::text AS value
       FROM integration_credential_versions v WHERE workspace_id = $1
     UNION ALL
     SELECT row_to_json(i)::text AS value
       FROM integration_idempotency i WHERE workspace_id = $1
     UNION ALL
     SELECT row_to_json(a)::text AS value
       FROM integration_tool_activities a WHERE workspace_id = $1
     UNION ALL
     SELECT row_to_json(n)::text AS value
       FROM integration_external_intents n WHERE workspace_id = $1`,
      [workspaceA]
    );
    const serialized = JSON.stringify(raw.rows);
    assert.equal(serialized.includes('sensitive-token'), false);
    assert.equal(serialized.includes('uat-must-not-persist'), false);
    assert.equal(serialized.includes('document body must not persist'), false);
  }
);

test(
  'Postgres connection create recovers a lost commit response without persisting plaintext',
  {
    skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
  },
  async (t) => {
    class CommitThenThrowRepository extends PostgresIntegrationRepository {
      private failed = false;

      override async createConnectionIfAbsent(
        connection: IntegrationConnection
      ) {
        const result = await super.createConnectionIfAbsent(connection);
        if (result.created && !this.failed) {
          this.failed = true;
          throw new Error('postgres connection commit response lost');
        }
        return result;
      }
    }

    const pool = new Pool({ connectionString });
    const workspaceId = `integration-create-${randomUUID()}`;
    const repository = new CommitThenThrowRepository(pool);
    await repository.migrate();
    t.after(async () => {
      await repository.deleteWorkspaceFacts(workspaceId);
      await pool.end();
    });
    const secrets = new FakeKmsSecretStore();
    const context = {
      correlationId: 'postgres-create-response-loss',
      role: 'owner' as const,
      userId: 'owner-a',
      workspaceId,
    };
    const input = {
      credential: {
        scope: ['model.invoke'],
        value: 'postgres-create-secret-never-persist',
      },
      grantedCapabilities: ['model.invoke'],
      id: 'postgres-response-loss-create',
      identityMode: 'byok' as const,
      provider: 'model' as const,
      requestedCapabilities: ['model.invoke'],
    };

    await assert.rejects(
      new IntegrationApplicationService({ repository, secrets }).createConnection(
        context,
        input,
        'postgres-response-loss-create-key'
      ),
      /postgres connection commit response lost/
    );
    const restarted = new IntegrationApplicationService({
      repository: new PostgresIntegrationRepository(pool),
      secrets,
    });
    const recovered = await restarted.createConnection(
      context,
      input,
      'postgres-response-loss-create-key'
    );
    assert.equal(recovered.id, input.id);
    assert.equal((await restarted.listConnections(context)).length, 1);

    const raw = await pool.query(
      `SELECT row_to_json(c)::text AS value
         FROM integration_connections c WHERE workspace_id = $1
       UNION ALL
       SELECT row_to_json(v)::text AS value
         FROM integration_credential_versions v WHERE workspace_id = $1
       UNION ALL
       SELECT row_to_json(i)::text AS value
         FROM integration_idempotency i WHERE workspace_id = $1
       UNION ALL
       SELECT row_to_json(o)::text AS value
         FROM integration_connection_create_operations o WHERE workspace_id = $1`,
      [workspaceId]
    );
    assert.equal(
      JSON.stringify(raw.rows).includes(input.credential.value),
      false
    );
  }
);

test(
  'Postgres connection CAS fences stale provider writes after rotation and disconnect',
  {
    skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
  },
  async (t) => {
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

    const pool = new Pool({ connectionString });
    const repository = new PostgresIntegrationRepository(pool);
    const workspaceId = `integration-cas-${randomUUID()}`;
    await repository.migrate();
    t.after(async () => {
      await repository.deleteWorkspaceFacts(workspaceId);
      await pool.end();
    });
    const secrets = new FakeKmsSecretStore();
    const feishu = new BlockingFeishuAdapter();
    const service = new IntegrationApplicationService({
      feishu,
      repository,
      secrets,
    });
    const context = {
      correlationId: 'postgres-connection-cas',
      role: 'owner' as const,
      userId: 'owner-a',
      workspaceId,
    };
    const created = await service.createConnection(
      context,
      {
        credential: {
          scope: ['mcp.tools'],
          status: 'unverified',
          value: 'postgres-uat-v1',
        },
        grantedCapabilities: [],
        id: 'postgres-stale-connection-write',
        identityMode: 'oauth_user',
        provider: 'feishu',
        requestedCapabilities: ['mcp.tools'],
      },
      'create-postgres-stale-connection-write'
    );

    feishu.blockNextDiscovery();
    const staleVerification = service.verifyFeishuConnection(
      context,
      created.id
    );
    await feishu.waitUntilEntered();
    const rotated = await service.rotateConnectionCredential(
      context,
      created.id,
      { scope: ['mcp.tools'], value: 'postgres-uat-v2' },
      'rotate-postgres-stale-connection-write'
    );
    feishu.release();
    await assert.rejects(
      staleVerification,
      (error: unknown) =>
        error instanceof IntegrationError &&
        error.code === 'CONNECTION_WRITE_CONFLICT'
    );
    assert.equal(
      (await service.getConnection(context, created.id)).credential.version,
      2
    );

    feishu.blockNextDiscovery();
    const staleAfterDisconnect = service.verifyFeishuConnection(
      context,
      created.id
    );
    await feishu.waitUntilEntered();
    await service.disconnectConnection(
      context,
      created.id,
      'disconnect-postgres-stale-connection-write'
    );
    feishu.release();
    await assert.rejects(
      staleAfterDisconnect,
      (error: unknown) =>
        error instanceof IntegrationError &&
        error.code === 'CONNECTION_WRITE_CONFLICT'
    );
    const disconnected = await service.getConnection(context, created.id);
    assert.equal(disconnected.status, 'revoked');
    assert.equal(disconnected.credential.version, 2);
    await assert.rejects(
      secrets.use(rotated.secretRef, {
        credentialId: rotated.credential.id,
        provider: 'feishu',
        version: 2,
        workspaceId,
      }),
      (error: unknown) =>
        error instanceof IntegrationError && error.code === 'SECRET_NOT_FOUND'
    );
  }
);

test(
  'Postgres OAuth refresh recovery persists only hashes and secret references',
  {
    skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
  },
  async (t) => {
    class RevokeOldSecretOnce extends FakeKmsSecretStore {
      private failed = false;

      override async revoke(secretRef: string, context: Parameters<FakeKmsSecretStore['revoke']>[1]) {
        if (context.version === 1 && !this.failed) {
          this.failed = true;
          throw new Error('postgres old OAuth secret revoke failed');
        }
        return super.revoke(secretRef, context);
      }
    }

    const pool = new Pool({ connectionString });
    const repository = new PostgresIntegrationRepository(pool);
    const workspaceId = `integration-oauth-${randomUUID()}`;
    await repository.migrate();
    t.after(async () => {
      await repository.deleteWorkspaceFacts(workspaceId);
      await pool.end();
    });
    const secrets = new RevokeOldSecretOnce();
    const douyin = new RecordedDouyinAdapter();
    douyin.setNextRefreshResult({
      accessExpiresAt: '2026-08-01T00:00:00.000Z',
      accessToken: 'postgres-access-v2-never-persist',
      refreshExpiresAt: '2026-09-01T00:00:00.000Z',
      refreshToken: 'postgres-refresh-v2-never-persist',
      scopes: ['video.create.bind'],
      status: 'ok',
    });
    const context = {
      correlationId: 'postgres-oauth-refresh',
      role: 'owner' as const,
      userId: 'owner-a',
      workspaceId,
    };
    const service = new IntegrationApplicationService({
      douyin,
      repository,
      secrets,
    });
    await service.createConnection(
      context,
      {
        credential: {
          scope: ['video.create.bind'],
          value: JSON.stringify({
            accessToken: 'postgres-access-v1-never-persist',
            refreshToken: 'postgres-refresh-v1-never-persist',
          }),
        },
        grantedCapabilities: [],
        id: 'postgres-oauth-refresh',
        identityMode: 'oauth_user',
        provider: 'douyin',
        requestedCapabilities: ['publish'],
        subject: 'postgres-open-id',
      },
      'create-postgres-oauth-refresh'
    );

    await assert.rejects(
      service.refreshDouyinOAuth(
        context,
        'postgres-oauth-refresh',
        'postgres-oauth-refresh-key'
      ),
      /postgres old OAuth secret revoke failed/
    );
    const restarted = new IntegrationApplicationService({
      douyin,
      repository: new PostgresIntegrationRepository(pool),
      secrets,
    });
    const recovered = await restarted.refreshDouyinOAuth(
      context,
      'postgres-oauth-refresh',
      'postgres-oauth-refresh-key'
    );
    assert.equal(recovered.credential.version, 2);
    assert.equal(douyin.refreshEffectCount(), 1);

    const raw = await pool.query(
      `SELECT row_to_json(c)::text AS value
         FROM integration_connections c WHERE workspace_id = $1
       UNION ALL
       SELECT row_to_json(v)::text AS value
         FROM integration_credential_versions v WHERE workspace_id = $1
       UNION ALL
       SELECT row_to_json(i)::text AS value
         FROM integration_idempotency i WHERE workspace_id = $1
       UNION ALL
       SELECT row_to_json(o)::text AS value
         FROM douyin_oauth_refresh_operations o WHERE workspace_id = $1`,
      [workspaceId]
    );
    const serialized = JSON.stringify(raw.rows);
    assert.equal(serialized.includes('postgres-access-v1-never-persist'), false);
    assert.equal(serialized.includes('postgres-refresh-v1-never-persist'), false);
    assert.equal(serialized.includes('postgres-access-v2-never-persist'), false);
    assert.equal(serialized.includes('postgres-refresh-v2-never-persist'), false);
  }
);
