import type {
  ProductBillingMode,
  ProductQuoteSnapshot,
  ProductUsageRecord,
  ProviderFailoverBillingEvent,
  TrustedUsageEvidenceKind,
} from '@meiye/contracts';
import type { TrustedUsageEvidence } from './quote-service.js';

export type BillingResource = NonNullable<ProductUsageRecord['resource']>;

export interface BillingAttemptCost {
  /** Supplier-side metering mode; independent from merchant ProductUsage. */
  billingMode?: ProductBillingMode;
  supplierPriceRevision: string;
  unitPriceMicros: number;
  currency: string;
  unit: string;
  estimatedCostMicros?: number | null;
  observedCostMicros?: number | null;
  usageQuantity?: number;
  usageUnit?: string;
  evidence?: string;
  evidenceKind?: TrustedUsageEvidenceKind | 'estimated' | 'unknown';
  payer?: 'platform' | 'workspace_byok';
  failover?: ProviderFailoverBillingEvent;
}

export function providerBillingMode(
  cost: BillingAttemptCost,
  fallback: ProductBillingMode,
): ProductBillingMode {
  if (cost.billingMode) return cost.billingMode;
  return /second/iu.test(cost.unit) ? 'per_output_second' : fallback;
}

export interface BillingLifecyclePort {
  assertAcceptedQuote?(input: {
    workspaceId: string;
    taskId: string;
    quoteId: string;
    quoteRevision: string;
  }): ProductQuoteSnapshot | Promise<ProductQuoteSnapshot>;
  beforeSubmit(input: {
    workspaceId: string;
    taskId: string;
    quoteId?: string;
    quoteRevision: string;
    resource: BillingResource;
  }): void | Promise<void>;
  dispatchAttempt(input: {
    workspaceId: string;
    taskId: string;
    attemptId: string;
    deploymentId: string;
    providerCost: BillingAttemptCost;
  }): void | Promise<void>;
  settleTask(input: {
    workspaceId: string;
    taskId: string;
    attemptId: string;
    deploymentId: string;
    status: 'completed' | 'failed';
    providerCost?: BillingAttemptCost;
    trustedUsage?: TrustedUsageEvidence;
  }): void | Promise<void>;
}
