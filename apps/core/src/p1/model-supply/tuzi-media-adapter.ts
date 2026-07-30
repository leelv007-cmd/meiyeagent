/**
 * Tu-zi OpenAI-compatible media transport.
 *
 * Local API authority (gitignored, do not invent params):
 * - docs/_private/tuzi-api/images-generations.openapi.yaml  → POST /v1/images/generations
 * - docs/_private/tuzi-api/images-edits.openapi.yaml        → POST /v1/images/edits
 * - docs/_private/tuzi-api/videos.openapi.yaml              → POST /v1/videos
 * - docs/_private/tuzi-api/README.md                        → product op mapping
 *
 * Production reference evidence (image multipart rewrite):
 * - docs/evidence/pro-studio/ticket-09/2026-07-16-tuzi-production-multipart-probe.md
 */
import sharp from 'sharp';
import {
  ArkMediaExecutionPort,
  type ArkMediaExecutionOptions,
} from './ark-media-adapter.js';

type TuziVideoCatalogModelId = 'seedance-1-5-pro' | 'seedance-2';

export type TuziMediaExecutionOptions =
  ArkMediaExecutionOptions<TuziVideoCatalogModelId>;

const TUZI_MIN_IMAGE_PIXELS = 3_686_400;
const TUZI_MAX_IMAGE_PIXELS = 8_294_400;
const TUZI_MAX_IMAGE_SIDE = 3840;
const TUZI_MAX_ASPECT_RATIO = 3;
const TUZI_IMAGE_DIMENSION_STEP = 16;
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_REFERENCE_BYTES = 30 * 1024 * 1024;
/** docs/_private/tuzi-api/images-edits.openapi.yaml: PNG, square, < 4MB. */
const MAX_EDIT_REFERENCE_BYTES = 4 * 1024 * 1024;
const EDIT_REFERENCE_SIDES = [1024, 768, 512, 256] as const;
const TUZI_VIDEO_STATUS = {
  queued: 'queued',
  in_progress: 'running',
  completed: 'succeeded',
  failed: 'failed',
  unknown: 'queued',
} as const;

function ownedReference(
  value: string,
  allowedKind: 'image' | 'media'
): { blob: Blob; bytes: Buffer; extension: string; size: number } {
  if (value.length > Math.ceil(MAX_REFERENCE_BYTES / 3) * 4 + 64) {
    throw new Error('Tuzi reference exceeds the upload limit.');
  }
  const match =
    /^data:(image\/(?:jpeg|png|webp)|video\/mp4);base64,([A-Za-z0-9+/]*={0,2})$/u.exec(
      value
    );
  if (!match || (allowedKind === 'image' && !match[1]!.startsWith('image/'))) {
    throw new Error('Tuzi references must be validated owned data URLs.');
  }
  const encoded = match[2]!;
  if (encoded.length % 4 !== 0) {
    throw new Error('Tuzi reference base64 is invalid.');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_REFERENCE_BYTES ||
    bytes.toString('base64') !== encoded
  ) {
    throw new Error('Tuzi reference bytes are invalid or oversized.');
  }
  const contentType = match[1]!;
  const extension =
    contentType === 'image/jpeg'
      ? 'jpg'
      : contentType === 'video/mp4'
        ? 'mp4'
        : contentType.slice('image/'.length);
  return {
    blob: new Blob([bytes], { type: contentType }),
    bytes,
    extension,
    size: bytes.byteLength,
  };
}

/**
 * Map workbench/Ark size hints onto /v1/images/edits sizes.
 * OpenAPI lists 256|512|1024, but Seedream live rejects < 3_686_400 pixels
 * and accepts 2048x2048 (ticket-09 probe). Always emit 2048x2048 square.
 * Authority: docs/_private/tuzi-api/images-edits.openapi.yaml + live errors.
 */
export function tuziEditOutputSize(_size: string | undefined): string {
  return '2048x2048';
}

/**
 * Map size hints for /v1/images/generations JSON body.
 * Authority: docs/_private/tuzi-api/images-generations.openapi.yaml
 * The local OpenAPI caps output at 8_294_400 pixels, which is stricter than
 * the live provider maximum. Seedream live also requires ≥ 3_686_400 pixels.
 */
