import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PermissionAuthorizerPort } from '../capability-permission/port.js';
import { P1ApplicationService } from './application-service.js';
import { P1DomainError } from './domain.js';
import { MemoryFoundationRepository } from './memory-repository.js';

const owner = {
  workspaceId: 'workspace-a',
  userId: 'owner-a',
  correlationId: 'corr-a',
  actor: 'owner' as const,
} as const;

/** Explicit no-op for seam tests that use unregistered probe modules. */
const allowAllAuthorizer: PermissionAuthorizerPort = {
  decide: () => ({ allow: true, required: null, reason: 'capability_granted' }),
  authorize: () => undefined,
};

function createService() {
  const repository = new MemoryFoundationRepository();
  repository.grantOwner(owner.workspaceId, owner.userId);
  return { repository, service: new P1ApplicationService(repository) };
}

describe('P1ApplicationService foundation seam', () => {
  it('records an owner-scoped relation fact idempotently and rejects cross-workspace reads', async () => {
    const { repository, service } = createService();
    repository.grantOwner('workspace-b', 'owner-b');

    const input = {
      id: 'store-a',
      kind: 'store' as const,
      data: { name: '晴岚美甲' },
      legacySource: 'product_states:workspace-a',
      mappingConfidence: 'exact' as const,
    };
    const created = await service.recordRelationFact(owner, input, 'store-a-create');
    const replayed = await service.recordRelationFact(owner, input, 'store-a-create');

    assert.deepEqual(replayed, created);
    const audits = await service.listCommandAudits(owner);
    assert.equal(audits.length, 1);
    assert.equal(audits[0]?.idempotencyKey, 'store-a-create');
    assert.equal(JSON.stringify(audits).includes('晴岚美甲'), false);
    assert.equal((await service.getRelationFact(owner, created.id)).data.name, '晴岚美甲');
    await assert.rejects(
      service.getRelationFact(
        { workspaceId: 'workspace-b', userId: 'owner-b', correlationId: 'corr-b' },
        created.id
      ),
      (error: unknown) => error instanceof Error && 'code' in error && error.code === 'NOT_FOUND'
    );
    await assert.rejects(
      service.recordRelationFact(owner, { ...input, data: { name: 'changed' } }, 'store-a-create'),
      (error: unknown) => error instanceof Error && 'code' in error && error.code === 'IDEMPOTENCY_CONFLICT'
    );
  });

  it('projects append-only usage and keeps one idempotent terminal result per reservation', async () => {
    const { service } = createService();

    await service.appendUsageEvent(owner, {
      id: 'grant-1',
      resource: 'image',
      action: 'adjust',
      amount: 10,
      reason: 'opening entitlement',
    }, 'grant-opening');
    await service.appendUsageEvent(owner, {
      id: 'reserve-1',
      resource: 'image',
      action: 'reserve',
      amount: 3,
      reservationId: 'reservation-1',
      reason: 'image generation',
    }, 'reserve-image');

    assert.deepEqual(await service.getUsageProjection(owner, 'image'), {
      allowance: 10,
      reserved: 3,
      committed: 0,
      released: 0,
      available: 7,
    });

    const committed = await service.appendUsageEvent(owner, {
      id: 'commit-1',
      resource: 'image',
      action: 'commit',
      amount: 3,
      reservationId: 'reservation-1',
      reason: 'owned asset delivered',
    }, 'commit-image');
    const repeatedTerminal = await service.appendUsageEvent(owner, {
      id: 'commit-duplicate',
      resource: 'image',
      action: 'commit',
      amount: 3,
      reservationId: 'reservation-1',
      reason: 'duplicate callback',
    }, 'commit-image-again');

    assert.equal(repeatedTerminal.id, committed.id);
    assert.deepEqual(await service.getUsageProjection(owner, 'image'), {
      allowance: 10,
      reserved: 0,
      committed: 3,
      released: 0,
      available: 7,
    });
    await assert.rejects(
      service.appendUsageEvent(owner, {
        id: 'refund-after-commit',
        resource: 'image',
        action: 'refund',
        amount: 3,
        reservationId: 'reservation-1',
        reason: 'invalid second terminal',
      }, 'refund-image'),
      (error: unknown) => error instanceof Error && 'code' in error && error.code === 'INVALID_STATE'
    );
  });

  it('returns a typed entitlement error when a reservation exceeds availability', async () => {
    const { service } = createService();

    await service.appendUsageEvent(
      owner,
      {
        id: 'grant-insufficient',
        resource: 'copy',
        action: 'adjust',
        amount: 1,
        reason: 'trial opening',
      },
      'grant-insufficient',
    );

    await assert.rejects(
      service.appendUsageEvent(
        owner,
        {
          id: 'reserve-too-much',
          resource: 'copy',
          action: 'reserve',
          amount: 2,
          reservationId: 'reservation-too-much',
          reason: 'quoted generation',
        },
        'reserve-too-much',
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'INSUFFICIENT_ENTITLEMENT',
    );
  });

  it('returns the same typed entitlement error from the dispatch checkpoint seam', async () => {
    const { service } = createService();

    await assert.rejects(
      service.checkpointGenerationAttempt(
        owner,
        {
          jobId: 'job-no-allowance',
          operation: 'image',
          usageReservationId: 'reservation-no-allowance',
          usageAmount: 1,
          routeSnapshot: {
            id: 'route-no-allowance',
            catalogRevision: 'catalog-r1',
            policyRevision: 'policy-r1',
            priceRevision: 'price-r1',
            requestedCatalogModelId: 'gpt-image-2',
            selectionMode: 'fixed',
            dataClass: 'public',
            fallbackConsent: false,
            allowedCandidates: [
              {
                catalogModelId: 'gpt-image-2',
                deploymentId: 'gpt-image-2-cn',
                region: 'cn',
                credentialMode: 'platform',
                credentialVersion: 'credential-v1',
              },
            ],
          },
          attempt: {
            id: 'attempt-no-allowance',
            deploymentId: 'gpt-image-2-cn',
          },
        },
        'checkpoint-no-allowance',
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'INSUFFICIENT_ENTITLEMENT',
    );
  });

  it('runs registered operation modules through the same authorization and idempotency seam', async () => {
    const repository = new MemoryFoundationRepository();
    repository.grantOwner(owner.workspaceId, owner.userId);
    const service = new P1ApplicationService(repository, {
      authorizer: allowAllAuthorizer,
      operations: [{
        name: 'task.create',
        async execute({ context, input }) {
          return { taskId: `${context.workspaceId}:${String(input.title)}` };
        },
      }],
    });

    const first = await service.executeModule<{ title: string }, { taskId: string }>(
      owner,
      'task.create',
      { title: '补素材' },
      'task-create-1'
    );
    const replayed = await service.executeModule<{ title: string }, { taskId: string }>(
      owner,
      'task.create',
      { title: '补素材' },
      'task-create-1'
    );

    assert.deepEqual(first, { taskId: 'workspace-a:补素材' });
    assert.deepEqual(replayed, first);
  });

  it('freezes only new P1 side effects while preserving replay, drafts, and recovery', async () => {
    const repository = new MemoryFoundationRepository();
    repository.grantOwner(owner.workspaceId, owner.userId);
    let writeOwner: 'legacy' | 'frozen' | 'p1' | null = 'p1';
    const executedActions: string[] = [];
    const service = new P1ApplicationService(repository, {
      authorizer: allowAllAuthorizer,
      operations: [
        {
          name: 'operations',
          async execute({ input }) {
            const action = String(input.action);
            executedActions.push(action);
            return { action };
          },
        },
      ],
      writeOwnershipReader: async () => writeOwner,
    });
    const command = (action: string) => ({ action, payload: {} });

    const submitted = await service.executeModule(
      owner,
      'operations',
      command('submit_creative_work'),
      'submitted-before-freeze'
    );
    writeOwner = 'frozen';
    assert.deepEqual(
      await service.executeModule(
        owner,
        'operations',
        command('submit_creative_work'),
        'submitted-before-freeze'
      ),
      submitted
    );
    await assert.rejects(
      service.executeModule(
        owner,
        'operations',
        command('submit_creative_work'),
        'new-during-freeze'
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'COMMANDS_FROZEN'
    );
    await service.executeModule(
      owner,
      'operations',
      command('create_blank_work'),
      'draft-during-freeze'
    );
    await service.executeModule(
      owner,
      'operations',
      command('resume_creative_job'),
      'recovery-during-freeze'
    );

    writeOwner = 'legacy';
    await assert.rejects(
      service.executeModule(
        owner,
        'operations',
        command('start_canvas_image'),
        'new-after-rollback'
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'P1_WRITE_DISABLED'
    );
    await service.executeModule(
      owner,
      'operations',
      command('complete_canvas_image'),
      'callback-after-rollback'
    );

    assert.deepEqual(executedActions, [
      'submit_creative_work',
      'create_blank_work',
      'resume_creative_job',
      'complete_canvas_image',
    ]);
  });

  it('preserves operator and reviewer membership roles without owner escalation', async () => {
    const repository = new MemoryFoundationRepository();
    repository.grantMembership('workspace-a', 'operator-a', 'operator');
    repository.grantMembership('workspace-a', 'reviewer-a', 'reviewer');
    const service = new P1ApplicationService(repository, {
      authorizer: allowAllAuthorizer,
      operations: [
        {
          name: 'role.probe',
          async execute({ context }) {
            return { actor: context.actor };
          },
          async query({ context }) {
            return { actor: context.actor };
          },
        },
      ],
    });

    assert.deepEqual(
      await service.executeModule(
        {
          actor: 'operator',
          correlationId: 'corr-operator',
          userId: 'operator-a',
          workspaceId: 'workspace-a',
        },
        'role.probe',
        {},
        'operator-probe'
      ),
      { actor: 'operator' }
    );
    assert.deepEqual(
      await service.queryModule(
        {
          actor: 'reviewer',
          correlationId: 'corr-reviewer',
          userId: 'reviewer-a',
          workspaceId: 'workspace-a',
        },
        'role.probe',
        {}
      ),
      { actor: 'reviewer' }
    );
    await assert.rejects(
      service.queryModule(
        {
          actor: 'owner',
          correlationId: 'corr-spoof',
          userId: 'operator-a',
          workspaceId: 'workspace-a',
        },
        'role.probe',
        {}
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'FORBIDDEN'
    );
  });

  it('reclaims an expired module command without allowing the stale claimant to settle', async () => {
    let now = new Date('2026-07-11T00:00:00.000Z');
    const repository = new MemoryFoundationRepository(() => now, 1_000);
    repository.grantOwner(owner.workspaceId, owner.userId);
    let attempts = 0;
    const service = new P1ApplicationService(repository, {
      authorizer: allowAllAuthorizer,
      operations: [
        {
          name: 'recoverable.external',
          async execute() {
            attempts += 1;
            if (attempts === 1) throw new Error('provider outcome unknown');
            return { recovered: true };
          },
        },
      ],
    });

    await assert.rejects(
      service.executeModule(
        owner,
        'recoverable.external',
        { request: 'same' },
        'recoverable-command'
      ),
      /provider outcome unknown/
    );
    await assert.rejects(
      service.executeModule(
        owner,
        'recoverable.external',
        { request: 'same' },
        'recoverable-command'
      ),
      /still in progress/
    );

    now = new Date(now.getTime() + 1_001);
    assert.deepEqual(
      await service.executeModule(
        owner,
        'recoverable.external',
        { request: 'same' },
        'recoverable-command'
      ),
      { recovered: true }
    );
    assert.equal(attempts, 2);

    const first = await repository.claimModuleCommand(
      owner,
      'fenced-command',
      'payload-hash'
    );
    assert.equal(first.decision, 'execute');
    now = new Date(now.getTime() + 1_001);
    const second = await repository.claimModuleCommand(
      owner,
      'fenced-command',
      'payload-hash'
    );
    assert.equal(second.decision, 'execute');
    if (first.decision !== 'execute' || second.decision !== 'execute') {
      throw new Error('Expected both module command claims to execute.');
    }
    await assert.rejects(
      repository.completeModuleCommand(
        owner,
        'fenced-command',
        'payload-hash',
        first.claimToken,
        { stale: true }
      ),
      /claim was not found/
    );
    await repository.completeModuleCommand(
      owner,
      'fenced-command',
      'payload-hash',
      second.claimToken,
      { stale: false }
    );
  });

  it('releases an insufficient-entitlement claim for immediate same-key retry', async () => {
    const repository = new MemoryFoundationRepository();
    repository.grantOwner(owner.workspaceId, owner.userId);
    let attempts = 0;
    const service = new P1ApplicationService(repository, {
      authorizer: allowAllAuthorizer,
      operations: [
        {
          name: 'quota.external',
          async execute() {
            attempts += 1;
            if (attempts === 1) {
              throw new P1DomainError(
                'INSUFFICIENT_ENTITLEMENT',
                'Image allowance is insufficient.'
              );
            }
            return { recovered: true };
          },
        },
      ],
    });

    await assert.rejects(
      service.executeModule(
        owner,
        'quota.external',
        { request: 'same' },
        'quota-command'
      ),
      (error: unknown) =>
        error instanceof P1DomainError &&
        error.code === 'INSUFFICIENT_ENTITLEMENT'
    );
    assert.deepEqual(
      await service.executeModule(
        owner,
        'quota.external',
        { request: 'same' },
        'quota-command'
      ),
      { recovered: true }
    );
    assert.equal(attempts, 2);
  });

  it('releases a deterministic invalid-state claim for immediate same-key correction', async () => {
    const repository = new MemoryFoundationRepository();
    repository.grantOwner(owner.workspaceId, owner.userId);
    let attempts = 0;
    const service = new P1ApplicationService(repository, {
      authorizer: allowAllAuthorizer,
      operations: [
        {
          name: 'validation.probe',
          async execute() {
            attempts += 1;
            if (attempts === 1) {
              throw new P1DomainError(
                'INVALID_STATE',
                'The command payload is invalid.'
              );
            }
            return { corrected: true };
          },
        },
      ],
    });

    await assert.rejects(
      service.executeModule(
        owner,
        'validation.probe',
        { request: 'same' },
        'invalid-state-command'
      ),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'INVALID_STATE'
    );
    assert.deepEqual(await service.listCommandAudits(owner), []);
    assert.deepEqual(
      await service.executeModule(
        owner,
        'validation.probe',
        { request: 'same' },
        'invalid-state-command'
      ),
      { corrected: true }
    );
    assert.equal(attempts, 2);
    assert.equal((await service.listCommandAudits(owner)).length, 1);
  });

  it('renews a long-running module command lease until its side effect settles', async () => {
    const repository = new MemoryFoundationRepository(() => new Date(), 30);
    repository.grantOwner(owner.workspaceId, owner.userId);
    let attempts = 0;
    let releaseOperation!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const operationCanFinish = new Promise<void>((resolve) => {
      releaseOperation = resolve;
    });
    const service = new P1ApplicationService(repository, {
      authorizer: allowAllAuthorizer,
      moduleCommandHeartbeatMs: 5,
      operations: [
        {
          name: 'slow.external',
          async execute() {
            attempts += 1;
            markStarted();
            await operationCanFinish;
            return { completed: true };
          },
        },
      ],
    });

    const first = service.executeModule(
      owner,
      'slow.external',
      { request: 'same' },
      'slow-command'
    );
    await started;
    await new Promise((resolve) => setTimeout(resolve, 80));

    await assert.rejects(
      service.executeModule(
        owner,
        'slow.external',
        { request: 'same' },
        'slow-command'
      ),
      /still in progress/
    );
    releaseOperation();
    assert.deepEqual(await first, { completed: true });
    assert.equal(attempts, 1);
  });

  it('freezes a fixed-model route before dispatch and completes only with an owned asset receipt', async () => {
    const { service } = createService();
    await service.appendUsageEvent(owner, {
      id: 'grant-generation', resource: 'image', action: 'adjust', amount: 10, reason: 'opening',
    }, 'grant-generation');
    await service.appendUsageEvent(owner, {
      id: 'reserve-generation', resource: 'image', action: 'reserve', amount: 3,
      reservationId: 'reservation-generation', reason: 'quote accepted',
    }, 'reserve-generation');

    const job = await service.startGeneration(owner, {
      jobId: 'job-1',
      operation: 'image',
      usageReservationId: 'reservation-generation',
      routeSnapshot: {
        id: 'route-1',
        catalogRevision: 'catalog-r1',
        policyRevision: 'policy-r1',
        priceRevision: 'price-r1',
        requestedCatalogModelId: 'gpt-image-2',
        selectionMode: 'fixed',
        dataClass: 'public',
        fallbackConsent: true,
        allowedCandidates: [{
          catalogModelId: 'gpt-image-2',
          deploymentId: 'gpt-image-2-cn',
          region: 'cn',
          credentialMode: 'platform',
          credentialVersion: 'credential-v1',
        }],
      },
    }, 'start-job-1');
    const attempt = await service.startProviderAttempt(owner, {
      id: 'attempt-1', jobId: job.id, deploymentId: 'gpt-image-2-cn',
    }, 'attempt-1');
    await service.recordAttemptAcceptance(owner, {
      attemptId: attempt.id, acceptance: 'accepted', providerTaskRef: 'provider-task-1',
    }, 'accept-attempt-1');
    await service.appendProviderCost(owner, {
      id: 'cost-1', attemptId: attempt.id, stage: 'observed', amountMicros: 250_000,
      currency: 'CNY', unit: 'image', evidence: 'provider_response', payer: 'platform',
    }, 'cost-1');

    const asset = await service.recordAssetReceipt(owner, {
      id: 'asset-1', jobId: job.id, attemptId: attempt.id,
      objectKey: 'workspace-a/generated/asset-1.png',
      sha256: 'a'.repeat(64), sizeBytes: 2048, mediaType: 'image/png',
    }, 'asset-1');

    assert.equal(asset.objectKey, 'workspace-a/generated/asset-1.png');
    assert.equal((await service.getGenerationJob(owner, job.id)).status, 'completed');
    assert.equal((await service.getRouteSnapshot(owner, 'route-1')).priceRevision, 'price-r1');
    assert.equal((await service.listProviderCosts(owner, attempt.id)).length, 1);
    assert.deepEqual(await service.getUsageProjection(owner, 'image'), {
      allowance: 10, reserved: 0, committed: 3, released: 0, available: 7,
    });
    await assert.rejects(
      service.startProviderAttempt(owner, {
        id: 'attempt-2', jobId: job.id, deploymentId: 'gpt-image-2-cn',
      }, 'attempt-2'),
      (error: unknown) => error instanceof Error && 'code' in error && error.code === 'INVALID_STATE'
    );
  });

  it('allows one safe retry only after rejection-before-accept and blocks foreign sensitive routes', async () => {
    const { service } = createService();
    await service.appendUsageEvent(owner, {
      id: 'grant-safe-retry', resource: 'video', action: 'adjust', amount: 5, reason: 'opening',
    }, 'grant-safe-retry');
    await service.appendUsageEvent(owner, {
      id: 'reserve-safe-retry', resource: 'video', action: 'reserve', amount: 2,
      reservationId: 'reservation-safe-retry', reason: 'quote accepted',
    }, 'reserve-safe-retry');

    const baseRoute = {
      id: 'route-safe-retry', catalogRevision: 'catalog-r1', policyRevision: 'policy-r1',
      priceRevision: 'price-r1', requestedCatalogModelId: 'seedance-2', selectionMode: 'fixed' as const,
      dataClass: 'public' as const, fallbackConsent: true,
      allowedCandidates: [
        { catalogModelId: 'seedance-2', deploymentId: 'seedance-primary', region: 'cn' as const, credentialMode: 'platform' as const, credentialVersion: 'v1' },
        { catalogModelId: 'seedance-2', deploymentId: 'seedance-backup', region: 'cn' as const, credentialMode: 'platform' as const, credentialVersion: 'v2' },
      ],
    };
    const job = await service.startGeneration(owner, {
      jobId: 'job-safe-retry', operation: 'video', usageReservationId: 'reservation-safe-retry', routeSnapshot: baseRoute,
    }, 'job-safe-retry');
    const first = await service.startProviderAttempt(owner, {
      id: 'attempt-safe-1', jobId: job.id, deploymentId: 'seedance-primary',
    }, 'attempt-safe-1');
    await service.recordAttemptAcceptance(owner, {
      attemptId: first.id, acceptance: 'rejected_before_accept',
    }, 'attempt-safe-1-rejected');
    const second = await service.startProviderAttempt(owner, {
      id: 'attempt-safe-2', jobId: job.id, deploymentId: 'seedance-backup',
    }, 'attempt-safe-2');

    assert.equal(second.ordinal, 2);
    await assert.rejects(
      service.startProviderAttempt(owner, {
        id: 'attempt-safe-3', jobId: job.id, deploymentId: 'seedance-backup',
      }, 'attempt-safe-3'),
      (error: unknown) => error instanceof Error && 'code' in error && error.code === 'INVALID_STATE'
    );

    await assert.rejects(
      service.startGeneration(owner, {
        jobId: 'job-sensitive', operation: 'video', usageReservationId: 'reservation-safe-retry',
        routeSnapshot: {
          ...baseRoute,
          id: 'route-sensitive',
          dataClass: 'contains_face',
          allowedCandidates: [{
            catalogModelId: 'veo', deploymentId: 'veo-global', region: 'global',
            credentialMode: 'platform', credentialVersion: 'v1',
          }],
        },
      }, 'job-sensitive'),
      (error: unknown) => error instanceof Error && 'code' in error && error.code === 'INVALID_STATE'
    );

    await service.appendUsageEvent(owner, {
      id: 'reserve-no-consent', resource: 'video', action: 'reserve', amount: 1,
      reservationId: 'reservation-no-consent', reason: 'quote accepted',
    }, 'reserve-no-consent');
    const noConsentJob = await service.startGeneration(owner, {
      jobId: 'job-no-consent', operation: 'video', usageReservationId: 'reservation-no-consent',
      routeSnapshot: { ...baseRoute, id: 'route-no-consent', fallbackConsent: false },
    }, 'job-no-consent');
    const rejected = await service.startProviderAttempt(owner, {
      id: 'attempt-no-consent-1', jobId: noConsentJob.id, deploymentId: 'seedance-primary',
    }, 'attempt-no-consent-1');
    await service.recordAttemptAcceptance(owner, {
      attemptId: rejected.id, acceptance: 'rejected_before_accept',
    }, 'attempt-no-consent-rejected');
    await assert.rejects(
      service.startProviderAttempt(owner, {
        id: 'attempt-no-consent-2', jobId: noConsentJob.id, deploymentId: 'seedance-backup',
      }, 'attempt-no-consent-2'),
      (error: unknown) => error instanceof Error && 'code' in error && error.code === 'INVALID_STATE'
    );
  });

  it('refunds failed generation without deleting provider cost evidence', async () => {
    const { service } = createService();
    await service.appendUsageEvent(owner, {
      id: 'allow-failure', resource: 'image', action: 'adjust', amount: 1, reason: 'plan'
    }, 'allow-failure');
    await service.appendUsageEvent(owner, {
      id: 'reserve-failure', resource: 'image', action: 'reserve', amount: 1,
      reservationId: 'reservation-failure', reason: 'generation'
    }, 'reserve-failure');
    await service.startGeneration(owner, {
      jobId: 'job-failure', operation: 'image', usageReservationId: 'reservation-failure',
      routeSnapshot: {
        id: 'route-failure', catalogRevision: 'c1', policyRevision: 'p1', priceRevision: 'r1',
        requestedCatalogModelId: 'image-1', selectionMode: 'fixed', dataClass: 'public',
        fallbackConsent: false,
        allowedCandidates: [{ catalogModelId: 'image-1', deploymentId: 'deployment-1', region: 'cn', credentialMode: 'platform', credentialVersion: 'v1' }]
      }
    }, 'start-failure');
    const attempt = await service.startProviderAttempt(owner, {
      id: 'attempt-failure', jobId: 'job-failure', deploymentId: 'deployment-1'
    }, 'attempt-failure');
    await service.appendProviderCost(owner, {
      id: 'cost-failure', attemptId: attempt.id, stage: 'observed', amountMicros: 25,
      currency: 'CNY', unit: 'request', evidence: 'provider-ledger', payer: 'platform'
    }, 'cost-failure');

    await service.settleGenerationFailure(owner, {
      jobId: 'job-failure', reason: 'provider_failed'
    }, 'settle-failure');

    assert.equal((await service.getGenerationJob(owner, 'job-failure')).status, 'failed');
    assert.deepEqual(await service.getUsageProjection(owner, 'image'), {
      allowance: 1, reserved: 0, committed: 0, released: 1, available: 1
    });
    assert.equal((await service.listProviderCosts(owner, attempt.id)).length, 1);
  });

  it('keeps terminal provider outcomes monotonic against late unknown settlements', async () => {
    const { repository, service } = createService();
    await service.appendUsageEvent(owner, {
      action: 'adjust',
      amount: 2,
      id: 'terminal-monotonic-grant',
      reason: 'plan',
      resource: 'copy',
    }, 'terminal-monotonic-grant');
    const checkpoint = await service.checkpointGenerationAttempt(
      owner,
      {
        attempt: {
          deploymentId: 'copy-direct',
          id: 'terminal-monotonic-attempt',
        },
        jobId: 'terminal-monotonic-job',
        operation: 'copy',
        routeSnapshot: {
          allowedCandidates: [
            {
              catalogModelId: 'copy-model',
              credentialMode: 'platform',
              credentialVersion: 'v1',
              deploymentId: 'copy-direct',
              fallbackRank: 1,
              region: 'cn',
            },
          ],
          catalogRevision: 'catalog-v1',
          dataClass: 'public',
          dataClasses: ['public'],
          fallbackConsent: false,
          id: 'terminal-monotonic-route',
          policyRevision: 'policy-v1',
          priceRevision: 'price-v1',
          providerRetryDisabled: true,
          requestedCatalogModelId: 'copy-model',
          retryOwner: 'product',
          selectionMode: 'fixed',
        },
        usageAmount: 1,
        usageReservationId: 'terminal-monotonic-reservation',
      },
      'terminal-monotonic-checkpoint',
    );
    await service.settleProviderOutcome(
      owner,
      {
        acceptance: 'accepted',
        attemptId: checkpoint.attempt.id,
        outcome: { status: 'completed' },
        providerCost: {
          amountMicros: 10,
          attemptId: checkpoint.attempt.id,
          currency: 'CNY',
          evidence: 'provider_response',
          id: 'terminal-monotonic-cost-completed',
          payer: 'platform',
          stage: 'observed',
          unit: 'request',
        },
        result: {
          jobId: checkpoint.job.id,
          status: 'completed',
        },
      },
      'terminal-monotonic-completed',
    );

    await assert.rejects(
      service.settleProviderOutcome(
        owner,
        {
          acceptance: 'accepted',
          attemptId: checkpoint.attempt.id,
          outcome: {
            reason: 'late_stale_poll',
            status: 'unknown',
          },
          providerCost: {
            amountMicros: 0,
            attemptId: checkpoint.attempt.id,
            currency: 'CNY',
            evidence: 'late_stale_poll',
            id: 'terminal-monotonic-cost-unknown',
            payer: 'platform',
            stage: 'estimated',
            unit: 'request',
          },
          result: {
            jobId: checkpoint.job.id,
            status: 'unknown',
          },
        },
        'terminal-monotonic-late-unknown',
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'INVALID_STATE',
    );
    assert.equal(
      (await service.getGenerationJob(owner, checkpoint.job.id)).status,
      'completed',
    );
    assert.equal(
      (
        await repository.listProviderCosts(
          owner.workspaceId,
          checkpoint.attempt.id,
        )
      ).length,
      1,
    );
    assert.deepEqual(await service.getUsageProjection(owner, 'copy'), {
      allowance: 2,
      available: 1,
      committed: 1,
      released: 0,
      reserved: 0,
    });
  });
});
