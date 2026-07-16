import {
  ArkMediaExecutionPort,
  type ArkMediaExecutionOptions,
} from './ark-media-adapter.js';

export type TuziMediaExecutionOptions = ArkMediaExecutionOptions;

const TUZI_MIN_IMAGE_PIXELS = 3_686_400;
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_REFERENCE_BYTES = 30 * 1024 * 1024;

function ownedReference(
  value: string,
  allowedKind: 'image' | 'media'
): { blob: Blob; extension: string; size: number } {
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
    extension,
    size: bytes.byteLength,
  };
}

function greatestCommonDivisor(left: number, right: number): number {
  return right === 0 ? left : greatestCommonDivisor(right, left % right);
}

function tuziImageSize(size: string | undefined) {
  const match = size?.match(/^(\d+)x(\d+)$/u);
  if (!match) return size;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width * height >= TUZI_MIN_IMAGE_PIXELS) return size;
  const divisor = greatestCommonDivisor(width, height);
  const ratioWidth = width / divisor;
  const ratioHeight = height / divisor;
  const unit =
    Math.ceil(
      Math.sqrt(TUZI_MIN_IMAGE_PIXELS / (ratioWidth * ratioHeight)) / 64
    ) * 64;
  return `${ratioWidth * unit}x${ratioHeight * unit}`;
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
  if (source.size) form.set('size', tuziImageSize(source.size) ?? source.size);
  let totalBytes = 0;
  for (const [index, referenceUrl] of source.image.entries()) {
    const reference = ownedReference(referenceUrl, 'image');
    totalBytes += reference.size;
    if (totalBytes > MAX_TOTAL_REFERENCE_BYTES) {
      throw new Error('Tuzi references exceed the total upload limit.');
    }
    form.append(
      'image',
      reference.blob,
      `reference-${index + 1}.${reference.extension}`
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
    body.status === 'in_progress'
      ? 'running'
      : body.status === 'completed'
        ? 'succeeded'
        : body.status;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return Response.json(
    {
      ...body,
      status,
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
  const form = new FormData();
  form.set('model', source.model);
  form.set(
    'prompt',
    source.content.find((item) => typeof item.text === 'string')?.text ?? ''
  );
  if (source.duration) form.set('seconds', String(source.duration));
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
export class TuziMediaExecutionPort extends ArkMediaExecutionPort {
  constructor(options: TuziMediaExecutionOptions) {
    super({
      ...options,
      fetch: createTuziProductionTransportFetch(options),
    });
  }
}
