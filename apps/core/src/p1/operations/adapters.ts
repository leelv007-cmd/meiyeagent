import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { ProductApplicationService } from '../../product/product-service.js';
import type { ModelAssetStoragePort } from '../model-supply/index.js';
import type { OperationsApplicationService } from './application-service.js';
import type {
  CanvasDocument,
  CanvasExportPort,
  CanvasExportValidationEvidence,
  ExportArtifact,
  ExportRequest,
  ImageGenerationPort,
} from './types.js';

const MAX_RENDERED_EXPORT_BYTES = 25 * 1024 * 1024;

async function decodeRenderedImage(
  document: CanvasDocument,
  request: ExportRequest
) {
  const expectedType = request.format === 'png' ? 'image/png' : 'image/jpeg';
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(
    request.renderedDataUrl
  );
  if (!match || match[1] !== expectedType) {
    throw new Error(
      `Rendered export must be a base64 ${expectedType} data URL.`
    );
  }
  const bytes = Buffer.from(match[2]!.replace(/\s/g, ''), 'base64');
  if (bytes.length === 0 || bytes.length > MAX_RENDERED_EXPORT_BYTES) {
    throw new Error(
      `Rendered export size must be between 1 and ${MAX_RENDERED_EXPORT_BYTES} bytes.`
    );
  }
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try {
    metadata = await sharp(bytes, { failOn: 'error' }).metadata();
  } catch {
    throw new Error(`Rendered export bytes do not match ${expectedType}.`);
  }
  const detectedType =
    metadata.format === 'png'
      ? ('image/png' as const)
      : metadata.format === 'jpeg'
        ? ('image/jpeg' as const)
        : undefined;
  if (detectedType !== expectedType) {
    throw new Error(`Rendered export bytes do not match ${expectedType}.`);
  }
  if (metadata.width !== request.width || metadata.height !== request.height) {
    throw new Error(
      `Rendered export pixel dimensions ${metadata.width ?? 'unknown'}x${metadata.height ?? 'unknown'} do not match requested ${request.width}x${request.height}.`
    );
  }
  if (metadata.width !== document.width || metadata.height !== document.height) {
    throw new Error(
      `Rendered export pixel dimensions do not match the persisted Canvas revision ${document.width}x${document.height}.`
    );
  }

  let minimumAlpha = 255;
  try {
    const stats = await sharp(bytes, { failOn: 'error' }).ensureAlpha().stats();
    minimumAlpha = stats.channels.at(-1)?.min ?? 255;
  } catch {
    throw new Error(`Rendered export bytes do not match ${expectedType}.`);
  }
  const hasAlphaChannel = metadata.hasAlpha === true;
  const hasTransparentPixels = hasAlphaChannel && minimumAlpha < 255;

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const documentEvidence = collectCanvasDocumentEvidence(document);
  assertRenderEvidenceMarker(request, sha256, documentEvidence);
  await assertRasterDocumentEvidence(bytes, document, documentEvidence);

  return {
    bytes,
    contentType: detectedType,
    validation: collectCanvasExportValidation(request, documentEvidence, {
      hasAlphaChannel,
      hasTransparentPixels,
    }),
  } as const;
}

function collectCanvasExportValidation(
  request: ExportRequest,
  document: CanvasExportValidationEvidence['document'],
  raster: Pick<
    CanvasExportValidationEvidence['raster'],
    'hasAlphaChannel' | 'hasTransparentPixels'
  >
): CanvasExportValidationEvidence {
  return {
    document,
    markerVersion: request.renderEvidenceMarker.version,
    raster: {
      format: request.format,
      hasAlphaChannel: raster.hasAlphaChannel,
      hasTransparentPixels: raster.hasTransparentPixels,
      height: request.height,
      width: request.width,
    },
  };
}

function collectCanvasDocumentEvidence(
  document: CanvasDocument,
): CanvasExportValidationEvidence['document'] {
  const imageElementIds = new Set<string>();
  const imageAssetIds = new Set<string>();
  const fontFamilies = new Set<string>();
  const cjkTextElementIds = new Set<string>();
  const cjkLineBreakElementIds = new Set<string>();

  for (const page of document.pages) {
    for (const element of page.elements) {
      if (element.kind === 'image') {
        imageElementIds.add(element.id);
        imageAssetIds.add(element.assetId);
        continue;
      }
      if (element.fontFamily?.trim()) {
        fontFamilies.add(element.fontFamily.trim());
      }
      if (/\p{Script=Han}/u.test(element.text)) {
        cjkTextElementIds.add(element.id);
        if (/\r?\n/u.test(element.text)) {
          cjkLineBreakElementIds.add(element.id);
        }
      }
    }
  }

  return {
    cjkLineBreakElementIds: [...cjkLineBreakElementIds].sort(),
    cjkTextElementIds: [...cjkTextElementIds].sort(),
    fontFamilies: [...fontFamilies].sort(),
    imageAssetIds: [...imageAssetIds].sort(),
    imageElementIds: [...imageElementIds].sort(),
  };
}

