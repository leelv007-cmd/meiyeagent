import {
  normalizeViralOpenCliAuthorizedAssets,
  type ViralOpenCliAuthorizedAssetRef,
  type ViralOpenCliReadResult,
} from './viral-adapt-journey';
/*
 * This module intentionally imports only validation/types from the journey.
 * It never imports a network client or daemon transport.
 */
export const VIRAL_OPENCLI_LIVE_GATE_EVIDENCE = {
  verified: true,
  evidenceRef: 'docs/ops/issue-328-opencli-live-gate-handover-2026-08-02.md',
} as const;

/**
 * Host-owned boundary injected by the user's local companion/extension.
 * The host must map downloaded files to rights-authorized Composer asset ids
 * before resolving. The web application never reaches the daemon itself.
 */
export type ViralOpenCliBridge = {
  schemaVersion: 'meiye-opencli-bridge/v1';
  ready: boolean;
  readXhsNote(input: {
    noteUrl: string;
    signal?: AbortSignal;
  }): Promise<ViralOpenCliReadResult>;
};

declare global {
  interface Window {
    __MEIYE_OPENCLI_BRIDGE__?: ViralOpenCliBridge;
  }
}

export type ViralOpenCliBridgeErrorCode =
  | 'bridge_absent'
  | 'read_failed'
  | 'invalid_result';

export class ViralOpenCliBridgeError extends Error {
  readonly code: ViralOpenCliBridgeErrorCode;

  constructor(code: ViralOpenCliBridgeErrorCode) {
    super(
      code === 'bridge_absent'
        ? 'The local OpenCLI bridge is not connected.'
        : code === 'invalid_result'
          ? 'The local OpenCLI bridge returned an invalid result.'
          : 'The local OpenCLI bridge could not read this note.'
    );
    this.name = 'ViralOpenCliBridgeError';
    this.code = code;
  }
}

export function injectedViralOpenCliBridge(): ViralOpenCliBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = window.__MEIYE_OPENCLI_BRIDGE__;
  if (
    bridge?.schemaVersion !== 'meiye-opencli-bridge/v1' ||
    typeof bridge.readXhsNote !== 'function'
  ) {
    return null;
  }
  return bridge;
}

function isViralOpenCliReadResult(
  value: unknown
): value is ViralOpenCliReadResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ViralOpenCliReadResult>;
  return (
    candidate.schemaVersion === 'viral-opencli-read/v1' &&
    typeof candidate.noteText === 'string' &&
    Array.isArray(candidate.authorizedAssets) &&
    candidate.authorizedAssets.every(
      (asset) =>
        Boolean(asset) &&
        typeof asset === 'object' &&
        typeof asset.id === 'string' &&
        typeof asset.revision === 'string'
    )
  );
}

export async function readViralOpenCliSource(
  bridge: ViralOpenCliBridge | null,
  noteUrl: string,
  signal?: AbortSignal
): Promise<ViralOpenCliReadResult> {
  if (
    bridge?.schemaVersion !== 'meiye-opencli-bridge/v1' ||
    bridge.ready !== true
  ) {
    throw new ViralOpenCliBridgeError('bridge_absent');
  }
  let result: unknown;
  try {
    result = await bridge.readXhsNote({ noteUrl, signal });
  } catch {
    throw new ViralOpenCliBridgeError('read_failed');
  }
  if (!isViralOpenCliReadResult(result)) {
    throw new ViralOpenCliBridgeError('invalid_result');
  }
  const authorizedAssets = normalizeViralOpenCliAuthorizedAssets(
    result.authorizedAssets
  );
  if (!authorizedAssets) {
    throw new ViralOpenCliBridgeError('invalid_result');
  }
  return {
    schemaVersion: 'viral-opencli-read/v1',
    noteText: result.noteText,
    authorizedAssets: authorizedAssets.map(({ id, revision }) => ({
      id,
      revision,
    })),
  };
}

export function mergeViralOpenCliAuthorizedSources(
  currentSources: readonly unknown[],
  authorizedAssets: readonly ViralOpenCliAuthorizedAssetRef[]
): { sources: unknown[] } | { error: 'source_conflict' } {
  const nextSources = [...currentSources];
  for (const asset of authorizedAssets) {
    const matchingIndexes = nextSources.flatMap((source, index) =>
      Boolean(source) &&
      typeof source === 'object' &&
      !Array.isArray(source) &&
      (source as Record<string, unknown>).id === asset.id
        ? [index]
        : []
    );
    if (
      matchingIndexes.length > 1 ||
      matchingIndexes.some(
        (index) =>
          (nextSources[index] as Record<string, unknown>).revision !==
          asset.revision
      )
    ) {
      return { error: 'source_conflict' };
    }
    const matchingIndex = matchingIndexes[0];
    if (matchingIndex === undefined) {
      nextSources.push({
        id: asset.id,
        kind: 'asset',
        revision: asset.revision,
        // The host contract guarantees import + public-marketing authorization;
        // Core revalidates the same asset revision before freezing the run.
        rightsStatus: 'public_marketing',
      });
      continue;
    }
    nextSources[matchingIndex] = {
      ...(nextSources[matchingIndex] as Record<string, unknown>),
      rightsStatus: 'public_marketing',
    };
  }
  return { sources: nextSources };
}
