import { createHash } from 'node:crypto';
import type { JobRuntimeHandler } from '../job-runtime/job-contracts.js';
import type {
  TracerExternalEffect,
  TracerExternalRequest,
  TracerJobInput,
  TracerJobRecord,
} from '../job-runtime/tracer-worker.js';
import {
  CURRENT_PROVIDER_REFERENCE_POLICY,
  ProviderReferencePolicyError,
  type ProviderReferencePolicyPort,
} from './reference-asset-delivery.js';
import {
  mediaSubmissionFingerprint,
  type CancelledMediaProviderTerminalOutcome,
  type CancelledMediaProviderTerminalReconciliation,
  type DurableMediaGenerationJobView,
  type CanvasGenerationInputAsset,
  type DurableMediaGenerationRuntimePort,
  type MediaProviderEffectRequest,
  type MediaProviderLifecyclePort,
  type MediaProviderSubmissionReceipt,
  type ModelSupplyApplicationService,
  type ModelSupplyResult,
  type ModelSupplySubmission,
  type ProviderCost,
  type ProviderExecutionPort,
  type ReferenceAssetResolutionFailure,
  type ReferenceAssetResolverPort,
  type ResolvedReferenceAsset,
} from './index.js';

export const MODEL_MEDIA_GENERATION_JOB_KIND = 'model.media-generation';

export interface MediaGenerationJobApplicationPort {
  submit(input: TracerJobInput): Promise<TracerJobRecord>;
  find(workspaceId: string, jobId: string): Promise<TracerJobRecord | null>;
  get(workspaceId: string, jobId: string): Promise<TracerJobRecord>;
  cancel(workspaceId: string, jobId: string): Promise<TracerJobRecord>;
  recordCancelledReconciliation(
    workspaceId: string,
    jobId: string,
    providerTaskRef: string,
    reconciliationKey: string,
    output: Record<string, unknown>,
  ): Promise<TracerJobRecord>;
}

