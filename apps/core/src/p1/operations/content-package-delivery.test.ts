import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTEXT_SOURCE_REVISION_KEYS,
  type ApprovalBinding,
  type ContentPackage,
  type ProductState,
} from '@meiye/contracts';

import {
  RecordedCanvasExportAdapter,
  RecordedImageGenerationAdapter,
} from './adapters.js';
import { OperationsApplicationService } from './application-service.js';
import { MemoryContextBundleRepository } from './context-bundle-repository.js';
import { compileContextBundle } from './context-compiler.js';
import { createContextInvalidationRuntime } from './context-invalidation.js';
import { ApprovalReceiptError } from './content-package-approval.js';
import {
  ContentPackageDeliveryError,
  ContentPackageDeliveryService,
  contentPackageDeliveryCapability,
  type ContentPackagePublishPort,
} from './content-package-delivery.js';
import { OperationsFoundationModule } from './foundation-module.js';
import { ProductLegacyDeliveryProjection } from './legacy-content-package-delivery-projection.js';
import { MemoryOperationsRepository } from './repository.js';
import type { OperationsRepository } from './repository.js';
import type { OperationContext, OperationsWorkspaceState } from './types.js';

const context: OperationContext = {
  actor: 'owner',
  correlationId: 'delivery-test',
  userId: 'owner-a',
  workspaceId: 'workspace-a',
};

test('the three-state gate opens automatic publish only with complete live evidence', () => {
  const base = {
    accountAndScopeVerified: true,
    callbackVerified: true,
    exportAvailable: true,
    liveAdapter: true,
    platform: 'douyin' as const,
    publishRecoveryVerified: true,
    snapshotSource: 'content_package_revision' as const,
    submitAndPollVerified: true,
  };
  assert.equal(contentPackageDeliveryCapability(base).mode, 'automatic_verified');
  assert.equal(
    contentPackageDeliveryCapability({ ...base, liveAdapter: false }).mode,
    'assisted'
  );
  assert.equal(
    contentPackageDeliveryCapability({
      ...base,
      publishRecoveryVerified: false,
    }).mode,
    'assisted'
  );
  assert.equal(
    contentPackageDeliveryCapability({
      ...base,
      exportAvailable: false,
      snapshotSource: 'legacy_handoff',
    }).mode,
    'unavailable'
  );
});

test('assisted mode creates a native handoff event and makes zero provider calls', async () => {
  const setup = await createSetup('assisted');

  await assert.rejects(
    setup.service.deliver(context, {
      ...actionBinding(),
      expectedRevision: 1,
    }),
    (error: unknown) =>
      error instanceof ApprovalReceiptError &&
      error.code === 'APPROVAL_POLICY_REJECTED'
  );
  await seedSuccessfulExport(setup.repository);

  const approval = await setup.service.approve(context, {
    ...actionBinding(),
    expectedRevision: 1,
    idempotencyKey: 'approve-assisted-handoff',
  });
  const updated = await setup.service.deliver(context, {
    ...actionBinding(),
    expectedRevision: 2,
    receiptId: approval.id,
  });

  assert.equal(setup.publishCalls.length, 0);
  assert.equal(updated.deliveryEvents?.[0]?.type, 'assisted_handoff_prepared');
  assert.equal(
    updated.deliveryEvents?.[0]?.type === 'assisted_handoff_prepared'
      ? updated.deliveryEvents[0].artifactReceiptId
      : undefined,
    'export-receipt-a'
  );
  assert.equal(
    updated.deliveryEvents?.[0]?.deliveryIdentity?.approvalReceiptId,
    approval.id
  );
  assert.equal(
    updated.deliveryEvents?.[0]?.deliveryIdentity?.deliveryAttemptId,
    `content-package-delivery:${approval.id}`
  );
  assert.equal(
    updated.deliveryEvents?.[0]?.deliveryIdentity?.schema,
    'approval_receipt_v1'
  );
  assert.equal(updated.approvalReceipts?.[0]?.status, 'consumed');
  assert.equal(
    updated.approvalReceipts?.[0]?.events.find(
      (event) => event.type === 'consumed'
    )?.externalEffectId,
    `content-package-delivery:${approval.id}`
  );
  assert.equal(updated.revision, 3);
});

