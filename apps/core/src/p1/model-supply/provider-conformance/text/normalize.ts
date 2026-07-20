/**
 * Text provider error / protocol / usage normalization for conformance checks.
 * Product Core owns retry; adapters must surface one-shot normalized shapes.
 */
import type { Acceptance } from '../../supply-contracts.js';
import type {
  ProviderExecutionResponse,
} from '../../provider-lifecycle.js';
import type {
  GatewayFingerprintMetadata,
  GatewayFingerprintProduct,
  NormalizedProviderError,
  ProtocolEvidence,
  TextConformanceOperation,
  UsageEvidence,
} from '../types.js';
import type { SupplyChannelKind } from '@meiye/contracts';

export function normalizeProviderError(input: {
  acceptance?: Acceptance;
  errorCode?: string;
  retryable?: boolean;
  message?: string;
  statusCode?: number;
}): NormalizedProviderError {
  const statusCode = input.statusCode;
  const acceptance =
    input.acceptance ??
    (statusCode !== undefined && statusCode < 500
      ? 'rejected_before_accept'
      : 'acceptance_unknown');
  const errorCode =
    input.errorCode?.trim() ||
    (statusCode === 401
      ? 'auth_failed'
      : statusCode === 403
        ? 'forbidden'
        : statusCode === 429
          ? 'rate_limited'
          : statusCode !== undefined && statusCode >= 500
            ? 'upstream_5xx'
            : 'provider_failure');
  const retryable =
    input.retryable ??
    (errorCode === 'rate_limited' ||
      errorCode === 'upstream_5xx' ||
      acceptance === 'acceptance_unknown');
  return {
    acceptance,
    errorCode,
    retryable,
    message: input.message?.trim() || errorCode,
    ...(statusCode !== undefined ? { statusCode } : {}),
  };
}

export function extractUsageEvidence(
  response: ProviderExecutionResponse
): UsageEvidence {
  const usage = response.providerCost.usage;
  const hasTokens =
    (usage.inputTokens !== undefined && usage.inputTokens > 0) ||
    (usage.outputTokens !== undefined && usage.outputTokens > 0);
  return {
    ...(usage.inputTokens !== undefined
      ? { inputTokens: usage.inputTokens }
      : {}),
    ...(usage.outputTokens !== undefined
      ? { outputTokens: usage.outputTokens }
      : {}),
    amount: response.providerCost.amount,
    currency: response.providerCost.currency,
    source: hasTokens ? 'observed_usage' : 'missing',
  };
}

export function extractProtocolEvidence(
  operation: TextConformanceOperation,
  response: ProviderExecutionResponse
): ProtocolEvidence {
  if (response.kind === 'failure') {
    return {
      family: 'provider_execution_port',
      completed: false,
    };
  }
  return {
    family: 'provider_execution_port',
    completed: true,
    ...(response.providerTaskRef
      ? { providerTaskRef: response.providerTaskRef }
      : {}),
    hasCopyCandidates: Boolean(response.copyCandidates?.length),
    hasText: typeof response.text === 'string' && response.text.length > 0,
    hasPlatformVariants: Boolean(response.platformVariants),
    ...(operation === 'copy.generate'
      ? {
          hasCopyCandidates: Boolean(response.copyCandidates?.length),
        }
      : {}),
  };
}

export function protocolPayloadSatisfiesOperation(
  operation: TextConformanceOperation,
  protocol: ProtocolEvidence
): boolean {
  if (!protocol.completed) return false;
  if (operation === 'copy.generate') return Boolean(protocol.hasCopyCandidates);
  if (operation === 'copy.adapt') return Boolean(protocol.hasPlatformVariants);
  return Boolean(protocol.hasText);
}

/**
 * Official direct channels must not claim New API/Sub2API fingerprints.
 * Reseller channels must carry an explicit non-official fingerprint product.
 */
export function gatewayFingerprintConsistent(input: {
  channelKind: SupplyChannelKind;
  fingerprint: GatewayFingerprintMetadata;
}): boolean {
  const product = input.fingerprint.product;
  if (input.channelKind === 'official_direct') {
    return product === 'none' || product === 'official_native';
  }
  return (
    product === 'new_api' ||
    product === 'sub2api' ||
    product === 'other' ||
    product === 'unknown'
  );
}

export function fingerprintProductForChannel(
  channelKind: SupplyChannelKind,
  product?: GatewayFingerprintProduct
): GatewayFingerprintProduct {
  if (product) return product;
  return channelKind === 'official_direct' ? 'official_native' : 'new_api';
}
