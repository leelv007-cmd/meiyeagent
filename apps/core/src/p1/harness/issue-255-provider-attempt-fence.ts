import {
  OpenAiCompatibleLlmExecutionPort,
  type OpenAiCompatibleLlmExecutionOptions,
} from '../model-supply/adapters.js';
import {
  TuziMediaExecutionPort,
  type TuziMediaExecutionOptions,
} from '../model-supply/tuzi-media-adapter.js';
type FenceIdentity = {
  runNonce: string;
  modality: 'copy' | 'image_text' | 'video';
  effectId: string;
  requestFingerprint: string;
  deploymentId: string;
  providerIdempotencyKey: string;
};

export interface Issue255ReceiptFence {
  claimGenerationPost(
    input: FenceIdentity & {
      adapter: 'direct-copy' | 'tuzi-image' | 'tuzi-video';
    },
  ): Promise<unknown>;
  recordProviderHttpRequest(
    input: FenceIdentity & {
      adapter: 'direct-copy' | 'tuzi-image' | 'tuzi-video';
    },
  ): Promise<unknown>;
}

export function createIssue255ProviderFetchFence(input: {
  adapter: 'direct-copy' | 'tuzi-image' | 'tuzi-video';
  fetch: typeof globalThis.fetch;
  generationDurationSeconds?: number;
  identity: FenceIdentity;
  maxGenerationRequestBytes?: number;
  receipts: Issue255ReceiptFence;
}): typeof globalThis.fetch {
  assertFrozenIdentity(input.adapter, input.identity);
  return async (request, init) => {
    const generationPost = isGenerationPost(input.adapter, request, init);
    const requestInit = generationPost
      ? generationRequestInit(
          input.adapter,
          input.identity.providerIdempotencyKey,
          input.generationDurationSeconds,
          init,
        )
      : init;
    if (generationPost) {
      if (input.maxGenerationRequestBytes !== undefined) {
        const requestBytes = await generationRequestBodyBytes(
          request,
          requestInit,
        );
        if (
          requestBytes <= 0 ||
          requestBytes > input.maxGenerationRequestBytes
        ) {
          throw new Error(
            'Issue 255 complete provider request exceeds its frozen byte ceiling.',
          );
        }
      }
      await input.receipts.claimGenerationPost({
        ...input.identity,
        adapter: input.adapter,
      });
    }
    await input.receipts.recordProviderHttpRequest({
      ...input.identity,
      adapter: input.adapter,
    });
    return input.fetch(
      request,
      requestInit,
    );
  };
}

export function createIssue255DirectCopyPort(input: {
  identity: FenceIdentity & { modality: 'copy' };
  maxGenerationRequestBytes: number;
  options: OpenAiCompatibleLlmExecutionOptions;
  receipts: Issue255ReceiptFence;
}) {
  if (
    !Number.isSafeInteger(input.maxGenerationRequestBytes) ||
    input.maxGenerationRequestBytes <= 0
  ) {
    throw new Error(
      'Issue 255 direct copy requires a positive frozen request byte ceiling.',
    );
  }
  const fetch = createIssue255ProviderFetchFence({
    adapter: 'direct-copy',
    fetch: input.options.fetch ?? globalThis.fetch,
    identity: input.identity,
    maxGenerationRequestBytes: input.maxGenerationRequestBytes,
    receipts: input.receipts,
  });
  return new OpenAiCompatibleLlmExecutionPort({
    ...input.options,
    fetch,
  });
}

