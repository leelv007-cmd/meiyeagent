/**
 * Canonical video Task / Job / Asset command model (WT-E / #102).
 *
 * Production truth lives in the existing generic Task / Job / Asset records.
 * CanonicalVideoRun is only their in-process command/projection assembly.
 * VideoWorkflow (DurableVideoWorkflow + public projection) is derived read-only.
 *
 * Commands mutate this store; projections never write back as authority.
 * The deprecated InMemoryDurableVideoWorkflowStore adapter delegates here.
 *
 * Does NOT import model-supply/index.ts (avoids cycles with the adapter re-export).
 */

import type {
  CreateVideoWorkflowInput,
  DurableVideoWorkflow,
  DurableVideoWorkflowSaveOptions,
  EditVideoWorkflowInput,
  SelectVideoCandidateInput,
} from './video-workflow-contract.js';
import {
  VideoWorkflowCancellationError,
  VideoWorkflowConcurrencyError,
} from './video-workflow-contract.js';
import type { CanonicalVideoRun } from './video-workflow-projection.js';
import {
  isSameDurableVideoWorkflow,
  liftDurableToCanonical,
  projectDurableVideoWorkflow,
} from './video-workflow-projection.js';

export type {
  CanonicalVideoAssets,
  CanonicalVideoJob,
  CanonicalVideoRun,
  CanonicalVideoRunStatus,
  CanonicalVideoTask,
} from './video-workflow-projection.js';

type DurableRouteSnapshot = NonNullable<DurableVideoWorkflow['routeSnapshot']>;

export interface CanonicalVideoRunStore {
  get(runId: string): CanonicalVideoRun | undefined;
  list(workspaceId: string, actorId: string): CanonicalVideoRun[];
  findLatest(
    workspaceId: string,
    actorId: string,
    workId?: string
  ): CanonicalVideoRun | undefined;
  /** Replace or insert a full canonical revision (OCC inside). */
  put(
    run: CanonicalVideoRun,
    options?: DurableVideoWorkflowSaveOptions
  ): CanonicalVideoRun;
  claimRun(
    runId: string,
    workspaceId: string,
    leaseToken: string
  ): CanonicalVideoRun;
  requestCancel(
    runId: string,
    workspaceId: string,
    requestedAt: string
  ): CanonicalVideoRun;
  edit(input: EditVideoWorkflowInput, editedAt: string): CanonicalVideoRun;
  assertRunnable(
    runId: string,
    workspaceId: string,
    revision: number,
    leaseToken: string
  ): void;
  getRunLease(runId: string): string | undefined;
  /** Import a legacy durable row without OCC (migration / dual-read seed). */
  restore(run: CanonicalVideoRun): CanonicalVideoRun;
}

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

/**
 * In-memory sole write authority for video runs.
 * Lease + OCC semantics mirror the former first-class workflow store.
 */
export class InMemoryCanonicalVideoRunStore implements CanonicalVideoRunStore {
  private readonly runs = new Map<string, CanonicalVideoRun>();
  private readonly runLeases = new Map<string, string>();

  get(runId: string) {
    const run = this.runs.get(runId);
    return run ? cloneRun(run) : undefined;
  }

  list(workspaceId: string, actorId: string) {
    return [...this.runs.values()]
      .filter(
        (run) => run.workspaceId === workspaceId && run.actorId === actorId
      )
      .sort((left, right) => {
        const updated = right.job.updatedAt.localeCompare(left.job.updatedAt);
        return updated === 0
          ? right.runId.localeCompare(left.runId)
          : updated;
      })
      .map(cloneRun);
  }

  findLatest(workspaceId: string, actorId: string, workId?: string) {
    const run = [...this.runs.values()]
      .filter(
        (candidate) =>
          candidate.workspaceId === workspaceId &&
          candidate.actorId === actorId &&
          (!workId || candidate.workId === workId)
      )
      .sort(
        workId
          ? compareCanonicalWorkRecoveryPriority
          : compareCanonicalRecoveryPriority
      )[0];
    return run ? cloneRun(run) : undefined;
  }

