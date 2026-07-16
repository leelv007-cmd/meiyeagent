import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MemoryAdminConfigRepository } from '../admin-config/foundation-module.js';
import { P1ApplicationService as FoundationApplicationService } from '../foundation/application-service.js';
import type { P1Context } from '../foundation/domain.js';
import { MemoryFoundationRepository } from '../foundation/memory-repository.js';
import { MediaActivationProbeExecutor } from './activation-probe-executor.js';
import {
  createDefaultCatalogModels,
  createDefaultDeployments,
} from './catalog.js';
import {
  MemoryModelSupplyControlPlaneRepository,
  ModelSupplyControlPlaneService,
  ModelSupplyFoundationModule,
} from './foundation-module.js';
import {
  ModelSupplyApplicationService,
  RecordedProviderExecutionPort,
  type MediaProviderLifecyclePort,
} from './index.js';

const admin: P1Context = {
  correlationId: 'corr-ticket-21-canary',
  userId: 'admin-a',
  workspaceId: 'workspace-a',
};
const deploymentId = 'seedance-2-direct';

function providerCost() {
  return {
    amount: 0.25,
    currency: 'CNY' as const,
    usage: { mediaUnits: 1 },
  };
}

function createHarness(
  provider: MediaProviderLifecyclePort,
  options: {
    activationEvidenceConfig?: MemoryAdminConfigRepository;
    configurationRevision?: string;
    repository?: MemoryModelSupplyControlPlaneRepository;
  } = {}
) {
  const deployments = createDefaultDeployments();
  const models = createDefaultCatalogModels();
  const repository =
    options.repository ?? new MemoryModelSupplyControlPlaneRepository();
  const activationEvidenceConfig =
    options.activationEvidenceConfig ?? new MemoryAdminConfigRepository();
  const executor = new MediaActivationProbeExecutor(
    provider,
    { deployments, models },
    { pollIntervalMs: 0, sleep: async () => {} }
  );
  const application = new ModelSupplyApplicationService({
    deployments,
    execution: new RecordedProviderExecutionPort(),
    models,
    resultSink: repository,
  });
  const controlPlane = new ModelSupplyControlPlaneService({
    activationEvidenceConfig,
    activationProbeExecutor: executor,
    activationProbeLiveDeploymentIds: [deploymentId],
    application,
    configurationRevisions: {
      [deploymentId]: options.configurationRevision ?? 'a'.repeat(64),
    },
    repository,
  });
  return {
    activationEvidenceConfig,
    controlPlane,
    module: new ModelSupplyFoundationModule(controlPlane, {
      adminActorIds: [admin.userId],
    }),
    repository,
  };
}

function runProbe(module: ModelSupplyFoundationModule, idempotencyKey: string) {
  return module.execute({
    context: admin,
    idempotencyKey,
    input: {
      action: 'activation_probe_run',
      payload: { deploymentId, operation: 'video.generate' },
    },
  });
}

