import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  DurableJobEnvelope,
  JobRuntimeHandlerContext,
  RecurringJobInput,
} from '../job-runtime/index.js';
import {
  DOUYIN_OAUTH_LIFECYCLE_JOB_KIND,
  DOUYIN_OAUTH_LIFECYCLE_SCHEDULE_ID,
  DouyinOAuthLifecycleBatchRunner,
  createDouyinOAuthLifecycleJobHandler,
  registerDouyinOAuthLifecycleSchedule,
  type DouyinOAuthLifecycleApplicationPort,
} from './douyin-oauth-lifecycle.js';
import {
  FakeKmsSecretStore,
  IntegrationApplicationService,
  MemoryIntegrationRepository,
  RecordedDouyinAdapter,
  type IntegrationConnection,
} from './index.js';

const workerContext = {
  correlationId: 'oauth-lifecycle-worker',
  role: 'worker' as const,
  userId: 'douyin-oauth-lifecycle-worker',
  workspaceId: '__system__',
};

describe('Douyin OAuth lifecycle job', () => {
  it('skips terminal reauthorization but keeps a disabled connection with an active saga recoverable', async () => {
    const repository = new MemoryIntegrationRepository();
    await repository.saveConnection({
      ...connection('workspace-a', 'douyin-reauthorize'),
      status: 'reauthorize_required',
    });
    await repository.saveConnection({
      ...connection('workspace-a', 'douyin-active-saga'),
      status: 'disabled',
    });
    await repository.claimDouyinOAuthRefresh({
      connectionId: 'douyin-active-saga',
      createdAt: '2026-07-11T12:00:00.000Z',
      effectIdempotencyKey: 'effect-active-saga',
      id: 'refresh-active-saga',
      payloadHash: 'payload-active-saga',
      phase: 'claimed',
      sourceCredentialId: 'credential-douyin-active-saga',
      sourceCredentialVersion: 1,
      sourceSecretRef: 'recorded://active-saga',
      subject: 'open-id-douyin-active-saga',
      updatedAt: '2026-07-11T12:00:00.000Z',
      workspaceId: 'workspace-a',
    });

    assert.deepEqual(await repository.listDouyinOAuthLifecycleTargets(), [
      {
        connectionId: 'douyin-active-saga',
        credentialVersion: 1,
        expiresAt: '2026-07-11T12:04:00.000Z',
        workspaceId: 'workspace-a',
      },
    ]);
  });

  it('isolates one connection failure and asks the durable runtime to retry', async () => {
    const repository = new MemoryIntegrationRepository();
    await repository.saveConnection(connection('workspace-a', 'douyin-a'));
    await repository.saveConnection(connection('workspace-b', 'douyin-b'));
    const application: DouyinOAuthLifecycleApplicationPort = {
      async runDouyinOAuthLifecycle(context, connectionId) {
        if (connectionId === 'douyin-b') throw new Error('recorded failure');
        return {
          connectionId,
          credentialVersion: 2,
          expiresAt: '2026-08-01T00:00:00.000Z',
          status: 'refreshed',
        };
      },
    };
    const runner = new DouyinOAuthLifecycleBatchRunner(
      repository,
      application
    );
    const handler = createDouyinOAuthLifecycleJobHandler(runner);
    const envelope: DurableJobEnvelope = {
      enqueuedAt: '2026-07-11T12:00:00.000Z',
      fingerprint: 'fixture',
      jobId: DOUYIN_OAUTH_LIFECYCLE_SCHEDULE_ID,
      kind: DOUYIN_OAUTH_LIFECYCLE_JOB_KIND,
      payload: {},
      workspaceId: '__system__',
    };
    const worker: JobRuntimeHandlerContext = {
      attempt: 1,
      claimedAt: '2026-07-11T12:00:01.000Z',
      recovered: false,
      renewLease: async () => undefined,
      transportId: 'transport-1',
    };

    const result = await handler(envelope, worker);

    assert.equal(result.status, 'retry');
    assert.deepEqual(result.output, {
      failedConnectionCount: 1,
      notDueCount: 0,
      reauthorizationRequiredCount: 0,
      refreshedCount: 1,
      targetCount: 2,
    });
    assert.equal(
      (await repository.listAudits('workspace-b'))[0]?.action,
      'douyin.oauth_lifecycle_failed'
    );
  });

  it('replays a recorded refresh after service restart without a second provider effect', async () => {
    const repository = new MemoryIntegrationRepository();
    const secrets = new FakeKmsSecretStore();
    const douyin = new RecordedDouyinAdapter();
    douyin.setNextRefreshResult({
      accessExpiresAt: '2026-08-01T00:00:00.000Z',
      accessToken: 'access-v2',
      refreshExpiresAt: '2026-09-01T00:00:00.000Z',
      refreshToken: 'refresh-v2',
      scopes: ['video.create.bind'],
      status: 'ok',
    });
    const owner = {
      correlationId: 'create-oauth-lifecycle',
      role: 'owner' as const,
      userId: 'owner-a',
      workspaceId: 'workspace-a',
    };
    const application = () =>
      new IntegrationApplicationService({ douyin, repository, secrets });
    await application().createConnection(
      owner,
      {
        credential: {
          expiresAt: '2026-07-11T12:04:00.000Z',
          refreshExpiresAt: '2026-07-30T00:00:00.000Z',
          scope: ['video.create.bind'],
          value: JSON.stringify({
            accessToken: 'access-v1',
            refreshToken: 'refresh-v1',
          }),
        },
        grantedCapabilities: [],
        id: 'douyin-restart',
        identityMode: 'oauth_user',
        provider: 'douyin',
        requestedCapabilities: ['publish'],
        subject: 'open-id-a',
      },
      'create-douyin-restart'
    );
    const at = '2026-07-11T12:00:00.000Z';

    const first = await new DouyinOAuthLifecycleBatchRunner(
      repository,
      application()
    ).run(workerContext, at);
    const replayed = await new DouyinOAuthLifecycleBatchRunner(
      repository,
      application()
    ).run(workerContext, at);

    assert.equal(first.refreshedCount, 1);
    assert.equal(replayed.notDueCount, 1);
    assert.equal(replayed.failedConnectionCount, 0);
    assert.equal(douyin.refreshEffectCount(), 1);
    const targets = await repository.listDouyinOAuthLifecycleTargets();
    assert.equal(JSON.stringify(targets).includes('secret'), false);
    assert.equal(targets[0]?.credentialVersion, 2);
  });

  it('uses one stable recurring schedule identity across API restarts', async () => {
    const scheduled: RecurringJobInput[] = [];
    const runtime = {
      async scheduleRecurring(input: RecurringJobInput) {
        scheduled.push(structuredClone(input));
      },
    };

    await registerDouyinOAuthLifecycleSchedule(runtime);
    await registerDouyinOAuthLifecycleSchedule(runtime);

    assert.deepEqual(scheduled[0], scheduled[1]);
    assert.deepEqual(scheduled[0], {
      cron: '*/2 * * * *',
      kind: DOUYIN_OAUTH_LIFECYCLE_JOB_KIND,
      payload: {},
      scheduleId: DOUYIN_OAUTH_LIFECYCLE_SCHEDULE_ID,
      timezone: 'Asia/Shanghai',
      workspaceId: '__system__',
    });
  });
});

function connection(
  workspaceId: string,
  id: string
): IntegrationConnection {
  return {
    capabilityEvidence: {},
    createdAt: '2026-07-11T00:00:00.000Z',
    credential: {
      expiresAt: '2026-07-11T12:04:00.000Z',
      id: `credential-${id}`,
      mask: '••••••••',
      scope: ['video.create.bind'],
      status: 'active',
      version: 1,
    },
    degradedCapabilities: {},
    grantedCapabilities: [],
    id,
    identityMode: 'oauth_user',
    provider: 'douyin',
    requestedCapabilities: ['publish'],
    secretRef: `recorded://${workspaceId}/${id}`,
    status: 'available',
    subject: `open-id-${id}`,
    updatedAt: '2026-07-11T00:00:00.000Z',
    workspaceId,
  };
}
