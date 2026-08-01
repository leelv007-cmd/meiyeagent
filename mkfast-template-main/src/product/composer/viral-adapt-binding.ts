import type { ViralAdaptSourcePayload } from '@/product/viral-adapt/viral-adapt-journey';

export type ViralAdaptRunBinding = {
  sessionId: string;
  payload: ViralAdaptSourcePayload;
};

type DraftSource = {
  id?: unknown;
  revision?: unknown;
  rightsStatus?: unknown;
};

export function bindViralAdaptSource(input: {
  sessionId: string;
  payload: ViralAdaptSourcePayload;
  sources: readonly unknown[];
}):
  | { ok: true; binding: ViralAdaptRunBinding }
  | { ok: false; error: 'source_not_ready' } {
  const sources = input.sources.filter(
    (source): source is DraftSource =>
      Boolean(source) && typeof source === 'object' && !Array.isArray(source)
  );
  const ready = input.payload.authorizedAssetIds.every((assetId) =>
    sources.some(
      (source) =>
        source.id === assetId &&
        typeof source.revision === 'string' &&
        source.revision.trim().length > 0 &&
        source.rightsStatus === 'public_marketing'
    )
  );
  if (!ready) return { ok: false, error: 'source_not_ready' };
  return {
    ok: true,
    binding: { sessionId: input.sessionId, payload: input.payload },
  };
}

export function viralAdaptSourceForSession(
  binding: ViralAdaptRunBinding | null,
  sessionId: string
): ViralAdaptSourcePayload | undefined {
  return binding?.sessionId === sessionId ? binding.payload : undefined;
}
