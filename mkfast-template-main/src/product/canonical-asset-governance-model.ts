/**
 * OwnedAsset governance projection (P1-C2 / #155).
 *
 * Merchant-facing rules for usable library membership, Chinese business titles,
 * structured filters, lineage summaries, revoke impact, and metadata-only bulk
 * tags. Never copies binary object facts.
 */

import {
  hasCurrentRestrictedAssetAuthorization,
  type Asset,
  type ContentPackage,
  type Platform,
} from '@meiye/contracts';

export type AssetLibraryAvailability =
  | 'usable'
  | 'processing'
  | 'failed'
  | 'temporary'
  | 'rights_blocked';

export type AssetLibraryFilter = {
  availability?: AssetLibraryAvailability;
  category?: Asset['category'];
  ip?: string;
  mediaType?: Asset['mediaType'];
  platform?: Platform;
  project?: string;
  query?: string;
  rightsStatus?: Asset['authorizationStatus'] | 'expired';
  sourceType?: Asset['sourceType'];
  tag?: string;
  workspaceId?: string;
};

export type AssetLineageOrigin =
  | 'upload'
  | 'generation'
  | 'adoption'
  | 'pro_studio'
  | 'legacy';

export type AssetGovernanceCard = {
  availability: AssetLibraryAvailability;
  businessTitle: string;
  category?: Asset['category'];
  id: string;
  lineageOrigin: AssetLineageOrigin;
  mediaType: Asset['mediaType'];
  objectKey?: string;
  parentAssetId?: string;
  platforms: Platform[];
  projectLabels: string[];
  ipLabels: string[];
  replacementRequired: boolean;
  rightsStatus: Asset['authorizationStatus'] | 'expired';
  sourceType: Asset['sourceType'];
  tags: string[];
  validUntil?: string;
  workspaceId?: string;
};

export type AssetReplacementImpact = {
  affectedPackageCount: number;
  affectedPackageIds: string[];
  blocksDelivery: boolean;
  blocksGeneration: boolean;
  pendingReplacement: boolean;
};

export function isContentPackageEligibleAsset(asset: Asset, at = new Date()) {
  return (
    asset.sourceType === 'real' &&
    asset.authorizationStatus === 'authorized' &&
    asset.consentScope !== 'internal_only' &&
    Boolean(asset.rightsEvidence?.trim()) &&
    hasCurrentRestrictedAssetAuthorization(asset, at)
  );
}

export function assetAuthorizationPresentation(
  asset: Asset,
  at = new Date()
): {
  action: 'authorize' | 'update_evidence' | 'none';
  status: Asset['authorizationStatus'];
} {
  const evidenceRequired = asset.sourceType === 'real';
  const evidenceRecorded = Boolean(asset.rightsEvidence?.trim());
  const publiclyUsable =
    asset.authorizationStatus === 'authorized' &&
    asset.consentScope !== 'internal_only' &&
    (!evidenceRequired || evidenceRecorded) &&
    hasCurrentRestrictedAssetAuthorization(asset, at);

  if (asset.authorizationStatus === 'blocked') {
    return { action: 'none', status: 'blocked' };
  }
  if (asset.authorizationStatus === 'withdrawn') {
    return { action: 'none', status: 'withdrawn' };
  }
  if (publiclyUsable) {
    return {
      action: asset.sourceType === 'real' ? 'update_evidence' : 'none',
      status: 'authorized',
    };
  }
  return { action: 'authorize', status: 'pending' };
}

/**
 * Durable receipt proxy for the merchant library: a non-empty objectKey means
 * the binary is registered. Temporary preview URLs and empty keys stay out.
 */
export function hasDurableAssetReceipt(
  asset: Pick<Asset, 'objectKey'> & { temporaryUrl?: string }
) {
  const key = asset.objectKey?.trim() ?? '';
  if (!key) return false;
  if (key.startsWith('http://') || key.startsWith('https://')) return false;
  if (asset.temporaryUrl) return false;
  return true;
}

export function assetLibraryAvailability(
  asset: Asset & {
    processingStatus?: 'ready' | 'processing' | 'failed';
    temporaryUrl?: string;
  },
  at = new Date()
): AssetLibraryAvailability {
  if (asset.processingStatus === 'processing') return 'processing';
  if (asset.processingStatus === 'failed') return 'failed';
  if (!hasDurableAssetReceipt(asset)) return 'temporary';
  if (
    asset.authorizationStatus === 'withdrawn' ||
    asset.authorizationStatus === 'blocked' ||
    asset.replacementRequired ||
    !hasCurrentRestrictedAssetAuthorization(asset, at)
  ) {
    return 'rights_blocked';
  }
  return 'usable';
}

/** Only durable, non-failed assets enter the usable library surface. */
export function isUsableLibraryAsset(
  asset: Asset & {
    processingStatus?: 'ready' | 'processing' | 'failed';
    temporaryUrl?: string;
  },
  at = new Date()
) {
  return assetLibraryAvailability(asset, at) === 'usable';
}

