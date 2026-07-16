import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  CommandResult,
  ProductCommand,
  ProductContext,
  ProductState,
} from '@meiye/contracts';
import {
  CutoverProductService,
  type ProductWriteOwnerReader,
} from './cutover-product-service.js';
import {
  DomainError,
  ProductService,
  type PreparedProductVideoRender,
  type ProductApplicationService,
} from './product-service.js';
import { MemoryProductRepository } from './repository.js';
import type { LegacyInFlightDecision } from './legacy-inflight-decision.js';

function service(name: string, calls: string[]): ProductApplicationService {
  return {
    async bootstrap() {
      calls.push(`${name}:bootstrap`);
      return { workspaceId: name } as ProductState;
    },
    async execute() {
      calls.push(`${name}:execute`);
      return { output: {}, state: { workspaceId: name } } as CommandResult;
    },
    async prepareVideoRender() {
      calls.push(`${name}:prepareVideoRender`);
      return {} as PreparedProductVideoRender;
    },
  };
}

const userContext: ProductContext = {
  actor: 'user',
  correlationId: 'corr-router',
  userId: 'user-router',
  workspaceId: 'workspace-router',
};

describe('cutover-aware product application service', () => {
  it('routes legacy and frozen owners to the legacy service and P1 owner to relational service', async () => {
    const calls: string[] = [];
    let owner: 'legacy' | 'frozen' | 'p1' = 'legacy';
    const ownership: ProductWriteOwnerReader = {
      async getFutureWriteOwner() {
        return owner;
      },
    };
    const router = new CutoverProductService(
      ownership,
      service('legacy', calls),
      service('p1', calls)
    );
    const command: ProductCommand = { hidden: true, type: 'hide_example' };

    await router.execute(userContext, command, 'legacy-command');
    owner = 'frozen';
    await router.execute(userContext, command, 'frozen-command');
    owner = 'p1';
    await router.execute(userContext, command, 'p1-command');

    assert.deepEqual(calls, [
      'legacy:execute',
      'legacy:execute',
      'p1:execute',
    ]);
  });

  it('routes a new P1 worker job and render read to the relational service', async () => {
    const calls: string[] = [];
    const router = new CutoverProductService(
      { async getFutureWriteOwner() { return 'p1'; } },
      service('legacy', calls),
      service('p1', calls)
    );

    await router.execute(
      { ...userContext, actor: 'worker' },
      {
        jobId: 'legacy-job',
        leaseSeconds: 30,
        type: 'claim_video',
        workerId: 'worker-a',
      },
      'worker-command'
    );
    await router.prepareVideoRender(
      { ...userContext, actor: 'worker' },
      'legacy-job'
    );

    assert.deepEqual(calls, ['p1:execute', 'p1:prepareVideoRender']);
  });

  it('routes legacy drain to legacy and new-owner recovery to relational', async () => {
    const calls: string[] = [];
    const decisions = new Map<string, LegacyInFlightDecision>([
      ['legacy-drain', decision('legacy-drain', 'legacy_drain')],
      ['legacy-recovery', decision('legacy-recovery', 'new_owner_recovery')],
    ]);
    const router = new CutoverProductService(
      { async getFutureWriteOwner() { return 'p1'; } },
      service('legacy', calls),
      service('p1', calls),
      {
        async get(_workspaceId, jobId) {
          return decisions.get(jobId) ?? null;
        },
      }
    );

    for (const jobId of ['legacy-drain', 'legacy-recovery']) {
      await router.execute(
        { ...userContext, actor: 'worker' },
        { jobId, leaseSeconds: 30, type: 'claim_video', workerId: 'worker-a' },
        `worker:${jobId}`
      );
      await router.prepareVideoRender(
        { ...userContext, actor: 'worker' },
        jobId
      );
    }

    assert.deepEqual(calls, [
      'legacy:execute',
      'legacy:prepareVideoRender',
      'p1:execute',
      'p1:prepareVideoRender',
    ]);
  });

  it('retries once on an ownership race and never executes the command on both stores', async () => {
    const calls: string[] = [];
    let reads = 0;
    const ownership: ProductWriteOwnerReader = {
      async getFutureWriteOwner() {
        reads += 1;
        return reads === 1 ? 'legacy' : 'p1';
      },
    };
    const legacy = service('legacy', calls);
    legacy.execute = async () => {
      calls.push('legacy:rejected-before-write');
      throw new DomainError(
        'LEGACY_WRITE_DISABLED',
        'P1 became owner before the legacy transaction acquired its lock.',
        409
      );
    };
    const router = new CutoverProductService(
      ownership,
      legacy,
      service('p1', calls)
    );

    const result = await router.execute(
      userContext,
      { hidden: true, type: 'hide_example' },
      'racing-command'
    );

    assert.equal(result.state.workspaceId, 'p1');
    assert.deepEqual(calls, ['legacy:rejected-before-write', 'p1:execute']);
    assert.equal(reads, 2);
  });

  it('keeps an accepted command on its original owner after future-entry rollback', async () => {
    const calls: string[] = [];
    const router = new CutoverProductService(
      {
        async getCommandOwner(_workspaceId, idempotencyKey) {
          return idempotencyKey === 'accepted-by-p1' ? 'p1' : null;
        },
        async getFutureWriteOwner() {
          return 'legacy';
        },
      },
      service('legacy', calls),
      service('p1', calls)
    );

    await router.execute(
      userContext,
      { hidden: true, type: 'hide_example' },
      'accepted-by-p1'
    );
    await router.execute(
      userContext,
      { hidden: true, type: 'hide_example' },
      'new-after-rollback'
    );

    assert.deepEqual(calls, ['p1:execute', 'legacy:execute']);
  });

  it('lets P1 render new jobs but forbids regeneration for legacy recovery', async () => {
    const repository = new MemoryProductRepository();
    repository.grantMembership(userContext.userId, userContext.workspaceId);
    repository.setFutureWriteOwner(userContext.workspaceId, 'p1');
    const seed = new ProductService(repository);
    const state = await seed.bootstrap(userContext);
    const createdAt = '2026-07-11T00:00:00.000Z';
    state.assets.push({
      aigcStatus: 'not_ai',
      authorizationStatus: 'authorized',
      consentScope: 'public_marketing',
      containsPerson: false,
      containsSensitiveData: false,
      createdAt,
      id: 'asset-render',
      mediaType: 'image',
      minorStatus: 'none',
      objectKey: `${userContext.workspaceId}/assets/render.jpg`,
      replacementRequired: false,
      rightsOwner: '测试门店',
      sourceType: 'real',
      tags: [],
    });
    state.storyboards.push({
      confirmedAt: createdAt,
      contentId: 'content-render',
      id: 'storyboard-render',
      shots: [
        {
          complianceStatus: 'clear',
          durationSeconds: 3,
          id: 'shot-render',
          narration: '真实素材',
          purpose: '展示',
          sourceAssetId: 'asset-render',
          stage: 'attention',
          visualDirection: '近景',
        },
      ],
      status: 'confirmed',
      version: 1,
    });
    state.videoJobs.push({
      agentRunId: 'agent-render',
      artifactShellId: 'shell-render',
      committedSteps: [],
      correlationId: userContext.correlationId,
      createdAt,
      id: 'job-render',
      qualityRetryCount: 0,
      reservationId: 'reservation-render',
      status: 'queued',
      step: '等待渲染',
      storyboardId: 'storyboard-render',
      updatedAt: createdAt,
    });
    await repository.save(state);
    const p1 = new ProductService(
      repository,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'p1'
    );

    const prepared = await p1.prepareVideoRender(
      { ...userContext, actor: 'worker' },
      'job-render'
    );
    assert.equal(prepared.job.id, 'job-render');

    const recovery = new ProductService(
      repository,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        async get(_workspaceId, jobId) {
          return decision(jobId, 'new_owner_recovery');
        },
      },
      'p1'
    );
    await assert.rejects(
      recovery.prepareVideoRender(
        { ...userContext, actor: 'worker' },
        'job-render'
      ),
      (error: unknown) =>
        error instanceof DomainError &&
        error.code === 'LEGACY_REGENERATION_FORBIDDEN'
    );
  });
});

function decision(
  jobId: string,
  value: LegacyInFlightDecision['decision']
): LegacyInFlightDecision {
  return {
    allowRegeneration: false,
    decision: value,
    jobId,
    owner: value === 'legacy_drain' ? 'legacy' : 'p1',
    preserveOriginalTaskRef: true,
    reason: 'cutover test',
    status: 'queued',
  };
}
