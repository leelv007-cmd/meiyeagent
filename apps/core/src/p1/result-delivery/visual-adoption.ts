import { createHash } from 'node:crypto';
import {
  contentPackageSchema,
  contentPackageVisibleStatus,
  toPublicContentPackage,
  type ContentPackage,
  type ContentPackageVersion,
  type PublicContentPackage,
  type ReviseContentPackageVisualsCommand,
} from '@meiye/contracts';

import type { P1Context } from '../foundation/domain.js';
import { VisualAdoptionError } from './errors.js';

export type FirstAdoptCommand = {
  copyCandidateAssetId: string;
  visualAssetIds: string[];
  workId: string;
  /** Optional copy fields when the port materializes the package itself. */
  body?: string;
  title?: string;
};

/**
 * Port for first-adopt (create-if-absent) — same domain semantics as
 * adopt_into_content_package. Production wiring can adapt to
 * OperationsApplicationService.adoptIntoContentPackage without forking.
 */
export interface FirstAdoptPort {
  adopt(
    context: P1Context,
    command: FirstAdoptCommand,
  ): Promise<ContentPackage>;
}

export type VisualAssetRecord = {
  contentType?: string;
  id: string;
  kind: 'image' | 'video' | 'text' | string;
  objectKey?: string;
  sha256?: string;
  sizeBytes?: number;
  workspaceId: string;
};

export interface VisualAdoptionStore {
  findPackageByWorkId(
    workspaceId: string,
    workId: string,
  ): Promise<ContentPackage | null>;
  getPackage(
    workspaceId: string,
    packageId: string,
  ): Promise<ContentPackage | null>;
  getVisualAsset(
    workspaceId: string,
    assetId: string,
  ): Promise<VisualAssetRecord | null>;
  listPackages(workspaceId: string): Promise<ContentPackage[]>;
  savePackage(contentPackage: ContentPackage): Promise<void>;
}

export type VisualAdoptionResult = PublicContentPackage & {
  statusGroup: ReturnType<typeof contentPackageVisibleStatus>['statusGroup'];
  statusLabel: ReturnType<typeof contentPackageVisibleStatus>['statusLabel'];
};

function withVisible(contentPackage: ContentPackage): VisualAdoptionResult {
  return {
    ...toPublicContentPackage(contentPackage),
    ...contentPackageVisibleStatus(contentPackage.status),
  };
}

function stablePackageId(workspaceId: string, workId: string) {
  return `content-package-${createHash('sha256')
    .update(`${workspaceId}:${workId}:image-text`)
    .digest('hex')
    .slice(0, 24)}`;
}

function mediaVersionId(
  packageId: string,
  baseVersionId: string,
  sourceAssetId: string,
  index: number,
) {
  return `media-ver-${createHash('sha256')
    .update(
      JSON.stringify({ baseVersionId, index, packageId, sourceAssetId }),
    )
    .digest('hex')
    .slice(0, 20)}`;
}

function derivedVersionId(
  packageId: string,
  baseVersionId: string,
  orderedMediaVersionIds: string[],
) {
  return `${packageId}-v-${createHash('sha256')
    .update(JSON.stringify({ baseVersionId, orderedMediaVersionIds }))
    .digest('hex')
    .slice(0, 16)}`;
}

/** image_text constraints: non-empty, unique, ordered. */
export function validateOrderedVisualAssetIds(ids: readonly string[]): void {
  if (ids.length === 0) {
    throw new VisualAdoptionError(
      'VISUAL_ASSET_REQUIRED',
      'An image-text ContentPackage requires at least one visual Asset.',
      400,
    );
  }
  if (new Set(ids).size !== ids.length) {
    throw new VisualAdoptionError(
      'DUPLICATE_VISUAL_ASSET',
      'Visual Assets must be unique and ordered.',
      400,
    );
  }
}

/** image_text: every visual must resolve to an image Asset. */
export function assertImageOnlyVisuals(
  orderedVisualAssetIds: readonly string[],
  resolve: (assetId: string) => VisualAssetRecord | null | undefined,
): VisualAssetRecord[] {
  return orderedVisualAssetIds.map((assetId) => {
    const asset = resolve(assetId);
    if (!asset || asset.kind !== 'image') {
      throw new VisualAdoptionError(
        'INVALID_VISUAL_ASSET',
        'Every visual Asset must be an image.',
        409,
      );
    }
    return asset;
  });
}

/**
 * Media version node = new owned media asset id + parent/source lineage.
 * Does NOT reuse reuse-memory recipe-level AssetRevision.
 */
