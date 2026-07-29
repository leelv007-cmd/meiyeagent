/**
 * Pure durable video-workflow types extracted from model-supply/index.ts (S1 / #87).
 *
 * WT-E exclusive owner after extract. As of #102, DurableVideoWorkflow is a
 * **derived projection** of CanonicalVideoRun (Task/Job/Asset-shaped truth in
 * `video-workflow-canonical.ts`). Prefer VideoWorkflowCanonicalCommandPort for
 * writes; InMemoryDurableVideoWorkflowStore is a deprecated adapter.
 *
 * Foundation deps (RouteSnapshot, OwnedAsset, …) remain defined earlier in
 * index.ts; this module uses type-only imports so there is no runtime cycle.
 */

import type { CreativeExecutionContract } from '@meiye/contracts';
import type {
  DataClass,
  OwnedAsset,
  ProviderAttempt,
  ProviderCost,
  RouteSnapshot,
  VideoQualityAssessment,
} from './index.js';

export interface VideoWorkflowShotInput {
  id?: string;
  prompt: string;
  candidatesPerShot: number;
  durationSeconds?: number;
  height?: number;
  width?: number;
}

export type VideoExecutionContract = CreativeExecutionContract & {
  aspectRatio: NonNullable<CreativeExecutionContract['aspectRatio']>;
  durationSeconds: number;
  operation: 'video.generate';
};

export type VideoWorkflowDeliveryMode =
  | 'content_package'
  | 'candidate_only';

export interface DurableVideoCandidate {
  index: number;
  generationKey: string;
  prompt: string;
  status: 'generated' | 'completed' | 'unknown' | 'failed';
  attempt: ProviderAttempt;
  attempts: ProviderAttempt[];
  taskRef?: string;
  providerCost: ProviderCost;
  providerCosts: ProviderCost[];
  latencyMs: number;
  asset?: OwnedAsset;
  technicalValidation?: OwnedAsset['technicalValidation'];
  quality?: VideoQualityAssessment;
  failureCode?: string;
  selectionReason?: string;
  routeSnapshot: RouteSnapshot;
}

export interface DurableVideoShot {
  id: string;
  prompt: string;
  candidatesPerShot: number;
  durationSeconds?: number;
  height?: number;
  width?: number;
  candidates: DurableVideoCandidate[];
  selectedCandidateIndex?: number;
  selectionReason?: string;
  selectionAudit?: {
    selectedBy: string;
    correlationId: string;
    selectedAt: string;
    source: 'human_quality_review';
  };
}

export interface SelectVideoCandidateInput {
  workflowId: string;
  shotId: string;
  candidateIndex: number;
  workspaceId: string;
  actorId: string;
  correlationId: string;
}

export interface DurableVideoWorkflow {
  id: string;
  workspaceId: string;
  actorId: string;
  /** Missing only on workflows created before the Work-bound UI shipped. */
  workId?: string;
  /** Parent ProductBilling task for an initial Operations submission. */
  billingTaskId?: string;
  /** Accepted parent quote revision frozen by Operations before dispatch. */
  billingQuoteRevision?: string;
  approvalReceiptId?: string;
  derivedFromWorkflowId?: string;
  deliveryMode?: VideoWorkflowDeliveryMode;
  storyboardVersion: number;
  dataClass: DataClass[];
  aigcLabelEnabled: boolean;
  brandWatermarkText?: string;
  storyboardRevision: string;
  confirmed: boolean;
  catalogModelId: string;
  referenceAssetIds?: string[];
  /** Missing only on workflows created before the frozen video contract shipped. */
  executionContract?: VideoExecutionContract;
  /** Historical read-only subtitle text retained for legacy projection. */
  subtitleText?: string;
  shots: DurableVideoShot[];
  attempts: ProviderAttempt[];
  clipAssets: OwnedAsset[];
  status:
    | 'draft'
    | 'running'
    | 'awaiting_quality_review'
    | 'cancel_requested'
    | 'completed'
    | 'cancelled'
    | 'failed';
  failureCode?: string;
  composedAsset?: OwnedAsset & { qualityScore?: never };
  routeSnapshot?: RouteSnapshot;
  revision: number;
  cancelRequestedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateVideoWorkflowInput {
  workflowId?: string;
  workspaceId: string;
  actorId: string;
  workId?: string;
  billingTaskId?: string;
  billingQuoteRevision?: string;
  approvalReceiptId?: string;
  derivedFromWorkflowId?: string;
  deliveryMode?: VideoWorkflowDeliveryMode;
  dataClass: DataClass[];
  aigcLabelEnabled?: boolean;
  brandWatermarkText?: string;
  storyboardRevision: string;
  catalogModelId: string;
  referenceAssetIds?: string[];
  executionContract?: VideoExecutionContract;
  shots: Array<string | VideoWorkflowShotInput>;
}

export type EditVideoWorkflowInput = {
  workflowId: string;
  workspaceId: string;
  actorId: string;
  correlationId: string;
  expectedRevision: number;
  edit:
    | { kind: 'select_candidate'; shotId: string; candidateIndex: number }
    | { kind: 'reorder_shots'; shotIds: string[] };
};

/** A production adapter persists this serializable state beside the JobPort. */
export interface DurableVideoWorkflowSaveOptions {
  expectedRevision?: number;
  runLeaseToken?: string;
  completeCancellation?: boolean;
}

export class VideoWorkflowConcurrencyError extends Error {
  readonly code = 'VIDEO_WORKFLOW_STALE_LEASE';
}

export class VideoWorkflowCancellationError extends Error {
  readonly code = 'VIDEO_WORKFLOW_CANCEL_REQUESTED';
}

export interface DurableVideoWorkflowStore {
  get(id: string): DurableVideoWorkflow | undefined;
  list(workspaceId: string, actorId: string): DurableVideoWorkflow[];
  findLatest(
    workspaceId: string,
    actorId: string,
    workId?: string
  ): DurableVideoWorkflow | undefined;
  save(
    workflow: DurableVideoWorkflow,
    options?: DurableVideoWorkflowSaveOptions
  ): DurableVideoWorkflow;
  claimRun(
    id: string,
    workspaceId: string,
    leaseToken: string
  ): DurableVideoWorkflow;
  requestCancel(
    id: string,
    workspaceId: string,
    requestedAt: string
  ): DurableVideoWorkflow;
  edit?(
    input: EditVideoWorkflowInput,
    editedAt: string,
  ): DurableVideoWorkflow;
  assertRunnable(
    id: string,
    workspaceId: string,
    revision: number,
    leaseToken: string
  ): void;
}
