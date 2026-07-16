import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import sharp from 'sharp';
import {
  DEFAULT_CANVAS_TEMPLATE_NAME,
  DEFAULT_CANVAS_WORK_NAME,
  officialCanvasTemplateName,
  officialCanvasWorkName,
} from '@meiye/contracts';
import {
  type BatchExecutionPort,
  MemoryOperationsRepository,
  OperationsApplicationService,
  RecordedBatchExecutionAdapter,
  RecordedCanvasExportAdapter,
  RecordedImageGenerationAdapter,
  type OperationContext,
  type ImageGenerationPort,
  type TaskNotification,
} from './index.js';

const owner: OperationContext = {
  actor: 'owner',
  correlationId: 'corr-p1-operations',
  userId: 'owner-a',
  workspaceId: 'workspace-a',
};

function setup() {
  const repository = new MemoryOperationsRepository();
  repository.grantMembership(owner.userId, owner.workspaceId);
  const notifications: TaskNotification[] = [];
  const service = new OperationsApplicationService(repository, {
    batchExecutor: new RecordedBatchExecutionAdapter(),
    canvasExporter: new RecordedCanvasExportAdapter(),
    imageGenerator: new RecordedImageGenerationAdapter(),
    notifier: {
      async send(notification) {
        notifications.push(notification);
      },
    },
  });
  return { notifications, repository, service };
}

