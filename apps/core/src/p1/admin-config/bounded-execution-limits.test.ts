import assert from 'node:assert/strict';
import test from 'node:test';

import { boundedExecutionSnapshotSchema } from '@meiye/contracts';

import {
  AdminConfigBoundedExecutionContinuationResolver,
  AdminConfigBoundedExecutionLimitsResolver,
  AdminConfigBoundedExecutionLimitsSource,
  BOUNDED_EXECUTION_LIMITS_CONFIG_KEY,
  ISSUE_247_RECORDED_PROVISIONAL_LIMITS,
  ISSUE_255_RECORDED_CALIBRATION_LIMITS,
  boundedExecutionLimitsConfigSchema,
} from './bounded-execution-limits.js';
import {
  AdminConfigFoundationModule,
  MemoryAdminConfigRepository,
} from './foundation-module.js';
import {
  HarnessExecutionBoundsAdmissionError,
  HarnessTaskAdmissionService,
  type HarnessTaskRequestRegistry,
  type HarnessWorkflowStarter,
} from '../harness/task-admission.js';

const configuredLimits = ISSUE_255_RECORDED_CALIBRATION_LIMITS;

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
    maxIterations: 2,
    maxCostCents: 'unset',
    maxWallClockMs: 'unset',
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
      maxIterations: { default: 5, hardCap: 4 },
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

test('issue 247 provisional bounds preserve their recorded provenance outside the bounded snapshot', async () => {
  const repository = new MemoryAdminConfigRepository();
  await repository.apply({
    actorId: 'e2e-provisioner',
    correlationId: 'issue-247-e2e-bounds',
    expectedRevision: null,
    key: BOUNDED_EXECUTION_LIMITS_CONFIG_KEY,
    scope: 'global',
    reason: 'Seed Issue 247 provisional E2E bounds',
    value: ISSUE_247_RECORDED_PROVISIONAL_LIMITS,
    workspaceId: '__global__',
  });
  const source = new AdminConfigBoundedExecutionLimitsSource(repository);
  const resolver = new AdminConfigBoundedExecutionLimitsResolver(source);

  assert.deepEqual((await source.read()).config, {
    maxIterations: {
      default: 2,
      hardCap: 4,
      provenance: 'recorded_provisional',
    },
    maxCostCents: {
      default: 100,
      hardCap: 200,
      provenance: 'recorded_provisional',
    },
    maxWallClockMs: {
      default: 60_000,
      hardCap: 150_000,
      provenance: 'recorded_provisional',
    },
    maxDelegations: {
      default: 'unset',
      hardCap: 'unset',
      provenance: 'unset',
    },
  });
  assert.deepEqual(await resolver.resolve(), {
    maxIterations: 2,
    maxCostCents: 100,
    maxWallClockMs: 60_000,
    maxDelegations: 'unset',
    requiredLimits: [
      'maxIterations',
      'maxCostCents',
      'maxWallClockMs',
    ],
  });
});

