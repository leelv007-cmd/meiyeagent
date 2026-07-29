import assert from 'node:assert/strict';
import test from 'node:test';

import { boundedExecutionSnapshotSchema } from '@meiye/contracts';

import {
  AdminConfigBoundedExecutionContinuationResolver,
  AdminConfigBoundedExecutionLimitsResolver,
  AdminConfigBoundedExecutionLimitsSource,
  BOUNDED_EXECUTION_LIMITS_CONFIG_KEY,
  boundedExecutionLimitsConfigSchema,
} from './bounded-execution-limits.js';
import {
  AdminConfigFoundationModule,
  MemoryAdminConfigRepository,
} from './foundation-module.js';

const configuredLimits = boundedExecutionLimitsConfigSchema.parse({
  maxIterations: { default: 5, hardCap: 10 },
  maxCostCents: { default: 120, hardCap: 360 },
  maxWallClockMs: { default: 60_000, hardCap: 180_000 },
  maxDelegations: { default: 'unset', hardCap: 'unset' },
});

test('bounded-execution limits resolve calibrated defaults from the current admin-config revision', async () => {
  const repository = new MemoryAdminConfigRepository();
  const source = new AdminConfigBoundedExecutionLimitsSource(repository);
  const resolver = new AdminConfigBoundedExecutionLimitsResolver(source);

  assert.deepEqual(await source.read(), { source: 'missing' });
  assert.deepEqual(await resolver.resolve(), {
    maxIterations: 'unset',
    maxCostCents: 'unset',
    maxWallClockMs: 'unset',
    maxDelegations: 'unset',
    requiredLimits: [
      'maxIterations',
      'maxCostCents',
      'maxWallClockMs',
    ],
  });

  await repository.apply({
    actorId: 'admin-1',
    correlationId: 'bounds-1',
    expectedRevision: null,
    key: BOUNDED_EXECUTION_LIMITS_CONFIG_KEY,
    scope: 'global',
    reason: 'Apply calibrated bounds',
    value: configuredLimits,
    workspaceId: '__global__',
  });

  assert.deepEqual(await source.read(), {
    source: 'admin_config',
    revision: 1,
    config: configuredLimits,
  });
  assert.deepEqual(await resolver.resolve(), {
    maxIterations: 5,
    maxCostCents: 120,
    maxWallClockMs: 60_000,
    maxDelegations: 'unset',
    requiredLimits: [
      'maxIterations',
      'maxCostCents',
      'maxWallClockMs',
    ],
  });
});

test('bounded-execution config rejects defaults above hard caps and half-unset axes', () => {
  assert.equal(
    boundedExecutionLimitsConfigSchema.safeParse({
      ...configuredLimits,
      maxCostCents: { default: 361, hardCap: 360 },
    }).success,
    false,
  );
  assert.equal(
    boundedExecutionLimitsConfigSchema.safeParse({
      ...configuredLimits,
      maxDelegations: { default: 'unset', hardCap: 1 },
    }).success,
    false,
  );
});

test('platform admin applies calibrated bounds through the existing CAS and audit seam', async () => {
  const repository = new MemoryAdminConfigRepository();
  const module = new AdminConfigFoundationModule(repository);
  const applied = await module.execute({
    context: {
      actor: 'admin',
      correlationId: 'bounds-apply-1',
      userId: 'platform-admin',
      workspaceId: 'workspace-1',
    },
    input: {
      action: 'config_apply',
      payload: {
        expectedRevision: null,
        key: BOUNDED_EXECUTION_LIMITS_CONFIG_KEY,
        reason: 'Apply issue 255 calibration',
        value: configuredLimits,
      },
    },
  });

  assert.deepEqual(applied, {
    activationEvidenceStatus: null,
    actorId: 'platform-admin',
    correlationId: 'bounds-apply-1',
    createdAt: (applied as { createdAt: string }).createdAt,
    effectiveValue: null,
    key: BOUNDED_EXECUTION_LIMITS_CONFIG_KEY,
    reason: 'Apply issue 255 calibration',
    revision: 1,
    rolledBackToRevision: null,
    scope: 'global',
    status: 'applied',
    storedValue: configuredLimits,
    wired: false,
  });
  assert.equal(
    Number.isFinite(Date.parse((applied as { createdAt: string }).createdAt)),
    true,
  );
});

test('DBOS bounded continuation raises only the triggered axis by one calibrated default up to its hard cap', async () => {
  const repository = new MemoryAdminConfigRepository();
  await repository.apply({
    actorId: 'admin-1',
    correlationId: 'bounds-1',
    expectedRevision: null,
    key: BOUNDED_EXECUTION_LIMITS_CONFIG_KEY,
    scope: 'global',
    reason: 'Apply calibrated bounds',
    value: configuredLimits,
    workspaceId: '__global__',
  });
  const resolver = new AdminConfigBoundedExecutionContinuationResolver(
    new AdminConfigBoundedExecutionLimitsSource(repository),
  );
  const suspended = boundedExecutionSnapshotSchema.parse({
    schemaVersion: 'bounded-execution-snapshot/v1',
    maxIterations: 5,
    maxCostCents: 120,
    maxWallClockMs: 60_000,
    maxDelegations: 'unset',
    requiredLimits: [
      'maxIterations',
      'maxCostCents',
      'maxWallClockMs',
    ],
    consumption: {
      iterations: 5,
      costCents: 40,
      wallClockMs: 10_000,
      delegations: 0,
    },
    stopReason: 'limit_reached',
    triggeredLimit: 'maxIterations',
  });

  assert.deepEqual(
    await resolver.resolve({
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      request: {
        workspaceId: 'workspace-1',
      },
      suspension: { snapshot: suspended },
      command: {
        idempotencyKey: 'continue-1',
      },
    } as never),
    { limit: 'maxIterations', value: 10 },
  );

  await assert.rejects(
    resolver.resolve({
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      request: {
        workspaceId: 'workspace-1',
      },
      suspension: {
        snapshot: {
          ...suspended,
          maxIterations: 10,
          consumption: { ...suspended.consumption, iterations: 10 },
        },
      },
      command: {
        idempotencyKey: 'continue-2',
      },
    } as never),
    /hard cap/u,
  );
});
