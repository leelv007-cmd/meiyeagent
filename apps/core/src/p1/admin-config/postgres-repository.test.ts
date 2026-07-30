import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Pool } from 'pg';
import { P1DomainError } from '../foundation/domain.js';
import {
  AdminConfigBoundedExecutionLimitsResolver,
  AdminConfigBoundedExecutionLimitsSource,
  BOUNDED_EXECUTION_LIVE_CALIBRATION_CONFIG_KEY,
  ISSUE_255_LIVE_CALIBRATION_TEMPLATE,
} from './bounded-execution-limits.js';
import { AdminConfigFoundationModule } from './foundation-module.js';
import { PostgresAdminConfigRepository } from './postgres-repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe(
  'Postgres admin config repository',
  { skip: databaseUrl ? false : 'TEST_DATABASE_URL is not configured' },
  () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const repository = new PostgresAdminConfigRepository(pool);
    const workspaceId = `workspace-${randomUUID()}`;

    before(async () => repository.migrate());

    after(async () => {
      await repository.deleteScopeForTest('workspace', workspaceId);
      await repository.deleteScopeForTest('global', '__global__');
      await pool.end();
    });

    it('persists live calibration for hot-read bounded admission', async () => {
      const module = new AdminConfigFoundationModule(repository);
      await module.execute({
        context: {
          actor: 'admin',
          correlationId: 'issue-255-live-calibration-pg',
          userId: 'platform-admin',
          workspaceId: '__global__',
        },
        input: {
          action: 'config_apply',
          payload: {
            expectedRevision: null,
            key: BOUNDED_EXECUTION_LIVE_CALIBRATION_CONFIG_KEY,
            reason: 'Apply the durable Issue 255 decision',
            value: {
              ...ISSUE_255_LIVE_CALIBRATION_TEMPLATE,
              anchors: {
                copy: {
                  ...ISSUE_255_LIVE_CALIBRATION_TEMPLATE.anchors.copy,
                  wallClockMs: 10_000,
                  wallClockEvidenceRef: 'live://issue-255/copy/test-decision',
                },
                image: {
                  ...ISSUE_255_LIVE_CALIBRATION_TEMPLATE.anchors.image,
                  wallClockMs: 20_000,
                  wallClockEvidenceRef: 'live://issue-255/image/test-decision',
                },
                video: {
                  ...ISSUE_255_LIVE_CALIBRATION_TEMPLATE.anchors.video,
                  actualAmountMicros: 1_000_000,
                  wallClockMs: 30_000,
                  costEvidenceRef: 'live://issue-255/video/test-decision',
                  wallClockEvidenceRef: 'live://issue-255/video/test-decision',
                },
              },
            },
          },
        },
      });

      const resolver = new AdminConfigBoundedExecutionLimitsResolver(
        new AdminConfigBoundedExecutionLimitsSource(
          new PostgresAdminConfigRepository(pool),
        ),
      );
      assert.deepEqual(await resolver.resolve(), {
        maxIterations: 2,
        maxCostCents: 213,
        maxWallClockMs: 90_000,
        maxDelegations: 'unset',
        requiredLimits: [
          'maxIterations',
          'maxCostCents',
          'maxWallClockMs',
        ],
      });
    });

    it('restores the value, version and audit after the repository is recreated', async () => {
      await repository.apply({
        scope: 'workspace',
        workspaceId,
        key: 'workspace.test.setting',
        value: { enabled: true },
        expectedRevision: null,
        actorId: 'owner-a',
        reason: 'Persist the workspace setting',
        correlationId: 'workspace-config-1',
      });

      const restartedRepository = new PostgresAdminConfigRepository(pool);
      const restored = await restartedRepository.get(
        'workspace',
        workspaceId,
        'workspace.test.setting',
      );

      assert.deepEqual(restored, {
        scope: 'workspace',
        workspaceId,
        key: 'workspace.test.setting',
        value: { enabled: true },
        revision: 1,
        status: 'applied',
        rolledBackToRevision: null,
        actorId: 'owner-a',
        reason: 'Persist the workspace setting',
        correlationId: 'workspace-config-1',
        createdAt: restored?.createdAt,
      });
      assert.equal(
        Number.isFinite(Date.parse(restored?.createdAt ?? '')),
        true,
      );
    });

    it('allows only one admin to advance a shared stale head', async () => {
      const key = 'workspace.test.concurrent';
      await repository.apply({
        scope: 'workspace',
        workspaceId,
        key,
        value: 'initial',
        expectedRevision: null,
        actorId: 'admin-a',
        reason: 'Create the head',
        correlationId: 'cas-initial',
      });

      const results = await Promise.allSettled(
        ['candidate-a', 'candidate-b'].map((value) =>
          repository.apply({
            scope: 'workspace',
            workspaceId,
            key,
            value,
            expectedRevision: 1,
            actorId: value,
            reason: 'Concurrent update',
            correlationId: value,
          }),
        ),
      );

      assert.equal(
        results.filter((result) => result.status === 'fulfilled').length,
        1,
      );
      const rejected = results.find((result) => result.status === 'rejected');
      assert.ok(
        rejected?.status === 'rejected' &&
          rejected.reason instanceof P1DomainError &&
          rejected.reason.code === 'IDEMPOTENCY_CONFLICT',
      );
      assert.deepEqual(
        (await repository.history('workspace', workspaceId, key)).map(
          (revision) => revision.revision,
        ),
        [1, 2],
      );
    });

    it('appends rollback evidence and leaves earlier values unchanged', async () => {
      const key = 'workspace.test.rollback';
      await repository.apply({
        scope: 'workspace',
        workspaceId,
        key,
        value: false,
        expectedRevision: null,
        actorId: 'admin-a',
        reason: 'Initial default',
        correlationId: 'rollback-v1',
      });
      await repository.apply({
        scope: 'workspace',
        workspaceId,
        key,
        value: true,
        expectedRevision: 1,
        actorId: 'admin-b',
        reason: 'Enable default',
        correlationId: 'rollback-v2',
      });
      await repository.rollback({
        scope: 'workspace',
        workspaceId,
        key,
        targetRevision: 1,
        expectedRevision: 2,
        actorId: 'admin-c',
        reason: 'Restore initial default',
        correlationId: 'rollback-v3',
      });

      const restored = await new PostgresAdminConfigRepository(pool).history(
        'workspace',
        workspaceId,
        key,
      );
      assert.deepEqual(
        restored.map((revision) => ({
          revision: revision.revision,
          value: revision.value,
          status: revision.status,
          rolledBackToRevision: revision.rolledBackToRevision,
          actorId: revision.actorId,
          correlationId: revision.correlationId,
        })),
        [
          {
            revision: 1,
            value: false,
            status: 'applied',
            rolledBackToRevision: null,
            actorId: 'admin-a',
            correlationId: 'rollback-v1',
          },
          {
            revision: 2,
            value: true,
            status: 'applied',
            rolledBackToRevision: null,
            actorId: 'admin-b',
            correlationId: 'rollback-v2',
          },
          {
            revision: 3,
            value: false,
            status: 'rolled_back',
            rolledBackToRevision: 1,
            actorId: 'admin-c',
            correlationId: 'rollback-v3',
          },
        ],
      );
    });
  },
);
