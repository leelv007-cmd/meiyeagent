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
  identity: FenceIdentity;
  receipts: Issue255ReceiptFence;
}): typeof globalThis.fetch {
  assertFrozenIdentity(input.adapter, input.identity);
  return async (request, init) => {
    const generationPost = isGenerationPost(input.adapter, request, init);
    if (generationPost) {
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
      generationPost
        ? generationRequestInit(
            input.adapter,
            input.identity.providerIdempotencyKey,
            init,
          )
        : init,
    );
  };
}

export function createIssue255DirectCopyPort(input: {
  identity: FenceIdentity & { modality: 'copy' };
  options: OpenAiCompatibleLlmExecutionOptions;
  receipts: Issue255ReceiptFence;
}) {
  const fetch = createIssue255ProviderFetchFence({
    adapter: 'direct-copy',
    fetch: input.options.fetch ?? globalThis.fetch,
    identity: input.identity,
    receipts: input.receipts,
  });
  return new OpenAiCompatibleLlmExecutionPort({
    ...input.options,
    fetch,
  });
}

export function createIssue255TuziMediaPort(input: {
  identity:
    | (FenceIdentity & { modality: 'image_text' })
    | (FenceIdentity & { modality: 'video' });
  options: TuziMediaExecutionOptions;
  receipts: Issue255ReceiptFence;
}) {
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
  init: RequestInit | undefined,
): RequestInit {
  const headers = new Headers(init?.headers);
  if (adapter === 'direct-copy') {
    headers.set('idempotency-key', effectId);
  }
  return {
    ...init,
    headers,
    redirect: 'manual',
  };
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
