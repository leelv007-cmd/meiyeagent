import { createHash } from 'node:crypto';
import {
  contentPackageSchema,
  contentPackageVisibleStatus,
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

export type VisualAssetRecord = {
  contentType?: string;
  id: string;
  kind: 'image' | 'video' | 'text' | string;
  objectKey?: string;
  sha256?: string;
  sizeBytes?: number;
  workspaceId: string;
};

export type VisualAdoptionResult = PublicContentPackage & {
  statusGroup: ReturnType<typeof contentPackageVisibleStatus>['statusGroup'];
};

export interface VisualAdoptionPort {
  firstAdopt(
    context: P1Context,
    command: FirstAdoptCommand,
    idempotencyKey?: string,
  ): Promise<VisualAdoptionResult>;
  reviseContentPackageVisuals(
    context: P1Context,
    command: ReviseContentPackageVisualsCommand,
    idempotencyKey?: string,
  ): Promise<VisualAdoptionResult>;
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
