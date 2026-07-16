import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MemoryContentPackageWriteOwnership,
  MemoryOperationsRepository,
} from './index.js';
import {
  ContentPackageMigrationService,
  type ContentPackageMigrationRun,
  type ContentPackageMigrationRunRepository,
  type ContentPackageMigrationSnapshot,
} from './content-package-migration.js';
import { runContentPackageMigrationCli } from './content-package-migration-cli.js';
import {
  OperationsApplicationService,
  OperationsError,
  RecordedCanvasExportAdapter,
  RecordedImageGenerationAdapter,
} from './index.js';
import type { OperationsWorkspaceState } from './types.js';

const now = '2026-07-15T00:00:00.000Z';
const videoSha256 =
  'd9f1cb99ee21291800d5e62bd9bca07850461d7d8096afc4150a52dc8554d49f';

function workspace(workspaceId: string): OperationsWorkspaceState {
  return {
    auditEvents: [],
    commandReceipts: [],
    contentPackages: [],
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
    workspaceId,
    works: [],
  };
}

function snapshot(workspaceId: string): ContentPackageMigrationSnapshot {
  return {
    creativeContents: [
      {
        assetIds: ['creative-image'],
        body: 'Creative body',
        createdAt: now,
        id: 'creative-1',
        jobId: 'job-1',
        status: 'accepted',
        title: 'Creative title',
        workId: 'work-1',
        workspaceId,
      },
    ],
    productContents: [
      {
        assetIds: ['product-image'],
        createdAt: now,
        id: 'selected-1',
        selected: true,
        status: 'candidate',
        variants: [
          {
            aiDefaultVersionId: 'legacy-version-1',
            currentVersionId: 'legacy-version-1',
            id: 'legacy-variant-1',
            platform: 'xiaohongshu',
            versions: [
              {
                assetOrder: ['product-image'],
                body: 'Product body',
                conversionHook: 'Book now',
                createdAt: now,
                id: 'legacy-version-1',
                source: 'ai',
                title: 'Product title',
                topics: ['beauty'],
              },
            ],
          },
        ],
      },
      {
        assetIds: [],
        createdAt: now,
        id: 'unselected-1',
        selected: false,
        status: 'candidate',
        variants: [],
      },
    ],
    videoWorkflows: [
      {
        composedAsset: {
          contentType: 'video/mp4',
          id: 'video-asset-1',
          objectKey: `${workspaceId}/composed/${videoSha256}.mp4`,
          sha256: videoSha256,
          sizeBytes: 8,
        },
        createdAt: now,
        id: 'workflow-1',
        status: 'completed',
        updatedAt: now,
        workId: 'video-work-1',
        workspaceId,
      },
    ],
  };
}

class FailOnceMigrationRunRepository
  implements ContentPackageMigrationRunRepository
{
  private failed = false;
  private readonly runs = new Map<string, ContentPackageMigrationRun>();

  constructor(
    private readonly shouldFail: (run: ContentPackageMigrationRun) => boolean
  ) {}

  async get(workspaceId: string, runId: string) {
    const run = this.runs.get(`${workspaceId}:${runId}`);
    return run ? structuredClone(run) : null;
  }

  async save(run: ContentPackageMigrationRun) {
    if (!this.failed && this.shouldFail(run)) {
      this.failed = true;
      throw new Error(`simulated ${run.stage} migration checkpoint loss`);
    }
    this.runs.set(
      `${run.workspaceId}:${run.runId}`,
      structuredClone(run)
    );
  }
}

test('dry-run reports seven migration sections without writing packages', async () => {
  const repository = new MemoryOperationsRepository();
  const ownership = new MemoryContentPackageWriteOwnership();
  await repository.saveWorkspace(workspace('workspace-a'));
  const service = new ContentPackageMigrationService({
    clock: () => new Date(now),
    ownership,
    repository,
    source: { read: async () => snapshot('workspace-a') },
  });

  const report = await service.dryRun('workspace-a', 'run-1');

  assert.deepEqual(Object.keys(report.differences).sort(), [
    'assetReceipts',
    'countsByKind',
    'lineage',
    'stableIds',
    'statuses',
    'variantVersions',
    'variants',
  ]);
  assert.equal(report.expectedPackages, 3);
  assert.equal(
    (await repository.loadWorkspace('workspace-a'))?.contentPackages.length,
    0
  );
});

