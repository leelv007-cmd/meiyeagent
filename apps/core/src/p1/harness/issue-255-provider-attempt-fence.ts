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
};

interface ReceiptFence {
  claimGenerationPost(input: FenceIdentity): Promise<unknown>;
  recordProviderHttpRequest(input: FenceIdentity): Promise<unknown>;
}

export function createIssue255ProviderFetchFence(input: {
  adapter: 'direct-copy' | 'tuzi-image' | 'tuzi-video';
  fetch: typeof globalThis.fetch;
  identity: FenceIdentity;
  receipts: ReceiptFence;
}): typeof globalThis.fetch {
  return async (request, init) => {
    if (isGenerationPost(input.adapter, request, init)) {
      await input.receipts.claimGenerationPost(input.identity);
    }
    await input.receipts.recordProviderHttpRequest(input.identity);
    return input.fetch(request, init);
  };
}

export function createIssue255DirectCopyPort(input: {
  identity: FenceIdentity & { modality: 'copy' };
  options: OpenAiCompatibleLlmExecutionOptions;
  receipts: ReceiptFence;
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
  receipts: ReceiptFence;
}) {
  const assetFetch = input.options.assetFetch;
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
    ...(assetFetch
      ? {
          assetFetch: {
            async get(
              target: Parameters<typeof assetFetch.get>[0],
              constraints: Parameters<typeof assetFetch.get>[1],
            ) {
              await input.receipts.recordProviderHttpRequest(input.identity);
              return assetFetch.get(target, constraints);
            },
          },
        }
      : {}),
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
