/**
 * Pure VideoWorkflow projection (WT-E / #102).
 *
 * CanonicalVideoRun assembles generic Task/Job/Asset facts in memory. These
 * functions only derive read models:
 * - DurableVideoWorkflow — internal execution/audit projection (compat shape)
 * - VideoWorkflowPublicProjection — cross-lane consumer contract (no provider detail)
 *
 * Never mutate canonical state from this module.
 */

import type { VideoWorkflowPublicProjection } from '@meiye/contracts';
import type {
  DurableVideoCandidate,
  DurableVideoShot,
  DurableVideoWorkflow,
  VideoWorkflowDeliveryMode,
} from './video-workflow-contract.js';
import type { OwnedAsset } from './supply-contracts.js';

export type CanonicalVideoShotPlan = Omit<DurableVideoShot, 'candidates'>;

export type CanonicalVideoCandidateRecord = Omit<
  DurableVideoCandidate,
  'asset'
> & {
  assetId?: string;
};

/** Task-shaped plan: storyboard intent and shot plan (+ candidate results). */
export interface CanonicalVideoTask {
  kind: 'video.composed';
  storyboardVersion: number;
  storyboardRevision: string;
  catalogModelId: string;
  dataClass: DurableVideoWorkflow['dataClass'];
  aigcLabelEnabled: boolean;
  brandWatermarkText?: string;
  referenceAssetIds?: string[];
  executionContract?: DurableVideoWorkflow['executionContract'];
  approvalReceiptId?: string;
  derivedFromRunId?: string;
  deliveryMode?: VideoWorkflowDeliveryMode;
  billingTaskId?: string;
  billingQuoteRevision?: string;
  shots: CanonicalVideoShotPlan[];
  subtitleText?: string;
}

/** Job-shaped lifecycle + OCC. */
export interface CanonicalVideoJob {
  status: DurableVideoWorkflow['status'];
  confirmed: boolean;
  revision: number;
  failureCode?: string;
  cancelRequestedAt?: string;
  candidatesByShot: Record<string, CanonicalVideoCandidateRecord[]>;
  attempts: DurableVideoWorkflow['attempts'];
  routeSnapshot?: DurableVideoWorkflow['routeSnapshot'];
  createdAt: string;
  updatedAt: string;
}

/** Asset-shaped generation outputs and routing audit. */
export interface CanonicalVideoAssets {
  byId: Record<string, OwnedAsset>;
  clipAssetIds: string[];
  composedAssetId?: string;
}

/** In-process assembly of the existing generic canonical records. */
export interface CanonicalVideoRun {
  runId: string;
  workspaceId: string;
  actorId: string;
  workId?: string;
  task: CanonicalVideoTask;
  job: CanonicalVideoJob;
  assets: CanonicalVideoAssets;
}

export type CanonicalVideoRunStatus = DurableVideoWorkflow['status'];