test('new workspaces default to ContentPackage as the sole content writer', async () => {
  const ownership = new MemoryContentPackageWriteOwnership();

  assert.equal(await ownership.get('workspace-new'), 'contentpackage');
});

test('freeze resumes after ownership changed but its verified checkpoint was lost', async () => {
  const repository = new MemoryOperationsRepository();
  const ownership = new MemoryContentPackageWriteOwnership();
  const runs = new FailOnceMigrationRunRepository(
    (run) => run.stage === 'frozen' && run.backupVerified === true
  );
  await repository.saveWorkspace(workspace('workspace-a'));
  const service = new ContentPackageMigrationService({
    clock: () => new Date(now),
    ownership,
    repository,
    runs,
    source: { read: async () => snapshot('workspace-a') },
  });
  await service.dryRun('workspace-a', 'run-freeze-resume');

  await assert.rejects(
    service.freeze('workspace-a', 'run-freeze-resume'),
    /simulated frozen migration checkpoint loss/
  );
  assert.equal(await ownership.get('workspace-a'), 'frozen');
  assert.equal(
    (await service.status('workspace-a', 'run-freeze-resume'))?.backupVerified,
    false
  );

  const resumed = await service.freeze('workspace-a', 'run-freeze-resume');
  assert.equal(resumed.stage, 'frozen');
  assert.equal(resumed.backupVerified, true);
  assert.equal(await ownership.get('workspace-a'), 'frozen');
});

test('activation resumes after ownership changed but its active checkpoint was lost', async () => {
  const repository = new MemoryOperationsRepository();
  const ownership = new MemoryContentPackageWriteOwnership();
  const runs = new FailOnceMigrationRunRepository(
    (run) => run.stage === 'active'
  );
  await repository.saveWorkspace(workspace('workspace-a'));
  const service = new ContentPackageMigrationService({
    clock: () => new Date(now),
    ownership,
    repository,
    runs,
    source: { read: async () => snapshot('workspace-a') },
  });
  await service.dryRun('workspace-a', 'run-activate-resume');
  await service.freeze('workspace-a', 'run-activate-resume');
  await service.backfill('workspace-a', 'run-activate-resume');

  await assert.rejects(
    service.activate('workspace-a', 'run-activate-resume'),
    /simulated active migration checkpoint loss/
  );
  assert.equal(await ownership.get('workspace-a'), 'contentpackage');
  assert.equal(
    (await service.status('workspace-a', 'run-activate-resume'))?.stage,
    'backfilled'
  );

  const resumed = await service.activate('workspace-a', 'run-activate-resume');
  assert.equal(resumed.stage, 'active');
  assert.equal(await ownership.get('workspace-a'), 'contentpackage');
});

test('migration CLI exposes the guarded lifecycle without requiring a database for help', async () => {
  const result = await runContentPackageMigrationCli(['--help'], {});
  assert.ok(result && typeof result === 'object');
  assert.match(
    (result as { help: string }).help,
    /inspect\|dry-run\|freeze\|backfill\|activate/
  );
});

