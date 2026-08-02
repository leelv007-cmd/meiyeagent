import type {
  ContentPackagePlatform,
  ContentPackageVersion,
  PublicContentPackage,
} from '@meiye/contracts';

import type { DeliveryPanelTarget } from './delivery-b3-types';
import { resolveCanonicalDeliveryPlatform } from './delivery-viewport';
import {
  findResultContentPackageHandEditVersion,
  resolveResultContentPackageHandEditPlatform,
} from './result-content-package-hand-edit';

type PublicOwnedAsset = NonNullable<
  PublicContentPackage['generated']['ownedAssets']
>[number];

export type ResultDeliveryBinding = {
  allowExplicitPublicationVariantSelection: boolean;
  canonicalPlatform: ContentPackagePlatform | null;
  currentVersion: ContentPackageVersion | undefined;
  orderedOwnedAssets: PublicOwnedAsset[];
  panelTarget: DeliveryPanelTarget | null;
  scopePlatform: ContentPackagePlatform | undefined;
  variant: PublicContentPackage['variants'][number] | undefined;
};

/**
 * Resolve every Result delivery surface from one durable package binding.
 * Platform fallback is legacy-only; Moments may remain a distribution target
 * while modern packages stay bound to their unscoped canonical version.
 */
export function resolveResultDeliveryBinding(
  contentPackage: PublicContentPackage | undefined,
  inferredTarget: DeliveryPanelTarget
): ResultDeliveryBinding {
  const canonicalPlatform = resolveCanonicalDeliveryPlatform(
    contentPackage,
    inferredTarget
  );
  const durablePlatform = contentPackage?.source.targetPlatform;
  const scopePlatform = contentPackage
    ? (durablePlatform ??
      resolveResultContentPackageHandEditPlatform(
        contentPackage,
        canonicalPlatform
      ))
    : undefined;
  const variant = scopePlatform
    ? contentPackage?.variants.find(
        (candidate) => candidate.platform === scopePlatform
      )
    : undefined;
  const currentVersion = contentPackage
    ? findResultContentPackageHandEditVersion(contentPackage, scopePlatform)
    : undefined;
  const ownedById = new Map(
    (contentPackage?.generated.ownedAssets ?? []).map((asset) => [
      asset.id,
      asset,
    ])
  );
  const orderedOwnedAssets =
    currentVersion?.orderedAssetIds.flatMap((assetId) => {
      const asset = ownedById.get(assetId);
      return asset ? [asset] : [];
    }) ?? [];
  const mayUseIntentFallback = !contentPackage || contentPackage.legacySource;
  const frozenDestination = contentPackage?.source.creationExecutionSnapshot;
  const mayUseModernMomentsPanel = Boolean(
    contentPackage &&
      !durablePlatform &&
      !contentPackage.legacySource &&
      frozenDestination?.contentPackagePlatform === 'wechat_moments' &&
      frozenDestination.distributionTarget
  );
  const deliveryVersionUnavailable = Boolean(contentPackage && !currentVersion);
  const panelTarget = deliveryVersionUnavailable
    ? null
    : (canonicalPlatform ??
      (mayUseIntentFallback
        ? inferredTarget
        : mayUseModernMomentsPanel
          ? 'wechat_moments'
          : null));

  return {
    allowExplicitPublicationVariantSelection: Boolean(
      mayUseModernMomentsPanel && panelTarget === 'wechat_moments'
    ),
    canonicalPlatform,
    currentVersion,
    orderedOwnedAssets,
    panelTarget,
    scopePlatform,
    variant,
  };
}
