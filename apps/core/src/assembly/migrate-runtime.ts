import { assembleCoreGraph } from './core-assembly.js';

/**
 * Deploy migration job: run the production migrator registry once per release.
 * API/worker replicas verify schema and must not execute DDL.
 */
export async function startMigrate(env: NodeJS.ProcessEnv) {
  const { pool, schemaBootMode } = await assembleCoreGraph(env, {
    role: 'migrate',
  });
  if (schemaBootMode !== 'migrate') {
    await pool.end();
    throw new Error('Migration job must run schema boot in migrate mode.');
  }
  await pool.end();
  console.log('meiye-core production schema migration completed');
}