test('backfill is stable, excludes unselected candidates, and rollback preserves new facts', async () => {
  const repository = new MemoryOperationsRepository();
  const ownership = new MemoryContentPackageWriteOwnership();
  await repository.saveWorkspace(workspace('workspace-a'));
  const service = new ContentPackageMigrationService({
    clock: () => new Date(now),
    ownership,
    repository,
    source: { read: async () => snapshot('workspace-a') },
  });

  await service.dryRun('workspace-a', 'run-1');
  await service.freeze('workspace-a', 'run-1');
  const first = await service.backfill('workspace-a', 'run-1');
  const second = await service.backfill('workspace-a', 'run-1');
  assert.equal(first.createdPackages, 3);
  assert.equal(second.createdPackages, 0);

  const migrated = await repository.loadWorkspace('workspace-a');
  assert.equal(migrated?.contentPackages.length, 3);
  assert.equal(
    migrated?.contentPackages.some(
      (item) => item.legacySource?.sourceId === 'unselected-1'
    ),
    false
  );
  assert.equal(
    migrated?.contentPackages.find(
      (item) => item.legacySource?.sourceId === 'workflow-1'
    )?.generated.ownedAssets?.[0]?.objectKey,
    `workspace-a/composed/${videoSha256}.mp4`
  );
  assert.equal(
    migrated?.contentPackages.find(
      (item) => item.legacySource?.sourceId === 'workflow-1'
    )?.status,
    'accepted'
  );
  const migratedProduct = migrated?.contentPackages.find(
    (item) => item.legacySource?.sourceId === 'selected-1'
  );
  assert.deepEqual(
    migratedProduct?.variants.map((variant) => variant.platform),
    ['xiaohongshu']
  );
  assert.equal(migratedProduct?.variants[0]?.versions.length, 1);

  await service.activate('workspace-a', 'run-1');
  const stateWithNewFact = await repository.loadWorkspace('workspace-a');
  assert.ok(stateWithNewFact);
  const migratedPackage = stateWithNewFact.contentPackages[0];
  assert.ok(migratedPackage);
  stateWithNewFact.contentPackages.push({
    ...migratedPackage,
    id: 'new-package-after-activate',
    legacySource: undefined,
  });
  await repository.saveWorkspace(stateWithNewFact);

  await service.rollback('workspace-a', 'run-1');
  assert.equal(await ownership.get('workspace-a'), 'legacy');
  assert.equal(
    (await repository.loadWorkspace('workspace-a'))?.contentPackages.length,
    4
  );
});

test('migration marks non-production historical video receipts for replacement', async () => {
  const repository = new MemoryOperationsRepository();
  const ownership = new MemoryContentPackageWriteOwnership();
  await repository.saveWorkspace(workspace('workspace-a'));
  const source = snapshot('workspace-a');
  const baseWorkflow = source.videoWorkflows[0]!;
  source.videoWorkflows = [
    {
      ...baseWorkflow,
      composedAsset: {
        ...baseWorkflow.composedAsset!,
        objectKey: `workspace-a/composed/workflow-1-${videoSha256}.mp4`,
      },
      id: 'recorded-workflow',
    },
    {
      ...baseWorkflow,
      composedAsset: {
        ...baseWorkflow.composedAsset!,
        objectKey: 'owned/video-asset-1.mp4',
      },
      id: 'fixture-workflow',
    },
    {
      ...baseWorkflow,
      composedAsset: {
        ...baseWorkflow.composedAsset!,
        objectKey: `workspace-b/composed/${videoSha256}.mp4`,
      },
      id: 'foreign-workflow',
    },
  ];
  const service = new ContentPackageMigrationService({
    clock: () => new Date(now),
    ownership,
    repository,
    source: { read: async () => source },
  });

  await service.dryRun('workspace-a', 'run-invalid-video-receipts');
  await service.freeze('workspace-a', 'run-invalid-video-receipts');
  await service.backfill('workspace-a', 'run-invalid-video-receipts');

  const migrated = await repository.loadWorkspace('workspace-a');
  const videos = migrated?.contentPackages.filter(
    (item) => item.legacySource?.sourceType === 'durable_video_workflow'
  );
  assert.equal(videos?.length, 3);
  assert.deepEqual(
    videos?.map((item) => item.status),
    ['needs_replacement', 'needs_replacement', 'needs_replacement']
  );
  assert.deepEqual(
    videos?.map((item) => item.legacySource?.mappingConfidence),
    ['partial', 'partial', 'partial']
  );
});

