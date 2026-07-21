import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  adoptIntoContentPackageCommandSchema,
  CONTENT_PACKAGE_COMMAND_SCHEMAS,
  CONTENT_PACKAGE_ACTIONS_BY_STATUS,
  CONTENT_PACKAGE_QUERY_SCHEMAS,
  CONTENT_PACKAGE_STATUS_CONTRACTS,
  contentPackageSchema,
  contentPackageVersionSchema,
  contentPackageVersionSourceRefIsReadOnly,
  contentPackageStatusGroup,
  contentPackageStatusLabel,
  contentPackageStatusSchema,
} from '@meiye/contracts';
import {
  MemoryFoundationRepository,
  P1ApplicationService,
} from '../foundation/index.js';
import {
  assertContentPackageExportAllowed,
  buildContentPackage,
  ContentPackageTransitionError,
  transitionContentPackage,
} from './content-package.js';
import { ResultDeliveryFoundationModule } from '../result-delivery/foundation-module.js';
import { OperationsVisualAdoptionPort } from '../result-delivery/operations-visual-adoption.js';
import { ContentPackageDeliveryService } from './content-package-delivery.js';
import {
  type CreationExecutorPort,
  type ContentPackageExportPort,
  type ContentPackageRightsResolverPort,
  MemoryOperationsRepository,
  OperationsApplicationService,
  OperationsError,
  OperationsFoundationModule,
  RecordedCanvasExportAdapter,
  RecordedImageGenerationAdapter,
  UnverifiedVideoComplianceError,
} from './index.js';

const NOW = '2026-07-15T09:00:00.000Z';

function setup(
  options: {
    contentPackageExporter?: ContentPackageExportPort;
    contentPackageRightsResolver?: ContentPackageRightsResolverPort;
    contentWriteOwnership?: {
      get(
        workspaceId: string,
      ): Promise<'legacy' | 'frozen' | 'contentpackage'>;
    };
    creationExecutor?: CreationExecutorPort;
  } = {}
) {
  const foundation = new MemoryFoundationRepository();
  const operations = new MemoryOperationsRepository();
  const context = {
    correlationId: 'corr-content-package',
    userId: 'owner-content-package',
    workspaceId: 'workspace-content-package',
  };
  const otherContext = {
    correlationId: 'corr-content-package-other',
    userId: 'owner-content-package-other',
    workspaceId: 'workspace-content-package-other',
  };
  foundation.grantOwner(context.workspaceId, context.userId);
  foundation.grantOwner(otherContext.workspaceId, otherContext.userId);
  operations.grantMembership(context.userId, context.workspaceId);
  operations.grantMembership(otherContext.userId, otherContext.workspaceId);
  const operationsService = new OperationsApplicationService(operations, {
    canvasExporter: new RecordedCanvasExportAdapter(),
    ...(options.creationExecutor
      ? { creationExecutor: options.creationExecutor }
      : {}),
    ...(options.contentPackageExporter
      ? { contentPackageExporter: options.contentPackageExporter }
      : {}),
    ...(options.contentPackageRightsResolver
      ? { contentPackageRightsResolver: options.contentPackageRightsResolver }
      : {}),
    ...(options.contentWriteOwnership
      ? { contentWriteOwnership: options.contentWriteOwnership }
      : {}),
    imageGenerator: new RecordedImageGenerationAdapter(),
    notifier: { async send() {} },
  });
  const service = new P1ApplicationService(foundation, {
    operations: [new OperationsFoundationModule(operationsService)],
  });
  return {
    context,
    foundation,
    operations,
    operationsService,
    otherContext,
    service,
  };
}

async function seedAcceptedPackage(
  operations: MemoryOperationsRepository,
  operationsService: OperationsApplicationService,
  context: { correlationId: string; userId: string; workspaceId: string },
  kind: 'image_text' | 'video',
  workflow?: {
    targetPlatform: 'xiaohongshu' | 'douyin' | 'video_account';
    workflowId: string;
    workflowRevision: number;
  }
) {
  const created = await operationsService.createContentPackage(
    { ...context, actor: 'owner' },
    {
      kind,
      source: { assetIds: [`source-${kind}`], ...workflow },
    }
  );
  const state = await operations.loadWorkspace(context.workspaceId);
  assert.ok(state);
  const packageId = created.id;
  const versionId = `${packageId}-v1`;
  const draft = state.contentPackages.find((item) => item.id === packageId);
  assert.ok(draft);
  const accepted = transitionContentPackage(
    { ...draft, status: 'review_ready' },
    {
      type: 'adopted',
      version: {
        body: '门店基础正文',
        conversionHook: '立即预约',
        createdAt: NOW,
        id: versionId,
        orderedAssetIds: [`owned-${kind}-1`],
        title: '门店基础标题',
        topics: ['美业'],
      },
    },
    NOW
  );
  state.contentPackages = state.contentPackages.map((item) =>
    item.id === accepted.id ? accepted : item
  );
  await operations.saveWorkspace(state);
  return accepted;
}

function recordedPackageExporter() {
  return {
    async export(input: Parameters<ContentPackageExportPort['export']>[0]) {
      return {
        artifactAssetId: `export-${input.platform}`,
        artifactObjectKey: `${input.workspaceId}/exports/${input.packageId}-${input.platform}.zip`,
        contentType: 'application/zip' as const,
        sha256: 'f'.repeat(64),
        sizeBytes: 256,
      };
    },
  };
}

async function seedWorkflowPackageWithVariants(
  operations: MemoryOperationsRepository,
  operationsService: OperationsApplicationService,
  context: { correlationId: string; userId: string; workspaceId: string },
  input: {
    suffix: string;
    targetPlatform: 'xiaohongshu' | 'douyin' | 'video_account';
    workflowId: string;
    workflowRevision: number;
  }
) {
  const contentPackage = await seedAcceptedPackage(
    operations,
    operationsService,
    context,
    'image_text',
    input
  );
  const state = await operations.loadWorkspace(context.workspaceId);
  assert.ok(state);
  const stored = state.contentPackages.find(
    (candidate) => candidate.id === contentPackage.id
  );
  assert.ok(stored);
  stored.variants = (
    ['xiaohongshu', 'douyin', 'video_account'] as const
  ).map((platform) => {
    const versionId = `${platform}-${input.suffix}-v1`;
    return {
      currentVersionId: versionId,
      id: `${stored.id}-${platform}`,
      platform,
      versions: [
        {
          body: `${platform} 平台正文`,
          createdAt: NOW,
          id: versionId,
          orderedAssetIds: ['owned-image_text-1'],
          title: `${platform} 平台标题`,
          topics: ['美业'],
        },
      ],
    };
  });
  await operations.saveWorkspace(state);
  return stored;
}

