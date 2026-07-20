import assert from 'node:assert/strict';
import test from 'node:test';
import type { ApprovalBinding } from '@meiye/contracts';

import {
  MemoryFoundationRepository,
  P1ApplicationService,
} from '../foundation/index.js';
import {
  ApprovalReceiptError,
  ContentPackageApprovalService,
  MemoryApprovalReceiptRepository,
  createPendingApprovalRequest,
} from './content-package-approval.js';

const binding = {
  accountId: 'douyin-account-a',
  actionKind: 'publish' as const,
  actionScheduledAt: '2026-07-18T08:00:00.000Z',
  contextBundle: {
    bundleId: 'bundle-price-a',
    hash: 'bundle-hash-a',
    revision: 3,
  },
  contentRevision: 4,
  cost: { amount: 0, currency: 'CNY' as const },
  packageId: 'package-a',
  platform: 'douyin' as const,
  purpose: 'publish_current_variant',
  variantVersionId: 'douyin-v4',
  workspaceId: 'workspace-a',
};

test('one pending approval request is consumed exactly once by the existing receipt path', async () => {
  const repository = new MemoryApprovalReceiptRepository();
  const request = createPendingApprovalRequest({
    actionKind: 'publish',
    contentPackageRevision: 4,
    createdAt: '2026-07-18T06:59:00.000Z',
    packageId: binding.packageId,
    platform: binding.platform,
    purpose: binding.purpose,
    taskId: 'task-a',
    variantVersionId: binding.variantVersionId,
    workflowId: 'workflow-a',
    workflowRevision: 7,
    workspaceId: binding.workspaceId,
  });
  repository.seedPendingRequest(request);
  const service = new ContentPackageApprovalService(repository, () =>
    '2026-07-18T07:00:00.000Z'
  );

  const receipt = await service.approve({
    ...binding,
    actorId: 'owner-a',
    idempotencyKey: 'approve-request-a',
    requestId: request.id,
  });

  const consumedRequest = await repository.getPendingRequest(request.id);
  assert.equal(consumedRequest?.status, 'consumed');
  assert.equal(
    consumedRequest?.status === 'consumed'
      ? consumedRequest.receiptId
      : undefined,
    receipt.id
  );
  assert.deepEqual(
    await service.approve({
      ...binding,
      actorId: 'owner-a',
      idempotencyKey: 'approve-request-a',
      requestId: request.id,
    }),
    receipt
  );
  await assert.rejects(
    service.approve({
      ...binding,
      actorId: 'owner-a',
      idempotencyKey: 'approve-request-a-again',
      requestId: request.id,
    }),
    (error: unknown) =>
      error instanceof ApprovalReceiptError &&
      error.code === 'APPROVAL_REQUEST_NOT_PENDING'
  );
});

test('approval binds the exact external action and is recorded as an immutable decision', async () => {
  const repository = new MemoryApprovalReceiptRepository();
  const service = new ContentPackageApprovalService(repository, () =>
    '2026-07-18T07:00:00.000Z'
  );
  const requestId = seedApprovalRequest(repository);

  const receipt = await service.approve({
    ...binding,
    actorId: 'owner-a',
    idempotencyKey: 'approve-package-a-v4',
    requestId,
  });

  assert.equal(receipt.status, 'approved');
  assert.deepEqual(receipt.binding, binding);
  assert.deepEqual(receipt.events, [
    {
      actorId: 'owner-a',
      eventId: receipt.events[0]?.eventId,
      occurredAt: '2026-07-18T07:00:00.000Z',
      type: 'approved',
    },
  ]);
  assert.deepEqual(
    await service.approve({
      ...binding,
      actorId: 'owner-a',
      idempotencyKey: 'approve-package-a-v4',
      requestId,
    }),
    receipt
  );
});

test('canonical external gates reject missing approval and a stale revision', async () => {
  const repository = new MemoryApprovalReceiptRepository();
  const service = new ContentPackageApprovalService(repository);

  await assert.rejects(
    service.authorize({ ...policyInput(), receiptId: undefined }),
    (error: unknown) =>
      error instanceof ApprovalReceiptError &&
      error.gateId === 'external_action_approval'
  );
  const receipt = await service.approve({
    ...binding,
    actorId: 'owner-a',
    idempotencyKey: 'approve-stale',
    requestId: seedApprovalRequest(repository),
  });
  await assert.rejects(
    service.authorize({
      ...policyInput(),
      currentContentRevision: 5,
      receiptId: receipt.id,
    }),
    (error: unknown) =>
      error instanceof ApprovalReceiptError &&
      error.gateId === 'external_revision'
  );
});

test('an approval cannot be reused for another account, platform, time, cost, or purpose', async () => {
  const repository = new MemoryApprovalReceiptRepository();
  const service = new ContentPackageApprovalService(repository);
  const receipt = await service.approve({
    ...binding,
    actorId: 'owner-a',
    idempotencyKey: 'approve-exact-binding',
    requestId: seedApprovalRequest(repository),
  });
  const mutations = [
    {
      input: { accountId: 'douyin-account-b' },
      expectedCode: 'APPROVAL_POLICY_REJECTED',
    },
    {
      input: { platform: 'xiaohongshu' as const },
      expectedCode: 'APPROVAL_BINDING_MISMATCH',
    },
    {
      input: { actionScheduledAt: '2026-07-18T09:00:00.000Z' },
      expectedCode: 'APPROVAL_BINDING_MISMATCH',
    },
    {
      input: { cost: { amount: 1, currency: 'CNY' as const } },
      expectedCode: 'APPROVAL_BINDING_MISMATCH',
    },
    {
      input: { purpose: 'paid_boost' },
      expectedCode: 'APPROVAL_BINDING_MISMATCH',
    },
  ];

  for (const mutation of mutations) {
    await assert.rejects(
      service.authorize({
        ...policyInput(),
        ...mutation.input,
        receiptId: receipt.id,
      }),
      (error: unknown) =>
        error instanceof ApprovalReceiptError &&
        error.code === mutation.expectedCode
    );
  }
});

