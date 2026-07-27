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

import type { DeliveryPanelTarget } from './delivery-b3-types';
import {
  buildDouyinVideoPackage,
  buildWechatMomentsSegmentsPackage,
  buildXiaohongshuImageTextPackage,
  type DeliveryPackageCaption,
  type FullPackagePlan,
} from './delivery-full-package';
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

function captionOf(
  contentPackage: PublicContentPackage
): DeliveryPackageCaption | undefined {
  const version = contentPackage.versions.find(
    (candidate) => candidate.id === contentPackage.currentVersionId
  );
  if (!version) return undefined;
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
  const caption = captionOf(input.contentPackage);
  if (!caption) return undefined;
  const variantVersionId =
    input.variantVersionId ?? input.contentPackage.currentVersionId;
  if (!variantVersionId) return undefined;
  const assets = input.contentPackage.generated.ownedAssets ?? [];
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

  if (video) {
    return buildDouyinVideoPackage({
      ...base,
      compliance,
      hasCover: images.length > 0,
      hasSubtitles: false,
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