describe('P1 operations application service', () => {
  it('delivers a recoverable task inbox, idempotent triggers, and factual weekly review', async () => {
    const { notifications, repository, service } = setup();
    assert.equal(
      await service.getLatestWeeklyReview(owner, {
        from: '2026-07-13T00:00:00.000Z',
        to: '2026-07-19T23:59:59.999Z',
      }),
      null
    );

    const draftTask = await service.createTask(owner, {
      dueAt: '2026-07-14T09:00:00.000Z',
      executable: true,
      relatedObject: { id: 'content-1', kind: 'content' },
      risk: 'normal',
      source: 'stale_draft',
      title: '确认猫眼草稿',
    });
    const missingAssetTask = await service.createTask(owner, {
      blockedReason: '缺少授权前后对比图',
      dueAt: '2026-07-15T09:00:00.000Z',
      executable: false,
      nextStep: '补充一组已授权素材',
      relatedObject: { id: 'asset-gap-1', kind: 'asset' },
      risk: 'attention',
      source: 'asset_gap',
      title: '补齐 Before/After 素材',
    });

    await service.transitionTask(owner, draftTask.id, 'in_progress');
    await service.transitionTask(owner, draftTask.id, 'done');
    const inbox = await service.listInbox(owner, {
      from: '2026-07-13T00:00:00.000Z',
      sources: ['asset_gap'],
      statuses: ['needs_asset'],
      to: '2026-07-19T23:59:59.999Z',
    });
    assert.deepEqual(
      inbox.tasks.map((task) => task.id),
      [missingAssetTask.id]
    );
    assert.equal((await service.getTask(owner, draftTask.id)).id, draftTask.id);
    assert.deepEqual(
      inbox.weekStrip.map((point) => point.date),
      ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17']
    );
    assert.equal(inbox.renderSeam, 'inline-task-components');
    assert.equal((await service.listTaskEvents(owner, draftTask.id)).length, 3);
    assert.deepEqual(
      (await service.listInbox(owner, { relatedKinds: ['asset'] })).tasks.map(
        (task) => task.id
      ),
      [missingAssetTask.id]
    );
    assert.deepEqual(
      (
        await service.search(owner, {
          kinds: ['task'],
          metadata: {
            dueDate: '2026-07-15',
            relatedKind: 'asset',
            risk: 'attention',
          },
        })
      ).map((task) => task.id),
      [missingAssetTask.id]
    );

    await service.configureTrigger(owner, 'weekly_batch_ready', true);
    const firstTrigger = await service.runTrigger(owner, {
      kind: 'weekly_batch_ready',
      sourceId: 'week-2026-29',
      timeWindow: '2026-W29',
    });
    const duplicateTrigger = await service.runTrigger(owner, {
      kind: 'weekly_batch_ready',
      sourceId: 'week-2026-29',
      timeWindow: '2026-W29',
    });
    assert.equal(duplicateTrigger.task.id, firstTrigger.task.id);
    assert.equal(duplicateTrigger.deduplicated, true);
    assert.equal(notifications.length, 1);

    const batch = await service.buildWeeklyBatch(owner, {
      from: '2026-07-13T00:00:00.000Z',
      to: '2026-07-19T23:59:59.999Z',
    });
    assert.ok(batch.included.some((item) => item.id === firstTrigger.task.id));
    assert.ok(batch.excluded.some((item) => item.id === missingAssetTask.id));
    assert.equal(
      batch.excluded.find((item) => item.id === missingAssetTask.id)?.reason,
      '缺少授权前后对比图'
    );
    const batchExecution = await service.executeWeeklyBatch(owner, {
      action: 'create',
      taskIds: [firstTrigger.task.id, missingAssetTask.id],
    });
    assert.deepEqual(
      batchExecution.completed.map((task) => task.id),
      [firstTrigger.task.id]
    );
    assert.deepEqual(batchExecution.excluded, [
      { reason: '缺少授权前后对比图', taskId: missingAssetTask.id },
    ]);
    const afterTerminal = await service.runTrigger(owner, {
      kind: 'weekly_batch_ready',
      sourceId: 'week-2026-29-replay',
      timeWindow: '2026-W29',
    });
    assert.equal(afterTerminal.task.id, firstTrigger.task.id);
    assert.equal(afterTerminal.deduplicated, true);
    assert.equal(
      (await repository.loadWorkspace(owner.workspaceId))?.triggerRuns.length,
      1
    );

    await assert.rejects(
      service.recordWeeklyFact(owner, {
        kind: 'published_mark',
        occurredAt: '2026-07-16T10:00:00.000Z',
        sourceId: 'forged-publication',
      }),
      /Trusted worker or admin identity is required/
    );
    await service.recordWeeklyFact(
      { ...owner, actor: 'worker' },
      {
        kind: 'published_mark',
        occurredAt: '2026-07-16T10:00:00.000Z',
        sourceId: 'publication-1',
      }
    );
    const review = await service.createWeeklyReview(owner, {
      from: '2026-07-13T00:00:00.000Z',
      to: '2026-07-19T23:59:59.999Z',
    });
    assert.deepEqual(review.metrics.published, { status: 'known', value: 1 });
    assert.deepEqual(review.metrics.humanLeads, { status: 'unknown' });
    assert.ok(review.nextWeekCandidates.length > 0);

    const confirmed = await service.confirmNextWeekCandidates(
      owner,
      review.id,
      [review.nextWeekCandidates[0]!.id]
    );
    assert.equal(confirmed.createdTasks.length, 1);
  });

  it('reuses the command notification key after response loss', async () => {
    const repository = new MemoryOperationsRepository();
    repository.grantMembership(owner.userId, owner.workspaceId);
    const deliveryKeys = new Set<string>();
    const attemptedKeys: string[] = [];
    const service = new OperationsApplicationService(repository, {
      canvasExporter: new RecordedCanvasExportAdapter(),
      imageGenerator: new RecordedImageGenerationAdapter(),
      notifier: {
        async send(notification) {
          attemptedKeys.push(notification.idempotencyKey);
          deliveryKeys.add(notification.idempotencyKey);
        },
      },
    });
    const task = await service.createTask(owner, {
      dueAt: '2026-07-14T09:00:00.000Z',
      executable: true,
      risk: 'normal',
      source: 'stale_draft',
      title: '重发通知',
    });
    const saveWorkspace = repository.saveWorkspace.bind(repository);
    let loseNotificationReceipt = true;
    repository.saveWorkspace = async (state) => {
      if (
        loseNotificationReceipt &&
        state.taskEvents.some(
          (event) =>
            event.event === 'notification_sent' ||
            event.event === 'notification_failed'
        )
      ) {
        throw new Error('simulated notification receipt loss');
      }
      await saveWorkspace(state);
    };
    const input = {
      action: 'retry_task_notification',
      payload: { taskId: task.id },
    };
    const run = (context: OperationContext) =>
      service.executeIdempotentModuleCommand(
        context,
        'retry-notification-command-a',
        input,
        () => service.retryTaskNotification(context, task.id)
      );

    await assert.rejects(run(owner), /simulated notification receipt loss/);
    loseNotificationReceipt = false;
    const recovered = await run({ ...owner, correlationId: 'corr-restarted' });
    assert.equal(recovered.status, 'sent');
    assert.equal(attemptedKeys.length, 2);
    assert.equal(deliveryKeys.size, 1);
    assert.equal(attemptedKeys[0], attemptedKeys[1]);
  });

  it('reconciles a delivered trigger notification after its sent receipt is lost', async () => {
    const repository = new MemoryOperationsRepository();
    repository.grantMembership(owner.userId, owner.workspaceId);
    const deliveryKeys = new Set<string>();
    const attemptedKeys: string[] = [];
    const service = new OperationsApplicationService(repository, {
      canvasExporter: new RecordedCanvasExportAdapter(),
      imageGenerator: new RecordedImageGenerationAdapter(),
      notifier: {
        async send(notification) {
          attemptedKeys.push(notification.idempotencyKey);
          deliveryKeys.add(notification.idempotencyKey);
        },
      },
    });
    await service.configureTrigger(owner, 'weekly_batch_ready', true);
    const saveWorkspace = repository.saveWorkspace.bind(repository);
    let loseSentReceipt = true;
    repository.saveWorkspace = async (state) => {
      if (
        loseSentReceipt &&
        state.taskEvents.some((event) => event.event === 'notification_sent')
      ) {
        loseSentReceipt = false;
        throw new Error('simulated trigger notification receipt loss');
      }
      await saveWorkspace(state);
    };
    const input = {
      kind: 'weekly_batch_ready' as const,
      sourceId: 'week-response-loss',
      timeWindow: '2026-W30',
    };

    await assert.rejects(
      service.runTrigger(owner, input),
      /simulated trigger notification receipt loss/
    );
    const recovered = await service.runTrigger(
      { ...owner, correlationId: 'corr-trigger-recovery' },
      input
    );

    assert.equal(recovered.deduplicated, true);
    assert.equal(attemptedKeys.length, 2);
    assert.equal(deliveryKeys.size, 1);
    assert.equal(attemptedKeys[0], attemptedKeys[1]);
    const state = await repository.loadWorkspace(owner.workspaceId);
    assert.equal(state?.triggerRuns.length, 1);
    assert.equal(state?.triggerRuns[0]?.notificationStatus, 'sent');
    assert.equal(
      state?.taskEvents.filter((event) => event.event === 'notification_sent')
        .length,
      1
    );
    assert.equal(
      state?.taskEvents.some((event) => event.event === 'notification_failed'),
      false
    );
    assert.equal(
      state?.auditEvents.filter(
        (event) => event.action === 'task.notification_sent'
      ).length,
      1
    );
    assert.equal(
      state?.auditEvents.some(
        (event) => event.action === 'task.notification_failed'
      ),
      false
    );
    const metrics = await service.getTriggerMetrics(owner);
    assert.equal(metrics.notificationsSent, 1);
    assert.equal(metrics.notificationsFailed, 0);
  });

  it('keeps official template versions immutable and traces canvas work and exports', async () => {
    const { repository, service } = setup();
    const admin = {
      ...owner,
      actor: 'admin' as const,
      userId: 'admin-a',
    };

    await service.seedOfficialTemplateFamilies(admin);
    const draftTemplate = await service.createOfficialTemplate(admin, {
      family: 'experimental_owner_hidden',
      name: '仅后台可见草稿',
      tags: ['draft-only'],
    });
    const catalog = await service.listTemplates(owner, {
      official: true,
      publicationStatuses: ['published'],
    });
    assert.equal(new Set(catalog.map((item) => item.family)).size, 7);
    const creationCatalog = await service.getCreationCatalog(owner);
    const creationCover = creationCatalog.templates.find(
      (item) => item.family === 'social_cover'
    );
    assert.equal(
      creationCover?.previewVersionId,
      creationCover?.publishedVersionId
    );
    assert.ok(creationCover?.previewDocument.pages[0]?.elements.length);
    assert.equal(
      creationCatalog.templates.some(
        (item) => item.id === draftTemplate.template.id
      ),
      false
    );
    assert.equal(
      (await service.listTemplates(owner)).some(
        (item) => item.id === draftTemplate.template.id
      ),
      false
    );
    assert.equal(
      (await service.listTemplates(admin)).some(
        (item) => item.id === draftTemplate.template.id
      ),
      true
    );
    assert.deepEqual(
      await service.search(owner, {
        kinds: ['template'],
        query: '仅后台可见草稿',
      }),
      []
    );
    assert.equal(
      (await service.search(owner, { kinds: ['template'], query: '价格卡' }))[0]
        ?.id,
      'official-price_card'
    );
    const seededCover = catalog.find((item) => item.family === 'social_cover');
    assert.ok(seededCover);
    const seededWork = await service.createWork(owner, {
      name: '可编辑封面',
      templateId: seededCover.id,
    });
    assert.ok(
      seededWork.revisions[0]?.document.pages[0]?.elements.length,
      'seeded templates must contain editable elements'
    );

    const template = catalog.find((item) => item.family === 'price_card');
    assert.ok(template?.publishedVersionId);
    const work = await service.createWork(owner, {
      name: '七月猫眼价格卡',
      templateId: template.id,
    });
    const originalVersionId = work.templateVersionId;
    assert.ok(originalVersionId);

    const nextVersion = await service.createTemplateVersion(admin, {
      document: {
        height: 1350,
        pages: [{ elements: [], id: 'page-price-card-v2' }],
        width: 1080,
      },
      templateId: template.id,
    });
    await assert.rejects(
      service.previewTemplateVersion(owner, template.id, nextVersion.id),
      /not published or retained/
    );
    await assert.rejects(
      service.copyTemplateVersionToWork(owner, {
        name: '不可复制的草稿版',
        templateId: template.id,
        templateVersionId: nextVersion.id,
      }),
      /only be copied from a retaining work/
    );
    await service.publishTemplateVersion(admin, template.id, nextVersion.id);
    const persistedDraft = (
      await repository.loadTemplateCatalog()
    ).versions.find((version) => version.id === nextVersion.id);
    assert.equal(persistedDraft?.status, 'draft');
    assert.equal(persistedDraft?.publishedAt, undefined);
    const history = await service.getTemplateCatalogHistory(admin, template.id);
    assert.equal(history.workspaceId, owner.workspaceId);
    assert.deepEqual(
      history.versions.map((version) => version.revision),
      [1, 2]
    );
    assert.equal(history.versions[1]?.id, nextVersion.id);
    assert.equal(history.versions[1]?.status, 'published');
    assert.deepEqual(history.versions[1]?.documentSummary, {
      elementCount: 0,
      height: 1350,
      pageCount: 1,
      width: 1080,
    });
    assert.equal('document' in history.versions[1]!, false);
    await assert.rejects(
      service.getTemplateCatalogHistory(owner, template.id),
      /Admin identity is required/
    );
    assert.equal(
      (await service.getWork(owner, work.id)).templateVersionId,
      originalVersionId
    );
    const currentPreview = await service.previewTemplateVersion(
      owner,
      template.id,
      nextVersion.id
    );
    assert.equal(currentPreview.versionId, nextVersion.id);
    assert.equal(currentPreview.document.pages[0]?.id, 'page-price-card-v2');
    const historicalPreview = await service.previewTemplateVersion(
      owner,
      template.id,
      originalVersionId
    );
    assert.ok(historicalPreview.document.pages[0]?.elements.length);

    const copiedHistoricalWork = await service.copyTemplateVersionToWork(
      owner,
      {
        name: '七月猫眼价格卡旧版副本',
        sourceWorkId: work.id,
        templateId: template.id,
        templateVersionId: originalVersionId,
      }
    );
    assert.notEqual(copiedHistoricalWork.id, work.id);
    assert.equal(copiedHistoricalWork.templateId, template.id);
    assert.equal(copiedHistoricalWork.templateVersionId, originalVersionId);
    assert.ok(
      copiedHistoricalWork.revisions[0]?.document.pages[0]?.elements.length
    );

    const upgraded = await service.upgradeWorkTemplate(
      owner,
      work.id,
      nextVersion.id
    );
    assert.equal(upgraded.templateVersionId, nextVersion.id);
    assert.notEqual(upgraded.currentRevisionId, work.currentRevisionId);
    assert.equal(upgraded.revisions.length, 2);
    assert.equal(upgraded.revisions[0]?.templateVersionId, originalVersionId);
    assert.equal(upgraded.revisions[1]?.templateVersionId, nextVersion.id);
    assert.equal(copiedHistoricalWork.templateVersionId, originalVersionId);

    const revision = await service.saveCanvasRevision(owner, work.id, {
      height: 1350,
      pages: [
        {
          elements: [
            {
              assetId: 'asset-price-card-photo',
              height: 320,
              id: 'price-card-photo',
              kind: 'image',
              rotation: 0,
              width: 320,
              x: 80,
              y: 300,
            },
            {
              fontFamily: 'PingFang SC',
              height: 120,
              id: 'headline',
              kind: 'text',
              rotation: 0,
              text: '透亮猫眼\n本周到店价',
              width: 760,
              x: 120,
              y: 120,
            },
          ],
          id: 'page-price-card-v2',
        },
      ],
      width: 1080,
    });
    assert.equal(revision.revision, 3);

    await service.setCreationLabels(owner, work.id, {
      aigcLabelEnabled: false,
      brandWatermarkEnabled: true,
    });
    const laterRevision = await service.saveCanvasRevision(owner, work.id, {
      height: 1350,
      pages: [{ elements: [], id: 'later-unsent-revision' }],
      width: 1080,
    });
    assert.notEqual(laterRevision.id, revision.id);
    const userTemplate = await service.saveUserTemplate(owner, {
      document: {
        height: 1350,
        pages: [
          {
            elements: [
              {
                height: 100,
                id: 'saved-user-template-title',
                kind: 'text',
                rotation: 0,
                text: '自建模板快照',
                width: 500,
                x: 100,
                y: 100,
              },
            ],
            id: 'saved-user-template-page',
          },
        ],
        width: 1080,
      },
      name: '门店常用价格卡',
      sourceRevisionId: laterRevision.id,
      workId: work.id,
    });
    assert.notEqual(userTemplate.canvasRevisionId, laterRevision.id);
    const reusedWork = await service.createWorkFromUserTemplate(owner, {
      name: '从门店常用价格卡复用',
      userTemplateId: userTemplate.id,
    });
    assert.equal(reusedWork.userTemplateId, userTemplate.id);
    const userTemplateSource = await service.getWork(owner, work.id);
    assert.deepEqual(
      reusedWork.revisions[0]?.document,
      userTemplateSource.revisions.find(
        (candidate) => candidate.id === userTemplate.canvasRevisionId
      )?.document
    );
    const renamedUserTemplate = await service.renameUserTemplate(
      owner,
      userTemplate.id,
      '门店价格模板'
    );
    const copiedUserTemplate = await service.copyUserTemplate(
      owner,
      renamedUserTemplate.id,
      '门店价格模板副本'
    );
    assert.equal(
      (await service.search(owner, { query: '门店价格模板副本' }))[0]?.id,
      copiedUserTemplate.id
    );
    await service.deleteUserTemplate(owner, copiedUserTemplate.id);
    assert.equal(
      (await service.search(owner, { query: '门店价格模板副本' })).some(
        (item) => item.id === copiedUserTemplate.id
      ),
      false
    );
    await service.setTemplateShortcuts(owner, [
      { hidden: false, rank: 0, templateId: template.id },
      { hidden: false, rank: 1, userTemplateId: userTemplate.id },
    ]);
    assert.equal((await service.listTemplateShortcuts(owner)).length, 2);

    const embeddedImage = await sharp({
      create: {
        background: { alpha: 1, b: 95, g: 144, r: 240 },
        channels: 4,
        height: 320,
        width: 320,
      },
    })
      .png()
      .toBuffer();
    const renderedPngBytes = await sharp({
      create: {
        background: { alpha: 0, b: 0, g: 0, r: 0 },
        channels: 4,
        height: 1350,
        width: 1080,
      },
    })
      .composite([
        { input: embeddedImage, left: 80, top: 300 },
        {
          input: Buffer.from(
            '<svg width="1080" height="1350"><style>text { font-family: "PingFang SC", sans-serif; font-size: 64px; fill: white; }</style><text x="120" y="150">透亮猫眼</text><text x="120" y="230">本周到店价</text></svg>'
          ),
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer();
    const [imageRegionPng, firstChineseLinePng, secondChineseLinePng] =
      await Promise.all([
        sharp(renderedPngBytes)
          .extract({ height: 320, left: 80, top: 300, width: 320 })
          .png()
          .toBuffer(),
        sharp(renderedPngBytes)
          .extract({ height: 85, left: 80, top: 80, width: 850 })
          .png()
          .toBuffer(),
        sharp(renderedPngBytes)
          .extract({ height: 85, left: 80, top: 165, width: 850 })
          .png()
          .toBuffer(),
      ]);
    const [imageRegion, firstChineseLine, secondChineseLine] =
      await Promise.all([
        sharp(imageRegionPng).ensureAlpha().stats(),
        sharp(firstChineseLinePng).ensureAlpha().stats(),
        sharp(secondChineseLinePng).ensureAlpha().stats(),
      ]);
    assert.ok(
      imageRegion.channels.slice(0, -1).some((channel) => channel.mean > 50)
    );
    assert.equal(imageRegion.channels.at(-1)?.min, 255);
    assert.equal(firstChineseLine.channels.at(-1)?.max, 255);
    assert.equal(secondChineseLine.channels.at(-1)?.max, 255);
    const renderEvidenceMarker = (bytes: Buffer) => ({
      version: 'canvas-raster-v1' as const,
      rasterSha256: createHash('sha256').update(bytes).digest('hex'),
      imageElementIds: ['price-card-photo'],
      fontFamilies: ['PingFang SC'],
      cjkLineBreakElementIds: ['headline'],
    });
    const receipt = await service.exportWork(owner, work.id, {
      format: 'png',
      height: 1350,
      renderedDataUrl: `data:image/png;base64,${renderedPngBytes.toString('base64')}`,
      renderEvidenceMarker: renderEvidenceMarker(renderedPngBytes),
      workRevisionId: revision.id,
      width: 1080,
    });
    assert.equal(receipt.workRevisionId, revision.id);
    assert.equal(receipt.format, 'png');
    assert.equal(
      receipt.sha256,
      createHash('sha256').update(renderedPngBytes).digest('hex')
    );
    assert.equal(receipt.bytes, renderedPngBytes.length);
    assert.equal(receipt.contentType, 'image/png');
    assert.deepEqual(receipt.validation, {
      markerVersion: 'canvas-raster-v1',
      document: {
        cjkLineBreakElementIds: ['headline'],
        cjkTextElementIds: ['headline'],
        fontFamilies: ['PingFang SC'],
        imageAssetIds: ['asset-price-card-photo'],
        imageElementIds: ['price-card-photo'],
      },
      raster: {
        format: 'png',
        hasAlphaChannel: true,
        hasTransparentPixels: true,
        height: 1350,
        width: 1080,
      },
    });
    assert.equal(receipt.brandWatermarkEnabled, true);
    assert.equal(receipt.aigcLabelEnabled, false);
    assert.equal('renderedDataUrl' in receipt, false);
    assert.equal('renderEvidenceMarker' in receipt, false);
    assert.deepEqual(
      (await service.listExportReceipts(owner, work.id)).map((item) => ({
        aigcLabelEnabled: item.aigcLabelEnabled,
        brandWatermarkEnabled: item.brandWatermarkEnabled,
        id: item.id,
        revision: item.workRevisionId,
      })),
      [
        {
          aigcLabelEnabled: false,
          brandWatermarkEnabled: true,
          id: receipt.id,
          revision: revision.id,
        },
      ]
    );
    const blankPngBytes = await sharp({
      create: {
        background: { alpha: 0, b: 0, g: 0, r: 0 },
        channels: 4,
        height: 1350,
        width: 1080,
      },
    })
      .png()
      .toBuffer();
    const wrongSizePngBytes = await sharp({
      create: {
        background: { alpha: 0, b: 0, g: 0, r: 0 },
        channels: 4,
        height: 1350,
        width: 1079,
      },
    })
      .png()
      .toBuffer();
    const imageOnlyPngBytes = await sharp({
      create: {
        background: { alpha: 0, b: 0, g: 0, r: 0 },
        channels: 4,
        height: 1350,
        width: 1080,
      },
    })
      .composite([{ input: embeddedImage, left: 80, top: 300 }])
      .png()
      .toBuffer();
    const singleLinePngBytes = await sharp({
      create: {
        background: { alpha: 0, b: 0, g: 0, r: 0 },
        channels: 4,
        height: 1350,
        width: 1080,
      },
    })
      .composite([
        { input: embeddedImage, left: 80, top: 300 },
        {
          input: Buffer.from(
            '<svg width="1080" height="1350"><text x="120" y="150" font-family="PingFang SC, sans-serif" font-size="64" fill="white">透亮猫眼</text></svg>'
          ),
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer();
    await assert.rejects(
      service.exportWork(owner, work.id, {
        format: 'png',
        height: 1350,
        renderedDataUrl: `data:image/png;base64,${blankPngBytes.toString('base64')}`,
        renderEvidenceMarker: renderEvidenceMarker(blankPngBytes),
        workRevisionId: revision.id,
        width: 1080,
      }),
      /missing raster evidence for image element price-card-photo/
    );
    await assert.rejects(
      service.exportWork(owner, work.id, {
        format: 'png',
        height: 1350,
        renderedDataUrl: `data:image/png;base64,${imageOnlyPngBytes.toString('base64')}`,
        renderEvidenceMarker: renderEvidenceMarker(imageOnlyPngBytes),
        workRevisionId: revision.id,
        width: 1080,
      }),
      /missing raster evidence for text element headline/
    );
    await assert.rejects(
      service.exportWork(owner, work.id, {
        format: 'png',
        height: 1350,
        renderedDataUrl: `data:image/png;base64,${singleLinePngBytes.toString('base64')}`,
        renderEvidenceMarker: renderEvidenceMarker(singleLinePngBytes),
        workRevisionId: revision.id,
        width: 1080,
      }),
      /missing CJK line-break raster evidence for text element headline/
    );
    await assert.rejects(
      service.exportWork(owner, work.id, {
        format: 'png',
        height: 1350,
        renderedDataUrl: `data:image/png;base64,${renderedPngBytes.toString('base64')}`,
        renderEvidenceMarker: {
          ...renderEvidenceMarker(renderedPngBytes),
          rasterSha256: '0'.repeat(64),
        },
        workRevisionId: revision.id,
        width: 1080,
      }),
      /evidence marker does not match/
    );
    await assert.rejects(
      service.exportWork(owner, work.id, {
        format: 'png',
        height: 1350,
        renderedDataUrl: `data:image/png;base64,${wrongSizePngBytes.toString('base64')}`,
        renderEvidenceMarker: renderEvidenceMarker(wrongSizePngBytes),
        workRevisionId: revision.id,
        width: 1080,
      }),
      /pixel dimensions 1079x1350 do not match requested 1080x1350/
    );
    await assert.rejects(
      service.exportWork(owner, work.id, {
        format: 'png',
        height: 1350,
        renderedDataUrl: `data:image/png;base64,${Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]).toString('base64')}`,
        renderEvidenceMarker: {
          ...renderEvidenceMarker(renderedPngBytes),
          rasterSha256: '0'.repeat(64),
        },
        workRevisionId: revision.id,
        width: 1080,
      }),
      /bytes do not match image\/png/
    );
    await assert.rejects(
      service.exportWork(owner, work.id, {
        format: 'png',
        height: 1350,
        renderedDataUrl: `data:image/png;base64,${renderedPngBytes.toString('base64')}`,
        renderEvidenceMarker: renderEvidenceMarker(renderedPngBytes),
        width: 1080,
      } as never),
      /workRevisionId is required/
    );
  });

  it('owns neutral canvas defaults in Core instead of persisting localized UI labels', async () => {
    const { service } = setup();
    const admin = {
      ...owner,
      actor: 'admin' as const,
      userId: 'admin-canvas-defaults',
    };
    await service.seedOfficialTemplateFamilies(admin);
    const official = (await service.listTemplates(owner))[0];
    assert.ok(official?.publishedVersionId);

    const blank = await service.createBlankWork(owner, {
      height: 1350,
      width: 1080,
    });
    assert.equal(blank.name, DEFAULT_CANVAS_WORK_NAME);

    const saved = await service.saveUserTemplate(owner, { workId: blank.id });
    assert.equal(saved.name, DEFAULT_CANVAS_TEMPLATE_NAME);

    const reused = await service.createWorkFromUserTemplate(owner, {
      userTemplateId: saved.id,
    });
    assert.equal(reused.name, DEFAULT_CANVAS_WORK_NAME);

    const fromOfficial = await service.createWork(owner, {
      templateId: official.id,
    });
    assert.equal(fromOfficial.name, officialCanvasWorkName(official.family));
    const copied = await service.copyTemplateVersionToWork(owner, {
      sourceWorkId: fromOfficial.id,
      templateId: official.id,
      templateVersionId: official.publishedVersionId,
    });
    assert.equal(copied.name, fromOfficial.name);

    const copiedWithoutSource = await service.copyTemplateVersionToWork(
      owner,
      {
        templateId: official.id,
        templateVersionId: official.publishedVersionId,
      }
    );
    assert.equal(copiedWithoutSource.name, fromOfficial.name);

    const savedOfficial = await service.saveUserTemplate(owner, {
      workId: fromOfficial.id,
    });
    assert.equal(
      savedOfficial.name,
      officialCanvasTemplateName(official.family)
    );
    const copiedSavedOfficial = await service.copyUserTemplate(
      owner,
      savedOfficial.id
    );
    assert.equal(copiedSavedOfficial.name, savedOfficial.name);
    const copiedBlankName = await service.copyUserTemplate(
      owner,
      savedOfficial.id,
      '   '
    );
    assert.equal(copiedBlankName.name, savedOfficial.name);
    const reusedOfficial = await service.createWorkFromUserTemplate(owner, {
      userTemplateId: copiedSavedOfficial.id,
    });
    assert.equal(reusedOfficial.name, fromOfficial.name);

    const custom = await service.createOfficialTemplate(admin, {
      document: {
        height: 1350,
        pages: [{ elements: [], id: 'custom-template-page' }],
        width: 1080,
      },
      family: 'seasonal_campaign',
      name: 'VIP summer menu',
      tags: ['summer'],
    });
    assert.ok(custom.version);
    await service.publishTemplateVersion(
      admin,
      custom.template.id,
      custom.version.id
    );
    const customWork = await service.createWork(owner, {
      templateId: custom.template.id,
    });
    assert.equal(customWork.name, 'VIP summer menu');
    const copiedCustom = await service.copyTemplateVersionToWork(owner, {
      templateId: custom.template.id,
      templateVersionId: custom.version.id,
    });
    assert.equal(copiedCustom.name, 'VIP summer menu');

    await assert.rejects(
      service.createBlankWork(owner, {
        height: 1350,
        name: officialCanvasWorkName('price_card'),
        width: 1080,
      }),
      /reserved system prefix/
    );
    await assert.rejects(
      service.renameUserTemplate(
        owner,
        saved.id,
        officialCanvasTemplateName('price_card')
      ),
      /reserved system prefix/
    );
  });

  it('upgrades legacy seeded templates that have an empty published canvas', async () => {
    const { repository, service } = setup();
    const admin = {
      ...owner,
      actor: 'admin' as const,
      userId: 'admin-a',
    };
    await repository.saveTemplateCatalog({
      commandReceipts: [],
      templates: [
        {
          createdAt: '2026-07-01T00:00:00.000Z',
          family: 'social_cover',
          id: 'official-social_cover',
          name: '小红书 / 抖音封面',
          publicationStatus: 'published',
          publishedAt: '2026-07-01T00:00:00.000Z',
          publishedVersionId: 'official-social_cover-v1',
          tags: ['封面', '社交媒体'],
          updatedAt: '2026-07-01T00:00:00.000Z',
        },
      ],
      versionLifecycle: [],
      versions: [
        {
          createdAt: '2026-07-01T00:00:00.000Z',
          createdBy: 'legacy-seed',
          document: {
            height: 1350,
            pages: [{ elements: [], id: 'legacy-empty-page' }],
            width: 1080,
          },
          id: 'official-social_cover-v1',
          publishedAt: '2026-07-01T00:00:00.000Z',
          revision: 1,
          rolloutPercent: 100,
          status: 'published',
          templateId: 'official-social_cover',
        },
      ],
    });

    await service.seedOfficialTemplateFamilies(admin);

    const catalog = await repository.loadTemplateCatalog();
    const cover = catalog.templates.find(
      (template) => template.id === 'official-social_cover'
    );
    assert.notEqual(cover?.publishedVersionId, 'official-social_cover-v1');
    assert.equal(
      catalog.versions.find(
        (version) => version.id === 'official-social_cover-v1'
      )?.document.pages[0]?.elements.length,
      0
    );
    assert.ok(
      catalog.versions.find(
        (version) => version.id === cover?.publishedVersionId
      )?.document.pages[0]?.elements.length
    );
  });

  it('accepts only existing workspace-scoped template shortcut references', async () => {
    const { repository, service } = setup();
    const admin = {
      ...owner,
      actor: 'admin' as const,
      userId: 'admin-template-shortcuts',
    };
    await service.seedOfficialTemplateFamilies(admin);
    const official = (
      await service.listTemplates(owner, { families: ['price_card'] })
    )[0];
    assert.ok(official);
    const work = await service.createBlankWork(owner, {
      height: 1350,
      name: '快捷模板来源',
      width: 1080,
    });
    const userTemplate = await service.saveUserTemplate(owner, {
      name: '当前工作区模板',
      workId: work.id,
    });

    await service.setTemplateShortcuts(owner, [
      { hidden: false, rank: 0, templateId: official.id },
      { hidden: false, rank: 1, userTemplateId: userTemplate.id },
    ]);
    assert.deepEqual(await service.listTemplateShortcuts(owner), [
      { hidden: false, rank: 0, templateId: official.id },
      { hidden: false, rank: 1, userTemplateId: userTemplate.id },
    ]);

    for (const invalid of [
      {
        hidden: false,
        rank: 0,
        templateId: official.id,
        userTemplateId: userTemplate.id,
      },
      { hidden: false, rank: 0 },
    ]) {
      await assert.rejects(
        service.setTemplateShortcuts(owner, [invalid]),
        (error) =>
          error instanceof Error &&
          'code' in error &&
          error.code === 'INVALID_TEMPLATE_SHORTCUTS'
      );
    }

    for (const missing of [
      { hidden: false, rank: 0, templateId: 'missing-official' },
      { hidden: false, rank: 0, userTemplateId: 'missing-user' },
    ]) {
      await assert.rejects(
        service.setTemplateShortcuts(owner, [missing]),
        (error) =>
          error instanceof Error &&
          'code' in error &&
          error.code === 'TEMPLATE_SHORTCUT_NOT_FOUND'
      );
    }

    const otherWorkspace = {
      ...owner,
      correlationId: 'corr-other-template-shortcuts',
      userId: 'owner-template-shortcuts-b',
      workspaceId: 'workspace-template-shortcuts-b',
    };
    repository.grantMembership(
      otherWorkspace.userId,
      otherWorkspace.workspaceId
    );
    await assert.rejects(
      service.setTemplateShortcuts(otherWorkspace, [
        { hidden: false, rank: 0, userTemplateId: userTemplate.id },
      ]),
      (error) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'TEMPLATE_SHORTCUT_NOT_FOUND'
    );
  });

  it('keeps immutable template lifecycle evidence and selects canary versions by a stable workspace bucket', async () => {
    const { repository, service } = setup();
    const admin = {
      ...owner,
      actor: 'admin' as const,
      correlationId: 'corr-template-create',
      userId: 'admin-rollout',
    };
    await service.seedOfficialTemplateFamilies(admin);
    const template = (
      await service.listTemplates(admin, { families: ['social_cover'] })
    )[0]!;
    const baselineVersionId = template.publishedVersionId!;
    const canary = await service.createTemplateVersion(admin, {
      document: {
        height: 1350,
        pages: [{ elements: [], id: 'rollout-v2-page' }],
        width: 1080,
      },
      templateId: template.id,
    });
    await service.enableTemplateVersion(
      { ...admin, correlationId: 'corr-template-enable' },
      template.id,
      canary.id,
      50
    );
    assert.ok(
      (await service.listTemplates(owner)).some(
        (candidate) => candidate.id === template.id
      )
    );

    const selectedByWorkspace = new Map<string, string>();
    for (let index = 0; index < 100; index += 1) {
      const workspaceId = `workspace-rollout-${index}`;
      const context = { ...owner, workspaceId };
      repository.grantMembership(context.userId, workspaceId);
      const first = await service.createWork(context, {
        name: `rollout-${index}-a`,
        templateId: template.id,
      });
      const second = await service.createWork(context, {
        name: `rollout-${index}-b`,
        templateId: template.id,
      });
      assert.equal(second.templateVersionId, first.templateVersionId);
      const projectedTemplate = (
        await service.getCreationCatalog(context)
      ).templates.find((candidate) => candidate.id === template.id);
      assert.equal(
        projectedTemplate?.previewVersionId,
        first.templateVersionId
      );
      assert.deepEqual(
        projectedTemplate?.previewDocument,
        first.revisions[0]?.document
      );
      selectedByWorkspace.set(workspaceId, first.templateVersionId!);
    }
    assert.deepEqual(
      new Set(selectedByWorkspace.values()),
      new Set([baselineVersionId, canary.id])
    );

    await assert.rejects(
      service.publishTemplateVersion(admin, template.id, canary.id, 50),
      /Publishing is a full rollout/
    );
    await service.publishTemplateVersion(
      { ...admin, correlationId: 'corr-template-publish' },
      template.id,
      canary.id,
      100
    );
    await service.publishTemplateVersion(
      { ...admin, correlationId: 'corr-template-republish' },
      template.id,
      canary.id,
      100
    );
    await service.retireTemplate(
      { ...admin, correlationId: 'corr-template-retire' },
      template.id
    );
    const history = await service.getTemplateCatalogHistory(admin, template.id);
    const canaryHistory = history.versions.find(
      (version) => version.id === canary.id
    )!;
    assert.deepEqual(
      canaryHistory.lifecycle.map((event) => ({
        action: event.action,
        actorId: event.actorId,
        correlationId: event.correlationId,
      })),
      [
        {
          action: 'enabled',
          actorId: admin.userId,
          correlationId: 'corr-template-enable',
        },
        {
          action: 'published',
          actorId: admin.userId,
          correlationId: 'corr-template-publish',
        },
        {
          action: 'published',
          actorId: admin.userId,
          correlationId: 'corr-template-republish',
        },
        {
          action: 'retired',
          actorId: admin.userId,
          correlationId: 'corr-template-retire',
        },
      ]
    );
    assert.equal(canaryHistory.publishedBy, admin.userId);
    assert.equal(canaryHistory.publishCorrelationId, 'corr-template-republish');
    assert.equal(canaryHistory.retiredBy, admin.userId);
    assert.equal(canaryHistory.retireCorrelationId, 'corr-template-retire');
    assert.equal(
      (await service.listTemplates(owner)).some(
        (candidate) => candidate.id === template.id
      ),
      false
    );
    assert.deepEqual(
      await service.search(owner, {
        kinds: ['template'],
        query: template.name,
      }),
      []
    );
    const catalogWithHistory = await repository.loadTemplateCatalog();
    catalogWithHistory.versionLifecycle.pop();
    await assert.rejects(
      repository.saveTemplateCatalog(catalogWithHistory),
      /cannot be deleted/
    );
  });

  it('starts explicit image jobs and evaluates server-side Chinese retrieval', async () => {
    const { service } = setup();
    const work = await service.createBlankWork(owner, {
      height: 1350,
      name: 'AI 猫眼封面',
      width: 1080,
    });

    const image = await service.startCanvasImageGeneration(owner, {
      modelId: 'nano-banana-pro',
      operation: 'generate',
      prompt: '生成一张自然光下的透亮猫眼特写',
      workId: work.id,
    });
    assert.equal(image.requestedModelId, 'nano-banana-pro');
    assert.equal(image.actualModelId, 'nano-banana-pro');
    assert.equal(image.status, 'queued');
    assert.deepEqual(image.origin, {
      id: work.id,
      kind: 'layout_work',
      revisionId: work.currentRevisionId,
    });

    await service.indexSearchDocument(owner, {
      id: 'content-cat-eye',
      kind: 'content',
      metadata: { platform: 'xiaohongshu', status: 'draft' },
      tags: ['猫眼', '显白'],
      text: '杭州暮色美甲 透亮猫眼 新客到店',
      title: '阴天也透亮的猫眼',
    });
    await service.indexSearchDocument(owner, {
      id: 'asset-before-after',
      kind: 'asset',
      metadata: { authorization: 'public_marketing', category: 'case' },
      tags: ['前后对比'],
      text: '顾客授权的猫眼前后对比图',
      title: '猫眼 Before After',
    });

    const results = await service.search(owner, {
      kinds: ['content'],
      limit: 5,
      query: '透亮猫眼',
      tags: ['显白'],
    });
    assert.deepEqual(
      results.map((item) => item.id),
      ['content-cat-eye']
    );

    const evaluation = await service.evaluateRetrieval(owner, {
      cases: [
        {
          category: 'alias',
          expectedIds: ['content-cat-eye'],
          query: '暮色',
          revised: false,
        },
        {
          category: 'synonym',
          expectedIds: ['asset-before-after'],
          query: 'Before After',
          revised: true,
        },
        {
          category: 'typo',
          expectedIds: ['content-cat-eye'],
          query: '阴天也透亮的猫验',
          revised: false,
        },
        {
          category: 'tag',
          expectedIds: ['content-cat-eye'],
          query: '',
          revised: false,
          tags: ['显白'],
        },
        {
          category: 'negative',
          expectedIds: [],
          query: '不存在的水光项目',
          revised: false,
        },
      ],
      k: 5,
      revision: 'zh-bigram-v1',
    });
    assert.equal(evaluation.recallAtK, 1);
    assert.equal(evaluation.zeroResultRate, 1 / 5);
    assert.equal(evaluation.reformulationRate, 1 / 5);
    assert.equal(evaluation.reformulationSource, 'fixed-query-set-annotation');
    assert.equal(evaluation.negativeControlPassRate, 1);
    assert.deepEqual(
      evaluation.cases.map((testCase) => testCase.category),
      ['alias', 'synonym', 'typo', 'tag', 'negative']
    );
    assert.equal(evaluation.indexDocumentCount, 2);
    assert.ok(evaluation.indexSizeBytes > 0);
    assert.equal(evaluation.indexMode, 'memory-bigram-trigram');
    assert.match(evaluation.querySetHash, /^[a-f0-9]{64}$/);
    await assert.rejects(
      service.evaluateRetrieval(owner, {
        cases: [],
        k: 0,
        revision: 'invalid-k',
      }),
      /integer between 1 and 100/
    );
    const evaluationReplay = await service.evaluateRetrieval(owner, {
      cases: [
        {
          category: 'alias',
          expectedIds: ['content-cat-eye'],
          query: '暮色',
          revised: false,
        },
        {
          category: 'synonym',
          expectedIds: ['asset-before-after'],
          query: 'Before After',
          revised: true,
        },
        {
          category: 'typo',
          expectedIds: ['content-cat-eye'],
          query: '阴天也透亮的猫验',
          revised: false,
        },
        {
          category: 'tag',
          expectedIds: ['content-cat-eye'],
          query: '',
          revised: false,
          tags: ['显白'],
        },
        {
          category: 'negative',
          expectedIds: [],
          query: '不存在的水光项目',
          revised: false,
        },
      ],
      k: 5,
      revision: 'zh-bigram-v1',
    });
    assert.equal(evaluationReplay.id, evaluation.id);
    await assert.rejects(
      service.evaluateRetrieval(owner, {
        cases: [
          {
            expectedIds: ['content-cat-eye'],
            query: '另一个集合',
            revised: false,
          },
        ],
        k: 5,
        revision: 'zh-bigram-v1',
      }),
      /permanently bound to one fixed query set/
    );
    assert.equal(
      (await service.getLatestRetrievalEvaluation(owner))?.id,
      evaluation.id
    );
    const positiveOnlyRecall = await service.evaluateRetrieval(owner, {
      cases: [
        {
          category: 'other',
          expectedIds: ['missing-positive-result'],
          query: '完全不存在的正例',
          revised: false,
        },
        {
          category: 'negative',
          expectedIds: [],
          query: '完全不存在的负例',
          revised: false,
        },
      ],
      k: 5,
      revision: 'positive-recall-denominator-v1',
    });
    assert.equal(positiveOnlyRecall.recallAtK, 0);
    assert.equal(positiveOnlyRecall.negativeControlPassRate, 1);

    const admin = { ...owner, actor: 'admin' as const, userId: 'admin-a' };
    await service.seedOfficialTemplateFamilies(admin);
    const templateEvaluation = await service.evaluateRetrieval(owner, {
      cases: [
        {
          expectedIds: ['official-social_cover'],
          kinds: ['template'],
          query: '抖音封面',
          revised: false,
        },
      ],
      k: 5,
      revision: 'zh-template-v1',
    });
    assert.equal(templateEvaluation.recallAtK, 1);
  });

  it('refreshes and cancels the durable image task before updating its canvas projection', async () => {
    const repository = new MemoryOperationsRepository();
    repository.grantMembership(owner.userId, owner.workspaceId);
    let getCalls = 0;
    const cancelCalls: string[] = [];
    const imageGenerator: ImageGenerationPort = {
      jobId(request) {
        return `durable-image-${request.prompt}`;
      },
      async submit(request) {
        return {
          actualModelId: request.requestedModelId,
          id: this.jobId?.(request) ?? 'missing-job-id',
          status: 'queued',
        };
      },
      async get(request) {
        getCalls += 1;
        return {
          actualModelId: 'gpt-image-2',
          id: request.jobId,
          outputAssetId: 'asset-from-storage',
          outputAssetUrl:
            'http://core.test/v1/assets/workspace-a/generated/hash.png',
          status: 'completed',
        };
      },
      async cancel(request) {
        cancelCalls.push(request.jobId);
        return {
          actualModelId: 'gpt-image-2',
          id: request.jobId,
          status: 'cancel_requested',
        };
      },
    };
    const service = new OperationsApplicationService(repository, {
      canvasExporter: new RecordedCanvasExportAdapter(),
      imageGenerator,
      notifier: { async send() {} },
    });
    const work = await service.createBlankWork(owner, {
      height: 1350,
      name: '持久图片任务',
      width: 1080,
    });
    await assert.rejects(
      service.cancelCanvasImageGeneration(owner, 'missing-image-job'),
      /Canvas image job was not found/
    );
    assert.deepEqual(cancelCalls, []);
    const first = await service.startCanvasImageGeneration(owner, {
      modelId: 'gpt-image-2',
      operation: 'generate',
      prompt: '刷新真实任务',
      workId: work.id,
    });
    const refreshed = await service.getCanvasImageJob(owner, first.id);
    assert.equal(refreshed.status, 'completed');
    assert.equal(refreshed.outputAssetId, 'asset-from-storage');
    assert.match(refreshed.outputAssetUrl ?? '', /^http:\/\/core\.test/);
    assert.equal(
      (await service.getCanvasImageJob(owner, first.id)).status,
      'completed'
    );
    assert.equal(getCalls, 1);

    const second = await service.startCanvasImageGeneration(owner, {
      modelId: 'gpt-image-2',
      operation: 'generate',
      prompt: '取消真实任务',
      workId: work.id,
    });
    const cancelling = await service.cancelCanvasImageGeneration(
      owner,
      second.id
    );
    assert.equal(cancelling.status, 'cancel_requested');
    assert.deepEqual(cancelCalls, [second.id]);
    const repeated = await service.cancelCanvasImageGeneration(
      owner,
      second.id
    );
    assert.equal(repeated.status, 'cancel_requested');
    assert.deepEqual(cancelCalls, [second.id]);
  });

  it('recovers the latest canvas image job by work after local state is lost', async () => {
    const repository = new MemoryOperationsRepository();
    repository.grantMembership(owner.userId, owner.workspaceId);
    let timestamp = Date.parse('2026-07-11T10:00:00.000Z');
    const service = new OperationsApplicationService(repository, {
      canvasExporter: new RecordedCanvasExportAdapter(),
      clock: () => new Date(timestamp++),
      imageGenerator: {
        jobId(request) {
          return `recoverable-image-${request.prompt}`;
        },
        async submit(request) {
          return {
            actualModelId: request.requestedModelId,
            id: this.jobId?.(request) ?? 'missing-job-id',
            status: request.prompt.includes('运行中')
              ? ('queued' as const)
              : request.prompt.includes('已完成')
                ? ('completed' as const)
                : ('failed' as const),
          };
        },
      },
      notifier: { async send() {} },
    });
    const work = await service.createBlankWork(owner, {
      height: 1350,
      name: '可恢复图片任务',
      width: 1080,
    });
    const emptyWork = await service.createBlankWork(owner, {
      height: 1350,
      name: '无图片任务',
      width: 1080,
    });
    const terminalWork = await service.createBlankWork(owner, {
      height: 1350,
      name: '只有终态图片任务',
      width: 1080,
    });
    const running = await service.startCanvasImageGeneration(owner, {
      modelId: 'gpt-image-2',
      operation: 'generate',
      prompt: '较旧但仍运行中',
      workId: work.id,
    });
    await service.startCanvasImageGeneration(owner, {
      modelId: 'seedream-5-pro',
      operation: 'generate',
      prompt: '较新但已失败',
      workId: work.id,
    });
    await service.startCanvasImageGeneration(owner, {
      modelId: 'gpt-image-2',
      operation: 'generate',
      prompt: '较旧且已失败',
      workId: terminalWork.id,
    });
    const latestTerminal = await service.startCanvasImageGeneration(owner, {
      modelId: 'seedream-5-pro',
      operation: 'generate',
      prompt: '较新且已完成',
      workId: terminalWork.id,
    });

    assert.equal(
      (await service.getLatestCanvasImageJob(owner, work.id))?.id,
      running.id
    );
    assert.equal(
      (await service.getLatestCanvasImageJob(owner, terminalWork.id))?.id,
      latestTerminal.id
    );
    assert.equal(
      await service.getLatestCanvasImageJob(owner, emptyWork.id),
      null
    );
  });

  it('recovers a submitted image when Operations crashes before saving the provider receipt', async () => {
    const repository = new MemoryOperationsRepository();
    repository.grantMembership(owner.userId, owner.workspaceId);
    const providerEffects = new Set<string>();
    let submitCalls = 0;
    const imageGenerator: ImageGenerationPort = {
      jobId(request) {
        return `crash-image-${request.idempotencyKey}`;
      },
      async submit(request) {
        submitCalls += 1;
        providerEffects.add(request.idempotencyKey ?? 'missing');
        return {
          actualModelId: request.requestedModelId,
          id: this.jobId?.(request) ?? 'missing-job-id',
          outputAssetId: 'asset-after-crash',
          outputAssetUrl: 'http://core.test/v1/assets/asset-after-crash.png',
          status: 'completed' as const,
        };
      },
    };
    const service = new OperationsApplicationService(repository, {
      canvasExporter: new RecordedCanvasExportAdapter(),
      imageGenerator,
      notifier: { async send() {} },
    });
    const work = await service.createBlankWork(owner, {
      height: 1350,
      name: '崩溃恢复图片任务',
      width: 1080,
    });
    const saveWorkspace = repository.saveWorkspace.bind(repository);
    let failProviderReceipt = true;
    repository.saveWorkspace = async (state) => {
      if (
        failProviderReceipt &&
        state.imageJobs.some((job) => job.status === 'completed')
      ) {
        failProviderReceipt = false;
        throw new Error('simulated image receipt crash');
      }
      await saveWorkspace(state);
    };

    await assert.rejects(
      service.startCanvasImageGeneration(owner, {
        modelId: 'gpt-image-2',
        operation: 'generate',
        prompt: '提交后崩溃',
        workId: work.id,
      }),
      /simulated image receipt crash/
    );
    const checkpoint = await repository.getLatestCanvasImageJob(
      owner.workspaceId,
      work.id
    );
    assert.equal(checkpoint?.status, 'queued');

    const restarted = new OperationsApplicationService(repository, {
      canvasExporter: new RecordedCanvasExportAdapter(),
      imageGenerator,
      notifier: { async send() {} },
    });
    const recovered = await restarted.getLatestCanvasImageJob(owner, work.id);
    assert.equal(recovered?.id, checkpoint?.id);
    assert.equal(recovered?.status, 'completed');
    assert.equal(recovered?.outputAssetId, 'asset-after-crash');
    assert.equal(submitCalls, 2);
    assert.equal(providerEffects.size, 1);
  });

  it('claims a canvas cancellation once before calling the durable runtime', async () => {
    const repository = new MemoryOperationsRepository();
    repository.grantMembership(owner.userId, owner.workspaceId);
    let cancelCalls = 0;
    let cancellationStarted: (() => void) | undefined;
    let releaseCancellation: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      cancellationStarted = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseCancellation = resolve;
    });
    const service = new OperationsApplicationService(repository, {
      canvasExporter: new RecordedCanvasExportAdapter(),
      imageGenerator: {
        jobId() {
          return 'concurrent-cancel-job';
        },
        async submit(request) {
          return {
            actualModelId: request.requestedModelId,
            id: 'concurrent-cancel-job',
            status: 'queued' as const,
          };
        },
        async cancel(request) {
          cancelCalls += 1;
          cancellationStarted?.();
          await released;
          return {
            actualModelId: 'gpt-image-2' as const,
            id: request.jobId,
            status: 'cancelled' as const,
          };
        },
      },
      notifier: { async send() {} },
    });
    const work = await service.createBlankWork(owner, {
      height: 1350,
      name: '并发取消',
      width: 1080,
    });
    const job = await service.startCanvasImageGeneration(owner, {
      modelId: 'gpt-image-2',
      operation: 'generate',
      prompt: '取消一次',
      workId: work.id,
    });

    const first = service.cancelCanvasImageGeneration(owner, job.id);
    await started;
    const repeated = await service.cancelCanvasImageGeneration(owner, job.id);
    assert.equal(repeated.status, 'cancel_requested');
    assert.equal(cancelCalls, 1);
    releaseCancellation?.();
    assert.equal((await first).status, 'cancelled');
    assert.equal(cancelCalls, 1);
  });

  it('replays one stable canvas cancellation after provider response loss', async () => {
    const repository = new MemoryOperationsRepository();
    repository.grantMembership(owner.userId, owner.workspaceId);
    let cancelCalls = 0;
    let loseFirstResponse = true;
    const cancellationEffects = new Set<string>();
    const imageGenerator: ImageGenerationPort = {
      jobId() {
        return 'response-loss-cancel-job';
      },
      async submit(request) {
        return {
          actualModelId: request.requestedModelId,
          id: 'response-loss-cancel-job',
          status: 'running' as const,
        };
      },
      async cancel(request) {
        cancelCalls += 1;
        assert.ok(request.idempotencyKey);
        cancellationEffects.add(request.idempotencyKey);
        if (loseFirstResponse) {
          loseFirstResponse = false;
          throw new Error('simulated cancellation response loss');
        }
        return {
          actualModelId: 'gpt-image-2' as const,
          id: request.jobId,
          status: 'cancelled' as const,
        };
      },
    };
    const createService = () =>
      new OperationsApplicationService(repository, {
        canvasExporter: new RecordedCanvasExportAdapter(),
        imageGenerator,
        notifier: { async send() {} },
      });
    const firstProcess = createService();
    const work = await firstProcess.createBlankWork(owner, {
      height: 1350,
      name: '取消响应丢失',
      width: 1080,
    });
    const job = await firstProcess.startCanvasImageGeneration(owner, {
      modelId: 'gpt-image-2',
      operation: 'generate',
      prompt: '取消后只保留一个上游效果',
      workId: work.id,
    });

    await assert.rejects(
      firstProcess.cancelCanvasImageGeneration(owner, job.id),
      /simulated cancellation response loss/
    );
    assert.equal(
      (await firstProcess.getCanvasImageJob(owner, job.id)).status,
      'cancel_requested'
    );

    const restarted = createService();
    assert.equal(
      (await restarted.cancelCanvasImageGeneration(owner, job.id)).status,
      'cancelled'
    );
    assert.equal(cancelCalls, 2);
    assert.equal(cancellationEffects.size, 1);
  });

  it('reclaims an expired canvas cancellation lease after a process stops', async () => {
    const repository = new MemoryOperationsRepository();
    repository.grantMembership(owner.userId, owner.workspaceId);
    let now = new Date('2026-07-11T01:00:00.000Z');
    let cancelCalls = 0;
    let firstCancellationStarted: (() => void) | undefined;
    let releaseStoppedProcess: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      firstCancellationStarted = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseStoppedProcess = resolve;
    });
    const effectKeys = new Set<string>();
    const imageGenerator: ImageGenerationPort = {
      jobId() {
        return 'expired-cancel-job';
      },
      async submit(request) {
        return {
          actualModelId: request.requestedModelId,
          id: 'expired-cancel-job',
          status: 'running' as const,
        };
      },
      async cancel(request) {
        cancelCalls += 1;
        effectKeys.add(request.idempotencyKey);
        if (cancelCalls === 1) {
          firstCancellationStarted?.();
          await released;
        }
        return {
          actualModelId: 'gpt-image-2' as const,
          id: request.jobId,
          status: 'cancelled' as const,
        };
      },
    };
    const createService = () =>
      new OperationsApplicationService(repository, {
        canvasExporter: new RecordedCanvasExportAdapter(),
        clock: () => new Date(now),
        imageGenerator,
        notifier: { async send() {} },
      });
    const stoppedProcess = createService();
    const work = await stoppedProcess.createBlankWork(owner, {
      height: 1350,
      name: '过期取消租约',
      width: 1080,
    });
    const job = await stoppedProcess.startCanvasImageGeneration(owner, {
      modelId: 'gpt-image-2',
      operation: 'generate',
      prompt: '进程停止后恢复取消',
      workId: work.id,
    });
    const stale = stoppedProcess.cancelCanvasImageGeneration(owner, job.id);
    await started;
    now = new Date('2026-07-11T01:01:01.000Z');

    const restarted = createService();
    assert.equal(
      (await restarted.cancelCanvasImageGeneration(owner, job.id)).status,
      'cancelled'
    );
    releaseStoppedProcess?.();
    assert.equal((await stale).status, 'cancelled');
    assert.equal(cancelCalls, 2);
    assert.equal(effectKeys.size, 1);
  });

  it('completes a canvas image only from the matching durable asset and inserts it once', async () => {
    const repository = new MemoryOperationsRepository();
    repository.grantMembership(owner.userId, owner.workspaceId);
    const assetUrl =
      'http://core.test/v1/assets/workspace-a/generated/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png';
    const imageGenerator: ImageGenerationPort = {
      jobId() {
        return 'durable-completion-job';
      },
      async submit(request) {
        return {
          actualModelId: request.requestedModelId,
          id: 'durable-completion-job',
          status: 'queued',
        };
      },
      async get(request) {
        return {
          actualModelId: 'gpt-image-2',
          id: request.jobId,
          outputAssetId: 'asset-from-durable-storage',
          outputAssetUrl: assetUrl,
          status: 'completed',
        };
      },
    };
    const service = new OperationsApplicationService(repository, {
      canvasExporter: new RecordedCanvasExportAdapter(),
      imageGenerator,
      notifier: { async send() {} },
    });
    const work = await service.createBlankWork(owner, {
      height: 1350,
      name: '可信图片完成',
      width: 1080,
    });
    const job = await service.startCanvasImageGeneration(owner, {
      modelId: 'gpt-image-2',
      operation: 'generate',
      prompt: '生成可信图片',
      workId: work.id,
    });

    await assert.rejects(
      service.completeCanvasImageGeneration(owner, job.id, {
        assetId: 'forged-owner-asset',
        insertIntoCanvas: true,
        src: assetUrl,
      }),
      /does not match the durable generation result/
    );
    assert.equal((await service.getWork(owner, work.id)).revisions.length, 1);

    await service.completeCanvasImageGeneration(owner, job.id, {
      assetId: 'asset-from-durable-storage',
      insertIntoCanvas: true,
      src: assetUrl,
    });
    await service.completeCanvasImageGeneration(owner, job.id, {
      assetId: 'asset-from-durable-storage',
      insertIntoCanvas: true,
      src: assetUrl,
    });
    const completedWork = await service.getWork(owner, work.id);
    assert.equal(completedWork.revisions.length, 2);
    assert.equal(
      completedWork.revisions
        .at(-1)
        ?.document.pages[0]?.elements.filter(
          (element) =>
            element.kind === 'image' && element.sourceJobId === job.id
        ).length,
      1
    );
  });

  it('does not write an advanced canvas image completion into a layout work revision', async () => {
    const repository = new MemoryOperationsRepository();
    repository.grantMembership(owner.userId, owner.workspaceId);
    const imageGenerator: ImageGenerationPort = {
      jobId() {
        return 'advanced-canvas-completion-job';
      },
      async submit(request) {
        return {
          actualModelId: request.requestedModelId,
          id: 'advanced-canvas-completion-job',
          status: 'queued',
        };
      },
      async get(request) {
        return {
          actualModelId: 'gpt-image-2',
          id: request.jobId,
          outputAssetId: 'advanced-canvas-asset',
          status: 'completed',
        };
      },
    };
    const service = new OperationsApplicationService(repository, {
      canvasExporter: new RecordedCanvasExportAdapter(),
      imageGenerator,
      notifier: { async send() {} },
    });
    const layoutWork = await service.createBlankWork(owner, {
      height: 1350,
      name: '不应回写的页式作品',
      width: 1080,
    });
    const job = await service.startCanvasImageGeneration(owner, {
      modelId: 'gpt-image-2',
      operation: 'generate',
      prompt: '高阶画布图片',
      workId: layoutWork.id,
    });
    const state = await repository.loadWorkspace(owner.workspaceId);
    assert.ok(state);
    const storedJob = state.imageJobs.find((candidate) => candidate.id === job.id);
    assert.ok(storedJob);
    Object.assign(storedJob, {
      origin: {
        id: 'advanced-project-a',
        kind: 'advanced_canvas',
        revisionId: 'advanced-revision-a',
      },
    });
    delete (storedJob as unknown as { workId?: string }).workId;
    delete (storedJob as unknown as { workRevisionId?: string }).workRevisionId;
    await repository.saveWorkspace(state);

    await service.completeCanvasImageGeneration(owner, job.id, {
      assetId: 'advanced-canvas-asset',
      insertIntoCanvas: true,
    });

    assert.equal(
      (await service.getWork(owner, layoutWork.id)).revisions.length,
      1
    );
  });

  it('passes the real actor and Product asset data classes to image editing', async () => {
    const repository = new MemoryOperationsRepository();
    repository.grantMembership(owner.userId, owner.workspaceId);
    const submissions: Array<{
      actorId: string;
      dataClass: string[];
      inputAssetId?: string;
    }> = [];
    const service = new OperationsApplicationService(repository, {
      assetDataClassResolver: {
        async resolve(workspaceId, assetId) {
          assert.equal(workspaceId, owner.workspaceId);
          assert.equal(assetId, 'asset-sensitive-a');
          return ['contains_face', 'pii'];
        },
      },
      canvasExporter: new RecordedCanvasExportAdapter(),
      imageGenerator: {
        jobId() {
          return 'image-job-sensitive-a';
        },
        async submit(request) {
          submissions.push({
            actorId: request.actorId,
            dataClass: request.dataClass,
            inputAssetId: request.inputAssetId,
          });
          return {
            actualModelId: request.requestedModelId,
            id: 'image-job-sensitive-a',
            status: 'queued' as const,
          };
        },
      },
      notifier: { async send() {} },
    });
    const work = await service.createBlankWork(owner, {
      height: 1350,
      name: '敏感素材编辑',
      width: 1080,
    });

    await service.startCanvasImageGeneration(owner, {
      dataClass: ['medical'],
      inputAssetId: 'asset-sensitive-a',
      operation: 'edit',
      prompt: '只调整光线',
      requestedModelId: 'seedream-5-pro',
      workId: work.id,
    });

    assert.deepEqual(submissions, [
      {
        actorId: owner.userId,
        dataClass: ['contains_face', 'medical', 'pii'],
        inputAssetId: 'asset-sensitive-a',
      },
    ]);
  });

  it('claims batch work in a short transaction, persists execution facts, and retries failures', async () => {
    const repository = new MemoryOperationsRepository();
    repository.grantMembership(owner.userId, owner.workspaceId);
    let releaseFirst: (() => void) | undefined;
    let startedFirst: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      startedFirst = resolve;
    });
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let attempt = 0;
    const batchExecutor: BatchExecutionPort = {
      async execute(request) {
        attempt += 1;
        if (attempt === 1) {
          startedFirst?.();
          await firstReleased;
          return {
            errorCode: 'recorded_transient',
            errorMessage: 'temporary recorded failure',
            retryable: true,
            status: 'failed',
          };
        }
        return {
          output: {
            artifactId: `draft-${request.task.id}`,
            artifactKind: 'draft',
          },
          status: 'completed',
        };
      },
    };
    const service = new OperationsApplicationService(repository, {
      batchExecutor,
      canvasExporter: new RecordedCanvasExportAdapter(),
      clock: () => new Date('2026-07-16T10:00:00.000Z'),
      imageGenerator: new RecordedImageGenerationAdapter(),
      notifier: { async send() {} },
    });
    const task = await service.createTask(owner, {
      dueAt: '2026-07-14T09:00:00.000Z',
      executable: true,
      relatedObject: { id: 'content-batch', kind: 'content' },
      risk: 'normal',
      source: 'weekly_batch',
      title: '生成本周草稿',
    });
    const publishReady = await service.createTask(owner, {
      dueAt: '2026-07-16T12:00:00.000Z',
      executable: true,
      relatedObject: { id: 'publication-batch', kind: 'publication' },
      risk: 'external_permission',
      source: 'publish_ready',
      title: '确认发布',
    });

    const firstRun = service.executeWeeklyBatch(owner, {
      action: 'prepare_draft',
      taskIds: [task.id, publishReady.id],
    });
    await firstStarted;
    const concurrentTask = await Promise.race([
      service.createTask(owner, {
        dueAt: '2026-07-15T09:00:00.000Z',
        executable: true,
        risk: 'normal',
        source: 'manual',
        title: '锁外可创建的任务',
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('workspace lock leaked into adapter')),
          100
        )
      ),
    ]);
    assert.ok(concurrentTask.id);
    releaseFirst?.();
    const failed = await firstRun;
    assert.equal(failed.failed[0]?.retryable, true);
    assert.deepEqual(failed.excluded, [
      { reason: '公开发布需单独确认', taskId: publishReady.id },
    ]);
    assert.equal(
      (
        await service.listInbox(owner, {
          relatedObject: { id: 'content-batch', kind: 'content' },
        })
      ).tasks[0]?.status,
      'todo'
    );

    const retried = await service.executeWeeklyBatch(owner, {
      action: 'prepare_draft',
      taskIds: [task.id],
    });
    assert.equal(retried.completed[0]?.status, 'needs_review');
    const executions = await service.listWeeklyBatchExecutions(owner, task.id);
    assert.deepEqual(
      executions.map((execution) => [execution.attempt, execution.status]),
      [
        [1, 'failed'],
        [2, 'completed'],
      ]
    );
    const review = await service.createWeeklyReview(owner, {
      from: '2026-07-13T00:00:00.000Z',
      to: '2026-07-19T23:59:59.999Z',
    });
    assert.deepEqual(review.metrics.planned, { status: 'known', value: 3 });
    assert.deepEqual(review.metrics.drafted, { status: 'known', value: 1 });
    assert.ok(
      (await service.listTaskEvents(owner, task.id)).some(
        (event) => event.event === 'execution_completed'
      )
    );
  });

  it('recovers an expired weekly claim with the same idempotent external execution', async () => {
    const repository = new MemoryOperationsRepository();
    repository.grantMembership(owner.userId, owner.workspaceId);
    let now = Date.parse('2026-07-16T10:00:00.000Z');
    const externalEffects = new Set<string>();
    const executeIds: string[] = [];
    const service = new OperationsApplicationService(repository, {
      batchExecutor: {
        async execute(request) {
          executeIds.push(request.executionId);
          externalEffects.add(request.executionId);
          return {
            output: {
              artifactId: `draft-${request.executionId}`,
              artifactKind: 'draft' as const,
            },
            status: 'completed' as const,
          };
        },
      },
      canvasExporter: new RecordedCanvasExportAdapter(),
      clock: () => new Date(now),
      imageGenerator: new RecordedImageGenerationAdapter(),
      notifier: { async send() {} },
    });
    const task = await service.createTask(owner, {
      dueAt: '2026-07-16T12:00:00.000Z',
      executable: true,
      risk: 'normal',
      source: 'weekly_batch',
      title: '恢复周批次任务',
    });
    const save = repository.saveWorkspace.bind(repository);
    let crashBeforeSettlement = true;
    repository.saveWorkspace = async (state) => {
      if (
        crashBeforeSettlement &&
        state.weeklyBatchExecutions.some(
          (execution) => execution.status === 'completed'
        )
      ) {
        crashBeforeSettlement = false;
        throw new Error('simulated settlement crash');
      }
      return save(state);
    };
    const input = {
      action: 'execute_weekly_batch',
      payload: {
        batchAction: 'prepare_draft',
        taskIds: [task.id],
      },
    };
    const run = (idempotencyKey: string) =>
      service.executeIdempotentModuleCommand(owner, idempotencyKey, input, () =>
        service.executeWeeklyBatch(owner, {
          action: 'prepare_draft',
          taskIds: [task.id],
        })
      );

    await assert.rejects(
      run('weekly-batch-crash-a'),
      /simulated settlement crash/
    );
    now += 5 * 60 * 1000 + 1;
    const recovered = await run('weekly-batch-crash-b');
    const executions = await service.listWeeklyBatchExecutions(owner, task.id);

    assert.equal(recovered.completed[0]?.id, task.id);
    assert.equal(externalEffects.size, 1);
    assert.deepEqual(executeIds, [executeIds[0], executeIds[0]]);
    assert.equal(executions.length, 1);
    assert.equal(executions[0]?.status, 'completed');
  });

  it('fences a stale weekly worker after another worker reclaims its lease', async () => {
    const repository = new MemoryOperationsRepository();
    repository.grantMembership(owner.userId, owner.workspaceId);
    let now = Date.parse('2026-07-16T10:00:00.000Z');
    let releaseFirst: (() => void) | undefined;
    let firstStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const executionIds: string[] = [];
    let calls = 0;
    const service = new OperationsApplicationService(repository, {
      batchExecutor: {
        async execute(request) {
          calls += 1;
          executionIds.push(request.executionId);
          if (calls === 1) {
            firstStarted?.();
            await released;
          }
          return {
            output: {
              artifactId: `draft-${request.executionId}`,
              artifactKind: 'draft' as const,
            },
            status: 'completed' as const,
          };
        },
      },
      canvasExporter: new RecordedCanvasExportAdapter(),
      clock: () => new Date(now),
      imageGenerator: new RecordedImageGenerationAdapter(),
      notifier: { async send() {} },
    });
    const task = await service.createTask(owner, {
      dueAt: '2026-07-16T12:00:00.000Z',
      executable: true,
      risk: 'normal',
      source: 'weekly_batch',
      title: '测试过期租约 fencing',
    });

    const staleWorker = service.executeWeeklyBatch(owner, {
      action: 'prepare_draft',
      taskIds: [task.id],
    });
    await started;
    now += 5 * 60 * 1000 + 1;
    const recovered = await service.executeWeeklyBatch(owner, {
      action: 'prepare_draft',
      taskIds: [task.id],
    });
    assert.equal(recovered.completed[0]?.id, task.id);
    releaseFirst?.();
    await assert.rejects(staleWorker, /stale execution lease/);
    assert.equal(new Set(executionIds).size, 1);
    assert.equal(
      (await service.listWeeklyBatchExecutions(owner, task.id)).length,
      1
    );
  });

  it('schedules built-in triggers through a recurring job seam and exposes audited metrics', async () => {
    const repository = new MemoryOperationsRepository();
    repository.grantMembership(owner.userId, owner.workspaceId);
    const scheduled: Array<Record<string, unknown>> = [];
    const unscheduled: string[] = [];
    const service = new OperationsApplicationService(repository, {
      batchExecutor: new RecordedBatchExecutionAdapter(),
      canvasExporter: new RecordedCanvasExportAdapter(),
      imageGenerator: new RecordedImageGenerationAdapter(),
      notifier: { async send() {} },
      triggerScheduler: {
        async scheduleRecurring(input) {
          scheduled.push(input);
        },
        async unscheduleRecurring(_workspaceId, scheduleId) {
          unscheduled.push(scheduleId);
        },
      },
    });

    await service.configureTrigger(owner, 'weekly_review_ready', true);
    assert.equal(scheduled[0]?.kind, 'operations.trigger');
    await service.runTrigger(owner, {
      kind: 'weekly_review_ready',
      sourceId: 'review-w29',
      timeWindow: '2026-W29',
    });
    await service.runTrigger(owner, {
      kind: 'weekly_review_ready',
      sourceId: 'review-w29',
      timeWindow: '2026-W29',
    });
    const metrics = await service.getTriggerMetrics(owner);
    assert.equal(metrics.totalRuns, 1);
    assert.equal(metrics.created, 1);
    assert.equal(metrics.deduplicated, 0);
    assert.equal(metrics.notificationsSent, 1);
    assert.equal(metrics.byKind.weekly_review_ready, 1);

    await service.configureTrigger(owner, 'weekly_review_ready', false);
    assert.equal(unscheduled.length, 1);
  });
});