test('production admission starts once with the provisional CAS values while missing and issue 255 config remain fail-closed', async () => {
  const configuredRepository = new MemoryAdminConfigRepository();
  await configuredRepository.apply({
    actorId: 'e2e-provisioner',
    correlationId: 'issue-247-e2e-bounds',
    expectedRevision: null,
    key: BOUNDED_EXECUTION_LIMITS_CONFIG_KEY,
    scope: 'global',
    reason: 'Seed Issue 247 provisional E2E bounds',
    value: ISSUE_247_RECORDED_PROVISIONAL_LIMITS,
    workspaceId: '__global__',
  });
  const configuredStarter = new RecordingHarnessStarter();
  const configuredService = new HarnessTaskAdmissionService(
    new CreatingHarnessRegistry(),
    configuredStarter,
    undefined,
    undefined,
    new AdminConfigBoundedExecutionLimitsResolver(
      new AdminConfigBoundedExecutionLimitsSource(configuredRepository),
    ),
  );

  assert.deepEqual(await configuredService.submit(harnessTaskRequest()), {
    workflowId: 'task-issue-247',
    replayed: false,
  });
  assert.equal(configuredStarter.requests.length, 1);
  assert.deepEqual(configuredStarter.requests[0]?.boundedExecution, {
    schemaVersion: 'bounded-execution-snapshot/v1',
    maxIterations: 2,
    maxCostCents: 100,
    maxWallClockMs: 60_000,
    maxDelegations: 'unset',
    requiredLimits: [
      'maxIterations',
      'maxCostCents',
      'maxWallClockMs',
    ],
    consumption: {
      iterations: 0,
      costCents: 0,
      wallClockMs: 0,
      delegations: 0,
    },
    stopReason: null,
    triggeredLimit: null,
  });
  assert.equal(
    'provenance' in configuredStarter.requests[0]!.boundedExecution!,
    false,
  );

  for (const value of [null, ISSUE_255_RECORDED_CALIBRATION_LIMITS]) {
    const repository = new MemoryAdminConfigRepository();
    if (value) {
      await repository.apply({
        actorId: 'admin-1',
        correlationId: 'issue-255-bounds',
        expectedRevision: null,
        key: BOUNDED_EXECUTION_LIMITS_CONFIG_KEY,
        scope: 'global',
        reason: 'Apply Issue 255 recorded calibration',
        value,
        workspaceId: '__global__',
      });
    }
    const starter = new RecordingHarnessStarter();
    const service = new HarnessTaskAdmissionService(
      new CreatingHarnessRegistry(),
      starter,
      undefined,
      undefined,
      new AdminConfigBoundedExecutionLimitsResolver(
        new AdminConfigBoundedExecutionLimitsSource(repository),
      ),
    );

    await assert.rejects(
      service.submit(harnessTaskRequest()),
      (error: unknown) =>
        error instanceof HarnessExecutionBoundsAdmissionError &&
        error.code === 'REQUIRED_EXECUTION_LIMIT_UNSET',
    );
    assert.equal(starter.requests.length, 0);
  }
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

test('DBOS bounded continuation capability is read-only and direct resolve stays guarded', async () => {
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
    maxIterations: 2,
    maxCostCents: 'unset',
    maxWallClockMs: 'unset',
    maxDelegations: 'unset',
    requiredLimits: [
      'maxIterations',
      'maxCostCents',
      'maxWallClockMs',
    ],
    consumption: {
      iterations: 2,
      costCents: 0,
      wallClockMs: 10_000,
      delegations: 0,
    },
    stopReason: 'limit_reached',
    triggeredLimit: 'maxIterations',
  });

  assert.deepEqual(
    await resolver.capability({
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      request: {
        workspaceId: 'workspace-1',
      },
      suspension: { snapshot: suspended },
    } as never),
    { kind: 'available' },
  );

  assert.deepEqual(
    await resolver.capability({
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      request: {
        workspaceId: 'workspace-1',
      },
      suspension: {
        snapshot: {
          ...suspended,
          maxIterations: 4,
          consumption: { ...suspended.consumption, iterations: 4 },
        },
      },
    } as never),
    { kind: 'unavailable', reason: 'hard_cap' },
  );

  await assert.rejects(
    resolver.resolve({
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      request: { workspaceId: 'workspace-1' },
      suspension: { snapshot: suspended },
      command: {
        idempotencyKey: 'continue-2',
      },
    } as never),
    /explicit workflow authorization seam/u,
  );
});

class CreatingHarnessRegistry implements HarnessTaskRequestRegistry {
  async claim() {
    return { kind: 'created' as const };
  }
}

class RecordingHarnessStarter implements HarnessWorkflowStarter {
  readonly requests: Array<
    Parameters<HarnessWorkflowStarter['start']>[0]['request']
  > = [];

  async start(input: Parameters<HarnessWorkflowStarter['start']>[0]) {
    this.requests.push(structuredClone(input.request));
    return { workflowId: input.workflowId };
  }
}

function harnessTaskRequest() {
  return {
    taskId: 'task-issue-247',
    actorId: 'owner-1',
    workspaceId: 'workspace-1',
    packageId: 'package-1',
    expectedRevision: 0,
    workflowRevision: 1,
    creationMode: 'customized' as const,
    rawInput: '生成一条门店活动文案',
    intent: {
      context: {
        workId: 'work-1',
        intent: '生成一条门店活动文案',
        sourceSummaries: [],
      },
      assetReferences: [],
    },
  };
}