  restore(run: CanonicalVideoRun) {
    const normalized = normalizeCanonicalVideoRun(run);
    this.runs.set(normalized.runId, cloneRun(normalized));
    return cloneRun(normalized);
  }

  put(run: CanonicalVideoRun, options: DurableVideoWorkflowSaveOptions = {}) {
    const candidate = normalizeCanonicalVideoRun(run);
    const current = this.runs.get(candidate.runId);
    if (!current) {
      if ((options.expectedRevision ?? candidate.job.revision) !== 0) {
        throw new VideoWorkflowConcurrencyError(
          'Video workflow creation used a stale revision.'
        );
      }
      this.runs.set(candidate.runId, cloneRun(candidate));
      return cloneRun(candidate);
    }
    const expectedRevision =
      options.expectedRevision ?? candidate.job.revision;
    assertCanonicalVideoMutationAllowed(
      current,
      candidate,
      expectedRevision,
      this.runLeases.get(candidate.runId),
      options
    );
    if (
      isSameDurableVideoWorkflow(
        projectDurableVideoWorkflow(current),
        projectDurableVideoWorkflow(candidate)
      )
    ) {
      return cloneRun(current);
    }
    const saved: CanonicalVideoRun = {
      ...cloneRun(candidate),
      job: {
        ...cloneRun(candidate).job,
        revision: current.job.revision + 1,
      },
    };
    if (isCanonicalVideoLeaseReleasingStatus(saved.job.status)) {
      this.runLeases.delete(saved.runId);
    }
    this.runs.set(saved.runId, cloneRun(saved));
    return cloneRun(saved);
  }

  claimRun(runId: string, workspaceId: string, leaseToken: string) {
    const current = this.require(runId, workspaceId);
    if (
      current.job.status === 'cancel_requested' ||
      current.job.status === 'cancelled'
    ) {
      throw new VideoWorkflowCancellationError(
        'Video workflow cancellation was requested.'
      );
    }
    if (
      current.job.status === 'completed' ||
      current.job.status === 'failed'
    ) {
      return cloneRun(current);
    }
    if (!current.job.confirmed) {
      throw new Error(
        'Storyboard must be confirmed before clip attempts are created.'
      );
    }
    const claimed: CanonicalVideoRun = {
      ...cloneRun(current),
      job: {
        ...cloneRun(current).job,
        status: 'running',
        revision: current.job.revision + 1,
      },
    };
    this.runLeases.set(runId, leaseToken);
    this.runs.set(runId, cloneRun(claimed));
    return cloneRun(claimed);
  }

  requestCancel(runId: string, workspaceId: string, requestedAt: string) {
    const current = this.require(runId, workspaceId);
    if (
      current.job.status === 'completed' ||
      current.job.status === 'failed'
    ) {
      throw new Error('A terminal video workflow cannot be cancelled.');
    }
    if (
      current.job.status === 'cancel_requested' ||
      current.job.status === 'cancelled'
    ) {
      return cloneRun(current);
    }
    const requested: CanonicalVideoRun = {
      ...cloneRun(current),
      job: {
        ...cloneRun(current).job,
        status: 'cancel_requested',
        cancelRequestedAt: requestedAt,
        revision: current.job.revision + 1,
        updatedAt: requestedAt,
      },
    };
    this.runLeases.delete(runId);
    this.runs.set(runId, cloneRun(requested));
    return cloneRun(requested);
  }

  edit(input: EditVideoWorkflowInput, editedAt: string) {
    const current = this.require(input.workflowId, input.workspaceId);
    const edited = applyCanonicalVideoEdit(current, input, editedAt);
    this.runs.set(edited.runId, cloneRun(edited));
    return cloneRun(edited);
  }

  assertRunnable(
    runId: string,
    workspaceId: string,
    revision: number,
    leaseToken: string
  ) {
    const current = this.require(runId, workspaceId);
    assertCanonicalVideoRunIsRunnable(
      current,
      revision,
      this.runLeases.get(runId),
      leaseToken,
    );
  }

  getRunLease(runId: string) {
    return this.runLeases.get(runId);
  }

