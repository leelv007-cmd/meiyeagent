import type { JobRuntimeHandler } from '../job-runtime/job-contracts.js';
import type {
  TracerExternalEffect,
  TracerExternalOutcome,
  TracerExternalRequest,
  TracerJobInput,
  TracerJobRecord,
} from '../job-runtime/tracer-worker.js';
import type {
  CreateVideoWorkflowInput,
  DurableVideoWorkflow,
  EditVideoWorkflowInput,
  SelectVideoCandidateInput,
} from './index.js';
import type { VideoContentPackagePort } from '../video-content-package-port.js';

export const COMPOSED_VIDEO_JOB_KIND = 'model.composed-video';

type MaybePromise<T> = T | Promise<T>;

export interface ComposedVideoWorkflowRunnerPort {
  createVideoWorkflow(input: CreateVideoWorkflowInput): MaybePromise<DurableVideoWorkflow>;
  getVideoWorkflow(id: string, workspaceId?: string): MaybePromise<DurableVideoWorkflow>;
  listVideoWorkflows(
    workspaceId: string,
    actorId: string,
  ): MaybePromise<DurableVideoWorkflow[]>;
  findLatestVideoWorkflow(
    workspaceId: string,
    actorId: string,
    workId?: string,
  ): MaybePromise<DurableVideoWorkflow | undefined>;
  confirmVideoWorkflow(id: string, workspaceId?: string): MaybePromise<DurableVideoWorkflow>;
  selectVideoCandidate(
    input: SelectVideoCandidateInput,
  ): MaybePromise<DurableVideoWorkflow>;
  editVideoWorkflow?(input: EditVideoWorkflowInput): MaybePromise<DurableVideoWorkflow>;
  runVideoWorkflow(id: string, workspaceId?: string): Promise<DurableVideoWorkflow>;
  requestVideoWorkflowCancel(
    id: string,
    workspaceId?: string,
  ): MaybePromise<DurableVideoWorkflow>;
  cancelVideoWorkflow(id: string, workspaceId?: string): MaybePromise<DurableVideoWorkflow>;
}

/** Structural seam implemented by TracerJobApplicationService. */
export interface ComposedVideoJobApplicationPort {
  submit(input: TracerJobInput): Promise<TracerJobRecord>;
  get(workspaceId: string, jobId: string): Promise<TracerJobRecord>;
  cancel(workspaceId: string, jobId: string): Promise<TracerJobRecord>;
}

export type ComposedVideoRunnerFactory = (
  workspaceId: string,
) => MaybePromise<ComposedVideoWorkflowRunnerPort>;

export interface ComposedVideoTerminalObserver {
  settle(workflow: DurableVideoWorkflow): MaybePromise<unknown>;
}

export class DurableComposedVideoApplicationService {
  private readonly jobs: ComposedVideoJobApplicationPort;
  private readonly runnerForWorkspace: ComposedVideoRunnerFactory;

  constructor(options: {
    contentPackages: VideoContentPackagePort;
    jobs: ComposedVideoJobApplicationPort;
    runnerForWorkspace: ComposedVideoRunnerFactory;
  }) {
    this.contentPackages = options.contentPackages;
    this.jobs = options.jobs;
    this.runnerForWorkspace = options.runnerForWorkspace;
  }

  private readonly contentPackages: VideoContentPackagePort;

  private jobInput(workflow: DurableVideoWorkflow): TracerJobInput {
    return {
      jobId: composedVideoJobId(workflow.id),
      workspaceId: workflow.workspaceId,
      kind: COMPOSED_VIDEO_JOB_KIND,
      payload: { workflowId: workflow.id },
    };
  }

  private async findJobForWorkflow(workflow: DurableVideoWorkflow) {
    if (!workflow.confirmed) return null;
    const input = this.jobInput(workflow);
    try {
      return await this.jobs.get(input.workspaceId, input.jobId);
    } catch (error) {
      if (!hasErrorCode(error, 'NOT_FOUND')) throw error;
      return null;
    }
  }

  private async submitJobForWorkflow(workflow: DurableVideoWorkflow) {
    return (
      (await this.findJobForWorkflow(workflow)) ??
      this.jobs.submit(this.jobInput(workflow))
    );
  }

