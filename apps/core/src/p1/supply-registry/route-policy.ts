import type { SupplyOperation } from '@meiye/contracts';

export type RoutePolicyQualityTier = 'quality' | 'balanced' | 'auto';

/** Published route-policy payload consumed by the production planning path. */
export interface RoutePolicyPayload {
  operation: SupplyOperation;
  qualityTier: RoutePolicyQualityTier;
  hardConstraints: string[];
  candidateDeploymentIds: string[];
  orderBands?: string[];
  maxAttempts: number;
  costBoundaryMicros?: number;
  fallbackAuthorized: boolean;
  modelSubstitutionDegradationSurfaces?: Record<string, string[]>;
}