export function tuziGenerationOutputSize(size: string | undefined): string {
  if (!size || size === '2K' || size === '2k') return '2048x2048';
  if (size === 'auto') return '2048x2048';
  const match = size.match(/^(\d+)x(\d+)$/u);
  if (!match) return '2048x2048';
  const requestedWidth = Number(match[1]);
  const requestedHeight = Number(match[2]);
  if (
    !Number.isFinite(requestedWidth) ||
    !Number.isFinite(requestedHeight) ||
    requestedWidth <= 0 ||
    requestedHeight <= 0
  ) {
    return '2048x2048';
  }

  const requestedRatio = Math.min(
    TUZI_MAX_ASPECT_RATIO,
    Math.max(1 / TUZI_MAX_ASPECT_RATIO, requestedWidth / requestedHeight)
  );
  const targetPixels = Math.min(
    TUZI_MAX_IMAGE_PIXELS,
    Math.max(TUZI_MIN_IMAGE_PIXELS, requestedWidth * requestedHeight)
  );
  let idealWidth = Math.sqrt(targetPixels * requestedRatio);
  let idealHeight = Math.sqrt(targetPixels / requestedRatio);
  const longestSide = Math.max(idealWidth, idealHeight);
  if (longestSide > TUZI_MAX_IMAGE_SIDE) {
    const scale = TUZI_MAX_IMAGE_SIDE / longestSide;
    idealWidth *= scale;
    idealHeight *= scale;
  }

  const candidateDimensions = (ideal: number) => {
    const center = Math.round(ideal / TUZI_IMAGE_DIMENSION_STEP);
    const candidates = new Set<number>();
    for (let offset = -3; offset <= 3; offset += 1) {
      const dimension = (center + offset) * TUZI_IMAGE_DIMENSION_STEP;
      if (dimension > 0 && dimension <= TUZI_MAX_IMAGE_SIDE) {
        candidates.add(dimension);
      }
    }
    return candidates;
  };

  let best:
    | {
        areaError: number;
        height: number;
        ratioError: number;
        width: number;
      }
    | undefined;
  for (const width of candidateDimensions(idealWidth)) {
    for (const height of candidateDimensions(idealHeight)) {
      const pixels = width * height;
      const aspectRatio = Math.max(width, height) / Math.min(width, height);
      if (
        pixels < TUZI_MIN_IMAGE_PIXELS ||
        pixels > TUZI_MAX_IMAGE_PIXELS ||
        aspectRatio > TUZI_MAX_ASPECT_RATIO
      ) {
        continue;
      }
      const ratioError = Math.abs(
        Math.log(width / height) - Math.log(requestedRatio)
      );
      const areaError = Math.abs(Math.log(pixels / targetPixels));
      if (
        !best ||
        ratioError < best.ratioError ||
        (ratioError === best.ratioError && areaError < best.areaError)
      ) {
        best = { areaError, height, ratioError, width };
      }
    }
  }
  return best ? `${best.width}x${best.height}` : '2048x2048';
}

/**
 * /v1/images/edits requires square PNG with transparency when no mask
 * (docs/_private/tuzi-api/images-edits.openapi.yaml). Merchant JPEGs are
 * center-contained onto a transparent square canvas under 4MB.
 */
export async function normalizeTuziEditReferencePng(
  bytes: Buffer
): Promise<Buffer> {
  for (const side of EDIT_REFERENCE_SIDES) {
    const png = await sharp(bytes)
      .rotate()
      .ensureAlpha()
      .resize({
        background: { alpha: 0, b: 0, g: 0, r: 0 },
        fit: 'contain',
        height: side,
        width: side,
      })
      .png({ compressionLevel: 9 })
      .toBuffer();
    if (png.byteLength <= MAX_EDIT_REFERENCE_BYTES) return png;
  }
  throw new Error('Tuzi edit reference exceeds 4MB after PNG square normalize.');
}