test('a consumed approval cannot authorize a second external effect', async () => {
  const repository = new MemoryApprovalReceiptRepository();
  const service = new ContentPackageApprovalService(repository);
  const receipt = await service.approve({
    ...binding,
    actorId: 'owner-a',
    idempotencyKey: 'approve-consume-once',
    requestId: seedApprovalRequest(repository),
  });
  await service.authorize({ ...policyInput(), receiptId: receipt.id });
  const consumed = await service.consume({
    actorId: 'worker-a',
    receiptId: receipt.id,
    externalEffectId: 'publish-job-a',
  });

  assert.equal(consumed.status, 'consumed');
  await assert.rejects(
    service.authorize({ ...policyInput(), receiptId: receipt.id }),
    (error: unknown) =>
      error instanceof ApprovalReceiptError &&
      error.code === 'APPROVAL_NOT_ACTIVE'
  );
});

test('a fact expiry invalidates only approvals bound to affected ContextBundles', async () => {
  const repository = new MemoryApprovalReceiptRepository();
  const service = new ContentPackageApprovalService(repository);
  const affectedRequestId = seedApprovalRequest(repository);
  const affected = await service.approve({
    ...binding,
    actorId: 'owner-a',
    idempotencyKey: 'approve-affected',
    requestId: affectedRequestId,
  });
  const unaffectedBinding = {
    ...binding,
    contextBundle: {
      bundleId: 'bundle-other',
      hash: 'bundle-hash-other',
      revision: 1,
    },
    packageId: 'package-b',
    variantVersionId: 'douyin-b-v1',
  };
  const unaffected = await service.approve({
    ...unaffectedBinding,
    actorId: 'owner-a',
    idempotencyKey: 'approve-unaffected',
    requestId: seedApprovalRequest(repository, unaffectedBinding),
  });

  await service.handle({
    affectedBundleReferences: [binding.contextBundle],
    eventId: 'context-invalidation-a',
    observedAt: '2026-07-18T07:30:00.000Z',
    reason: 'fact_expired',
    source: { key: 'facts', referenceId: 'price-a' },
    workspaceId: 'workspace-a',
  });

  assert.equal((await repository.get(affected.id))?.status, 'invalidated');
  assert.equal((await repository.get(unaffected.id))?.status, 'approved');
});

test('a deterministic approval failure releases its module-command claim for an immediate retry', async () => {
  const repository = new MemoryFoundationRepository();
  repository.grantOwner('workspace-a', 'owner-a');
  let attempts = 0;
  const service = new P1ApplicationService(repository, {
    operations: [
      {
        name: 'approval.failure',
        async execute() {
          attempts += 1;
          throw new ApprovalReceiptError(
            'APPROVAL_REQUEST_NOT_PENDING',
            'The approval request is no longer pending.'
          );
        },
      },
    ],
  });
  const execute = () =>
    service.executeModule(
      {
        correlationId: 'approval-failure-claim',
        userId: 'owner-a',
        workspaceId: 'workspace-a',
      },
      'approval.failure',
      { requestId: 'approval-request-a' },
      'approval-failure-command'
    );

  for (let retry = 0; retry < 2; retry += 1) {
    await assert.rejects(
      execute(),
      (error: unknown) =>
        error instanceof ApprovalReceiptError &&
        error.code === 'APPROVAL_REQUEST_NOT_PENDING'
    );
  }
  assert.equal(attempts, 2);
});

function seedApprovalRequest(
  repository: MemoryApprovalReceiptRepository,
  target: Pick<
    ApprovalBinding,
    | 'actionKind'
    | 'packageId'
    | 'platform'
    | 'purpose'
    | 'variantVersionId'
    | 'workspaceId'
  > = binding
) {
  const request = createPendingApprovalRequest({
    actionKind: target.actionKind,
    contentPackageRevision: binding.contentRevision,
    createdAt: '2026-07-18T06:59:00.000Z',
    packageId: target.packageId,
    platform: target.platform,
    purpose: target.purpose,
    taskId: `task-${target.packageId}`,
    variantVersionId: target.variantVersionId,
    workflowId: `workflow-${target.packageId}`,
    workflowRevision: 7,
    workspaceId: target.workspaceId,
  });
  repository.seedPendingRequest(request);
  return request.id;
}

function policyInput() {
  return {
    ...binding,
    currentContentRevision: binding.contentRevision,
    policy: {
      brief: {},
      bundle: { revision: 3, workspaceId: 'workspace-a' },
      candidate: {
        assetRefs: [],
        candidateId: 'candidate-a',
        factClaims: [],
        intendedUse: 'public_content' as const,
        workspaceId: 'workspace-a',
      },
      identityRefs: [],
      rightsRefs: [],
      sourceRefs: [],
    },
  };
}
