import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import sharp from 'sharp';
import {
  contentPackageCarrierOf,
  type VideoCompositionEvidence,
} from '@meiye/contracts';
import type {
  CustodyOwnedAssetContentType,
  ModelAssetStoragePort,
  OwnedAsset,
} from '../model-supply/index.js';
import {
  ownedAssetRegistrationLifecycle,
  type OwnedAssetRegistrationLifecyclePort,
} from '../model-supply/owned-asset-registration-lifecycle.js';
import type { ReferenceAssetResolverPort } from '../model-supply/reference-asset-resolver.js';
import {
  buildCopyDeliveryPackage,
  buildImageTextDeliveryPackage,
  buildVideoFullDeliveryPackage,
} from '../result-delivery/delivery-package.js';
import type { ContentPackageExportPort } from './types.js';
import type { OperationsRepository } from './repository.js';

const CJK_FONT_CANDIDATES = [
  { family: 'PingFang SC', path: '/System/Library/Fonts/PingFang.ttc' },
  { family: 'Heiti SC', path: '/System/Library/Fonts/STHeiti Medium.ttc' },
  {
    family: 'Noto Sans CJK SC',
    path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  },
  {
    family: 'Noto Sans CJK SC',
    path: '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
  },
  {
    family: 'WenQuanYi Zen Hei',
    path: '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
  },
];

type ContentPackageExportAsset = Omit<OwnedAsset, 'contentType' | 'objectKey'> & {
  contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4';
  objectKey?: string;
};

export interface ContentPackageExportAssetReader {
  readOwnedAsset(input: {
    assetId: string;
    workspaceId: string;
  }): Promise<{ asset: ContentPackageExportAsset; bytes: Uint8Array }>;
}

export interface ContentPackageZipExportOptions {
  /** Runtime boundary required in addition to the explicit fixture override. */
  appEnv?: string;
  /** Synthetic composition evidence is accepted only by the explicit E2E runtime. */
  allowRecordedSyntheticVideoCompliance?: boolean;
  fontFilePath?: string;
  /** Store display name used in deterministic ZIP download names. */
  storeName?: string;
  /** ContentPackage revision frozen into the delivery manifest. */
  contentPackageRevision?: number;
  rightsState?: string;
  factSummary?: string;
}

export type ContentPackageVideoFullExportInput = Parameters<
  ContentPackageExportPort['export']
>[0] & {
  contentPackageRevision?: number;
  factSummary?: string;
  rightsState?: string;
  storeName?: string;
};

export type ContentPackageExportArtifactWithName = Awaited<
  ReturnType<ContentPackageExportPort['export']>
> & {
  fileName?: string;
};

export class UnverifiedVideoComplianceError extends Error {
  constructor() {
    super('Video compliance burn-in cannot be verified for this export.');
    this.name = 'UnverifiedVideoComplianceError';
  }
}