  private require(runId: string, workspaceId: string) {
    const current = this.runs.get(runId);
    if (!current || current.workspaceId !== workspaceId) {
      throw new Error(`Unknown workflow ${runId}.`);
    }
    return current;
  }
}

/**
 * Command port — sole intended write path for video-run lifecycle.
 * All methods return durable projections for runner/compat consumers.
 */
export interface VideoWorkflowCanonicalCommandPort {
  createDraft(
    input: CreateVideoWorkflowInput,
    options: {
      clock: () => number;
      newId: () => string;
      buildInitialProjection: (
        input: CreateVideoWorkflowInput,
        workflowId: string,
        timestamp: string
      ) => DurableVideoWorkflow;
      assertSameDraft: (
        existing: DurableVideoWorkflow,
        input: CreateVideoWorkflowInput
      ) => void;
      requireSource?: (
        derivedFromWorkflowId: string,
        workspaceId: string
      ) => DurableVideoWorkflow;
    }
  ): DurableVideoWorkflow;
  confirm(
    runId: string,
    workspaceId: string | undefined,
    routeSnapshot: DurableRouteSnapshot,
    clock: () => number
  ): DurableVideoWorkflow;
  selectCandidate(
    input: SelectVideoCandidateInput,
    clock: () => number
  ): DurableVideoWorkflow;
  edit(input: EditVideoWorkflowInput, clock: () => number): DurableVideoWorkflow;
  claimRun(
    runId: string,
    workspaceId: string,
    leaseToken: string
  ): DurableVideoWorkflow;
  /** Apply runner checkpoint — projection is a patch, not write authority. */
  checkpoint(
    projection: DurableVideoWorkflow,
    options?: DurableVideoWorkflowSaveOptions
  ): DurableVideoWorkflow;
  requestCancel(
    runId: string,
    workspaceId: string,
    requestedAt: string
  ): DurableVideoWorkflow;
  completeCancel(
    projection: DurableVideoWorkflow,
    expectedRevision: number
  ): DurableVideoWorkflow;
  assertRunnable(
    runId: string,
    workspaceId: string,
    revision: number,
    leaseToken: string
  ): void;
  get(runId: string): DurableVideoWorkflow | undefined;
  list(workspaceId: string, actorId: string): DurableVideoWorkflow[];
  findLatest(
    workspaceId: string,
    actorId: string,
    workId?: string
  ): DurableVideoWorkflow | undefined;
  /** Seed canonical from a legacy durable row (migration / dual-read). */
  restoreFromLegacy(workflow: DurableVideoWorkflow): DurableVideoWorkflow;
  /** Expose underlying store for projection-only facades / tests. */
  readonly store: CanonicalVideoRunStore;
}