async function imageEditFormData(
  source: {
    image: string[];
    model: string;
    prompt: string;
    size?: string;
  }
) {
  const form = new FormData();
  form.set('model', source.model);
  form.set('prompt', source.prompt);
  form.set('n', '1');
  form.set('response_format', 'url');
  form.set('size', tuziEditOutputSize(source.size));
  let totalBytes = 0;
  for (const [index, referenceUrl] of source.image.entries()) {
    const reference = ownedReference(referenceUrl, 'image');
    const pngBytes = await normalizeTuziEditReferencePng(reference.bytes);
    totalBytes += pngBytes.byteLength;
    if (totalBytes > MAX_TOTAL_REFERENCE_BYTES) {
      throw new Error('Tuzi references exceed the total upload limit.');
    }
    form.append(
      'image',
      new Blob([Uint8Array.from(pngBytes)], { type: 'image/png' }),
      `reference-${index + 1}.png`
    );
  }
  return form;
}

async function normalizeVideoResponse(response: Response, url: string) {
  if (!response.ok || !/\/videos\/[^/]+$/u.test(url)) return response;
  const body = (await response.clone().json()) as Record<string, unknown>;
  if (typeof body.id !== 'string' || typeof body.status !== 'string') {
    return response;
  }
  const status =
    TUZI_VIDEO_STATUS[body.status as keyof typeof TUZI_VIDEO_STATUS] ??
    body.status;
  const providerCreatedAt =
    typeof body.created_at === 'number' &&
    Number.isSafeInteger(body.created_at) &&
    body.created_at >= 0
      ? body.created_at
      : undefined;
  let providerSignedUrlTimestamp: string | undefined;
  if (status === 'succeeded' && typeof body.video_url === 'string') {
    try {
      const candidate = new URL(body.video_url).searchParams.get('X-Tos-Date');
      if (candidate && /^\d{8}T\d{6}Z$/u.test(candidate)) {
        providerSignedUrlTimestamp = candidate;
      }
    } catch {
      // The Ark layer still rejects a completed task without usable content.
    }
  }
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return Response.json(
    {
      ...body,
      status,
      ...(providerCreatedAt !== undefined
        ? { provider_created_at: providerCreatedAt }
        : {}),
      ...(providerSignedUrlTimestamp
        ? { provider_signed_url_timestamp: providerSignedUrlTimestamp }
        : {}),
      ...(status === 'succeeded'
        ? { content: { video_url: `${url}/content` } }
        : {}),
    },
    { status: response.status, headers }
  );
}

async function videoFormData(
  source: {
    content: Array<{
      image_url?: { url: string };
      text?: string;
      video_url?: { url: string };
    }>;
    duration?: number;
    model: string;
  }
) {
  // Authority: docs/_private/tuzi-api/videos.openapi.yaml
  // - first_frame / last_frame / input_reference are mutually exclusive
  // - seconds is documented as >=4 and <15; v3 live proved that omission
  //   defaults to unsupported duration=4 for Seedance 1.5 Pro
  // - 1.5 pro does not accept input_reference
  const form = new FormData();
  form.set('model', source.model);
  form.set(
    'prompt',
    source.content.find((item) => typeof item.text === 'string')?.text ?? ''
  );
  if (source.duration !== 5 && source.duration !== 10) {
    throw new Error('Tuzi video duration must be 5 or 10 seconds.');
  }
  form.set('seconds', String(source.duration));
  const referenceUrls = source.content.flatMap((item) =>
    [item.image_url?.url, item.video_url?.url].filter(
      (url): url is string => typeof url === 'string' && Boolean(url)
    )
  );
  if (referenceUrls.length > 1) {
    throw new Error(
      'Tuzi video supports only one reference per submission; multiple references are not accepted.'
    );
  }
  const referenceUrl = referenceUrls[0];
  if (referenceUrl) {
    const owned = ownedReference(referenceUrl, 'media');
    form.set(
      'input_reference',
      owned.blob,
      `reference.${owned.extension}`
    );
  }
  return form;
}