test('freeze persists and restores the source snapshot before write ownership changes', async () => {
  const repository = new MemoryOperationsRepository();
  const ownership = new MemoryContentPackageWriteOwnership();
  await repository.saveWorkspace(workspace('workspace-a'));
  const service = new ContentPackageMigrationService({
    clock: () => new Date(now),
    ownership,
    repository,
    source: { read: async () => snapshot('workspace-a') },
  });

  await service.dryRun('workspace-a', 'run-backup');
  const frozen = await service.freeze('workspace-a', 'run-backup');

  assert.equal(frozen.backupVerified, true);
  assert.deepEqual(frozen.backupSnapshot, snapshot('workspace-a'));
  assert.equal(await ownership.get('workspace-a'), 'frozen');
});

test('freeze waits for an acquired legacy workspace write and includes it in the backup', async () => {
  const repository = new MemoryOperationsRepository();
  const ownership = new MemoryContentPackageWriteOwnership();
  await repository.saveWorkspace(workspace('workspace-a'));
  const service = new ContentPackageMigrationService({
    clock: () => new Date(now),
    ownership,
    repository,
    source: {
      async read(workspaceId) {
        const current = await repository.loadWorkspace(workspaceId);
        return {
          ...snapshot(workspaceId),
          creativeContents: current?.creativeContents ?? [],
        };
      },
    },
  });
  await service.dryRun('workspace-a', 'run-freeze-race');
  let releaseLegacyWrite = () => {};
  let markLegacyLockAcquired = () => {};
  const legacyLockAcquired = new Promise<void>((resolve) => {
    markLegacyLockAcquired = resolve;
  });
  const legacyWriteGate = new Promise<void>((resolve) => {
    releaseLegacyWrite = resolve;
  });
  const legacyWrite = repository.withWorkspaceLock(
    'workspace-a',
    async (lockedRepository) => {
      markLegacyLockAcquired();
      await legacyWriteGate;
      const state = await lockedRepository.loadWorkspace('workspace-a');
      assert.ok(state);
      state.creativeContents.push({
        ...snapshot('workspace-a').creativeContents[0]!,
        id: 'creative-committed-before-freeze',
      });
      await lockedRepository.saveWorkspace(state);
    }
  );
  await legacyLockAcquired;

  const freezing = service.freeze('workspace-a', 'run-freeze-race');
  await new Promise<void>((resolve) => setImmediate(resolve));
  releaseLegacyWrite();
  const [, frozen] = await Promise.all([legacyWrite, freezing]);

  assert.deepEqual(
    frozen.backupSnapshot?.creativeContents.map((item) => item.id),
    ['creative-committed-before-freeze']
  );
  assert.equal(await ownership.get('workspace-a'), 'frozen');
});

test('activation waits for an acquired workspace write lock', async () => {
  const repository = new MemoryOperationsRepository();
  const ownership = new MemoryContentPackageWriteOwnership();
  await repository.saveWorkspace(workspace('workspace-a'));
  const service = new ContentPackageMigrationService({
    clock: () => new Date(now),
    ownership,
    repository,
    source: { read: async () => snapshot('workspace-a') },
  });
  await service.dryRun('workspace-a', 'run-activate-lock');
  await service.freeze('workspace-a', 'run-activate-lock');
  await service.backfill('workspace-a', 'run-activate-lock');
  let releaseWrite = () => {};
  let markLockAcquired = () => {};
  const lockAcquired = new Promise<void>((resolve) => {
    markLockAcquired = resolve;
  });
  const writeGate = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  const holding = repository.withWorkspaceLock('workspace-a', async () => {
    markLockAcquired();
    await writeGate;
  });
  await lockAcquired;

  const activating = service.activate('workspace-a', 'run-activate-lock');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(await ownership.get('workspace-a'), 'frozen');
  releaseWrite();
  await Promise.all([holding, activating]);

  assert.equal(await ownership.get('workspace-a'), 'contentpackage');
});