const INTERNAL_ENGLISH_TITLE =
  /^(asset|image|video|audio|generated|candidate|output|tmp|temp|untitled)[-_\s]?/i;

/**
 * Merchant business title when a user/governance title exists.
 * Returns undefined when only internal English candidate names remain so the
 * caller can fall back to localized untitled labels.
 */
export function assetBusinessTitle(
  asset: Pick<Asset, 'tags' | 'category' | 'mediaType' | 'rightsOwner'> & {
    displayTitle?: string;
    title?: string;
  }
): string | undefined {
  const candidates = [asset.displayTitle, asset.title, ...asset.tags].filter(
    (value): value is string => Boolean(value?.trim())
  );

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (INTERNAL_ENGLISH_TITLE.test(trimmed)) continue;
    // Reject opaque machine ids / slug-like internal names without CJK.
    if (/^[a-z0-9._:-]+$/i.test(trimmed) && !/[\u3400-\u9fff]/.test(trimmed)) {
      continue;
    }
    return trimmed;
  }
  return undefined;
}

/** Localized-friendly fallback label key parts for missing business titles. */
export function assetBusinessTitleFallback(
  asset: Pick<Asset, 'category' | 'mediaType' | 'rightsOwner'>
): string {
  const categoryLabel =
    asset.category === 'store'
      ? '门店素材'
      : asset.category === 'before_after'
        ? '前后对比'
        : asset.category === 'customer_case'
          ? '顾客案例'
          : asset.category === 'price_list'
            ? '价目表'
            : asset.mediaType === 'video'
              ? '视频素材'
              : asset.mediaType === 'audio'
                ? '音频素材'
                : '图片素材';
  if (asset.rightsOwner?.trim()) {
    return `${asset.rightsOwner.trim()} · ${categoryLabel}`;
  }
  return categoryLabel;
}

export function resolveAssetBusinessTitle(
  asset: Pick<Asset, 'tags' | 'category' | 'mediaType' | 'rightsOwner'> & {
    displayTitle?: string;
    title?: string;
  }
): string {
  return assetBusinessTitle(asset) ?? assetBusinessTitleFallback(asset);
}

export function assetLineageOrigin(
  asset: Asset & {
    originRef?: {
      kind?: string;
    };
    parentAssetId?: string;
  }
): AssetLineageOrigin {
  const kind = asset.originRef?.kind ?? '';
  if (
    kind === 'advanced_canvas_project_revision' ||
    kind.includes('canvas') ||
    kind.includes('pro_studio')
  ) {
    return 'pro_studio';
  }
  if (kind === 'legacy_import' || kind.includes('legacy')) return 'legacy';
  if (kind === 'marketing_creation_snapshot' || kind.includes('adoption')) {
    return 'adoption';
  }
  if (asset.sourceType === 'ai_generated') return 'generation';
  return 'upload';
}

export function projectAssetGovernanceCard(
  asset: Asset & {
    displayTitle?: string;
    originRef?: { kind?: string };
    parentAssetId?: string;
    processingStatus?: 'ready' | 'processing' | 'failed';
    projectLabels?: string[];
    ipLabels?: string[];
    temporaryUrl?: string;
    title?: string;
    workspaceId?: string;
  },
  at = new Date()
): AssetGovernanceCard {
  const expired =
    asset.authorizationStatus === 'authorized' &&
    !hasCurrentRestrictedAssetAuthorization(asset, at);
  return {
    availability: assetLibraryAvailability(asset, at),
    businessTitle: resolveAssetBusinessTitle(asset),
    category: asset.category,
    id: asset.id,
    lineageOrigin: assetLineageOrigin(asset),
    mediaType: asset.mediaType,
    ...(hasDurableAssetReceipt(asset) ? { objectKey: asset.objectKey } : {}),
    ...(asset.parentAssetId ? { parentAssetId: asset.parentAssetId } : {}),
    platforms: asset.rightsPlatforms ?? [],
    projectLabels: asset.projectLabels ?? [],
    ipLabels: asset.ipLabels ?? [],
    replacementRequired: asset.replacementRequired,
    rightsStatus: expired ? 'expired' : asset.authorizationStatus,
    sourceType: asset.sourceType,
    tags: [...asset.tags],
    ...(asset.rightsValidUntil ? { validUntil: asset.rightsValidUntil } : {}),
    ...(asset.workspaceId ? { workspaceId: asset.workspaceId } : {}),
  };
}