export class DurableMediaGenerationApplicationService
  implements DurableMediaGenerationRuntimePort
{
  constructor(
    private readonly dependencies: {
      jobs: MediaGenerationJobApplicationPort;
      models: ModelSupplyApplicationService;
      provider?: MediaProviderLifecyclePort;
    },
  ) {}

  async submit(submission: ModelSupplySubmission) {
    const preview = this.dependencies.models.previewMediaSubmission(submission);
    const requestFingerprint = mediaSubmissionFingerprint(submission);
    const existing = await this.dependencies.jobs.find(
      submission.workspaceId,
      preview.jobId,
    );
    if (existing) {
      assertRequestFingerprint(existing, requestFingerprint);
      const result = (await this.view(existing)).result;
      await this.dependencies.models.persistGenerationResult(
        submission.workspaceId,
        result,
      );
      return result;
    }
    const frozenSubmission: ModelSupplySubmission = {
      ...structuredClone(submission),
      frozenRouteSnapshot: structuredClone(preview.snapshot),
    };
    const record = await this.dependencies.jobs.submit({
      jobId: preview.jobId,
      workspaceId: submission.workspaceId,
      kind: MODEL_MEDIA_GENERATION_JOB_KIND,
      payload: {
        requestFingerprint,
        submission: frozenSubmission,
      },
    });
    const result = (await this.view(record)).result;
    await this.dependencies.models.persistGenerationResult(
      submission.workspaceId,
      result,
    );
    return result;
  }

  async get(workspaceId: string, jobId: string) {
    return this.view(await this.dependencies.jobs.get(workspaceId, jobId));
  }

  async cancel(input: {
    workspaceId: string;
    jobId: string;
    actorId: string;
  }) {
    return this.view(
      await this.dependencies.jobs.cancel(input.workspaceId, input.jobId),
    );
  }

  async reconcileCancelledProviderTerminal(input: {
    workspaceId: string;
    jobId: string;
    providerTaskRef: string;
  }): Promise<CancelledMediaProviderTerminalOutcome> {
    const record = await this.dependencies.jobs.get(
      input.workspaceId,
      input.jobId,
    );
    if (record.providerTaskRef !== input.providerTaskRef) {
      throw new Error(
        'Late provider terminal task reference does not match the cancelled job.',
      );
    }
    if (record.status !== 'cancelled') {
      throw new Error(
        'Late provider terminal reconciliation requires a cancelled media job.',
      );
    }
    const replay = cancelledTerminalFromOutput(record.output);
    const replayResult = resultFromOutput(record.output);
    if (replay && replayResult) {
      return {
        status: replay.providerStatus,
        reconciliation: replay,
        result: replayResult,
      };
    }
    const provider = this.dependencies.provider;
    if (!provider) {
      throw new Error(
        'Late provider terminal reconciliation requires the media provider runtime.',
      );
    }
    const effect = new ModelMediaGenerationEffect({
      models: this.dependencies.models,
      provider,
    });
    const outcome = await effect.reconcileCancelledProviderTerminal(
      tracerRequestFromRecord(record),
    );
    if (outcome.status === 'pending') return outcome;
    const persisted = await this.dependencies.jobs.recordCancelledReconciliation(
      input.workspaceId,
      input.jobId,
      input.providerTaskRef,
      outcome.reconciliation.reconciliationKey,
      {
        result: outcome.result,
        cancelledProviderTerminal: outcome.reconciliation,
      },
    );
    const persistedResult = resultFromOutput(persisted.output);
    const persistedReconciliation = cancelledTerminalFromOutput(
      persisted.output,
    );
    if (!persistedResult || !persistedReconciliation) {
      throw new Error(
        'Cancelled media reconciliation was not durably recorded.',
      );
    }
    return {
      status: persistedReconciliation.providerStatus,
      reconciliation: persistedReconciliation,
      result: persistedResult,
    };
  }

  private async view(
    record: TracerJobRecord,
  ): Promise<DurableMediaGenerationJobView> {
    const completed = resultFromOutput(record.output);
    const submission = submissionFromPayload(record.payload);
    const result = completed ?? this.dependencies.models.previewMediaSubmission(submission);
    if (record.providerTaskRef && !result.attempt.providerTaskRef) {
      result.attempt.providerTaskRef = record.providerTaskRef;
      const current = result.attempts.find(
        (attempt) => attempt.id === result.attempt.id,
      );
      if (current) current.providerTaskRef = record.providerTaskRef;
    }
    return {
      jobId: record.jobId,
      workspaceId: record.workspaceId,
      status: record.status,
      ...(record.providerTaskRef
        ? { providerTaskRef: record.providerTaskRef }
        : {}),
      providerLifecycleLatencyMs: Math.max(
        0,
        Date.parse(record.updatedAt) - Date.parse(record.createdAt),
      ),
      ...(result.cancelledProviderTerminal
        ? {
            cancelledProviderTerminal: structuredClone(
              result.cancelledProviderTerminal,
            ),
          }
        : {}),
      result,
    };
  }
}

export class ModelMediaGenerationEffect implements TracerExternalEffect {
  constructor(
    private readonly dependencies: {
      models: ModelSupplyApplicationService;
      provider: MediaProviderLifecyclePort;
      referencePolicy?: ProviderReferencePolicyPort;
      referenceAssets?: ReferenceAssetResolverPort;
    },
  ) {}

  async execute(request: TracerExternalRequest) {
    requireMediaKind(request);
    const submission = submissionFromPayload(request.payload);
    const resolution = await this.resolveProviderRequest(submission, request);
    if (resolution.kind === 'failure') {
      return this.recordReferenceResolutionFailure(
        submission,
        resolution.failures,
      );
    }
    if (resolution.kind === 'policy_failure') {
      return this.recordProviderReferencePolicyFailure(
        submission,
        resolution.error,
      );
    }
    const providerRequest = resolution.request;
    const accepted = await this.dependencies.provider.submit(providerRequest);
    return this.recordSubmissionReceipt(submission, accepted);
  }