test('backfill rechecks frozen ownership after acquiring the workspace lock', async () => {
  const repository = new MemoryOperationsRepository();
  const storedOwnership = new MemoryContentPackageWriteOwnership();
  let markInitialOwnerRead = () => {};
  const initialOwnerRead = new Promise<void>((resolve) => {
    markInitialOwnerRead = resolve;
  });
  let ownerReads = 0;
  const ownership = {
    async get(workspaceId: string) {
      ownerReads += 1;
      if (ownerReads === 1) markInitialOwnerRead();
      return storedOwnership.get(workspaceId);
    },
    set: storedOwnership.set.bind(storedOwnership),
  };
  await repository.saveWorkspace(workspace('workspace-a'));
  const service = new ContentPackageMigrationService({
    clock: () => new Date(now),
    ownership,
    repository,
    source: { read: async () => snapshot('workspace-a') },
  });
  await service.dryRun('workspace-a', 'run-backfill-owner-race');
  await service.freeze('workspace-a', 'run-backfill-owner-race');
  let releaseWrite = () => {};
  let markLockAcquired = () => {};
  const lockAcquired = new Promise<void>((resolve) => {
    markLockAcquired = resolve;
  });
  const writeGate = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  const holding = repository.withWorkspaceLock('workspace-a', async () => {
    markLockAcquired();
    await writeGate;
  });
  await lockAcquired;

  const backfilling = service.backfill(
    'workspace-a',
    'run-backfill-owner-race'
  );
  await initialOwnerRead;
  await storedOwnership.set('workspace-a', 'legacy');
  releaseWrite();
  await holding;

  await assert.rejects(backfilling, /must be frozen before backfill/);
  assert.equal(
    (await repository.loadWorkspace('workspace-a'))?.contentPackages.length,
    0
  );
});

test('rollback waits for an acquired workspace write lock', async () => {
  const repository = new MemoryOperationsRepository();
  const ownership = new MemoryContentPackageWriteOwnership();
  await repository.saveWorkspace(workspace('workspace-a'));
  const service = new ContentPackageMigrationService({
    clock: () => new Date(now),
    ownership,
    repository,
    source: { read: async () => snapshot('workspace-a') },
  });
  await service.dryRun('workspace-a', 'run-rollback-lock');
  await service.freeze('workspace-a', 'run-rollback-lock');
  await service.backfill('workspace-a', 'run-rollback-lock');
  await service.activate('workspace-a', 'run-rollback-lock');
  let releaseWrite = () => {};
  let markLockAcquired = () => {};
  const lockAcquired = new Promise<void>((resolve) => {
    markLockAcquired = resolve;
  });
  const writeGate = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  const holding = repository.withWorkspaceLock('workspace-a', async () => {
    markLockAcquired();
    await writeGate;
  });
  await lockAcquired;

  const rollingBack = service.rollback('workspace-a', 'run-rollback-lock');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(await ownership.get('workspace-a'), 'contentpackage');
  releaseWrite();
  await Promise.all([holding, rollingBack]);

  assert.equal(await ownership.get('workspace-a'), 'legacy');
});

test('report blocks activation when migrated platform variants or lineage drift', async () => {
  const repository = new MemoryOperationsRepository();
  const ownership = new MemoryContentPackageWriteOwnership();
  await repository.saveWorkspace(workspace('workspace-a'));
  const service = new ContentPackageMigrationService({
    clock: () => new Date(now),
    ownership,
    repository,
    source: { read: async () => snapshot('workspace-a') },
  });
  await service.dryRun('workspace-a', 'run-drift');
  await service.freeze('workspace-a', 'run-drift');
  await service.backfill('workspace-a', 'run-drift');
  const state = await repository.loadWorkspace('workspace-a');
  assert.ok(state);
  const migrated = state.contentPackages.find(
    (item) => item.legacySource?.sourceId === 'selected-1'
  );
  assert.ok(migrated);
  migrated.variants = [];
  migrated.lineage = { reusedFromPackageId: 'unexpected-package' };
  await repository.saveWorkspace(state);

  const report = await service.report('workspace-a', 'run-drift');
  assert.equal(report.differences.variants.length, 1);
  assert.equal(report.differences.lineage.length, 1);
  await assert.rejects(
    service.activate('workspace-a', 'run-drift'),
    /differences must be resolved/
  );
});

