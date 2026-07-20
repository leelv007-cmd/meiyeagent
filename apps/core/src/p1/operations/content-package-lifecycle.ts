import { createHash } from 'node:crypto';
import {
  PROMOTIONAL_MATERIAL_SPECS,
  type ContentPackage,
  type ContentPackagePlatform,
  type ContentPackageVersion,
  type PromotionalMaterialSpec,
  type QuickEditExportUseDelivery,
  type QuickEditIntent,
  contentPackageSchema,
  contentPackageVersionSourceRefIsReadOnly,
  quickEditExportUseDeliverySchema,
} from '@meiye/contracts';

type VersionChanges = Pick<
  ContentPackageVersion,
  'body' | 'conversionHook' | 'orderedAssetIds' | 'title' | 'topics'
>;

type VersionTarget =
  | { kind: 'package' }
  | { kind: 'variant'; platform: ContentPackagePlatform };

type ContentPackageLifecycleErrorCode =
  | 'CONTENT_PACKAGE_SOURCE_REF_READ_ONLY'
  | 'CONTENT_PACKAGE_CONTEXT_REFS_CHANGED'
  | 'CONTENT_PACKAGE_TRANSITION_CONFLICT'
  | 'CONTENT_PACKAGE_VARIANT_NOT_FOUND'
  | 'CONTENT_PACKAGE_VERSION_CONFLICT'
  | 'CONTENT_PACKAGE_VERSION_NOT_FOUND'
  | 'INVALID_CONTENT_PACKAGE_ASSET';

export class ContentPackageLifecycleError extends Error {
  constructor(
    public readonly code: ContentPackageLifecycleErrorCode,
    message: string,
    public readonly status: 404 | 409
  ) {
    super(message);
  }
}

const EDITABLE_STATUSES = new Set<ContentPackage['status']>([
  'accepted',
  'export_failed',
  'needs_replacement',
  'review_ready',
]);

function editableAssetIds(
  contentPackage: ContentPackage,
  target: VersionTarget
) {
  return new Set([
    ...contentPackage.source.assetIds,
    ...contentPackage.generated.assetIds,
    ...contentPackage.versions.flatMap((version) => version.orderedAssetIds),
    ...(target.kind === 'variant'
      ? contentPackage.variants.flatMap((variant) =>
          variant.versions.flatMap((version) => version.orderedAssetIds)
        )
      : []),
  ]);
}

function editedVersionId(
  ownerId: string,
  baseVersionId: string,
  changes: VersionChanges,
  intent?: QuickEditIntent,
) {
  return `${ownerId}-v-${createHash('sha256')
    .update(JSON.stringify({ baseVersionId, changes, intent: intent ?? null }))
    .digest('hex')
    .slice(0, 16)}`;
}

function promotionalMaterialSpec(
  purpose: PromotionalMaterialSpec['purpose']
): PromotionalMaterialSpec {
  const spec = PROMOTIONAL_MATERIAL_SPECS.find(
    (candidate) => candidate.purpose === purpose
  );
  if (!spec) throw new Error(`Unknown promotional material purpose: ${purpose}`);
  return structuredClone(spec);
}

