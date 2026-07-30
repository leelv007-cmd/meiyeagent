#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BOUNDED_EXECUTION_LIVE_CALIBRATION_CONFIG_KEY,
  boundedExecutionLiveCalibrationConfigSchema,
} from '../../apps/core/src/p1/admin-config/bounded-execution-limits.js';
import { PostgresAdminConfigRepository } from '../../apps/core/src/p1/admin-config/postgres-repository.js';

const GLOBAL_WORKSPACE_ID = '__global__';

// Applying the finalized live calibration is a deliberate operator action:
// require the explicit flag so a stray invocation cannot rewrite the anchors.
if (process.env.RUN_ISSUE_247_LIVE_CALIBRATION_APPLY !== 'true') {
  throw new Error(
    'Live calibration apply requires RUN_ISSUE_247_LIVE_CALIBRATION_APPLY=true.',
  );
}

const payloadPath = process.argv[2];
if (!payloadPath) {
  throw new Error(
    'Usage: apply-issue-247-live-calibration.mts <calibration.json>',
  );
}
const value = boundedExecutionLiveCalibrationConfigSchema.parse(
  JSON.parse(readFileSync(payloadPath, 'utf8')),
);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.trim()) {
  throw new Error('Live calibration apply requires DATABASE_URL.');
}

const here = dirname(fileURLToPath(import.meta.url));
const coreRoot = resolve(here, '../../apps/core');
const requireFromCore = createRequire(resolve(coreRoot, 'package.json'));
const { Pool } = requireFromCore('pg') as typeof import('pg');
const pool = new Pool({ connectionString: databaseUrl });
try {
  const repository = new PostgresAdminConfigRepository(pool);
  await repository.migrate();
  const current = await repository.get(
    'global',
    GLOBAL_WORKSPACE_ID,
    BOUNDED_EXECUTION_LIVE_CALIBRATION_CONFIG_KEY,
  );
  const applied = await repository.apply({
    actorId: 'issue-247-live-calibration-operator',
    correlationId: 'issue-247-live-calibration-2026-07-31',
    expectedRevision: current?.revision ?? null,
    key: BOUNDED_EXECUTION_LIVE_CALIBRATION_CONFIG_KEY,
    scope: 'global',
    reason:
      'Apply finalized Issue 255 live calibration: three live cost/wall-clock anchors plus observed iterations from issue255_live_generation_receipts (references/evidence/issue-247/live-calibration-2026-07-31.json).',
    value,
    workspaceId: GLOBAL_WORKSPACE_ID,
  });
  process.stdout.write(
    `Live calibration applied at revision ${applied.revision} (previous: ${current?.revision ?? 'none'}).\n`,
  );
} finally {
  await pool.end();
}