describe('ContentPackage application service contract', () => {
  it('creates a server-seeded Canvas work from the exact authorized package version', async () => {
    const { context, operations, operationsService } = setup();
    const contentPackage = await seedAcceptedPackage(
      operations,
      operationsService,
      context,
      'image_text'
    );
    const state = await operations.loadWorkspace(context.workspaceId);
    assert.ok(state);
    const stored = state.contentPackages.find(
      (candidate) => candidate.id === contentPackage.id
    );
    assert.ok(stored);
    const sourceVersionId = stored.currentVersionId!;
    stored.versions.push({
      ...stored.versions[0]!,
      body: '不应进入画布的新正文',
      conversionHook: '不应进入画布的新动作',
      id: `${stored.id}-v2`,
      title: '不应进入画布的新标题',
    });
    stored.currentVersionId = `${stored.id}-v2`;
    stored.generated.ownedAssets = [
      {
        contentType: 'image/png',
        id: 'owned-image_text-1',
        objectKey: 'workspace-content-package/generated/hero.png',
        sha256: 'a'.repeat(64),
      },
    ];
    await operations.saveWorkspace(state);

    const work = await operationsService.createWorkFromContentPackage(
      { ...context, actor: 'owner' },
      {
        height: 3508,
        sourcePackageId: stored.id,
        sourceVersionId,
        width: 2480,
      }
    );
    const elements = work.revisions[0]!.document.pages[0]!.elements;

    assert.equal(work.sourceContentPackageId, stored.id);
    assert.equal(work.sourceContentPackageVersionId, sourceVersionId);
    assert.equal(work.aigcLabelEnabled, stored.compliance.aigcLabelEnabled);
    assert.equal(
      work.brandWatermarkEnabled,
      stored.compliance.watermarkEnabled
    );
    assert.deepEqual(
      elements
        .filter((element) => element.kind === 'text')
        .map((element) => element.text),
      ['门店基础标题', '门店基础正文', '立即预约']
    );
    assert.deepEqual(
      elements
        .filter((element) => element.kind === 'image')
        .map((element) => ({ assetId: element.assetId, src: element.src })),
      [
        {
          assetId: 'owned-image_text-1',
          src: '/api/core/p1/assets?objectKey=workspace-content-package%2Fgenerated%2Fhero.png',
        },
      ]
    );

    const persisted = await operations.loadWorkspace(context.workspaceId);
    assert.ok(persisted);
    assert.equal(
      persisted.auditEvents.at(-1)?.action,
      'canvas_work.created_from_content_package'
    );
  });

  it('rejects Canvas seeding after the source package rights are revoked', async () => {
    const { context, operations, operationsService } = setup();
    const contentPackage = await seedAcceptedPackage(
      operations,
      operationsService,
      context,
      'image_text'
    );
    const state = await operations.loadWorkspace(context.workspaceId);
    assert.ok(state);
    const stored = state.contentPackages.find(
      (candidate) => candidate.id === contentPackage.id
    );
    assert.ok(stored);
    stored.rights = {
      state: 'revoked',
      reason: 'source authorization withdrawn',
      revokedAt: NOW,
    };
    await operations.saveWorkspace(state);

    await assert.rejects(
      operationsService.createWorkFromContentPackage(
        { ...context, actor: 'owner' },
        {
          height: 3508,
          sourcePackageId: stored.id,
          sourceVersionId: stored.currentVersionId!,
          width: 2480,
        }
      ),
      (error: unknown) =>
        error instanceof OperationsError &&
        error.code === 'CONTENT_PACKAGE_RIGHTS_REVOKED'
    );
  });

  it('keeps future advanced-canvas source schemas read-only in edit commands', async () => {
    const { context, operations, operationsService } = setup();
    const contentPackage = await seedAcceptedPackage(
      operations,
      operationsService,
      context,
      'image_text'
    );
    const state = await operations.loadWorkspace(context.workspaceId);
    assert.ok(state);
    const stored = state.contentPackages.find(
      (candidate) => candidate.id === contentPackage.id
    );
    assert.ok(stored);
    const version = stored.versions.find(
      (candidate) => candidate.id === stored.currentVersionId
    );
    assert.ok(version);
    version.sourceRef = {
      advancedCanvas: {
        orderedMediaNodeIds: ['node-image-1'],
        projectId: 'advanced-project-future',
        revisionId: 'advanced-revision-future',
        schemaVersion: 2,
        selectedNodeIds: ['node-image-1'],
      },
    };
    await operations.saveWorkspace(state);

    await assert.rejects(
      operationsService.editContentPackageVersion(
        { ...context, actor: 'owner' },
        {
          baseVersionId: stored.currentVersionId!,
          changes: {
            body: '不应保存的正文',
            orderedAssetIds: ['owned-image_text-1'],
            title: '不应保存的标题',
            topics: [],
          },
          expectedRevision: stored.revision,
          packageId: stored.id,
        }
      ),
      (error: unknown) =>
        error instanceof OperationsError &&
        error.code === 'CONTENT_PACKAGE_SOURCE_REF_READ_ONLY'
    );
  });

  it('blocks frozen workspaces with a recheck inside the workspace lock and keeps legacy workspaces writable', async () => {
    let owner: 'legacy' | 'frozen' | 'contentpackage' = 'contentpackage';
    const { context, operations, operationsService } = setup({
      contentWriteOwnership: { get: async () => owner },
    });
    let releaseLock = () => {};
    let markLockAcquired = () => {};
    const lockAcquired = new Promise<void>((resolve) => {
      markLockAcquired = resolve;
    });
    const lockGate = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const holding = operations.withWorkspaceLock(
      context.workspaceId,
      async () => {
        markLockAcquired();
        await lockGate;
      },
    );
    await lockAcquired;

    const creating = operationsService.createContentPackage(
      { ...context, actor: 'owner' },
      { kind: 'image_text', source: { assetIds: ['asset-race'] } },
    );
    owner = 'frozen';
    releaseLock();
    await holding;

    await assert.rejects(
      creating,
      (error) =>
        error instanceof OperationsError &&
        error.code === 'CONTENT_COMMANDS_FROZEN',
    );
    assert.equal(
      (await operations.loadWorkspace(context.workspaceId))?.contentPackages
        .length ?? 0,
      0,
    );

    // 票 17 只冻结旧写方向：legacy（未迁移）workspace 的 ContentPackage
    // 新链写入必须保持可用，否则存量商户的采用/视频主链会被 409 冻死。
    owner = 'legacy';
    const legacyCreated = await operationsService.createContentPackage(
      { ...context, actor: 'owner' },
      { kind: 'image_text', source: { assetIds: ['asset-legacy'] } },
    );
    assert.equal(legacyCreated.status, 'draft');

    owner = 'contentpackage';
    const created = await operationsService.createContentPackage(
      { ...context, actor: 'owner' },
      { kind: 'image_text', source: { assetIds: ['asset-active'] } },
    );
    assert.equal(created.status, 'draft');
  });

  it('propagates one withdrawn asset to every referencing package exactly once', async () => {
    const { context, operations, operationsService } = setup();
    const contentPackage = await seedAcceptedPackage(
      operations,
      operationsService,
      context,
      'image_text',
    );

    const first = await operationsService.revokeContentPackagesUsingAsset(
      { ...context, actor: 'owner' },
      'owned-image_text-1',
    );
    const replay = await operationsService.revokeContentPackagesUsingAsset(
      { ...context, actor: 'owner' },
      'owned-image_text-1',
    );
    const revoked = await operationsService.getContentPackage(
      { ...context, actor: 'owner' },
      contentPackage.id,
    );

    assert.deepEqual(first.revokedPackageIds, [contentPackage.id]);
    assert.deepEqual(replay.revokedPackageIds, []);
    assert.equal(revoked.status, 'needs_replacement');
    assert.equal(revoked.rights.reason, 'asset_withdrawn:owned-image_text-1');
    assert.throws(
      () => assertContentPackageExportAllowed(revoked),
      ContentPackageTransitionError,
    );
  });

  it('edits a needs-replacement base version without changing status or billing facts', async () => {
    const { context, operations, operationsService, service } = setup();
    const contentPackage = await seedAcceptedPackage(
      operations,
      operationsService,
      context,
      'image_text'
    );
    await operationsService.revokeContentPackagesUsingAsset(
      { ...context, actor: 'owner' },
      'owned-image_text-1'
    );
    const before = await operations.loadWorkspace(context.workspaceId);
    const beforePackage = before?.contentPackages.find(
      (candidate) => candidate.id === contentPackage.id
    );
    assert.ok(beforePackage);
    const billingFacts = structuredClone(beforePackage.generated.childRuns);

    const edited = (await service.executeModule(
      context,
      'operations',
      {
        action: 'edit_content_package_version',
        payload: {
          baseVersionId: beforePackage.currentVersionId,
          changes: {
            body: '撤权后补充说明的正文',
            conversionHook: '更换素材后预约',
            orderedAssetIds: ['owned-image_text-1'],
            title: '撤权后补充说明的标题',
            topics: ['素材待替换'],
          },
          expectedRevision: beforePackage.revision,
          packageId: beforePackage.id,
        },
      },
      'edit-needs-replacement-base'
    )) as {
      generated: { childRuns: unknown[] };
      status: string;
      versions: Array<{ body: string }>;
    };

    assert.equal(edited.status, 'needs_replacement');
    assert.equal(edited.versions.length, 2);
    assert.equal(edited.versions.at(-1)?.body, '撤权后补充说明的正文');
    assert.deepEqual(edited.generated.childRuns, billingFacts);
  });

  it('edits a needs-replacement variant with the same free-edit contract', async () => {
    const { context, operations, operationsService, service } = setup();
    const contentPackage = await seedAcceptedPackage(
      operations,
      operationsService,
      context,
      'image_text'
    );
    const state = await operations.loadWorkspace(context.workspaceId);
    assert.ok(state);
    const stored = state.contentPackages.find(
      (candidate) => candidate.id === contentPackage.id
    );
    assert.ok(stored);
    stored.variants = (
      ['xiaohongshu', 'douyin', 'video_account'] as const
    ).map((platform) => ({
      currentVersionId: `needs-replacement-${platform}-v1`,
      id: `${stored.id}-${platform}`,
      platform,
      versions: [
        {
          body: `撤权前的 ${platform} 正文`,
          createdAt: NOW,
          id: `needs-replacement-${platform}-v1`,
          orderedAssetIds: ['owned-image_text-1'],
          title: `撤权前的 ${platform} 标题`,
          topics: ['美业'],
        },
      ],
    }));
    await operations.saveWorkspace(state);
    await operationsService.revokeContentPackagesUsingAsset(
      { ...context, actor: 'owner' },
      'owned-image_text-1'
    );
    const before = await operations.loadWorkspace(context.workspaceId);
    const beforePackage = before?.contentPackages.find(
      (candidate) => candidate.id === contentPackage.id
    );
    assert.ok(beforePackage);
    const billingFacts = structuredClone(beforePackage.generated.childRuns);

    const edited = (await service.executeModule(
      context,
      'operations',
      {
        action: 'edit_content_package_variant',
        payload: {
          baseVersionId: 'needs-replacement-xiaohongshu-v1',
          changes: {
            body: '撤权后补充说明的小红书正文',
            orderedAssetIds: ['owned-image_text-1'],
            title: '撤权后补充说明的小红书标题',
            topics: ['素材待替换'],
          },
          expectedRevision: beforePackage.revision,
          packageId: beforePackage.id,
          platform: 'xiaohongshu',
        },
      },
      'edit-needs-replacement-variant'
    )) as {
      generated: { childRuns: unknown[] };
      status: string;
      variants: Array<{ platform: string; versions: Array<{ body: string }> }>;
    };

    assert.equal(edited.status, 'needs_replacement');
    assert.equal(edited.variants[0]?.versions.length, 2);
    assert.equal(
      edited.variants[0]?.versions.at(-1)?.body,
      '撤权后补充说明的小红书正文'
    );
    assert.deepEqual(edited.generated.childRuns, billingFacts);
  });

  it('rejects the legacy direct-copy command and keeps the source package unchanged', async () => {
    const { context, operations, operationsService, service } = setup();
    const source = await seedAcceptedPackage(
      operations,
      operationsService,
      context,
      'image_text'
    );
    await assert.rejects(
      service.executeModule(
        context,
        'operations',
        {
          action: 'reuse_content_package',
          payload: { sourcePackageId: source.id },
        },
        'reuse-source-v1'
      ),
      (error: unknown) =>
        error instanceof OperationsError &&
        error.code === 'REUSE_TASK_REQUIRED'
    );
    const stored = (await operations.loadWorkspace(context.workspaceId))
      ?.contentPackages;
    assert.deepEqual(stored, [source]);
  });

  it('keeps Task-delivered reuse lineage navigable without copying source content', async () => {
    const { context, operations, operationsService } = setup();
    const source = await seedAcceptedPackage(
      operations,
      operationsService,
      context,
      'image_text'
    );
    const state = await operations.loadWorkspace(context.workspaceId);
    assert.ok(state);
    const targetId = 'task-delivered-reuse-package';
    const targetVersionId = `${targetId}-v1`;
    const target = contentPackageSchema.parse({
      ...buildContentPackage({
        id: targetId,
        workspaceId: context.workspaceId,
        kind: 'image_text',
        source: { assetIds: ['current-task-asset'] },
        timestamp: NOW,
      }),
      lineage: { reusedFromPackageId: source.id },
      revision: 1,
      status: 'review_ready',
      currentVersionId: targetVersionId,
      versions: [
        {
          id: targetVersionId,
          title: '当前任务新标题',
          body: '当前任务按新事实生成的正文',
          orderedAssetIds: ['current-task-asset'],
          topics: [],
          createdAt: NOW,
          createdBy: context.userId,
          source: 'ai_generated',
        },
      ],
    });
    state.contentPackages.push(target);
    await operations.saveWorkspace(state);

    const targetLineage = await operationsService.getContentPackageLineage(
      { ...context, actor: 'owner' },
      target.id
    );
    const sourceLineage = await operationsService.getContentPackageLineage(
      { ...context, actor: 'owner' },
      source.id
    );

    assert.deepEqual(
      targetLineage.ancestors.map((item) => item.id),
      [source.id]
    );
    assert.deepEqual(
      sourceLineage.children.map((item) => item.id),
      [target.id]
    );
    assert.notEqual(target.versions[0]?.body, source.versions[0]?.body);
  });

  it('exports the selected current variant once and persists a verifiable receipt', async () => {
    let exportEffects = 0;
    const contentPackageExporter: ContentPackageExportPort = {
      async export() {
        exportEffects += 1;
        return {
          artifactAssetId: 'owned-export-zip',
          artifactObjectKey: 'workspace-1/exports/package.zip',
          contentType: 'application/zip',
          sha256: 'a'.repeat(64),
          sizeBytes: 512,
        };
      },
    };
    const { context, operations, operationsService, service } = setup({
      contentPackageExporter,
    });
    const contentPackage = await seedAcceptedPackage(
      operations,
      operationsService,
      context,
      'image_text'
    );
    const state = await operations.loadWorkspace(context.workspaceId);
    assert.ok(state);
    const stored = state.contentPackages.find(
      (item) => item.id === contentPackage.id
    );
    assert.ok(stored);
    stored.generated.childRuns.push({
      apiCounterparty: 'internal-provider',
      providerCost: {
        amount: 0.0042,
        currency: 'USD',
        status: 'observed',
      },
      providerModel: 'internal-model',
      routeSnapshotId: 'internal-route',
      runId: 'internal-run',
      runType: 'model_job',
      status: 'succeeded',
    });
    stored.variants = (['xiaohongshu', 'douyin', 'video_account'] as const).map(
      (platform) => {
        const versionId = `${platform}-export-v1`;
        return {
          currentVersionId: versionId,
          id: `${stored.id}-${platform}`,
          platform,
          versions: [
            {
              body: `${platform} 导出正文`,
              createdAt: NOW,
              id: versionId,
              orderedAssetIds: ['owned-image_text-1'],
              title: `${platform} 导出标题`,
              topics: ['美业'],
            },
          ],
        };
      }
    );
    await operations.saveWorkspace(state);
    const command = {
      action: 'export_content_package',
      payload: {
        expectedRevision: stored.revision,
        packageId: stored.id,
        platform: 'xiaohongshu',
      },
    };

    const exported = (await service.executeModule(
      context,
      'operations',
      command,
      'export-xiaohongshu-v1'
    )) as { exportReceipts: Array<Record<string, unknown>>; status: string };
    const replayed = await service.executeModule(
      context,
      'operations',
      command,
      'export-xiaohongshu-v1'
    );

    assert.equal(exportEffects, 1);
    assert.equal(exported.status, 'accepted');
    assert.deepEqual(replayed, exported);
    assert.equal(exported.exportReceipts.length, 1);
    assert.equal(JSON.stringify(exported).includes('providerCost'), false);
    assert.equal(JSON.stringify(exported).includes('apiCounterparty'), false);
    assert.equal(JSON.stringify(exported).includes('providerModel'), false);
    assert.equal(JSON.stringify(exported).includes('routeSnapshotId'), false);
    assert.equal(typeof exported.exportReceipts[0]?.createdAt, 'string');
    assert.equal(typeof exported.exportReceipts[0]?.id, 'string');
    assert.deepEqual(
      {
        ...exported.exportReceipts[0],
        createdAt: undefined,
        id: undefined,
      },
      {
        appliedCompliance: {
          aigcLabelEnabled: false,
          watermarkEnabled: false,
        },
        artifactAssetId: 'owned-export-zip',
        artifactObjectKey: 'workspace-1/exports/package.zip',
        contentType: 'application/zip',
        correlationId: context.correlationId,
        createdAt: undefined,
        id: undefined,
        platform: 'xiaohongshu',
        sha256: 'a'.repeat(64),
        sizeBytes: 512,
        status: 'succeeded',
        variantVersionId: 'xiaohongshu-export-v1',
      }
    );
    const internalRun = (
      await operations.loadWorkspace(context.workspaceId)
    )?.contentPackages
      .find((item) => item.id === stored.id)
      ?.generated.childRuns.find((run) => run.runId === 'internal-run');
    assert.equal(internalRun?.apiCounterparty, 'internal-provider');
    assert.equal(internalRun?.providerCost?.amount, 0.0042);
    assert.equal(internalRun?.providerModel, 'internal-model');
    assert.equal(internalRun?.routeSnapshotId, 'internal-route');
  });

  it('moves a labeled video rejected by the verified exporter to needs replacement without a receipt', async () => {
    let exportEffects = 0;
    const { context, operations, operationsService } = setup({
      contentPackageExporter: {
        async export() {
          exportEffects += 1;
          throw new UnverifiedVideoComplianceError();
        },
      },
    });
    const accepted = await seedAcceptedPackage(
      operations,
      operationsService,
      context,
      'video',
    );
    const state = await operations.loadWorkspace(context.workspaceId);
    assert.ok(state);
    const stored = state.contentPackages.find(
      (item) => item.id === accepted.id,
    );
    assert.ok(stored);
    stored.compliance = {
      aigcLabelEnabled: true,
      watermarkEnabled: false,
    };
    stored.variants = (
      ['xiaohongshu', 'douyin', 'video_account'] as const
    ).map((platform) => {
      const versionId = `${platform}-video-export-v1`;
      return {
        currentVersionId: versionId,
        id: `${stored.id}-${platform}`,
        platform,
        versions: [
          {
            body: `${platform} 视频正文`,
            createdAt: NOW,
            id: versionId,
            orderedAssetIds: ['owned-video-1'],
            title: `${platform} 视频标题`,
            topics: ['美业'],
          },
        ],
      };
    });
    await operations.saveWorkspace(state);

    const result = await operationsService.exportContentPackage(
      { ...context, actor: 'owner' },
      {
        expectedRevision: stored.revision,
        packageId: stored.id,
        platform: 'douyin',
      },
    );

    assert.equal(result.status, 'needs_replacement');
    assert.equal(result.statusGroup, 'needs_attention');
    assert.deepEqual(result.exportReceipts, []);
    assert.equal(exportEffects, 1);
    const persisted = await operations.loadWorkspace(context.workspaceId);
    const persistedPackage = persisted?.contentPackages.find(
      (item) => item.id === stored.id,
    );
    assert.equal(persistedPackage?.status, 'needs_replacement');
    assert.deepEqual(persistedPackage?.exportReceipts, []);
  });

  it('records every failed export retry without throwing a transition error', async () => {
    let exportEffects = 0;
    const { context, operations, operationsService } = setup({
      contentPackageExporter: {
        async export() {
          exportEffects += 1;
          throw new Error('archive unavailable');
        },
      },
    });
    const accepted = await seedAcceptedPackage(
      operations,
      operationsService,
      context,
      'image_text'
    );
    const state = await operations.loadWorkspace(context.workspaceId);
    assert.ok(state);
    const stored = state.contentPackages.find(
      (item) => item.id === accepted.id
    );
    assert.ok(stored);
    stored.variants = (
      ['xiaohongshu', 'douyin', 'video_account'] as const
    ).map((platform) => ({
      currentVersionId: `${platform}-export-retry-v1`,
      id: `${stored.id}-${platform}`,
      platform,
      versions: [
        {
          body: `${platform} 导出失败重试正文`,
          createdAt: NOW,
          id: `${platform}-export-retry-v1`,
          orderedAssetIds: ['owned-image_text-1'],
          title: `${platform} 导出失败重试标题`,
          topics: ['美业'],
        },
      ],
    }));
    await operations.saveWorkspace(state);

    const first = await operationsService.exportContentPackage(
      { ...context, actor: 'owner' },
      {
        expectedRevision: stored.revision,
        packageId: stored.id,
        platform: 'xiaohongshu',
      }
    );
    const second = await operationsService.exportContentPackage(
      { ...context, actor: 'owner' },
      {
        expectedRevision: first.revision,
        packageId: stored.id,
        platform: 'xiaohongshu',
      }
    );

    assert.equal(exportEffects, 2);
    assert.equal(first.status, 'export_failed');
    assert.equal(second.status, 'export_failed');
    assert.deepEqual(
      second.exportReceipts.map((receipt) => receipt.status),
      ['failed', 'failed']
    );
  });

  it('blocks export when live Product rights are revoked before propagation reaches the package snapshot', async () => {
    let exportEffects = 0;
    const { context, operations, operationsService } = setup({
      contentPackageExporter: {
        async export() {
          exportEffects += 1;
          return {
            artifactAssetId: 'must-not-export',
            artifactObjectKey: 'workspace-content-package/exports/blocked.zip',
            contentType: 'application/zip',
            sha256: 'b'.repeat(64),
            sizeBytes: 1,
          };
        },
      },
      contentPackageRightsResolver: {
        async resolve(input) {
          assert.deepEqual(input.assetIds.sort(), [
            'owned-image_text-1',
            'source-image_text',
          ]);
          return { unauthorizedAssetIds: ['source-image_text'] };
        },
      },
    });
    const accepted = await seedAcceptedPackage(
      operations,
      operationsService,
      context,
      'image_text'
    );
    const state = await operations.loadWorkspace(context.workspaceId);
    assert.ok(state);
    const stored = state.contentPackages.find(
      (item) => item.id === accepted.id
    );
    assert.ok(stored);
    stored.variants = (['xiaohongshu', 'douyin', 'video_account'] as const).map(
      (platform) => ({
        currentVersionId: `${platform}-live-rights-v1`,
        id: `${stored.id}-${platform}`,
        platform,
        versions: [
          {
            body: `${platform} 正文`,
            createdAt: NOW,
            id: `${platform}-live-rights-v1`,
            orderedAssetIds: ['owned-image_text-1'],
            title: `${platform} 标题`,
            topics: [],
          },
        ],
      })
    );
    assert.equal(stored.rights.state, 'authorized');
    await operations.saveWorkspace(state);

    await assert.rejects(
      () =>
        operationsService.exportContentPackage(
          { ...context, actor: 'owner' },
          {
            expectedRevision: stored.revision,
            packageId: stored.id,
            platform: 'xiaohongshu',
          }
        ),
      (error: unknown) =>
        error instanceof OperationsError && error.code === 'RIGHTS_REVOKED'
    );
    assert.equal(exportEffects, 0);
    const reloaded = await operations.loadWorkspace(context.workspaceId);
    assert.equal(
      reloaded?.contentPackages.find((item) => item.id === stored.id)
        ?.exportReceipts.length,
      0
    );
  });

  it('blocks variant generation when live Product rights revoke a source asset before propagation lands', async () => {
    let providerEffects = 0;
    const creationExecutor = {
      async inspect() {},
      async submit() {
        providerEffects += 1;
        throw new Error('provider must not be reached under revoked rights');
      },
    } as unknown as CreationExecutorPort;
    const { context, operations, operationsService } = setup({
      creationExecutor,
      contentPackageRightsResolver: {
        async resolve() {
          return { unauthorizedAssetIds: ['source-image_text'] };
        },
      },
    });
    const contentPackage = await seedAcceptedPackage(
      operations,
      operationsService,
      context,
      'image_text'
    );
    assert.equal(contentPackage.rights.state, 'authorized');

    await assert.rejects(
      () =>
        operationsService.generateContentPackageVariants(
          { ...context, actor: 'owner' },
          {
            contract: {
              aigcLabelEnabled: true,
              catalogModelId: 'llm-openai',
              catalogRevision: 'catalog-v1',
              currency: 'CNY',
              dataClass: [],
              estimatedAmount: 0.02,
              operation: 'copy.adapt',
              outputCount: 3,
              outputLabel: '三平台版本',
              quoteAcceptedAt: NOW,
              quoteRevision: 'quote-copy-adapt-v1',
              watermarkEnabled: false,
            },
            expectedRevision: contentPackage.revision,
            packageId: contentPackage.id,
            submissionKey: 'revoked-variant-submit',
          }
        ),
      (error: unknown) =>
        error instanceof OperationsError && error.code === 'RIGHTS_REVOKED'
    );
    assert.equal(providerEffects, 0);
    const reloaded = await operations.loadWorkspace(context.workspaceId);
    assert.equal(
      reloaded?.contentPackages.find((item) => item.id === contentPackage.id)
        ?.variants.length,
      0
    );
  });

  it('keeps platform version histories isolated and restores a target as a new version', async () => {
    const { context, operations, operationsService, service } = setup();
    const contentPackage = await seedAcceptedPackage(
      operations,
      operationsService,
      context,
      'image_text'
    );
    const state = await operations.loadWorkspace(context.workspaceId);
    assert.ok(state);
    const stored = state.contentPackages.find(
      (item) => item.id === contentPackage.id
    );
    assert.ok(stored);
    stored.variants = (['xiaohongshu', 'douyin', 'video_account'] as const).map(
      (platform) => ({
        currentVersionId: `${platform}-v1`,
        id: `${stored.id}-${platform}`,
        platform,
        versions: [
          {
            body: `${platform} 初稿`,
            conversionHook: '立即预约',
            createdAt: NOW,
            id: `${platform}-v1`,
            orderedAssetIds: ['owned-image_text-1'],
            title: `${platform} 标题`,
            topics: ['美业'],
          },
        ],
      })
    );
    await operations.saveWorkspace(state);

    const editedVariant = (await service.executeModule(
      context,
      'operations',
      {
        action: 'edit_content_package_variant',
        payload: {
          baseVersionId: 'douyin-v1',
          changes: {
            body: '抖音编辑稿',
            conversionHook: '评论预约',
            orderedAssetIds: ['owned-image_text-1'],
            title: '抖音编辑标题',
            topics: ['同城探店'],
          },
          expectedRevision: stored.revision,
          packageId: stored.id,
          platform: 'douyin',
        },
      },
      'edit-douyin-v2'
    )) as { revision: number };
    await service.executeModule(
      context,
      'operations',
      {
        action: 'rollback_content_package_version',
        payload: {
          expectedRevision: editedVariant.revision,
          packageId: stored.id,
          targetVersionId: 'douyin-v1',
        },
      },
      'rollback-douyin-v1'
    );
    const douyinHistory = (await service.queryModule(context, 'operations', {
      action: 'content_package_versions',
      payload: { packageId: stored.id, platform: 'douyin' },
    })) as Array<{
      body: string;
      id: string;
      revertedFromVersionId?: string;
      source?: string;
    }>;
    const loaded = (await service.queryModule(context, 'operations', {
      action: 'content_package',
      payload: { packageId: stored.id },
    })) as { variants: Array<{ platform: string; versions: unknown[] }> };

    assert.equal(douyinHistory.length, 3);
    assert.equal(douyinHistory.at(-1)?.body, 'douyin 初稿');
    assert.equal(douyinHistory.at(-1)?.source, 'rollback_restored');
    assert.equal(douyinHistory.at(-1)?.revertedFromVersionId, 'douyin-v1');
    assert.equal(
      loaded.variants.find((variant) => variant.platform === 'xiaohongshu')
        ?.versions.length,
      1
    );
  });

  it('rejects rollback for a cancelled package without changing version history', async () => {
    const { context, operations, operationsService } = setup();
    const contentPackage = await seedAcceptedPackage(
      operations,
      operationsService,
      context,
      'image_text'
    );
    const edited = await operationsService.editContentPackageVersion(
      { ...context, actor: 'owner' },
      {
        baseVersionId: contentPackage.currentVersionId!,
        changes: {
          body: '取消前的第二版正文',
          orderedAssetIds: ['owned-image_text-1'],
          title: '取消前的第二版标题',
          topics: ['美业'],
        },
        expectedRevision: contentPackage.revision,
        packageId: contentPackage.id,
      }
    );
    const cancelled = await operationsService.cancelContentPackage(
      { ...context, actor: 'owner' },
      { expectedRevision: edited.revision, packageId: contentPackage.id }
    );
    const versionHistory = structuredClone(cancelled.versions);

    await assert.rejects(
      operationsService.rollbackContentPackageVersion(
        { ...context, actor: 'owner' },
        {
          expectedRevision: cancelled.revision,
          packageId: contentPackage.id,
          targetVersionId: contentPackage.currentVersionId!,
        }
      ),
      (error: unknown) =>
        error instanceof OperationsError &&
        error.code === 'CONTENT_PACKAGE_TRANSITION_CONFLICT' &&
        error.status === 409
    );
    const reloaded = await operationsService.getContentPackage(
      { ...context, actor: 'owner' },
      contentPackage.id
    );

    assert.equal(edited.versions.length, 2);
    assert.equal(reloaded.status, 'cancelled');
    assert.deepEqual(reloaded.versions, versionHistory);
  });

  it('edits one ContentPackage version idempotently through the shared device-neutral seam', async () => {
    const { context, operations, operationsService, service } = setup();
    const contentPackage = await seedAcceptedPackage(
      operations,
      operationsService,
      context,
      'image_text'
    );
    const command = {
      action: 'edit_content_package_version',
      payload: {
        packageId: contentPackage.id,
        baseVersionId: contentPackage.currentVersionId,
        changes: {
          body: '手机编辑后的正文',
          conversionHook: '立即预约',
          orderedAssetIds: ['owned-image_text-1'],
          title: '手机编辑后的标题',
          topics: ['美业'],
        },
        expectedRevision: contentPackage.revision,
      },
    };

    const edited = await service.executeModule(
      context,
      'operations',
      command,
      'mobile-edit-one-package'
    );
    const replay = await service.executeModule(
      context,
      'operations',
      command,
      'mobile-edit-one-package'
    );
    const loaded = (await service.queryModule(context, 'operations', {
      action: 'content_package',
      payload: { packageId: contentPackage.id },
    })) as { currentVersionId: string; versions: Array<{ body: string }> };

    assert.deepEqual(replay, edited);
    assert.equal(loaded.versions.length, 2);
    assert.equal(loaded.versions.at(-1)?.body, '手机编辑后的正文');
    await assert.rejects(
      service.executeModule(
        context,
        'operations',
        {
          ...command,
          payload: {
            ...command.payload,
            changes: { ...command.payload.changes, body: '不同正文' },
          },
        },
        'mobile-edit-one-package'
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'IDEMPOTENCY_CONFLICT'
    );
  });

  it('creates one pending approval when the workflow target export becomes deliverable', async () => {
    let providerEffects = 0;
    let exportEffects = 0;
    const platformVariants = {
      xiaohongshu: {
        body: '适合小红书的种草笔记正文',
        conversionHook: '收藏后私信预约',
        title: '小红书种草标题',
        topics: ['同城美业', '门店体验'],
      },
      douyin: {
        body: '适合抖音口播的开场钩子与节奏文案',
        conversionHook: '评论区留言预约',
        title: '抖音口播标题',
        topics: ['同城探店'],
      },
      video_account: {
        body: '适合视频号熟人分享与私域转化的完整文案',
        conversionHook: '转发给有需要的朋友',
        title: '视频号分享标题',
        topics: ['熟客推荐'],
      },
    };
    const executionResult = {
      executionProvenance: {
        actualCatalogModelId: 'llm-openai',
        apiCounterparty: 'openai',
        providerModel: 'gpt-5-mini',
      },
      platformVariants,
      productUsage: { quantity: 1, status: 'committed' as const },
      providerJobId: 'variant-job-1',
      providerCost: {
        amount: 0.0034,
        currency: 'USD' as const,
        status: 'observed' as const,
      },
      routeSnapshotId: 'route-variant-1',
      status: 'completed' as const,
    };
    const creationExecutor = {
      async inspect() {},
      async submit() {
        providerEffects += 1;
        return executionResult;
      },
      async verify() {
        return executionResult;
      },
    } as unknown as CreationExecutorPort;
    const { context, operations, operationsService, service } = setup({
      creationExecutor,
      contentPackageExporter: {
        async export(input) {
          exportEffects += 1;
          return {
            artifactAssetId: `owned-export-${input.kind}`,
            artifactObjectKey: `${context.workspaceId}/exports/${input.packageId}.${input.kind === 'video' ? 'mp4' : 'zip'}`,
            contentType:
              input.kind === 'video'
                ? ('video/mp4' as const)
                : ('application/zip' as const),
            sha256: 'e'.repeat(64),
            sizeBytes: 512,
          };
        },
      },
    });

    for (const kind of ['image_text', 'video'] as const) {
      const contentPackage = await seedAcceptedPackage(
        operations,
        operationsService,
        context,
        kind,
        {
          targetPlatform: 'douyin',
          workflowId: `workflow-${kind}`,
          workflowRevision: 7,
        }
      );
      if (kind === 'image_text') {
        const state = await operations.loadWorkspace(context.workspaceId);
        assert.ok(state);
        const reviewReady = state.contentPackages.find(
          (item) => item.id === contentPackage.id
        );
        assert.ok(reviewReady);
        reviewReady.status = 'review_ready';
        await operations.saveWorkspace(state);
      }
      const command = {
        action: 'generate_content_package_variants',
        payload: {
          contract: {
            aigcLabelEnabled: true,
            catalogModelId: 'llm-openai',
            catalogRevision: 'catalog-v1',
            currency: 'CNY',
            dataClass: [],
            estimatedAmount: 0.02,
            operation: 'copy.adapt',
            outputCount: 3,
            outputLabel: '三平台版本',
            quoteAcceptedAt: NOW,
            quoteRevision: 'quote-copy-adapt-v1',
            watermarkEnabled: false,
          },
          expectedRevision: contentPackage.revision,
          packageId: contentPackage.id,
          submissionKey: `variant-submit-${kind}`,
        },
      };
      const generated = await service.executeModule<
        typeof command,
        {
          id: string;
          revision: number;
          status: string;
          variants: Array<{
            platform: string;
            currentVersionId: string;
            versions: Array<{
              body: string;
              orderedAssetIds: string[];
            }>;
          }>;
        }
      >(context, 'operations', command, `generate-package-variants-${kind}`);
      const replayed = await service.executeModule<
        typeof command,
        typeof generated
      >(context, 'operations', command, `generate-package-variants-${kind}`);

      assert.deepEqual(
        generated.variants.map((variant) => variant.platform).sort(),
        ['douyin', 'video_account', 'xiaohongshu']
      );
      assert.deepEqual(
        generated.variants.map(
          (variant) => variant.versions[0]?.orderedAssetIds
        ),
        [[`owned-${kind}-1`], [`owned-${kind}-1`], [`owned-${kind}-1`]]
      );
      assert.deepEqual(replayed, generated);
      assert.equal(generated.status, 'accepted');
      assert.equal(JSON.stringify(generated).includes('providerCost'), false);
      assert.equal(JSON.stringify(generated).includes('apiCounterparty'), false);
      assert.equal(JSON.stringify(generated).includes('providerModel'), false);
      assert.equal(JSON.stringify(generated).includes('routeSnapshotId'), false);
      let storedPackage = (
        await operations.loadWorkspace(context.workspaceId)
      )?.contentPackages.find((item) => item.id === contentPackage.id);
      assert.deepEqual(storedPackage?.approvalRequests ?? [], []);
      const exported = await operationsService.exportContentPackage(
        { ...context, actor: 'owner' },
        {
          expectedRevision: generated.revision,
          packageId: generated.id,
          platform: 'douyin',
        }
      );
      storedPackage = (
        await operations.loadWorkspace(context.workspaceId)
      )?.contentPackages.find((item) => item.id === contentPackage.id);
      const variantRun = storedPackage?.generated.childRuns.find(
        (run) => run.runType === 'model_job'
      );
      assert.deepEqual(variantRun, {
        actualCatalogModelId: 'llm-openai',
        apiCounterparty: 'openai',
        providerModel: 'gpt-5-mini',
        productUsage: { quantity: 1, status: 'committed' },
        providerCost: {
          amount: 0.0034,
          currency: 'USD',
          status: 'observed',
        },
        routeSnapshotId: 'route-variant-1',
        runId: 'variant-job-1',
        runType: 'model_job',
        status: 'succeeded',
      });
      assert.deepEqual(
        storedPackage?.approvalRequests?.map((request) => ({
          platform: request.platform,
          status: request.status,
          taskId: request.taskId,
          variantVersionId: request.variantVersionId,
          workflowRevision: request.workflowRevision,
        })),
        [
          {
            platform: 'douyin',
            status: 'pending',
            taskId: `workflow-${kind}`,
            variantVersionId: storedPackage?.variants.find(
              (variant) => variant.platform === 'douyin'
            )?.currentVersionId,
            workflowRevision: 7,
          },
        ]
      );
      assert.equal(
        storedPackage?.approvalRequests?.[0]?.contentPackageRevision,
        exported.revision
      );
    }
    assert.equal(providerEffects, 2);
    assert.equal(exportEffects, 2);
  });

  it('approves the fresh pending request after the same variant is re-exported', async () => {
    const { context, operations, operationsService } = setup({
      contentPackageExporter: recordedPackageExporter(),
    });
    const stored = await seedWorkflowPackageWithVariants(
      operations,
      operationsService,
      context,
      {
        suffix: 'reexport',
        targetPlatform: 'xiaohongshu',
        workflowId: 'workflow-reexport-approval',
        workflowRevision: 3,
      }
    );
    const delivery = new ContentPackageDeliveryService(operations, {
      approvalPolicy: {
        async resolve() {
          return {
            contextBundle: {
              bundleId: 'bundle-reexport-approval',
              hash: 'bundle-reexport-approval-hash',
              revision: 1,
            },
            policy: {
              brief: {},
              bundle: { revision: 1, workspaceId: context.workspaceId },
              candidate: {
                assetRefs: [],
                candidateId: 'candidate-reexport-approval',
                factClaims: [],
                intendedUse: 'public_content',
                workspaceId: context.workspaceId,
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
      clock: () => '2026-07-18T07:00:00.000Z',
      publisher: {
        async publish() {
          return {
            providerReceiptId: 'unused-publisher',
            status: 'published',
          };
        },
      },
    });
    const operationContext = { ...context, actor: 'owner' as const };
    const approve = (
      expectedRevision: number,
      requestId: string,
      idempotencyKey: string
    ) =>
      delivery.approve(operationContext, {
        accountId: 'xiaohongshu-account-a',
        actionKind: 'publish',
        actionScheduledAt: '2026-07-18T08:00:00.000Z',
        cost: { amount: 0, currency: 'CNY' },
        expectedRevision,
        idempotencyKey,
        packageId: stored.id,
        platform: 'xiaohongshu',
        purpose: 'publish_current_variant',
        requestId,
        variantVersionId: 'xiaohongshu-reexport-v1',
      });

    const firstExport = await operationsService.exportContentPackage(
      operationContext,
      {
        expectedRevision: stored.revision,
        packageId: stored.id,
        platform: 'xiaohongshu',
      }
    );
    const firstRequest = firstExport.approvalRequests?.at(-1);
    assert.ok(firstRequest);
    const firstApproval = await approve(
      firstExport.revision,
      firstRequest.id,
      'approve-first-export'
    );
    const afterFirstApproval = await operations.loadWorkspace(context.workspaceId);
    const approvedPackage = afterFirstApproval?.contentPackages.find(
      (candidate) => candidate.id === stored.id
    );
    assert.ok(approvedPackage);
    assert.equal(approvedPackage.approvalRequests?.[0]?.status, 'consumed');

    const secondExport = await operationsService.exportContentPackage(
      operationContext,
      {
        expectedRevision: approvedPackage.revision,
        packageId: stored.id,
        platform: 'xiaohongshu',
      }
    );
    const secondRequest = secondExport.approvalRequests?.at(-1);
    assert.ok(secondRequest);
    assert.deepEqual(
      secondExport.approvalRequests?.map((request) => request.status),
      ['consumed', 'pending']
    );
    const firstBeforeSecondApproval = structuredClone(
      secondExport.approvalRequests?.[0]
    );
    const secondApproval = await approve(
      secondExport.revision,
      secondRequest.id,
      'approve-second-export'
    );
    const finalState = await operations.loadWorkspace(context.workspaceId);
    const requests = finalState?.contentPackages.find(
      (candidate) => candidate.id === stored.id
    )?.approvalRequests;

    assert.equal(requests?.length, 2);
    assert.notEqual(requests?.[0]?.id, requests?.[1]?.id);
    assert.deepEqual(requests?.[0], firstBeforeSecondApproval);
    assert.equal(
      requests?.[0]?.status === 'consumed'
        ? requests[0].receiptId
        : undefined,
      firstApproval.id
    );
    assert.equal(
      requests?.[1]?.status === 'consumed'
        ? requests[1].receiptId
        : undefined,
      secondApproval.id
    );
  });

  it('creates an approval request when exporting a publishable non-target platform variant', async () => {
    const { context, operations, operationsService } = setup({
      contentPackageExporter: recordedPackageExporter(),
    });
    const stored = await seedWorkflowPackageWithVariants(
      operations,
      operationsService,
      context,
      {
        suffix: 'non-target',
        targetPlatform: 'xiaohongshu',
        workflowId: 'workflow-non-target-export',
        workflowRevision: 4,
      }
    );

    const exported = await operationsService.exportContentPackage(
      { ...context, actor: 'owner' },
      {
        expectedRevision: stored.revision,
        packageId: stored.id,
        platform: 'douyin',
      }
    );

    assert.deepEqual(
      exported.approvalRequests?.map((request) => ({
        platform: request.platform,
        status: request.status,
        variantVersionId: request.variantVersionId,
      })),
      [
        {
          platform: 'douyin',
          status: 'pending',
          variantVersionId: 'douyin-non-target-v1',
        },
      ]
    );
  });

  it('rejects an approval blocker when the same task still has a pending question', async () => {
    let exportEffects = 0;
    const creationExecutor = {
      async inspect() {},
      async submit() {
        return {
          platformVariants: {
            xiaohongshu: {
              body: '小红书正文',
              conversionHook: '私信预约',
              title: '小红书标题',
              topics: ['美业'],
            },
            douyin: {
              body: '抖音正文',
              conversionHook: '评论预约',
              title: '抖音标题',
              topics: ['美业'],
            },
            video_account: {
              body: '视频号正文',
              conversionHook: '转发预约',
              title: '视频号标题',
              topics: ['美业'],
            },
          },
          providerJobId: 'blocked-export-variant-job',
          routeSnapshotId: 'blocked-export-variant-route',
          status: 'completed' as const,
        };
      },
    } as unknown as CreationExecutorPort;
    const { context, operations, operationsService } = setup({
      creationExecutor,
      contentPackageExporter: {
        async export() {
          exportEffects += 1;
          throw new Error('export must not run while the task is blocked');
        },
      },
    });
    const contentPackage = await seedAcceptedPackage(
      operations,
      operationsService,
      context,
      'image_text',
      {
        targetPlatform: 'douyin',
        workflowId: 'workflow-already-question-blocked',
        workflowRevision: 7,
      }
    );
    const generated = await operationsService.generateContentPackageVariants(
      { ...context, actor: 'owner' },
      {
        contract: {
          aigcLabelEnabled: true,
          catalogModelId: 'llm-openai',
          catalogRevision: 'catalog-v1',
          currency: 'CNY',
          dataClass: [],
          estimatedAmount: 0.02,
          operation: 'copy.adapt',
          outputCount: 3,
          outputLabel: '三平台版本',
          quoteAcceptedAt: NOW,
          quoteRevision: 'quote-copy-adapt-v1',
          watermarkEnabled: false,
        },
        expectedRevision: contentPackage.revision,
        packageId: contentPackage.id,
        submissionKey: 'blocked-variant-submit',
      }
    );
    operations.seedPendingQuestion(
      context.workspaceId,
      'workflow-already-question-blocked'
    );

    await assert.rejects(
      operationsService.exportContentPackage(
        { ...context, actor: 'owner' },
        {
          expectedRevision: generated.revision,
          packageId: contentPackage.id,
          platform: 'douyin',
        }
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'TASK_BLOCKING_NODE_CONFLICT'
    );
    assert.equal(exportEffects, 0);
  });

  it('rejects stale platform variants when the current package version changes during provider execution', async () => {
    let releaseProvider!: () => void;
    let markProviderStarted!: () => void;
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve;
    });
    const providerReleased = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const creationExecutor = {
      async inspect() {},
      async submit() {
        markProviderStarted();
        await providerReleased;
        return {
          platformVariants: {
            xiaohongshu: {
              body: '过期的小红书正文',
              conversionHook: '收藏后私信预约',
              title: '过期的小红书标题',
              topics: ['同城美业'],
            },
            douyin: {
              body: '过期的抖音正文',
              conversionHook: '评论区留言预约',
              title: '过期的抖音标题',
              topics: ['同城探店'],
            },
            video_account: {
              body: '过期的视频号正文',
              conversionHook: '转发给有需要的朋友',
              title: '过期的视频号标题',
              topics: ['熟客推荐'],
            },
          },
          providerJobId: 'stale-variant-job',
          routeSnapshotId: 'stale-variant-route',
          status: 'completed' as const,
        };
      },
      async verify() {
        throw new Error('verify is not used by this command');
      },
    } as unknown as CreationExecutorPort;
    const { context, operations, operationsService } = setup({
      creationExecutor,
    });
    const contentPackage = await seedAcceptedPackage(
      operations,
      operationsService,
      context,
      'image_text'
    );
    assert.ok(contentPackage.currentVersionId);
    const operationContext = { ...context, actor: 'owner' as const };
    const generation = operationsService.generateContentPackageVariants(
      operationContext,
      {
        contract: {
          aigcLabelEnabled: true,
          catalogModelId: 'llm-openai',
          catalogRevision: 'catalog-v1',
          currency: 'CNY',
          dataClass: [],
          estimatedAmount: 0.02,
          operation: 'copy.adapt',
          outputCount: 3,
          outputLabel: '三平台版本',
          quoteAcceptedAt: NOW,
          quoteRevision: 'quote-copy-adapt-v1',
          watermarkEnabled: false,
        },
        expectedRevision: contentPackage.revision,
        packageId: contentPackage.id,
        submissionKey: 'stale-variant-submit',
      }
    );

    await providerStarted;
    const edited = await operationsService.editContentPackageVersion(
      operationContext,
      {
        baseVersionId: contentPackage.currentVersionId,
        changes: {
          body: '商户在生成期间保存的新正文',
          conversionHook: '立即预约',
          orderedAssetIds: ['owned-image_text-1'],
          title: '商户新标题',
          topics: ['美业'],
        },
        expectedRevision: contentPackage.revision,
        packageId: contentPackage.id,
      }
    );
    releaseProvider();

    await assert.rejects(
      generation,
      (error: unknown) =>
        error instanceof OperationsError &&
        error.code === 'CONTENT_PACKAGE_REVISION_CONFLICT'
    );
    const stored = await operationsService.getContentPackage(
      operationContext,
      contentPackage.id
    );
    assert.equal(stored.currentVersionId, edited.currentVersionId);
    assert.deepEqual(stored.variants, []);
  });

  it('adopts one copy candidate and ordered delivered images into one immediately visible package', async () => {
    const { context, operations, operationsService, service } = setup({
      contentPackageRightsResolver: {
        async resolve({ assetIds }) {
          return {
            unauthorizedAssetIds: assetIds.filter(
              (assetId) => assetId !== 'product-photo-1'
            ),
          };
        },
      },
    });
    const work = await operationsService.createCreativeWork(
      { ...context, actor: 'owner' },
      {
        intent: '生成一条图文成品',
        mode: 'agent',
        sessionId: 'session-adopt-package',
        sourceReferences: [{ id: 'product-photo-1', kind: 'asset' }],
      }
    );
    const visualWork = await operationsService.createCreativeWork(
      { ...context, actor: 'owner' },
      {
        intent: '生成配套图片',
        mode: 'agent',
        sessionId: work.sessionId,
        sourceReferences: [],
      }
    );
    const otherSessionWork = await operationsService.createCreativeWork(
      { ...context, actor: 'owner' },
      {
        intent: '其他会话图片',
        mode: 'agent',
        sessionId: 'session-other-package',
        sourceReferences: [],
      }
    );
    const state = await operations.loadWorkspace(context.workspaceId);
    assert.ok(state);
    const groundingAsset = (id: string) => ({
      authorizationStatus: 'authorized' as const,
      containsPerson: false,
      containsSensitiveData: false,
      consentScope: 'public_marketing' as const,
      id,
      minorStatus: 'none' as const,
      rightsEvidenceRecorded: true,
      sourceType: 'real' as const,
      tags: ['门店'],
    });
    const contract = {
      aigcLabelEnabled: true,
      catalogModelId: 'model-live',
      catalogRevision: 'catalog-v1',
      currency: 'CNY',
      dataClass: [],
      estimatedAmount: 1,
      operation: 'copy.generate' as const,
      outputCount: 3,
      outputLabel: '3 条内容候选',
      quoteAcceptedAt: NOW,
      quoteRevision: 'quote-v1',
      watermarkEnabled: true,
    };
    const copyJob = {
      contract,
      createdAt: NOW,
      id: 'copy-job-adopt',
      outputAssetIds: ['copy-a', 'copy-b', 'copy-c'],
      outputContentIds: [],
      status: 'completed' as const,
      submissionKey: 'copy-adopt',
      groundingSnapshot: {
        assets: [groundingAsset('copy-grounding')],
        capturedAt: NOW,
        store: {
          address: '88 号',
          booking: '提前预约',
          brandVoice: '真诚',
          city: '成都',
          confirmedAt: NOW,
          district: '锦江区',
          name: '春日美甲',
          prohibitions: [],
          projects: [],
          regulated: false,
        },
      },
      updatedAt: NOW,
      workId: work.id,
      workspaceId: context.workspaceId,
    };
    const imageContract = {
      ...contract,
      operation: 'image.generate' as const,
      outputCount: 1,
      outputLabel: '1 张图片',
    };
    state.creativeJobs.push(
      copyJob,
      {
        ...copyJob,
        contract: imageContract,
        id: 'image-job-1',
        groundingSnapshot: {
          ...copyJob.groundingSnapshot,
          assets: [groundingAsset('image-1-grounding')],
        },
        outputAssetIds: ['image-1'],
        submissionKey: 'image-1',
        workId: visualWork.id,
      },
      {
        ...copyJob,
        contract: imageContract,
        id: 'image-job-2',
        groundingSnapshot: {
          ...copyJob.groundingSnapshot,
          assets: [groundingAsset('image-2-grounding')],
        },
        outputAssetIds: ['image-2'],
        submissionKey: 'image-2',
        workId: visualWork.id,
      },
      {
        ...copyJob,
        contract: imageContract,
        id: 'image-job-other-session',
        groundingSnapshot: {
          ...copyJob.groundingSnapshot,
          assets: [groundingAsset('other-session-grounding')],
        },
        outputAssetIds: ['image-other-session'],
        submissionKey: 'image-other-session',
        workId: otherSessionWork.id,
      }
    );
    state.creativeAssets.push(
      ...['copy-a', 'copy-b', 'copy-c'].map((id, candidateIndex) => ({
        body: `正文 ${candidateIndex + 1}`,
        candidateIndex,
        conversionHook: '立即预约',
        createdAt: NOW,
        id,
        jobId: copyJob.id,
        kind: 'text' as const,
        title: `候选 ${candidateIndex + 1}`,
        workId: work.id,
        workspaceId: context.workspaceId,
      })),
      {
        contentType: 'image/png',
        createdAt: NOW,
        id: 'image-1',
        jobId: 'image-job-1',
        kind: 'image',
        objectKey: `${context.workspaceId}/generated/image-1.png`,
        ownedAssetId: 'owned-image-1',
        sha256: '1'.repeat(64),
        sizeBytes: 101,
        title: '图片 1',
        workId: visualWork.id,
        workspaceId: context.workspaceId,
      },
      {
        contentType: 'image/png',
        createdAt: NOW,
        id: 'image-2',
        jobId: 'image-job-2',
        kind: 'image',
        objectKey: `${context.workspaceId}/generated/image-2.png`,
        ownedAssetId: 'owned-image-2',
        sha256: '2'.repeat(64),
        sizeBytes: 102,
        title: '图片 2',
        workId: visualWork.id,
        workspaceId: context.workspaceId,
      },
      {
        contentType: 'image/png',
        createdAt: NOW,
        id: 'image-other-session',
        jobId: 'image-job-other-session',
        kind: 'image',
        ownedAssetId: 'owned-image-other-session',
        title: '其他会话图片',
        workId: otherSessionWork.id,
        workspaceId: context.workspaceId,
      }
    );
    const storedWork = state.creativeWorks.find((item) => item.id === work.id);
    assert.ok(storedWork);
    storedWork.currentJobId = copyJob.id;
    storedWork.status = 'completed';
    await operations.saveWorkspace(state);
    await assert.rejects(
      operationsService.adoptIntoContentPackage(
        { ...context, actor: 'owner' },
        {
          copyCandidateAssetId: 'copy-b',
          visualAssetIds: [],
          workId: work.id,
        }
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'VISUAL_ASSET_REQUIRED'
    );
    await assert.rejects(
      service.executeModule(
        context,
        'operations',
        {
          action: 'adopt_into_content_package',
          payload: {
            copyCandidateAssetId: 'copy-b',
            visualAssetIds: ['image-1', 'image-1'],
            workId: work.id,
          },
        },
        'adopt-package-duplicate-image'
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'DUPLICATE_VISUAL_ASSET'
    );
    await assert.rejects(
      service.executeModule(
        context,
        'operations',
        {
          action: 'adopt_into_content_package',
          payload: {
            copyCandidateAssetId: 'copy-b',
            visualAssetIds: ['image-not-delivered'],
            workId: work.id,
          },
        },
        'adopt-package-missing-image'
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'INVALID_VISUAL_ASSET'
    );
    await assert.rejects(
      service.executeModule(
        context,
        'operations',
        {
          action: 'adopt_into_content_package',
          payload: {
            copyCandidateAssetId: 'copy-b',
            visualAssetIds: ['image-other-session'],
            workId: work.id,
          },
        },
        'adopt-package-cross-session-image'
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'INVALID_VISUAL_ASSET'
    );

    const command = {
      action: 'adopt_into_content_package',
      payload: {
        copyCandidateAssetId: 'copy-b',
        visualAssetIds: ['product-photo-1', 'image-2', 'image-1'],
        workId: work.id,
      },
    };
    const resultDelivery = new ResultDeliveryFoundationModule(
      new OperationsVisualAdoptionPort(operationsService),
    );
    const adopted = (await resultDelivery.execute({
      context,
      idempotencyKey: 'adopt-package-1',
      input: command,
    })) as {
      currentVersionId: string;
      generated: {
        ownedAssets?: Array<{
          id: string;
          objectKey: string;
          sha256: string;
          sourceAssetId?: string;
        }>;
      };
      id: string;
      kind: 'image_text';
      revision: number;
      source: { assetIds: string[] };
      status: 'accepted';
      statusGroup: 'usable';
      versions: Array<{
        id: string;
        orderedAssetIds: string[];
        title: string;
      }>;
    };
    const restartedOperationsService = new OperationsApplicationService(
      operations,
      {
        canvasExporter: new RecordedCanvasExportAdapter(),
        contentPackageRightsResolver: {
          async resolve({ assetIds }) {
            return { unauthorizedAssetIds: assetIds };
          },
        },
        imageGenerator: new RecordedImageGenerationAdapter(),
        notifier: { async send() {} },
      },
    );
    const restartedResultDelivery = new ResultDeliveryFoundationModule(
      new OperationsVisualAdoptionPort(restartedOperationsService),
    );
    const replay = (await restartedResultDelivery.execute({
      context,
      idempotencyKey: 'adopt-package-1',
      input: command,
    })) as typeof adopted;
    await assert.rejects(
      restartedResultDelivery.execute({
        context,
        idempotencyKey: 'adopt-package-1',
        input: {
          ...command,
          payload: { ...command.payload, copyCandidateAssetId: 'copy-a' },
        },
      }),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'IDEMPOTENCY_CONFLICT',
    );
    const reviseCommand = {
      action: 'revise_content_package_visuals',
      payload: {
        baseVersionId: adopted.currentVersionId,
        expectedRevision: adopted.revision,
        orderedVisualAssetIds: ['image-1', 'image-2'],
        packageId: adopted.id,
        roleAction: 'replace_set' as const,
      },
    };
    const revised = (await restartedResultDelivery.execute({
      context: { ...context, correlationId: 'corr-revise-visuals' },
      idempotencyKey: 'revise-package-visuals-1',
      input: reviseCommand,
    })) as typeof adopted;
    const replayAfterRestart = (await new ResultDeliveryFoundationModule(
      new OperationsVisualAdoptionPort(
        new OperationsApplicationService(operations, {
          canvasExporter: new RecordedCanvasExportAdapter(),
          imageGenerator: new RecordedImageGenerationAdapter(),
          notifier: { async send() {} },
        }),
      ),
    ).execute({
      context: { ...context, correlationId: 'corr-revise-visuals-replay' },
      idempotencyKey: 'revise-package-visuals-1',
      input: reviseCommand,
    })) as typeof adopted;
    const concurrentBase = revised;
    const concurrent = await Promise.allSettled([
      restartedResultDelivery.execute({
        context: { ...context, correlationId: 'corr-revise-cover' },
        idempotencyKey: 'revise-package-cover',
        input: {
          action: 'revise_content_package_visuals',
          payload: {
            baseVersionId: concurrentBase.currentVersionId,
            expectedRevision: concurrentBase.revision,
            orderedVisualAssetIds: ['image-1'],
            packageId: adopted.id,
            roleAction: 'set_cover',
          },
        },
      }),
      restartedResultDelivery.execute({
        context: { ...context, correlationId: 'corr-revise-primary' },
        idempotencyKey: 'revise-package-primary',
        input: {
          action: 'revise_content_package_visuals',
          payload: {
            baseVersionId: concurrentBase.currentVersionId,
            expectedRevision: concurrentBase.revision,
            orderedVisualAssetIds: ['image-2'],
            packageId: adopted.id,
            roleAction: 'set_primary',
          },
        },
      }),
    ]);
    const library = await service.queryModule<
      { action: string; payload: Record<string, never> },
      Array<typeof adopted>
    >(context, 'operations', {
      action: 'content_packages',
      payload: {},
    });
    const persisted = await operations.loadWorkspace(context.workspaceId);

    assert.equal(adopted.kind, 'image_text');
    assert.equal(adopted.status, 'accepted');
    assert.equal(adopted.statusGroup, 'usable');
    assert.deepEqual(adopted.source.assetIds, [
      'copy-b',
      'product-photo-1',
      'image-2',
      'image-1',
      'copy-grounding',
      'image-2-grounding',
      'image-1-grounding',
    ]);
    assert.deepEqual((adopted as { compliance?: unknown }).compliance, {
      aigcLabelEnabled: true,
      watermarkEnabled: true,
      watermarkText: '春日美甲',
    });
    assert.equal(adopted.versions[0]?.title, '候选 2');
    assert.deepEqual(adopted.versions[0]?.orderedAssetIds, [
      'product-photo-1',
      'image-2',
      'image-1',
    ]);
    assert.equal(adopted.currentVersionId, adopted.versions[0]?.id);
    assert.equal(replay.id, adopted.id);
    assert.equal(replay.revision, adopted.revision);
    assert.equal(revised.revision, adopted.revision + 1);
    assert.equal(replayAfterRestart.revision, revised.revision);
    const revisedVersion = revised.versions.at(-1);
    assert.equal(revisedVersion?.orderedAssetIds.length, 2);
    assert.deepEqual(
      revisedVersion?.orderedAssetIds.map(
        (assetId) =>
          revised.generated.ownedAssets?.find((asset) => asset.id === assetId)
            ?.sourceAssetId,
      ),
      ['image-1', 'image-2'],
    );
    assert.deepEqual(
      revisedVersion?.orderedAssetIds.map(
        (assetId) =>
          revised.generated.ownedAssets?.find((asset) => asset.id === assetId)
            ?.objectKey,
      ),
      [
        `${context.workspaceId}/generated/image-1.png`,
        `${context.workspaceId}/generated/image-2.png`,
      ],
    );
    assert.equal(
      concurrent.filter((outcome) => outcome.status === 'fulfilled').length,
      1,
    );
    const staleRevision = concurrent.find(
      (outcome) => outcome.status === 'rejected',
    );
    assert.ok(staleRevision && staleRevision.status === 'rejected');
    assert.equal(
      (staleRevision.reason as { code?: string }).code,
      'CONTENT_PACKAGE_REVISION_CONFLICT',
    );
    assert.equal((staleRevision.reason as { status?: number }).status, 409);
    assert.deepEqual(
      library.map((item) => item.id),
      [adopted.id]
    );
    assert.equal(persisted?.creativeContents.length, 0);
    assert.deepEqual(
      persisted?.creativeJobs.find((item) => item.id === copyJob.id)
        ?.outputContentIds,
      []
    );
    assert.equal(
      persisted?.creativeWorks.find((item) => item.id === work.id)?.status,
      'accepted'
    );
    await assert.rejects(
      service.executeModule(
        context,
        'operations',
        {
          ...command,
          payload: { ...command.payload, copyCandidateAssetId: 'copy-a' },
        },
        'adopt-package-second-candidate'
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'COPY_CANDIDATE_ALREADY_ACCEPTED'
    );
    const revoked = await operationsService.revokeContentPackagesUsingAsset(
      { ...context, actor: 'owner' },
      'image-2-grounding'
    );
    const revokedPackage = await operationsService.getContentPackage(
      { ...context, actor: 'owner' },
      adopted.id
    );
    assert.deepEqual(revoked.revokedPackageIds, [adopted.id]);
    assert.equal(revokedPackage.status, 'needs_replacement');
    assert.equal(
      revokedPackage.rights.reason,
      'asset_withdrawn:image-2-grounding'
    );
  });

  it('attaches a completed same-session media generation to the existing package and current version', async () => {
    const { context, operations, operationsService, service } = setup();
    const sourceWork = await operationsService.createCreativeWork(
      { ...context, actor: 'owner' },
      {
        intent: '创建图文成品',
        mode: 'agent',
        sessionId: 'session-attach-generation',
        sourceReferences: [],
      },
    );
    const mediaWork = await operationsService.createCreativeWork(
      { ...context, actor: 'owner' },
      {
        intent: '生成配套图片',
        mode: 'agent',
        sessionId: sourceWork.sessionId,
        sourceReferences: [],
      },
    );
    const contentPackage = await seedAcceptedPackage(
      operations,
      operationsService,
      context,
      'image_text',
    );
    const state = await operations.loadWorkspace(context.workspaceId);
    assert.ok(state);
    const storedPackage = state.contentPackages.find(
      (candidate) => candidate.id === contentPackage.id,
    );
    assert.ok(storedPackage);
    storedPackage.source.workId = sourceWork.id;
    const baseVersion = storedPackage.versions.find(
      (version) => version.id === storedPackage.currentVersionId,
    );
    assert.ok(baseVersion);
    storedPackage.variants = (
      ['xiaohongshu', 'douyin', 'video_account'] as const
    ).map((platform) => {
      const variantVersionId = `${storedPackage.id}-${platform}-v1`;
      return {
        currentVersionId: variantVersionId,
        id: `${storedPackage.id}-${platform}`,
        platform,
        versions: [
          {
            ...structuredClone(baseVersion),
            id: variantVersionId,
          },
        ],
      };
    });
    state.creativeJobs.push({
      contract: {
        aigcLabelEnabled: true,
        catalogModelId: 'image-model-live',
        catalogRevision: 'catalog-v1',
        currency: 'CNY',
        dataClass: [],
        estimatedAmount: 0.05,
        operation: 'image.generate',
        outputCount: 1,
        outputLabel: '1 张图片',
        quoteAcceptedAt: NOW,
        quoteRevision: 'quote-v1',
        watermarkEnabled: false,
      },
      createdAt: NOW,
      id: 'image-job-attach',
      outputAssetIds: ['image-attach-1'],
      outputContentIds: [],
      status: 'completed',
      submissionKey: 'image-attach-submit',
      updatedAt: NOW,
      workId: mediaWork.id,
      workspaceId: context.workspaceId,
    });
    state.creativeAssets.push({
      contentType: 'image/png',
      createdAt: NOW,
      id: 'image-attach-1',
      jobId: 'image-job-attach',
      kind: 'image',
      objectKey: `${context.workspaceId}/generated/${'b'.repeat(64)}.png`,
      ownedAssetId: 'owned-image-attach-1',
      sha256: 'a'.repeat(64),
      sizeBytes: 2048,
      title: '配套图片',
      workId: mediaWork.id,
      workspaceId: context.workspaceId,
    });
    await operations.saveWorkspace(state);

    const command = {
      action: 'attach_content_package_generation',
      payload: {
        assetIds: ['image-attach-1'],
        childRun: {
          assetIds: ['image-attach-1'],
          runId: 'image-job-attach',
          runType: 'creative_job' as const,
          status: 'succeeded' as const,
        },
        expectedRevision: storedPackage.revision,
        packageId: contentPackage.id,
      },
    };
    await assert.rejects(
      service.executeModule(
        context,
        'operations',
        {
          ...command,
          payload: {
            ...command.payload,
            childRun: {
              ...command.payload.childRun,
              runType: 'durable_video_workflow' as const,
            },
          },
        },
        'attach-generation-wrong-run-type',
      ),
      (error: unknown) =>
        error instanceof OperationsError &&
        error.code === 'INVALID_CONTENT_PACKAGE',
    );
    await assert.rejects(
      service.executeModule(
        context,
        'operations',
        {
          ...command,
          payload: {
            ...command.payload,
            childRun: {
              ...command.payload.childRun,
              providerCost: {
                amount: 999,
                currency: 'USD' as const,
                status: 'observed' as const,
              },
            },
          },
        },
        'attach-generation-forged-cost',
      ),
      (error: unknown) =>
        error instanceof OperationsError &&
        error.code === 'INVALID_CONTENT_PACKAGE',
    );
    storedPackage.status = 'cancelled';
    await operations.saveWorkspace(state);
    await assert.rejects(
      service.executeModule(
        context,
        'operations',
        command,
        'attach-generation-cancelled-package',
      ),
      (error: unknown) =>
        error instanceof OperationsError &&
        error.code === 'CONTENT_PACKAGE_GENERATION_NOT_ATTACHABLE',
    );
    storedPackage.status = 'accepted';
    await operations.saveWorkspace(state);
    const storedImageAsset = state.creativeAssets.find(
      (asset) => asset.id === 'image-attach-1',
    );
    assert.ok(storedImageAsset);
    storedImageAsset.objectKey = `${context.workspaceId}/creative/image-attach-1.png`;
    await operations.saveWorkspace(state);
    await assert.rejects(
      service.executeModule(
        context,
        'operations',
        command,
        'attach-generation-unexportable-receipt',
      ),
      (error: unknown) =>
        error instanceof OperationsError &&
        error.code === 'INVALID_CONTENT_PACKAGE_GENERATION_ASSET',
    );
    storedImageAsset.objectKey = `${context.workspaceId}/generated/${'b'.repeat(64)}.png`;
    await operations.saveWorkspace(state);
    const storedMediaWork = state.creativeWorks.find(
      (work) => work.id === mediaWork.id,
    );
    assert.ok(storedMediaWork);
    storedMediaWork.sessionId = 'session-other';
    await operations.saveWorkspace(state);
    await assert.rejects(
      service.executeModule(
        context,
        'operations',
        command,
        'attach-generation-cross-session',
      ),
      (error: unknown) =>
        error instanceof OperationsError &&
        error.code === 'INVALID_CONTENT_PACKAGE_GENERATION_ASSET',
    );
    storedMediaWork.sessionId = sourceWork.sessionId;
    const storedImageJob = state.creativeJobs.find(
      (job) => job.id === 'image-job-attach',
    );
    assert.ok(storedImageJob);
    storedImageJob.status = 'failed';
    await operations.saveWorkspace(state);
    await assert.rejects(
      service.executeModule(
        context,
        'operations',
        command,
        'attach-generation-failed-job',
      ),
      (error: unknown) =>
        error instanceof OperationsError &&
        error.code === 'CONTENT_PACKAGE_CHILD_RUN_NOT_DELIVERED',
    );
    storedImageJob.status = 'completed';
    await operations.saveWorkspace(state);
    const attached = await service.executeModule<
      typeof command,
      {
        currentVersionId: string;
        generated: {
          assetIds: string[];
          childRuns: Array<{
            assetIds?: string[];
            providerCost?: unknown;
            runId: string;
          }>;
          ownedAssets?: Array<{ id: string; sizeBytes?: number }>;
        };
        id: string;
        revision: number;
        variants: Array<{
          currentVersionId: string;
          versions: Array<{ id: string; orderedAssetIds: string[] }>;
        }>;
        versions: Array<{ id: string; orderedAssetIds: string[] }>;
      }
    >(context, 'operations', command, 'attach-generation-1');
    const replay = await service.executeModule<typeof command, typeof attached>(
      context,
      'operations',
      command,
      'attach-generation-1',
    );
    const crossKeyReplay = await service.executeModule<
      typeof command,
      typeof attached
    >(
      context,
      'operations',
      {
        ...command,
        payload: { ...command.payload, expectedRevision: attached.revision },
      },
      'attach-generation-cross-key-replay'
    );
    const persisted = await operations.loadWorkspace(context.workspaceId);
    const persistedPackage = persisted?.contentPackages.find(
      (candidate) => candidate.id === contentPackage.id,
    );
    const currentVersion = attached.versions.find(
      (version) => version.id === attached.currentVersionId,
    );

    assert.equal(attached.id, contentPackage.id);
    assert.equal(replay.currentVersionId, attached.currentVersionId);
    assert.equal(crossKeyReplay.versions.length, attached.versions.length);
    assert.deepEqual(attached.generated.assetIds, ['image-attach-1']);
    assert.deepEqual(currentVersion?.orderedAssetIds, [
      'owned-image_text-1',
      'image-attach-1',
    ]);
    assert.deepEqual(attached.generated.ownedAssets, [
      {
        contentType: 'image/png',
        id: 'image-attach-1',
        objectKey: `${context.workspaceId}/generated/${'b'.repeat(64)}.png`,
        sha256: 'a'.repeat(64),
        sizeBytes: 2048,
      },
    ]);
    assert.equal(attached.generated.childRuns[0]?.providerCost, undefined);
    assert.deepEqual(
      attached.variants.map(
        (variant) =>
          variant.versions.find(
            (version) => version.id === variant.currentVersionId,
          )?.orderedAssetIds,
      ),
      [
        ['owned-image_text-1', 'image-attach-1'],
        ['owned-image_text-1', 'image-attach-1'],
        ['owned-image_text-1', 'image-attach-1'],
      ],
    );
    assert.equal(
      persistedPackage?.generated.childRuns[0]?.providerCost,
      undefined,
    );
  });

  it('creates one package and immediately returns the same object from detail and library queries', async () => {
    const { context, service } = setup();
    const command = {
      action: 'create_content_package',
      payload: {
        kind: 'image_text',
        source: {
          assetIds: [
            'copy-asset-1',
            'image-asset-1',
            'image-asset-2',
            'image-asset-3',
          ],
          briefId: 'brief-1',
          groundingId: 'grounding-1',
          storeProfileId: 'store-profile-1',
        },
      },
    };

    const created = await service.executeModule<
      typeof command,
      {
        id: string;
        kind: 'image_text';
        status: 'draft';
        statusGroup: 'creating';
        statusLabel: '创作中';
      }
    >(context, 'operations', command, 'create-content-package-1');

    const detail = await service.queryModule<
      { action: string; payload: { packageId: string } },
      typeof created
    >(context, 'operations', {
      action: 'content_package',
      payload: { packageId: created.id },
    });
    const library = await service.queryModule<
      { action: string; payload: Record<string, never> },
      Array<typeof created>
    >(context, 'operations', {
      action: 'content_packages',
      payload: {},
    });

    assert.equal(created.kind, 'image_text');
    assert.equal(created.status, 'draft');
    assert.equal(created.statusGroup, 'creating');
    assert.equal(created.statusLabel, '创作中');
    assert.deepEqual(detail, created);
    assert.deepEqual(library, [created]);
  });

  it('replays the same create command without duplicating the package and rejects a changed payload', async () => {
    const { context, service } = setup();
    const command = {
      action: 'create_content_package',
      payload: {
        kind: 'image_text',
        source: { assetIds: ['asset-1'], briefId: 'brief-1' },
      },
    };

    const created = await service.executeModule<typeof command, { id: string }>(
      context,
      'operations',
      command,
      'create-content-package-replay'
    );
    const replay = await service.executeModule<typeof command, { id: string }>(
      context,
      'operations',
      command,
      'create-content-package-replay'
    );

    assert.equal(replay.id, created.id);
    assert.equal(
      (
        await service.queryModule<
          { action: string; payload: Record<string, never> },
          Array<{ id: string }>
        >(context, 'operations', {
          action: 'content_packages',
          payload: {},
        })
      ).length,
      1
    );
    await assert.rejects(
      service.executeModule(
        context,
        'operations',
        {
          ...command,
          payload: { ...command.payload, kind: 'video' },
        },
        'create-content-package-replay'
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'IDEMPOTENCY_CONFLICT'
    );
  });

  it('does not expose a package to another workspace', async () => {
    const { context, otherContext, service } = setup();
    const created = await service.executeModule<
      {
        action: string;
        payload: {
          kind: 'image_text';
          source: { assetIds: string[]; briefId: string };
        };
      },
      { id: string; revision: number }
    >(
      context,
      'operations',
      {
        action: 'create_content_package',
        payload: {
          kind: 'image_text',
          source: { assetIds: ['asset-1'], briefId: 'brief-1' },
        },
      },
      'create-content-package-isolation'
    );

    assert.deepEqual(
      await service.queryModule(otherContext, 'operations', {
        action: 'content_packages',
        payload: {},
      }),
      []
    );
    await assert.rejects(
      service.queryModule(otherContext, 'operations', {
        action: 'content_package',
        payload: { packageId: created.id },
      }),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'CONTENT_PACKAGE_NOT_FOUND'
    );
  });

  it('cancels a package once and rejects resubmission from the cancelled state', async () => {
    const { context, service } = setup();
    const created = await service.executeModule<
      {
        action: string;
        payload: {
          kind: 'image_text';
          source: { assetIds: string[]; briefId: string };
        };
      },
      { id: string; revision: number }
    >(
      context,
      'operations',
      {
        action: 'create_content_package',
        payload: {
          kind: 'image_text',
          source: { assetIds: ['asset-1'], briefId: 'brief-1' },
        },
      },
      'create-content-package-cancel'
    );

    const cancelled = await service.executeModule<
      {
        action: string;
        payload: { expectedRevision: number; packageId: string };
      },
      {
        id: string;
        revision: number;
        status: string;
        statusGroup: string;
        statusLabel: string;
      }
    >(
      context,
      'operations',
      {
        action: 'cancel_content_package',
        payload: { expectedRevision: created.revision, packageId: created.id },
      },
      'cancel-content-package-1'
    );

    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.statusGroup, 'needs_attention');
    assert.equal(cancelled.statusLabel, '需处理');
    await assert.rejects(
      service.executeModule(
        context,
        'operations',
        {
          action: 'cancel_content_package',
          payload: {
            expectedRevision: cancelled.revision,
            packageId: created.id,
          },
        },
        'cancel-content-package-2'
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'CONTENT_PACKAGE_TRANSITION_CONFLICT'
    );
    assert.equal(
      (
        await service.queryModule<
          { action: string; payload: Record<string, never> },
          Array<{ id: string }>
        >(context, 'operations', {
          action: 'content_packages',
          payload: {},
        })
      ).length,
      1
    );
  });

  it('revokes package rights and immediately projects the package as needing attention', async () => {
    const { context, service } = setup();
    const created = await service.executeModule<
      {
        action: string;
        payload: {
          kind: 'image_text';
          source: { assetIds: string[]; briefId: string };
        };
      },
      { id: string; revision: number }
    >(
      context,
      'operations',
      {
        action: 'create_content_package',
        payload: {
          kind: 'image_text',
          source: { assetIds: ['asset-1'], briefId: 'brief-1' },
        },
      },
      'create-content-package-revoke'
    );

    const revoked = await service.executeModule<
      {
        action: string;
        payload: {
          expectedRevision: number;
          packageId: string;
          reason: string;
        };
      },
      {
        rights: { reason: string; revokedAt: string; state: string };
        status: string;
        statusGroup: string;
        statusLabel: string;
      }
    >(
      context,
      'operations',
      {
        action: 'revoke_content_package_rights',
        payload: {
          expectedRevision: created.revision,
          packageId: created.id,
          reason: 'source_asset_authorization_revoked',
        },
      },
      'revoke-content-package-1'
    );

    assert.equal(revoked.status, 'needs_replacement');
    assert.equal(revoked.statusGroup, 'needs_attention');
    assert.equal(revoked.statusLabel, '需处理');
    assert.equal(revoked.rights.state, 'revoked');
    assert.equal(revoked.rights.reason, 'source_asset_authorization_revoked');
    assert.ok(Number.isFinite(Date.parse(revoked.rights.revokedAt)));
  });
});

describe('ContentPackage frozen status contract', () => {
  it('covers every status with one shared device-neutral action mapping', () => {
    assert.deepEqual(
      Object.keys(CONTENT_PACKAGE_ACTIONS_BY_STATUS).sort(),
      contentPackageStatusSchema.options.sort()
    );
    assert.equal(
      Object.values(CONTENT_PACKAGE_ACTIONS_BY_STATUS).every((actions) =>
        actions.includes('view')
      ),
      true
    );
    const declaredActions = JSON.stringify(CONTENT_PACKAGE_ACTIONS_BY_STATUS);
    for (const unavailableAction of [
      'complete_input',
      'query_status',
      'replace_assets',
      'replay_save',
      'retry_failed_runs',
    ]) {
      assert.equal(declaredActions.includes(unavailableAction), false);
    }
    assert.deepEqual(CONTENT_PACKAGE_ACTIONS_BY_STATUS.needs_replacement, [
      'view',
      'edit_text',
      'recreate',
      'cancel',
    ]);
  });
  it('maps every one of the 12 internal statuses to exactly one user-visible group', () => {
    assert.equal(CONTENT_PACKAGE_STATUS_CONTRACTS.length, 10);
    for (const status of contentPackageStatusSchema.options) {
      assert.ok(
        ['creating', 'usable', 'needs_attention'].includes(
          contentPackageStatusGroup(status)
        )
      );
      assert.ok(
        ['创作中', '可使用', '需处理'].includes(
          contentPackageStatusLabel(status)
        )
      );
    }
    assert.equal(contentPackageStatusGroup('review_ready'), 'usable');
    assert.equal(contentPackageStatusGroup('export_failed'), 'needs_attention');
  });

  it('keeps an input-less package in needs_input and blocks paid generation', () => {
    const contentPackage = buildContentPackage({
      id: 'package-needs-input',
      kind: 'image_text',
      source: { assetIds: [] },
      timestamp: NOW,
      workspaceId: 'workspace-state-contract',
    });

    assert.equal(contentPackage.status, 'needs_input');
    assert.throws(
      () =>
        transitionContentPackage(
          contentPackage,
          { type: 'generation_started' },
          NOW
        ),
      ContentPackageTransitionError
    );
  });

  it('accepts an advanced canvas as version-level source without falling into needs_input', () => {
    const sourceRef = {
      advancedCanvas: {
        orderedMediaNodeIds: ['node-image-b', 'node-image-a', 'node-image-b'],
        projectId: 'advanced-project-a',
        revisionId: 'advanced-revision-a',
        schemaVersion: 1,
        selectedNodeIds: ['node-text-a', 'node-image-b', 'node-image-a'],
      },
    };
    const contentPackage = buildContentPackage({
      id: 'package-advanced-canvas',
      kind: 'image_text',
      source: { assetIds: [] },
      sourceRef,
      timestamp: NOW,
      workspaceId: 'workspace-state-contract',
    });
    const version = contentPackageVersionSchema.parse({
      body: '画布采用正文',
      createdAt: NOW,
      id: 'package-advanced-canvas-v1',
      orderedAssetIds: ['asset-image-b', 'asset-image-a'],
      sourceRef,
      title: '画布采用标题',
      topics: [],
    });

    assert.equal(contentPackage.status, 'draft');
    assert.deepEqual(version.sourceRef, sourceRef);
    assert.deepEqual(version.sourceRef?.advancedCanvas.orderedMediaNodeIds, [
      'node-image-b',
      'node-image-a',
      'node-image-b',
    ]);
    assert.equal(contentPackageVersionSourceRefIsReadOnly(sourceRef), false);
  });

  it('loads an unknown future advanced-canvas source schema for read-only display', () => {
    const parsed = contentPackageVersionSchema.parse({
      body: '未知版本正文',
      createdAt: NOW,
      id: 'package-future-source-v1',
      orderedAssetIds: ['asset-a'],
      sourceRef: {
        advancedCanvas: {
          futureDisplayHint: '保留供只读展示',
          orderedMediaNodeIds: ['node-a'],
          projectId: 'advanced-project-future',
          revisionId: 'advanced-revision-future',
          schemaVersion: 2,
          selectedNodeIds: ['node-a'],
        },
      },
      title: '未知版本标题',
      topics: [],
    });

    assert.equal(parsed.sourceRef?.advancedCanvas.schemaVersion, 2);
    assert.equal(
      parsed.sourceRef?.advancedCanvas.futureDisplayHint,
      '保留供只读展示'
    );
    assert.equal(
      contentPackageVersionSourceRefIsReadOnly(parsed.sourceRef!),
      true
    );
  });

  it('returns generating and verifying packages to needs_input after a terminal input failure', () => {
    const draft = buildContentPackage({
      id: 'package-input-failure',
      kind: 'video',
      source: { assetIds: ['asset-1'], workflowId: 'workflow-input-failure' },
      timestamp: NOW,
      workspaceId: 'workspace-state-contract',
    });
    const generating = transitionContentPackage(
      draft,
      { type: 'generation_started' },
      NOW
    );
    const verifying = transitionContentPackage(
      generating,
      {
        originalIdempotencyKey: 'workflow-input-failure',
        recovery: 'query_only',
        type: 'submission_outcome_unknown',
      },
      NOW
    );

    assert.equal(
      transitionContentPackage(generating, { type: 'input_missing' }, NOW)
        .status,
      'needs_input'
    );
    assert.equal(
      transitionContentPackage(verifying, { type: 'input_missing' }, NOW)
        .status,
      'needs_input'
    );
  });

  it('moves an unknown submission to verifying only through original-key query recovery', () => {
    const draft = buildContentPackage({
      id: 'package-verifying',
      kind: 'image_text',
      source: { assetIds: ['asset-1'], briefId: 'brief-1' },
      timestamp: NOW,
      workspaceId: 'workspace-state-contract',
    });
    const generating = transitionContentPackage(
      draft,
      { type: 'generation_started' },
      NOW
    );
    const verifying = transitionContentPackage(
      generating,
      {
        originalIdempotencyKey: 'generation-key-1',
        recovery: 'query_only',
        type: 'submission_outcome_unknown',
      },
      NOW
    );

    assert.equal(verifying.status, 'verifying');
    assert.deepEqual(verifying.versions, []);
    assert.throws(
      () =>
        transitionContentPackage(
          generating,
          {
            originalIdempotencyKey: '',
            recovery: 'query_only',
            type: 'submission_outcome_unknown',
          },
          NOW
        ),
      ContentPackageTransitionError
    );
  });

  it('preserves successful child runs and retries exactly the failed child runs', () => {
    const generating = contentPackageSchema.parse({
      ...buildContentPackage({
        id: 'package-partial',
        kind: 'image_text',
        source: { assetIds: ['source-asset-1'], briefId: 'brief-1' },
        timestamp: NOW,
        workspaceId: 'workspace-state-contract',
      }),
      generated: {
        assetIds: ['owned-success-asset'],
        childRuns: [
          { runId: 'run-success', runType: 'creative_job', status: 'running' },
          {
            runId: 'run-failed',
            runType: 'canvas_image_job',
            status: 'running',
          },
        ],
      },
      status: 'generating',
    });
    const partial = transitionContentPackage(
      generating,
      {
        failedRunIds: ['run-failed'],
        succeededRunIds: ['run-success'],
        type: 'child_runs_partially_completed',
      },
      NOW
    );
    const retried = transitionContentPackage(
      partial,
      { runIds: ['run-failed'], type: 'retry_failed_child_runs' },
      NOW
    );

    assert.equal(partial.status, 'partial');
    assert.deepEqual(partial.generated.assetIds, ['owned-success-asset']);
    assert.deepEqual(
      partial.generated.childRuns.map((run) => [run.runId, run.status]),
      [
        ['run-success', 'succeeded'],
        ['run-failed', 'failed'],
      ]
    );
    assert.deepEqual(
      retried.generated.childRuns.map((run) => [run.runId, run.status]),
      [
        ['run-success', 'succeeded'],
        ['run-failed', 'pending'],
      ]
    );
    assert.throws(
      () =>
        transitionContentPackage(
          partial,
          { runIds: ['run-success'], type: 'retry_failed_child_runs' },
          NOW
        ),
      ContentPackageTransitionError
    );
  });

  it('stops showing running when the provider completes', () => {
    const generating = contentPackageSchema.parse({
      ...buildContentPackage({
        id: 'package-review-ready',
        kind: 'video',
        source: { assetIds: ['source-video-1'] },
        timestamp: NOW,
        workspaceId: 'workspace-state-contract',
      }),
      status: 'generating',
    });
    const ready = transitionContentPackage(
      generating,
      { type: 'provider_completed' },
      NOW
    );

    assert.equal(ready.status, 'review_ready');
    assert.equal(contentPackageStatusLabel(ready.status), '可使用');
  });

  it('adopts one version and replays an unknown save without duplicating it', () => {
    const ready = contentPackageSchema.parse({
      ...buildContentPackage({
        id: 'package-adopted',
        kind: 'image_text',
        source: { assetIds: ['asset-1'], briefId: 'brief-1' },
        timestamp: NOW,
        workspaceId: 'workspace-state-contract',
      }),
      status: 'review_ready',
    });
    const version = {
      body: '正文',
      createdAt: NOW,
      id: 'version-1',
      orderedAssetIds: ['asset-1'],
      title: '标题',
      topics: [],
    };
    const accepted = transitionContentPackage(
      ready,
      { type: 'adopted', version },
      NOW
    );
    const unknown = transitionContentPackage(
      accepted,
      { type: 'save_outcome_unknown' },
      NOW
    );
    const replayed = transitionContentPackage(
      unknown,
      {
        originalIdempotencyKey: 'save-key-1',
        type: 'save_replayed',
        versionId: version.id,
      },
      NOW
    );

    assert.equal(accepted.status, 'accepted');
    assert.equal(accepted.currentVersionId, version.id);
    assert.equal(replayed.status, 'accepted');
    assert.deepEqual(replayed.versions, [version]);
  });

  it('preserves the accepted product when one platform export fails', () => {
    const accepted = contentPackageSchema.parse({
      ...buildContentPackage({
        id: 'package-export-failed',
        kind: 'image_text',
        source: { assetIds: ['asset-1'], briefId: 'brief-1' },
        timestamp: NOW,
        workspaceId: 'workspace-state-contract',
      }),
      currentVersionId: 'version-1',
      exportReceipts: [
        {
          artifactAssetId: 'owned-export-1',
          createdAt: NOW,
          id: 'receipt-success',
          platform: 'xiaohongshu',
          status: 'succeeded',
          variantVersionId: 'version-1',
        },
      ],
      status: 'accepted',
      versions: [
        {
          body: '正文',
          createdAt: NOW,
          id: 'version-1',
          orderedAssetIds: ['asset-1'],
          title: '标题',
          topics: [],
        },
      ],
    });
    const failed = transitionContentPackage(
      accepted,
      {
        receipt: {
          createdAt: NOW,
          failureCategory: 'archive_unavailable',
          id: 'receipt-failed',
          platform: 'douyin',
          status: 'failed',
          variantVersionId: 'version-1',
        },
        type: 'export_failed',
      },
      NOW
    );

    assert.equal(failed.status, 'export_failed');
    assert.deepEqual(failed.versions, accepted.versions);
    assert.deepEqual(failed.generated, accepted.generated);
    assert.deepEqual(
      failed.exportReceipts.map((receipt) => receipt.id),
      ['receipt-success', 'receipt-failed']
    );
  });

  it('accepts ZIP (primary) and legacy MP4 receipts for video while keeping image-text ZIP-only', () => {
    const version = {
      body: '历史视频正文',
      createdAt: NOW,
      id: 'version-historical-video',
      orderedAssetIds: ['owned-historical-video'],
      title: '历史视频标题',
      topics: [],
    };
    const historical = contentPackageSchema.parse({
      ...buildContentPackage({
        id: 'package-historical-video-export',
        kind: 'video',
        source: { assetIds: ['source-video-1'] },
        timestamp: NOW,
        workspaceId: 'workspace-state-contract',
      }),
      currentVersionId: version.id,
      exportReceipts: [
        {
          artifactAssetId: 'owned-historical-video',
          artifactObjectKey: 'workspace-state-contract/composed/video.mp4',
          contentType: 'video/mp4',
          createdAt: NOW,
          id: 'receipt-historical-video',
          platform: 'douyin',
          sha256: 'a'.repeat(64),
          sizeBytes: 1_024,
          status: 'succeeded',
          variantVersionId: version.id,
        },
      ],
      status: 'accepted',
      versions: [version],
    });

    const revoked = transitionContentPackage(
      historical,
      { at: NOW, reason: 'merchant_withdrawn', type: 'rights_revoked' },
      NOW
    );

    assert.equal(revoked.status, 'needs_replacement');
    assert.equal(revoked.exportReceipts[0]?.contentType, 'video/mp4');
    const exportedMp4 = transitionContentPackage(
      { ...historical, exportReceipts: [] },
      {
        receipt: {
          artifactAssetId: 'owned-new-video',
          artifactObjectKey: 'workspace-state-contract/composed/new.mp4',
          contentType: 'video/mp4',
          createdAt: NOW,
          id: 'receipt-new-video',
          platform: 'douyin',
          sha256: 'b'.repeat(64),
          sizeBytes: 2_048,
          status: 'succeeded',
          variantVersionId: version.id,
        },
        type: 'export_succeeded',
      },
      NOW
    );
    assert.equal(exportedMp4.exportReceipts[0]?.contentType, 'video/mp4');

    const exportedZip = transitionContentPackage(
      { ...historical, exportReceipts: [] },
      {
        receipt: {
          artifactAssetId: 'owned-new-video-zip',
          artifactObjectKey: 'workspace-state-contract/generated/video-full.zip',
          contentType: 'application/zip',
          createdAt: NOW,
          id: 'receipt-new-video-zip',
          platform: 'douyin',
          sha256: 'd'.repeat(64),
          sizeBytes: 4_096,
          status: 'succeeded',
          variantVersionId: version.id,
        },
        type: 'export_succeeded',
      },
      NOW
    );
    assert.equal(exportedZip.exportReceipts[0]?.contentType, 'application/zip');

    const imageText = buildContentPackage({
      id: 'package-image-text-export',
      kind: 'image_text',
      source: { assetIds: ['source-image-1'] },
      timestamp: NOW,
      workspaceId: 'workspace-state-contract',
    });
    assert.throws(
      () =>
        transitionContentPackage(
          { ...imageText, status: 'accepted' },
          {
            receipt: {
              artifactAssetId: 'owned-invalid-image-export',
              artifactObjectKey:
                'workspace-state-contract/generated/invalid.mp4',
              contentType: 'video/mp4',
              createdAt: NOW,
              id: 'receipt-invalid-image-export',
              platform: 'douyin',
              sha256: 'c'.repeat(64),
              sizeBytes: 1_024,
              status: 'succeeded',
              variantVersionId: 'version-image-text',
            },
            type: 'export_succeeded',
          },
          NOW
        ),
      /ZIP receipt/u
    );
  });

  it('keeps the package state unchanged when a provider URL expires and an owned archive exists', () => {
    const accepted = contentPackageSchema.parse({
      ...buildContentPackage({
        id: 'package-archive',
        kind: 'video',
        source: { assetIds: ['source-video-1'] },
        timestamp: NOW,
        workspaceId: 'workspace-state-contract',
      }),
      generated: { assetIds: ['owned-video-1'], childRuns: [] },
      status: 'accepted',
    });
    const recovered = transitionContentPackage(
      accepted,
      { ownedAssetId: 'owned-video-1', type: 'provider_url_expired' },
      NOW
    );

    assert.equal(recovered.status, 'accepted');
    assert.deepEqual(recovered.generated, accepted.generated);
    assert.throws(
      () =>
        transitionContentPackage(
          accepted,
          {
            ownedAssetId: 'provider-temporary-url',
            type: 'provider_url_expired',
          },
          NOW
        ),
      ContentPackageTransitionError
    );
  });

  it('blocks new export intent as soon as package rights are revoked', () => {
    const accepted = contentPackageSchema.parse({
      ...buildContentPackage({
        id: 'package-rights-guard',
        kind: 'image_text',
        source: { assetIds: ['asset-1'], briefId: 'brief-1' },
        timestamp: NOW,
        workspaceId: 'workspace-state-contract',
      }),
      status: 'accepted',
    });
    const revoked = transitionContentPackage(
      accepted,
      {
        at: NOW,
        reason: 'source_asset_authorization_revoked',
        type: 'rights_revoked',
      },
      NOW
    );

    assert.doesNotThrow(() => assertContentPackageExportAllowed(accepted));
    assert.throws(
      () => assertContentPackageExportAllowed(revoked),
      ContentPackageTransitionError
    );
  });
});

describe('ContentPackage frozen command and query contract', () => {
  it('exports one canonical action name for each planned command and query', () => {
    assert.deepEqual(Object.keys(CONTENT_PACKAGE_COMMAND_SCHEMAS).sort(), [
      'adopt_canvas_work_export',
      'adopt_harness_candidate',
      'adopt_into_content_package',
      'approve_content_package_action',
      'attach_content_package_generation',
      'cancel_content_package',
      'content_package_migration_activate',
      'content_package_migration_backfill',
      'content_package_migration_dry_run',
      'content_package_migration_freeze',
      'content_package_migration_inspect',
      'content_package_migration_rollback',
      'create_content_package',
      'deliver_content_package',
      'edit_content_package_variant',
      'edit_content_package_version',
      'export_content_package',
      'generate_content_package_variants',
      'record_content_package_manual_result',
      'record_content_package_result_review_action',
      'record_content_package_result_signal',
      'reuse_content_package',
      'revise_content_package_visuals',
      'revoke_content_package_rights',
      'rollback_content_package_version',
    ]);
    assert.deepEqual(Object.keys(CONTENT_PACKAGE_QUERY_SCHEMAS).sort(), [
      'content_package',
      'content_package_delivery_capabilities',
      'content_package_delivery_timeline',
      'content_package_lineage',
      'content_package_migration_report',
      'content_package_migration_status',
      'content_package_results',
      'content_package_versions',
      'content_package_weekly_result_review',
      'content_packages',
    ]);
    assert.equal(
      'generate_content_package_variant' in CONTENT_PACKAGE_COMMAND_SCHEMAS,
      false
    );
    assert.equal(
      'generate_package_variants' in CONTENT_PACKAGE_COMMAND_SCHEMAS,
      false
    );
  });

  it('freezes adoption as one copy candidate plus ordered visual Assets', () => {
    assert.equal(
      adoptIntoContentPackageCommandSchema.safeParse({
        copyCandidateAssetId: 'copy-candidate-1',
        visualAssetIds: ['visual-2', 'visual-1'],
        workId: 'work-1',
      }).success,
      true
    );
    assert.equal(
      adoptIntoContentPackageCommandSchema.safeParse({
        copyCandidateAssetId: 'copy-candidate-1',
        visualAssetIds: [],
        workId: 'work-1',
      }).success,
      false
    );
    assert.equal(
      adoptIntoContentPackageCommandSchema.safeParse({
        copyCandidateAssetIds: ['copy-candidate-1', 'copy-candidate-2'],
        visualAssetIds: ['visual-1'],
        workId: 'work-1',
      }).success,
      false
    );
  });

  it('rejects a platform variant whose current version pointer is dangling', () => {
    const contentPackage = buildContentPackage({
      id: 'package-invalid-variant',
      kind: 'image_text',
      source: { assetIds: ['asset-1'], briefId: 'brief-1' },
      timestamp: NOW,
      workspaceId: 'workspace-contract',
    });

    assert.equal(
      contentPackageSchema.safeParse({
        ...contentPackage,
        variants: [
          {
            currentVersionId: 'missing-version',
            id: 'variant-xiaohongshu',
            platform: 'xiaohongshu',
            versions: [
              {
                body: '正文',
                createdAt: NOW,
                id: 'variant-version-1',
                orderedAssetIds: ['asset-1'],
                title: '标题',
                topics: [],
              },
            ],
          },
        ],
      }).success,
      false
    );
  });
});