export class VideoWorkflowCanonicalCommands
  implements VideoWorkflowCanonicalCommandPort
{
  constructor(
    readonly store: CanonicalVideoRunStore = new InMemoryCanonicalVideoRunStore()
  ) {}

  createDraft(
    input: CreateVideoWorkflowInput,
    options: {
      clock: () => number;
      newId: () => string;
      buildInitialProjection: (
        input: CreateVideoWorkflowInput,
        workflowId: string,
        timestamp: string
      ) => DurableVideoWorkflow;
      assertSameDraft: (
        existing: DurableVideoWorkflow,
        input: CreateVideoWorkflowInput
      ) => void;
      requireSource?: (
        derivedFromWorkflowId: string,
        workspaceId: string
      ) => DurableVideoWorkflow;
    }
  ) {
    const workflowId = input.workflowId ?? options.newId();
    if (!workflowId.trim()) throw new Error('workflowId must not be empty.');
    const existing = this.get(workflowId);
    if (existing) {
      options.assertSameDraft(existing, input);
      return structuredClone(existing);
    }
    if (input.derivedFromWorkflowId && options.requireSource) {
      options.requireSource(input.derivedFromWorkflowId, input.workspaceId);
    }
    const timestamp = new Date(options.clock()).toISOString();
    const projection = options.buildInitialProjection(
      input,
      workflowId,
      timestamp
    );
    return this.checkpoint(projection, { expectedRevision: 0 });
  }

  confirm(
    runId: string,
    workspaceId: string | undefined,
    routeSnapshot: DurableRouteSnapshot,
    clock: () => number
  ) {
    const workflow = this.requireProjection(runId, workspaceId);
    if (
      workflow.status === 'cancel_requested' ||
      workflow.status === 'cancelled'
    ) {
      throw new VideoWorkflowCancellationError(
        'A cancelled video workflow cannot be confirmed.'
      );
    }
    const expectedRevision = workflow.revision;
    workflow.routeSnapshot ??= structuredClone(routeSnapshot);
    workflow.confirmed = true;
    workflow.updatedAt = new Date(clock()).toISOString();
    return this.checkpoint(workflow, { expectedRevision });
  }

  selectCandidate(input: SelectVideoCandidateInput, clock: () => number) {
    const workflow = this.requireProjection(
      input.workflowId,
      input.workspaceId
    );
    if (workflow.status !== 'awaiting_quality_review') {
      throw new Error(
        'A video candidate can be selected only while quality review is pending.'
      );
    }
    const shotIndex = workflow.shots.findIndex(
      (shot) => shot.id === input.shotId
    );
    const shot = workflow.shots[shotIndex];
    if (!shot) throw new Error(`Unknown video shot ${input.shotId}.`);
    const candidate = shot.candidates.find(
      (value) => value.index === input.candidateIndex
    );
    if (
      !candidate?.asset ||
      candidate.status !== 'completed' ||
      candidate.technicalValidation?.playable !== true
    ) {
      throw new Error(
        `Candidate ${input.candidateIndex} for shot ${input.shotId} is not eligible for selection.`
      );
    }
    const expectedRevision = workflow.revision;
    const selectedAt = new Date(clock()).toISOString();
    shot.selectedCandidateIndex = candidate.index;
    shot.selectionReason = `Candidate ${candidate.index + 1} was explicitly selected during human quality review.`;
    shot.selectionAudit = {
      selectedBy: requireText(input.actorId, 'actorId'),
      correlationId: requireText(input.correlationId, 'correlationId'),
      selectedAt,
      source: 'human_quality_review',
    };
    for (const peer of shot.candidates) {
      peer.selectionReason =
        peer.index === candidate.index
          ? shot.selectionReason
          : 'Not selected during explicit human quality review.';
    }
    workflow.clipAssets[shotIndex] = structuredClone(candidate.asset);
    workflow.updatedAt = selectedAt;
    return this.checkpoint(workflow, { expectedRevision });
  }

  edit(input: EditVideoWorkflowInput, clock: () => number) {
    return projectDurableVideoWorkflow(
      this.store.edit(
        input,
        new Date(clock()).toISOString(),
      ),
    );
  }

  claimRun(runId: string, workspaceId: string, leaseToken: string) {
    return projectDurableVideoWorkflow(
      this.store.claimRun(runId, workspaceId, leaseToken)
    );
  }

  checkpoint(
    projection: DurableVideoWorkflow,
    options: DurableVideoWorkflowSaveOptions = {}
  ) {
    return projectDurableVideoWorkflow(
      this.store.put(liftDurableToCanonical(projection), options)
    );
  }

  requestCancel(runId: string, workspaceId: string, requestedAt: string) {
    return projectDurableVideoWorkflow(
      this.store.requestCancel(runId, workspaceId, requestedAt)
    );
  }

  completeCancel(projection: DurableVideoWorkflow, expectedRevision: number) {
    return this.checkpoint(projection, {
      completeCancellation: true,
      expectedRevision,
    });
  }

  assertRunnable(
    runId: string,
    workspaceId: string,
    revision: number,
    leaseToken: string
  ) {
    this.store.assertRunnable(runId, workspaceId, revision, leaseToken);
  }

  get(runId: string) {
    const run = this.store.get(runId);
    return run ? projectDurableVideoWorkflow(run) : undefined;
  }

  list(workspaceId: string, actorId: string) {
    return this.store
      .list(workspaceId, actorId)
      .map(projectDurableVideoWorkflow);
  }

  findLatest(workspaceId: string, actorId: string, workId?: string) {
    const run = this.store.findLatest(workspaceId, actorId, workId);
    return run ? projectDurableVideoWorkflow(run) : undefined;
  }

  restoreFromLegacy(workflow: DurableVideoWorkflow) {
    return projectDurableVideoWorkflow(
      this.store.restore(liftDurableToCanonical(workflow))
    );
  }

  private requireProjection(runId: string, workspaceId?: string) {
    const workflow = this.get(runId);
    if (!workflow) throw new Error(`Unknown workflow ${runId}.`);
    if (workspaceId && workflow.workspaceId !== workspaceId) {
      throw new Error('Video workflow belongs to another workspace.');
    }
    return workflow;
  }
}