  async createDraft(input: {
    workspaceId: string;
    actorId: string;
    workId?: string;
    billingTaskId?: string;
    billingQuoteRevision?: string;
    approvalReceiptId?: string;
    workflowId: string;
    derivedFromWorkflowId?: string;
    deliveryMode?: CreateVideoWorkflowInput['deliveryMode'];
    storyboardRevision: string;
    catalogModelId: string;
    dataClass: CreateVideoWorkflowInput['dataClass'];
    executionContract?: CreateVideoWorkflowInput['executionContract'];
    referenceAssetIds?: string[];
    aigcLabelEnabled?: boolean;
    brandWatermarkText?: string;
    shots: CreateVideoWorkflowInput['shots'];
  }) {
    requireText(input.workspaceId, 'workspaceId');
    requireText(input.actorId, 'actorId');
    if (input.workId !== undefined) requireText(input.workId, 'workId');
    if (input.billingTaskId !== undefined) {
      requireText(input.billingTaskId, 'billingTaskId');
    }
    if (input.billingQuoteRevision !== undefined) {
      requireText(input.billingQuoteRevision, 'billingQuoteRevision');
    }
    requireText(input.workflowId, 'workflowId');
    if (input.derivedFromWorkflowId !== undefined) {
      requireText(input.derivedFromWorkflowId, 'derivedFromWorkflowId');
    }
    requireText(input.storyboardRevision, 'storyboardRevision');
    requireText(input.catalogModelId, 'catalogModelId');
    const runner = await this.runnerForWorkspace(input.workspaceId);
    return runner.createVideoWorkflow({
      workflowId: input.workflowId,
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      ...(input.workId ? { workId: input.workId } : {}),
      ...(input.billingTaskId ? { billingTaskId: input.billingTaskId } : {}),
      ...(input.billingQuoteRevision
        ? { billingQuoteRevision: input.billingQuoteRevision }
        : {}),
      ...(input.approvalReceiptId
        ? { approvalReceiptId: input.approvalReceiptId }
        : {}),
      ...(input.derivedFromWorkflowId
        ? { derivedFromWorkflowId: input.derivedFromWorkflowId }
        : {}),
      ...(input.deliveryMode ? { deliveryMode: input.deliveryMode } : {}),
      dataClass: [...input.dataClass],
      ...(input.executionContract
        ? { executionContract: structuredClone(input.executionContract) }
        : {}),
      referenceAssetIds: [...(input.referenceAssetIds ?? [])],
      aigcLabelEnabled: input.aigcLabelEnabled === true,
      ...(input.brandWatermarkText?.trim()
        ? { brandWatermarkText: input.brandWatermarkText.trim() }
        : {}),
      storyboardRevision: input.storyboardRevision,
      catalogModelId: input.catalogModelId,
      shots: structuredClone(input.shots),
    });
  }

  async confirmAndSubmit(input: { workspaceId: string; workflowId: string }) {
    const runner = await this.runnerForWorkspace(input.workspaceId);
    const workflow = await runner.confirmVideoWorkflow(
      input.workflowId,
      input.workspaceId,
    );
    try {
      if (shouldWriteVideoContentPackage(workflow)) {
        await confirmVideoContentPackage(this.contentPackages, workflow);
      }
    } catch (error) {
      // The durable job has not been submitted yet and both confirm steps are
      // idempotent, so mark the failure claim-releasable: the same HTTP
      // idempotency key must be able to retry immediately.
      if (error && typeof error === 'object' && !('status' in error)) {
        Object.assign(error, {
          code:
            'code' in error
              ? (error as { code: unknown }).code
              : 'CONTENT_PACKAGE_CONFIRMATION_FAILED',
          status: 409,
        });
      }
      throw error;
    }
    const job = await this.submitJobForWorkflow(workflow);
    return { workflow, job };
  }

