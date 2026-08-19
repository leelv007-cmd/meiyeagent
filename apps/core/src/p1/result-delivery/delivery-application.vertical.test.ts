/**
 * DEL-02 / R-P1-03: one DeliveryApplication, three UI-entry adapters.
 * Workbench consume then Result Center consume of the same ApprovalReceipt
 * must fail closed with identical identity / TTL / audit.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { contentPackageDeliveryAttemptId, type ContentPackage } from '@meiye/contracts';

import {
  ContentPackageDeliveryService,
  type ContentPackagePublishPort,
} from '../operations/content-package-delivery.js';
import { PublishHandoffService } from '../operations/publish-handoff.js';
import { MemoryOperationsRepository } from '../operations/repository.js';
import type { OperationContext, OperationsWorkspaceState } from '../operations/types.js';
import {
  comparableDeliveryFacts,
  createDeliveryApplication,
  DeliveryApplicationError,
} from './delivery-application.js';
import { createDeliveryEntryAdapter } from './delivery-entry-adapters.js';
import { AssistedReceiptService } from './assisted-receipt-service.js';
import { MemoryAssistedReceiptRepository } from './assisted-receipt-repository.js';

const context: OperationContext = {
  actor: 'owner',
  correlationId: 'delivery-application-vertical',
  userId: 'owner-a',
  workspaceId: 'workspace-a',
};

test('Workbench consume of an ApprovalReceipt fail-closes Result Center with identical identity/TTL/audit', async () => {
  const setup = await createApprovedSetup();
  const application = createDeliveryApplication({
    assistedReceipts: setup.assistedReceipts,
    clock: () => '2026-08-08T12:01:00.000Z',
    createId: idSequence('delivery-app'),
    delivery: setup.delivery,
    handoff: setup.handoff,
    repository: setup.repository,
  });
  const workbench = createDeliveryEntryAdapter(application, 'workbench');
  const resultCenter = createDeliveryEntryAdapter(application, 'result_center');
  const inbox = createDeliveryEntryAdapter(application, 'pending_inbox');

  const prepared = await workbench.preparePackage(context, {
    packageId: 'package-a',
    platform: 'douyin',
    variantVersionId: 'douyin-v1',
  });
  assert.equal(prepared.approvalReceiptId, setup.approval.id);
  assert.equal(prepared.status, 'approved');

  const first = await workbench.consume(context, {
    approvalReceiptId: setup.approval.id,
    packageId: 'package-a',
  });
  assert.equal(first.projection.identity.approvalReceiptId, setup.approval.id);
  assert.equal(first.projection.audit.status, 'consumed');

  await assert.rejects(
    () =>
      resultCenter.consume(context, {
        approvalReceiptId: setup.approval.id,
        packageId: 'package-a',
      }),
    (error: unknown) =>
      error instanceof DeliveryApplicationError &&
      error.code === 'APPROVAL_ALREADY_CONSUMED',
  );

  const [workbenchState, resultCenterState, inboxState] = await Promise.all([
    workbench.projectState(context, {
      approvalReceiptId: setup.approval.id,
      packageId: 'package-a',
    }),
    resultCenter.projectState(context, {
      approvalReceiptId: setup.approval.id,
      packageId: 'package-a',
    }),
    inbox.projectState(context, {
      approvalReceiptId: setup.approval.id,
      packageId: 'package-a',
    }),
  ]);

  assert.equal(workbenchState.entry, 'workbench');
  assert.equal(resultCenterState.entry, 'result_center');
  assert.equal(inboxState.entry, 'pending_inbox');
  assert.deepEqual(
    comparableDeliveryFacts(workbenchState),
    comparableDeliveryFacts(resultCenterState),
  );
  assert.deepEqual(
    comparableDeliveryFacts(resultCenterState),
    comparableDeliveryFacts(inboxState),
  );
  assert.equal(
    workbenchState.identity.deliveryAttemptId,
    contentPackageDeliveryAttemptId(setup.approval.id),
  );
  assert.equal(workbenchState.ttl.expiresAt, setup.approval.expiresAt);
  assert.equal(workbenchState.audit.status, 'consumed');
  assert.equal(workbenchState.audit.consumedBy, context.userId);
  assert.ok(workbenchState.audit.consumedAt);
  assert.equal(
    workbenchState.audit.externalEffectId,
    contentPackageDeliveryAttemptId(setup.approval.id),
  );
});

test('three-entry DeliveryApplication shares prepare/handoff/outcome/state beyond module seams', async () => {
  const setup = await createApprovedSetup();
  const application = createDeliveryApplication({
    assistedReceipts: setup.assistedReceipts,
    clock: () => '2026-08-08T12:01:00.000Z',
    createId: idSequence('delivery-vertical'),
    delivery: setup.delivery,
    handoff: setup.handoff,
    repository: setup.repository,
  });
  const workbench = createDeliveryEntryAdapter(application, 'workbench');
  const resultCenter = createDeliveryEntryAdapter(application, 'result_center');
  const inbox = createDeliveryEntryAdapter(application, 'pending_inbox');

  const fromInbox = await inbox.preparePackage(context, {
    packageId: 'package-a',
    platform: 'douyin',
    variantVersionId: 'douyin-v1',
  });
  const fromResult = await resultCenter.preparePackage(context, {
    packageId: 'package-a',
    platform: 'douyin',
    variantVersionId: 'douyin-v1',
  });
  assert.deepEqual(fromInbox.identity, fromResult.identity);

  const consumed = await workbench.consume(context, {
    approvalReceiptId: setup.approval.id,
    packageId: 'package-a',
  });
  const handoff = await workbench.prepareCanonicalHandoff(context, {
    expectedRevision: consumed.package.revision,
    packageId: 'package-a',
    platform: 'douyin',
    variantVersionId: 'douyin-v1',
    workId: 'work-1',
  });
  assert.ok(handoff.mobileHandoff?.token);
  assert.equal(handoff.mobileHandoff?.publishActor, 'merchant_self_publish');

  const recorded = await inbox.recordOutcome(context, {
    expectedRevision: consumed.package.revision,
    packageId: 'package-a',
    platform: 'douyin',
    variantVersionId: 'douyin-v1',
    workId: 'work-1',
  });
  assert.equal(recorded.projection.outcome?.status, 'published');

  const [workbenchState, resultCenterState, inboxState] = await Promise.all([
    workbench.projectState(context, {
      approvalReceiptId: setup.approval.id,
      packageId: 'package-a',
    }),
    resultCenter.projectState(context, {
      approvalReceiptId: setup.approval.id,
      packageId: 'package-a',
    }),
    inbox.projectState(context, {
      approvalReceiptId: setup.approval.id,
      packageId: 'package-a',
    }),
  ]);
  assert.deepEqual(
    comparableDeliveryFacts(workbenchState),
    comparableDeliveryFacts(resultCenterState),
  );
  assert.deepEqual(
    comparableDeliveryFacts(resultCenterState),
    comparableDeliveryFacts(inboxState),
  );
  assert.equal(inboxState.handoff?.token, handoff.mobileHandoff?.token);
  assert.equal(inboxState.handoff?.expiresAt, handoff.mobileHandoff?.expiresAt);
  assert.equal(workbenchState.outcome?.status, 'published');
});

async function createApprovedSetup(
  clock: () => string = () => '2026-08-08T12:00:00.000Z',
) {
  const repository = new MemoryOperationsRepository();
  repository.grantMembership('owner-a', 'workspace-a');
  await repository.seedWorkspace(workspaceState());
  const publisher: ContentPackagePublishPort = {
    async publish() {
      return {
        platformUrl: 'https://example.com/auto',
        providerReceiptId: 'prov-1',
        status: 'published',
      };
    },
  };
  const delivery = new ContentPackageDeliveryService(repository, {
    approvalPolicy: {
      async resolve() {
        return {
          contextBundle: {
            bundleId: 'bundle-a',
            hash: 'bundle-hash-a',
            revision: 1,
          },
          policy: {
            brief: {},
            bundle: { revision: 1, workspaceId: 'workspace-a' },
            candidate: {
              assetRefs: [],
              candidateId: 'candidate-a',
              factClaims: [],
              intendedUse: 'public_content',
              workspaceId: 'workspace-a',
            },
            identityRefs: [],
            rightsRefs: [],
            sourceRefs: [],
          },
        };
      },
    },
    async capability(platform) {
      return { mode: 'assisted', platform, reason: 'test_assisted' };
    },
    clock,
    createId: idSequence('delivery'),
    publisher,
  });
  const assistedReceipts = new AssistedReceiptService(
    new MemoryAssistedReceiptRepository(),
  );
  const handoff = new PublishHandoffService(repository, delivery, {
    assistedReceipts,
    clock,
    createId: idSequence('handoff'),
    resolveCapability: async (platform) => ({
      mode: 'assisted' as const,
      platform: platform as 'douyin',
      reason: 'test_assisted',
    }),
  });
  const approval = await delivery.approve(context, {
    accountId: 'douyin-account-a',
    actionKind: 'publish',
    actionScheduledAt: '2026-08-08T13:00:00.000Z',
    cost: { amount: 0, currency: 'CNY' },
    expectedRevision: 1,
    idempotencyKey: 'approve-delivery-application',
    packageId: 'package-a',
    platform: 'douyin',
    purpose: 'publish_current_variant',
    requestId: 'approval-request-a',
    variantVersionId: 'douyin-v1',
  });
  assert.equal(approval.status, 'approved');
  return { approval, assistedReceipts, delivery, handoff, repository };
}

function workspaceState(): OperationsWorkspaceState {
  const version = {
    body: '正文',
    createdAt: '2026-08-08T06:00:00.000Z',
    conversionHook: '私信预约',
    id: 'douyin-v1',
    orderedAssetIds: ['asset-1'],
    title: '标题',
    topics: ['护理'],
  };
  const packageDouyin: ContentPackage = {
    approvalRequests: [
      {
        actionKind: 'publish',
        contentPackageRevision: 1,
        createdAt: '2026-08-08T11:30:00.000Z',
        id: 'approval-request-a',
        nodeId: 'approval:package-a',
        packageId: 'package-a',
        platform: 'douyin',
        purpose: 'publish_current_variant',
        status: 'pending',
        taskId: 'workflow-a',
        variantVersionId: 'douyin-v1',
        workflowId: 'workflow-a',
        workflowRevision: 1,
        workspaceId: 'workspace-a',
      },
    ],
    compliance: { aigcLabelEnabled: true, watermarkEnabled: false },
    createdAt: '2026-08-08T06:00:00.000Z',
    exportReceipts: [
      {
        artifactAssetId: 'export-asset-a',
        artifactObjectKey: 'workspace-a/exports/package-a.zip',
        contentType: 'application/zip',
        createdAt: '2026-08-08T11:30:00.000Z',
        id: 'export-receipt-a',
        platform: 'douyin',
        status: 'succeeded',
        variantVersionId: 'douyin-v1',
      },
    ],
    generated: { assetIds: [], childRuns: [] },
    id: 'package-a',
    kind: 'image_text',
    lineage: {},
    revision: 1,
    rights: { state: 'authorized' },
    source: { assetIds: [], workflowId: 'workflow-a', workId: 'work-1' },
    status: 'accepted',
    updatedAt: '2026-08-08T06:00:00.000Z',
    variants: [
      {
        currentVersionId: 'douyin-v1',
        id: 'variant-douyin',
        platform: 'douyin',
        versions: [version],
      },
    ],
    versions: [version],
    workspaceId: 'workspace-a',
  };
  return {
    auditEvents: [],
    commandReceipts: [],
    composerConversations: [],
    contentPackages: [packageDouyin],
    creationEvents: [],
    creativeAssets: [],
    creativeContents: [],
    creativeJobs: [],
    creativeWorks: [],
    exportReceipts: [],
    imageJobs: [],
    taskEvents: [],
    taskSourceLinks: [],
    tasks: [],
    templateShortcuts: [],
    triggerConfigs: [],
    triggerRuns: [],
    userTemplates: [],
    weeklyBatchExecutions: [],
    weeklyFacts: [],
    weeklyReviews: [],
    works: [],
    workspaceId: 'workspace-a',
  };
}

function idSequence(prefix: string) {
  let value = 0;
  return () => `${prefix}-generated-id-${++value}`;
}
