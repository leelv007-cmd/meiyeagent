import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HarnessExecutionBoundsAdmissionError,
  HarnessTaskAdmissionService,
  type HarnessTaskRequestRegistry,
  type HarnessWorkflowStarter,
} from '../harness/task-admission.js';
import {
  AdminConfigBoundedExecutionLimitsResolver,
  AdminConfigBoundedExecutionLimitsSource,
  BOUNDED_EXECUTION_LIVE_CALIBRATION_CONFIG_KEY,
  ISSUE_255_LIVE_CALIBRATION_TEMPLATE,
} from './bounded-execution-limits.js';
import {
  AdminConfigFoundationModule,
  MemoryAdminConfigRepository,
} from './foundation-module.js';

test('issue 255 live calibration reaches task admission through admin-config', async () => {
  const repository = new MemoryAdminConfigRepository();
  await applyCalibration(repository, completedCalibration());
  const starter = new RecordingStarter();
  const service = new HarnessTaskAdmissionService(
    new CreatingRegistry(),
    starter,
    undefined,
    undefined,
    new AdminConfigBoundedExecutionLimitsResolver(
      new AdminConfigBoundedExecutionLimitsSource(repository),
    ),
  );

  assert.deepEqual(await service.submit(taskRequest()), {
    workflowId: 'task-live-calibration',
    replayed: false,
  });
  assert.deepEqual(starter.requests[0]?.boundedExecution, {
    schemaVersion: 'bounded-execution-snapshot/v1',
    maxIterations: 2,
    maxCostCents: 213,
    maxWallClockMs: 90_000,
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
});

test('issue 255 live calibration keeps every missing production gate fail-closed', async () => {
  const complete = completedCalibration();
  const cases = [
    {
      limit: 'maxIterations' as const,
      value: {
        ...complete,
        policy: { ...complete.policy, observedMaxIterations: 'unset' as const },
      },
    },
    {
      limit: 'maxCostCents' as const,
      value: {
        ...complete,
        anchors: {
          ...complete.anchors,
          video: {
            ...complete.anchors.video,
            actualAmountMicros: 'unset' as const,
          },
        },
      },
    },
    {
      limit: 'maxWallClockMs' as const,
      value: {
        ...complete,
        anchors: {
          ...complete.anchors,
          video: {
            ...complete.anchors.video,
            wallClockMs: 'unset' as const,
          },
        },
      },
    },
  ];

  for (const scenario of cases) {
    const repository = new MemoryAdminConfigRepository();
    await applyCalibration(repository, scenario.value);
    const starter = new RecordingStarter();
    const service = new HarnessTaskAdmissionService(
      new CreatingRegistry(),
      starter,
      undefined,
      undefined,
      new AdminConfigBoundedExecutionLimitsResolver(
        new AdminConfigBoundedExecutionLimitsSource(repository),
      ),
    );

    await assert.rejects(
      service.submit(taskRequest()),
      (error: unknown) =>
        error instanceof HarnessExecutionBoundsAdmissionError &&
        error.status === 503 &&
        error.limit === scenario.limit,
    );
    assert.equal(starter.requests.length, 0);
  }
});

test('issue 255 live calibration admits only an explicitly authorized unbounded axis', async () => {
  const repository = new MemoryAdminConfigRepository();
  const complete = completedCalibration();
  await applyCalibration(repository, {
    ...complete,
    anchors: {
      ...complete.anchors,
      video: {
        ...complete.anchors.video,
        actualAmountMicros: 'unset',
        costEvidenceRef: undefined,
      },
    },
    policy: {
      ...complete.policy,
      cost: {
        mode: 'deliberately_unbounded',
        authorization: {
          owner: 'product-owner',
          reason: 'The reviewed policy intentionally carries no task cost ceiling.',
          recordedAt: '2026-07-30T00:00:00.000Z',
        },
      },
    },
  });
  const starter = new RecordingStarter();
  const service = new HarnessTaskAdmissionService(
    new CreatingRegistry(),
    starter,
    undefined,
    undefined,
    new AdminConfigBoundedExecutionLimitsResolver(
      new AdminConfigBoundedExecutionLimitsSource(repository),
    ),
  );

  await service.submit(taskRequest());
  assert.equal(starter.requests[0]?.boundedExecution?.maxCostCents, 'unset');
  assert.deepEqual(starter.requests[0]?.boundedExecution?.requiredLimits, [
    'maxIterations',
    'maxWallClockMs',
  ]);
});

function completedCalibration() {
  return {
    ...ISSUE_255_LIVE_CALIBRATION_TEMPLATE,
    anchors: {
      copy: {
        ...ISSUE_255_LIVE_CALIBRATION_TEMPLATE.anchors.copy,
        wallClockMs: 10_000,
        wallClockEvidenceRef: 'live://issue-255/copy/test-decision',
      },
      image: {
        ...ISSUE_255_LIVE_CALIBRATION_TEMPLATE.anchors.image,
        wallClockMs: 20_000,
        wallClockEvidenceRef: 'live://issue-255/image/test-decision',
      },
      video: {
        ...ISSUE_255_LIVE_CALIBRATION_TEMPLATE.anchors.video,
        actualAmountMicros: 1_000_000,
        wallClockMs: 30_000,
        costEvidenceRef: 'live://issue-255/video/test-decision',
        wallClockEvidenceRef: 'live://issue-255/video/test-decision',
      },
    },
  };
}

async function applyCalibration(
  repository: MemoryAdminConfigRepository,
  value: unknown,
) {
  const module = new AdminConfigFoundationModule(repository);
  await module.execute({
    context: {
      actor: 'admin',
      correlationId: 'issue-255-live-calibration',
      userId: 'platform-admin',
      workspaceId: '__global__',
    },
    input: {
      action: 'config_apply',
      payload: {
        expectedRevision: null,
        key: BOUNDED_EXECUTION_LIVE_CALIBRATION_CONFIG_KEY,
        reason: 'Apply Issue 255 live calibration decision',
        value,
      },
    },
  });
}

class CreatingRegistry implements HarnessTaskRequestRegistry {
  async claim() {
    return { kind: 'created' as const };
  }
}

class RecordingStarter implements HarnessWorkflowStarter {
  readonly requests: Parameters<HarnessWorkflowStarter['start']>[0]['request'][] =
    [];

  async start(input: Parameters<HarnessWorkflowStarter['start']>[0]) {
    this.requests.push(input.request);
    return { workflowId: input.workflowId };
  }
}

function taskRequest() {
  return {
    taskId: 'task-live-calibration',
    actorId: 'operator-1',
    workspaceId: 'workspace-1',
    packageId: 'package-1',
    expectedRevision: 0,
    workflowRevision: 1,
    creationMode: 'customized' as const,
    rawInput: '生成一套门店活动内容',
    intent: {
      context: {
        workId: 'work-1',
        intent: '生成一套门店活动内容',
        sourceSummaries: [],
      },
      assetReferences: [],
    },
  };
}