test('assisted mode rejects missing, forged, cross-binding, and stale receipts', async () => {
  const setup = await createSetup('assisted');
  await seedSuccessfulExport(setup.repository);

  await assert.rejects(
    setup.service.deliver(context, {
      ...actionBinding(),
      expectedRevision: 1,
    }),
    (error: unknown) =>
      error instanceof ApprovalReceiptError &&
      error.code === 'APPROVAL_POLICY_REJECTED'
  );
  await assert.rejects(
    setup.service.deliver(context, {
      ...actionBinding(),
      expectedRevision: 1,
      receiptId: 'forged-receipt',
    }),
    (error: unknown) =>
      error instanceof ApprovalReceiptError && error.code === 'APPROVAL_NOT_FOUND'
  );

  const approval = await setup.service.approve(context, {
    ...actionBinding(),
    expectedRevision: 1,
    idempotencyKey: 'approve-assisted-negative-cases',
  });
  await assert.rejects(
    setup.service.deliver(context, {
      ...actionBinding(),
      expectedRevision: 2,
      purpose: 'another-purpose',
      receiptId: approval.id,
    }),
    (error: unknown) =>
      error instanceof ApprovalReceiptError &&
      error.code === 'APPROVAL_BINDING_MISMATCH'
  );

  await setup.service.handle({
    affectedBundleReferences: [approval.binding.contextBundle],
    eventId: 'context-invalidation-assisted-stale',
    observedAt: '2026-07-18T07:00:00.000Z',
    reason: 'fact_expired',
    source: { key: 'facts', referenceId: 'fact-a' },
    workspaceId: 'workspace-a',
  });
  const staleState = (await setup.repository.loadWorkspace('workspace-a'))!;
  assert.equal(
    staleState.contentPackages[0]?.approvalReceipts?.[0]?.status,
    'invalidated'
  );
  await assert.rejects(
    setup.service.deliver(context, {
      ...actionBinding(),
      expectedRevision: staleState.contentPackages[0]!.revision,
      receiptId: approval.id,
    }),
    (error: unknown) =>
      error instanceof ApprovalReceiptError &&
      error.code === 'APPROVAL_NOT_ACTIVE'
  );
});

test('assisted mode consumes approval and event atomically when persistence fails', async () => {
  const repository = new FailingSaveOperationsRepository();
  const setup = await createSetup(
    'assisted',
    false,
    undefined,
    {
      bundleId: 'bundle-a',
      hash: 'bundle-hash-a',
      revision: 3,
    },
    repository
  );
  await seedSuccessfulExport(repository);
  const approval = await setup.service.approve(context, {
    ...actionBinding(),
    expectedRevision: 1,
    idempotencyKey: 'approve-assisted-atomic-failure',
  });

  repository.failNextSave();
  await assert.rejects(
    setup.service.deliver(context, {
      ...actionBinding(),
      expectedRevision: 2,
      receiptId: approval.id,
    }),
    /simulated persistence failure/u
  );

  const afterFailure = (await repository.loadWorkspace('workspace-a'))!;
  assert.equal(
    afterFailure.contentPackages[0]?.approvalReceipts?.[0]?.status,
    'approved'
  );
  assert.equal(afterFailure.contentPackages[0]?.deliveryEvents?.length ?? 0, 0);
});

test('automatic mode rejects an unapproved publish before the provider and lands a terminal receipt after approval', async () => {
  const setup = await createSetup('automatic_verified');

  await assert.rejects(
    setup.service.deliver(context, {
      ...actionBinding(),
      expectedRevision: 1,
    }),
    /批准|approval/iu
  );
  assert.equal(setup.publishCalls.length, 0);

  const approval = await setup.service.approve(context, {
    ...actionBinding(),
    expectedRevision: 1,
    idempotencyKey: 'approve-douyin-v1',
  });
  const afterApproval = await setup.repository.loadWorkspace('workspace-a');
  assert.equal(afterApproval?.contentPackages[0]?.revision, 2);
  const delivered = await setup.service.deliver(context, {
    ...actionBinding(),
    expectedRevision: 2,
    receiptId: approval.id,
  });

  assert.equal(setup.publishCalls.length, 1);
  assert.deepEqual(setup.publishCalls[0], {
    accountId: 'douyin-account-a',
    approvalReceiptId: approval.id,
    deliveryAttemptId: `content-package-delivery:${approval.id}`,
    idempotencyKey: `content-package-delivery:${approval.id}`,
  });
  assert.equal(delivered.deliveryEvents?.[0]?.type, 'automatic_publish_result');
  assert.equal(delivered.deliveryEvents?.[0]?.status, 'published');
  assert.equal(
    delivered.deliveryEvents?.[0]?.deliveryIdentity?.approvalReceiptId,
    approval.id
  );
  assert.equal(
    delivered.deliveryEvents?.[0]?.deliveryIdentity?.deliveryAttemptId,
    `content-package-delivery:${approval.id}`
  );
  assert.equal(delivered.approvalReceipts?.[0]?.status, 'consumed');
  assert.equal(
    delivered.approvalReceipts?.[0]?.events.find(
      (event) => event.type === 'consumed'
    )?.externalEffectId,
    `content-package-delivery:${approval.id}`
  );
});

