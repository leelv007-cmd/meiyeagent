import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Pool, PoolClient } from 'pg';
import { contentPackageSchema } from '@meiye/contracts';
import type {
  AuditEvent,
  ContentItem,
  ContentPackage,
  ContentPackageLegacySource,
  ContentPackageVersion,
  VideoArtifact,
} from '@meiye/contracts';
import type { CreativeContent } from './types.js';
import type { OperationsRepository } from './repository.js';
import type { ContentPackageWriteOwnershipPort } from './content-package-write-ownership.js';

type LegacyProductContent = Pick<
  ContentItem,
  | 'artifactId'
  | 'assetIds'
  | 'createdAt'
  | 'id'
  | 'selected'
  | 'status'
  | 'variants'
>;

type LegacyProductAuditEvent = Pick<
  AuditEvent,
  'action' | 'details' | 'entityId'
>;

type LegacyProductVideoArtifact = Pick<
  VideoArtifact,
  'contentType' | 'fileSha256' | 'fileSizeBytes' | 'id' | 'objectKey' | 'status'
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
  productAuditEvents?: LegacyProductAuditEvent[];
  productContents: LegacyProductContent[];
  productVideoArtifacts?: LegacyProductVideoArtifact[];
  videoWorkflows: LegacyCompletedVideoWorkflow[];
}

export interface ContentPackageMigrationSourcePort {
  read(workspaceId: string): Promise<ContentPackageMigrationSnapshot>;
}

export interface ContentPackageMigrationRestoreVerifier {
  verify(input: {
    runId: string;
    snapshot: ContentPackageMigrationSnapshot;
    workspaceId: string;
  }): Promise<boolean>;
}

export interface ContentPackageOwnedReceiptVerifier {
  verify(input: {
    asset: NonNullable<ContentPackage['generated']['ownedAssets']>[number];
    workspaceId: string;
  }): Promise<boolean>;
}

export interface ContentPackageOwnedReceiptHeadGetPort {
  get(objectKey: string): Promise<Uint8Array>;
  head(objectKey: string): Promise<{
    contentType: string;
    sizeBytes: number;
  } | null>;
}

export class HeadGetContentPackageOwnedReceiptVerifier
  implements ContentPackageOwnedReceiptVerifier
{
  constructor(
    private readonly storage: ContentPackageOwnedReceiptHeadGetPort
  ) {}

  async verify(input: {
    asset: NonNullable<ContentPackage['generated']['ownedAssets']>[number];
    workspaceId: string;
  }) {
    if (!ownedReceiptIsStructurallyReadable(input.workspaceId, input.asset)) {
      return false;
    }
    try {
      const metadata = await this.storage.head(input.asset.objectKey);
      if (
        !metadata ||
        metadata.contentType !== input.asset.contentType ||
        metadata.sizeBytes !== input.asset.sizeBytes
      ) {
        return false;
      }
      const bytes = await this.storage.get(input.asset.objectKey);
      return (
        bytes.byteLength === input.asset.sizeBytes &&
        createHash('sha256').update(bytes).digest('hex') === input.asset.sha256
      );
    } catch {
      return false;
    }
  }
}