export class OperationsContentPackageExportAssetReader
  implements ContentPackageExportAssetReader
{
  constructor(
    private readonly repository: OperationsRepository,
    private readonly storage: {
      read(objectKey: string):
        | Uint8Array
        | undefined
          | {
            bytes: Uint8Array;
            contentType: CustodyOwnedAssetContentType;
          }
        | Promise<
            | Uint8Array
            | undefined
              | {
                bytes: Uint8Array;
                contentType: CustodyOwnedAssetContentType;
              }
          >;
    },
    private readonly productAssets?: Pick<ReferenceAssetResolverPort, 'resolve'>
  ) {}

  async readOwnedAsset(input: { assetId: string; workspaceId: string }) {
    const state = await this.repository.loadWorkspace(input.workspaceId);
    const stored = state?.contentPackages
      .flatMap((contentPackage) => contentPackage.generated.ownedAssets ?? [])
      .find((asset) => asset.id === input.assetId);
    if (!stored) {
      const [resolved] =
        (await this.productAssets?.resolve(input.workspaceId, [input.assetId])) ??
        [];
      if (
        !resolved ||
        resolved.kind !== 'resolved' ||
        resolved.assetId !== input.assetId ||
        !isExportMediaType(resolved.contentType)
      ) {
        throw new Error('The ContentPackage source asset was not found.');
      }
      return {
        asset: {
          contentType: resolved.contentType,
          id: resolved.assetId,
          sha256: resolved.sha256,
          sizeBytes: resolved.bytes.byteLength,
        },
        bytes: resolved.bytes,
      };
    }
    assertOwnedAssetObjectKey(
      input.workspaceId,
      stored.objectKey,
      stored.contentType
    );
    const result = await this.storage.read(stored.objectKey);
    if (!result) {
      throw new Error('The ContentPackage owned asset bytes were not found.');
    }
    const bytes = result instanceof Uint8Array ? result : result.bytes;
    const contentType =
      result instanceof Uint8Array ? stored.contentType : result.contentType;
    if (!isExportMediaType(contentType)) {
      throw new Error('A source ContentPackage asset cannot be an archive.');
    }
    if (
      contentType !== stored.contentType ||
      typeof stored.sizeBytes !== 'number' ||
      bytes.byteLength !== stored.sizeBytes ||
      createHash('sha256').update(bytes).digest('hex') !== stored.sha256
    ) {
      throw new Error(
        'The ContentPackage owned asset no longer matches its durable receipt.'
      );
    }
    return {
      asset: {
        ...(stored.compositionEvidence
          ? { compositionEvidence: structuredClone(stored.compositionEvidence) }
          : {}),
        contentType,
        id: stored.id,
        objectKey: stored.objectKey,
        sha256: stored.sha256,
        sizeBytes: stored.sizeBytes,
        ...(stored.sourceTaskRef
          ? { sourceTaskRef: stored.sourceTaskRef }
          : {}),
      },
      bytes,
    };
  }
}

/** Checks an already-committed ContentPackage delivery receipt before cleanup. */
export class ContentPackageArtifactReferenceVerifier {
  constructor(
    private readonly repository: Pick<OperationsRepository, 'loadWorkspace'>,
  ) {}

  async isReferenced(input: {
    assetId: string;
    receipt: { objectKey: string; sha256: string; sizeBytes: number };
    workspaceId: string;
  }) {
    const state = await this.repository.loadWorkspace(input.workspaceId);
    return Boolean(
      state?.contentPackages.some((contentPackage) =>
        contentPackage.exportReceipts.some(
          (receipt) =>
            receipt.artifactAssetId === input.assetId &&
            receipt.artifactObjectKey === input.receipt.objectKey &&
            receipt.sha256 === input.receipt.sha256 &&
            receipt.sizeBytes === input.receipt.sizeBytes,
        ),
      ),
    );
  }
}

