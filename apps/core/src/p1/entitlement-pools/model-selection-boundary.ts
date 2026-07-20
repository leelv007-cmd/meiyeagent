import { P1DomainError } from '../foundation/domain.js';
import type { QualityTierPreference } from '../foundation/entitlement-policy.js';

export type ModelSelectionMode = 'fixed' | 'auto';

export interface ModelSelectionRequest {
  mode: ModelSelectionMode;
  /** Required when mode=fixed. */
  catalogModelId?: string;
  /** Optional quality tier when mode=auto. */
  qualityTier?: QualityTierPreference;
}

export interface ModelSelectionBoundary {
  mode: ModelSelectionMode;
  /** Fixed CatalogModel id when mode=fixed. */
  fixedCatalogModelId: string | null;
  /** Strategy may pick CatalogModel (only for Auto / quality-tier). */
  maySelectCatalogModel: boolean;
  /** Strategy may pick Deployment (always, when candidates exist). */
  maySelectDeployment: boolean;
  qualityTier: QualityTierPreference | null;
}

/**
 * D-062 decision ②:
 * - fixed CatalogModel → strategy only selects Deployment
 * - Auto / quality tier → strategy may select CatalogModel + Deployment
 */
export function resolveModelSelectionBoundary(
  request: ModelSelectionRequest
): ModelSelectionBoundary {
  if (request.mode === 'fixed') {
    const catalogModelId = request.catalogModelId?.trim() ?? '';
    if (!catalogModelId) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Fixed model selection requires catalogModelId.'
      );
    }
    return {
      mode: 'fixed',
      fixedCatalogModelId: catalogModelId,
      maySelectCatalogModel: false,
      maySelectDeployment: true,
      qualityTier: null,
    };
  }
  return {
    mode: 'auto',
    fixedCatalogModelId: null,
    maySelectCatalogModel: true,
    maySelectDeployment: true,
    qualityTier: request.qualityTier ?? 'auto',
  };
}
