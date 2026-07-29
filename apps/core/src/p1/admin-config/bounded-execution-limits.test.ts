import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';

import { MemoryAdminConfigRepository } from './foundation-module.js';
import {
  AdminConfigBoundedExecutionLimitsSource,
  BOUNDED_EXECUTION_LIMITS_CONFIG_KEY,
} from './bounded-execution-limits.js';

const testLimitsSchema = z
  .object({
    maxIterations: z.union([z.number().int().positive(), z.literal('unset')]),
    maxCostCents: z.union([z.number().int().positive(), z.literal('unset')]),
    maxWallClockMs: z.union([
      z.number().int().positive(),
      z.literal('unset'),
    ]),
    maxDelegations: z.union([
      z.number().int().nonnegative(),
      z.literal('unset'),
    ]),
  })
  .strict();

test('bounded-execution limits source keeps missing explicit and returns the current admin-config revision', async () => {
  const repository = new MemoryAdminConfigRepository();
  const source = new AdminConfigBoundedExecutionLimitsSource(
    repository,
    testLimitsSchema,
  );

  assert.deepEqual(await source.read(), { source: 'missing' });

  await repository.apply({
    actorId: 'admin-1',
    correlationId: 'bounds-1',
    expectedRevision: null,
    key: BOUNDED_EXECUTION_LIMITS_CONFIG_KEY,
    scope: 'global',
    reason: 'Initial calibrated bounds',
    value: {
      maxIterations: 5,
      maxCostCents: 500,
      maxWallClockMs: 60_000,
      maxDelegations: 'unset',
    },
    workspaceId: '__global__',
  });

  assert.deepEqual(await source.read(), {
    source: 'admin_config',
    revision: 1,
    limits: {
      maxIterations: 5,
      maxCostCents: 500,
      maxWallClockMs: 60_000,
      maxDelegations: 'unset',
    },
  });
});
