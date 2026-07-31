import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { PostgresModelSupplyRepository } from '../model-supply/postgres-repository.js';
import { PostgresProductRepository } from '../../product/postgres-repository.js';
import { PostgresOperationsRepository } from './postgres-repository.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'real migration CLI verifies an isolated Postgres restore and rolls back only its active run',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const pool = new Pool({ connectionString });
    const workspaceId = `content-package-cli-${randomUUID()}`;
    const runId = `inspect-${randomUUID()}`;
    const assetStorageDirectory = await mkdtemp(
      join(tmpdir(), 'content-package-cli-assets-')
    );
    const videoBytes = new TextEncoder().encode('12345678');
    const videoSha256 = createHash('sha256').update(videoBytes).digest('hex');
    const videoObjectKey = `${workspaceId}/composed/${videoSha256}.mp4`;
    const videoPath = join(assetStorageDirectory, videoObjectKey);
    await mkdir(dirname(videoPath), { recursive: true });
    await writeFile(videoPath, videoBytes);
    await pool.query(
      `INSERT INTO workspaces (id, name)
       VALUES ($1, 'ContentPackage CLI integration')`,
      [workspaceId]
    );
    await new PostgresOperationsRepository(pool).migrate();
    await new PostgresModelSupplyRepository(pool).migrate();
    // The CLI reads legacy product_states; app boot owns this table, so a
    // provisioned-but-never-booted database does not have it.
    await new PostgresProductRepository(pool).migrate();
    await pool.query(
      `INSERT INTO p1_creative_contents (workspace_id, id, payload, updated_at)
       VALUES ($1, 'legacy-creative', $2::jsonb, now())`,
      [
        workspaceId,
        JSON.stringify({
          assetIds: [],
          body: 'Legacy body',
          createdAt: '2026-07-17T00:00:00.000Z',
          id: 'legacy-creative',
          jobId: 'legacy-job',
          status: 'accepted',
          title: 'Legacy title',
          workId: 'legacy-work',
          workspaceId,
        }),
      ]
    );
    await pool.query(
      `INSERT INTO model_video_workflows (
         workspace_id, workflow_id, workflow, updated_at
       ) VALUES ($1, 'legacy-video', $2::jsonb, now())`,
      [
        workspaceId,
        JSON.stringify({
          composedAsset: {
            contentType: 'video/mp4',
            id: 'legacy-video-asset',
            objectKey: videoObjectKey,
            sha256: videoSha256,
            sizeBytes: videoBytes.byteLength,
          },
          createdAt: '2026-07-17T00:00:00.000Z',
          id: 'legacy-video',
          status: 'completed',
          updatedAt: '2026-07-17T00:01:00.000Z',
          workspaceId,
        }),
      ]
    );
    t.after(async () => {
      await pool.query(
        'DELETE FROM content_package_migration_runs WHERE workspace_id = $1',
        [workspaceId]
      );
      await pool.query(
        'DELETE FROM content_package_write_ownership WHERE workspace_id = $1',
        [workspaceId]
      );
      await pool.query(
        'DELETE FROM p1_creative_contents WHERE workspace_id = $1',
        [workspaceId]
      );
      await pool.query(
        'DELETE FROM model_video_workflows WHERE workspace_id = $1',
        [workspaceId]
      );
      await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
      await pool.end();
      await rm(assetStorageDirectory, { force: true, recursive: true });
    });

    const runCli = (
      action:
        | 'activate'
        | 'backfill'
        | 'dry-run'
        | 'freeze'
        | 'inspect'
        | 'rollback',
      requestedRunId = runId
    ) =>
      spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          fileURLToPath(
            new URL('./content-package-migration-cli-entry.ts', import.meta.url)
          ),
          action,
          requestedRunId,
        ],
        {
          cwd: fileURLToPath(new URL('../../../', import.meta.url)),
          encoding: 'utf8',
          env: {
            ...process.env,
            CONTENTPACKAGE_CUTOVER_ADMIN_ID: 'content-package-cli-admin',
            CONTENTPACKAGE_CUTOVER_CORRELATION_ID: runId,
            CONTENTPACKAGE_CUTOVER_WORKSPACE_ID: workspaceId,
            DATABASE_URL: connectionString,
            P1_ASSET_STORAGE_DIR: assetStorageDirectory,
          },
          timeout: 10_000,
        }
      );

    const result = runCli('inspect');

    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout) as {
      expectedPackages: number;
      runId: string;
      workspaceId: string;
    };
    assert.equal(report.workspaceId, workspaceId);
    assert.equal(report.runId, runId);
    assert.equal(report.expectedPackages, 2);

    const dryRun = runCli('dry-run');
    assert.equal(dryRun.status, 0, dryRun.stderr);
    const freeze = runCli('freeze');
    assert.equal(freeze.status, 0, freeze.stderr);
    assert.equal(
      (JSON.parse(freeze.stdout) as { backupVerified: boolean }).backupVerified,
      true
    );
    const backfill = runCli('backfill');
    assert.equal(backfill.status, 0, backfill.stderr);
    const activate = runCli('activate');
    assert.equal(activate.status, 0, activate.stderr);

    const arbitraryRollback = runCli('rollback', `arbitrary-${randomUUID()}`);
    assert.equal(arbitraryRollback.status, 1);
    assert.match(arbitraryRollback.stderr, /current active migration run/);
    const rollback = runCli('rollback');
    assert.equal(rollback.status, 0, rollback.stderr);
    assert.equal(
      (JSON.parse(rollback.stdout) as { stage: string }).stage,
      'rolled_back'
    );
  }
);
