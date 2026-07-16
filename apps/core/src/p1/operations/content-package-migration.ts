import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { contentPackageSchema } from '@meiye/contracts';
import type {
  ContentItem,
  ContentPackage,
  ContentPackageLegacySource,
  ContentPackageVersion,
} from '@meiye/contracts';
import type { CreativeContent } from './types.js';
import type { OperationsRepository } from './repository.js';
import type { ContentPackageWriteOwnershipPort } from './content-package-write-ownership.js';

type LegacyProductContent = Pick<
  ContentItem,
  'assetIds' | 'createdAt' | 'id' | 'selected' | 'status' | 'variants'
>;

export interface LegacyCompletedVideoWorkflow {
  composedAsset?: {
    contentType: string;
    id: string;
    objectKey: string;
    sha256: string;
    sizeBytes?: number;
  };
  createdAt: string;
  id: string;
  status: string;
  updatedAt: string;
  workId?: string;
  workspaceId: string;
}

export interface ContentPackageMigrationSnapshot {
  creativeContents: CreativeContent[];
  productContents: LegacyProductContent[];
  videoWorkflows: LegacyCompletedVideoWorkflow[];
}

export interface ContentPackageMigrationSourcePort {
  read(workspaceId: string): Promise<ContentPackageMigrationSnapshot>;
}

export class PostgresContentPackageMigrationSource
  implements ContentPackageMigrationSourcePort
{
  constructor(
    private readonly dependencies: {
      operations: OperationsRepository;
      pool: Pool;
      product: {
        load(workspaceId: string): Promise<{ contents: ContentItem[] } | null>;
      };
    }
  ) {}

  async read(workspaceId: string): Promise<ContentPackageMigrationSnapshot> {
    const [product, operations, workflows] = await Promise.all([
      this.dependencies.product.load(workspaceId),
      this.dependencies.operations.loadWorkspace(workspaceId),
      this.dependencies.pool.query<{ workflow: LegacyCompletedVideoWorkflow }>(
        `SELECT workflow FROM model_video_workflows
         WHERE workspace_id = $1 AND workflow->>'status' = 'completed'`,
        [workspaceId]
      ),
    ]);
    return {
      creativeContents: operations?.creativeContents ?? [],
      productContents: product?.contents ?? [],
      videoWorkflows: workflows.rows.map((row) => row.workflow),
    };
  }
}

export interface ContentPackageMigrationDifferences {
  assetReceipts: string[];
  countsByKind: Record<ContentPackageLegacySource['sourceType'], number>;
  lineage: string[];
  stableIds: string[];
  statuses: string[];
  variantVersions: string[];
  variants: string[];
}

export interface ContentPackageMigrationReport {
  actualPackages: number;
  differences: ContentPackageMigrationDifferences;
  expectedPackages: number;
  generatedAt: string;
  mappingRuleVersion: 'contentpackage-legacy-v1';
  runId: string;
  workspaceId: string;
}

export interface ContentPackageMigrationRun {
  backupSnapshot?: ContentPackageMigrationSnapshot;
  backupVerified?: boolean;
  lastReport?: ContentPackageMigrationReport;
  runId: string;
  stage:
    | 'inspected'
    | 'dry_run'
    | 'frozen'
    | 'backfilled'
    | 'active'
    | 'rolled_back';
  updatedAt: string;
  workspaceId: string;
}

export interface ContentPackageMigrationRunRepository {
  get(
    workspaceId: string,
    runId: string
  ): Promise<ContentPackageMigrationRun | null>;
  save(run: ContentPackageMigrationRun): Promise<void>;
}

export class MemoryContentPackageMigrationRunRepository
  implements ContentPackageMigrationRunRepository
{
  private readonly runs = new Map<string, ContentPackageMigrationRun>();

  async get(workspaceId: string, runId: string) {
    const run = this.runs.get(`${workspaceId}:${runId}`);
    return run ? structuredClone(run) : null;
  }

  async save(run: ContentPackageMigrationRun) {
    this.runs.set(`${run.workspaceId}:${run.runId}`, structuredClone(run));
  }
}