async function rewriteTuziRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  fetchImpl: typeof fetch,
  apiKey: string
) {
  const sourceUrl = String(input);
  const isImageSubmission = sourceUrl.endsWith('/images/generations');
  const isVideoLifecycle = sourceUrl.includes('/contents/generations/tasks');
  const isVideoContent = /\/videos\/[^/]+\/content$/u.test(sourceUrl);
  if (isVideoContent) {
    return fetchImpl(input, {
      ...init,
      headers: {
        authorization: `Bearer ${apiKey}`,
        ...init?.headers,
      },
    });
  }
  if (!isImageSubmission && !isVideoLifecycle) {
    return fetchImpl(input, init);
  }
  // Reference-bearing image JSON is rewritten to /images/edits multipart.
  // Authority: images-edits.openapi.yaml + ticket-09 production probe.
  // images-generations.openapi.yaml is preferred for pure text-to-image and
  // may accept `image` in JSON; rewrite keeps the live-verified Seedream path.
  const url = isImageSubmission
    ? sourceUrl.replace(/\/images\/generations$/u, '/images/edits')
    : sourceUrl.replace('/contents/generations/tasks', '/videos');
  if (!isImageSubmission && typeof init?.body === 'string') {
    const source = JSON.parse(init.body) as Parameters<typeof videoFormData>[0];
    const headers = new Headers(init.headers);
    headers.delete('content-type');
    let body: FormData;
    try {
      body = await videoFormData(source);
    } catch (error) {
      return Response.json(
        {
          error: {
            code: 'reference_invalid',
            message:
              error instanceof Error
                ? error.message
                : 'Tuzi video reference is invalid before submission.',
          },
        },
        { status: 400 }
      );
    }
    return fetchImpl(url, {
      ...init,
      body,
      headers,
    });
  }
  if (!isImageSubmission || typeof init?.body !== 'string') {
    return normalizeVideoResponse(await fetchImpl(url, init), url);
  }
  const source = JSON.parse(init.body) as {
    image?: string[];
    model: string;
    prompt: string;
    size?: string;
  };
  if (source.image?.length) {
    const headers = new Headers(init.headers);
    headers.delete('content-type');
    let body: FormData;
    try {
      body = await imageEditFormData({ ...source, image: source.image });
    } catch {
      return Response.json(
        {
          error: {
            code: 'reference_invalid',
            message: 'Tuzi image reference is invalid before submission.',
          },
        },
        { status: 400 }
      );
    }
    return fetchImpl(url, {
      ...init,
      body,
      headers,
    });
  }
  // Pure generations (no reference image): normalize size per
  // docs/_private/tuzi-api/images-generations.openapi.yaml (no bare `2K`).
  if (typeof init?.body === 'string') {
    try {
      const body = JSON.parse(init.body) as {
        model: string;
        prompt: string;
        size?: string;
        [key: string]: unknown;
      };
      const next = {
        ...body,
        size: tuziGenerationOutputSize(body.size),
      };
      return fetchImpl(input, {
        ...init,
        body: JSON.stringify(next),
      });
    } catch {
      return fetchImpl(input, init);
    }
  }
  return fetchImpl(input, init);
}

export function createTuziProductionTransportFetch(options: {
  apiKey: string;
  fetch?: typeof fetch;
}): typeof fetch {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  return (input, init) =>
    rewriteTuziRequest(input, init, fetchImpl, options.apiKey);
}

/**
 * Tu-zi uses the same lifecycle semantics as the Ark media adapter but exposes
 * OpenAI-compatible image and video paths. The translation keeps the existing
 * encrypted receipts, recovery rules, accounting, downloads, and redaction.
 */
export class TuziMediaExecutionPort extends ArkMediaExecutionPort<
  TuziVideoCatalogModelId
> {
  constructor(options: TuziMediaExecutionOptions) {
    super({
      ...options,
      fetch: createTuziProductionTransportFetch(options),
    });
  }

  override async submit(
    request: Parameters<ArkMediaExecutionPort['submit']>[0]
  ) {
    const receipt = await super.submit(request);
    const referenceCount =
      request.submission.input?.inputAssets?.length ??
      request.submission.input?.referenceAssetIds?.length ??
      0;
    if (
      request.submission.operation === 'video.generate' &&
      referenceCount > 1 &&
      receipt.acceptance === 'rejected_before_accept'
    ) {
      return {
        ...receipt,
        errorCode: 'video_reference_limit',
        retryable: false,
      };
    }
    return receipt;
  }
}