test('public delivery rejects a receipt frozen to an old content revision before every external effect', async () => {
  const setup = await createSetup('automatic_verified');
  const seededState = (await setup.repository.loadWorkspace('workspace-a'))!;
  const seededPackage = seededState.contentPackages[0]!;
  seededPackage.variants = (
    ['xiaohongshu', 'douyin', 'video_account'] as const
  ).map((platform) => ({
    currentVersionId: `${platform}-v1`,
    id: `variant-${platform}-a`,
    platform,
    versions: [
      {
        body: '正文',
        createdAt: '2026-07-18T06:00:00.000Z',
        id: `${platform}-v1`,
        orderedAssetIds: [],
        title: '标题',
        topics: [],
      },
    ],
  }));
  await setup.repository.saveWorkspace(seededState);
  const approval = await setup.service.approve(context, {
    ...actionBinding(),
    expectedRevision: 1,
    idempotencyKey: 'approve-before-variant-edit',
  });
  const operations = new OperationsApplicationService(setup.repository, {
    canvasExporter: new RecordedCanvasExportAdapter(),
    contentWriteOwnership: {
      async get() {
        return 'contentpackage';
      },
    },
    imageGenerator: new RecordedImageGenerationAdapter(),
    notifier: { async send() {} },
  });
  const module = new OperationsFoundationModule(operations, {
    delivery: setup.service,
  });
  const edited = await operations.editContentPackageVariant(context, {
    baseVersionId: 'douyin-v1',
    changes: {
      body: '正文第二版',
      orderedAssetIds: [],
      title: '标题第二版',
      topics: [],
    },
    expectedRevision: 2,
    packageId: 'package-a',
    platform: 'douyin',
  });
  const currentVersionId = edited.variants.find(
    (variant) => variant.platform === 'douyin',
  )!.currentVersionId;
  const beforeDelivery = (
    await setup.repository.loadWorkspace('workspace-a')
  )!;
  const beforePackage = structuredClone(beforeDelivery.contentPackages[0]!);

  await assert.rejects(
    module.execute({
      context,
      input: {
        action: 'deliver_content_package',
        payload: {
          ...actionBinding(),
          expectedRevision: edited.revision,
          receiptId: approval.id,
          variantVersionId: currentVersionId,
        },
      },
    }),
    (error: unknown) =>
      error instanceof ApprovalReceiptError &&
      error.gateId === 'external_revision',
  );

  const afterDelivery = (
    await setup.repository.loadWorkspace('workspace-a')
  )!;
  const afterPackage = afterDelivery.contentPackages[0]!;
  assert.equal(setup.publishCalls.length, 0);
  assert.deepEqual(afterPackage.deliveryEvents ?? [], []);
  assert.deepEqual(
    afterPackage.approvalReceipts,
    beforePackage.approvalReceipts,
  );
  assert.equal(
    afterPackage.approvalReceipts?.flatMap((receipt) => receipt.events)
      .filter((event) => event.type === 'consumed').length ?? 0,
    0,
  );
  assert.equal(afterPackage.revision, beforePackage.revision);
});

test('automatic publish rechecks expiry inside the atomic claim before provider effects', async () => {
  let clockReads = 0;
  const setup = await createSetup(
    'automatic_verified',
    false,
    undefined,
    undefined,
    undefined,
    () => {
      clockReads += 1;
      if (clockReads < 3) return '2026-07-18T07:00:00.000Z';
      return clockReads < 6
        ? '2026-07-18T07:14:59.999Z'
        : '2026-07-18T07:15:00.000Z';
    },
  );
  const approval = await setup.service.approve(context, {
    ...actionBinding(),
    actionScheduledAt: '2026-07-18T07:00:00.000Z',
    expectedRevision: 1,
    idempotencyKey: 'approve-expiry-claim-race',
  });

  await assert.rejects(
    setup.service.deliver(context, {
      ...actionBinding(),
      actionScheduledAt: '2026-07-18T07:00:00.000Z',
      expectedRevision: 2,
      receiptId: approval.id,
    }),
    (error: unknown) =>
      error instanceof ApprovalReceiptError &&
      error.code === 'APPROVAL_NOT_ACTIVE',
  );

  const stored = await setup.repository.loadWorkspace('workspace-a');
  assert.equal(setup.publishCalls.length, 0);
  assert.equal(
    stored?.contentPackages[0]?.approvalReceipts?.[0]?.status,
    'approved',
  );
});

test('approval consumes the pending entry in an existing duplicate-id aggregate', async () => {
  const setup = await createSetup('automatic_verified');
  const state = (await setup.repository.loadWorkspace('workspace-a'))!;
  const pending = state.contentPackages[0]!.approvalRequests![0]!;
  state.contentPackages[0]!.approvalRequests = [
    {
      ...pending,
      consumedAt: '2026-07-18T06:45:00.000Z',
      receiptId: 'approval-old',
      status: 'consumed',
    },
    structuredClone(pending),
  ];
  await setup.repository.saveWorkspace(state);

  const approval = await setup.service.approve(context, {
    ...actionBinding(),
    expectedRevision: 1,
    idempotencyKey: 'approve-legacy-duplicate-request',
  });
  const updated = await setup.repository.loadWorkspace('workspace-a');
  const requests = updated?.contentPackages[0]?.approvalRequests;

  assert.deepEqual(
    requests?.map((request) => request.status),
    ['consumed', 'consumed']
  );
  assert.equal(
    requests?.[0]?.status === 'consumed' ? requests[0].receiptId : undefined,
    'approval-old'
  );
  assert.equal(
    requests?.[1]?.status === 'consumed' ? requests[1].receiptId : undefined,
    approval.id
  );
});

