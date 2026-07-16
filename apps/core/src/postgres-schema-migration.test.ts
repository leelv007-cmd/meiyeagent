import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool, type PoolClient } from 'pg';
import {
  PostgresTracerJobRepository,
  type TransactionalJobPort,
} from './p1/job-runtime/tracer-worker.js';
import { PostgresOperationsRepository } from './p1/operations/index.js';
import { migratePostgresSchema } from './postgres-schema-migration.js';

const connectionString = process.env.TEST_DATABASE_URL;

test('operations migration keeps all DDL on the supplied transaction client', async () => {
  const queries: string[] = [];
  const client = {
    async query(sql: string) {
      queries.push(sql);
      return { rows: [] };
    },
  } as unknown as PoolClient;
  const pool = {
    async query() {
      throw new Error('migration escaped the supplied transaction client');
    },
  } as unknown as Pool;

  await new PostgresOperationsRepository(pool).migrate(client);

  const migration = queries.join('\n');
  assert.match(migration, /payload - 'workId' - 'workRevisionId'/);
  assert.match(migration, /'kind', 'layout_work'/);
  assert.match(migration, /p1_canvas_image_jobs_origin_created_idx/);
  assert.doesNotMatch(
    migration,
    /CREATE INDEX IF NOT EXISTS p1_canvas_image_jobs_work_created_idx/
  );
  assert.match(queries.at(-1) ?? '', /p1_search_documents_trgm_idx/);
});

test(
  'operations migration backfills legacy canvas image origins idempotently',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const pool = new Pool({ connectionString });
    const workspaceId = `canvas-origin-${randomUUID()}`;
    t.after(async () => {
      await pool.query(
        'DELETE FROM p1_canvas_image_jobs WHERE workspace_id = $1',
        [workspaceId]
      );
      await pool.end();
    });
    const repository = new PostgresOperationsRepository(pool);
    await repository.migrate();
    await pool.query(
      `INSERT INTO p1_canvas_image_jobs
       (workspace_id, id, payload, updated_at)
       VALUES ($1, $2, $3::jsonb, now())`,
      [
        workspaceId,
        'legacy-canvas-image-job',
        JSON.stringify({
          createdAt: '2026-07-16T00:00:00.000Z',
          id: 'legacy-canvas-image-job',
          status: 'queued',
          workId: 'legacy-layout-work',
          workRevisionId: 'legacy-layout-revision',
        }),
      ]
    );

    await repository.migrate();
    await repository.migrate();

    const result = await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM p1_canvas_image_jobs
       WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, 'legacy-canvas-image-job']
    );
    assert.deepEqual(result.rows[0]?.payload.origin, {
      id: 'legacy-layout-work',
      kind: 'layout_work',
      revisionId: 'legacy-layout-revision',
    });
    assert.equal('workId' in (result.rows[0]?.payload ?? {}), false);
    assert.equal('workRevisionId' in (result.rows[0]?.payload ?? {}), false);
  }
);

test(
  'concurrent process initializers serialize destructive DDL and leave the schema ready',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const suffix = randomUUID().replaceAll('-', '');
    const table = `p1_schema_lock_${suffix}`;
    const constraint = `${table}_status_check`;
    const apiPool = new Pool({ connectionString });
    const workerPool = new Pool({ connectionString });
    const queue: TransactionalJobPort = {
      async cancel() {},
      async enqueue() {},
      async enqueueInTransaction() {},
    };
    const apiRepository = new PostgresTracerJobRepository(apiPool, queue, {
      table,
    });
    const workerRepository = new PostgresTracerJobRepository(
      workerPool,
      queue,
      { table }
    );

    t.after(async () => {
      await apiPool.query(`DROP TABLE IF EXISTS "${table}"`);
      await Promise.all([apiPool.end(), workerPool.end()]);
    });

    const initialize = (
      pool: Pool,
      repository: PostgresTracerJobRepository
    ) =>
      migratePostgresSchema(pool, [
        {
          async migrate(client) {
            await client.query('SELECT pg_sleep(0.05)');
          },
        },
        repository,
      ]);

    await Promise.all([
      initialize(apiPool, apiRepository),
      initialize(workerPool, workerRepository),
    ]);

    const constraints = await apiPool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM pg_constraint
        WHERE conrelid = $1::regclass
          AND conname = $2`,
      [`"${table}"`, constraint]
    );
    assert.equal(constraints.rows[0]?.count, '1');
    const columns = await apiPool.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = $1`,
      [table]
    );
    assert.ok(columns.rows.some(({ column_name }) => column_name === 'lease_token'));
  }
);