export function materializeMediaVersionNodes(input: {
  baseVersionId: string;
  orderedVisualAssetIds: readonly string[];
  packageId: string;
  visualAssets: readonly VisualAssetRecord[];
}): {
  orderedMediaVersionIds: string[];
  ownedAssets: NonNullable<ContentPackage['generated']['ownedAssets']>;
  sourceAssetIds: string[];
} {
  const byId = new Map(input.visualAssets.map((asset) => [asset.id, asset]));
  const orderedMediaVersionIds: string[] = [];
  const ownedAssets: NonNullable<ContentPackage['generated']['ownedAssets']> =
    [];
  const sourceAssetIds: string[] = [];

  for (const [index, sourceAssetId] of input.orderedVisualAssetIds.entries()) {
    const source = byId.get(sourceAssetId);
    if (!source) {
      throw new VisualAdoptionError(
        'INVALID_VISUAL_ASSET',
        'Every visual Asset must exist.',
        409,
      );
    }
    const id = mediaVersionId(
      input.packageId,
      input.baseVersionId,
      sourceAssetId,
      index,
    );
    orderedMediaVersionIds.push(id);
    sourceAssetIds.push(sourceAssetId);
    ownedAssets.push({
      contentType: source.contentType ?? 'image/jpeg',
      id,
      objectKey:
        source.objectKey ?? `owned/${input.packageId}/${id}`,
      sha256:
        source.sha256 ??
        createHash('sha256').update(id).digest('hex'),
      sourceAssetId,
      ...(typeof source.sizeBytes === 'number'
        ? { sizeBytes: source.sizeBytes }
        : {}),
    });
  }

  return { orderedMediaVersionIds, ownedAssets, sourceAssetIds };
}

export function reviseContentPackageVisualsPure(input: {
  baseVersionId: string;
  contentPackage: ContentPackage;
  expectedRevision: number;
  orderedVisualAssetIds: readonly string[];
  timestamp: string;
  userId: string;
  visualAssets: readonly VisualAssetRecord[];
}): ContentPackage {
  const current = input.contentPackage;

  if (current.revision !== input.expectedRevision) {
    throw new VisualAdoptionError(
      'CONTENT_PACKAGE_REVISION_CONFLICT',
      `ContentPackage ${current.id} expected revision ${input.expectedRevision}, current revision is ${current.revision}.`,
      409,
    );
  }

  if (
    current.kind !== 'image_text' ||
    (current.status !== 'accepted' &&
      current.status !== 'export_failed' &&
      current.status !== 'needs_replacement' &&
      current.status !== 'review_ready') ||
    !current.currentVersionId
  ) {
    throw new VisualAdoptionError(
      'CONTENT_PACKAGE_NOT_REVISABLE',
      'Only an adopted image-text ContentPackage can revise visuals.',
      409,
    );
  }

  if (current.currentVersionId !== input.baseVersionId) {
    throw new VisualAdoptionError(
      'CONTENT_PACKAGE_VERSION_CONFLICT',
      'The ContentPackage version changed before this visual adoption was saved.',
      409,
    );
  }

  const baseVersion = current.versions.find(
    (version) => version.id === input.baseVersionId,
  );
  if (!baseVersion) {
    throw new VisualAdoptionError(
      'CONTENT_PACKAGE_VERSION_CONFLICT',
      'The base version was not found on this ContentPackage.',
      409,
    );
  }

  validateOrderedVisualAssetIds(input.orderedVisualAssetIds);
  assertImageOnlyVisuals(input.orderedVisualAssetIds, (assetId) =>
    input.visualAssets.find((asset) => asset.id === assetId),
  );

  const { orderedMediaVersionIds, ownedAssets, sourceAssetIds } =
    materializeMediaVersionNodes({
      baseVersionId: input.baseVersionId,
      orderedVisualAssetIds: input.orderedVisualAssetIds,
      packageId: current.id,
      visualAssets: input.visualAssets,
    });

  const versionId = derivedVersionId(
    current.id,
    input.baseVersionId,
    orderedMediaVersionIds,
  );

  // Same inputs under same base → same derived version id (deterministic).
  const existing = current.versions.find((version) => version.id === versionId);
  if (existing) {
    return contentPackageSchema.parse({
      ...current,
      currentVersionId: existing.id,
      updatedAt: input.timestamp,
    });
  }

  const version: ContentPackageVersion = {
    body: baseVersion.body,
    ...(baseVersion.conversionHook
      ? { conversionHook: baseVersion.conversionHook }
      : {}),
    createdAt: input.timestamp,
    createdBy: input.userId,
    derivedFromVersionId: input.baseVersionId,
    id: versionId,
    orderedAssetIds: orderedMediaVersionIds,
    source: 'merchant_edited',
    title: baseVersion.title,
    topics: [...baseVersion.topics],
  };

  const priorOwned = current.generated.ownedAssets ?? [];
  const mergedOwned = [
    ...priorOwned.filter(
      (asset) => !ownedAssets.some((next) => next.id === asset.id),
    ),
    ...ownedAssets,
  ];

  const updated: ContentPackage = {
    ...current,
    currentVersionId: versionId,
    generated: {
      ...current.generated,
      assetIds: [
        ...new Set([...current.generated.assetIds, ...sourceAssetIds]),
      ],
      ownedAssets: mergedOwned,
    },
    revision: current.revision + 1,
    source: {
      ...current.source,
      assetIds: [
        ...new Set([...current.source.assetIds, ...sourceAssetIds]),
      ],
    },
    updatedAt: input.timestamp,
    versions: [...current.versions, version],
  };

  return contentPackageSchema.parse(updated);
}