export class PostgresContentPackageMigrationRunRepository
  implements ContentPackageMigrationRunRepository
{
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient) {
    await (client ?? this.pool).query(`
      CREATE TABLE IF NOT EXISTS content_package_migration_runs (
        workspace_id text NOT NULL,
        run_id text NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, run_id)
      );
    `);
  }

  async get(workspaceId: string, runId: string) {
    const result = await this.pool.query<{
      payload: ContentPackageMigrationRun;
    }>(
      `SELECT payload FROM content_package_migration_runs
       WHERE workspace_id = $1 AND run_id = $2`,
      [workspaceId, runId]
    );
    return result.rows[0]?.payload ?? null;
  }

  async save(run: ContentPackageMigrationRun) {
    await this.pool.query(
      `INSERT INTO content_package_migration_runs (
         workspace_id, run_id, payload, updated_at
       ) VALUES ($1, $2, $3::jsonb, $4::timestamptz)
       ON CONFLICT (workspace_id, run_id) DO UPDATE
         SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at`,
      [run.workspaceId, run.runId, JSON.stringify(run), run.updatedAt]
    );
  }
}

function stableId(...parts: string[]) {
  return createHash('sha256')
    .update(parts.join(':'))
    .digest('hex')
    .slice(0, 24);
}

function packageId(
  workspaceId: string,
  sourceType: ContentPackageLegacySource['sourceType'],
  sourceId: string
) {
  return `content-package-${stableId(workspaceId, sourceType, sourceId)}`;
}

function migratedVersion(
  packageIdValue: string,
  sourceVersionId: string,
  input: Omit<ContentPackageVersion, 'id'>
): ContentPackageVersion {
  return {
    ...input,
    id: `content-package-version-${stableId(packageIdValue, sourceVersionId)}`,
  };
}

function basePackage(input: {
  createdAt: string;
  id: string;
  kind: ContentPackage['kind'];
  legacySource: ContentPackageLegacySource;
  status: ContentPackage['status'];
  versions: ContentPackageVersion[];
  workspaceId: string;
}): ContentPackage {
  return {
    compliance: { aigcLabelEnabled: false, watermarkEnabled: false },
    createdAt: input.createdAt,
    currentVersionId: input.versions.at(-1)?.id,
    exportReceipts: [],
    generated: { assetIds: [], childRuns: [] },
    id: input.id,
    kind: input.kind,
    legacySource: input.legacySource,
    lineage: {},
    rights: { state: 'authorized' },
    source: { assetIds: [] },
    status: input.status,
    updatedAt: input.createdAt,
    variants: [],
    versions: input.versions,
    workspaceId: input.workspaceId,
  };
}

function mapProduct(
  workspaceId: string,
  content: LegacyProductContent
): ContentPackage | null {
  if (!content.selected && content.status === 'candidate') return null;
  const id = packageId(workspaceId, 'product_content_item', content.id);
  const mappedVariants = content.variants.flatMap((variant) => {
    const versions = variant.versions.map((version) =>
      migratedVersion(id, `${variant.platform}:${version.id}`, {
        body: version.body,
        conversionHook: version.conversionHook,
        createdAt: version.createdAt,
        orderedAssetIds: version.assetOrder,
        source:
          version.source === 'merchant' ? 'merchant_edited' : 'ai_generated',
        title: version.title,
        topics: version.topics,
      })
    );
    if (versions.length === 0) return [];
    const currentVersionIndex = variant.versions.findIndex(
      (version) => version.id === variant.currentVersionId
    );
    return [
      {
        currentVersionId:
          versions[currentVersionIndex]?.id ?? versions.at(-1)!.id,
        id: `content-package-variant-${stableId(id, variant.id)}`,
        platform: variant.platform,
        versions,
      },
    ];
  });
  const versions = mappedVariants.flatMap((variant) => variant.versions);
  const status: ContentPackage['status'] =
    content.status === 'abandoned'
      ? 'cancelled'
      : content.status === 'candidate'
        ? 'review_ready'
        : 'accepted';
  return {
    ...basePackage({
      createdAt: content.createdAt,
      id,
      kind: 'image_text',
      legacySource: {
        mappingConfidence: content.variants.length > 0 ? 'exact' : 'partial',
        sourceId: content.id,
        sourceType: 'product_content_item',
      },
      status,
      versions,
      workspaceId,
    }),
    generated: { assetIds: content.assetIds, childRuns: [] },
    source: { assetIds: content.assetIds },
    variants: mappedVariants,
  };
}