/** Flatten canonical Task/Job/Asset records into the durable projection shape. */
export function projectDurableVideoWorkflow(
  run: CanonicalVideoRun
): DurableVideoWorkflow {
  return {
    id: run.runId,
    workspaceId: run.workspaceId,
    actorId: run.actorId,
    ...(run.workId ? { workId: run.workId } : {}),
    ...(run.task.billingTaskId
      ? { billingTaskId: run.task.billingTaskId }
      : {}),
    ...(run.task.billingQuoteRevision
      ? { billingQuoteRevision: run.task.billingQuoteRevision }
      : {}),
    ...(run.task.approvalReceiptId
      ? { approvalReceiptId: run.task.approvalReceiptId }
      : {}),
    ...(run.task.derivedFromRunId
      ? { derivedFromWorkflowId: run.task.derivedFromRunId }
      : {}),
    ...(run.task.deliveryMode
      ? { deliveryMode: run.task.deliveryMode }
      : {}),
    storyboardVersion: run.task.storyboardVersion,
    dataClass: structuredClone(run.task.dataClass),
    aigcLabelEnabled: run.task.aigcLabelEnabled,
    ...(run.task.brandWatermarkText
      ? { brandWatermarkText: run.task.brandWatermarkText }
      : {}),
    storyboardRevision: run.task.storyboardRevision,
    confirmed: run.job.confirmed,
    catalogModelId: run.task.catalogModelId,
    ...(run.task.referenceAssetIds
      ? { referenceAssetIds: structuredClone(run.task.referenceAssetIds) }
      : {}),
    ...(run.task.executionContract
      ? { executionContract: structuredClone(run.task.executionContract) }
      : {}),
    shots: run.task.shots.map((shot) => ({
      ...structuredClone(shot),
      candidates: (run.job.candidatesByShot[shot.id] ?? []).map(
        ({ assetId, ...candidate }) => ({
          ...structuredClone(candidate),
          ...(assetId && run.assets.byId[assetId]
            ? { asset: structuredClone(run.assets.byId[assetId]) }
            : {}),
        }),
      ),
    })),
    ...(run.task.subtitleText !== undefined
      ? { subtitleText: run.task.subtitleText }
      : {}),
    attempts: structuredClone(run.job.attempts),
    clipAssets: run.assets.clipAssetIds.flatMap((assetId) =>
      run.assets.byId[assetId]
        ? [structuredClone(run.assets.byId[assetId])]
        : [],
    ),
    status: run.job.status,
    ...(run.job.failureCode ? { failureCode: run.job.failureCode } : {}),
    ...(run.assets.composedAssetId &&
    run.assets.byId[run.assets.composedAssetId]
      ? {
          composedAsset: structuredClone(
            run.assets.byId[run.assets.composedAssetId],
          ),
        }
      : {}),
    ...(run.job.routeSnapshot
      ? { routeSnapshot: structuredClone(run.job.routeSnapshot) }
      : {}),
    revision: run.job.revision,
    ...(run.job.cancelRequestedAt
      ? { cancelRequestedAt: run.job.cancelRequestedAt }
      : {}),
    createdAt: run.job.createdAt,
    updatedAt: run.job.updatedAt,
  };
}

/**
 * Public cross-lane projection — ids, lifecycle, shot summary only.
 * Explicitly omits ProviderAttempt, credentials, route internals, and assets.
 */
export function projectVideoWorkflowPublic(
  source: CanonicalVideoRun | DurableVideoWorkflow
): VideoWorkflowPublicProjection {
  const durable =
    'runId' in source ? projectDurableVideoWorkflow(source) : source;
  return {
    workflowId: durable.id,
    ...(durable.workId ? { workId: durable.workId } : {}),
    status: durable.status,
    storyboardVersion: durable.storyboardVersion,
    storyboardRevision: durable.storyboardRevision,
    catalogModelId: durable.catalogModelId,
    confirmed: durable.confirmed,
    shots: durable.shots.map((shot) => ({
      shotId: shot.id,
      ...(shot.prompt
        ? {
            promptPreview:
              shot.prompt.length > 80
                ? `${shot.prompt.slice(0, 77)}...`
                : shot.prompt,
          }
        : {}),
      candidatesPerShot: shot.candidatesPerShot,
      ...(shot.selectedCandidateIndex !== undefined
        ? { selectedCandidateIndex: shot.selectedCandidateIndex }
        : {}),
      candidateCount: shot.candidates.length,
    })),
    ...(durable.failureCode ? { failureCode: durable.failureCode } : {}),
    ...(durable.subtitleText !== undefined
      ? { subtitleText: durable.subtitleText }
      : {}),
    revision: durable.revision,
    updatedAt: durable.updatedAt,
  };
}

/**
 * Lift a legacy durable row / runner working copy into canonical Task/Job/Asset shape.
 * Used by migration dual-read and by the deprecated store adapter.
 */
