/**
 * Full package plan producer (W09 / S5).
 *
 * `delivery-full-package.ts` has built manifest-shaped plans since D-096, and
 * `DeliveryPanelFacts.fullPackagePlan` has accepted one since WT-D — but no
 * browser ever built one, so the field was permanently null and the panel had
 * nothing to state before the download. This module is the missing producer:
 * it reads the canonical ContentPackage and returns the plan for the modality
 * the delivery target actually is.
 *
 * Pure. It describes the layout core will emit; it never fabricates bytes.
 */

import type { PublicContentPackage } from '@meiye/contracts';

import type {
  DeliveryPanelTarget,
  DeliveryZipPlatform,
} from './delivery-b3-types';
import {
  buildDouyinVideoPackage,
  buildWechatMomentsSegmentsPackage,
  buildXiaohongshuImageTextPackage,
  type FullPackagePlan,
} from './delivery-full-package';
import {
  type DeliveryPackageCaption,
} from '@meiye/contracts';
import type { SharePayload } from './delivery-share-degrade';

type OwnedAsset = NonNullable<
  PublicContentPackage['generated']['ownedAssets']
>[number];

const IMAGE_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function isImage(asset: OwnedAsset) {
  return asset.contentType.startsWith('image/');
}

function isVideo(asset: OwnedAsset) {
  return asset.contentType === 'video/mp4';
}

function imageEntries(assets: readonly OwnedAsset[]) {
  return assets.filter(isImage).map((asset, index) => ({
    mimeType: asset.contentType,
    path: `images/${String(index + 1).padStart(2, '0')}.${
      IMAGE_EXTENSION[asset.contentType] ?? 'jpg'
    }`,
    ...(asset.sizeBytes !== undefined ? { sizeBytes: asset.sizeBytes } : {}),
  }));
}

type PackageVersion = PublicContentPackage['versions'][number];

function versionOf(
  contentPackage: PublicContentPackage,
  versionId: string
): PackageVersion | undefined {
  return (
    contentPackage.versions.find((candidate) => candidate.id === versionId) ??
    contentPackage.variants
      .flatMap((variant) => variant.versions)
      .find((candidate) => candidate.id === versionId)
  );
}

function captionOf(version: PackageVersion): DeliveryPackageCaption {
  return {
    body: version.body,
    title: version.title,
    topics: [...version.topics],
    ...(version.conversionHook
      ? { conversionHook: version.conversionHook }
      : {}),
  };
}

/**
 * The assets this exact version delivers, in the order it delivers them.
 *
 * `generated.ownedAssets` is the package's whole asset history — every image a
 * superseded draft or another platform's variant ever owned. Reading it whole
 * put material into the manifest (and into the share payload) that the merchant
 * had already dropped. `orderedAssetIds` is the version's own selection, and it
 * is the exact list core's export adapter walks
 * (apps/core/.../content-package-export-adapter.ts), so a plan built from it
 * describes the ZIP core will actually emit.
 */
function versionAssets(
  contentPackage: PublicContentPackage,
  version: PackageVersion
): OwnedAsset[] {
  const owned = new Map(
    (contentPackage.generated.ownedAssets ?? []).map((asset) => [
      asset.id,
      asset,
    ])
  );
  return version.orderedAssetIds.flatMap((assetId) => {
    const asset = owned.get(assetId);
    return asset ? [asset] : [];
  });
}

/**
 * Build the plan for this package on this target, or undefined when the
 * package cannot back one (no current version, or a copy-only package on a ZIP
 * platform — those deliver through the core copy package, not a media ZIP).
 */
export function buildResultFullPackagePlan(input: {
  contentPackage: PublicContentPackage;
  nowIso: string;
  storeName: string;
  target: DeliveryPanelTarget;
  variantVersionId?: string;
}): FullPackagePlan | undefined {
  const variantVersionId =
    input.variantVersionId ?? input.contentPackage.currentVersionId;
  if (!variantVersionId) return undefined;
  const version = versionOf(input.contentPackage, variantVersionId);
  if (!version) return undefined;
  const caption = captionOf(version);
  const assets = versionAssets(input.contentPackage, version);
  const images = imageEntries(assets);
  const video = assets.find(isVideo);
  const base = {
    caption,
    contentPackageRevision: input.contentPackage.revision,
    generatedAt: input.nowIso,
    packageId: input.contentPackage.id,
    storeName: input.storeName,
    variantVersionId,
  };
  const compliance = {
    aigcLabelEnabled: Boolean(input.contentPackage.compliance.aigcLabelEnabled),
    watermarkEnabled: Boolean(input.contentPackage.compliance.watermarkEnabled),
  };
  const rightsState = input.contentPackage.rights.state;

  if (input.target === 'wechat_moments') {
    return buildWechatMomentsSegmentsPackage({ ...base, media: images });
  }

  // The remaining targets are exactly the ZIP platforms. Carrying the real one
  // through is what stops a 视频号 package from being named and manifested as a
  // 抖音 one — same layout, different platform, and the merchant reads the name.
  const platform: DeliveryZipPlatform = input.target;

  if (video) {
    return buildDouyinVideoPackage({
      ...base,
      compliance,
      hasCover: images.length > 0,
      hasSubtitles: false,
      platform,
      rightsState,
      ...(video.sizeBytes !== undefined
        ? { videoSizeBytes: video.sizeBytes }
        : {}),
    });
  }

  if (images.length === 0) return undefined;

  return buildXiaohongshuImageTextPackage({
    ...base,
    compliance,
    images,
    platform,
    rightsState,
  });
}

/**
 * The `files` array `navigator.canShare({ files })` is probed against, and the
 * one the share payload was never given: `kind:'files'` was declared with no
 * files at all, so every capability decision downstream read an empty payload.
 */
export function sharePayloadFilesFromPlan(
  plan: FullPackagePlan | undefined
): SharePayload['files'] {
  if (!plan) return undefined;
  const name = plan.zipFileName;
  if (name) {
    return [
      {
        mimeType: 'application/zip',
        name,
        sizeBytes: plan.files.reduce(
          (total, file) => total + (file.sizeBytes ?? 0),
          0
        ),
      },
    ];
  }
  return plan.files
    .filter((file) => file.sizeBytes !== undefined)
    .map((file) => ({
      mimeType: file.mimeType,
      name: file.path,
      sizeBytes: file.sizeBytes!,
    }));
}

/**
 * D-086: file-share capability is a probe, not an API check. `navigator.share`
 * existing says nothing about whether *these* files may be shared, and the
 * panel used to promise a file share that the device would refuse.
 */
export function probeCanShareFiles(
  files: SharePayload['files'],
  navigatorLike: Pick<Navigator, 'canShare'> | undefined = globalThis.navigator
): boolean {
  if (!navigatorLike || typeof navigatorLike.canShare !== 'function') {
    return false;
  }
  if (!files || files.length === 0) return false;
  try {
    return navigatorLike.canShare({
      files: files.map(
        (file) =>
          new File([new Uint8Array(0)], file.name, { type: file.mimeType })
      ),
    });
  } catch {
    return false;
  }
}