function mapCreative(
  workspaceId: string,
  content: CreativeContent
): ContentPackage {
  const id = packageId(workspaceId, 'creative_content', content.id);
  const version = migratedVersion(id, content.id, {
    body: content.body,
    createdAt: content.acceptedAt ?? content.createdAt,
    orderedAssetIds: content.assetIds,
    source: 'ai_generated',
    title: content.title,
    topics: [],
  });
  return {
    ...basePackage({
      createdAt: content.createdAt,
      id,
      kind: 'image_text',
      legacySource: {
        mappingConfidence: 'exact',
        sourceId: content.id,
        sourceType: 'creative_content',
      },
      status: 'accepted',
      versions: [version],
      workspaceId,
    }),
    generated: {
      assetIds: content.assetIds,
      childRuns: [
        {
          assetIds: content.assetIds,
          runId: content.jobId,
          runType: 'creative_job',
          status: 'succeeded',
        },
      ],
    },
    source: { assetIds: content.assetIds, workId: content.workId },
  };
}

function mapVideo(
  workspaceId: string,
  workflow: LegacyCompletedVideoWorkflow
): ContentPackage | null {
  if (workflow.status !== 'completed' || !workflow.composedAsset) return null;
  const exportable = isExportableLegacyVideo(workspaceId, workflow);
  const id = packageId(workspaceId, 'durable_video_workflow', workflow.id);
  const version = migratedVersion(id, workflow.id, {
    body: '',
    createdAt: workflow.updatedAt,
    orderedAssetIds: [workflow.composedAsset.id],
    source: 'ai_generated',
    title: '',
    topics: [],
  });
  return {
    ...basePackage({
      createdAt: workflow.createdAt,
      id,
      kind: 'video',
      legacySource: {
        mappingConfidence: exportable ? 'exact' : 'partial',
        sourceId: workflow.id,
        sourceType: 'durable_video_workflow',
      },
      status: exportable ? 'accepted' : 'needs_replacement',
      versions: [version],
      workspaceId,
    }),
    generated: {
      assetIds: [workflow.composedAsset.id],
      childRuns: [
        {
          assetIds: [workflow.composedAsset.id],
          runId: workflow.id,
          runType: 'durable_video_workflow',
          status: 'succeeded',
        },
      ],
      ownedAssets: [workflow.composedAsset],
    },
    source: {
      assetIds: [],
      workflowId: workflow.id,
      ...(workflow.workId ? { workId: workflow.workId } : {}),
    },
  };
}

function isExportableLegacyVideo(
  workspaceId: string,
  workflow: LegacyCompletedVideoWorkflow
) {
  const asset = workflow.composedAsset;
  return Boolean(
    asset &&
      workflow.workspaceId === workspaceId &&
      asset.contentType === 'video/mp4' &&
      /^[a-f0-9]{64}$/.test(asset.sha256) &&
      Number.isInteger(asset.sizeBytes) &&
      (asset.sizeBytes ?? 0) > 0 &&
      asset.objectKey === `${workspaceId}/composed/${asset.sha256}.mp4`
  );
}

