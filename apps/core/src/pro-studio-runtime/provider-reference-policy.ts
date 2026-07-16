export const CURRENT_PROVIDER_REFERENCE_DECISION = {
  evidenceRef:
    'docs/evidence/pro-studio/ticket-09/2026-07-16-tuzi-inline-data-url-probe.md',
  grantEndpoint: null,
  status: 'undetermined',
} as const;

export class ProviderReferencePolicyError extends Error {
  constructor(
    readonly code: 'PROVIDER_REFERENCE_PROBE_REQUIRED',
    message: string,
  ) {
    super(message);
  }
}

export interface ProviderReferencePolicyPort {
  assertCanDispatch(input: { referenceAssetCount: number }): void;
}

export const CURRENT_PROVIDER_REFERENCE_POLICY: ProviderReferencePolicyPort = {
  assertCanDispatch(input) {
    if (input.referenceAssetCount === 0) return;
    throw new ProviderReferencePolicyError(
      'PROVIDER_REFERENCE_PROBE_REQUIRED',
      'Provider reference transport is unavailable until a live capability probe succeeds.',
    );
  },
};

export function providerReferenceReleaseConformance() {
  return {
    failures: ['PROVIDER_REFERENCE_PROBE_REQUIRED'] as const,
    grantEndpoint: CURRENT_PROVIDER_REFERENCE_DECISION.grantEndpoint,
    grantUrlsProduced: false,
    ready: false,
  } as const;
}

export function resolveProviderReferenceTransport(_input: {
  assetId: string;
  ownedDataUrl: string;
}): never {
  throw new ProviderReferencePolicyError(
    'PROVIDER_REFERENCE_PROBE_REQUIRED',
    'Provider reference transport is unavailable until a live capability probe succeeds.',
  );
}