  async adoptCandidate(input: { workspaceId: string; workflowId: string }) {
    const runner = await this.runnerForWorkspace(input.workspaceId);
    const workflow = await runner.getVideoWorkflow(
      input.workflowId,
      input.workspaceId,
    );
    if (!isAdoptableVideoCandidate(workflow)) {
      throw new Error(
        `Video workflow ${workflow.id} does not have an adoptable candidate.`,
      );
    }
    await confirmVideoContentPackage(this.contentPackages, workflow);
    await reconcileCompletedVideoContentPackage(
      this.contentPackages,
      workflow,
    );
    return { workflow };
  }

  async query(input: { workspaceId: string; workflowId: string }) {
    const runner = await this.runnerForWorkspace(input.workspaceId);
    const workflow = await runner.getVideoWorkflow(
      input.workflowId,
      input.workspaceId,
    );
    const job = await this.findJobForWorkflow(workflow);
    return { workflow, job };
  }

  async recoverSupplierTask(input: {
    workspaceId: string;
    workflowId: string;
  }) {
    const runner = await this.runnerForWorkspace(input.workspaceId);
    const workflow = await runner.getVideoWorkflow(
      input.workflowId,
      input.workspaceId,
    );
    const job = await this.jobs.submit(this.jobInput(workflow));
    return { job, workflow };
  }

  async selectCandidateAndResume(input: {
    workspaceId: string;
    workflowId: string;
    shotId: string;
    candidateIndex: number;
    actorId: string;
    correlationId: string;
  }) {
    const runner = await this.runnerForWorkspace(input.workspaceId);
    const workflow = await runner.selectVideoCandidate({
      workflowId: input.workflowId,
      shotId: input.shotId,
      candidateIndex: input.candidateIndex,
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });
    const job = await this.jobs.submit({
      jobId: composedVideoJobId(input.workflowId),
      workspaceId: input.workspaceId,
      kind: COMPOSED_VIDEO_JOB_KIND,
      payload: { workflowId: input.workflowId },
    });
    return { workflow, job };
  }

  async edit(input: EditVideoWorkflowInput) {
    const runner = await this.runnerForWorkspace(input.workspaceId);
    if (!runner.editVideoWorkflow) {
      throw new Error('Canonical video editing is not configured.');
    }
    const workflow = await runner.editVideoWorkflow(input);
    return { workflow };
  }

  async latest(input: {
    workspaceId: string;
    actorId: string;
    workId?: string;
  }) {
    const runner = await this.runnerForWorkspace(input.workspaceId);
    const workflow = await runner.findLatestVideoWorkflow(
      input.workspaceId,
      input.actorId,
      input.workId,
    );
    if (!workflow) return null;
    const job = await this.findJobForWorkflow(workflow);
    return { workflow, job };
  }

  async list(input: { workspaceId: string; actorId: string }) {
    const runner = await this.runnerForWorkspace(input.workspaceId);
    const workflows = await runner.listVideoWorkflows(
      input.workspaceId,
      input.actorId,
    );
    return Promise.all(
      workflows.map(async (workflow) => ({
        workflow,
        job: await this.findJobForWorkflow(workflow),
      })),
    );
  }

  async cancel(input: { workspaceId: string; workflowId: string }) {
    const runner = await this.runnerForWorkspace(input.workspaceId);
    const current = await runner.getVideoWorkflow(
      input.workflowId,
      input.workspaceId,
    );
    const existing = await this.findJobForWorkflow(current);
    if (!existing) {
      throw new Error('Only a confirmed video workflow can be cancelled.');
    }
    const workflow = await runner.requestVideoWorkflowCancel(
      input.workflowId,
      input.workspaceId,
    );
    const job = await this.jobs.cancel(
      input.workspaceId,
      composedVideoJobId(input.workflowId),
    );
    return { workflow, job };
  }
}

/**
 * Tracer effect used by DurableTracerWorker. Execute and reconcile deliberately
 * call the same restart-safe runner; persisted candidate checkpoints prevent a
 * recovered job from generating completed clips again.
 */
export class ComposedVideoJobEffect implements TracerExternalEffect {
  constructor(
    private readonly runnerForWorkspace: ComposedVideoRunnerFactory,
    private readonly contentPackages: VideoContentPackagePort,
    private readonly terminalObserver?: ComposedVideoTerminalObserver,
  ) {}

