import type { Pool, PoolClient } from 'pg';

// Keep this key stable so independently deployed API and worker processes wait
// on the same database-scoped migration lock across releases.
export const CORE_SCHEMA_MIGRATION_LOCK_ID = '5570743275655394899';

export interface PostgresSchemaMigrator {
  migrate(client: PoolClient): Promise<void>;
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
