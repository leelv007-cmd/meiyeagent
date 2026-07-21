import { createHash } from 'node:crypto';
import type {
  ProductQuoteSnapshot,
  ProductUsageRecord,
} from '@meiye/contracts';
import { P1DomainError } from '../foundation/domain.js';
import type {
  BillingLifecyclePort,
} from '../product-billing/lifecycle-port.js';
import type { ProductBillingApplicationPort } from '../product-billing/durable-service.js';
import type { ProductQuoteAuthority } from '../product-billing/server-quote-authority.js';
import type {
  CreateVideoWorkflowInput,
  DurableVideoWorkflow,
} from './video-workflow-contract.js';
import {
  projectVideoRegenConfirmView,
  videoFreeActions,
  videoRegenScopes,
  type VideoFreeAction,
  type VideoRegenConfirmView,
  type VideoRegenQuoteIntent,
  type VideoRegenRetryIntent,
  type VideoRegenScope,
} from './video-regeneration.js';

type MaybePromise<T> = T | Promise<T>;

export type VideoRegenerationQuoteBinding = {
  actorId: string;
  createdAt: string;
  quoteId: string;
  scope: VideoRegenScope;
  shotId?: string;
  sourceRunId: string;
  targetSeconds: number;
  workspaceId: string;
};

export type DurableVideoRegenerationTask = {
  actorId: string;
  createdAt: string;
  quoteId: string;
  scope: VideoRegenScope;
  shotId?: string;
  sourceRunId: string;
  status: 'dispatching' | 'running' | 'completed' | 'cancelled' | 'failed';
  supplierTaskRef?: string;
  taskId: string;
  updatedAt: string;
  workspaceId: string;
};

export type VideoRegenerationTaskBinding = Omit<
  DurableVideoRegenerationTask,
  'status' | 'updatedAt'
>;

export type VideoRegenerationFreeActionRecord = {
  action: VideoFreeAction;
  actorId?: string;
  at: string;
  supplierTaskRef?: string;
  taskId: string;
  workspaceId: string;
};

export interface VideoRegenerationRepository {
  saveQuoteBinding(binding: VideoRegenerationQuoteBinding): Promise<void>;
  getQuoteBinding(
    workspaceId: string,
    quoteId: string,
  ): Promise<VideoRegenerationQuoteBinding | null>;
  saveTaskBinding(binding: VideoRegenerationTaskBinding): Promise<void>;
  getTaskBinding(
    workspaceId: string,
    taskId: string,
  ): Promise<VideoRegenerationTaskBinding | null>;
  appendFreeAction(input: VideoRegenerationFreeActionRecord): Promise<void>;
}

export interface VideoRegenerationWorkflowPort {
  adoptCandidate(input: {
    workspaceId: string;
    workflowId: string;
  }): MaybePromise<unknown>;
  query(input: {
    workspaceId: string;
    workflowId: string;
  }): MaybePromise<{ workflow: DurableVideoWorkflow; job?: unknown }>;
  createDraft(input: {
    workspaceId: string;
    actorId: string;
    workId?: string;
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
  }): MaybePromise<unknown>;
  confirmAndSubmit(input: {
    workspaceId: string;
    workflowId: string;
  }): MaybePromise<unknown>;
  recoverSupplierTask(input: {
    workspaceId: string;
    workflowId: string;
  }): MaybePromise<unknown>;
}

export interface VideoRegenerationApprovalPort {
  approve(input: {
    actorId: string;
    approvalKey: string;
    contract: NonNullable<CreateVideoWorkflowInput['executionContract']>;
    workId: string;
    workspaceId: string;
  }): MaybePromise<{ id: string }>;
}

export type DurableVideoRegenerationBilling = ProductBillingApplicationPort &
  BillingLifecyclePort;