test('concurrent deliveries consume one approval before exactly one publish', async () => {
  const setup = await createSetup('automatic_verified');
  const approval = await setup.service.approve(context, {
    ...actionBinding(),
    expectedRevision: 1,
    idempotencyKey: 'approve-concurrent-delivery',
  });

  const deliveries = await Promise.allSettled([
    setup.service.deliver(context, {
      ...actionBinding(),
      expectedRevision: 2,
      receiptId: approval.id,
    }),
    setup.service.deliver(context, {
      ...actionBinding(),
      expectedRevision: 2,
      receiptId: approval.id,
    }),
  ]);

  assert.equal(
    deliveries.filter((delivery) => delivery.status === 'fulfilled').length,
    1
  );
  assert.equal(
    deliveries.filter((delivery) => delivery.status === 'rejected').length,
    1
  );
  assert.equal(setup.publishCalls.length, 1);
});

test('a failed publish restores the approval for a retry', async () => {
  let attempts = 0;
  const setup = await createSetup('automatic_verified', false, {
    async publish() {
      attempts += 1;
      if (attempts === 1) throw new Error('provider unavailable');
      return {
        platformUrl: 'https://www.douyin.com/video/retried',
        providerReceiptId: 'douyin-publish-retried',
        status: 'published',
      };
    },
  });
  const approval = await setup.service.approve(context, {
    ...actionBinding(),
    expectedRevision: 1,
    idempotencyKey: 'approve-publish-retry',
  });

  await assert.rejects(
    setup.service.deliver(context, {
      ...actionBinding(),
      expectedRevision: 2,
      receiptId: approval.id,
    }),
    /provider unavailable/u
  );
  const afterFailure = (await setup.repository.loadWorkspace('workspace-a'))!;
  assert.equal(
    afterFailure.contentPackages[0]?.approvalReceipts?.[0]?.status,
    'approved'
  );

  const delivered = await setup.service.deliver(context, {
    ...actionBinding(),
    expectedRevision: afterFailure.contentPackages[0]!.revision,
    receiptId: approval.id,
  });

  assert.equal(attempts, 2);
  assert.equal(delivered.approvalReceipts?.[0]?.status, 'consumed');
});

test('production invalidation runtime reaches a pending delivery approval for the expired fact revision', async () => {
  const bundles = new MemoryContextBundleRepository();
  const bundle = await bundles.freeze({
    workspaceId: 'workspace-a',
    bundleId: 'bundle-a',
    compiled: compileContextBundle({
      workspaceId: 'workspace-a',
      taskId: 'task-price-a',
      sourceRevisions: Object.fromEntries(
        CONTEXT_SOURCE_REVISION_KEYS.map((key) => [key, 1])
      ) as never,
      contributions: [
        {
          dimension: 'store_facts_assets',
          key: 'offer.price',
          value: 398,
          layer: 'current_fact',
          pool: 'store_personal',
          sourceRef: 'store_fact:price-a:1',
          factRevision: { factId: 'price-a', revision: 1 },
        },
      ],
    }),
    expectedRevision: 0,
    frozenAt: '2026-07-18T06:30:00.000Z',
    frozenBy: 'owner-a',
    idempotencyKey: 'freeze-bundle-a',
    reason: 'delivery approval context',
  });
  const setup = await createSetup('automatic_verified', false, undefined, {
    bundleId: bundle.bundleId,
    hash: bundle.hash,
    revision: bundle.revision,
  });
  const approval = await setup.service.approve(context, {
    ...actionBinding(),
    expectedRevision: 1,
    idempotencyKey: 'approve-expiring',
  });
  const invalidations = createContextInvalidationRuntime({
    bundles,
    sinks: [setup.service],
  });

  await invalidations.service.invalidateExpiredFact({
    expiresAt: '2026-07-18T07:00:00.000Z',
    factId: 'price-a',
    revision: 1,
    workspaceId: 'workspace-a',
  });

  const state = await setup.repository.loadWorkspace('workspace-a');
  assert.equal(
    state?.contentPackages[0]?.approvalReceipts?.find(
      (item) => item.id === approval.id
    )?.status,
    'invalidated'
  );
});

test('manual results are native writes while legacy history remains a read-only projection', async () => {
  const setup = await createSetup('assisted', true);
  const updated = await setup.service.recordManualResult(context, {
    expectedRevision: 1,
    packageId: 'package-a',
    platform: 'douyin',
    platformUrl: 'https://www.douyin.com/video/native',
    status: 'published',
    variantVersionId: 'douyin-v1',
  });
  const timeline = await setup.service.timeline(context, 'package-a');

  assert.equal(updated.deliveryEvents?.length, 1);
  assert.deepEqual(
    timeline.map((event) => event.source),
    ['legacy_read_only', 'native']
  );
  const stored = await setup.repository.loadWorkspace('workspace-a');
  assert.equal(stored?.contentPackages[0]?.deliveryEvents?.length, 1);
});

