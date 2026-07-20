/**
 * Apply Pro Studio / advanced canvas schema to a provisioned business test DB.
 *
 * Used by scripts/ci/provision-test-db.sh after App Shell Drizzle migrations so
 * CI persistence jobs have advanced_canvas_projects (and related) tables.
 *
 * Usage:
 *   DATABASE_URL=<business-url> pnpm exec tsx scripts/ci/apply-pro-studio-schema.mts
 *   pnpm exec tsx scripts/ci/apply-pro-studio-schema.mts <business-url>
 */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const coreRoot = resolve(repoRoot, 'apps/core');

// Resolve runtime deps from @meiye/core so this script can live under scripts/ci.
const requireFromCore = createRequire(resolve(coreRoot, 'package.json'));
const { Pool } = requireFromCore('pg') as typeof import('pg');

const { migrateProStudioSchema } = await import(
  pathToFileURL(
    resolve(coreRoot, 'src/pro-studio/postgres-pro-studio-migration.ts'),
  ).href
);
const { migrateProStudioWorkspaceState } = await import(
  pathToFileURL(
    resolve(coreRoot, 'src/pro-studio-runtime/postgres-workspace-state.ts'),
  ).href
);

const databaseUrl =
  process.argv[2] ?? process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.error(
    'Usage: DATABASE_URL=<business-url> tsx scripts/ci/apply-pro-studio-schema.mts',
  );
  process.exit(64);
}

const pool = new Pool({ connectionString: databaseUrl });
try {
  // Defensive: App Shell drizzle already creates workspaces, but pro-studio
  // migrations FK to it — ensure the target exists on partial/fresh DBs.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id text PRIMARY KEY,
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await migrateProStudioSchema(pool);
  await migrateProStudioWorkspaceState(pool);
  console.log('Pro Studio / advanced canvas schema applied.');
} finally {
  await pool.end();
}