  execute(request: TracerExternalRequest) {
    return this.run(request);
  }

  reconcile(request: TracerExternalRequest) {
    return this.run(request);
  }

  async cancel(request: TracerExternalRequest) {
    const workflowId = requirePayloadWorkflowId(request.payload);
    const runner = await this.runnerForWorkspace(request.workspaceId);
    const workflow = await runner.cancelVideoWorkflow(
      workflowId,
      request.workspaceId,
    );
    if (shouldWriteVideoContentPackage(workflow)) {
      await this.contentPackages.reconcile({
        actorId: workflow.actorId,
        status: 'cancelled',
        workflowId: workflow.id,
        workspaceId: workflow.workspaceId,
      });
    }
    await this.terminalObserver?.settle(workflow);
    return {
      taskRef: workflow.id,
      output: { workflowId: workflow.id, status: workflow.status },
    };
  }

  private async run(request: TracerExternalRequest): Promise<TracerExternalOutcome> {
    if (request.kind !== COMPOSED_VIDEO_JOB_KIND) {
      return {
        acceptance: 'rejected_before_accept',
        delivery: 'failed',
        error: `Unsupported composed-video job kind ${request.kind}.`,
      };
    }
    const workflowId = requirePayloadWorkflowId(request.payload);
    const runner = await this.runnerForWorkspace(request.workspaceId);
    const workflow = await runner.runVideoWorkflow(workflowId, request.workspaceId);
    if (workflow.status === 'awaiting_quality_review') {
      if (shouldWriteVideoContentPackage(workflow)) {
        await this.contentPackages.reconcile({
          actorId: workflow.actorId,
          status: 'awaiting_quality_review',
          workflowId: workflow.id,
          workspaceId: workflow.workspaceId,
        });
      }
      return {
        acceptance: 'accepted',
        delivery: 'pending',
        taskRef: workflow.id,
        output: { workflowId: workflow.id, status: workflow.status },
      };
    }
    if (workflow.status === 'failed') {
      const failureCode = workflow.failureCode ?? 'VIDEO_WORKFLOW_FAILED';
      if (shouldWriteVideoContentPackage(workflow)) {
        await this.contentPackages.reconcile({
          actorId: workflow.actorId,
          failureCode,
          status: 'failed',
          workflowId: workflow.id,
          workspaceId: workflow.workspaceId,
        });
      }
      await this.terminalObserver?.settle(workflow);
      return {
        acceptance: 'accepted',
        delivery: 'failed',
        error: failureCode,
        taskRef: workflow.id,
        output: { workflowId: workflow.id, status: workflow.status },
      };
    }
    if (
      workflow.status !== 'completed' ||
      !workflow.composedAsset ||
      workflow.composedAsset.contentType !== 'video/mp4' ||
      !workflow.composedAsset.compositionEvidence ||
      !workflow.routeSnapshot
    ) {
      throw new Error(
        `Composed video workflow ${workflow.id} completed without an owned asset.`,
      );
    }
    if (shouldWriteVideoContentPackage(workflow)) {
      await reconcileCompletedVideoContentPackage(
        this.contentPackages,
        workflow,
      );
    }
    await this.terminalObserver?.settle(workflow);
    return {
      acceptance: 'accepted',
      delivery: 'completed',
      taskRef: workflow.id,
      output: {
        workflowId: workflow.id,
        status: workflow.status,
        ...(workflow.composedAsset
          ? { composedAssetId: workflow.composedAsset.id }
          : {}),
      },
    };
  }
}

type AdoptableVideoCandidate = DurableVideoWorkflow & {
  composedAsset: NonNullable<DurableVideoWorkflow['composedAsset']>;
  routeSnapshot: NonNullable<DurableVideoWorkflow['routeSnapshot']>;
};

function shouldWriteVideoContentPackage(workflow: DurableVideoWorkflow) {
  return workflow.deliveryMode !== 'candidate_only';
}