test('manual publication record is idempotent for the same payload', async () => {
  const setup = await createSetup('assisted');
  const first = await setup.service.recordManualResult(context, {
    expectedRevision: 1,
    packageId: 'package-a',
    platform: 'douyin',
    platformUrl: 'https://www.douyin.com/video/idempotent',
    status: 'published',
    variantVersionId: 'douyin-v1',
  });
  const second = await setup.service.recordManualResult(context, {
    expectedRevision: 1,
    packageId: 'package-a',
    platform: 'douyin',
    platformUrl: 'https://www.douyin.com/video/idempotent',
    status: 'published',
    variantVersionId: 'douyin-v1',
  });

  assert.equal(first.deliveryEvents?.length, 1);
  assert.equal(second.deliveryEvents?.length, 1);
  assert.equal(second.revision, first.revision);
  assert.equal(second.deliveryEvents?.[0]?.id, first.deliveryEvents?.[0]?.id);
});

test('manual publication preserves the merchant account and reported publish time', async () => {
  const setup = await createSetup('assisted');
  const publishedAt = '2026-07-23T09:30:00.000Z';
  const recorded = await setup.service.recordManualResult(context, {
    accountDisplayLabel: '花间美甲抖音',
    expectedRevision: 1,
    packageId: 'package-a',
    platform: 'douyin',
    publishedAt,
    status: 'published',
    variantVersionId: 'douyin-v1',
  });

  const event = recorded.deliveryEvents?.[0];
  assert.equal(event?.type, 'manual_publish_result');
  if (event?.type !== 'manual_publish_result') return;
  assert.equal(event.accountDisplayLabel, '花间美甲抖音');
  assert.equal(event.occurredAt, publishedAt);
});

test('delivery revision conflict leaves exactly one canonical audit', async () => {
  const setup = await createSetup('assisted');
  const staleWrite = () =>
    setup.service.recordManualResult(context, {
      expectedRevision: 0,
      packageId: 'package-a',
      platform: 'douyin',
      status: 'published',
      variantVersionId: 'douyin-v1',
    });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      staleWrite(),
      (error: unknown) =>
        error instanceof ContentPackageDeliveryError &&
        error.code === 'CONTENT_PACKAGE_REVISION_CONFLICT'
    );
  }

  const state = (await setup.repository.loadWorkspace('workspace-a'))!;
  const conflicts = state.auditEvents.filter(
    (event) => event.action === 'content_package.revision_conflict'
  );
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0]?.details, {
    correlationId: context.correlationId,
    currentRevision: 1,
    expectedRevision: 0,
  });
  assert.equal(state.contentPackages[0]?.revision, 1);
  assert.equal(state.contentPackages[0]?.deliveryEvents?.length ?? 0, 0);
});

test('approval records the lock-local revision race before rejecting it', async () => {
  const repository = new RevisionRaceOperationsRepository();
  const setup = await createSetup(
    'automatic_verified',
    false,
    undefined,
    {
      bundleId: 'bundle-a',
      hash: 'bundle-hash-a',
      revision: 3,
    },
    repository
  );
  repository.bumpRevisionOnNextWorkspaceLock();

  await assert.rejects(
    setup.service.approve(context, {
      ...actionBinding(),
      expectedRevision: 1,
      idempotencyKey: 'approve-lock-local-race',
    }),
    (error: unknown) =>
      error instanceof ContentPackageDeliveryError &&
      error.code === 'CONTENT_PACKAGE_REVISION_CONFLICT'
  );

  const state = (await repository.loadWorkspace('workspace-a'))!;
  assert.equal(state.contentPackages[0]?.revision, 2);
  assert.equal(state.contentPackages[0]?.approvalReceipts?.length ?? 0, 0);
  assert.equal(state.contentPackages[0]?.approvalRequests?.[0]?.status, 'pending');
  const conflicts = state.auditEvents.filter(
    (event) => event.action === 'content_package.revision_conflict'
  );
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0]?.details, {
    correlationId: context.correlationId,
    currentRevision: 2,
    expectedRevision: 1,
  });
});