export function filterAssetLibrary(
  cards: readonly AssetGovernanceCard[],
  filter: AssetLibraryFilter = {},
  at = new Date()
): AssetGovernanceCard[] {
  void at;
  const query = filter.query?.trim().toLocaleLowerCase() ?? '';
  return cards.filter((card) => {
    if (filter.workspaceId && card.workspaceId !== filter.workspaceId) {
      return false;
    }
    if (filter.mediaType && card.mediaType !== filter.mediaType) return false;
    if (filter.sourceType && card.sourceType !== filter.sourceType)
      return false;
    if (filter.category && card.category !== filter.category) return false;
    if (filter.availability && card.availability !== filter.availability) {
      return false;
    }
    if (filter.rightsStatus && card.rightsStatus !== filter.rightsStatus) {
      return false;
    }
    if (filter.platform && !card.platforms.includes(filter.platform)) {
      return false;
    }
    if (filter.tag) {
      const needle = filter.tag.trim().toLocaleLowerCase();
      if (!card.tags.some((tag) => tag.toLocaleLowerCase().includes(needle))) {
        return false;
      }
    }
    if (filter.project) {
      const needle = filter.project.trim().toLocaleLowerCase();
      if (
        !card.projectLabels.some((label) =>
          label.toLocaleLowerCase().includes(needle)
        )
      ) {
        return false;
      }
    }
    if (filter.ip) {
      const needle = filter.ip.trim().toLocaleLowerCase();
      if (
        !card.ipLabels.some((label) =>
          label.toLocaleLowerCase().includes(needle)
        )
      ) {
        return false;
      }
    }
    if (query) {
      const haystack = [
        card.businessTitle,
        ...card.tags,
        ...card.projectLabels,
        ...card.ipLabels,
        card.mediaType,
        card.sourceType,
        card.rightsStatus,
      ]
        .join(' ')
        .toLocaleLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

/**
 * Rights revoke/expiry impact: blocks new generation & delivery, builds the
 * pending-replacement list from ContentPackage references. Historical package
 * ids stay listed for audit; binaries are not rewritten.
 */
export function assetReplacementImpact(
  assetId: string,
  contentPackages: readonly Pick<
    ContentPackage,
    'id' | 'status' | 'source' | 'generated' | 'versions' | 'rights'
  >[],
  asset?: Pick<Asset, 'replacementRequired' | 'authorizationStatus'>
): AssetReplacementImpact {
  const affectedPackageIds = contentPackages
    .filter((contentPackage) => {
      const versionAssets = contentPackage.versions.flatMap(
        (version) => version.orderedAssetIds
      );
      const sourceAssets = contentPackage.source.assetIds ?? [];
      const generatedAssets = contentPackage.generated.assetIds ?? [];
      return [...versionAssets, ...sourceAssets, ...generatedAssets].includes(
        assetId
      );
    })
    .map((contentPackage) => contentPackage.id);

  const rightsBlocked =
    asset?.authorizationStatus === 'withdrawn' ||
    asset?.authorizationStatus === 'blocked' ||
    asset?.replacementRequired === true ||
    contentPackages.some(
      (contentPackage) =>
        affectedPackageIds.includes(contentPackage.id) &&
        (contentPackage.status === 'needs_replacement' ||
          contentPackage.rights.state === 'revoked')
    );

  return {
    affectedPackageCount: affectedPackageIds.length,
    affectedPackageIds,
    blocksDelivery: rightsBlocked,
    blocksGeneration: rightsBlocked,
    pendingReplacement: rightsBlocked && affectedPackageIds.length > 0,
  };
}

/**
 * Safe replacement projection: new package revision target, historical asset
 * and receipts remain untouched (ids returned for audit continuity).
 */
export function safeAssetReplacementPlan(input: {
  assetId: string;
  contentPackageId: string;
  currentRevision: number;
  historicalReceiptIds?: string[];
}) {
  return {
    historicalAssetId: input.assetId,
    historicalReceiptIds: input.historicalReceiptIds ?? [],
    newPackageRevision: input.currentRevision + 1,
    packageId: input.contentPackageId,
    rewritesHistory: false,
  };
}

/**
 * Bulk tag merge is metadata-only: objectKey/hash unchanged, no binary copy.
 */
export function applyBulkAssetTags(
  assets: readonly Asset[],
  assetIds: readonly string[],
  tagsToAdd: readonly string[]
): Asset[] {
  const idSet = new Set(assetIds);
  const normalized = [
    ...new Set(tagsToAdd.map((tag) => tag.trim()).filter(Boolean)),
  ];
  return assets.map((asset) => {
    if (!idSet.has(asset.id)) return asset;
    return {
      ...asset,
      tags: [...new Set([...asset.tags, ...normalized])],
    };
  });
}

export function assetGovernanceMetadataVersion(input: {
  previousVersion: number;
  folder?: string;
  tags: readonly string[];
  projectLabels?: readonly string[];
  ipLabels?: readonly string[];
  displayTitle?: string;
}) {
  return {
    version: input.previousVersion + 1,
    folder: input.folder,
    tags: [...input.tags],
    projectLabels: [...(input.projectLabels ?? [])],
    ipLabels: [...(input.ipLabels ?? [])],
    displayTitle: input.displayTitle,
    copiesObject: false,
  };
}
