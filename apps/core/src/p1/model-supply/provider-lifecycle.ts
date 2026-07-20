/**
 * S2a behavior-preserving extract: provider execution / media lifecycle ports.
 */
import type { GeneratedPlatformVariants } from '@meiye/contracts';
import type { ZodType } from 'zod';
import type {
  Acceptance,
  CanvasGenerationInputAssetRole,
  CatalogModel,
  ModelDeployment,
  OwnedAsset,
} from './supply-contracts.js';
import type { ModelSupplySubmission } from './route-contracts.js';
import type { CopyCandidate, ProviderCost } from './ledger-contracts.js';

export interface ProviderExecutionRequest {
  jobId: string;
  model: CatalogModel;
  deployment: ModelDeployment;
  submission: ModelSupplySubmission;
  resolvedReferenceAssets?: import('./reference-asset-resolver.js').ResolvedReferenceAsset[];
  resolvedInputAssets?: Array<
    import('./reference-asset-resolver.js').ResolvedReferenceAsset & {
      role: CanvasGenerationInputAssetRole;
    }
  >;
}

export type ProviderExecutionResponse =
  | {
      kind: 'completed';
      providerTaskRef?: string;
      copyCandidates?: CopyCandidate[];
      platformVariants?: GeneratedPlatformVariants;
      text?: string;
      structuredOutput?: unknown;
      assetBytes?: Uint8Array;
      contentType?: OwnedAsset['contentType'];
      providerCost: Omit<ProviderCost, 'id' | 'status'>;
    }
  | {
      kind: 'failure';
      acceptance: Acceptance;
      providerTaskRef?: string;
      errorCode?: string;
      retryable?: boolean;
      message: string;
      providerCost: Omit<ProviderCost, 'id' | 'status'>;
    };

/**
 * The only execution seam used by ModelSupplyApplicationService. Direct,
 * managed and gateway adapters all normalize into this contract.
 */
export interface ProviderExecutionPort {
  execute(
    request: ProviderExecutionRequest
  ): Promise<ProviderExecutionResponse>;
}

export interface StructuredObjectExecutor {
  supportsCatalogModel(catalogModelId: string): boolean;
  generate<Output>(input: {
    abortSignal?: AbortSignal;
    instructions: string;
    onPartialOutput?: (partial: unknown) => Promise<void> | void;
    prompt: string;
    schema: ZodType<Output>;
    schemaName: string;
  }): Promise<{
    output: Output;
    providerTaskRef: string;
    usage: { inputTokens: number; outputTokens: number };
  }>;
  providerCost(usage: { inputTokens: number; outputTokens: number }): {
    amount: number;
    currency: 'CNY' | 'USD';
    usage: { inputTokens: number; outputTokens: number };
  };
}

export interface MediaProviderEffectRequest extends ProviderExecutionRequest {
  effectIdempotencyKey: string;
  resolvedReferenceAssets?: import('./reference-asset-resolver.js').ResolvedReferenceAsset[];
}

export interface MediaProviderSubmissionReceipt {
  acceptance: 'accepted' | 'acceptance_unknown' | 'rejected_before_accept';
  taskRef?: string;
  sourceExpiresAt?: string;
  providerCost: Omit<ProviderCost, 'id' | 'status'>;
  errorCode?: string;
  retryable?: boolean;
  error?: string;
}

/**
 * Adapter-local health observation (MP-04I/V).
 * WT-I reports facts; WT-G owns HealthOverlayPort persistence.
 */
export type MediaProviderHealthState =
  | 'healthy'
  | 'degraded'
  | 'cooldown'
  | 'circuit_open'
  | 'unavailable';

export interface MediaProviderHealthReport {
  state: MediaProviderHealthState;
  reason: string;
  source: 'adapter';
  observedAt: string;
  endsAt?: string;
  /** Accepted tasks still tracked by this adapter (in-memory or durable store). */
  inFlightCount?: number;
  drainMode?: MediaProviderDrainMode;
}

/**
 * Drain mode for async media channels (D-080 C4).
 * `draining` rejects new submit but continues poll/download/cancel/recover.
 */
export type MediaProviderDrainMode = 'accepting' | 'draining';

export interface MediaProviderLifecyclePort {
  submit(
    request: MediaProviderEffectRequest
  ): Promise<MediaProviderSubmissionReceipt>;
  recover(
    request: MediaProviderEffectRequest
  ): Promise<MediaProviderSubmissionReceipt | null>;
  poll(request: MediaProviderEffectRequest & { taskRef: string }): Promise<{
    status: 'queued' | 'running' | 'completed' | 'failed' | 'unknown';
    providerCost: Omit<ProviderCost, 'id' | 'status'>;
    errorCode?: string;
    retryable?: boolean;
    error?: string;
    sourceExpiresAt?: string;
  }>;
  download(request: MediaProviderEffectRequest & { taskRef: string }): Promise<{
    bytes: Uint8Array;
    contentType: OwnedAsset['contentType'];
    sourceExpiresAt?: string;
  }>;
  cancel(
    request: MediaProviderEffectRequest & { taskRef: string }
  ): Promise<void | {
    status: 'cancelled' | 'pending';
    errorCode?: string;
    retryable?: boolean;
    error?: string;
  }>;
  /**
   * Optional thin hooks for MP-04I/V conformance.
   * Production image/video adapters implement these; test fakes may omit them.
   */
  reportHealth?():
    | MediaProviderHealthReport
    | Promise<MediaProviderHealthReport>;
  setDrainMode?(mode: MediaProviderDrainMode): void | Promise<void>;
  getDrainMode?(): MediaProviderDrainMode;
}

/**
 * Durable receipt store for cross-process recover after kill-restart.
 * Keyed by adapter scope (workspace + effect key + model + credential).
 */
export interface MediaProviderReceiptStore {
  get(scope: string): Promise<MediaProviderSubmissionReceipt | undefined>;
  put(scope: string, receipt: MediaProviderSubmissionReceipt): Promise<void>;
}
