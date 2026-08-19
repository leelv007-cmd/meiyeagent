/**
 * V31-17 P1 action tests: publish handoff, A19 reject, capability three-state,
 * merchant published revision binding, self-report idempotency via OutcomeEvidence.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  approvalReceiptIdSchema,
  buildOutcomeEvidenceIdempotencyKey,
  type ContentPackage,
} from '@meiye/contracts';

import { CanonicalAssistedDeliveryError } from '../result-delivery/assisted-canonical-repository.js';
import { AssistedReceiptService } from '../result-delivery/assisted-receipt-service.js';
import { MemoryAssistedReceiptRepository } from '../result-delivery/assisted-receipt-repository.js';
import { ResultDeliveryFoundationModule } from '../result-delivery/foundation-module.js';
import {
  ContentPackageDeliveryService,
  type ContentPackagePublishPort,
} from './content-package-delivery.js';
import { OperationsFoundationModule } from './foundation-module.js';
import {
  projectPublishHandoffView,
  PublishHandoffError,
  PublishHandoffService,
} from './publish-handoff.js';
import { MemoryOperationsRepository } from './repository.js';
import type { OperationContext, OperationsWorkspaceState } from './types.js';

const context: OperationContext = {
  actor: 'owner',
  correlationId: 'publish-handoff-test',
  userId: 'owner-a',
  workspaceId: 'workspace-a',
};

test('projectPublishHandoffView: copy blocks + ordered images + no fake direct publish', () => {
  const view = projectPublishHandoffView({
    contentPackage: contentPackage({
      title: '周末护理',
      body: '预约从速',
      topics: ['美甲'],
      conversionHook: '私信预约',
      orderedAssetIds: ['img-1', 'img-2'],
    }),
    platform: 'xiaohongshu',
    variantVersionId: 'xhs-v1',
    capabilityMode: 'assisted',
    storeName: '美美店',
  });
  assert.deepEqual(
    view.copyBlocks.map((b) => b.role),
    ['title', 'body', 'topics', 'cta'],
  );
  assert.deepEqual(view.orderedImagePaths, ['images/01.jpg', 'images/02.jpg']);
  assert.equal(view.capability.showDirectPublish, false);
  assert.equal(view.publicationBindingRevision, 1);
  assert.match(view.zipFileName ?? '', /美美店-图文-小红书-20260808-r1\.zip/);
});

test('unavailable capability never presents as direct publish', () => {
  const view = projectPublishHandoffView({
    contentPackage: contentPackage(),
    platform: 'douyin',
    variantVersionId: 'douyin-v1',
    capabilityMode: 'unavailable',
  });
  assert.equal(view.capability.mode, 'unavailable');
  assert.equal(view.capability.showDirectPublish, false);
  assert.equal(view.capability.showAssistedHandoff, false);
  assert.equal(view.capability.showExportAndCopy, true);
});

test('A19: attemptPublishFromHandoff rejects driven intents', async () => {
  const setup = await createSetup('assisted');
  for (const intent of [
    'system_driven_publish',
    'automatic_verified_publish',
    'platform_api_publish',
  ] as const) {
    const decision = setup.handoff.attemptPublishFromHandoff({
      handoffToken: 'any-token',
      intent,
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.equal(decision.code, 'DRIVEN_PUBLISH_FROM_HANDOFF_REJECTED');
      assert.equal(decision.authority, 'A19');
    }
  }
  const allowed = setup.handoff.attemptPublishFromHandoff({
    handoffToken: 'any-token',
    intent: 'merchant_self_publish',
  });
  assert.equal(allowed.ok, true);
});

test('prepareMobilePublishHandoff freezes merchant_self_publish QR materials', async () => {
  const setup = await createDeliveredSetup();
  const view = await setup.handoff.prepareMobilePublishHandoff(context, {
    packageId: 'package-a',
    expectedRevision: setup.delivered.revision,
    platform: 'douyin',
    variantVersionId: 'douyin-v1',
    workId: 'work-1',
  });
  assert.ok(view.mobileHandoff);
  assert.equal(view.mobileHandoff?.publishActor, 'merchant_self_publish');
  assert.equal(view.mobileHandoff?.systemDrivenPublishAllowed, false);
  assert.equal(
    view.mobileHandoff?.contentPackageRef.revision,
    setup.delivered.revision,
  );
  assert.match(view.mobileHandoff?.handoffUrl ?? '', /\/dashboard\/handoff\//);
  assert.equal(view.capability.showDirectPublish, false);
  const afterPrepare = await setup.repository.loadWorkspace('workspace-a');
  assert.equal(
    afterPrepare?.contentPackages[0]?.approvalReceipts?.[0]?.events.length,
    2,
  );
  assert.equal(
    afterPrepare?.contentPackages[0]?.revision,
    setup.delivered.revision,
  );

  // Driven attempt with the prepared token still rejects.
  const reject = setup.handoff.attemptPublishFromHandoff({
    handoffToken: view.mobileHandoff!.token,
    intent: 'system_driven_publish',
  });
  assert.equal(reject.ok, false);
});

test('operations handoff token is consumed through the canonical result-delivery public seam', async () => {
  const setup = await createDeliveredSetup();
  const operations = new OperationsFoundationModule({} as never, {
    publishHandoff: setup.handoff,
  });
  const resultDelivery = new ResultDeliveryFoundationModule({} as never, {
    assistedReceipts: setup.assistedReceipts,
  });

  const prepared = (await operations.execute({
    context,
    input: {
      action: 'prepare_mobile_publish_handoff',
      payload: {
        packageId: 'package-a',
        expectedRevision: setup.delivered.revision,
        platform: 'douyin',
        variantVersionId: 'douyin-v1',
        workId: 'work-1',
      },
    },
  })) as { mobileHandoff?: { token: string } };
  const token = prepared.mobileHandoff?.token;
  assert.ok(token);

  const refreshed = (await operations.execute({
    context,
    input: {
      action: 'prepare_mobile_publish_handoff',
      payload: {
        packageId: 'package-a',
        expectedRevision: setup.delivered.revision,
        platform: 'douyin',
        variantVersionId: 'douyin-v1',
        workId: 'work-1',
      },
    },
  })) as { mobileHandoff?: { token: string } };
  assert.equal(refreshed.mobileHandoff?.token, token);
  assert.equal((await setup.assistedReceipts.list(context)).length, 1);

  const wrongWorkspace = (await resultDelivery.execute({
    context: { ...context, workspaceId: 'workspace-b' },
    idempotencyKey: 'consume-workbench-handoff-wrong-workspace',
    input: {
      action: 'assisted_consume_handoff',
      payload: { token, now: '2026-08-08T12:00:30.000Z' },
    },
  })) as { kind: string };
  assert.equal(wrongWorkspace.kind, 'not_found');

  const consumed = (await resultDelivery.execute({
    context,
    idempotencyKey: 'consume-workbench-handoff',
    input: {
      action: 'assisted_consume_handoff',
      payload: { token, now: '2026-08-08T12:01:00.000Z' },
    },
  })) as { kind: string; receipt?: { packageId: string } };

  assert.equal(consumed.kind, 'ok');
  assert.equal(consumed.receipt?.packageId, 'package-a');

  const replay = (await resultDelivery.execute({
    context,
    idempotencyKey: 'replay-workbench-handoff',
    input: {
      action: 'assisted_consume_handoff',
      payload: { token, now: '2026-08-08T12:02:00.000Z' },
    },
  })) as { kind: string };
  assert.equal(replay.kind, 'replay');

  const published = await setup.handoff.recordMerchantPublished(context, {
    packageId: 'package-a',
    expectedRevision: setup.delivered.revision,
    platform: 'douyin',
    variantVersionId: 'douyin-v1',
    workId: 'work-1',
  });
  const publishedEvent = published.deliveryEvents?.at(-1);
  assert.equal(publishedEvent?.type, 'manual_publish_result');
  if (publishedEvent?.type === 'manual_publish_result') {
    assert.equal(publishedEvent.beforeRevision, setup.delivered.revision);
    assert.equal(publishedEvent.afterRevision, published.revision);
    assert.equal(publishedEvent.artifactReceiptId, 'export-receipt-a');
    assert.equal(
      publishedEvent.deliveryIdentity?.approvalReceiptId,
      setup.approval.id,
    );
  }
  const afterPublishRefresh = (await operations.execute({
    context,
    input: {
      action: 'prepare_mobile_publish_handoff',
      payload: {
        packageId: 'package-a',
        expectedRevision: published.revision,
        platform: 'douyin',
        variantVersionId: 'douyin-v1',
        workId: 'work-1',
      },
    },
  })) as {
    mobileHandoff?: { token: string };
    publicationBindingRevision: number;
  };
  assert.equal(afterPublishRefresh.mobileHandoff?.token, token);
  assert.equal(afterPublishRefresh.publicationBindingRevision, published.revision);

  const stored = await setup.assistedReceipts.list(context);
  assert.equal(stored[0]?.revision, 2);
  assert.equal(
    stored[0]?.receipt.events.filter(
      (event) => event.type === 'handoff_link_consumed',
    ).length,
    1,
  );
});

test('canonical handoff expiry and cancelled package fail closed without side effects', async () => {
  const expiredSetup = await createDeliveredSetup();
  const prepared = await expiredSetup.handoff.prepareMobilePublishHandoff(
    context,
    {
      packageId: 'package-a',
      expectedRevision: expiredSetup.delivered.revision,
      platform: 'douyin',
      variantVersionId: 'douyin-v1',
      workId: 'work-1',
    },
  );
  assert.ok(prepared.mobileHandoff);
  const expired = await expiredSetup.assistedReceipts.consume(context, {
    token: prepared.mobileHandoff.token,
    now: '2026-08-11T12:00:00.001Z',
  });
  assert.equal(expired.kind, 'expired');
  const afterExpiry = await expiredSetup.assistedReceipts.list(context);
  assert.equal(afterExpiry[0]?.revision, 1);
  assert.equal(afterExpiry[0]?.receipt.handoffLink?.consumedAt, undefined);

  const cancelledSetup = await createSetup('assisted');
  const state = await cancelledSetup.repository.loadWorkspace('workspace-a');
  assert.ok(state);
  assert.ok(state.contentPackages[0]);
  state.contentPackages[0] = {
    ...state.contentPackages[0],
    status: 'cancelled',
  };
  await cancelledSetup.repository.seedWorkspace(state);
  await assert.rejects(
    cancelledSetup.handoff.prepareMobilePublishHandoff(context, {
      packageId: 'package-a',
      expectedRevision: 1,
      platform: 'douyin',
      variantVersionId: 'douyin-v1',
      workId: 'work-1',
    }),
    (error: unknown) =>
      error instanceof PublishHandoffError &&
      error.code === 'CONTENT_PACKAGE_NOT_DELIVERED',
  );
  assert.deepEqual(await cancelledSetup.assistedReceipts.list(context), []);
  const cancelledState = await cancelledSetup.repository.loadWorkspace(
    'workspace-a',
  );
  assert.equal(cancelledState?.auditEvents.length, 0);
});

test('published handoff recovery rejects r+2, old mutation, and wrong delivery identity', async () => {
  const assertRejected = async (
    mutate: (state: OperationsWorkspaceState) => void,
  ) => {
    const setup = await createDeliveredSetup();
    await setup.handoff.prepareMobilePublishHandoff(context, {
      packageId: 'package-a',
      expectedRevision: setup.delivered.revision,
      platform: 'douyin',
      variantVersionId: 'douyin-v1',
      workId: 'work-1',
    });
    await setup.handoff.recordMerchantPublished(context, {
      packageId: 'package-a',
      expectedRevision: setup.delivered.revision,
      platform: 'douyin',
      variantVersionId: 'douyin-v1',
      workId: 'work-1',
    });
    const state = await setup.repository.loadWorkspace('workspace-a');
    assert.ok(state);
    mutate(state);
    await setup.repository.seedWorkspace(state);
    await assert.rejects(
      setup.handoff.prepareMobilePublishHandoff(context, {
        packageId: 'package-a',
        expectedRevision: state.contentPackages[0]!.revision,
        platform: 'douyin',
        variantVersionId: 'douyin-v1',
        workId: 'work-1',
      }),
      (error: unknown) =>
        error instanceof CanonicalAssistedDeliveryError &&
        error.code === 'CANONICAL_REVISION_MISMATCH',
    );
  };

  await assertRejected((state) => {
    state.contentPackages[0] = {
      ...state.contentPackages[0]!,
      revision: state.contentPackages[0]!.revision + 1,
    };
  });
  await assertRejected((state) => {
    const event = state.contentPackages[0]?.deliveryEvents?.at(-1);
    assert.equal(event?.type, 'manual_publish_result');
    if (event?.type === 'manual_publish_result') {
      event.beforeRevision = (event.beforeRevision ?? 1) - 1;
    }
  });
  await assertRejected((state) => {
    const event = state.contentPackages[0]?.deliveryEvents?.at(-1);
    assert.equal(event?.type, 'manual_publish_result');
    if (event?.type === 'manual_publish_result') {
      event.deliveryIdentity = {
        approvalReceiptId: approvalReceiptIdSchema.parse('approval-wrong'),
        deliveryAttemptId: 'content-package-delivery:approval-wrong',
        schema: 'approval_receipt_v1',
      };
    }
  });
});

test('recordMerchantPublished binds exact ContentPackage revision', async () => {
  const setup = await createSetup('assisted');
  const updated = await setup.handoff.recordMerchantPublished(context, {
    packageId: 'package-a',
    expectedRevision: 1,
    platform: 'douyin',
    variantVersionId: 'douyin-v1',
    platformUrl: 'https://www.douyin.com/video/manual-1',
    note: '已在手机发布',
  });
  assert.equal(updated.revision, 2);
  const event = updated.deliveryEvents?.find(
    (row) => row.type === 'manual_publish_result',
  );
  assert.ok(event);
  if (event?.type === 'manual_publish_result') {
    assert.equal(event.status, 'published');
    assert.equal(event.variantVersionId, 'douyin-v1');
  }

  await assert.rejects(
    setup.handoff.recordMerchantPublished(context, {
      packageId: 'package-a',
      expectedRevision: 1, // stale
      platform: 'douyin',
      variantVersionId: 'douyin-v1',
      note: 'stale retry different',
      platformUrl: 'https://www.douyin.com/video/other',
    }),
    (error: unknown) =>
      error instanceof Error &&
      /revision/iu.test(error.message),
  );
});

test('self-report write path is OutcomeEvidence-idempotent and binds package revision', async () => {
  const setup = await createSetup('assisted');
  await setup.handoff.recordMerchantPublished(context, {
    packageId: 'package-a',
    expectedRevision: 1,
    platform: 'douyin',
    variantVersionId: 'douyin-v1',
  });

  const input = {
    packageId: 'package-a',
    expectedRevision: 2,
    signal: 'inquiry' as const,
    sourceRef: 'chip:inquiry',
    occurredAt: '2026-08-08T10:00:00.000Z',
    workId: 'work-1',
  };
  const first = await setup.handoff.recordSelfReportSignal(context, input);
  assert.equal(first.resultSignals?.length, 1);
  assert.equal(first.resultSignals?.[0]?.kind, 'inquiry');
  assert.equal(first.resultSignals?.[0]?.source, 'merchant_recorded');

  const key = buildOutcomeEvidenceIdempotencyKey({
    contentPackageId: 'package-a',
    contentPackageRevision: 2,
    signal: 'inquiry',
    observedAt: '2026-08-08T10:00:00.000Z',
    sourceRef: 'chip:inquiry',
  });
  assert.match(key, /package-a\|2\|inquiry/);

  // Same identity retries do not append (idempotent).
  const retry = await setup.handoff.recordSelfReportSignal(context, {
    ...input,
    expectedRevision: first.revision,
  });
  assert.equal(retry.resultSignals?.length, 1);

  // no_activity first-class chip
  const quiet = await setup.handoff.recordSelfReportSignal(context, {
    packageId: 'package-a',
    expectedRevision: retry.revision,
    signal: 'no_activity',
    sourceRef: 'chip:no_activity',
    occurredAt: '2026-08-08T11:00:00.000Z',
  });
  assert.equal(
    quiet.resultSignals?.some((row) => row.kind === 'no_activity'),
    true,
  );
});

test('U2 self-report ask: next day once, one ask per work, two ignores store backoff', async () => {
  // The ask window is read from the durable publish event, so this test builds
  // the real handoff + publish facts and then moves the clock, instead of
  // handing the service a publishHandoffCompletedAt it chose.
  let now = '2026-08-08T10:00:00.000Z';
  const setup = await createDeliveredSetup(() => now);
  const askFor = (workId: string) =>
    setup.handoff.evaluateSelfReportAskForWork(context, {
      workId,
      contentPackageId: 'package-a',
      platform: 'douyin',
      variantVersionId: 'douyin-v1',
    });

  // No publish yet: nothing to follow up on.
  const beforePublish = await askFor('work-1');
  assert.equal(beforePublish.kind, 'skip');

  await setup.handoff.prepareMobilePublishHandoff(context, {
    packageId: 'package-a',
    expectedRevision: setup.delivered.revision,
    platform: 'douyin',
    variantVersionId: 'douyin-v1',
    workId: 'work-1',
  });
  await setup.handoff.recordMerchantPublished(context, {
    packageId: 'package-a',
    expectedRevision: setup.delivered.revision,
    platform: 'douyin',
    variantVersionId: 'douyin-v1',
    workId: 'work-1',
  });

  // Same day as the publish — the follow-up is a next-day question.
  const sameDay = await askFor('work-1');
  assert.equal(sameDay.kind, 'skip');

  now = '2026-08-09T12:00:00.000Z';
  const ready = await askFor('work-1');
  assert.equal(ready.kind, 'ask');
  if (ready.kind === 'ask') {
    // The ask carries the server head, not a revision the caller named.
    assert.equal(ready.contentPackageRevision, setup.delivered.revision + 1);
  }

  await setup.handoff.recordSelfReportAsk(context, {
    workId: 'work-1',
    contentPackageId: 'package-a',
    contentPackageRevision: setup.delivered.revision + 1,
    action: 'mark_asked',
  });
  const again = await askFor('work-1');
  assert.equal(again.kind, 'skip');
  if (again.kind === 'skip') {
    assert.equal(again.reason, 'already_asked_this_work');
  }

  // A work with no durable publish of its own never gets a follow-up, however
  // the browser asks. (The two-ignore store backoff rule itself is covered on
  // the pure evaluator in packages/contracts/src/publish-handoff.test.ts.)
  const foreignWork = await askFor('work-3');
  assert.equal(foreignWork.kind, 'skip');
  if (foreignWork.kind === 'skip') {
    assert.equal(foreignWork.reason, 'no_publish_handoff');
  }
});

test('video handoff projects safety-zone checklist without cover/subtitle slots (V31-61)', () => {
  const view = projectPublishHandoffView({
    contentPackage: contentPackage({ kind: 'video', orderedAssetIds: ['vid-1'] }),
    platform: 'douyin',
    variantVersionId: 'douyin-v1',
    capabilityMode: 'assisted',
    isVideo: true,
  });
  assert.ok(view.videoSafety);
  assert.equal(
    view.videoSafety ? 'includeCoverSlot' in view.videoSafety : true,
    false,
  );
  assert.equal(
    view.videoSafety ? 'includeSubtitlesTrack' in view.videoSafety : true,
    false,
  );
  assert.match(view.videoSafety?.platformSafeZoneReminder ?? '', /安全区/);
});

// ─── fixtures ───────────────────────────────────────────────────────────────

async function createSetup(
  mode: 'assisted' | 'automatic_verified' | 'unavailable',
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
      return { mode, platform, reason: `test_${mode}` };
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
      mode,
      platform: platform as 'douyin',
      reason: `test_${mode}`,
    }),
  });

  return { assistedReceipts, delivery, handoff, repository };
}

async function createDeliveredSetup(
  clock: () => string = () => '2026-08-08T12:00:00.000Z',
) {
  const setup = await createSetup('assisted', clock);
  const binding = {
    accountId: 'douyin-account-a',
    actionKind: 'publish' as const,
    actionScheduledAt: '2026-08-08T13:00:00.000Z',
    cost: { amount: 0, currency: 'CNY' as const },
    packageId: 'package-a',
    platform: 'douyin' as const,
    purpose: 'publish_current_variant',
    requestId: 'approval-request-a',
    variantVersionId: 'douyin-v1',
  };
  const approval = await setup.delivery.approve(context, {
    ...binding,
    expectedRevision: 1,
    idempotencyKey: 'approve-canonical-workbench-handoff',
  });
  const delivered = await setup.delivery.deliver(context, {
    ...binding,
    expectedRevision: 2,
    receiptId: approval.id,
  });
  assert.equal(delivered.approvalReceipts?.[0]?.status, 'consumed');
  assert.equal(delivered.deliveryEvents?.[0]?.type, 'assisted_handoff_prepared');
  return { ...setup, approval, delivered };
}

function contentPackage(
  overrides: {
    title?: string;
    body?: string;
    topics?: string[];
    conversionHook?: string;
    orderedAssetIds?: string[];
    kind?: ContentPackage['kind'];
  } = {},
): ContentPackage {
  const versionId = overrides.kind === 'video' ? 'douyin-v1' : 'xhs-v1';
  const platform =
    overrides.kind === 'video' || !overrides.title
      ? ('douyin' as const)
      : ('xiaohongshu' as const);
  const version = {
    body: overrides.body ?? '正文',
    createdAt: '2026-08-08T06:00:00.000Z',
    id: versionId,
    orderedAssetIds: overrides.orderedAssetIds ?? ['asset-1'],
    title: overrides.title ?? '标题',
    topics: overrides.topics ?? ['护理'],
    ...(overrides.conversionHook
      ? { conversionHook: overrides.conversionHook }
      : { conversionHook: '私信预约' }),
  };
  return {
    compliance: { aigcLabelEnabled: true, watermarkEnabled: false },
    createdAt: '2026-08-08T06:00:00.000Z',
    exportReceipts: [],
    generated: { assetIds: [], childRuns: [] },
    id: 'package-a',
    kind: overrides.kind ?? 'image_text',
    lineage: {},
    revision: 1,
    rights: { state: 'authorized' },
    source: { assetIds: [], workflowId: 'workflow-a', workId: 'work-1' },
    status: 'accepted',
    updatedAt: '2026-08-08T06:00:00.000Z',
    variants: [
      {
        currentVersionId: versionId,
        id: `variant-${platform}`,
        platform,
        versions: [version],
      },
    ],
    versions: [version],
    workspaceId: 'workspace-a',
  };
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
