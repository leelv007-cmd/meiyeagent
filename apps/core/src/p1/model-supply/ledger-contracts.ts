/**
 * S2a behavior-preserving extract: ledger / result contracts.
 * ProductUsage remains here pending #92 replacement; re-exported for compatibility.
 */
import type {
  GeneratedCopyCandidateContent,
  GeneratedPlatformVariants,
} from '@meiye/contracts';
import type { StructuredObjectMeasurement } from './provider-lifecycle.js';
import type {
	AdvancedCanvasGenerationOrigin,
	AdvancedCanvasGenerationOriginRef,
  CatalogModel,
  CanvasGenerationInputAsset,
  CanvasGenerationInputNodeBinding,
  ModelDeployment,
  ModelOperation,
  OwnedAsset,
} from './supply-contracts.js';
import type {
  ModelSupplySubmission,
  ProviderAttempt,
  RouteSnapshot,
} from './route-contracts.js';

export interface ProductUsage {
  id: string;
  status: 'reserved' | 'committed' | 'refunded';
  quantity: number;
}

export interface ProviderCost {
  id: string;
  status: 'estimated' | 'observed';
  amount: number;
  currency: 'CNY' | 'USD';
  usage: { inputTokens?: number; outputTokens?: number; mediaUnits?: number };
}

export interface CancelledMediaProviderTerminalReconciliation {
  reconciliationKey: string;
  providerTaskRef: string;
  providerStatus: 'completed' | 'failed';
  isolatedFromCancelledWorkflow: true;
  providerCost: ProviderCost;
  asset?: OwnedAsset;
  errorCode?: string;
  retryable?: boolean;
  error?: string;
  reconciledAt: string;
}

export type CopyCandidate = GeneratedCopyCandidateContent;

export function copyCandidateBodiesAreDistinct(
  candidates: readonly Pick<CopyCandidate, 'body'>[]
) {
  const normalizedBodies = candidates.map((candidate) =>
    candidate.body.replace(/\s+/gu, ' ').trim().toLowerCase()
  );
  return new Set(normalizedBodies).size === candidates.length;
}

export interface ModelSupplyResult {
  jobId: string;
  /** Durable repository-observed terminal time; absent while outcome is unknown. */
  endedAt?: string;
  /** End-to-end elapsed time from the first provider attempt to endedAt. */
  latencyMs?: number;
  operation?: ModelOperation;
  inputAssets?: CanvasGenerationInputAsset[];
  inputNodeBindings?: CanvasGenerationInputNodeBinding[];
  dispatchStatus?: 'queued';
  status: 'completed' | 'unknown' | 'failed';
	failureCode?: string;
	retryable?: boolean;
	origin?: AdvancedCanvasGenerationOrigin;
	originRef?: AdvancedCanvasGenerationOriginRef;
	snapshot: RouteSnapshot;
  attempt: ProviderAttempt;
  attempts: ProviderAttempt[];
  asset?: OwnedAsset;
  copyCandidates?: CopyCandidate[];
  platformVariants?: GeneratedPlatformVariants;
  text?: string;
  structuredOutput?: unknown;
  structuredMeasurement?: StructuredObjectMeasurement;
  usage: ProductUsage;
  providerCost: ProviderCost;
  providerCosts: ProviderCost[];
  cancelledProviderTerminal?: CancelledMediaProviderTerminalReconciliation;
}

export interface DurableMediaGenerationJobView {
  jobId: string;
  workspaceId: string;
  status:
    | 'queued'
    | 'running'
    | 'unknown'
    | 'cancel_requested'
    | 'cancelled'
    | 'completed'
    | 'failed';
  providerTaskRef?: string;
  /** End-to-end provider lifecycle observed by the durable tracer. */
  providerLifecycleLatencyMs: number;
  cancelledProviderTerminal?: CancelledMediaProviderTerminalReconciliation;
  result: ModelSupplyResult;
}

export type CancelledMediaProviderTerminalOutcome =
  | {
      status: 'pending';
      result: ModelSupplyResult;
      errorCode?: string;
      retryable?: boolean;
      error?: string;
    }
  | {
      status: 'completed' | 'failed';
      result: ModelSupplyResult;
      reconciliation: CancelledMediaProviderTerminalReconciliation;
    };

export interface DurableMediaGenerationRuntimePort {
  submit(submission: ModelSupplySubmission): Promise<ModelSupplyResult>;
  get(
    workspaceId: string,
    jobId: string
  ): Promise<DurableMediaGenerationJobView>;
  cancel(input: {
    workspaceId: string;
    jobId: string;
    actorId: string;
  }): Promise<DurableMediaGenerationJobView>;
  reconcileCancelledProviderTerminal(input: {
    workspaceId: string;
    jobId: string;
    providerTaskRef: string;
  }): Promise<CancelledMediaProviderTerminalOutcome>;
}

export interface ModelSupplyResultSink {
  saveResult(workspaceId: string, result: ModelSupplyResult): Promise<void>;
}

export interface ModelSupplyLedgerCheckpointInput {
  submission: ModelSupplySubmission;
  jobId: string;
  attemptId: string;
  ordinal: number;
  snapshot: RouteSnapshot;
  model: CatalogModel;
  deployment: ModelDeployment;
  previousAttempts: ProviderAttempt[];
  previousProviderCosts: ProviderCost[];
}

export interface ModelSupplyLedgerPort {
  checkpointAttempt(
    input: ModelSupplyLedgerCheckpointInput
  ): Promise<{ replayed: boolean; recoveredResult?: ModelSupplyResult }>;
  /** Freeze route/credential/pool/price facts after admission and before provider I/O. */
  freezeAttempt?(input: ModelSupplyLedgerCheckpointInput): Promise<unknown>;
  settleAttempt(input: {
    submission: ModelSupplySubmission;
    result: ModelSupplyResult;
    evidence: string;
  }): Promise<void>;
  recordCancelledProviderTerminal?(input: {
    submission: ModelSupplySubmission;
    result: ModelSupplyResult;
    reconciliation: CancelledMediaProviderTerminalReconciliation;
    evidence: string;
  }): Promise<void>;
  /** Td-2: restore allowance after outer delivery failure post-commit. */
  compensateCommittedUsage?(input: {
    workspaceId: string;
    actorId: string;
    correlationId?: string;
    jobId: string;
    reason: string;
  }): Promise<unknown>;
}