export class ContentPackageZipExportAdapter
  implements ContentPackageExportPort, OwnedAssetRegistrationLifecyclePort
{
  constructor(
    private readonly storage: ModelAssetStoragePort,
    private readonly assets: ContentPackageExportAssetReader,
    private readonly options: ContentPackageZipExportOptions = {}
  ) {}

  async recordOwnedAssetRegistrationFailure(
    input: Parameters<
      OwnedAssetRegistrationLifecyclePort['recordOwnedAssetRegistrationFailure']
    >[0],
  ) {
    await ownedAssetRegistrationLifecycle(this.storage)
      ?.recordOwnedAssetRegistrationFailure(input);
  }

  async export(
    input: Parameters<ContentPackageExportPort['export']>[0],
  ): Promise<ContentPackageExportArtifactWithName> {
    // xhs-spec §3.1: dispatch on the media/copy/note carrier口径. The wire kind
    // stays two-valued; the carrier is derived (video ⇒ media, image_text
    // without ordered media ⇒ copy, otherwise ⇒ note).
    const carrier = contentPackageCarrierOf({
      kind: input.kind,
      orderedAssetCount: input.version.orderedAssetIds.length,
    });
    if (carrier === 'media') {
      // B-01: the media carrier's only wire kind today is `video`, whose main
      // export path is the full delivery ZIP (manifest/v1).
      return this.exportVideoFullPackage(input);
    }

    const images: {
      bytes: Uint8Array;
      mimeType: string;
      path: string;
    }[] = [];
    for (const [index, assetId] of input.version.orderedAssetIds.entries()) {
      const { asset, bytes } = await this.assets.readOwnedAsset({
        assetId,
        workspaceId: input.workspaceId,
      });
      if (!isExportImageType(asset.contentType)) {
        throw new Error(
          'Image-text exports require a supported image asset.',
        );
      }
      const extension = exportImageExtension(
        asset.contentType,
        input.compliance,
      );
      const prepared = await prepareExportImage(
        bytes,
        asset.contentType,
        input.compliance,
        this.options.fontFilePath,
      );
      const mimeType =
        extension === 'jpg'
          ? 'image/jpeg'
          : extension === 'webp'
            ? 'image/webp'
            : 'image/png';
      images.push({
        bytes: prepared,
        mimeType,
        path: `images/${String(index + 1).padStart(2, '0')}.${extension}`,
      });
    }

    const packageInput = {
      caption: {
        body: input.version.body,
        ...(input.version.conversionHook
          ? { conversionHook: input.version.conversionHook }
          : {}),
        title: input.version.title,
        topics: input.version.topics,
      },
      compliance: input.compliance,
      contentPackageRevision: resolveContentPackageRevision(input, this.options),
      factSummary: this.options.factSummary,
      generatedAt: input.version.createdAt,
      images,
      packageId: input.packageId,
      platform: input.platform,
      rightsBasis: input.rightsBasis,
      rightsState: this.options.rightsState,
      storeName: this.options.storeName ?? '门店',
      variantVersionId: input.version.id,
    };
    const built =
      carrier === 'copy'
        ? buildCopyDeliveryPackage(packageInput)
        : buildImageTextDeliveryPackage({ ...packageInput, images });

    const artifact = await this.storage.persistGeneratedAsset({
      bytes: built.zipBytes,
      contentType: 'application/zip',
      sourceTaskRef:
        `content-package-export:${input.packageId}:` +
        `${input.platform}:${input.version.id}`,
      workspaceId: input.workspaceId,
    });
    return {
      artifactAssetId: artifact.id,
      artifactObjectKey: artifact.objectKey,
      contentType: 'application/zip' as const,
      fileName: built.fileName,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes,
      ...(artifact.storageRevision
        ? { storageRevision: artifact.storageRevision }
        : {}),
    };
  }

  /**
   * Video full delivery package (B-01 / D-096):
   * video.mp4 + caption + checklist + manifest/v1.
   * V31-37 path A / V31-61: no subtitles or cover track — publishing
   * platforms own captions (#264). Primary video export path — returns
   * application/zip.
   */
  async exportVideoFullPackage(
    input: ContentPackageVideoFullExportInput,
  ): Promise<ContentPackageExportArtifactWithName> {
    if (input.kind !== 'video') {
      throw new Error('exportVideoFullPackage requires kind=video.');
    }
    const contentPackageRevision = resolveContentPackageRevision(
      input,
      this.options,
    );
    const videoAssetId = input.version.orderedAssetIds[0];
    if (!videoAssetId) {
      throw new Error('A video full package requires a video asset.');
    }
    const { asset: videoAsset, bytes: videoBytes } =
      await this.assets.readOwnedAsset({
        assetId: videoAssetId,
        workspaceId: input.workspaceId,
      });
    if (videoAsset.contentType !== 'video/mp4') {
      throw new Error('The selected video asset is not an MP4 file.');
    }
    const delivery = videoAsset.compositionEvidence?.delivery;
    const nativeSingleCall = isNativeSingleCallVideoExport(input, videoAsset);
    const allowRecordedSynthetic =
      this.options.allowRecordedSyntheticVideoCompliance === true &&
      this.options.appEnv === 'e2e';
    if (
      !nativeSingleCall &&
      (input.compliance.aigcLabelEnabled ||
        input.compliance.watermarkEnabled) &&
      !hasVerifiedVideoCompliance(
        videoAsset,
        input.compliance,
        allowRecordedSynthetic,
      )
    ) {
      throw new UnverifiedVideoComplianceError();
    }
    if (!nativeSingleCall) {
      if (
        !delivery ||
        delivery.outputVideoSha256 !== videoAsset.sha256 ||
        delivery.compositionRevision !==
          input.videoDeliveryCompositionRevision ||
        delivery.workflowId !== input.videoDeliveryWorkflowId ||
        delivery.storyboardRevision !== input.videoDeliveryRevision ||
        videoAsset.compositionEvidence?.durationSeconds !==
          input.videoDeliveryDurationSeconds ||
        // V31-37 path A / V31-61: canonical evidence never carries subtitle or
        // cover fields. Legacy records that still do cannot be verified under
        // the current contract — fail closed instead of reading them as empty.
        hasLegacySubtitleOrCoverFields(delivery)
      ) {
        throw new Error('Verified video delivery evidence is unavailable.');
      }
      if (
        !hasVerifiedVideoCompliance(
          videoAsset,
          input.compliance,
          allowRecordedSynthetic,
        )
      ) {
        throw new UnverifiedVideoComplianceError();
      }
    }

    const built = buildVideoFullDeliveryPackage({
      caption: {
        body: input.version.body,
        ...(input.version.conversionHook
          ? { conversionHook: input.version.conversionHook }
          : {}),
        title: input.version.title,
        topics: input.version.topics,
      },
      compliance: input.compliance,
      contentPackageRevision,
      factSummary: input.factSummary ?? this.options.factSummary,
      generatedAt: input.version.createdAt,
      packageId: input.packageId,
      platform: input.platform,
      rightsBasis: input.rightsBasis,
      rightsState: input.rightsState ?? this.options.rightsState,
      storeName: input.storeName ?? this.options.storeName ?? '门店',
      variantVersionId: input.version.id,
      video: { bytes: videoBytes },
    });

    const artifact = await this.storage.persistGeneratedAsset({
      bytes: built.zipBytes,
      contentType: 'application/zip',
      sourceTaskRef:
        `content-package-export-full:${input.packageId}:` +
        `${input.platform}:${input.version.id}`,
      workspaceId: input.workspaceId,
    });
    return {
      artifactAssetId: artifact.id,
      artifactObjectKey: artifact.objectKey,
      contentType: 'application/zip' as const,
      fileName: built.fileName,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes,
      ...(artifact.storageRevision
        ? { storageRevision: artifact.storageRevision }
        : {}),
    };
  }
}