  async reconcile(request: TracerExternalRequest) {
    requireMediaKind(request);
    const submission = submissionFromPayload(request.payload);
    const providerRequest = this.providerRequest(submission, request);
    let taskRef = request.providerTaskRef;
    if (!taskRef) {
      const recovered = await this.dependencies.provider.recover(providerRequest);
      let receipt = recovered;
      if (!receipt) {
        const resolution = await this.resolveProviderRequest(submission, request);
        if (resolution.kind === 'failure') {
          return this.recordReferenceResolutionFailure(
            submission,
            resolution.failures,
          );
        }
        if (resolution.kind === 'policy_failure') {
          return this.recordProviderReferencePolicyFailure(
            submission,
            resolution.error,
          );
        }
        receipt = await this.dependencies.provider.submit(resolution.request);
      }
      const submissionOutcome = await this.recordSubmissionReceipt(
        submission,
        receipt,
      );
      if (!recovered || submissionOutcome.acceptance !== 'accepted') {
        return submissionOutcome;
      }
      taskRef = submissionOutcome.taskRef;
      if (!taskRef) return submissionOutcome;
    }
    const providerState = await this.dependencies.provider.poll({
      ...providerRequest,
      taskRef,
    });
    if (
      providerState.status === 'queued' ||
      providerState.status === 'running' ||
      providerState.status === 'unknown'
    ) {
      return {
        acceptance:
          providerState.status === 'unknown' &&
          request.previousAcceptance === 'acceptance_unknown'
            ? ('acceptance_unknown' as const)
            : ('accepted' as const),
        delivery:
          providerState.status === 'unknown'
            ? ('unknown' as const)
            : ('pending' as const),
        taskRef,
        ...(providerState.error || providerState.errorCode
          ? {
              error: providerErrorEvidence(
                'poll',
                providerState,
                providerState.error ?? 'Provider media delivery is pending.',
              ),
            }
          : {}),
      };
    }

    const pending = await this.recoverPending(submission);
    if (providerState.status === 'failed') {
      const failed = terminalResult(
        pending,
        taskRef,
        providerState.providerCost,
        'failed',
      );
      await this.dependencies.models.reconcileProviderResult(
        submission,
        failed,
        'provider_poll_failed',
      );
      return {
        acceptance: 'accepted' as const,
        delivery: 'failed' as const,
        taskRef,
        error: providerErrorEvidence(
          'poll',
          providerState,
          providerState.error ?? 'Provider media delivery failed.',
        ),
      };
    }

    let downloaded: Awaited<
      ReturnType<MediaProviderLifecyclePort['download']>
    >;
    let asset: Awaited<
      ReturnType<ModelSupplyApplicationService['persistProviderAsset']>
    >;
    try {
      downloaded = await this.dependencies.provider.download({
        ...providerRequest,
        taskRef,
      });
      asset = await this.dependencies.models.persistProviderAsset({
        workspaceId: submission.workspaceId,
        bytes: downloaded.bytes,
        contentType: downloaded.contentType,
        sourceExpiresAt:
          downloaded.sourceExpiresAt ?? providerState.sourceExpiresAt,
        sourceTaskRef: taskRef,
      });
    } catch (error) {
      return {
        acceptance: 'accepted' as const,
        delivery: 'unknown' as const,
        taskRef,
        error: providerThrownErrorEvidence('download', error),
      };
    }
    const completed = {
      ...terminalResult(
        pending,
        taskRef,
        providerState.providerCost,
        'completed',
      ),
      asset,
    };
    await this.dependencies.models.reconcileProviderResult(
      submission,
      completed,
      'provider_poll_completed_with_storage_receipt',
    );
    return {
      acceptance: 'accepted' as const,
      delivery: 'completed' as const,
      taskRef,
      output: { result: completed },
    };
  }