function exportUseDelivery(input: {
  changes: VersionChanges;
  contentPackage: ContentPackage;
  intent?: QuickEditIntent;
  sourceVersionId: string;
}): QuickEditExportUseDelivery | undefined {
  if (input.intent?.target !== 'export_use' || !input.intent.exportUse) {
    return undefined;
  }
  const formattedText = [
    input.changes.title,
    input.changes.body,
    input.changes.conversionHook,
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n\n');
  switch (input.intent.exportUse) {
    case 'wechat_moments':
      return quickEditExportUseDeliverySchema.parse({
        contentType: 'text/plain;charset=utf-8',
        exportUse: input.intent.exportUse,
        fileName: 'wechat-moments.txt',
        kind: 'formatted_text',
        text: formattedText,
      });
    case 'spoken_script':
      return quickEditExportUseDeliverySchema.parse({
        contentType: 'text/plain;charset=utf-8',
        exportUse: input.intent.exportUse,
        fileName: 'spoken-script.txt',
        kind: 'formatted_text',
        text: formattedText,
      });
    case 'offline_material':
      return quickEditExportUseDeliverySchema.parse({
        exportUse: input.intent.exportUse,
        kind: 'light_composer',
        materialSpecs: [promotionalMaterialSpec('offline_a4_poster')],
        receiptCommand: 'export_work',
        sourcePackageId: input.contentPackage.id,
        ...(input.contentPackage.source.workId
          ? { sourceWorkId: input.contentPackage.source.workId }
          : {}),
        sourceVersionId: input.sourceVersionId,
        templateRole: input.intent.exportUse,
      });
    case 'poster':
      return quickEditExportUseDeliverySchema.parse({
        exportUse: input.intent.exportUse,
        kind: 'light_composer',
        materialSpecs: [promotionalMaterialSpec('wechat_moments_poster')],
        receiptCommand: 'export_work',
        sourcePackageId: input.contentPackage.id,
        ...(input.contentPackage.source.workId
          ? { sourceWorkId: input.contentPackage.source.workId }
          : {}),
        sourceVersionId: input.sourceVersionId,
        templateRole: input.intent.exportUse,
      });
    case 'image_set':
      return quickEditExportUseDeliverySchema.parse({
        exportUse: input.intent.exportUse,
        kind: 'light_composer',
        materialSpecs: [
          promotionalMaterialSpec('xiaohongshu_cover'),
          promotionalMaterialSpec('douyin_cover'),
        ],
        receiptCommand: 'export_work',
        sourcePackageId: input.contentPackage.id,
        ...(input.contentPackage.source.workId
          ? { sourceWorkId: input.contentPackage.source.workId }
          : {}),
        sourceVersionId: input.sourceVersionId,
        templateRole: input.intent.exportUse,
      });
    case 'appointment_card':
      return quickEditExportUseDeliverySchema.parse({
        exportUse: input.intent.exportUse,
        kind: 'light_composer',
        materialSpecs: [promotionalMaterialSpec('wechat_moments_poster')],
        receiptCommand: 'export_work',
        sourcePackageId: input.contentPackage.id,
        ...(input.contentPackage.source.workId
          ? { sourceWorkId: input.contentPackage.source.workId }
          : {}),
        sourceVersionId: input.sourceVersionId,
        templateRole: input.intent.exportUse,
      });
  }
}

export function editContentPackageLifecycleVersion(input: {
  baseVersionId: string;
  changes: VersionChanges;
  intent?: QuickEditIntent;
  contentPackage: ContentPackage;
  target: VersionTarget;
  timestamp: string;
  userId: string;
}) {
  const { contentPackage, target } = input;
  const variantIndex =
    target.kind === 'variant'
      ? contentPackage.variants.findIndex(
          (candidate) => candidate.platform === target.platform
        )
      : -1;
  const variant = contentPackage.variants[variantIndex];
  if (target.kind === 'variant' && !variant) {
    throw new ContentPackageLifecycleError(
      'CONTENT_PACKAGE_VARIANT_NOT_FOUND',
      'The platform variant was not found.',
      404
    );
  }

  const currentVersionId =
    target.kind === 'variant'
      ? variant!.currentVersionId
      : contentPackage.currentVersionId;
  if (currentVersionId !== input.baseVersionId) {
    throw new ContentPackageLifecycleError(
      'CONTENT_PACKAGE_VERSION_CONFLICT',
      target.kind === 'variant'
        ? 'The platform variant changed before this edit was saved.'
        : 'The ContentPackage version changed before this edit was saved.',
      409
    );
  }

  if (input.intent) {
    const expectedFactRefs = contentPackage.marketing?.factRefs ?? [];
    const expectedRightsRefs = contentPackage.marketing?.rightsRefs ?? [];
    if (
      input.intent.baseVersionId !== input.baseVersionId ||
      !sameSet(input.intent.preservedFactRefs, expectedFactRefs) ||
      !sameSet(input.intent.preservedRightsRefs, expectedRightsRefs)
    ) {
      throw new ContentPackageLifecycleError(
        'CONTENT_PACKAGE_CONTEXT_REFS_CHANGED',
        'Quick edits must preserve the frozen fact and rights references.',
        409
      );
    }
  }

  if (target.kind === 'package') {
    const baseVersion = contentPackage.versions.find(
      (version) => version.id === input.baseVersionId
    );
    if (
      baseVersion?.sourceRef &&
      contentPackageVersionSourceRefIsReadOnly(baseVersion.sourceRef)
    ) {
      throw new ContentPackageLifecycleError(
        'CONTENT_PACKAGE_SOURCE_REF_READ_ONLY',
        'This ContentPackage version uses a newer source schema and is read-only.',
        409
      );
    }
  }

  if (!EDITABLE_STATUSES.has(contentPackage.status)) {
    throw new ContentPackageLifecycleError(
      'CONTENT_PACKAGE_TRANSITION_CONFLICT',
      target.kind === 'variant'
        ? 'This ContentPackage cannot be edited in its current state.'
        : 'Only a review-ready or usable ContentPackage can be edited.',
      409
    );
  }

  const ownedAssetIds = editableAssetIds(contentPackage, target);
  if (input.changes.orderedAssetIds.some((id) => !ownedAssetIds.has(id))) {
    throw new ContentPackageLifecycleError(
      'INVALID_CONTENT_PACKAGE_ASSET',
      target.kind === 'variant'
        ? 'An edited variant can reference only owned package Assets.'
        : 'An edited ContentPackage can reference only owned package Assets.',
      409
    );
  }

  const ownerId = target.kind === 'variant' ? variant!.id : contentPackage.id;
  const versionId = editedVersionId(
    ownerId,
    input.baseVersionId,
    input.changes,
    input.intent,
  );
  const delivery = exportUseDelivery({
    changes: input.changes,
    contentPackage,
    sourceVersionId: versionId,
    ...(input.intent ? { intent: input.intent } : {}),
  });
  const version: ContentPackageVersion = {
    ...input.changes,
    createdAt: input.timestamp,
    createdBy: input.userId,
    derivedFromVersionId: input.baseVersionId,
    ...(input.intent ? { editIntent: input.intent } : {}),
    ...(delivery ? { exportUseDelivery: delivery } : {}),
    id: versionId,
    source: 'merchant_edited',
  };
  const updated =
    target.kind === 'variant'
      ? {
          ...contentPackage,
          updatedAt: input.timestamp,
          variants: contentPackage.variants.map((candidate, index) =>
            index === variantIndex
              ? {
                  ...candidate,
                  currentVersionId: versionId,
                  versions: [...candidate.versions, version],
                }
              : candidate
          ),
        }
      : {
          ...contentPackage,
          currentVersionId: versionId,
          updatedAt: input.timestamp,
          versions: [...contentPackage.versions, version],
        };

  return {
    contentPackage: contentPackageSchema.parse(updated),
    versionId,
  };
}

function sameSet(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    [...new Set(left)].sort().join('\u0000') ===
      [...new Set(right)].sort().join('\u0000')
  );
}

