import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
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
import { OperationsError } from './application-service.js';

describe('operations foundation module', () => {
  it('retires the public CreativeContent acceptance command after cutover', async () => {
    const module = new OperationsFoundationModule(
      {} as OperationsApplicationService,
    );

    await assert.rejects(
      module.execute({
        context: {
          correlationId: 'corr-z1-retirement',
          userId: 'owner-z1-retirement',
          workspaceId: 'workspace-z1-retirement',
        },
        input: {
          action: 'accept_creative_asset',
          payload: { assetId: 'legacy-asset' },
        },
      }),
      /Unknown operations command/u,
    );
  });

  it('keeps ContentPackage migration commands and reports behind the admin gate', async () => {
    const calls: string[] = [];
    const unexpectedMigrationCall = () => {
      throw new Error('Unexpected migration operation.');
    };
    const module = new OperationsFoundationModule(
      {} as OperationsApplicationService,
      {
        adminActorIds: ['migration-admin'],
        contentPackageMigration: {
          activate: unexpectedMigrationCall,
          backfill: unexpectedMigrationCall,
          async dryRun(workspaceId: string, runId: string) {
            calls.push(`dry-run:${workspaceId}:${runId}`);
            return { runId };
          },
          freeze: unexpectedMigrationCall,
          inspect: unexpectedMigrationCall,
          async report(workspaceId: string, runId: string) {
            calls.push(`report:${workspaceId}:${runId}`);
            return { runId };
          },
          rollback: unexpectedMigrationCall,
          status: unexpectedMigrationCall,
        },
      }
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

    assert.deepEqual(calls, [
      'dry-run:workspace-migration-admin:run-1',
      'report:workspace-migration-admin:run-1',
    ]);
  });

  it('returns 503 when ContentPackage migration is not configured', async () => {
    const module = new OperationsFoundationModule(
      {} as OperationsApplicationService,
      { adminActorIds: ['migration-admin'] }
    );

    await assert.rejects(
      module.execute({
        context: {
          correlationId: 'corr-migration-unavailable',
          userId: 'migration-admin',
          workspaceId: 'workspace-migration-unavailable',
        },
        input: {
          action: 'content_package_migration_inspect',
          payload: { runId: 'run-unavailable' },
        },
      }),
      (error: unknown) =>
        error instanceof OperationsError &&
        error.code === 'CONTENT_PACKAGE_MIGRATION_UNAVAILABLE' &&
        error.message === 'ContentPackage migration is not configured.' &&
        error.status === 503
    );
  });

  it('routes only trusted package lineage when creating a Canvas work from content', async () => {
    const calls: unknown[] = [];
    const module = new OperationsFoundationModule({
      async createWorkFromContentPackage(_context: unknown, input: unknown) {
        calls.push(input);
        return { id: 'canvas-work-from-package' };
      },
    } as unknown as OperationsApplicationService);
    const context = {
      correlationId: 'corr-package-canvas-module',
      userId: 'owner-package-canvas-module',
      workspaceId: 'workspace-package-canvas-module',
    };

    await module.execute({
      context,
      input: {
        action: 'create_work_from_content_package',
        payload: {
          body: 'forged URL seed body',
          height: 3508,
          sourcePackageId: 'package-1',
          sourceVersionId: 'package-1-v3',
          title: 'forged URL seed title',
          width: 2480,
        },
      },
    });

    assert.deepEqual(calls, [
      {
        height: 3508,
        sourcePackageId: 'package-1',
        sourceVersionId: 'package-1-v3',
        width: 2480,
      },
    ]);
  });

  it('rejects non-integer Canvas dimensions before package seeding', async () => {
    const calls: unknown[] = [];
    const module = new OperationsFoundationModule({
      async createWorkFromContentPackage(_context: unknown, input: unknown) {
        calls.push(input);
        return { id: 'must-not-exist' };
      },
    } as unknown as OperationsApplicationService);
    const context = {
      correlationId: 'corr-package-canvas-dimensions',
      userId: 'owner-package-canvas-dimensions',
      workspaceId: 'workspace-package-canvas-dimensions',
    };

    for (const dimensions of [
      { height: 3508, width: Number.NaN },
      { height: 3508, width: Number.POSITIVE_INFINITY },
      { height: 3508, width: 2480.5 },
      { height: 3508, width: '2480' },
      { height: 0, width: 2480 },
    ]) {
      await assert.rejects(
        module.execute({
          context,
          input: {
            action: 'create_work_from_content_package',
            payload: {
              ...dimensions,
              sourcePackageId: 'package-1',
              sourceVersionId: 'package-1-v3',
            },
          },
        }),
        (error: unknown) =>
          error instanceof OperationsError && error.code === 'INVALID_INPUT'
      );
    }
    assert.deepEqual(calls, []);
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
      actor: 'admin' as const,
      correlationId: 'corr-module-crash',
      userId: 'owner-module-crash',
      workspaceId: 'workspace-module-crash',
    };
    foundation.grantOwner(context.workspaceId, context.userId);
    operations.grantMembership(context.userId, context.workspaceId);
    const operationsService = new OperationsApplicationService(operations, {
      canvasExporter: new RecordedCanvasExportAdapter(),
      imageGenerator: new RecordedImageGenerationAdapter(),
      notifier: { async send() {} },
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
    const catalog = await operations.loadTemplateCatalog();
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
          action: 'create_work_from_content_package',
          payload: {
            height: 1350,
            sourcePackageId: 'package-owner-scoped',
            sourceVersionId: 'package-owner-scoped-v1',
            width: 1080,
          },
        },
      }),
      (error: unknown) =>
        error instanceof Error && error.message === 'Workspace access denied.'
    );
  });
});