  async reconcileCancelledProviderTerminal(
    request: TracerExternalRequest,
  ): Promise<CancelledMediaProviderTerminalOutcome> {
    requireMediaKind(request);
    const submission = submissionFromPayload(request.payload);
    const taskRef = request.providerTaskRef;
    if (!taskRef) {
      throw new Error(
        'Cancelled media reconciliation requires a provider task reference.',
      );
    }
    const pending = await this.recoverPending(submission);
    if (
      pending.status !== 'failed' ||
      pending.usage.status !== 'refunded'
    ) {
      throw new Error(
        'Late provider terminal reconciliation requires a refunded cancelled result.',
      );
    }
    const providerRequest = this.providerRequest(submission, request);
    const providerState = await this.dependencies.provider.poll({
      ...providerRequest,
      taskRef,
    });
    if (
      providerState.status === 'queued' ||
      providerState.status === 'running' ||
      providerState.status === 'unknown'
    ) {
      return {
        status: 'pending',
        result: pending,
        ...(providerState.errorCode
          ? { errorCode: providerState.errorCode }
          : {}),
        ...(providerState.retryable === undefined
          ? {}
          : { retryable: providerState.retryable }),
        ...(providerState.error || providerState.errorCode
          ? {
              error: providerErrorEvidence(
                'late_poll',
                providerState,
                providerState.error ?? 'Provider terminal is still pending.',
              ),
            }
          : {}),
      };
    }

    let asset:
      | Awaited<
          ReturnType<ModelSupplyApplicationService['persistProviderAsset']>
        >
      | undefined;
    if (providerState.status === 'completed') {
      const downloaded = await this.dependencies.provider.download({
        ...providerRequest,
        taskRef,
      });
      asset = await this.dependencies.models.persistProviderAsset({
        workspaceId: submission.workspaceId,
        bytes: downloaded.bytes,
        contentType: downloaded.contentType,
        sourceExpiresAt:
          downloaded.sourceExpiresAt ?? providerState.sourceExpiresAt,
        sourceTaskRef: taskRef,
      });
    }
    const providerCost = lateObservedProviderCost(
      pending,
      taskRef,
      providerState.status,
      providerState.providerCost,
    );
    const reconciliation: CancelledMediaProviderTerminalReconciliation = {
      reconciliationKey: lateTerminalReconciliationKey(
        pending,
        taskRef,
        providerState.status,
        providerCost,
        asset,
      ),
      providerTaskRef: taskRef,
      providerStatus: providerState.status,
      isolatedFromCancelledWorkflow: true,
      providerCost,
      ...(asset ? { asset } : {}),
      ...(providerState.errorCode
        ? { errorCode: providerState.errorCode }
        : {}),
      ...(providerState.retryable === undefined
        ? {}
        : { retryable: providerState.retryable }),
      ...(providerState.error
        ? {
            error: providerErrorEvidence(
              'late_poll',
              providerState,
              providerState.error,
            ),
          }
        : {}),
      reconciledAt: new Date().toISOString(),
    };
    const result = await this.dependencies.models.recordCancelledProviderTerminal(
      submission,
      pending,
      reconciliation,
    );
    return {
      status: reconciliation.providerStatus,
      reconciliation,
      result,
    };
  }

  private async recordSubmissionReceipt(
    submission: ModelSupplySubmission,
    accepted: MediaProviderSubmissionReceipt,
  ) {
    const pendingExecution: ProviderExecutionPort = {
      execute: async () => ({
        kind: 'failure',
        acceptance:
          accepted.acceptance === 'rejected_before_accept'
            ? 'rejected_before_accept'
            : accepted.acceptance,
        ...(accepted.taskRef ? { providerTaskRef: accepted.taskRef } : {}),
        ...(accepted.errorCode ? { errorCode: accepted.errorCode } : {}),
        ...(accepted.retryable === undefined
          ? {}
          : { retryable: accepted.retryable }),
        message:
          accepted.error || accepted.errorCode
            ? providerErrorEvidence(
                'submit',
                accepted,
                accepted.error ?? 'Provider media submission failed.',
              )
            : accepted.acceptance === 'rejected_before_accept'
              ? 'Provider rejected media generation before accepting it.'
              : 'Provider task was accepted and awaits reconciliation.',
        providerCost: accepted.providerCost,
      }),
    };
    const result = await this.dependencies.models.executeMediaProviderSubmission(
      submission,
      pendingExecution,
    );
    if (accepted.acceptance === 'rejected_before_accept') {
      return {
        acceptance: accepted.acceptance,
        delivery: 'failed' as const,
        error: providerErrorEvidence(
          'submit',
          accepted,
          accepted.error ?? 'Provider rejected media generation.',
        ),
        output: { result },
        retryable: accepted.retryable ?? false,
        ...(accepted.taskRef ? { taskRef: accepted.taskRef } : {}),
      };
    }
    return {
      acceptance: accepted.acceptance,
      delivery:
        accepted.acceptance === 'acceptance_unknown'
          ? ('unknown' as const)
          : ('pending' as const),
      taskRef: accepted.taskRef ?? result.attempt.providerTaskRef,
      ...(accepted.error || accepted.errorCode
        ? {
            error: providerErrorEvidence(
              'submit',
              accepted,
              accepted.error ?? 'Provider media submission is unresolved.',
            ),
          }
        : {}),
    };
  }

