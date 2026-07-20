/**
 * Provider-model → CatalogModel mapping confidence grading for conformance.
 */
import type { SupplyChannelKind } from '@meiye/contracts';
import type {
  GatewayFingerprintMetadata,
  MappingConfidenceGrade,
} from './types.js';

export interface MappingConfidenceInput {
  providerModel: string;
  catalogModelId: string;
  /** Declared CatalogModel.stableModelName when known. */
  catalogStableModelName?: string;
  /** Explicit alias table entry (providerModel → catalogModelId). */
  declaredAlias?: {
    providerModel: string;
    catalogModelId: string;
    mappingRevision?: string;
  };
  channelKind: SupplyChannelKind;
  gatewayFingerprint: GatewayFingerprintMetadata;
  protocolFamily?: string;
}

function normalizeModelToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

/**
 * Grade mapping confidence without inventing production identity.
 * Prefer declared alias / stable name; never upgrade unknown gateway fingerprints
 * past `compatible` for reseller channels.
 */
export function gradeMappingConfidence(
  input: MappingConfidenceInput
): MappingConfidenceGrade {
  const provider = normalizeModelToken(input.providerModel);
  if (!provider) return 'unknown';

  if (
    input.declaredAlias &&
    normalizeModelToken(input.declaredAlias.providerModel) === provider &&
    input.declaredAlias.catalogModelId === input.catalogModelId
  ) {
    return input.declaredAlias.mappingRevision?.trim()
      ? 'exact'
      : 'compatible';
  }

  const stable = input.catalogStableModelName
    ? normalizeModelToken(input.catalogStableModelName)
    : '';
  if (stable && stable === provider) {
    return 'exact';
  }

  if (
    stable &&
    (provider.startsWith(stable) ||
      stable.startsWith(provider) ||
      provider.includes(stable) ||
      stable.includes(provider))
  ) {
    return 'inferred';
  }

  // Catalog id token overlap is weak heuristic only.
  const catalogToken = normalizeModelToken(input.catalogModelId);
  if (
    catalogToken &&
    (provider.includes(catalogToken) || catalogToken.includes(provider))
  ) {
    return 'inferred';
  }

  // OpenAI-compatible reseller without declared alias cannot claim exact.
  if (
    input.channelKind === 'upstream_reseller' &&
    (input.gatewayFingerprint.product === 'new_api' ||
      input.gatewayFingerprint.product === 'sub2api' ||
      input.gatewayFingerprint.product === 'other')
  ) {
    return input.protocolFamily?.includes('openai')
      ? 'compatible'
      : 'unknown';
  }

  return 'unknown';
}

/** Minimum grade accepted for live_verified activation evidence. */
export function mappingConfidenceMeetsActivationGate(
  grade: MappingConfidenceGrade
): boolean {
  return grade === 'exact' || grade === 'compatible';
}
