import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import { PostgresOperationsRepository } from './postgres-repository.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'V31-19 migration maps only authoritative exact revisions and quarantines unknown legacy rows',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const workspaceId = `workspace-signal-migration-${randomUUID()}`;
    const id = `package-${randomUUID()}`;
    const repository = new PostgresOperationsRepository(pool);
    try {
      await repository.migrate();
      await pool.query(
        'ALTER TABLE p1_content_packages DROP CONSTRAINT p1_content_packages_result_signal_revision_required',
      );
      const legacyPayload = {
        id,
        revision: 5,
        resultSignals: [
          {
            id: 'signal-a',
            kind: 'inquiry',
            occurredAt: '2026-08-01T00:00:00.000Z',
          },
          {
            id: 'signal-b',
            kind: 'store_visit',
            occurredAt: '2026-08-02T00:00:00.000Z',
            contentPackageRevision: 4,
          },
          {
            id: 'signal-c',
            kind: 'appointment',
            occurredAt: '2026-08-03T00:00:00.000Z',
            contentPackageRevision: '4',
          },
        ],
      };
      await pool.query(
        `INSERT INTO p1_content_packages (workspace_id, id, payload, revision, updated_at)
         VALUES ($1, $2, $3::jsonb, 5, now())`,
        [workspaceId, id, JSON.stringify(legacyPayload)],
      );
      await pool.query(
        `INSERT INTO p1_operations_audit_events (workspace_id, id, payload, updated_at)
         VALUES ($1, $2, $3::jsonb, now())`,
        [
          workspaceId,
          `audit-${randomUUID()}`,
          JSON.stringify({
            action: 'content_package.result_signal_recorded',
            actorId: 'legacy-actor',
            correlationId: 'legacy-correlation',
            createdAt: '2026-08-01T00:00:01.000Z',
            details: { contentPackageRevision: 2, signalId: 'signal-a' },
            entityId: id,
            entityType: 'content_package',
            id: `audit-payload-${randomUUID()}`,
            workspaceId,
          }),
        ],
      );

      await repository.migrate();
      const result = await pool.query<{
        payload: {
          resultSignals: Array<{
            contentPackageRevision: number | 'unknown';
          }>;
        };
        xmin: string;
      }>(
        'SELECT payload, xmin::text AS xmin FROM p1_content_packages WHERE workspace_id = $1 AND id = $2',
        [workspaceId, id]
      );
      assert.deepEqual(
        result.rows[0]?.payload.resultSignals.map(
          (row) => row.contentPackageRevision
        ),
        [2, 4, 'unknown']
      );
      assert.equal(result.rows[0]?.payload.resultSignals.length, 3);
      const repairedXmin = result.rows[0]?.xmin;
      await repository.migrate();
      const replay = await pool.query<{ xmin: string }>(
        'SELECT xmin::text AS xmin FROM p1_content_packages WHERE workspace_id = $1 AND id = $2',
        [workspaceId, id]
      );
      assert.equal(replay.rows[0]?.xmin, repairedXmin);

      await assert.rejects(
        pool.query(
          `UPDATE p1_content_packages
           SET payload = jsonb_set(payload, '{resultSignals,0}', (payload->'resultSignals'->0) - 'contentPackageRevision')
           WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, id],
        ),
        /p1_content_packages_result_signal_revision_required/u,
      );
      await pool.query(
        `UPDATE p1_content_packages
         SET payload = jsonb_set(payload, '{resultSignals,1,contentPackageRevision}', '"unknown"'::jsonb)
         WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, id],
      );
    } finally {
      await pool
        .query('DELETE FROM p1_content_packages WHERE workspace_id = $1', [
          workspaceId,
        ])
        .catch(() => undefined);
      await pool
        .query(
          'DELETE FROM p1_operations_audit_events WHERE workspace_id = $1',
          [workspaceId]
        )
        .catch(() => undefined);
      await pool.end();
    }
  },
);