  async cancel(request: TracerExternalRequest) {
    requireMediaKind(request);
    const submission = submissionFromPayload(request.payload);
    const hadPriorAttempt = (request.previousAttemptCount ?? 0) > 0;
    let acceptance = request.previousAcceptance;
    let taskRef = request.providerTaskRef;
    if (!taskRef && hadPriorAttempt) {
      const recovered = await this.dependencies.provider.recover(
        this.providerRequest(submission, request),
      );
      if (!recovered) {
        throw new Error(
          'Provider cancellation recovery has not confirmed whether the submitted task was accepted.',
        );
      }
      acceptance = recovered.acceptance;
      taskRef = recovered.taskRef;
      if (acceptance !== 'rejected_before_accept' && !taskRef) {
        throw new Error(
          'Provider cancellation recovery returned no task reference for a possibly accepted task.',
        );
      }
    }
    if (!taskRef && !hadPriorAttempt) {
      acceptance = 'rejected_before_accept';
    }
    if (taskRef) {
      const cancellation = await this.dependencies.provider.cancel({
        ...this.providerRequest(submission, request),
        taskRef,
      });
      acceptance = 'accepted';
      if (cancellation?.status === 'pending') {
        return {
          status: 'pending' as const,
          acceptance,
          taskRef,
          error: providerErrorEvidence(
            'cancel',
            cancellation,
            cancellation.error ?? 'Provider cancellation remains pending.',
          ),
        };
      }
    }
    if (!taskRef && acceptance !== 'rejected_before_accept') {
      throw new Error(
        'Provider cancellation is not confirmed, so the job remains pending reconciliation.',
      );
    }
    const shouldSettleAttempt = Boolean(taskRef) || hadPriorAttempt;
    const pending = shouldSettleAttempt
      ? await this.recoverPending(submission)
      : this.dependencies.models.previewMediaSubmission(submission);
    const cancelled = terminalResult(
      pending,
      taskRef,
      {
        amount: pending.providerCost.amount,
        currency: pending.providerCost.currency,
        usage: structuredClone(pending.providerCost.usage),
      },
      'failed',
      acceptance,
    );
    if (shouldSettleAttempt) {
      await this.dependencies.models.reconcileProviderResult(
        submission,
        cancelled,
        taskRef ? 'provider_cancelled' : 'provider_rejected_before_cancel',
      );
    }
    return {
      acceptance,
      taskRef,
      output: { cancelled: true, result: cancelled },
    };
  }

  private recoverPending(submission: ModelSupplySubmission) {
    return this.dependencies.models.executeMediaProviderSubmission(submission, {
      async execute() {
        throw new Error('A persisted media attempt must reconcile, never resubmit.');
      },
    });
  }

  private providerRequest(
    submission: ModelSupplySubmission,
    request: TracerExternalRequest,
    resolvedReferenceAssets?: ResolvedReferenceAsset[],
    resolvedInputAssets?: Array<
      ResolvedReferenceAsset & { role: CanvasGenerationInputAsset['role'] }
    >,
  ): MediaProviderEffectRequest {
    return {
      ...this.dependencies.models.mediaProviderRequest(submission),
      effectIdempotencyKey: request.effectIdempotencyKey,
      ...(resolvedReferenceAssets?.length
        ? { resolvedReferenceAssets: structuredClone(resolvedReferenceAssets) }
        : {}),
      ...(resolvedInputAssets?.length
        ? { resolvedInputAssets: structuredClone(resolvedInputAssets) }
        : {}),
    };
  }