/**
 * Read-only projection facade — no write path through VideoWorkflow storage.
 * Use VideoWorkflowCanonicalCommandPort for mutations.
 */
export class VideoWorkflowProjectionReadFacade {
  constructor(private readonly store: CanonicalVideoRunStore) {}

  get(id: string) {
    const run = this.store.get(id);
    return run ? projectDurableVideoWorkflow(run) : undefined;
  }

  list(workspaceId: string, actorId: string) {
    return this.store
      .list(workspaceId, actorId)
      .map(projectDurableVideoWorkflow);
  }

  findLatest(workspaceId: string, actorId: string, workId?: string) {
    const run = this.store.findLatest(workspaceId, actorId, workId);
    return run ? projectDurableVideoWorkflow(run) : undefined;
  }

  save(
    _workflow: DurableVideoWorkflow,
    _options?: DurableVideoWorkflowSaveOptions
  ): DurableVideoWorkflow {
    throw projectionReadonlyError('save');
  }

  claimRun(
    _id: string,
    _workspaceId: string,
    _leaseToken: string
  ): DurableVideoWorkflow {
    throw projectionReadonlyError('claimRun');
  }

  requestCancel(
    _id: string,
    _workspaceId: string,
    _requestedAt: string
  ): DurableVideoWorkflow {
    throw projectionReadonlyError('requestCancel');
  }

  assertRunnable(
    _id: string,
    _workspaceId: string,
    _revision: number,
    _leaseToken: string
  ): void {
    throw projectionReadonlyError('assertRunnable');
  }
}

export class VideoWorkflowProjectionReadonlyError extends Error {
  readonly code = 'VIDEO_WORKFLOW_PROJECTION_READONLY';
}

function projectionReadonlyError(method: string) {
  return new VideoWorkflowProjectionReadonlyError(
    `VideoWorkflow is a derived read-only projection; ${method} is not allowed. Use VideoWorkflowCanonicalCommandPort.`
  );
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
      'Only a reviewable video workflow can be edited; terminal workflows require a derived regeneration task.',
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
    const text = edit.text.trim();
    if (text.length > 5_000) {
      throw new Error('Subtitle text must not exceed 5000 characters.');
    }
    edited.task.subtitleText = text;
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

function compareCanonicalRecoveryPriority(
  left: CanonicalVideoRun,
  right: CanonicalVideoRun
) {
  const leftTerminal =
    left.job.status === 'completed' ||
    left.job.status === 'cancelled' ||
    left.job.status === 'failed';
  const rightTerminal =
    right.job.status === 'completed' ||
    right.job.status === 'cancelled' ||
    right.job.status === 'failed';
  if (leftTerminal !== rightTerminal) return leftTerminal ? 1 : -1;
  const storyboardVersion =
    right.task.storyboardVersion - left.task.storyboardVersion;
  if (storyboardVersion !== 0) return storyboardVersion;
  const updated = right.job.updatedAt.localeCompare(left.job.updatedAt);
  return updated === 0
    ? right.runId.localeCompare(left.runId)
    : updated;
}

function compareCanonicalWorkRecoveryPriority(
  left: CanonicalVideoRun,
  right: CanonicalVideoRun
) {
  const storyboardVersion =
    right.task.storyboardVersion - left.task.storyboardVersion;
  return storyboardVersion === 0
    ? compareCanonicalRecoveryPriority(left, right)
    : storyboardVersion;
}

function requireText(value: string, key: string) {
  if (value.trim().length === 0) throw new Error(`${key} is required.`);
  return value;
}
