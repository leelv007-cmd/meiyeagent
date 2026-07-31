import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import {
  DouyinOAuthLifecycleBatchRunner,
  FakeKmsSecretStore,
  IntegrationApplicationService,
  PostgresIntegrationRepository,
  RecordedDouyinAdapter,
  type SecretContext,
} from './index.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'Postgres Douyin OAuth lifecycle resumes an active refresh after service restart',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    class RevokeOldSecretOnce extends FakeKmsSecretStore {
      private failed = false;

      override async revoke(secretRef: string, context: SecretContext) {
        if (context.version === 1 && !this.failed) {
          this.failed = true;
          throw new Error('recorded old-secret revoke failure');
        }
        return super.revoke(secretRef, context);
      }
    }

    const pool = new Pool({ connectionString });
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const workspaceId = `douyin-oauth-lifecycle-${suffix}`;
    const connectionId = `douyin-${suffix}`;
    const repository = new PostgresIntegrationRepository(pool);
    const secrets = new RevokeOldSecretOnce();
    const douyin = new RecordedDouyinAdapter();
    await repository.migrate();
    t.after(async () => {
      await repository.deleteWorkspaceFacts(workspaceId);
      await pool.end();
    });
    douyin.setNextRefreshResult({
      accessExpiresAt: '2026-08-01T00:00:00.000Z',
      accessToken: `access-v2-${suffix}`,
      refreshExpiresAt: '2026-09-01T00:00:00.000Z',
      refreshToken: `refresh-v2-${suffix}`,
      scopes: ['video.create.bind'],
      status: 'ok',
    });
    const owner = {
      correlationId: `create-${suffix}`,
      role: 'owner' as const,
      userId: `owner-${suffix}`,
      workspaceId,
    };
    const application = (currentRepository: PostgresIntegrationRepository) =>
      new IntegrationApplicationService({
        douyin,
        repository: currentRepository,
        secrets,
      });
    await application(repository).createConnection(
      owner,
      {
        credential: {
          expiresAt: '2026-07-11T12:04:00.000Z',
          refreshExpiresAt: '2026-07-30T00:00:00.000Z',
          scope: ['video.create.bind'],
          value: JSON.stringify({
            accessToken: `access-v1-${suffix}`,
            refreshToken: `refresh-v1-${suffix}`,
          }),
        },
        grantedCapabilities: [],
        id: connectionId,
        identityMode: 'oauth_user',
        provider: 'douyin',
        requestedCapabilities: ['publish'],
        subject: `open-id-${suffix}`,
      },
      `create-${suffix}`
    );
    const worker = {
      correlationId: `worker-${suffix}`,
      role: 'worker' as const,
      userId: 'douyin-oauth-lifecycle-worker',
      workspaceId: '__system__',
    };
    const at = '2026-07-11T12:00:00.000Z';

    const failed = await new DouyinOAuthLifecycleBatchRunner(
      repository,
      application(repository)
    ).run(worker, at);
    const restartedRepository = new PostgresIntegrationRepository(pool);
    const recovered = await new DouyinOAuthLifecycleBatchRunner(
      restartedRepository,
      application(restartedRepository)
    ).run(worker, at);
    const replayed = await new DouyinOAuthLifecycleBatchRunner(
      new PostgresIntegrationRepository(pool),
      application(new PostgresIntegrationRepository(pool))
    ).run(worker, at);

    assert.equal(failed.failedConnectionCount, 1);
    assert.deepEqual(recovered, {
      failedConnectionCount: 0,
      notDueCount: 0,
      reauthorizationRequiredCount: 0,
      refreshedCount: 1,
      targetCount: 1,
    });
    assert.equal(replayed.notDueCount, 1);
    assert.equal(douyin.refreshEffectCount(), 1);
    const targets =
      await restartedRepository.listDouyinOAuthLifecycleTargets();
    assert.equal(targets[0]?.credentialVersion, 2);
    assert.equal(JSON.stringify(targets).includes('secret'), false);
    assert.equal(JSON.stringify(targets).includes('token'), false);
  }
);