/**
 * V31-37 path A / V31-61: canonical delivery evidence carries no subtitle or
 * cover fields. A legacy record that still carries them cannot be verified
 * under the current contract — reject rather than read them as empty.
 */
function hasLegacySubtitleOrCoverFields(
  delivery: NonNullable<VideoCompositionEvidence['delivery']>,
) {
  return 'subtitles' in delivery || 'cover' in delivery;
}

function isNativeSingleCallVideoExport(
  input: ContentPackageVideoFullExportInput,
  asset: ContentPackageExportAsset,
) {
  const sourceTaskRef = asset.sourceTaskRef?.trim();
  // Missing composition fields never opt an asset into this branch: a durable
  // provider task receipt is the positive native-generation marker.
  // Native provider videos rely on platform upload labeling, so their manifest
  // records compliance without requiring legacy composition burn-in evidence.
  return (
    Boolean(sourceTaskRef) &&
    !sourceTaskRef?.startsWith('recorded-composition:') &&
    asset.compositionEvidence === undefined &&
    input.videoDeliveryCompositionRevision === undefined &&
    input.videoDeliveryRevision === undefined
  );
}

function hasVerifiedVideoCompliance(
  asset: ContentPackageExportAsset,
  compliance: Parameters<ContentPackageExportPort['export']>[0]['compliance'],
  allowRecordedSynthetic: boolean,
) {
  const evidence = asset.compositionEvidence;
  if (
    !evidence ||
    evidence.outputSha256 !== asset.sha256 ||
    evidence.outputSizeBytes !== asset.sizeBytes
  ) {
    return false;
  }
  if (
    !allowRecordedSynthetic &&
    (evidence.aigc.validationMethod === 'recorded_synthetic' ||
      evidence.brandWatermark.validationMethod === 'recorded_synthetic')
  ) {
    return false;
  }
  if (!compliance.aigcLabelEnabled && !compliance.watermarkEnabled) return true;
  const aigcVerified =
    !compliance.aigcLabelEnabled ||
    (evidence.aigc.requested &&
      evidence.aigc.visibleLabel.actual &&
      evidence.aigc.visibleLabel.validated &&
      evidence.aigc.implicitMetadata.actual &&
      evidence.aigc.implicitMetadata.validated);
  const watermarkVerified =
    !compliance.watermarkEnabled ||
    (evidence.brandWatermark.requested &&
      evidence.brandWatermark.actual &&
      evidence.brandWatermark.validated &&
      typeof compliance.watermarkText === 'string' &&
      evidence.brandWatermark.text === compliance.watermarkText);
  return aigcVerified && watermarkVerified;
}

