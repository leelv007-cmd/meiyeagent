import type { Pool } from 'pg';
import { isProtectedAppEnv } from '../runtime-truth/readiness.js';
import {
  migratePostgresSchema,
  type PostgresSchemaMigrator,
} from '../postgres-schema-migration.js';

export type SchemaBootMode = 'migrate' | 'verify';
export type SchemaBootRole = 'api' | 'worker' | 'migrate';

export interface SchemaQueryable {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: unknown[] }>;
}

/**
 * Critical relations that must exist after the deploy migration job.
 * Matches the production readiness schema probe markers.
 */
export const PRODUCTION_SCHEMA_RELATIONS = [
  'public.p1_worker_metric_samples',
  'public.p1_owned_assets',
] as const;

export function isLocalSupervisor(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CORE_LOCAL_SUPERVISOR === '1';
}

/**
 * Production API/worker replicas verify schema only.
 * The deploy `migrate` job always migrates.
 * Only the local supervisor may auto-migrate (under the existing advisory lock).
 */
export function resolveSchemaBootMode(
  env: NodeJS.ProcessEnv,
  role: SchemaBootRole,
): SchemaBootMode {
  if (role === 'migrate') return 'migrate';
  if (isProtectedAppEnv(env)) return 'verify';
  if (isLocalSupervisor(env)) return 'migrate';
  return 'verify';
}

export async function verifyPostgresSchema(
  pool: SchemaQueryable,
  relations: readonly string[] = PRODUCTION_SCHEMA_RELATIONS,
): Promise<void> {
  const missing: string[] = [];
  for (const relation of relations) {
    const result = await pool.query('SELECT to_regclass($1) AS reg', [relation]);
    const row = result.rows[0] as { reg: string | null } | undefined;
    if (!row?.reg) missing.push(relation);
  }
  if (missing.length > 0) {
    throw new Error(`schema mismatch: missing ${missing.join(', ')}`);
  }
}

export async function applySchemaBoot(options: {
  mode: SchemaBootMode;
  pool: SchemaQueryable;
  migrators: readonly PostgresSchemaMigrator[];
  relations?: readonly string[];
  verify?: (pool: SchemaQueryable) => Promise<void>;
}): Promise<void> {
  if (options.mode === 'migrate') {
    await migratePostgresSchema(options.pool as Pool, options.migrators);
    return;
  }
  if (options.verify) {
    await options.verify(options.pool);
    return;
  }
  await verifyPostgresSchema(
    options.pool,
    options.relations ?? PRODUCTION_SCHEMA_RELATIONS,
  );
}