test('a deliberately unbounded axis leaves the required set while an uncalibrated one keeps failing admission closed', async () => {
  const repository = new MemoryAdminConfigRepository();
  const source = new AdminConfigBoundedExecutionLimitsSource(repository);
  const resolver = new AdminConfigBoundedExecutionLimitsResolver(source);

  // Cost is signed off as having no ceiling; wall clock is simply not
  // calibrated yet. Both resolve to 'unset', so only provenance tells them
  // apart — which is exactly what this axis was added for.
  await repository.apply({
    actorId: 'admin-1',
    correlationId: 'bounds-unbounded-1',
    expectedRevision: null,
    key: BOUNDED_EXECUTION_LIMITS_CONFIG_KEY,
    scope: 'global',
    reason: 'Record the pre-live cost policy',
    value: {
      maxIterations: { default: 2, hardCap: 4 },
      maxCostCents: {
        default: 'unset',
        hardCap: 'unset',
        provenance: 'deliberately_unbounded',
        authorization: {
          owner: 'product-owner',
          reason:
            'The approved live envelope guards spend in the receipt path, not here.',
          recordedAt: '2026-07-30T00:00:00.000Z',
        },
      },
      maxWallClockMs: { default: 'unset', hardCap: 'unset' },
      maxDelegations: { default: 'unset', hardCap: 'unset' },
    },
    workspaceId: '__global__',
  });

  assert.deepEqual(await resolver.resolve(), {
    maxIterations: 2,
    maxCostCents: 'unset',
    maxWallClockMs: 'unset',
    maxDelegations: 'unset',
    requiredLimits: ['maxIterations', 'maxWallClockMs'],
  });

  const starter = new RecordingHarnessStarter();
  const service = new HarnessTaskAdmissionService(
    new CreatingHarnessRegistry(),
    starter,
    undefined,
    undefined,
    resolver
  );
  await assert.rejects(
    service.submit(harnessTaskRequest()),
    (error: unknown) =>
      error instanceof HarnessExecutionBoundsAdmissionError &&
      error.code === 'REQUIRED_EXECUTION_LIMIT_UNSET' &&
      error.limit === 'maxWallClockMs'
  );
  assert.equal(starter.requests.length, 0);
});

test('bounded-execution config keeps an unbounded authorization exact and exclusive', () => {
  const authorization = {
    owner: 'product-owner',
    reason: 'Signed pre-live policy',
    recordedAt: '2026-07-30T00:00:00.000Z',
  };

  // A ceiling and a declaration of "no ceiling" cannot both be true.
  assert.throws(() =>
    boundedExecutionLimitsConfigSchema.parse({
      maxIterations: {
        default: 2,
        hardCap: 4,
        provenance: 'deliberately_unbounded',
        authorization,
      },
      maxCostCents: { default: 'unset', hardCap: 'unset' },
      maxWallClockMs: { default: 'unset', hardCap: 'unset' },
      maxDelegations: { default: 'unset', hardCap: 'unset' },
    })
  );

  // Unbounded without a signature is just an uncalibrated axis wearing a label.
  assert.throws(() =>
    boundedExecutionLimitsConfigSchema.parse({
      maxIterations: { default: 2, hardCap: 4 },
      maxCostCents: {
        default: 'unset',
        hardCap: 'unset',
        provenance: 'deliberately_unbounded',
      },
      maxWallClockMs: { default: 'unset', hardCap: 'unset' },
      maxDelegations: { default: 'unset', hardCap: 'unset' },
    })
  );

  // A signature cannot be attached to anything else, so it never reads as
  // authorising a ceiling somebody merely guessed.
  assert.throws(() =>
    boundedExecutionLimitsConfigSchema.parse({
      maxIterations: {
        default: 2,
        hardCap: 4,
        provenance: 'recorded_provisional',
        authorization,
      },
      maxCostCents: { default: 'unset', hardCap: 'unset' },
      maxWallClockMs: { default: 'unset', hardCap: 'unset' },
      maxDelegations: { default: 'unset', hardCap: 'unset' },
    })
  );
});