function assertRenderEvidenceMarker(
  request: ExportRequest,
  rasterSha256: string,
  document: CanvasExportValidationEvidence['document'],
) {
  const marker = request.renderEvidenceMarker;
  if (
    marker?.version !== 'canvas-raster-v1' ||
    marker.rasterSha256 !== rasterSha256 ||
    !sameStrings(marker.imageElementIds, document.imageElementIds) ||
    !sameStrings(marker.fontFamilies, document.fontFamilies) ||
    !sameStrings(
      marker.cjkLineBreakElementIds,
      document.cjkLineBreakElementIds,
    )
  ) {
    throw new Error(
      'Rendered export evidence marker does not match the raster and Canvas revision.',
    );
  }
}

function sameStrings(left: unknown, right: string[]) {
  if (!Array.isArray(left) || left.some((value) => typeof value !== 'string')) {
    return false;
  }
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index])
  );
}

async function assertRasterDocumentEvidence(
  bytes: Buffer,
  document: CanvasDocument,
  evidence: CanvasExportValidationEvidence['document'],
) {
  const decoded = await sharp(bytes, { failOn: 'error' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const background = sampledDominantColor(
    decoded.data,
    decoded.info.width,
    decoded.info.height,
    decoded.info.channels,
  );
  for (const page of document.pages) {
    for (const element of page.elements) {
      const region = rasterRegionEvidence(
        decoded.data,
        decoded.info.width,
        decoded.info.height,
        decoded.info.channels,
        element,
        background,
      );
      if (element.kind === 'image' && region.foregroundPixels < region.minimum) {
        throw new Error(
          `Rendered export is missing raster evidence for image element ${element.id}.`,
        );
      }
      if (
        element.kind === 'text' &&
        (element.fontFamily || /\p{Script=Han}/u.test(element.text)) &&
        region.foregroundPixels < region.minimum
      ) {
        throw new Error(
          `Rendered export is missing raster evidence for text element ${element.id}.`,
        );
      }
      if (
        element.kind === 'text' &&
        evidence.cjkLineBreakElementIds.includes(element.id) &&
        region.activeRowGroups < element.text.split(/\r?\n/u).length
      ) {
        throw new Error(
          `Rendered export is missing CJK line-break raster evidence for text element ${element.id}.`,
        );
      }
    }
  }
}

function sampledDominantColor(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
) {
  const counts = new Map<string, number>();
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 10_000)));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const offset = (y * width + x) * channels;
      const key = `${data[offset]},${data[offset + 1]},${data[offset + 2]},${data[offset + 3]}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])[0]![0]
    .split(',')
    .map(Number);
}

function rasterRegionEvidence(
  data: Buffer,
  rasterWidth: number,
  rasterHeight: number,
  channels: number,
  element: CanvasDocument['pages'][number]['elements'][number],
  background: number[],
) {
  const radians = (element.rotation * Math.PI) / 180;
  const boundWidth =
    Math.abs(element.width * Math.cos(radians)) +
    Math.abs(element.height * Math.sin(radians));
  const boundHeight =
    Math.abs(element.width * Math.sin(radians)) +
    Math.abs(element.height * Math.cos(radians));
  const centerX = element.x + element.width / 2;
  const centerY = element.y + element.height / 2;
  const left = Math.max(0, Math.floor(centerX - boundWidth / 2));
  const top = Math.max(0, Math.floor(centerY - boundHeight / 2));
  const right = Math.min(rasterWidth, Math.ceil(centerX + boundWidth / 2));
  const bottom = Math.min(rasterHeight, Math.ceil(centerY + boundHeight / 2));
  const activeRows: boolean[] = [];
  let foregroundPixels = 0;
  for (let y = top; y < bottom; y += 1) {
    let rowForeground = 0;
    for (let x = left; x < right; x += 1) {
      const offset = (y * rasterWidth + x) * channels;
      let difference = 0;
      for (let channel = 0; channel < 4; channel += 1) {
        difference += Math.abs((data[offset + channel] ?? 0) - (background[channel] ?? 0));
      }
      if (difference > 24) rowForeground += 1;
    }
    foregroundPixels += rowForeground;
    activeRows.push(rowForeground >= 2);
  }
  let activeRowGroups = 0;
  let gap = 4;
  for (const active of activeRows) {
    if (active && gap > 3) activeRowGroups += 1;
    gap = active ? 0 : gap + 1;
  }
  const area = Math.max(0, right - left) * Math.max(0, bottom - top);
  return {
    activeRowGroups,
    foregroundPixels,
    minimum: Math.max(4, Math.ceil(area * 0.0001)),
  };
}

export class RecordedCanvasExportAdapter implements CanvasExportPort {
  async export(
    document: Parameters<CanvasExportPort['export']>[0],
    request: ExportRequest
  ): Promise<ExportArtifact> {
    const rendered = await decodeRenderedImage(document, request);
    const sha256 = createHash('sha256').update(rendered.bytes).digest('hex');
    return {
      bytes: rendered.bytes.length,
      contentType: rendered.contentType,
      objectKey: `recorded/exports/${sha256}.${request.format}`,
      sha256,
      validation: rendered.validation,
    };
  }
}

export class PersistentCanvasExportAdapter implements CanvasExportPort {
  constructor(private readonly storage: ModelAssetStoragePort) {}

  async export(
    document: Parameters<CanvasExportPort['export']>[0],
    request: ExportRequest,
    context: { workspaceId: string }
  ): Promise<ExportArtifact> {
    if (!context.workspaceId || !this.storage.persistOwnedAsset) {
      throw new Error('Workspace-owned canvas export storage is unavailable.');
    }
    const rendered = await decodeRenderedImage(document, request);
    const persisted = await this.storage.persistOwnedAsset({
      bytes: rendered.bytes,
      contentType: rendered.contentType,
      workspaceId: context.workspaceId,
    });
    const sha256 = createHash('sha256').update(rendered.bytes).digest('hex');
    if (
      persisted.sha256 !== sha256 ||
      persisted.sizeBytes !== rendered.bytes.byteLength ||
      persisted.contentType !== rendered.contentType ||
      !persisted.objectKey.startsWith(`${context.workspaceId}/owned/`)
    ) {
      throw new Error('Persisted canvas export does not match rendered bytes.');
    }
    return {
      assetId: persisted.id,
      bytes: persisted.sizeBytes,
      contentType: persisted.contentType,
      objectKey: persisted.objectKey,
      sha256: persisted.sha256,
      validation: rendered.validation,
    };
  }

  async inspectOwnedAsset(
    input: Parameters<NonNullable<CanvasExportPort['inspectOwnedAsset']>>[0]
  ) {
    if (!this.storage.inspectOwnedAsset) return false;
    return this.storage.inspectOwnedAsset({
      contentType: input.contentType,
      objectKey: input.objectKey,
      sha256: input.sha256,
      sizeBytes: input.bytes,
      workspaceId: input.workspaceId,
    });
  }
}

export class RecordedImageGenerationAdapter implements ImageGenerationPort {
  constructor(private readonly options: { autoComplete?: boolean } = {}) {}

  jobId(request: Parameters<ImageGenerationPort['submit']>[0]) {
    return `recorded-image-${createHash('sha256')
      .update(
        `${request.workspaceId}:${request.idempotencyKey ?? JSON.stringify(request)}`
      )
      .digest('hex')
      .slice(0, 32)}`;
  }

  async submit(request: Parameters<ImageGenerationPort['submit']>[0]) {
    const id = this.jobId(request);
    const assetId = `recorded-asset-${createHash('sha256')
      .update(`${id}:asset`)
      .digest('hex')
      .slice(0, 32)}`;
    return {
      actualModelId: request.requestedModelId,
      id,
      ...(this.options.autoComplete
        ? {
            outputAssetId: assetId,
            outputAssetUrl: `data:image/svg+xml,${encodeURIComponent(
              '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="100%" height="100%" fill="#f4e8e6"/><circle cx="300" cy="430" r="170" fill="#d8aca8"/><circle cx="760" cy="520" r="220" fill="#ead2ce"/><rect x="170" y="800" width="740" height="260" rx="56" fill="#fff7f5"/><rect x="260" y="885" width="560" height="28" rx="14" fill="#b87b75"/><rect x="340" y="950" width="400" height="22" rx="11" fill="#d8aca8"/></svg>'
            )}`,
            status: 'completed' as const,
          }
        : { status: 'queued' as const }),
    };
  }
}