  private async resolveProviderRequest(
    submission: ModelSupplySubmission,
    request: TracerExternalRequest,
  ): Promise<
    | { kind: 'request'; request: MediaProviderEffectRequest }
    | { kind: 'failure'; failures: ReferenceAssetResolutionFailure[] }
    | { kind: 'policy_failure'; error: ProviderReferencePolicyError }
  > {
    const declaredInputAssets = submission.input?.inputAssets ??
      (submission.input?.referenceAssetIds ?? []).map((assetId) => ({
        assetId,
        role: 'reference_image' as const,
      }));
    const assetIds = declaredInputAssets.map((asset) => asset.assetId);
    if (assetIds.length === 0) {
      return { kind: 'request', request: this.providerRequest(submission, request) };
    }
    if (!this.dependencies.referenceAssets) {
      return {
        kind: 'failure',
        failures: assetIds.map((assetId) => ({
          assetId,
          kind: 'failure',
          reason: 'unreadable',
        })),
      };
    }
    const results = await this.dependencies.referenceAssets.resolve(
      submission.workspaceId,
      assetIds,
    );
    const failures = results.filter(
      (result): result is ReferenceAssetResolutionFailure =>
        result.kind === 'failure',
    );
    const resolved = results.filter(
      (result): result is ResolvedReferenceAsset => result.kind === 'resolved',
    );
    if (
      failures.length > 0 ||
      resolved.length !== assetIds.length ||
      assetIds.some((assetId, index) => resolved[index]?.assetId !== assetId)
    ) {
      return {
        kind: 'failure',
        failures:
          failures.length > 0
            ? failures
            : assetIds.map((assetId) => ({
                assetId,
                kind: 'failure' as const,
                reason: 'unreadable' as const,
              })),
      };
    }
    const providerRequest = this.providerRequest(
      submission,
      request,
      resolved,
      resolved.map((asset, index) => ({
        ...asset,
        role: declaredInputAssets[index]!.role,
      })),
    );
    try {
      (
        this.dependencies.referencePolicy ??
        CURRENT_PROVIDER_REFERENCE_POLICY
      ).assertCanDispatch({
        deploymentId: providerRequest.deployment.id,
        ...(providerRequest.deployment.executionChannelId
          ? {
              executionChannelId:
                providerRequest.deployment.executionChannelId,
            }
          : {}),
        operation: providerRequest.submission.operation,
        ...(providerRequest.deployment.providerModel
          ? { providerModel: providerRequest.deployment.providerModel }
          : {}),
        ...(providerRequest.deployment.providerProfileId
          ? { providerProfileId: providerRequest.deployment.providerProfileId }
          : {}),
        referenceAssetCount: resolved.length,
      });
    } catch (error) {
      if (error instanceof ProviderReferencePolicyError) {
        return { kind: 'policy_failure', error };
      }
      throw error;
    }
    return {
      kind: 'request',
      request: providerRequest,
    };
  }

  private async recordReferenceResolutionFailure(
    submission: ModelSupplySubmission,
    failures: ReferenceAssetResolutionFailure[],
  ) {
    const message = `Reference asset resolution required: ${failures
      .map((failure) => `${failure.assetId} (${failure.reason})`)
      .join(', ')}.`;
    const result = await this.dependencies.models.executeMediaProviderSubmission(
      submission,
      {
        async execute() {
          return {
            kind: 'failure' as const,
            acceptance: 'rejected_before_accept' as const,
            errorCode: 'reference_asset_resolution_required',
            retryable: false,
            message,
            providerCost: { amount: 0, currency: 'USD' as const, usage: {} },
          };
        },
      },
    );
    return {
      acceptance: 'rejected_before_accept' as const,
      delivery: 'failed' as const,
      error: message,
      output: { result },
      retryable: false,
    };
  }

  private async recordProviderReferencePolicyFailure(
    submission: ModelSupplySubmission,
    error: ProviderReferencePolicyError,
  ) {
    const result = await this.dependencies.models.executeMediaProviderSubmission(
      submission,
      {
        async execute() {
          return {
            kind: 'failure' as const,
            acceptance: 'rejected_before_accept' as const,
            errorCode: error.code,
            retryable: false,
            message: error.message,
            providerCost: { amount: 0, currency: 'USD' as const, usage: {} },
          };
        },
      },
    );
    return {
      acceptance: 'rejected_before_accept' as const,
      delivery: 'failed' as const,
      error: error.message,
      output: { result },
      retryable: false,
    };
  }
}

export function createMediaGenerationJobHandler(
  worker: Pick<DurableTracerWorkerLike, 'handle'>,
): JobRuntimeHandler {
  return (envelope, context) => worker.handle(envelope, context);
}

interface DurableTracerWorkerLike {
  handle: JobRuntimeHandler;
}

function terminalResult(
  pending: ModelSupplyResult,
  taskRef: string | undefined,
  cost: Omit<ProviderCost, 'id' | 'status'>,
  status: 'completed' | 'failed',
  acceptance: ModelSupplyResult['attempt']['acceptance'] = 'accepted',
): ModelSupplyResult {
  const observed: ProviderCost = {
    id: `${pending.providerCost.id}-${status}-observed`,
    status: 'observed',
    ...cost,
  };
  const attempt = {
    ...pending.attempt,
    acceptance,
    ...(taskRef ? { providerTaskRef: taskRef } : {}),
    status,
  };
  return {
    ...structuredClone(pending),
    status,
    attempt,
    attempts: pending.attempts.map((candidate) =>
      candidate.id === attempt.id ? structuredClone(attempt) : candidate,
    ),
    usage: {
      ...pending.usage,
      status: status === 'completed' ? 'committed' : 'refunded',
    },
    providerCost: observed,
    providerCosts: [...pending.providerCosts, observed],
  };
}