test('the production legacy projection reads matching handoff history without writing it', async () => {
  const projection = new ProductLegacyDeliveryProjection({
    async load() {
      return {
        handoffPackages: [
          {
            accountNickname: '门店账号',
            body: '正文',
            checklist: [],
            complianceResultId: 'compliance-a',
            contentId: 'legacy-content-a',
            contentVersionId: 'legacy-version-a',
            conversionText: '预约',
            createdAt: '2026-07-17T06:00:00.000Z',
            expiresAt: '2026-07-20T06:00:00.000Z',
            exportEvents: [
              {
                createdAt: '2026-07-17T06:10:00.000Z',
                id: 'legacy-opened-a',
                type: 'opened',
                userId: 'owner-a',
              },
            ],
            id: 'handoff-a',
            manualReports: [
              {
                createdAt: '2026-07-17T06:20:00.000Z',
                id: 'legacy-report-a',
                outcome: 'published',
                platformUrl: 'https://www.douyin.com/video/legacy',
                userId: 'owner-a',
              },
            ],
            operatorUserId: 'owner-a',
            platform: 'douyin',
            route: 'L3_HANDOFF_PACKAGE',
            status: 'published',
            title: '标题',
            token: 'handoff-token-a',
            topics: [],
            version: 1,
          },
        ],
        workspaceId: 'workspace-a',
      } as unknown as ProductState;
    },
  });

  const events = await projection.list({
    ...contentPackage(),
    legacySource: {
      mappingConfidence: 'exact',
      sourceId: 'legacy-content-a',
      sourceType: 'product_content_item',
    },
  });

  assert.deepEqual(
    events.map((event) => [event.type, event.source]),
    [
      ['legacy_handoff_event', 'legacy_read_only'],
      ['manual_publish_result', 'legacy_read_only'],
    ]
  );
});

test('merchant chips update the result ladder while verified and inferred sources stay honest', async () => {
  const setup = await createSetup('assisted');
  await assert.rejects(
    setup.service.recordResultSignal(context, {
      expectedRevision: 1,
      kind: 'store_visit',
      packageId: 'package-a',
    }),
    /after a published delivery event/iu
  );
  const stateWithOldHistory = (await setup.repository.loadWorkspace(
    'workspace-a'
  ))!;
  stateWithOldHistory.contentPackages.push({
    ...contentPackage(),
    deliveryEvents: [
      {
        actorId: 'owner-a',
        id: 'old-publish-a',
        occurredAt: '2026-07-10T07:00:00.000Z',
        platform: 'douyin',
        source: 'native',
        status: 'published',
        type: 'manual_publish_result',
        variantVersionId: 'douyin-v1',
      },
    ],
    id: 'old-package-a',
    resultSignals: [
      {
        actorId: 'owner-a',
        id: 'old-signal-a',
        kind: 'private_message',
        occurredAt: '2026-07-10T07:10:00.000Z',
        source: 'merchant_recorded',
      },
    ],
  });
  await setup.repository.saveWorkspace(stateWithOldHistory);
  await setup.service.recordManualResult(context, {
    expectedRevision: 1,
    packageId: 'package-a',
    platform: 'douyin',
    status: 'published',
    variantVersionId: 'douyin-v1',
  });
  const updated = await setup.service.recordResultSignal(context, {
    expectedRevision: 2,
    kind: 'store_visit',
    packageId: 'package-a',
  });
  const results = await setup.service.results(context, 'package-a');

  assert.equal(updated.resultSignals?.[0]?.source, 'merchant_recorded');
  assert.equal(results.signals.verified.length, 0);
  assert.equal(results.signals.merchant.length, 1);
  assert.equal(results.signals.inferred.length, 1);
  assert.match(results.signals.inferred[0]?.note ?? '', /不代表.*导致/u);
  assert.deepEqual(
    results.ladder.filter((step) => step.reached).map((step) => step.id),
    [
      'published',
      'attention',
      'consultation',
      'appointment_or_purchase',
      'redeemed_or_visited',
    ]
  );

  const stopped = await setup.service.recordResultReviewAction(context, {
    action: 'stop_series',
    expectedRevision: 3,
    packageId: 'package-a',
  });
  assert.equal(stopped.resultReviewActions?.at(-1)?.action, 'stop_series');
});

test('a backdated chip moves the signal clock without ageing the package', async () => {
  const setup = await createSetup('assisted');
  await setup.service.recordManualResult(context, {
    expectedRevision: 1,
    packageId: 'package-a',
    platform: 'douyin',
    status: 'published',
    variantVersionId: 'douyin-v1',
  });
  const before = (await setup.repository.loadWorkspace(
    'workspace-a'
  ))!.contentPackages.find((candidate) => candidate.id === 'package-a')!;

  // One day behind the frozen test clock (2026-07-18T07:00Z).
  const yesterday = '2026-07-17T09:30:00.000Z';
  const updated = await setup.service.recordResultSignal(context, {
    expectedRevision: 2,
    kind: 'store_visit',
    note: '带朋友一起来的',
    occurredAt: yesterday,
    packageId: 'package-a',
    quantity: 3,
  });

  const signal = updated.resultSignals?.at(-1);
  assert.equal(signal?.occurredAt, yesterday);
  assert.equal(signal?.quantity, 3);
  assert.equal(signal?.note, '带朋友一起来的');
  // The row is still written now: updatedAt must not travel backwards.
  assert.ok(
    updated.updatedAt >= before.updatedAt,
    `${updated.updatedAt} < ${before.updatedAt}`
  );
  assert.ok(updated.updatedAt > yesterday);

  // The inferred tier mirrors the merchant clock, still without causal words.
  const results = await setup.service.results(context, 'package-a');
  assert.equal(results.signals.inferred.at(-1)?.occurredAt, yesterday);
  assert.match(results.signals.inferred.at(-1)?.note ?? '', /不代表.*导致/u);
});