export function liftDurableToCanonical(
  workflow: DurableVideoWorkflow
): CanonicalVideoRun {
  const assets = new Map<string, OwnedAsset>();
  for (const shot of workflow.shots) {
    for (const candidate of shot.candidates) {
      if (candidate.asset) assets.set(candidate.asset.id, candidate.asset);
    }
  }
  for (const asset of workflow.clipAssets) assets.set(asset.id, asset);
  if (workflow.composedAsset) {
    assets.set(workflow.composedAsset.id, workflow.composedAsset);
  }
  return {
    runId: workflow.id,
    workspaceId: workflow.workspaceId,
    actorId: workflow.actorId,
    ...(workflow.workId ? { workId: workflow.workId } : {}),
    task: {
      kind: 'video.composed',
      storyboardVersion: workflow.storyboardVersion,
      storyboardRevision: workflow.storyboardRevision,
      catalogModelId: workflow.catalogModelId,
      dataClass: structuredClone(workflow.dataClass),
      aigcLabelEnabled: workflow.aigcLabelEnabled,
      ...(workflow.brandWatermarkText
        ? { brandWatermarkText: workflow.brandWatermarkText }
        : {}),
      ...(workflow.referenceAssetIds
        ? { referenceAssetIds: structuredClone(workflow.referenceAssetIds) }
        : {}),
      ...(workflow.executionContract
        ? { executionContract: structuredClone(workflow.executionContract) }
        : {}),
      ...(workflow.approvalReceiptId
        ? { approvalReceiptId: workflow.approvalReceiptId }
        : {}),
      ...(workflow.derivedFromWorkflowId
        ? { derivedFromRunId: workflow.derivedFromWorkflowId }
        : {}),
      ...(workflow.deliveryMode
        ? { deliveryMode: workflow.deliveryMode }
        : {}),
      ...(workflow.billingTaskId
        ? { billingTaskId: workflow.billingTaskId }
        : {}),
      ...(workflow.billingQuoteRevision
        ? { billingQuoteRevision: workflow.billingQuoteRevision }
        : {}),
      shots: workflow.shots.map(({ candidates: _candidates, ...shot }) =>
        structuredClone(shot),
      ),
      ...(workflow.subtitleText !== undefined
        ? { subtitleText: workflow.subtitleText }
        : {}),
    },
    job: {
      status: workflow.status,
      confirmed: workflow.confirmed,
      revision: workflow.revision,
      ...(workflow.failureCode ? { failureCode: workflow.failureCode } : {}),
      ...(workflow.cancelRequestedAt
        ? { cancelRequestedAt: workflow.cancelRequestedAt }
        : {}),
      candidatesByShot: Object.fromEntries(
        workflow.shots.map((shot) => [
          shot.id,
          shot.candidates.map(({ asset, ...candidate }) => ({
            ...structuredClone(candidate),
            ...(asset ? { assetId: asset.id } : {}),
          })),
        ]),
      ),
      attempts: structuredClone(workflow.attempts),
      ...(workflow.routeSnapshot
        ? { routeSnapshot: structuredClone(workflow.routeSnapshot) }
        : {}),
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
    },
    assets: {
      byId: Object.fromEntries(
        [...assets.entries()].map(([id, asset]) => [
          id,
          structuredClone(asset),
        ]),
      ),
      clipAssetIds: workflow.clipAssets.map((asset) => asset.id),
      ...(workflow.composedAsset
        ? { composedAssetId: workflow.composedAsset.id }
        : {}),
    },
  };
}

/** True when two durable projections are byte-identical under JSON. */
export function isSameDurableVideoWorkflow(
  left: DurableVideoWorkflow,
  right: DurableVideoWorkflow
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Assert a serialized public projection never leaks provider/credential fields.
 * Used by derivation tests; safe to call on any consumer-facing payload.
 */
export function assertPublicProjectionIsSanitized(
  projection: VideoWorkflowPublicProjection
) {
  const json = JSON.stringify(projection);
  const forbidden = [
    'provider',
    'Provider',
    'credential',
    'Credential',
    'secret',
    'Secret',
    'apiKey',
    'routeSnapshot',
    'providerCost',
    'providerCosts',
    'attempts',
    'composedAsset',
    'clipAssets',
  ];
  for (const token of forbidden) {
    if (json.includes(token)) {
      throw new Error(
        `Public video-workflow projection leaked sensitive field token: ${token}`
      );
    }
  }
}