function expectedPackages(
  workspaceId: string,
  snapshot: ContentPackageMigrationSnapshot,
  existing: ContentPackage[]
) {
  const existingWorkflowIds = new Set(
    existing.flatMap((item) =>
      item.generated.childRuns
        .filter(
          (run) =>
            run.runType === 'durable_video_workflow' &&
            item.legacySource?.sourceType !== 'durable_video_workflow'
        )
        .map((run) => run.runId)
    )
  );
  const packages = [
    ...snapshot.productContents.map((item) => mapProduct(workspaceId, item)),
    ...snapshot.creativeContents.map((item) => mapCreative(workspaceId, item)),
    ...snapshot.videoWorkflows
      .filter((item) => !existingWorkflowIds.has(item.id))
      .map((item) => mapVideo(workspaceId, item)),
  ].filter((item): item is ContentPackage => item !== null);
  return packages.map((item) => contentPackageSchema.parse(item));
}

export class ContentPackageMigrationService {
  private readonly clock: () => Date;
  private readonly runs: ContentPackageMigrationRunRepository;

  constructor(
    private readonly dependencies: {
      clock?: () => Date;
      ownership: ContentPackageWriteOwnershipPort;
      repository: OperationsRepository;
      runs?: ContentPackageMigrationRunRepository;
      source: ContentPackageMigrationSourcePort;
    }
  ) {
    this.clock = dependencies.clock ?? (() => new Date());
    this.runs =
      dependencies.runs ?? new MemoryContentPackageMigrationRunRepository();
  }

  private async saveRun(
    workspaceId: string,
    runId: string,
    stage: ContentPackageMigrationRun['stage'],
    lastReport?: ContentPackageMigrationReport,
    backupVerified?: boolean,
    backupSnapshot?: ContentPackageMigrationSnapshot
  ) {
    const existing = await this.runs.get(workspaceId, runId);
    const run = {
      ...(backupSnapshot ?? existing?.backupSnapshot
        ? { backupSnapshot: backupSnapshot ?? existing?.backupSnapshot }
        : {}),
      ...(lastReport ? { lastReport } : {}),
      ...(backupVerified === undefined ? {} : { backupVerified }),
      runId,
      stage,
      updatedAt: this.clock().toISOString(),
      workspaceId,
    } satisfies ContentPackageMigrationRun;
    await this.runs.save(run);
    return structuredClone(run);
  }

  async inspect(workspaceId: string, runId: string) {
    const report = await this.buildReport(workspaceId, runId);
    await this.saveRun(workspaceId, runId, 'inspected', report);
    return report;
  }

  async dryRun(workspaceId: string, runId: string) {
    const report = await this.buildReport(workspaceId, runId);
    await this.saveRun(workspaceId, runId, 'dry_run', report);
    return report;
  }

  async freeze(workspaceId: string, runId: string) {
    return this.dependencies.repository.withWorkspaceLock(
      workspaceId,
      async () => {
        const current = await this.runs.get(workspaceId, runId);
        if (
          current?.stage !== 'dry_run' &&
          (current?.stage !== 'frozen' || !current.backupSnapshot)
        ) {
          throw new Error(
            'ContentPackage migration dry-run is required before freeze.'
          );
        }
        const snapshot =
          current.stage === 'frozen'
            ? current.backupSnapshot
            : await this.dependencies.source.read(workspaceId);
        const serialized = JSON.stringify(snapshot);
        if (current.stage === 'dry_run') {
          await this.saveRun(
            workspaceId,
            runId,
            'frozen',
            current.lastReport,
            false,
            snapshot
          );
        }
        const persisted = await this.runs.get(workspaceId, runId);
        const restored = JSON.stringify(persisted?.backupSnapshot);
        if (restored !== serialized) {
          throw new Error(
            'ContentPackage migration backup restore rehearsal failed.'
          );
        }
        const owner = await this.dependencies.ownership.get(workspaceId);
        if (current.stage === 'frozen' && owner === 'contentpackage') {
          throw new Error(
            'ContentPackage migration freeze cannot resume after activation.'
          );
        }
        await this.dependencies.ownership.set(workspaceId, 'frozen');
        if (current.stage === 'frozen' && current.backupVerified) {
          return current;
        }
        return this.saveRun(
          workspaceId,
          runId,
          'frozen',
          current.lastReport,
          true,
          snapshot
        );
      }
    );
  }

