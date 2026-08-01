import type { Pool, PoolClient } from 'pg';

// Keep this key stable so independently deployed API and worker processes wait
// on the same database-scoped migration lock across releases.
export const CORE_SCHEMA_MIGRATION_LOCK_ID = '5570743275655394899';

export interface PostgresSchemaMigrator {
  migrate(client: PoolClient): Promise<void>;
}

// Runtime recovery must not touch business tables while another process holds
// the matching transaction-scoped lock for schema migration.
export async function runIfPostgresSchemaStable(
  pool: Pool,
  iteration: () => Promise<void>,
): Promise<boolean> {
  const client = await pool.connect();
  let acquired = false;
  try {
    const result = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
      [CORE_SCHEMA_MIGRATION_LOCK_ID],
    );
    acquired = result.rows[0]?.acquired === true;
    if (!acquired) return false;
    await iteration();
    return true;
  } finally {
    try {
      if (acquired) {
        await client.query('SELECT pg_advisory_unlock($1::bigint)', [
          CORE_SCHEMA_MIGRATION_LOCK_ID,
        ]);
      }
    } finally {
      client.release();
    }
  }
}

export async function migratePostgresSchema(
  pool: Pool,
  migrators: readonly PostgresSchemaMigrator[]
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [
      CORE_SCHEMA_MIGRATION_LOCK_ID,
    ]);
    for (const migrator of migrators) await migrator.migrate(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