export function createIssue255TuziMediaPort(input: {
  generationDurationSeconds?: number;
  identity:
    | (FenceIdentity & { modality: 'image_text' })
    | (FenceIdentity & { modality: 'video' });
  options: TuziMediaExecutionOptions;
  receipts: Issue255ReceiptFence;
}) {
  if (
    input.identity.modality === 'video' &&
    (!Number.isSafeInteger(input.generationDurationSeconds) ||
      (input.generationDurationSeconds ?? 0) <= 0)
  ) {
    throw new Error(
      'Issue 255 Tuzi video requires a positive provider duration ceiling.',
    );
  }
  const assetFetch = input.options.assetFetch;
  if (!assetFetch) {
    throw new Error(
      'Issue 255 Tuzi live calibration requires an explicit counted assetFetch.',
    );
  }
  const fetch = createIssue255ProviderFetchFence({
    adapter:
      input.identity.modality === 'image_text'
        ? 'tuzi-image'
        : 'tuzi-video',
    fetch: input.options.fetch ?? globalThis.fetch,
    ...(input.identity.modality === 'video'
      ? { generationDurationSeconds: input.generationDurationSeconds }
      : {}),
    identity: input.identity,
    receipts: input.receipts,
  });
  return new TuziMediaExecutionPort({
    ...input.options,
    assetFetch: {
      async get(
        target: Parameters<typeof assetFetch.get>[0],
        constraints: Parameters<typeof assetFetch.get>[1],
      ) {
        await input.receipts.recordProviderHttpRequest({
          ...input.identity,
          adapter:
            input.identity.modality === 'image_text'
              ? 'tuzi-image'
              : 'tuzi-video',
        });
        return assetFetch.get(target, constraints);
      },
    },
    fetch,
  });
}

function isGenerationPost(
  adapter: 'direct-copy' | 'tuzi-image' | 'tuzi-video',
  input: Parameters<typeof globalThis.fetch>[0],
  init: Parameters<typeof globalThis.fetch>[1],
) {
  const method =
    init?.method ??
    (input instanceof Request ? input.method : 'GET');
  if (method.toUpperCase() !== 'POST') return false;
  const target =
    input instanceof URL
      ? input
      : new URL(typeof input === 'string' ? input : input.url);
  if (adapter === 'direct-copy') {
    return target.pathname.endsWith('/chat/completions');
  }
  if (adapter === 'tuzi-image') {
    return (
      target.pathname.endsWith('/images/generations') ||
      target.pathname.endsWith('/images/edits')
    );
  }
  return /\/videos\/?$/u.test(target.pathname);
}

function generationRequestInit(
  adapter: 'direct-copy' | 'tuzi-image' | 'tuzi-video',
  effectId: string,
  generationDurationSeconds: number | undefined,
  init: RequestInit | undefined,
): RequestInit {
  const headers = new Headers(init?.headers);
  if (adapter === 'direct-copy') {
    headers.set('idempotency-key', effectId);
  }
  if (adapter === 'tuzi-video') {
    if (!(init?.body instanceof FormData)) {
      throw new Error(
        'Issue 255 Tuzi video requires a provable multipart generation request.',
      );
    }
    init.body.set('seconds', String(generationDurationSeconds));
  }
  return {
    ...init,
    headers,
    redirect: 'manual',
  };
}

async function generationRequestBodyBytes(
  input: Parameters<typeof globalThis.fetch>[0],
  init: Parameters<typeof globalThis.fetch>[1],
) {
  const body = init?.body;
  if (typeof body === 'string') {
    return new TextEncoder().encode(body).byteLength;
  }
  if (body instanceof URLSearchParams) {
    return new TextEncoder().encode(body.toString()).byteLength;
  }
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (body !== undefined && body !== null) {
    throw new Error(
      'Issue 255 cannot prove the complete provider request byte ceiling.',
    );
  }
  if (input instanceof Request) {
    return (await input.clone().arrayBuffer()).byteLength;
  }
  return 0;
}

function assertFrozenIdentity(
  adapter: 'direct-copy' | 'tuzi-image' | 'tuzi-video',
  identity: FenceIdentity,
) {
  if (
    !identity.deploymentId.trim() ||
    identity.providerIdempotencyKey !== identity.effectId
  ) {
    throw new Error(
      'Issue 255 provider fence requires the stable provider idempotency key and deployment identity.',
    );
  }
  const expectedAdapter =
    identity.modality === 'copy'
      ? 'direct-copy'
      : identity.modality === 'image_text'
        ? 'tuzi-image'
        : 'tuzi-video';
  if (adapter !== expectedAdapter) {
    throw new Error(
      'Issue 255 provider fence adapter does not match the frozen modality.',
    );
  }
}