function submissionFromPayload(payload: Record<string, unknown>) {
  const submission = payload.submission;
  if (!submission || typeof submission !== 'object' || Array.isArray(submission)) {
    throw new Error('Media job payload requires a submission.');
  }
  return structuredClone(submission) as ModelSupplySubmission;
}

function resultFromOutput(output: Record<string, unknown> | null) {
  const result = output?.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return undefined;
  }
  return structuredClone(result) as ModelSupplyResult;
}

function cancelledTerminalFromOutput(
  output: Record<string, unknown> | null,
) {
  const terminal = output?.cancelledProviderTerminal;
  if (!terminal || typeof terminal !== 'object' || Array.isArray(terminal)) {
    return undefined;
  }
  return structuredClone(
    terminal,
  ) as CancelledMediaProviderTerminalReconciliation;
}

function tracerRequestFromRecord(
  record: TracerJobRecord,
): TracerExternalRequest {
  return {
    workspaceId: record.workspaceId,
    jobId: record.jobId,
    kind: record.kind,
    payload: structuredClone(record.payload),
    idempotencyKey: `${record.workspaceId}:${record.jobId}`,
    effectIdempotencyKey: record.effectIdempotencyKey,
    ...(record.providerTaskRef
      ? { providerTaskRef: record.providerTaskRef }
      : {}),
    ...(record.acceptance ? { previousAcceptance: record.acceptance } : {}),
    previousAttemptCount: record.attempts,
  };
}

function providerErrorEvidence(
  phase: string,
  value: { errorCode?: string; retryable?: boolean },
  message: string,
) {
  return `provider_error phase=${phase} code=${value.errorCode ?? 'unknown'} retryable=${
    value.retryable === undefined ? 'unknown' : String(value.retryable)
  } message=${message}`;
}

function providerThrownErrorEvidence(phase: string, error: unknown) {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : 'asset_persistence_failed';
  const contractRetryable =
    error &&
    typeof error === 'object' &&
    'contract' in error &&
    error.contract &&
    typeof error.contract === 'object' &&
    'retryable' in error.contract
      ? Boolean(error.contract.retryable)
      : undefined;
  const retryable =
    error && typeof error === 'object' && 'retryable' in error
      ? Boolean(error.retryable)
      : (contractRetryable ?? true);
  const message = error instanceof Error ? error.message : String(error);
  return providerErrorEvidence(phase, { errorCode: code, retryable }, message);
}

function lateObservedProviderCost(
  pending: ModelSupplyResult,
  taskRef: string,
  status: 'completed' | 'failed',
  cost: Omit<ProviderCost, 'id' | 'status'>,
): ProviderCost {
  return {
    id: `provider-cost-${createHash('sha256')
      .update(`${pending.attempt.id}:${taskRef}:late:${status}`)
      .digest('hex')
      .slice(0, 24)}`,
    status: 'observed',
    ...structuredClone(cost),
  };
}

function lateTerminalReconciliationKey(
  pending: ModelSupplyResult,
  taskRef: string,
  status: 'completed' | 'failed',
  cost: ProviderCost,
  asset?: { sha256: string },
) {
  return `late-provider-terminal-${createHash('sha256')
    .update(
      JSON.stringify({
        jobId: pending.jobId,
        taskRef,
        status,
        cost,
        assetSha256: asset?.sha256 ?? null,
      }),
    )
    .digest('hex')
    .slice(0, 28)}`;
}

function assertRequestFingerprint(
  record: TracerJobRecord,
  requestFingerprint: string,
) {
  if (record.payload.requestFingerprint !== requestFingerprint) {
    throw new Error('Media generation idempotency key conflicts with another request.');
  }
}

function requireMediaKind(request: TracerExternalRequest) {
  if (request.kind !== MODEL_MEDIA_GENERATION_JOB_KIND) {
    throw new Error(`Unsupported media generation job kind ${request.kind}.`);
  }
}