test('migration reads and writes only the requested workspace', async () => {
  const repository = new MemoryOperationsRepository();
  const ownership = new MemoryContentPackageWriteOwnership();
  await repository.saveWorkspace(workspace('workspace-a'));
  await repository.saveWorkspace(workspace('workspace-b'));
  const service = new ContentPackageMigrationService({
    ownership,
    repository,
    source: {
      read: async (workspaceId) => snapshot(workspaceId),
    },
  });

  await service.dryRun('workspace-a', 'run-a');
  await service.freeze('workspace-a', 'run-a');
  await service.backfill('workspace-a', 'run-a');

  assert.equal(
    (await repository.loadWorkspace('workspace-a'))?.contentPackages.length,
    3
  );
  assert.equal(
    (await repository.loadWorkspace('workspace-b'))?.contentPackages.length,
    0
  );
  assert.equal(await ownership.get('workspace-b'), 'contentpackage');
});

test('re-backfill syncs legacy publication only before a package gains new facts', async () => {
  const repository = new MemoryOperationsRepository();
  const ownership = new MemoryContentPackageWriteOwnership();
  await repository.saveWorkspace(workspace('workspace-a'));
  const legacy = snapshot('workspace-a');
  const service = new ContentPackageMigrationService({
    clock: () => new Date(now),
    ownership,
    repository,
    source: { read: async () => legacy },
  });
  await service.dryRun('workspace-a', 'run-1');
  await service.freeze('workspace-a', 'run-1');
  await service.backfill('workspace-a', 'run-1');
  const selectedPackage = (
    await repository.loadWorkspace('workspace-a')
  )?.contentPackages.find(
    (item) => item.legacySource?.sourceId === 'selected-1'
  );
  assert.equal(selectedPackage?.status, 'review_ready');

  legacy.productContents[0]!.status = 'published';
  const synchronized = await service.backfill('workspace-a', 'run-1');
  assert.equal(synchronized.updatedPackages, 1);
  assert.equal(
    (await repository.loadWorkspace('workspace-a'))?.contentPackages.find(
      (item) => item.id === selectedPackage?.id
    )?.status,
    'accepted'
  );

  legacy.productContents[0]!.status = 'candidate';
  const state = await repository.loadWorkspace('workspace-a');
  assert.ok(state);
  const index = state.contentPackages.findIndex(
    (item) => item.id === selectedPackage?.id
  );
  const current = state.contentPackages[index];
  assert.ok(current);
  state.contentPackages[index] = {
    ...current,
    currentVersionId: 'merchant-version',
    versions: [
      ...current.versions,
      {
        body: 'merchant body',
        createdAt: now,
        derivedFromVersionId: current.currentVersionId,
        id: 'merchant-version',
        orderedAssetIds: [],
        source: 'merchant_edited',
        title: 'merchant title',
        topics: [],
      },
    ],
  };
  await repository.saveWorkspace(state);

  const preserved = await service.backfill('workspace-a', 'run-1');
  assert.equal(preserved.updatedPackages, 0);
  assert.equal(
    (await repository.loadWorkspace('workspace-a'))?.contentPackages[index]
      ?.status,
    'accepted'
  );
  assert.equal(preserved.report.differences.statuses.length, 1);
});

test('CreativeContent acceptance obeys the same migration ownership switch', async () => {
  const repository = new MemoryOperationsRepository();
  const ownership = new MemoryContentPackageWriteOwnership();
  repository.grantMembership('owner-a', 'workspace-a');
  const service = new OperationsApplicationService(repository, {
    canvasExporter: new RecordedCanvasExportAdapter(),
    contentWriteOwnership: ownership,
    imageGenerator: new RecordedImageGenerationAdapter(),
    notifier: { async send() {} },
  });
  const context = {
    actor: 'owner' as const,
    correlationId: 'corr-legacy-creative',
    userId: 'owner-a',
    workspaceId: 'workspace-a',
  };

  await ownership.set('workspace-a', 'contentpackage');
  await assert.rejects(
    service.acceptCreativeAsset(context, 'legacy-asset'),
    (error) =>
      error instanceof OperationsError &&
      error.code === 'LEGACY_CONTENT_READ_ONLY' &&
      error.status === 409
  );
});