export class PostgresContentPackageMigrationSource
  implements ContentPackageMigrationSourcePort
{
  constructor(
    private readonly dependencies: {
      operations: OperationsRepository;
      pool: Pool;
      product: {
        load(workspaceId: string): Promise<{
          auditEvents?: AuditEvent[];
          contents: ContentItem[];
          videoArtifacts?: VideoArtifact[];
        } | null>;
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
      productAuditEvents: product?.auditEvents ?? [],
      productContents: product?.contents ?? [],
      productVideoArtifacts: product?.videoArtifacts ?? [],
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
  getActive(workspaceId: string): Promise<ContentPackageMigrationRun | null>;
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

  async getActive(workspaceId: string) {
    const active = [...this.runs.values()]
      .filter(
        (run) => run.workspaceId === workspaceId && run.stage === 'active'
      )
      .sort((left, right) =>
        right.updatedAt === left.updatedAt
          ? right.runId.localeCompare(left.runId)
          : right.updatedAt.localeCompare(left.updatedAt)
      )[0];
    return active ? structuredClone(active) : null;
  }

  async get(workspaceId: string, runId: string) {
    const run = this.runs.get(`${workspaceId}:${runId}`);
    return run ? structuredClone(run) : null;
  }

  async save(run: ContentPackageMigrationRun) {
    this.runs.set(`${run.workspaceId}:${run.runId}`, structuredClone(run));
  }
}

export class PostgresContentPackageMigrationRunRepository
  implements
    ContentPackageMigrationRunRepository,
    ContentPackageMigrationRestoreVerifier
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

  async getActive(workspaceId: string) {
    const result = await this.pool.query<{
      payload: ContentPackageMigrationRun;
    }>(
      `SELECT payload
       FROM content_package_migration_runs
       WHERE workspace_id = $1 AND payload->>'stage' = 'active'
       ORDER BY updated_at DESC, run_id DESC
       LIMIT 1`,
      [workspaceId]
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

  async verify(input: {
    runId: string;
    snapshot: ContentPackageMigrationSnapshot;
    workspaceId: string;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`
        CREATE TEMP TABLE content_package_migration_restore_sections (
          section text NOT NULL,
          ordinal integer NOT NULL,
          payload jsonb NOT NULL,
          PRIMARY KEY (section, ordinal)
        ) ON COMMIT DROP;
        CREATE TEMP TABLE content_package_migration_restore_metadata (
          section text PRIMARY KEY,
          present boolean NOT NULL
        ) ON COMMIT DROP;
      `);
      const sections = [
        ['creativeContents', input.snapshot.creativeContents, true],
        [
          'productAuditEvents',
          input.snapshot.productAuditEvents ?? [],
          input.snapshot.productAuditEvents !== undefined,
        ],
        ['productContents', input.snapshot.productContents, true],
        [
          'productVideoArtifacts',
          input.snapshot.productVideoArtifacts ?? [],
          input.snapshot.productVideoArtifacts !== undefined,
        ],
        ['videoWorkflows', input.snapshot.videoWorkflows, true],
      ] as const;
      for (const [section, values, present] of sections) {
        await client.query(
          `INSERT INTO content_package_migration_restore_metadata (
             section, present
           ) VALUES ($1, $2)`,
          [section, present]
        );
        await client.query(
          `INSERT INTO content_package_migration_restore_sections (
             section, ordinal, payload
           )
           SELECT $1, restored.ordinality - 1, restored.payload
           FROM jsonb_array_elements($2::jsonb)
             WITH ORDINALITY AS restored(payload, ordinality)`,
          [section, JSON.stringify(values)]
        );
      }
      const metadata = await client.query<{
        present: boolean;
        section: string;
      }>(
        `SELECT section, present
         FROM content_package_migration_restore_metadata`
      );
      const restoredRows = await client.query<{
        payload: unknown;
        section: string;
      }>(
        `SELECT section, payload
         FROM content_package_migration_restore_sections
         ORDER BY section, ordinal`
      );
      const present = new Map(
        metadata.rows.map((row) => [row.section, row.present])
      );
      const restoredSection = (section: string) =>
        restoredRows.rows
          .filter((row) => row.section === section)
          .map((row) => row.payload);
      const restored = {
        creativeContents: restoredSection('creativeContents'),
        ...(present.get('productAuditEvents')
          ? { productAuditEvents: restoredSection('productAuditEvents') }
          : {}),
        productContents: restoredSection('productContents'),
        ...(present.get('productVideoArtifacts')
          ? { productVideoArtifacts: restoredSection('productVideoArtifacts') }
          : {}),
        videoWorkflows: restoredSection('videoWorkflows'),
      } as ContentPackageMigrationSnapshot;
      await client.query('COMMIT');
      return isDeepStrictEqual(restored, input.snapshot);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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
    revision: 0,
    rights: { state: 'authorized' },
    source: { assetIds: [] },
    status: input.status,
    updatedAt: input.createdAt,
    variants: [],
    versions: input.versions,
    workspaceId: input.workspaceId,
  };
}

function shouldMigrateProduct(content: LegacyProductContent) {
  return content.selected || content.status !== 'candidate';
}

function isVerifiedLegacyVideoObjectKey(
  workspaceId: string,
  objectKey: string
) {
  const segments = objectKey.split('/');
  const videoPath = segments.slice(2);
  return (
    segments[0] === workspaceId &&
    segments[1] === 'videos' &&
    videoPath.length > 0 &&
    videoPath.every(
      (segment) => segment.length > 0 && segment !== '.' && segment !== '..'
    ) &&
    videoPath.at(-1)?.endsWith('.mp4') === true
  );
}

function resolvedProductVideoArtifact(
  workspaceId: string,
  content: LegacyProductContent,
  artifacts: LegacyProductVideoArtifact[]
) {
  if (!content.artifactId) return undefined;
  const artifact = artifacts.find((item) => item.id === content.artifactId);
  return artifact &&
    artifact.status === 'completed' &&
    artifact.contentType === 'video/mp4' &&
    isVerifiedLegacyVideoObjectKey(workspaceId, artifact.objectKey) &&
    /^[a-f0-9]{64}$/i.test(artifact.fileSha256) &&
    Number.isInteger(artifact.fileSizeBytes) &&
    artifact.fileSizeBytes > 0
    ? artifact
    : undefined;
}

function mapProduct(
  workspaceId: string,
  content: LegacyProductContent,
  options: {
    auditEvents: LegacyProductAuditEvent[];
    migratedProductIds: Set<string>;
    videoArtifacts: LegacyProductVideoArtifact[];
  }
): ContentPackage | null {
  if (!shouldMigrateProduct(content)) return null;
  const id = packageId(workspaceId, 'product_content_item', content.id);
  const videoArtifact = resolvedProductVideoArtifact(
    workspaceId,
    content,
    options.videoArtifacts
  );
  const mappedVariants = content.variants.flatMap((variant) => {
    const versions = variant.versions.map((version) =>
      migratedVersion(id, `${variant.platform}:${version.id}`, {
        body: version.body,
        conversionHook: version.conversionHook,
        createdAt: version.createdAt,
        orderedAssetIds: videoArtifact
          ? [videoArtifact.id]
          : version.assetOrder,
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
  const remixSourceId = options.auditEvents.find(
    (event) =>
      event.action === 'content.remixed' &&
      event.entityId === content.id &&
      typeof event.details?.sourceId === 'string'
  )?.details?.sourceId;
  const reusedFromSourceId =
    typeof remixSourceId === 'string' ? remixSourceId : undefined;
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
      kind: videoArtifact ? 'video' : 'image_text',
      legacySource: {
        mappingConfidence:
          content.variants.length === 0 ||
          (content.artifactId && !videoArtifact) ||
          (reusedFromSourceId &&
            !options.migratedProductIds.has(reusedFromSourceId))
            ? 'partial'
            : 'exact',
        sourceId: content.id,
        sourceType: 'product_content_item',
      },
      status,
      versions,
      workspaceId,
    }),
    generated: {
      assetIds: videoArtifact ? [videoArtifact.id] : content.assetIds,
      childRuns: [],
      ...(videoArtifact
        ? {
            ownedAssets: [
              {
                contentType: 'video/mp4' as const,
                id: videoArtifact.id,
                objectKey: videoArtifact.objectKey,
                sha256: videoArtifact.fileSha256,
                sizeBytes: videoArtifact.fileSizeBytes,
              },
            ],
          }
        : {}),
    },
    lineage:
      reusedFromSourceId && options.migratedProductIds.has(reusedFromSourceId)
        ? {
            reusedFromPackageId: packageId(
              workspaceId,
              'product_content_item',
              reusedFromSourceId
            ),
          }
        : {},
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
  const migratedProductIds = new Set(
    snapshot.productContents.filter(shouldMigrateProduct).map((item) => item.id)
  );
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
    ...snapshot.productContents.map((item) =>
      mapProduct(workspaceId, item, {
        auditEvents: snapshot.productAuditEvents ?? [],
        migratedProductIds,
        videoArtifacts: snapshot.productVideoArtifacts ?? [],
      })
    ),
    ...snapshot.creativeContents.map((item) => mapCreative(workspaceId, item)),
    ...snapshot.videoWorkflows
      .filter((item) => !existingWorkflowIds.has(item.id))
      .map((item) => mapVideo(workspaceId, item)),
  ].filter((item): item is ContentPackage => item !== null);
  return packages.map((item) => contentPackageSchema.parse(item));
}

function ownedReceiptIdentity(contentPackage: ContentPackage) {
  return (contentPackage.generated.ownedAssets ?? []).map((asset) => ({
    contentType: asset.contentType,
    id: asset.id,
    objectKey: asset.objectKey,
    sha256: asset.sha256,
    sizeBytes: asset.sizeBytes,
  }));
}

function ownedReceiptIsStructurallyReadable(
  workspaceId: string,
  asset: NonNullable<ContentPackage['generated']['ownedAssets']>[number]
) {
  const extension =
    asset.contentType === 'video/mp4'
      ? 'mp4'
      : asset.contentType === 'image/png'
        ? 'png'
        : asset.contentType === 'application/zip'
          ? 'zip'
          : undefined;
  return Boolean(
    extension &&
      asset.objectKey.startsWith(`${workspaceId}/`) &&
      asset.objectKey.endsWith(`.${extension}`) &&
      !asset.objectKey.startsWith('http://') &&
      !asset.objectKey.startsWith('https://') &&
      /^[a-f0-9]{64}$/i.test(asset.sha256) &&
      typeof asset.sizeBytes === 'number' &&
      Number.isInteger(asset.sizeBytes) &&
      asset.sizeBytes > 0
  );
}

function assetReceiptDifferences(
  workspaceId: string,
  expected: ContentPackage,
  actual: ContentPackage | undefined
) {
  if (!actual) return [];
  const differences: string[] = [];
  if (
    JSON.stringify(actual.source.assetIds) !==
    JSON.stringify(expected.source.assetIds)
  ) {
    differences.push(`${expected.id}:source-asset-ids-mismatch`);
  }
  const resolvableAssetIds = new Set([
    ...actual.source.assetIds,
    ...actual.generated.assetIds,
    ...(actual.generated.ownedAssets ?? []).map((asset) => asset.id),
  ]);
  const orderedAssetIds = [
    ...actual.versions.flatMap((version) => version.orderedAssetIds),
    ...actual.variants.flatMap((variant) =>
      variant.versions.flatMap((version) => version.orderedAssetIds)
    ),
  ];
  for (const assetId of new Set(orderedAssetIds)) {
    if (!resolvableAssetIds.has(assetId)) {
      differences.push(`${expected.id}:ordered-asset-unresolved:${assetId}`);
    }
  }
  if (
    JSON.stringify(ownedReceiptIdentity(actual)) !==
    JSON.stringify(ownedReceiptIdentity(expected))
  ) {
    differences.push(`${expected.id}:owned-receipt-mismatch`);
  }
  for (const asset of actual.generated.ownedAssets ?? []) {
    if (!ownedReceiptIsStructurallyReadable(workspaceId, asset)) {
      differences.push(
        `${expected.id}:owned-object-key-unreadable:${asset.id}`
      );
    }
  }
  return differences;
}

export class ContentPackageMigrationService {
  private readonly clock: () => Date;
  private readonly restoreVerifier?: ContentPackageMigrationRestoreVerifier;
  private readonly runs: ContentPackageMigrationRunRepository;

  constructor(
    private readonly dependencies: {
      clock?: () => Date;
      ownedReceiptVerifier?: ContentPackageOwnedReceiptVerifier;
      ownership: ContentPackageWriteOwnershipPort;
      repository: OperationsRepository;
      restoreVerifier?: ContentPackageMigrationRestoreVerifier;
      runs?: ContentPackageMigrationRunRepository;
      source: ContentPackageMigrationSourcePort;
    }
  ) {
    this.clock = dependencies.clock ?? (() => new Date());
    this.runs =
      dependencies.runs ?? new MemoryContentPackageMigrationRunRepository();
    this.restoreVerifier =
      dependencies.restoreVerifier ??
      ('verify' in this.runs && typeof this.runs.verify === 'function'
        ? (this.runs as ContentPackageMigrationRunRepository &
            ContentPackageMigrationRestoreVerifier)
        : undefined);
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
      ...((backupSnapshot ?? existing?.backupSnapshot)
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
        const persistedSnapshot = persisted?.backupSnapshot;
        if (
          !persistedSnapshot ||
          !isDeepStrictEqual(persistedSnapshot, snapshot)
        ) {
          throw new Error(
            'ContentPackage migration backup restore rehearsal failed.'
          );
        }
        if (!this.restoreVerifier) {
          throw new Error(
            'ContentPackage migration restore verification seam is required.'
          );
        }
        if (
          !(await this.restoreVerifier.verify({
            runId,
            snapshot: persistedSnapshot,
            workspaceId,
          }))
        ) {
          throw new Error(
            'ContentPackage migration isolated restore verification failed.'
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
            // The aggregate revision protocol requires every mutation to bump
            // the revision (Postgres saveContentPackageRows enforces
            // expectedRevision = revision - 1). Before 2026-08-12 this sync
            // wrote in place at the same revision — green only against the
            // memory double's last-write-wins, a guaranteed 409 in production.
            revision: existing.revision + 1,
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
        const state =
          await this.dependencies.repository.loadWorkspace(workspaceId);
        if (!state) throw new Error(`Workspace ${workspaceId} does not exist.`);
        const ownedAssets = (state.contentPackages ?? [])
          .filter((contentPackage) => contentPackage.legacySource)
          .flatMap(
            (contentPackage) => contentPackage.generated.ownedAssets ?? []
          );
        if (ownedAssets.length > 0 && !this.dependencies.ownedReceiptVerifier) {
          throw new Error(
            'ContentPackage migration owned receipt verifier is required before activation.'
          );
        }
        for (const asset of ownedAssets) {
          if (
            !(await this.dependencies.ownedReceiptVerifier!.verify({
              asset,
              workspaceId,
            }))
          ) {
            throw new Error(
              `ContentPackage migration owned receipt verification failed for ${asset.id}.`
            );
          }
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
        const [owner, current, active] = await Promise.all([
          this.dependencies.ownership.get(workspaceId),
          this.runs.get(workspaceId, runId),
          this.runs.getActive(workspaceId),
        ]);
        if (
          owner !== 'contentpackage' ||
          current?.stage !== 'active' ||
          active?.runId !== runId
        ) {
          throw new Error(
            'ContentPackage rollback requires the current active migration run.'
          );
        }
        await this.dependencies.ownership.set(workspaceId, 'legacy');
        return this.saveRun(
          workspaceId,
          runId,
          'rolled_back',
          current.lastReport,
          current.backupVerified
        );
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
    const expected = expectedPackages(workspaceId, snapshot, currentPackages);
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
      assetReceiptDifferences(workspaceId, item, actualById.get(item.id))
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