export function createVideoRegenerationTerminalObserver(options: {
  billing: DurableVideoRegenerationBilling;
  repository: VideoRegenerationRepository;
}) {
  return {
    async settle(workflow: DurableVideoWorkflow) {
      const binding = await options.repository.getTaskBinding(
        workflow.workspaceId,
        workflow.id,
      );
      if (!binding) return null;
      if (
        workflow.status !== 'completed' &&
        workflow.status !== 'cancelled' &&
        workflow.status !== 'failed'
      ) {
        return null;
      }
      const attempt = workflow.attempts.at(-1);
      const measured =
        workflow.composedAsset?.technicalValidation?.evidenceKind === 'measured'
          ? workflow.composedAsset.technicalValidation.durationSeconds
          : undefined;
      if (!attempt) {
        if (workflow.status === 'completed') {
          throw new P1DomainError(
            'INVALID_STATE',
            'A completed regeneration workflow requires real attempt evidence.',
          );
        }
        const quote = await options.billing.getQuoteByTask(
          workflow.id,
          workflow.workspaceId,
        );
        if (!quote) {
          throw new P1DomainError(
            'NOT_FOUND',
            `Quote for regeneration task ${workflow.id} was not found.`,
          );
        }
        await options.billing.failAndRefund({
          quoteId: quote.quoteId,
          reason:
            workflow.status === 'cancelled'
              ? 'video_regeneration_cancelled_before_attempt'
              : 'video_regeneration_failed_before_attempt',
          workspaceId: workflow.workspaceId,
        });
      } else {
        await options.billing.settleTask({
          attemptId: attempt.id,
          deploymentId: attempt.deploymentId,
          status: workflow.status === 'completed' ? 'completed' : 'failed',
          taskId: workflow.id,
          ...(measured !== undefined
            ? {
                trustedUsage: {
                  actualSeconds: measured,
                  evidenceRef: workflow.composedAsset?.id,
                  kind: 'media_duration' as const,
                },
              }
            : {}),
          workspaceId: workflow.workspaceId,
        });
      }
      const next = projectRegenerationTask(binding, workflow);
      return {
        quote: await options.billing.getQuoteByTask(
          workflow.id,
          workflow.workspaceId,
        ),
        task: next,
        usage: await options.billing.getUsage(
          workflow.id,
          workflow.workspaceId,
        ),
      };
    },
  };
}

/**
 * Production orchestration for workbench regeneration.
 *
 * ProductQuote/ProductUsage remain owned by product-billing. The derived task
 * is the canonical video workflow itself, while this repository only stores
 * quote-to-scope binding and free-action audit facts.
 */
export class VideoRegenerationApplicationService {
  private readonly approvalAuthority: VideoRegenerationApprovalPort;
  private readonly billing: DurableVideoRegenerationBilling;
  private readonly clock: () => Date;
  private readonly quoteAuthority: ProductQuoteAuthority;
  private readonly repository: VideoRegenerationRepository;
  private readonly workflows: VideoRegenerationWorkflowPort;

  constructor(options: {
    approvalAuthority: VideoRegenerationApprovalPort;
    billing: DurableVideoRegenerationBilling;
    clock?: () => Date;
    quoteAuthority: ProductQuoteAuthority;
    repository: VideoRegenerationRepository;
    workflows: VideoRegenerationWorkflowPort;
  }) {
    this.approvalAuthority = options.approvalAuthority;
    this.billing = options.billing;
    this.clock = options.clock ?? (() => new Date());
    this.quoteAuthority = options.quoteAuthority;
    this.repository = options.repository;
    this.workflows = options.workflows;
  }

  async quote(input: VideoRegenQuoteIntent & { quoteId?: string }): Promise<{
    confirm: VideoRegenConfirmView;
    quote: ProductQuoteSnapshot;
    scope: VideoRegenScope;
  }> {
    this.assertScope(input.scope, input.shotId);
    const source = (
      await this.workflows.query({
        workflowId: input.sourceRunId,
        workspaceId: input.workspaceId,
      })
    ).workflow;
    if (source.actorId !== input.actorId) {
      throw new P1DomainError(
        'FORBIDDEN',
        'Video regeneration source belongs to another actor.',
      );
    }
    const targetSeconds = this.targetSeconds(source, input.scope, input.shotId);
    const catalogModelId =
      source.routeSnapshot?.actualCatalogModelId ?? source.catalogModelId;
    const authoritative = await this.quoteAuthority.resolve({
      catalogModelId,
      operation: 'video.generate',
      quoteId: input.quoteId?.trim() || stableQuoteId(input),
      targetSeconds,
      workspaceId: input.workspaceId,
    });
    const quote = await this.billing.buildQuote({
      ...authoritative,
      ...(source.routeSnapshot?.allowedCandidates
        ? {
            frozenCandidateDeploymentIds:
              source.routeSnapshot.allowedCandidates.map(
                (candidate) => candidate.deploymentId,
              ),
          }
        : {}),
      ...(source.routeSnapshot
        ? { routeSnapshotRef: source.routeSnapshot.id }
        : {}),
    });
    const binding: VideoRegenerationQuoteBinding = {
      actorId: input.actorId,
      createdAt: this.clock().toISOString(),
      quoteId: quote.quoteId,
      scope: input.scope,
      ...(input.shotId ? { shotId: input.shotId } : {}),
      sourceRunId: input.sourceRunId,
      targetSeconds,
      workspaceId: input.workspaceId,
    };
    await this.repository.saveQuoteBinding(binding);
    return {
      confirm: projectVideoRegenConfirmView({
        now: this.clock(),
        quote,
        scope: input.scope,
      }),
      quote,
      scope: input.scope,
    };
  }