/**
 * Unified visual-adoption service: first-adopt via port + revise OCC writes.
 * User adoption writes only; generation attachment is a separate path.
 */
export class VisualAdoptionService {
  private readonly clock: () => string;
  private readonly idempotentResults = new Map<string, ContentPackage>();

  constructor(
    private readonly store: VisualAdoptionStore,
    private readonly firstAdoptPort: FirstAdoptPort,
    options: { clock?: () => string } = {},
  ) {
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  private idempotencyKey(workspaceId: string, key: string) {
    return `${workspaceId}::${key}`;
  }

  private async resolveVisuals(
    workspaceId: string,
    orderedVisualAssetIds: readonly string[],
  ) {
    validateOrderedVisualAssetIds(orderedVisualAssetIds);
    const assets: VisualAssetRecord[] = [];
    for (const assetId of orderedVisualAssetIds) {
      const asset = await this.store.getVisualAsset(workspaceId, assetId);
      if (!asset || asset.kind !== 'image') {
        throw new VisualAdoptionError(
          'INVALID_VISUAL_ASSET',
          'Every visual Asset must be an image.',
          409,
        );
      }
      assets.push(asset);
    }
    return assets;
  }

  /**
   * First adopt: create-if-absent via FirstAdoptPort (adopt_into_content_package semantics).
   */
  async firstAdopt(
    context: P1Context,
    command: FirstAdoptCommand,
    idempotencyKey?: string,
  ): Promise<VisualAdoptionResult> {
    if (idempotencyKey) {
      const cached = this.idempotentResults.get(
        this.idempotencyKey(context.workspaceId, idempotencyKey),
      );
      if (cached) {
        return withVisible(cached);
      }
    }

    await this.resolveVisuals(context.workspaceId, command.visualAssetIds);

    const contentPackage = await this.firstAdoptPort.adopt(context, command);

    if (idempotencyKey) {
      this.idempotentResults.set(
        this.idempotencyKey(context.workspaceId, idempotencyKey),
        contentPackage,
      );
    }

    return withVisible(contentPackage);
  }

  /**
   * Re-adopt whole set / replace images / set cover after adoption.
   * One derived immutable version under expectedRevision OCC.
   */
  async reviseContentPackageVisuals(
    context: P1Context,
    command: ReviseContentPackageVisualsCommand,
    idempotencyKey?: string,
  ): Promise<VisualAdoptionResult> {
    if (idempotencyKey) {
      const cached = this.idempotentResults.get(
        this.idempotencyKey(context.workspaceId, idempotencyKey),
      );
      if (cached) {
        return withVisible(cached);
      }
    }

    const current = await this.store.getPackage(
      context.workspaceId,
      command.packageId,
    );
    if (!current) {
      throw new VisualAdoptionError(
        'CONTENT_PACKAGE_NOT_FOUND',
        'The ContentPackage was not found.',
        404,
      );
    }

    const visualAssets = await this.resolveVisuals(
      context.workspaceId,
      command.orderedVisualAssetIds,
    );

    const revised = reviseContentPackageVisualsPure({
      baseVersionId: command.baseVersionId,
      contentPackage: current,
      expectedRevision: command.expectedRevision,
      orderedVisualAssetIds: command.orderedVisualAssetIds,
      timestamp: this.clock(),
      userId: context.userId,
      visualAssets,
    });

    await this.store.savePackage(revised);

    if (idempotencyKey) {
      this.idempotentResults.set(
        this.idempotencyKey(context.workspaceId, idempotencyKey),
        revised,
      );
    }

    return withVisible(revised);
  }
}

/**
 * In-memory store + FirstAdoptPort for tests and standalone module use.
 * Mirrors create-if-absent + ordered visualAssetIds of adopt_into_content_package.
 */
export class MemoryVisualAdoptionStore implements VisualAdoptionStore {
  private readonly packages = new Map<string, ContentPackage>();
  private readonly assets = new Map<string, VisualAssetRecord>();

