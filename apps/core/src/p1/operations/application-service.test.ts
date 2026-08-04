import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import sharp from 'sharp';
import {
  DEFAULT_CANVAS_TEMPLATE_NAME,
  DEFAULT_CANVAS_WORK_NAME,
  PROMOTIONAL_MATERIAL_SPECS,
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













});
