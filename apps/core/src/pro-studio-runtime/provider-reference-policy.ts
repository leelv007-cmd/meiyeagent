const VERIFIED_PROVIDER_REFERENCE_TRANSPORTS = [
  {
    deploymentId: 'gpt-image-2-tuzi-relay',
    executionChannelId: 'channel-tuzi-gpt-image-2-relay',
    operation: 'image.edit',
    providerModel: 'doubao-seedream-4-5-251128',
    providerProfileId: 'provider-tu-zi-openai',
    transport: 'multipart_upload_from_owned_data_url',
  },
] as const;

export const CURRENT_PROVIDER_REFERENCE_DECISION = {
  evidenceRef:
    'docs/evidence/pro-studio/ticket-09/2026-07-16-tuzi-production-multipart-probe.md',
  grantEndpoint: null,
  status: 'accepted_owned_reference_upload',
  verifiedTransports: VERIFIED_PROVIDER_REFERENCE_TRANSPORTS,
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
  assertCanDispatch(input: {
    deploymentId: string;
    executionChannelId?: string;
    operation: string;
    providerModel?: string;
    providerProfileId?: string;
    referenceAssetCount: number;
  }): void;
}

export const CURRENT_PROVIDER_REFERENCE_POLICY: ProviderReferencePolicyPort = {
  assertCanDispatch(input) {
    if (input.referenceAssetCount === 0) return;
    const verified = VERIFIED_PROVIDER_REFERENCE_TRANSPORTS.some(
      (transport) =>
        transport.deploymentId === input.deploymentId &&
        transport.executionChannelId === input.executionChannelId &&
        transport.operation === input.operation &&
        transport.providerModel === input.providerModel &&
        transport.providerProfileId === input.providerProfileId,
    );
    if (verified) return;
    throw new ProviderReferencePolicyError(
      'PROVIDER_REFERENCE_PROBE_REQUIRED',
      'Provider reference transport has no matching live capability evidence.',
    );
  },
};

export function providerReferenceReleaseConformance() {
  return {
    failures: [] as const,
    grantEndpoint: CURRENT_PROVIDER_REFERENCE_DECISION.grantEndpoint,
    grantUrlsProduced: false,
    ready: true,
    verifiedTransports: CURRENT_PROVIDER_REFERENCE_DECISION.verifiedTransports,
  } as const;
}