  private packageKey(workspaceId: string, packageId: string) {
    return `${workspaceId}::${packageId}`;
  }

  private assetKey(workspaceId: string, assetId: string) {
    return `${workspaceId}::${assetId}`;
  }

  putVisualAsset(asset: VisualAssetRecord) {
    this.assets.set(this.assetKey(asset.workspaceId, asset.id), asset);
  }

  async getVisualAsset(workspaceId: string, assetId: string) {
    return this.assets.get(this.assetKey(workspaceId, assetId)) ?? null;
  }

  async getPackage(workspaceId: string, packageId: string) {
    return this.packages.get(this.packageKey(workspaceId, packageId)) ?? null;
  }

  async savePackage(contentPackage: ContentPackage) {
    this.packages.set(
      this.packageKey(contentPackage.workspaceId, contentPackage.id),
      contentPackage,
    );
  }

  async findPackageByWorkId(workspaceId: string, workId: string) {
    for (const contentPackage of this.packages.values()) {
      if (
        contentPackage.workspaceId === workspaceId &&
        contentPackage.source.workId === workId &&
        contentPackage.kind === 'image_text'
      ) {
        return contentPackage;
      }
    }
    return null;
  }

  async listPackages(workspaceId: string) {
    return [...this.packages.values()].filter(
      (contentPackage) => contentPackage.workspaceId === workspaceId,
    );
  }
}

/**
 * Memory first-adopt: create-if-absent, stable package id per work, ordered visuals.
 */
export class MemoryFirstAdoptPort implements FirstAdoptPort {
  constructor(
    private readonly store: MemoryVisualAdoptionStore,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  async adopt(
    context: P1Context,
    command: FirstAdoptCommand,
  ): Promise<ContentPackage> {
    validateOrderedVisualAssetIds(command.visualAssetIds);

    const existing = await this.store.findPackageByWorkId(
      context.workspaceId,
      command.workId,
    );
    if (existing) {
      return existing;
    }

    const visualAssets: VisualAssetRecord[] = [];
    for (const assetId of command.visualAssetIds) {
      const asset = await this.store.getVisualAsset(
        context.workspaceId,
        assetId,
      );
      if (!asset || asset.kind !== 'image') {
        throw new VisualAdoptionError(
          'INVALID_VISUAL_ASSET',
          'Every visual Asset must be an image.',
          409,
        );
      }
      visualAssets.push(asset);
    }

    const timestamp = this.clock();
    const packageId = stablePackageId(context.workspaceId, command.workId);
    const versionId = `${packageId}-v1`;

    const { orderedMediaVersionIds, ownedAssets } =
      materializeMediaVersionNodes({
        baseVersionId: versionId,
        orderedVisualAssetIds: command.visualAssetIds,
        packageId,
        visualAssets,
      });

    // First adopt ordered refs use media version nodes with source lineage;
    // package identity remains create-if-absent per work (same as adopt semantics).
    const contentPackage = contentPackageSchema.parse({
      compliance: {
        aigcLabelEnabled: false,
        watermarkEnabled: false,
      },
      createdAt: timestamp,
      currentVersionId: versionId,
      exportReceipts: [],
      generated: {
        assetIds: [...command.visualAssetIds],
        childRuns: [],
        ownedAssets,
      },
      id: packageId,
      kind: 'image_text',
      lineage: {},
      revision: 1,
      rights: { state: 'authorized' },
      source: {
        assetIds: [
          command.copyCandidateAssetId,
          ...command.visualAssetIds,
        ],
        workId: command.workId,
      },
      status: 'accepted',
      updatedAt: timestamp,
      variants: [],
      versions: [
        {
          body: command.body ?? '',
          createdAt: timestamp,
          createdBy: context.userId,
          id: versionId,
          orderedAssetIds: orderedMediaVersionIds,
          source: 'ai_generated',
          title: command.title ?? '采用文案',
          topics: [],
        },
      ],
      workspaceId: context.workspaceId,
    });

    await this.store.savePackage(contentPackage);
    return contentPackage;
  }
}
