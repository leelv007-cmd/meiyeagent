/**
 * Canonical video Task / Job / Asset command model (WT-E / #102).
 *
 * Production truth lives in the existing generic Task / Job / Asset records.
 * CanonicalVideoRun is only their in-process command/projection assembly.
 * VideoWorkflow (DurableVideoWorkflow + public projection) is derived read-only.
 *
 * Production commands mutate the asynchronous PostgreSQL store; projections
 * never write back as authority.
 *
 * Does NOT import model-supply/index.ts (avoids cycles with the adapter re-export).
 */

import type {
  DurableVideoWorkflowSaveOptions,
  EditVideoWorkflowInput,
} from './video-workflow-contract.js';
import {
  VideoWorkflowCancellationError,
  VideoWorkflowConcurrencyError,
} from './video-workflow-contract.js';
import type { CanonicalVideoRun } from './video-workflow-projection.js';
import {
  isSameDurableVideoWorkflow,
  projectDurableVideoWorkflow,
} from './video-workflow-projection.js';

export type {
  CanonicalVideoAssets,
  CanonicalVideoJob,
  CanonicalVideoRun,
  CanonicalVideoRunStatus,
  CanonicalVideoTask,
} from './video-workflow-projection.js';

export interface AsyncCanonicalVideoRunStore {
  getRun(runId: string): Promise<CanonicalVideoRun | undefined>;
  listRuns(workspaceId: string, actorId: string): Promise<CanonicalVideoRun[]>;
  findLatestRun(
    workspaceId: string,
    actorId: string,
    workId?: string,
  ): Promise<CanonicalVideoRun | undefined>;
  putRun(
    run: CanonicalVideoRun,
    options?: DurableVideoWorkflowSaveOptions,
  ): Promise<CanonicalVideoRun>;
  claimRun(
    runId: string,
    workspaceId: string,
    leaseToken: string,
  ): Promise<CanonicalVideoRun>;
  requestCancel(
    runId: string,
    workspaceId: string,
    requestedAt: string,
  ): Promise<CanonicalVideoRun>;
  editRun(
    input: EditVideoWorkflowInput,
    editedAt: string,
  ): Promise<CanonicalVideoRun>;
  assertRunnable(
    runId: string,
    workspaceId: string,
    revision: number,
    leaseToken: string,
  ): Promise<void>;
}


function cloneRun(run: CanonicalVideoRun): CanonicalVideoRun {
  return structuredClone(run);
}

export function normalizeCanonicalVideoRun(
  run: CanonicalVideoRun,
): CanonicalVideoRun {
  const cloned = cloneRun(run);
  return {
    ...cloned,
    task: {
      ...cloned.task,
      ...(cloned.task.referenceAssetIds
        ? {
            referenceAssetIds: [
              ...new Set(
                cloned.task.referenceAssetIds
                  .map((id) => id.trim())
                  .filter(Boolean),
              ),
            ],
          }
        : {}),
      storyboardVersion:
        Number.isInteger(cloned.task.storyboardVersion) &&
        cloned.task.storyboardVersion >= 1
          ? cloned.task.storyboardVersion
          : 1,
    },
    job: {
      ...cloned.job,
      revision:
        Number.isInteger(cloned.job.revision) && cloned.job.revision >= 0
          ? cloned.job.revision
          : 0,
    },
  };
}

export function applyCanonicalVideoEdit(
  current: CanonicalVideoRun,
  input: EditVideoWorkflowInput,
  editedAt: string,
) {
  if (
    current.workspaceId !== input.workspaceId ||
    current.runId !== input.workflowId
  ) {
    throw new Error('Video workflow belongs to another workspace.');
  }
  if (current.job.revision !== input.expectedRevision) {
    throw new VideoWorkflowConcurrencyError('Video workflow revision is stale.');
  }
  if (current.job.status !== 'awaiting_quality_review') {
    throw new Error(
      'Only a reviewable video workflow can be edited; terminal workflows are read only.',
    );
  }
  const edited = cloneRun(current);
  const edit = input.edit;
  if (edit.kind === 'select_candidate') {
    const shot = edited.task.shots.find(
      (candidate) => candidate.id === edit.shotId,
    );
    if (!shot) throw new Error(`Unknown video shot ${edit.shotId}.`);
    const candidate = edited.job.candidatesByShot[shot.id]?.find(
      (value) => value.index === edit.candidateIndex,
    );
    if (
      !candidate?.assetId ||
      !edited.assets.byId[candidate.assetId] ||
      candidate.status !== 'completed' ||
      candidate.technicalValidation?.playable !== true
    ) {
      throw new Error(
        `Candidate ${edit.candidateIndex} for shot ${shot.id} is not eligible for selection.`,
      );
    }
    const selectedAt = editedAt;
    shot.selectedCandidateIndex = candidate.index;
    shot.selectionReason = `Candidate ${candidate.index + 1} was explicitly selected in the video workspace.`;
    shot.selectionAudit = {
      selectedBy: requireText(input.actorId, 'actorId'),
      correlationId: requireText(input.correlationId, 'correlationId'),
      selectedAt,
      source: 'human_quality_review',
    };
    for (const peer of edited.job.candidatesByShot[shot.id] ?? []) {
      peer.selectionReason =
        peer.index === candidate.index
          ? shot.selectionReason
          : 'Not selected in the current canonical shot revision.';
    }
  } else if (edit.kind === 'reorder_shots') {
    const shotIds = edit.shotIds.map((shotId) =>
      requireText(shotId, 'shotId'),
    );
    if (
      shotIds.length !== edited.task.shots.length ||
      new Set(shotIds).size !== shotIds.length ||
      shotIds.some(
        (shotId) => !edited.task.shots.some((shot) => shot.id === shotId),
      )
    ) {
      throw new Error('Shot order must contain every canonical shot exactly once.');
    }
    const byId = new Map(edited.task.shots.map((shot) => [shot.id, shot]));
    edited.task.shots = shotIds.map((shotId) => byId.get(shotId)!);
  } else {
    throw new Error(
      `Unsupported video edit ${(edit as { kind?: unknown }).kind}.`,
    );
  }
  edited.assets.clipAssetIds = edited.task.shots.flatMap((shot) => {
    const selected = edited.job.candidatesByShot[shot.id]?.find(
      (candidate) => candidate.index === shot.selectedCandidateIndex,
    );
    return selected?.assetId && edited.assets.byId[selected.assetId]
      ? [selected.assetId]
      : [];
  });
  edited.job = {
    ...edited.job,
    revision: edited.job.revision + 1,
    updatedAt: editedAt,
  };
  return normalizeCanonicalVideoRun(edited);
}