export function rollbackContentPackageLifecycleVersion(input: {
  contentPackage: ContentPackage;
  targetVersionId: string;
  timestamp: string;
  userId: string;
}) {
  const { contentPackage } = input;
  if (contentPackage.status === 'cancelled') {
    throw new ContentPackageLifecycleError(
      'CONTENT_PACKAGE_TRANSITION_CONFLICT',
      'A cancelled ContentPackage cannot be rolled back.',
      409
    );
  }

  const targetPackageVersion = contentPackage.versions.find(
    (version) => version.id === input.targetVersionId
  );
  const variantIndex = contentPackage.variants.findIndex((variant) =>
    variant.versions.some((version) => version.id === input.targetVersionId)
  );
  const variant = contentPackage.variants[variantIndex];
  const targetVariantVersion = variant?.versions.find(
    (version) => version.id === input.targetVersionId
  );
  if (!targetPackageVersion && !targetVariantVersion) {
    throw new ContentPackageLifecycleError(
      'CONTENT_PACKAGE_VERSION_NOT_FOUND',
      'The target ContentPackage version was not found.',
      404
    );
  }

  if (
    contentPackage.currentVersionId === input.targetVersionId ||
    variant?.currentVersionId === input.targetVersionId
  ) {
    return { contentPackage, versionId: input.targetVersionId };
  }

  const target = targetPackageVersion ?? targetVariantVersion!;
  const ownerId = variant?.id ?? contentPackage.id;
  const versionId = `${ownerId}-rollback-${createHash('sha256')
    .update(
      `${input.targetVersionId}:${
        variant?.currentVersionId ?? contentPackage.currentVersionId
      }`
    )
    .digest('hex')
    .slice(0, 16)}`;
  const restored: ContentPackageVersion = {
    body: target.body,
    ...(target.conversionHook
      ? { conversionHook: target.conversionHook }
      : {}),
    createdAt: input.timestamp,
    createdBy: input.userId,
    derivedFromVersionId: input.targetVersionId,
    id: versionId,
    orderedAssetIds: [...target.orderedAssetIds],
    revertedFromVersionId: input.targetVersionId,
    source: 'rollback_restored',
    title: target.title,
    topics: [...target.topics],
  };
  const updated = variant
    ? {
        ...contentPackage,
        updatedAt: input.timestamp,
        variants: contentPackage.variants.map((candidate, index) =>
          index === variantIndex
            ? {
                ...candidate,
                currentVersionId: versionId,
                versions: [...candidate.versions, restored],
              }
            : candidate
        ),
      }
    : {
        ...contentPackage,
        currentVersionId: versionId,
        updatedAt: input.timestamp,
        versions: [...contentPackage.versions, restored],
      };

  return {
    contentPackage: contentPackageSchema.parse(updated),
    versionId,
  };
}