/**
 * B-02: fail-closed revision freeze for delivery manifests.
 * Prefer the per-call input revision, then adapter options; never default to 0.
 */
export function resolveContentPackageRevision(
  input: { contentPackageRevision?: number },
  options: ContentPackageZipExportOptions = {},
): number {
  const revision =
    input.contentPackageRevision ?? options.contentPackageRevision;
  if (typeof revision !== 'number' || !Number.isFinite(revision)) {
    throw new Error(
      'contentPackageRevision is required for ContentPackage export.',
    );
  }
  return revision;
}

function isExportMediaType(
  contentType: string
): contentType is ContentPackageExportAsset['contentType'] {
  return ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'].includes(
    contentType
  );
}

function assertOwnedAssetObjectKey(
  workspaceId: string,
  objectKey: string,
  contentType: string
) {
  const segments = objectKey.split('/');
  if (segments[0] !== workspaceId) {
    throw new Error(
      'The ContentPackage owned asset belongs to another workspace.'
    );
  }
  if (!isExportableOwnedAssetObjectKey(workspaceId, objectKey, contentType)) {
    throw new Error(
      'The ContentPackage owned asset object key is not exportable.'
    );
  }
}

export function isExportableOwnedAssetObjectKey(
  workspaceId: string,
  objectKey: string,
  contentType: string,
) {
  const segments = objectKey.split('/');
  if (segments[0] !== workspaceId) return false;
  const extension =
    contentType === 'image/png'
      ? 'png'
      : contentType === 'image/jpeg'
        ? 'jpg'
        : contentType === 'image/webp'
          ? 'webp'
          : contentType === 'video/mp4'
            ? 'mp4'
            : undefined;
  const legacyVideoPath = segments.slice(2);
  const isVerifiedLegacyVideoKey =
    contentType === 'video/mp4' &&
    segments[1] === 'videos' &&
    legacyVideoPath.length > 0 &&
    legacyVideoPath.every(
      (segment) => segment.length > 0 && segment !== '.' && segment !== '..'
    ) &&
    legacyVideoPath.at(-1)?.endsWith('.mp4');
  const isVerifiedComposedVideoKey =
    contentType === 'video/mp4' &&
    segments.length === 3 &&
    segments[1] === 'composed' &&
    /^video-workflow-[a-z0-9-]+-[a-f0-9]{64}\.mp4$/u.test(
      segments[2] ?? ''
    );
  const isReceiptAddressedKey =
    extension &&
    segments.length === 3 &&
    ['generated', 'composed', 'owned'].includes(segments[1] ?? '') &&
    new RegExp(`^[a-f0-9]{64}\\.${extension}$`).test(segments[2] ?? '');
  return Boolean(
    extension &&
      (isReceiptAddressedKey ||
        isVerifiedLegacyVideoKey ||
        isVerifiedComposedVideoKey)
  );
}