function isAdoptableVideoCandidate(
  workflow: DurableVideoWorkflow,
): workflow is AdoptableVideoCandidate {
  return Boolean(
    workflow.deliveryMode === 'candidate_only' &&
      workflow.status === 'completed' &&
      workflow.composedAsset?.contentType === 'video/mp4' &&
      workflow.composedAsset.compositionEvidence &&
      workflow.routeSnapshot,
  );
}

function confirmVideoContentPackage(
  contentPackages: VideoContentPackagePort,
  workflow: DurableVideoWorkflow,
) {
  return contentPackages.confirm({
    actorId: workflow.actorId,
    ...(workflow.approvalReceiptId
      ? { approvalReceiptId: workflow.approvalReceiptId }
      : {}),
    aigcLabelEnabled: workflow.aigcLabelEnabled,
    ...(workflow.brandWatermarkText
      ? { brandWatermarkText: workflow.brandWatermarkText }
      : {}),
    catalogModelId: workflow.catalogModelId,
    dataClass: [...workflow.dataClass],
    ...(workflow.executionContract
      ? { executionContract: structuredClone(workflow.executionContract) }
      : {}),
    referenceAssetIds: [...(workflow.referenceAssetIds ?? [])],
    shots: workflow.shots.map((shot) => ({
      id: shot.id,
      prompt: shot.prompt,
    })),
    storyboardRevision: workflow.storyboardRevision,
    storyboardVersion: workflow.storyboardVersion,
    workflowId: workflow.id,
    workspaceId: workflow.workspaceId,
    ...(workflow.workId ? { workId: workflow.workId } : {}),
  });
}

function reconcileCompletedVideoContentPackage(
  contentPackages: VideoContentPackagePort,
  workflow: DurableVideoWorkflow,
) {
  const composedAsset = workflow.composedAsset!;
  return contentPackages.reconcile({
    actorId: workflow.actorId,
    clipAssetIds: workflow.clipAssets.map((asset) => asset.id),
    composedAsset: {
      compositionEvidence: structuredClone(
        composedAsset.compositionEvidence!,
      ),
      contentType: 'video/mp4',
      id: composedAsset.id,
      objectKey: composedAsset.objectKey,
      sha256: composedAsset.sha256,
      sizeBytes: composedAsset.sizeBytes,
    },
    providerAttempts: structuredClone(workflow.attempts),
    providerCosts: uniqueProviderCosts(workflow),
    routeSnapshot: structuredClone(workflow.routeSnapshot!),
    shots: workflow.shots.map((shot) => ({
      id: shot.id,
      prompt: shot.prompt,
    })),
    status: 'completed',
    storyboardRevision: workflow.storyboardRevision,
    workflowId: workflow.id,
    workspaceId: workflow.workspaceId,
  });
}

function uniqueProviderCosts(workflow: DurableVideoWorkflow) {
  const costs = workflow.shots.flatMap((shot) =>
    shot.candidates.flatMap((candidate) => candidate.providerCosts)
  );
  return [
    ...new Map(costs.map((cost) => [cost.id, structuredClone(cost)])).values(),
  ];
}

export interface ComposedVideoTracerWorkerPort {
  handle: JobRuntimeHandler;
}

/** Kind-scoped handler registered in the existing product worker dispatcher. */
export function createComposedVideoJobHandler(
  worker: ComposedVideoTracerWorkerPort,
): JobRuntimeHandler {
  return async (envelope, context) => {
    if (envelope.kind !== COMPOSED_VIDEO_JOB_KIND) {
      return {
        status: 'dead_letter',
        output: {
          code: 'UNSUPPORTED_JOB_KIND',
          expected: COMPOSED_VIDEO_JOB_KIND,
          actual: envelope.kind,
        },
      };
    }
    return worker.handle(envelope, context);
  };
}

export function composedVideoJobId(workflowId: string) {
  return `${COMPOSED_VIDEO_JOB_KIND}:${workflowId}`;
}

function requirePayloadWorkflowId(payload: Record<string, unknown>) {
  const value = payload.workflowId;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Composed-video job payload requires workflowId.');
  }
  return value;
}

function requireText(value: string, key: string) {
  if (value.trim().length === 0) throw new Error(`${key} is required.`);
}

function hasErrorCode(error: unknown, code: string) {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === code
  );
}