  async backfill(workspaceId: string, runId: string) {
    if ((await this.dependencies.ownership.get(workspaceId)) !== 'frozen') {
      throw new Error(
        'ContentPackage migration must be frozen before backfill.'
      );
    }
    const migrationRun = await this.runs.get(workspaceId, runId);
    let createdPackages = 0;
    let updatedPackages = 0;
    await this.dependencies.repository.withWorkspaceLock(
      workspaceId,
      async (repository) => {
        if ((await this.dependencies.ownership.get(workspaceId)) !== 'frozen') {
          throw new Error(
            'ContentPackage migration must be frozen before backfill.'
          );
        }
        const state = await repository.loadWorkspace(workspaceId);
        if (!state) throw new Error(`Workspace ${workspaceId} does not exist.`);
        state.contentPackages ??= [];
        const snapshot = await this.dependencies.source.read(workspaceId);
        const expected = expectedPackages(
          workspaceId,
          snapshot,
          state.contentPackages
        );
        const existingIds = new Set(
          state.contentPackages.map((item) => item.id)
        );
        const additions = expected.filter((item) => !existingIds.has(item.id));
        createdPackages = additions.length;
        const expectedById = new Map(expected.map((item) => [item.id, item]));
        for (const [index, existing] of state.contentPackages.entries()) {
          const target = expectedById.get(existing.id);
          if (!target || existing.status === target.status) continue;
          const hasOnlyMigratedFacts =
            existing.versions.length === target.versions.length &&
            existing.versions.every(
              (version, versionIndex) =>
                version.id === target.versions[versionIndex]?.id
            ) &&
            existing.currentVersionId === target.currentVersionId &&
            JSON.stringify(existing.variants) ===
              JSON.stringify(target.variants) &&
            JSON.stringify(existing.lineage) ===
              JSON.stringify(target.lineage) &&
            existing.exportReceipts.length === 0;
          if (!hasOnlyMigratedFacts) continue;
          state.contentPackages[index] = {
            ...existing,
            status: target.status,
            updatedAt: this.clock().toISOString(),
          };
          updatedPackages += 1;
        }
        if (additions.length > 0 || updatedPackages > 0) {
          state.contentPackages.push(...additions);
          await repository.saveWorkspace(state);
        }
      }
    );
    const report = await this.buildReport(workspaceId, runId);
    await this.saveRun(
      workspaceId,
      runId,
      'backfilled',
      report,
      migrationRun?.backupVerified
    );
    return { createdPackages, report, updatedPackages };
  }

  async activate(workspaceId: string, runId: string) {
    return this.dependencies.repository.withWorkspaceLock(
      workspaceId,
      async () => {
        const owner = await this.dependencies.ownership.get(workspaceId);
        const current = await this.runs.get(workspaceId, runId);
        if (owner === 'contentpackage' && current?.stage === 'active') {
          return current;
        }
        if (owner !== 'frozen' && owner !== 'contentpackage') {
          throw new Error(
            'ContentPackage migration must be frozen before activation.'
          );
        }
        if (!current?.backupVerified) {
          throw new Error(
            'ContentPackage migration backup restore rehearsal is required before activation.'
          );
        }
        const report = await this.buildReport(workspaceId, runId);
        const unresolvedDifferences = Object.entries(report.differences)
          .filter(([key]) => key !== 'countsByKind')
          .flatMap(([, value]) => value as string[]);
        if (unresolvedDifferences.length > 0) {
          throw new Error(
            'ContentPackage migration differences must be resolved before activation.'
          );
        }
        if (owner === 'frozen') {
          await this.dependencies.ownership.set(workspaceId, 'contentpackage');
        }
        return this.saveRun(workspaceId, runId, 'active', report, true);
      }
    );
  }