test('an omitted occurredAt still stamps the signal now', async () => {
  const setup = await createSetup('assisted');
  await setup.service.recordManualResult(context, {
    expectedRevision: 1,
    packageId: 'package-a',
    platform: 'douyin',
    status: 'published',
    variantVersionId: 'douyin-v1',
  });
  const updated = await setup.service.recordResultSignal(context, {
    expectedRevision: 2,
    kind: 'attention',
    packageId: 'package-a',
  });
  assert.equal(updated.resultSignals?.at(-1)?.occurredAt, updated.updatedAt);
});

test('the merchant clock is bounded by the write clock, not only by its format', async () => {
  const setup = await createSetup('assisted');
  await setup.service.recordManualResult(context, {
    expectedRevision: 1,
    packageId: 'package-a',
    platform: 'douyin',
    status: 'published',
    variantVersionId: 'douyin-v1',
  });
  // Frozen test clock: 2026-07-18T07:00Z.
  await assert.rejects(
    setup.service.recordResultSignal(context, {
      expectedRevision: 2,
      kind: 'store_visit',
      occurredAt: '2026-07-18T07:00:00.001Z',
      packageId: 'package-a',
    }),
    (error: unknown) =>
      error instanceof ContentPackageDeliveryError &&
      error.code === 'RESULT_SIGNAL_OCCURRED_AT_OUT_OF_RANGE' &&
      /future/iu.test(error.message)
  );
  // 31 days back — one day past the window the weekly review aggregates over.
  await assert.rejects(
    setup.service.recordResultSignal(context, {
      expectedRevision: 2,
      kind: 'store_visit',
      occurredAt: '2026-06-17T06:59:00.000Z',
      packageId: 'package-a',
    }),
    (error: unknown) =>
      error instanceof ContentPackageDeliveryError &&
      error.code === 'RESULT_SIGNAL_OCCURRED_AT_OUT_OF_RANGE' &&
      error.status === 409
  );
  // Neither rejection may have written a row.
  const untouched = await setup.service.results(context, 'package-a');
  assert.equal(untouched.signals.merchant.length, 0);

  // 「昨天」 — the case the window exists to keep.
  const updated = await setup.service.recordResultSignal(context, {
    expectedRevision: 2,
    kind: 'store_visit',
    occurredAt: '2026-07-17T09:30:00.000Z',
    packageId: 'package-a',
  });
  assert.equal(
    updated.resultSignals?.at(-1)?.occurredAt,
    '2026-07-17T09:30:00.000Z'
  );
});

test('a result note carrying contact details is refused by the server, not only by the panel', async () => {
  const setup = await createSetup('assisted');
  await setup.service.recordManualResult(context, {
    expectedRevision: 1,
    packageId: 'package-a',
    platform: 'douyin',
    status: 'published',
    variantVersionId: 'douyin-v1',
  });
  for (const note of ['微信 13800138000', 'a'.repeat(121), 'lee@store.com']) {
    await assert.rejects(
      setup.service.recordResultSignal(context, {
        expectedRevision: 2,
        kind: 'store_visit',
        note,
        packageId: 'package-a',
      }),
      (error: unknown) =>
        error instanceof ContentPackageDeliveryError &&
        error.code === 'RESULT_SIGNAL_NOTE_REJECTED'
    );
  }
  const stored = await setup.service.recordResultSignal(context, {
    expectedRevision: 2,
    kind: 'store_visit',
    note: '带朋友一起来的',
    packageId: 'package-a',
  });
  assert.equal(stored.resultSignals?.at(-1)?.note, '带朋友一起来的');
});