  async confirmAndDispatch(input: {
    approvalReceiptId?: string;
    quoteId: string;
    taskId: string;
    workspaceId: string;
  }): Promise<{
    quote: ProductQuoteSnapshot;
    task: DurableVideoRegenerationTask;
    usage: ProductUsageRecord | null;
    workflow: unknown;
  }> {
    const binding = await this.requireBinding(input.workspaceId, input.quoteId);
    const existing = await this.repository.getTaskBinding(
      input.workspaceId,
      input.taskId,
    );
    if (existing) {
      if (existing.quoteId !== input.quoteId) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          `Regeneration task ${input.taskId} is bound to another quote.`,
        );
      }
    }

    await this.requireQuote(input.workspaceId, input.quoteId);
    // Explicit product confirm — beforeSubmit no longer auto-promotes quoted.
    const quote = await this.billing.confirm({
      quoteId: input.quoteId,
      taskId: input.taskId,
      workspaceId: input.workspaceId,
    });
    await this.billing.beforeSubmit({
      quoteId: input.quoteId,
      quoteRevision: quote.revision,
      resource: 'video',
      taskId: input.taskId,
      workspaceId: input.workspaceId,
    });

    const source = (
      await this.workflows.query({
        workflowId: binding.sourceRunId,
        workspaceId: input.workspaceId,
      })
    ).workflow;
    if (source.actorId !== binding.actorId) {
      throw new P1DomainError(
        'FORBIDDEN',
        'Video regeneration source belongs to another actor.',
      );
    }
    const shots = source.shots
      .filter(
        (shot) => binding.scope === 'full_compose' || shot.id === binding.shotId,
      )
      .map((shot) => ({
        candidatesPerShot: shot.candidatesPerShot,
        ...(shot.durationSeconds !== undefined
          ? { durationSeconds: shot.durationSeconds }
          : {}),
        ...(shot.height !== undefined ? { height: shot.height } : {}),
        id: shot.id,
        prompt: shot.prompt,
        ...(shot.width !== undefined ? { width: shot.width } : {}),
      }));
    if (shots.length === 0) {
      throw new P1DomainError(
        'NOT_FOUND',
        `Regeneration source shot ${binding.shotId ?? ''} was not found.`,
      );
    }
    if (!source.executionContract) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Video regeneration requires a frozen execution contract.',
      );
    }

    const now = this.clock().toISOString();
    const executionContract = {
      ...structuredClone(source.executionContract),
      catalogModelId: quote.catalogModelId,
      durationSeconds: binding.targetSeconds,
      estimatedAmount:
        quote.authorizedCeiling ?? quote.confirmedAmount ?? 0,
      quoteAcceptedAt: now,
      quoteRevision: quote.revision,
    };
    const approvalReceiptId =
      input.approvalReceiptId ??
      (binding.scope === 'full_compose' && source.workId
        ? (
            await this.approvalAuthority.approve({
              actorId: binding.actorId,
              approvalKey: `video-regeneration:${input.taskId}:${quote.revision}`,
              contract: executionContract,
              workId: source.workId,
              workspaceId: input.workspaceId,
            })
          ).id
        : undefined);
    const taskBinding: VideoRegenerationTaskBinding =
      existing ?? {
        actorId: binding.actorId,
        createdAt: now,
        quoteId: input.quoteId,
        scope: binding.scope,
        ...(binding.shotId ? { shotId: binding.shotId } : {}),
        sourceRunId: binding.sourceRunId,
        taskId: input.taskId,
        workspaceId: input.workspaceId,
      };
    if (!existing) await this.repository.saveTaskBinding(taskBinding);
    await this.workflows.createDraft({
      actorId: binding.actorId,
      aigcLabelEnabled: source.aigcLabelEnabled,
      ...(approvalReceiptId
        ? { approvalReceiptId }
        : {}),
      ...(source.brandWatermarkText
        ? { brandWatermarkText: source.brandWatermarkText }
        : {}),
      catalogModelId: quote.catalogModelId,
      dataClass: [...source.dataClass],
      derivedFromWorkflowId: binding.sourceRunId,
      deliveryMode:
        binding.scope === 'shot' ? 'candidate_only' : 'content_package',
      executionContract,
      referenceAssetIds: [...(source.referenceAssetIds ?? [])],
      shots,
      storyboardRevision: `${source.storyboardRevision}:regen:${quote.revision}`,
      ...(source.workId ? { workId: source.workId } : {}),
      workflowId: input.taskId,
      workspaceId: input.workspaceId,
    });
    const workflow = await this.workflows.confirmAndSubmit({
      workflowId: input.taskId,
      workspaceId: input.workspaceId,
    });
    const current = (
      await this.workflows.query({
        workflowId: input.taskId,
        workspaceId: input.workspaceId,
      })
    ).workflow;
    const running = projectRegenerationTask(taskBinding, current);
    return {
      quote: (await this.requireQuote(input.workspaceId, input.quoteId)),
      task: running,
      usage: await this.billing.getUsage(input.taskId, input.workspaceId),
      workflow,
    };
  }

  async retry(input: VideoRegenRetryIntent) {
    const existingQuote = await this.billing.getQuote(
      input.quoteId,
      input.workspaceId,
    );
    if (existingQuote?.taskId && existingQuote.taskId !== input.taskId) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Paid regeneration retry requires a fresh quote.',
      );
    }
    const quoted = await this.quote(input);
    const dispatched = await this.confirmAndDispatch({
      ...(input.approvalReceiptId
        ? { approvalReceiptId: input.approvalReceiptId }
        : {}),
      quoteId: quoted.quote.quoteId,
      taskId: input.taskId,
      workspaceId: input.workspaceId,
    });
    return { ...quoted, ...dispatched };
  }

  private targetSeconds(
    source: DurableVideoWorkflow,
    scope: VideoRegenScope,
    shotId?: string,
  ) {
    const seconds =
      scope === 'shot'
        ? source.shots.find((shot) => shot.id === shotId)?.durationSeconds
        : source.executionContract?.durationSeconds ??
          source.shots.reduce(
            (total, shot) => total + (shot.durationSeconds ?? 0),
            0,
          );
    if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Video regeneration requires server-recorded target duration.',
      );
    }
    return seconds;
  }

  async recover(input: {
    actorId?: string;
    supplierTaskRef: string;
    taskId: string;
    workspaceId: string;
  }) {
    const task = await this.requireTask(input.workspaceId, input.taskId);
    const current = (
      await this.workflows.query({
        workflowId: input.taskId,
        workspaceId: input.workspaceId,
      })
    ).workflow;
    if (
      !current.attempts.some(
        (attempt) => attempt.providerTaskRef === input.supplierTaskRef,
      )
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Recover requires a supplier task ref already owned by this workflow.',
      );
    }
    if (
      task.supplierTaskRef &&
      task.supplierTaskRef !== input.supplierTaskRef
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Recover cannot switch supplier task refs.',
      );
    }
    if (!task.supplierTaskRef) {
      const next: VideoRegenerationTaskBinding = {
        ...task,
        supplierTaskRef: requireText(
          input.supplierTaskRef,
          'supplierTaskRef',
        ),
      };
      await this.repository.saveTaskBinding(next);
      await this.repository.appendFreeAction({
        action: 'recover',
        ...(input.actorId ? { actorId: input.actorId } : {}),
        at: this.clock().toISOString(),
        supplierTaskRef: input.supplierTaskRef,
        taskId: input.taskId,
        workspaceId: input.workspaceId,
      });
    }
    return this.workflows.recoverSupplierTask({
      workflowId: input.taskId,
      workspaceId: input.workspaceId,
    });
  }

  async executeFreeAction(input: {
    action: VideoFreeAction;
    actorId?: string;
    supplierTaskRef?: string;
    taskId: string;
    workspaceId: string;
  }) {
    if (!videoFreeActions.includes(input.action)) {
      throw new P1DomainError('INVALID_STATE', 'Unknown free video action.');
    }
    await this.requireTask(input.workspaceId, input.taskId);
    await this.repository.appendFreeAction({
      action: input.action,
      ...(input.actorId ? { actorId: input.actorId } : {}),
      at: this.clock().toISOString(),
      ...(input.supplierTaskRef
        ? { supplierTaskRef: input.supplierTaskRef }
        : {}),
      taskId: input.taskId,
      workspaceId: input.workspaceId,
    });
    const adoption =
      input.action === 'adopt_candidate'
        ? await this.workflows.adoptCandidate({
            workflowId: input.taskId,
            workspaceId: input.workspaceId,
          })
        : undefined;
    return {
      action: input.action,
      ...(adoption !== undefined ? { adoption } : {}),
      productUsageTouched: false as const,
    };
  }

  async getTask(workspaceId: string, taskId: string) {
    const binding = await this.requireTask(workspaceId, taskId);
    const workflow = (
      await this.workflows.query({ workspaceId, workflowId: taskId })
    ).workflow;
    return projectRegenerationTask(binding, workflow);
  }

  /** Worker callback: settle once from the canonical workflow terminal fact. */
  async settleFromWorkflow(workflow: DurableVideoWorkflow) {
    return createVideoRegenerationTerminalObserver({
      billing: this.billing,
      repository: this.repository,
    }).settle(workflow);
  }

  private async requireBinding(workspaceId: string, quoteId: string) {
    const binding = await this.repository.getQuoteBinding(workspaceId, quoteId);
    if (!binding) {
      throw new P1DomainError(
        'NOT_FOUND',
        `Video regeneration quote ${quoteId} was not found.`,
      );
    }
    return binding;
  }

  private async requireQuote(workspaceId: string, quoteId: string) {
    const quote = await this.billing.getQuote(quoteId, workspaceId);
    if (!quote) {
      throw new P1DomainError('NOT_FOUND', `Quote ${quoteId} was not found.`);
    }
    if (quote.workspaceId !== workspaceId) {
      throw new P1DomainError('FORBIDDEN', 'Quote belongs to another workspace.');
    }
    return quote;
  }

  private async requireTask(workspaceId: string, taskId: string) {
    const task = await this.repository.getTaskBinding(workspaceId, taskId);
    if (!task) {
      throw new P1DomainError(
        'NOT_FOUND',
        `Video regeneration task ${taskId} was not found.`,
      );
    }
    return task;
  }

  private assertScope(scope: VideoRegenScope, shotId: string | undefined) {
    if (!videoRegenScopes.includes(scope)) {
      throw new P1DomainError('INVALID_STATE', 'Unknown regeneration scope.');
    }
    if (scope === 'shot' && !shotId?.trim()) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Shot regeneration requires shotId.',
      );
    }
  }
}

function projectRegenerationTask(
  binding: VideoRegenerationTaskBinding,
  workflow: DurableVideoWorkflow,
): DurableVideoRegenerationTask {
  const status: DurableVideoRegenerationTask['status'] =
    workflow.status === 'completed' ||
    workflow.status === 'cancelled' ||
    workflow.status === 'failed'
      ? workflow.status
      : workflow.status === 'draft'
        ? 'dispatching'
        : 'running';
  return {
    ...binding,
    status,
    updatedAt: workflow.updatedAt,
  };
}

function stableQuoteId(input: VideoRegenQuoteIntent) {
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        requestId: input.requestId,
        scope: input.scope,
        shotId: input.shotId,
        sourceRunId: input.sourceRunId,
        workspaceId: input.workspaceId,
      }),
    )
    .digest('hex')
    .slice(0, 24);
  return `video-regeneration:${digest}`;
}

function requireText(value: string, field: string) {
  if (!value.trim()) {
    throw new P1DomainError('INVALID_STATE', `${field} is required.`);
  }
  return value.trim();
}