describe('Ticket 21 activation canary', () => {
  it('persists one non-billable canary, replays it, and marks old evidence stale', async () => {
    const providerCalls: string[] = [];
    const provider: MediaProviderLifecyclePort = {
      async submit(request) {
        providerCalls.push('submit');
        assert.equal(request.submission.productUsageQuantity, 0);
        return {
          acceptance: 'accepted',
          providerCost: providerCost(),
          taskRef: 'private-task-ref',
        };
      },
      async poll() {
        providerCalls.push('poll');
        return { providerCost: providerCost(), status: 'completed' };
      },
      async download() {
        providerCalls.push('download');
        return {
          bytes: Uint8Array.from([1, 2, 3]),
          contentType: 'video/mp4',
        };
      },
      async recover() {
        return null;
      },
      async cancel() {
        throw new Error('cancel is covered by the cancellation canary');
      },
    };
    const foundationRepository = new MemoryFoundationRepository();
    foundationRepository.grantOwner(admin.workspaceId, admin.userId);
    const foundation = new FoundationApplicationService(foundationRepository);
    const usageBefore = await foundation.getUsageProjection(admin, 'video');
    const harness = createHarness(provider);

    const first = (await runProbe(harness.module, 'ticket-21-canary')) as {
      id: string;
      outcome: string;
      outputDigest?: string;
      providerCost?: { usage: { mediaUnits?: number } };
    };
    const replay = await runProbe(harness.module, 'ticket-21-canary');

    assert.deepEqual(replay, first);
    assert.equal(first.outcome, 'passed');
    assert.match(first.outputDigest ?? '', /^[a-f0-9]{64}$/u);
    assert.equal(first.providerCost?.usage.mediaUnits, 1);
    assert.deepEqual(providerCalls, ['submit', 'poll', 'download']);
    assert.deepEqual(
      await foundation.getUsageProjection(admin, 'video'),
      usageBefore
    );
    assert.equal(
      (await harness.repository.listActivationProbeRuns(admin.workspaceId))
        .length,
      1
    );

    const current = await harness.controlPlane.activationStatus(
      admin.workspaceId
    );
    const currentDeployment = current.find(
      (candidate) => candidate.deploymentId === deploymentId
    );
    assert.equal(currentDeployment?.evidence?.evidenceRef, first.id);
    assert.equal(currentDeployment?.stale, false);

    const restarted = createHarness(provider, {
      activationEvidenceConfig: harness.activationEvidenceConfig,
      configurationRevision: 'b'.repeat(64),
      repository: harness.repository,
    });
    const afterConfigurationChange =
      await restarted.controlPlane.activationStatus(admin.workspaceId);
    assert.equal(
      afterConfigurationChange.find(
        (candidate) => candidate.deploymentId === deploymentId
      )?.stale,
      true
    );
  });

  it('persists classified failures without replacing the last successful evidence', async () => {
    let shouldFail = false;
    let submitCount = 0;
    const provider: MediaProviderLifecyclePort = {
      async submit() {
        submitCount += 1;
        if (shouldFail) {
          return {
            acceptance: 'rejected_before_accept',
            errorCode: 'quota_exhausted',
            providerCost: providerCost(),
            retryable: false,
          };
        }
        return {
          acceptance: 'accepted',
          providerCost: providerCost(),
          taskRef: 'private-task-ref',
        };
      },
      async poll() {
        return { providerCost: providerCost(), status: 'completed' };
      },
      async download() {
        return {
          bytes: Uint8Array.from([1, 2, 3]),
          contentType: 'video/mp4',
        };
      },
      async recover() {
        return null;
      },
      async cancel() {
        throw new Error('cancel is covered by the cancellation canary');
      },
    };
    const harness = createHarness(provider);
    const passed = (await runProbe(
      harness.module,
      'ticket-21-passed-canary'
    )) as { id: string; outcome: string };
    shouldFail = true;

    const failed = (await runProbe(
      harness.module,
      'ticket-21-failed-canary'
    )) as {
      failureCategory?: string;
      id: string;
      outcome: string;
      outputDigest?: string;
      providerCost?: {
        amount: number;
        status: string;
        usage: { mediaUnits?: number };
      };
    };
    const replay = await runProbe(harness.module, 'ticket-21-failed-canary');

    assert.equal(passed.outcome, 'passed');
    assert.equal(failed.outcome, 'failed');
    assert.equal(failed.failureCategory, 'submit:quota_exhausted');
    assert.equal(failed.outputDigest, undefined);
    assert.deepEqual(failed.providerCost, {
      amount: 0.25,
      currency: 'CNY',
      status: 'estimated',
      usage: { mediaUnits: 1 },
    });
    assert.deepEqual(replay, failed);
    assert.equal(submitCount, 2);
    const evidence = await harness.activationEvidenceConfig.get(
      'global',
      '__global__',
      `model.activation.evidence.${deploymentId}`
    );
    assert.equal(
      (evidence?.value as { evidenceRef?: string }).evidenceRef,
      passed.id
    );
    assert.equal(
      (await harness.repository.listActivationProbeRuns(admin.workspaceId))
        .length,
      2
    );
  });
});