async function createSetup(
  mode: 'assisted' | 'automatic_verified',
  legacy = false,
  publisherOverride?: ContentPackagePublishPort,
  approvalContext: ApprovalBinding['contextBundle'] = {
    bundleId: 'bundle-a',
    hash: 'bundle-hash-a',
    revision: 3,
  },
  repository: MemoryOperationsRepository = new MemoryOperationsRepository(),
  clock: () => string = () => '2026-07-18T07:00:00.000Z',
) {
  repository.grantMembership('owner-a', 'workspace-a');
  await repository.saveWorkspace(workspaceState());
  const publishCalls: Array<{
    accountId: string;
    approvalReceiptId: string;
    deliveryAttemptId: string;
    idempotencyKey: string;
  }> = [];
  const publisher: ContentPackagePublishPort = {
    async publish(input) {
      publishCalls.push({
        accountId: input.accountId,
        approvalReceiptId: input.approvalReceiptId,
        deliveryAttemptId: input.deliveryAttemptId,
        idempotencyKey: input.idempotencyKey,
      });
      if (publisherOverride) return publisherOverride.publish(input);
      return {
        platformUrl: 'https://www.douyin.com/video/automatic',
        providerReceiptId: 'douyin-publish-a',
        status: 'published',
      };
    },
  };
  const service = new ContentPackageDeliveryService(repository, {
    approvalPolicy: {
      async resolve() {
        return {
          contextBundle: approvalContext,
          policy: {
            brief: {},
            bundle: { revision: 3, workspaceId: 'workspace-a' },
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
      return { mode, platform, reason: `test_${mode}` };
    },
    clock,
    createId: idSequence(),
    ...(legacy
      ? {
          legacy: {
            async list() {
              return [
                {
                  actorId: 'legacy-owner',
                  id: 'legacy-event-a',
                  occurredAt: '2026-07-17T07:00:00.000Z',
                  platform: 'douyin' as const,
                  source: 'legacy_read_only' as const,
                  status: 'published' as const,
                  type: 'manual_publish_result' as const,
                  variantVersionId: 'legacy-version-a',
                },
              ];
            },
          },
        }
      : {}),
    publisher,
  });
  return { publishCalls, repository, service };
}

class RevisionRaceOperationsRepository extends MemoryOperationsRepository {
  private injectRevisionRace = false;

  bumpRevisionOnNextWorkspaceLock() {
    this.injectRevisionRace = true;
  }

  override async withWorkspaceLock<T>(
    workspaceId: string,
    action: (repository: OperationsRepository) => Promise<T>
  ) {
    if (this.injectRevisionRace) {
      this.injectRevisionRace = false;
      const state = (await this.loadWorkspace(workspaceId))!;
      const current = state.contentPackages[0]!;
      state.contentPackages[0] = {
        ...current,
        revision: current.revision + 1,
      };
      await this.saveWorkspace(state);
    }
    return super.withWorkspaceLock(workspaceId, action);
  }
}

class FailingSaveOperationsRepository extends MemoryOperationsRepository {
  private shouldFailNextSave = false;

  failNextSave() {
    this.shouldFailNextSave = true;
  }

  override async saveWorkspace(state: OperationsWorkspaceState) {
    if (this.shouldFailNextSave) {
      this.shouldFailNextSave = false;
      throw new Error('simulated persistence failure');
    }
    return super.saveWorkspace(state);
  }
}

async function seedSuccessfulExport(repository: MemoryOperationsRepository) {
  const state = (await repository.loadWorkspace('workspace-a'))!;
  state.contentPackages[0]!.exportReceipts.push({
    artifactAssetId: 'export-asset-a',
    artifactObjectKey: 'workspace-a/exports/package-a.zip',
    contentType: 'application/zip',
    createdAt: '2026-07-18T06:30:00.000Z',
    id: 'export-receipt-a',
    platform: 'douyin',
    status: 'succeeded',
    variantVersionId: 'douyin-v1',
  });
  await repository.saveWorkspace(state);
}

function actionBinding() {
  return {
    accountId: 'douyin-account-a',
    actionKind: 'publish' as const,
    actionScheduledAt: '2026-07-18T08:00:00.000Z',
    cost: { amount: 0, currency: 'CNY' as const },
    packageId: 'package-a',
    platform: 'douyin' as const,
    purpose: 'publish_current_variant',
    requestId: 'approval-request-a',
    variantVersionId: 'douyin-v1',
  };
}

function contentPackage(): ContentPackage {
  return {
    compliance: { aigcLabelEnabled: true, watermarkEnabled: false },
    createdAt: '2026-07-18T06:00:00.000Z',
    approvalRequests: [
      {
        actionKind: 'publish',
        contentPackageRevision: 1,
        createdAt: '2026-07-18T06:30:00.000Z',
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
    exportReceipts: [],
    generated: { assetIds: [], childRuns: [] },
    id: 'package-a',
    kind: 'image_text',
    lineage: {},
    revision: 1,
    rights: { state: 'authorized' },
    source: { assetIds: [], workflowId: 'workflow-a' },
    status: 'accepted',
    updatedAt: '2026-07-18T06:00:00.000Z',
    variants: [
      {
        currentVersionId: 'douyin-v1',
        id: 'variant-douyin-a',
        platform: 'douyin',
        versions: [
          {
            body: '正文',
            createdAt: '2026-07-18T06:00:00.000Z',
            id: 'douyin-v1',
            orderedAssetIds: [],
            title: '标题',
            topics: [],
          },
        ],
      },
    ],
    versions: [],
    workspaceId: 'workspace-a',
  };
}

function workspaceState(): OperationsWorkspaceState {
  return {
    auditEvents: [],
    commandReceipts: [],
    composerConversations: [],
    contentPackages: [contentPackage()],
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

function idSequence() {
  let value = 0;
  return () => `delivery-id-${++value}`;
}