  async rollback(workspaceId: string, runId: string) {
    return this.dependencies.repository.withWorkspaceLock(
      workspaceId,
      async () => {
        await this.dependencies.ownership.set(workspaceId, 'legacy');
        return this.saveRun(workspaceId, runId, 'rolled_back');
      }
    );
  }

  status(workspaceId: string, runId: string) {
    return this.runs.get(workspaceId, runId);
  }

  async report(workspaceId: string, runId: string) {
    return this.buildReport(workspaceId, runId);
  }

  private async buildReport(
    workspaceId: string,
    runId: string
  ): Promise<ContentPackageMigrationReport> {
    const state = await this.dependencies.repository.loadWorkspace(workspaceId);
    if (!state) throw new Error(`Workspace ${workspaceId} does not exist.`);
    const snapshot = await this.dependencies.source.read(workspaceId);
    const currentPackages = state.contentPackages ?? [];
    const expected = expectedPackages(
      workspaceId,
      snapshot,
      currentPackages
    );
    const migrated = currentPackages.filter((item) => item.legacySource);
    const actualById = new Map(migrated.map((item) => [item.id, item]));
    const expectedIds = new Set(expected.map((item) => item.id));
    const stableIds = [
      ...expected
        .filter((item) => !actualById.has(item.id))
        .map((item) => `missing:${item.id}`),
      ...migrated
        .filter((item) => !expectedIds.has(item.id))
        .map((item) => `unexpected:${item.id}`),
    ];
    const statuses = expected.flatMap((item) => {
      const actual = actualById.get(item.id);
      return actual && actual.status !== item.status
        ? [`${item.id}:${actual.status}->${item.status}`]
        : [];
    });
    const variantVersions = expected.flatMap((item) => {
      const actual = actualById.get(item.id);
      if (!actual) return [];
      const expectedIds = [
        ...item.versions.map((version) => version.id),
        ...item.variants.flatMap((variant) =>
          variant.versions.map((version) => version.id)
        ),
      ];
      const actualIds = [
        ...actual.versions.map((version) => version.id),
        ...actual.variants.flatMap((variant) =>
          variant.versions.map((version) => version.id)
        ),
      ];
      return JSON.stringify(actualIds) === JSON.stringify(expectedIds)
        ? []
        : [`${item.id}:variant-version-ids-mismatch`];
    });
    const variants = expected.flatMap((item) => {
      const actual = actualById.get(item.id);
      if (!actual) return [];
      const identity = (contentPackage: ContentPackage) =>
        contentPackage.variants.map((variant) => ({
          currentVersionId: variant.currentVersionId,
          platform: variant.platform,
        }));
      return JSON.stringify(identity(actual)) === JSON.stringify(identity(item))
        ? []
        : [`${item.id}:platform-variants-mismatch`];
    });
    const lineage = expected.flatMap((item) => {
      const actual = actualById.get(item.id);
      return actual &&
        JSON.stringify(actual.lineage) !== JSON.stringify(item.lineage)
        ? [`${item.id}:lineage-mismatch`]
        : [];
    });
    const assetReceipts = expected.flatMap((item) =>
      item.generated.ownedAssets?.some((asset) => !asset.objectKey)
        ? [`${item.id}:missing-owned-object-key`]
        : []
    );
    const countsByKind = {
      creative_content: expected.filter(
        (item) => item.legacySource?.sourceType === 'creative_content'
      ).length,
      durable_video_workflow: expected.filter(
        (item) => item.legacySource?.sourceType === 'durable_video_workflow'
      ).length,
      product_content_item: expected.filter(
        (item) => item.legacySource?.sourceType === 'product_content_item'
      ).length,
    };
    return {
      actualPackages: migrated.length,
      differences: {
        assetReceipts,
        countsByKind,
        lineage,
        stableIds,
        statuses,
        variantVersions,
        variants,
      },
      expectedPackages: expected.length,
      generatedAt: this.clock().toISOString(),
      mappingRuleVersion: 'contentpackage-legacy-v1',
      runId,
      workspaceId,
    };
  }
}
