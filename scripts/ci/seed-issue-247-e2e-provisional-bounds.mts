#!/usr/bin/env node

import { isDeepStrictEqual } from 'node:util';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BOUNDED_EXECUTION_LIMITS_CONFIG_KEY,
  ISSUE_247_RECORDED_PROVISIONAL_LIMITS,
} from '../../apps/core/src/p1/admin-config/bounded-execution-limits.js';
import type { AdminConfigRepository } from '../../apps/core/src/p1/admin-config/foundation-module.js';
import { PostgresAdminConfigRepository } from '../../apps/core/src/p1/admin-config/postgres-repository.js';

const GLOBAL_WORKSPACE_ID = '__global__';

export function assertIssue247E2eProvisionalSeedEnabled(
  environment: NodeJS.ProcessEnv,
) {
  if (
    environment.APP_ENV !== 'e2e' ||
    environment.RUN_ISSUE_247_E2E_PROVISIONAL_BOUNDS_SEED !== 'true'
  ) {
    throw new Error(
      'Issue 247 provisional bounds require APP_ENV=e2e and RUN_ISSUE_247_E2E_PROVISIONAL_BOUNDS_SEED=true.',
    );
  }
}

export async function seedIssue247E2eProvisionalBounds(
  repository: Pick<AdminConfigRepository, 'apply' | 'get'>,
) {
  const current = await repository.get(
    'global',
    GLOBAL_WORKSPACE_ID,
    BOUNDED_EXECUTION_LIMITS_CONFIG_KEY,
  );
  if (
    current &&
    isDeepStrictEqual(
      current.value,
      ISSUE_247_RECORDED_PROVISIONAL_LIMITS,
    )
  ) {
    return current;
  }
  return repository.apply({
    actorId: 'issue-247-e2e-provisioner',
    correlationId: 'issue-247-e2e-provisional-bounds',
    expectedRevision: current?.revision ?? null,
    key: BOUNDED_EXECUTION_LIMITS_CONFIG_KEY,
    scope: 'global',
    reason: 'Seed Issue 247 recorded provisional E2E bounds',
    value: ISSUE_247_RECORDED_PROVISIONAL_LIMITS,
    workspaceId: GLOBAL_WORKSPACE_ID,
  });
}

async function main() {
  assertIssue247E2eProvisionalSeedEnabled(process.env);
  const databaseUrl = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (!databaseUrl?.trim()) {
    throw new Error(
      'Issue 247 provisional bounds require DATABASE_URL or TEST_DATABASE_URL.',
    );
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const coreRoot = resolve(here, '../../apps/core');
  const requireFromCore = createRequire(resolve(coreRoot, 'package.json'));
  const { Pool } = requireFromCore('pg') as typeof import('pg');
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const repository = new PostgresAdminConfigRepository(pool);
    await repository.migrate();
    const revision = await seedIssue247E2eProvisionalBounds(repository);
    process.stdout.write(
      `Issue 247 provisional E2E bounds are ready at revision ${revision.revision}.\n`,
    );
  } finally {
    await pool.end();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