export function assertCanonicalVideoMutationAllowed(
  current: CanonicalVideoRun,
  candidate: CanonicalVideoRun,
  expectedRevision: number,
  activeLeaseToken: string | undefined,
  options: DurableVideoWorkflowSaveOptions
) {
  const currentProjection = projectDurableVideoWorkflow(current);
  const candidateProjection = projectDurableVideoWorkflow(candidate);
  if (
    current.workspaceId !== candidate.workspaceId ||
    current.runId !== candidate.runId
  ) {
    throw new VideoWorkflowConcurrencyError(
      'Video workflow identity changed during persistence.'
    );
  }
  if (
    current.job.status === 'completed' ||
    current.job.status === 'failed'
  ) {
    if (isSameDurableVideoWorkflow(currentProjection, candidateProjection))
      return;
    throw new VideoWorkflowConcurrencyError(
      'A terminal video workflow cannot be overwritten.'
    );
  }
  if (current.job.status === 'cancelled') {
    if (isSameDurableVideoWorkflow(currentProjection, candidateProjection))
      return;
    throw new VideoWorkflowCancellationError(
      'Video workflow cancellation was requested.'
    );
  }
  if (current.job.status === 'cancel_requested') {
    if (
      !options.completeCancellation ||
      candidate.job.status !== 'cancelled' ||
      candidate.job.cancelRequestedAt !== current.job.cancelRequestedAt
    ) {
      throw new VideoWorkflowCancellationError(
        'Video workflow cancellation was requested.'
      );
    }
  } else if (options.completeCancellation) {
    throw new VideoWorkflowConcurrencyError(
      'Video workflow cancellation has not been requested.'
    );
  }
  if (current.job.revision !== expectedRevision) {
    throw new VideoWorkflowConcurrencyError(
      'Video workflow revision is stale.'
    );
  }
  if (options.runLeaseToken) {
    if (activeLeaseToken !== options.runLeaseToken) {
      throw new VideoWorkflowConcurrencyError(
        'Video workflow result belongs to a stale run lease.'
      );
    }
  } else if (
    current.job.status === 'running' &&
    !options.completeCancellation
  ) {
    throw new VideoWorkflowConcurrencyError(
      'A running video workflow requires its run lease.'
    );
  }
  if (candidate.job.status === 'completed' && !options.runLeaseToken) {
    throw new VideoWorkflowConcurrencyError(
      'Video workflow completion requires its run lease.'
    );
  }
}

export function assertCanonicalVideoRunIsRunnable(
  current: CanonicalVideoRun,
  expectedRevision: number,
  activeLeaseToken: string | undefined,
  suppliedLeaseToken: string,
) {
  if (
    current.job.status === 'cancel_requested' ||
    current.job.status === 'cancelled'
  ) {
    throw new VideoWorkflowCancellationError(
      'Video workflow cancellation was requested.'
    );
  }
  if (
    current.job.status !== 'running' ||
    current.job.revision !== expectedRevision ||
    activeLeaseToken !== suppliedLeaseToken
  ) {
    throw new VideoWorkflowConcurrencyError(
      'Video workflow result belongs to a stale run lease.'
    );
  }
}

export function isCanonicalVideoLeaseReleasingStatus(
  status: CanonicalVideoRun['job']['status'],
) {
  return (
    status === 'completed' ||
    status === 'cancelled' ||
    status === 'failed' ||
    status === 'awaiting_quality_review'
  );
}

function requireText(value: string, key: string) {
  if (value.trim().length === 0) throw new Error(`${key} is required.`);
  return value;
}