function isExportImageType(
  contentType: ContentPackageExportAsset['contentType']
): contentType is Extract<
  ContentPackageExportAsset['contentType'],
  `image/${string}`
> {
  return contentType.startsWith('image/');
}

function exportImageExtension(
  contentType: Extract<
    ContentPackageExportAsset['contentType'],
    `image/${string}`
  >,
  compliance: Parameters<ContentPackageExportPort['export']>[0]['compliance']
) {
  if (compliance.aigcLabelEnabled || compliance.watermarkEnabled) return 'png';
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/webp') return 'webp';
  return 'png';
}

async function prepareExportImage(
  bytes: Uint8Array,
  contentType: Extract<
    ContentPackageExportAsset['contentType'],
    `image/${string}`
  >,
  compliance: Parameters<ContentPackageExportPort['export']>[0]['compliance'],
  fontFilePath?: string
) {
  if (!compliance.aigcLabelEnabled && !compliance.watermarkEnabled) {
    return bytes;
  }
  const image = sharp(bytes);
  const metadata = await image.metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) {
    throw new Error('Compliance labels require a measurable image.');
  }
  const font = resolveCjkFont(fontFilePath);
  const fontSize = Math.max(12, Math.round(width / 32));
  const padding = Math.max(8, Math.round(width / 80));
  const aigcText = compliance.aigcLabelEnabled ? '内容由 AI 生成' : '';
  const watermarkText = compliance.watermarkEnabled
    ? compliance.watermarkText ?? '品牌内容'
    : '';
  const overlays = [];
  if (aigcText) {
    const label = await renderComplianceLabel({
      alpha: 0.66,
      font,
      fontSize,
      padding,
      text: aigcText,
    });
    overlays.push({
      input: label.bytes,
      left: width - label.width - padding,
      top: padding,
    });
  }
  if (watermarkText) {
    const label = await renderComplianceLabel({
      alpha: 0.55,
      font,
      fontSize,
      padding,
      text: watermarkText,
    });
    overlays.push({
      input: label.bytes,
      left: width - label.width - padding,
      top: height - label.height - padding,
    });
  }
  return new Uint8Array(
    await image.composite(overlays).png().toBuffer()
  );
}

function resolveCjkFont(explicit?: string) {
  const configured = explicit?.trim() || process.env.FFMPEG_FONT_PATH?.trim();
  if (configured) {
    if (!existsSync(configured)) {
      throw new Error(`CJK font file not found: ${configured}`);
    }
    return {
      family:
        CJK_FONT_CANDIDATES.find((candidate) => candidate.path === configured)
          ?.family ?? 'sans-serif',
      path: configured,
    };
  }
  const detected = CJK_FONT_CANDIDATES.find((candidate) =>
    existsSync(candidate.path)
  );
  if (!detected) {
    throw new Error(
      'No CJK font was found. Configure FFMPEG_FONT_PATH so compliance labels are readable.'
    );
  }
  return detected;
}

async function renderComplianceLabel(input: {
  alpha: number;
  font: { family: string; path: string };
  fontSize: number;
  padding: number;
  text: string;
}) {
  const textImage = await sharp({
    text: {
      font: `${input.font.family} ${input.fontSize}`,
      fontfile: input.font.path,
      rgba: true,
      text: `<span foreground="#ffffff">${escapeXml(input.text)}</span>`,
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
  const width = textImage.info.width + input.padding * 2;
  const height = textImage.info.height + input.padding * 2;
  const background = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="${width}" height="${height}" rx="6" fill="rgba(0,0,0,${input.alpha})"/></svg>`
  );
  const bytes = await sharp(background)
    .composite([
      {
        input: textImage.data,
        left: input.padding,
        top: input.padding,
      },
    ])
    .png()
    .toBuffer();
  return { bytes, height, width };
}

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
