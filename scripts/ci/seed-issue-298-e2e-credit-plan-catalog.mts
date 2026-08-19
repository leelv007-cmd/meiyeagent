#!/usr/bin/env node

import { isDeepStrictEqual } from 'node:util';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_CREDIT_PLAN_CATALOG } from '../../apps/core/src/p1/credit-billing/credit-plan-catalog.js';
import type { AdminConfigRepository } from '../../apps/core/src/p1/admin-config/foundation-module.js';
import { PostgresAdminConfigRepository } from '../../apps/core/src/p1/admin-config/postgres-repository.js';

const GLOBAL_WORKSPACE_ID = '__global__';

export function assertIssue298E2eCreditPlanSeedEnabled(
  environment: NodeJS.ProcessEnv,
) {
  if (
    environment.APP_ENV !== 'e2e' ||
    environment.RUN_ISSUE_298_E2E_CREDIT_PLAN_SEED !== 'true'
  ) {
    throw new Error(
      'Issue 298 credit plan seed requires APP_ENV=e2e and RUN_ISSUE_298_E2E_CREDIT_PLAN_SEED=true.',
    );
  }
}

export async function seedIssue298E2eCreditPlanCatalog(
  repository: Pick<AdminConfigRepository, 'apply' | 'get'>,
) {
  const values = [
    ...DEFAULT_CREDIT_PLAN_CATALOG.plans.map(({ id, ...plan }) => [
      `plan.credits.${id}`,
      plan,
    ] as const),
    ['plan.credits.addons', DEFAULT_CREDIT_PLAN_CATALOG.addOns] as const,
    [
      'plan.credits.cycle_coefficients',
      DEFAULT_CREDIT_PLAN_CATALOG.cycleCoefficientBasisPoints,
    ] as const,
    [
      'plan.credits.reference_numbers',
      DEFAULT_CREDIT_PLAN_CATALOG.referenceNumbers,
    ] as const,
    ['plan.credits.trial.enabled', DEFAULT_CREDIT_PLAN_CATALOG.trialEnabled] as const,
  ];

  for (const [key, value] of values) {
    const current = await repository.get('global', GLOBAL_WORKSPACE_ID, key);
    if (current && isDeepStrictEqual(current.value, value)) continue;
    await repository.apply({
      actorId: 'issue-298-e2e-provisioner',
      correlationId: `issue-298-e2e-credit-plan-${key}`,
      expectedRevision: current?.revision ?? null,
      key,
      scope: 'global',
      reason: 'Seed Issue 298 published credit plans for E2E',
      value,
      workspaceId: GLOBAL_WORKSPACE_ID,
    });
  }
}

async function main() {
  assertIssue298E2eCreditPlanSeedEnabled(process.env);
  const databaseUrl = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (!databaseUrl?.trim()) {
    throw new Error('Issue 298 credit plan seed requires DATABASE_URL or TEST_DATABASE_URL.');
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const coreRoot = resolve(here, '../../apps/core');
  const requireFromCore = createRequire(resolve(coreRoot, 'package.json'));
  const { Pool } = requireFromCore('pg') as typeof import('pg');
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const repository = new PostgresAdminConfigRepository(pool);
    await repository.migrate();
    await seedIssue298E2eCreditPlanCatalog(repository);
    process.stdout.write('Issue 298 published credit plan catalog is ready for E2E.\n');
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
