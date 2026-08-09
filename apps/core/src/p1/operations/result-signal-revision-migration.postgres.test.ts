import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import { PostgresOperationsRepository } from './postgres-repository.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'V31-19 migration backfills exact signal revisions once and rejects canonical rows without them',
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
          { id: 'signal-a', kind: 'inquiry', occurredAt: '2026-08-01T00:00:00.000Z' },
          { id: 'signal-b', kind: 'store_visit', occurredAt: '2026-08-02T00:00:00.000Z' },
        ],
      };
      await pool.query(
        `INSERT INTO p1_content_packages (workspace_id, id, payload, revision, updated_at)
         VALUES ($1, $2, $3::jsonb, 5, now())`,
        [workspaceId, id, JSON.stringify(legacyPayload)],
      );

      await repository.migrate();
      await repository.migrate();
      const result = await pool.query<{ payload: { resultSignals: Array<{ contentPackageRevision: number }> } }>(
        'SELECT payload FROM p1_content_packages WHERE workspace_id = $1 AND id = $2',
        [workspaceId, id],
      );
      assert.deepEqual(
        result.rows[0]?.payload.resultSignals.map((row) => row.contentPackageRevision),
        [3, 4],
      );
      assert.equal(result.rows[0]?.payload.resultSignals.length, 2);

      await assert.rejects(
        pool.query(
          `UPDATE p1_content_packages
           SET payload = jsonb_set(payload, '{resultSignals,0}', (payload->'resultSignals'->0) - 'contentPackageRevision')
           WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, id],
        ),
        /p1_content_packages_result_signal_revision_required/u,
      );
    } finally {
      await pool.query('DELETE FROM p1_content_packages WHERE workspace_id = $1', [workspaceId]).catch(() => undefined);
      await pool.end();
    }
  },
);
