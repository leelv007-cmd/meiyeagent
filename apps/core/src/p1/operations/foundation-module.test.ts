import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import sharp from 'sharp';
import {
  MemoryFoundationRepository,
  P1ApplicationService,
} from '../foundation/index.js';
import {
  MemoryOperationsRepository,
  OperationsApplicationService,
  OperationsFoundationModule,
  RecordedCanvasExportAdapter,
  RecordedImageGenerationAdapter,
} from './index.js';

describe('operations foundation module', () => {
  it('keeps ContentPackage migration commands and reports behind the admin gate', async () => {
    const calls: string[] = [];
    const module = new OperationsFoundationModule(
      {
        async dryRunContentPackageMigration(_context: unknown, runId: string) {
          calls.push(`dry-run:${runId}`);
          return { runId };
        },
        async getContentPackageMigrationReport(
          _context: unknown,
          runId: string
        ) {
          calls.push(`report:${runId}`);
          return { runId };
        },
      } as unknown as OperationsApplicationService,
      { adminActorIds: ['migration-admin'] }
    );
    const baseContext = {
      correlationId: 'corr-migration-admin',
      workspaceId: 'workspace-migration-admin',
    };

    await assert.rejects(
      module.execute({
        context: { ...baseContext, userId: 'ordinary-user' },
        input: {
          action: 'content_package_migration_dry_run',
          payload: { runId: 'run-1' },
        },
      }),
      (error: unknown) =>
        error instanceof Error &&
        error.message === 'Admin identity is required.'
    );

    await module.execute({
      context: { ...baseContext, userId: 'migration-admin' },
      input: {
        action: 'content_package_migration_dry_run',
        payload: { runId: 'run-1' },
      },
    });
    await module.query({
      context: { ...baseContext, userId: 'migration-admin' },
      input: {
        action: 'content_package_migration_report',
        payload: { runId: 'run-1' },
      },
    });

    assert.deepEqual(calls, ['dry-run:run-1', 'report:run-1']);
  });

  it('routes persistent Creative Brief field ownership commands', async () => {
    const calls: unknown[] = [];
    const module = new OperationsFoundationModule({
      async updateCreativeWorkBrief(
        _context: unknown,
        workId: string,
        input: unknown
      ) {
        calls.push({ input, workId });
        return input;
      },
      async confirmCreativeWorkBrief(_context: unknown, workId: string) {
        calls.push({ confirm: workId });
        return { id: workId };
      },
    } as unknown as OperationsApplicationService);
    const context = {
      correlationId: 'corr-brief-module',
      userId: 'owner-brief-module',
      workspaceId: 'workspace-brief-module',
    };

    for (const payload of [
      {
        action: 'adopt',
        aiDraft: 'AI 建议',
        field: 'tone',
        workId: 'work-a',
      },
      {
        action: 'edit',
        current: '商家改稿',
        field: 'tone',
        workId: 'work-a',
      },
      { action: 'revert', field: 'tone', workId: 'work-a' },
    ]) {
      await module.execute({
        context,
        input: { action: 'update_creative_work_brief', payload },
      });
    }
    await module.execute({
      context,
      input: {
        action: 'confirm_creative_work_brief',
        payload: { workId: 'work-a' },
      },
    });

    assert.deepEqual(calls, [
      {
        input: { action: 'adopt', aiDraft: 'AI 建议', field: 'tone' },
        workId: 'work-a',
      },
      {
        input: { action: 'edit', current: '商家改稿', field: 'tone' },
        workId: 'work-a',
      },
      {
        input: { action: 'revert', field: 'tone' },
        workId: 'work-a',
      },
      { confirm: 'work-a' },
    ]);
  });

  it('routes paid and quality reroll payloads as separate commands', async () => {
    const calls: Array<{
      action: 'paid' | 'quality';
      jobId: string;
      submissionKey: string;
    }> = [];
    const module = new OperationsFoundationModule({
      async rerollCreativeJob(
        _context: unknown,
        jobId: string,
        submissionKey: string
      ) {
        calls.push({ action: 'paid', jobId, submissionKey });
        return { action: 'paid' };
      },
      async qualityRetryCreativeJob(
        _context: unknown,
        jobId: string,
        submissionKey: string
      ) {
        calls.push({ action: 'quality', jobId, submissionKey });
        return { action: 'quality' };
      },
    } as unknown as OperationsApplicationService);
    const context = {
      correlationId: 'corr-reroll-module',
      userId: 'owner-reroll-module',
      workspaceId: 'workspace-reroll-module',
    };

    await module.execute({
      context,
      input: {
        action: 'reroll_creative_job',
        payload: { jobId: 'job-paid', submissionKey: 'paid-key' },
      },
    });
    await module.execute({
      context,
      input: {
        action: 'quality_retry_creative_job',
        payload: { jobId: 'job-quality', submissionKey: 'quality-key' },
      },
    });

    assert.deepEqual(calls, [
      { action: 'paid', jobId: 'job-paid', submissionKey: 'paid-key' },
      {
        action: 'quality',
        jobId: 'job-quality',
        submissionKey: 'quality-key',
      },
    ]);
  });

  it('routes idempotent commands and live queries through P1ApplicationService', async () => {
    const foundation = new MemoryFoundationRepository();
    const operations = new MemoryOperationsRepository();
    const context = {
      correlationId: 'corr-module',
      userId: 'owner-module',
      workspaceId: 'workspace-module',
    };
    foundation.grantOwner(context.workspaceId, context.userId);
    operations.grantMembership(context.userId, context.workspaceId);
    const module = new OperationsFoundationModule(
      new OperationsApplicationService(operations, {
        canvasExporter: new RecordedCanvasExportAdapter(),
        imageGenerator: new RecordedImageGenerationAdapter(),
        notifier: { async send() {} },
      })
    );
    const service = new P1ApplicationService(foundation, {
      operations: [module],
    });
    const input = {
      action: 'create_task',
      payload: {
        dueAt: '2026-07-13T09:00:00.000Z',
        executable: true,
        risk: 'normal',
        source: 'manual',
        title: '确认本周内容',
      },
    };

    const created = await service.executeModule<typeof input, { id: string }>(
      context,
      'operations',
      input,
      'create-task-1'
    );
    const replay = await service.executeModule<typeof input, { id: string }>(
      context,
      'operations',
      input,
      'create-task-1'
    );
    assert.equal(replay.id, created.id);

    const inbox = await service.queryModule<
      { action: string; payload: Record<string, never> },
      { tasks: Array<{ id: string }> }
    >(context, 'operations', { action: 'inbox', payload: {} });
    assert.deepEqual(
      inbox.tasks.map((task) => task.id),
      [created.id]
    );
    const creationCatalog = await service.queryModule<
      { action: string; payload: Record<string, never> },
      {
        shortcuts: unknown[];
        templates: unknown[];
        userTemplates: unknown[];
      }
    >(context, 'operations', {
      action: 'creation_catalog',
      payload: {},
    });
    assert.deepEqual(creationCatalog, {
      shortcuts: [],
      templates: [],
      userTemplates: [],
    });
    const evaluationInput = {
      action: 'retrieval_evaluation',
      payload: {
        cases: [
          {
            expectedIds: [created.id],
            query: '确认本周内容',
            revised: false,
          },
        ],
        k: 5,
        revision: 'module-fixed-query-v1',
      },
    };
    const evaluation = await service.executeModule<
      typeof evaluationInput,
      { id: string; querySetHash: string }
    >(context, 'operations', evaluationInput, 'evaluate-retrieval-v1');
    const metrics = await service.queryModule<
      { action: string; payload: Record<string, never> },
      { id: string }
    >(context, 'operations', {
      action: 'retrieval_metrics',
      payload: {},
    });
    assert.equal(metrics.id, evaluation.id);
    assert.match(evaluation.querySetHash, /^[a-f0-9]{64}$/);
    await assert.rejects(
      service.queryModule(context, 'operations', {
        action: 'retrieval_evaluation',
        payload: evaluationInput.payload,
      }),
      /Unknown operations query retrieval_evaluation/
    );
  });

  it('replays the Operations fact after Foundation completion crashes and the lease is reclaimed', async () => {
    let now = Date.parse('2026-07-11T10:00:00.000Z');
    const foundation = new MemoryFoundationRepository(() => new Date(now), 10);
    const complete = foundation.completeModuleCommand.bind(foundation);
    let failCompletion = true;
    foundation.completeModuleCommand = async (...args) => {
      if (failCompletion) {
        failCompletion = false;
        throw new Error('simulated completion crash');
      }
      return complete(...args);
    };
    const operations = new MemoryOperationsRepository();
    const context = {
      correlationId: 'corr-module-crash',
      userId: 'owner-module-crash',
      workspaceId: 'workspace-module-crash',
    };
    foundation.grantOwner(context.workspaceId, context.userId);
    operations.grantMembership(context.userId, context.workspaceId);
    const notifications: string[] = [];
    const operationsService = new OperationsApplicationService(operations, {
      canvasExporter: new RecordedCanvasExportAdapter(),
      imageGenerator: new RecordedImageGenerationAdapter(),
      notifier: {
        async send(notification) {
          notifications.push(notification.taskId);
        },
      },
    });
    const service = new P1ApplicationService(foundation, {
      moduleCommandHeartbeatMs: 60_000,
      operations: [
        new OperationsFoundationModule(operationsService, {
          adminActorIds: [context.userId],
        }),
      ],
    });
    const crashAndReplay = async <T>(
      idempotencyKey: string,
      command: { action: string; payload: Record<string, unknown> }
    ) => {
      failCompletion = true;
      await assert.rejects(
        service.executeModule(context, 'operations', command, idempotencyKey),
        /simulated completion crash/
      );
      now += 11;
      return service.executeModule<typeof command, T>(
        context,
        'operations',
        command,
        idempotencyKey
      );
    };
    const input = {
      action: 'create_task',
      payload: {
        dueAt: '2026-07-13T09:00:00.000Z',
        executable: true,
        risk: 'normal',
        source: 'manual',
        title: '崩溃后只保留一个任务',
      },
    };

    const replayed = await crashAndReplay<{ id: string }>(
      'crash-create-task',
      input
    );
    const inbox = await service.queryModule<
      { action: string; payload: Record<string, never> },
      { tasks: Array<{ id: string }> }
    >(context, 'operations', { action: 'inbox', payload: {} });

    assert.equal(inbox.tasks.length, 1);
    assert.equal(inbox.tasks[0]?.id, replayed.id);
    await operationsService.configureTrigger(
      { ...context, actor: 'owner' },
      'weekly_batch_ready',
      true
    );
    const trigger = await crashAndReplay<{ task: { id: string } }>(
      'crash-run-trigger',
      {
        action: 'run_trigger',
        payload: {
          kind: 'weekly_batch_ready',
          sourceId: 'crash-trigger-source',
          timeWindow: '2026-W30',
        },
      }
    );
    assert.deepEqual(notifications, [trigger.task.id]);

    const work = await crashAndReplay<{
      id: string;
      currentRevisionId: string;
    }>('crash-create-work', {
      action: 'create_blank_work',
      payload: { height: 1350, name: '崩溃作品', width: 1080 },
    });
    await crashAndReplay<{ id: string }>('crash-create-review', {
      action: 'create_weekly_review',
      payload: {
        from: '2026-07-13T00:00:00.000Z',
        to: '2026-07-19T23:59:59.999Z',
      },
    });
    await crashAndReplay('crash-create-template', {
      action: 'admin_create_template',
      payload: {
        document: {
          height: 1350,
          pages: [{ elements: [], id: 'crash-template-page' }],
          width: 1080,
        },
        family: 'crash_family',
        name: '崩溃模板',
        tags: ['崩溃'],
      },
    });
    const renderedPngBytes = await sharp({
      create: {
        background: { alpha: 0, b: 0, g: 0, r: 0 },
        channels: 4,
        height: 1350,
        width: 1080,
      },
    })
      .png()
      .toBuffer();
    await crashAndReplay('crash-export-work', {
      action: 'export_work',
      payload: {
        request: {
          format: 'png',
          height: 1350,
          renderedDataUrl: `data:image/png;base64,${renderedPngBytes.toString('base64')}`,
          renderEvidenceMarker: {
            version: 'canvas-raster-v1',
            rasterSha256: createHash('sha256')
              .update(renderedPngBytes)
              .digest('hex'),
            imageElementIds: [],
            fontFamilies: [],
            cjkLineBreakElementIds: [],
          },
          width: 1080,
          workRevisionId: work.currentRevisionId,
        },
        workId: work.id,
      },
    });
    const state = await operations.loadWorkspace(context.workspaceId);
    const catalog = await operations.loadTemplateCatalog();
    assert.equal(state?.works.length, 1);
    assert.equal(state?.weeklyReviews.length, 1);
    assert.equal(state?.exportReceipts.length, 1);
    assert.equal(
      catalog.templates.filter((template) => template.family === 'crash_family')
        .length,
      1
    );
    assert.equal(
      catalog.versions.filter(
        (version) =>
          catalog.templates.find(
            (template) => template.family === 'crash_family'
          )?.id === version.templateId
      ).length,
      1
    );
  });

  it('gates template lifecycle commands to configured admin actors', async () => {
    const repository = new MemoryOperationsRepository();
    repository.grantMembership('owner-template', 'workspace-template');
    const operations = new OperationsApplicationService(repository, {
      canvasExporter: new RecordedCanvasExportAdapter(),
      createId: (() => {
        let sequence = 0;
        return () => `id-${++sequence}`;
      })(),
      imageGenerator: new RecordedImageGenerationAdapter(),
      notifier: { async send() {} },
    });
    const owner = {
      correlationId: 'corr-owner-template',
      userId: 'owner-template',
      workspaceId: 'workspace-template',
    };
    const admin = {
      correlationId: 'corr-admin-template',
      userId: 'admin-template',
      workspaceId: 'workspace-template',
    };
    await operations.seedOfficialTemplateFamilies({ ...admin, actor: 'admin' });
    const module = new OperationsFoundationModule(operations, {
      adminActorIds: [admin.userId],
    });
    const publishedTemplate = (
      await operations.listTemplates({ ...owner, actor: 'owner' })
    )[0]!;
    const ownerPreview = (await module.execute({
      context: owner,
      input: {
        action: 'preview_template_version',
        payload: {
          templateId: publishedTemplate.id,
          versionId: publishedTemplate.publishedVersionId,
        },
      },
    })) as { document: { width: number }; versionId: string };
    assert.equal(ownerPreview.versionId, publishedTemplate.publishedVersionId);
    assert.equal(ownerPreview.document.width, 1080);
    const ownerCopy = (await module.execute({
      context: owner,
      input: {
        action: 'copy_template_version_to_work',
        payload: {
          name: 'Owner 固定版副本',
          templateId: publishedTemplate.id,
          templateVersionId: publishedTemplate.publishedVersionId,
        },
      },
    })) as { templateVersionId: string };
    assert.equal(
      ownerCopy.templateVersionId,
      publishedTemplate.publishedVersionId
    );
    const document = {
      height: 1350,
      pages: [{ elements: [], id: 'page-admin' }],
      width: 1080,
    };

    const custom = (await module.execute({
      context: admin,
      input: {
        action: 'admin_create_template',
        payload: {
          document,
          family: 'seasonal_campaign',
          name: '七夕美甲活动',
          tags: ['节日', '活动'],
        },
      },
    })) as {
      template: { family: string; id: string; publicationStatus: string };
      version?: { id: string; status: string };
    };
    assert.equal(custom.template.family, 'seasonal_campaign');
    assert.equal(custom.template.publicationStatus, 'draft');
    assert.equal(custom.version?.status, 'draft');
    const enabled = (await module.execute({
      context: admin,
      input: {
        action: 'admin_enable_template_version',
        payload: {
          rolloutPercent: 10,
          templateId: custom.template.id,
          versionId: custom.version?.id,
        },
      },
    })) as { status: string; rolloutPercent: number };
    assert.equal(enabled.status, 'enabled');
    assert.equal(enabled.rolloutPercent, 10);
    const preview = (await module.execute({
      context: admin,
      input: {
        action: 'admin_preview_template_version',
        payload: {
          templateId: custom.template.id,
          versionId: custom.version?.id,
        },
      },
    })) as { document: { width: number } };
    assert.equal(preview.document.width, 1080);
    const customState = await repository.loadWorkspace(admin.workspaceId);
    assert.deepEqual(
      customState?.auditEvents
        .filter((event) => event.entityId === custom.template.id)
        .map((event) => event.action),
      [
        'template.created',
        'template.version_enabled',
        'template.version_previewed',
      ]
    );

    await assert.rejects(
      module.execute({
        context: owner,
        input: {
          action: 'admin_create_template_version',
          payload: {
            document,
            rolloutPercent: 25,
            templateId: 'official-social_cover',
          },
        },
      }),
      (error: unknown) =>
        error instanceof Error && error.message.includes('Admin identity')
    );
    await assert.rejects(
      module.query({
        context: owner,
        input: { action: 'admin_template_catalog', payload: {} },
      }),
      (error: unknown) =>
        error instanceof Error && error.message.includes('Admin identity')
    );

    const draft = (await module.execute({
      context: admin,
      input: {
        action: 'admin_create_template_version',
        payload: {
          document,
          rolloutPercent: 25,
          templateId: 'official-social_cover',
        },
      },
    })) as { id: string; rolloutPercent: number; status: string };
    assert.equal(draft.status, 'draft');
    assert.equal(draft.rolloutPercent, 25);

    await assert.rejects(
      module.execute({
        context: admin,
        input: {
          action: 'admin_publish_template_version',
          payload: {
            rolloutPercent: 101,
            templateId: 'official-social_cover',
            versionId: draft.id,
          },
        },
      }),
      /rolloutPercent must be an integer between 0 and 100/
    );

    await assert.rejects(
      module.execute({
        context: admin,
        input: {
          action: 'admin_publish_template_version',
          payload: {
            rolloutPercent: 50,
            templateId: 'official-social_cover',
            versionId: draft.id,
          },
        },
      }),
      /Publishing is a full rollout/
    );
    const published = (await module.execute({
      context: admin,
      input: {
        action: 'admin_publish_template_version',
        payload: {
          rolloutPercent: 100,
          templateId: 'official-social_cover',
          versionId: draft.id,
        },
      },
    })) as { id: string; rolloutPercent: number; status: string };
    assert.equal(published.status, 'published');
    assert.equal(published.rolloutPercent, 100);

    const catalog = (await module.query({
      context: admin,
      input: { action: 'admin_template_catalog', payload: {} },
    })) as {
      templates: Array<{ id: string; publicationStatus: string }>;
      versions: Array<{ id: string; status: string }>;
      workspaceId: string;
    };
    assert.ok(
      catalog.templates.some(
        (template) =>
          template.id === 'official-social_cover' &&
          template.publicationStatus === 'published'
      )
    );
    assert.ok(
      catalog.versions.some(
        (version) => version.id === draft.id && version.status === 'published'
      )
    );
    assert.equal(catalog.workspaceId, admin.workspaceId);

    const retired = (await module.execute({
      context: admin,
      input: {
        action: 'admin_retire_template',
        payload: { templateId: 'official-social_cover' },
      },
    })) as { publicationStatus: string };
    assert.equal(retired.publicationStatus, 'retired');
  });

  it('passes an explicit prompt-only image data class through the Foundation command', async () => {
    const repository = new MemoryOperationsRepository();
    const context = {
      correlationId: 'corr-image-data-class',
      userId: 'owner-image-data-class',
      workspaceId: 'workspace-image-data-class',
    };
    repository.grantMembership(context.userId, context.workspaceId);
    const submissions: string[][] = [];
    const operations = new OperationsApplicationService(repository, {
      canvasExporter: new RecordedCanvasExportAdapter(),
      imageGenerator: {
        jobId() {
          return 'prompt-only-image-job';
        },
        async submit(request) {
          submissions.push(request.dataClass);
          return {
            actualModelId: request.requestedModelId,
            id: 'prompt-only-image-job',
            status: 'queued' as const,
          };
        },
      },
      notifier: { async send() {} },
    });
    const work = await operations.createBlankWork(
      { ...context, actor: 'owner' },
      { height: 1350, name: '显式分类生图', width: 1080 }
    );
    const module = new OperationsFoundationModule(operations);

    await module.execute({
      context,
      input: {
        action: 'start_canvas_image',
        payload: {
          dataClass: ['medical', 'contains_face', 'medical'],
          modelId: 'seedream-5-pro',
          operation: 'generate',
          prompt: '含顾客面部和疗程语义的创意图',
          workId: work.id,
        },
      },
    });

    assert.deepEqual(submissions, [['contains_face', 'medical']]);
  });

  it('queries the latest recoverable canvas image job by work', async () => {
    const repository = new MemoryOperationsRepository();
    const context = {
      correlationId: 'corr-image-recovery',
      userId: 'owner-image-recovery',
      workspaceId: 'workspace-image-recovery',
    };
    repository.grantMembership(context.userId, context.workspaceId);
    const operations = new OperationsApplicationService(repository, {
      canvasExporter: new RecordedCanvasExportAdapter(),
      imageGenerator: new RecordedImageGenerationAdapter(),
      notifier: { async send() {} },
    });
    const work = await operations.createBlankWork(
      { ...context, actor: 'owner' },
      { height: 1350, name: '恢复生图任务', width: 1080 }
    );
    const job = await operations.startCanvasImageGeneration(
      { ...context, actor: 'owner' },
      {
        modelId: 'gpt-image-2',
        operation: 'generate',
        prompt: '页面刷新后恢复',
        workId: work.id,
      }
    );
    const module = new OperationsFoundationModule(operations);

    const recovered = (await module.query({
      context,
      input: {
        action: 'latest_canvas_image_job',
        payload: { workId: work.id },
      },
    })) as { id: string };

    assert.equal(recovered.id, job.id);
  });

  it('does not grant admin bypass to ordinary operations actions', async () => {
    const repository = new MemoryOperationsRepository();
    const module = new OperationsFoundationModule(
      new OperationsApplicationService(repository, {
        canvasExporter: new RecordedCanvasExportAdapter(),
        imageGenerator: new RecordedImageGenerationAdapter(),
        notifier: { async send() {} },
      }),
      { adminActorIds: ['admin-without-membership'] }
    );

    await assert.rejects(
      module.execute({
        context: {
          correlationId: 'corr-admin-ordinary',
          userId: 'admin-without-membership',
          workspaceId: 'workspace-ordinary',
        },
        input: {
          action: 'create_task',
          payload: {
            dueAt: '2026-07-13T09:00:00.000Z',
            executable: true,
            risk: 'normal',
            source: 'manual',
            title: 'Must remain owner-scoped',
          },
        },
      }),
      (error: unknown) =>
        error instanceof Error && error.message === 'Workspace access denied.'
    );
  });
});
