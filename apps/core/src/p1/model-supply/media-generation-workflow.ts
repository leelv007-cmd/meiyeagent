import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
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
  applyActualRouteDecisionExplanation,
  mediaSubmissionFingerprint,
  mediaBoundedExecutionAuthorizationSchema,
  ModelSupplyProviderAdmissionError,
  type CancelledMediaProviderTerminalOutcome,
  type CancelledMediaProviderTerminalReconciliation,
  type DurableMediaGenerationJobView,
  type CanvasGenerationInputAsset,
  type DurableMediaGenerationRuntimePort,
  type MediaProviderEffectRequest,
  type MediaProviderLifecyclePort,
  type MediaProviderSubmissionReceipt,
  type MediaBoundedExecutionAuthorization,
  type ModelSupplyApplicationService,
  type ModelSupplyResult,
  type ModelSupplySubmission,
  type ProviderCost,
  type ProviderExecutionRequest,
  type ProviderExecutionResponse,
  type ReferenceAssetResolutionFailure,
  type ReferenceAssetResolverPort,
  type ResolvedReferenceAsset,
  type RouteSnapshot,
} from './index.js';

export const MODEL_MEDIA_GENERATION_JOB_KIND = 'model.media-generation';

export interface MediaGenerationJobApplicationPort {
  submit(input: TracerJobInput): Promise<TracerJobRecord>;
  find(workspaceId: string, jobId: string): Promise<TracerJobRecord | null>;
  get(workspaceId: string, jobId: string): Promise<TracerJobRecord>;
  cancel(workspaceId: string, jobId: string): Promise<TracerJobRecord>;
  resumeFailed?(input: {
    workspaceId: string;
    jobId: string;
    expectedPayloadHash: string;
    payload: Record<string, unknown>;
  }): Promise<TracerJobRecord>;
  recordCancelledReconciliation(
    workspaceId: string,
    jobId: string,
    providerTaskRef: string,
    reconciliationKey: string,
    output: Record<string, unknown>
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
    }
  ) {}

  async submit(submission: ModelSupplySubmission) {
    const preview =
      await this.dependencies.models.prepareMediaSubmission(submission);
    const requestFingerprint = mediaSubmissionFingerprint(submission);
    const existing = await this.dependencies.jobs.find(
      submission.workspaceId,
      preview.jobId
    );
    if (existing) {
      assertRequestFingerprint(existing, requestFingerprint);
      const result = (await this.view(existing)).result;
      await this.dependencies.models.persistGenerationResult(
        submission.workspaceId,
        result
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
      result
    );
    return result;
  }

  async get(workspaceId: string, jobId: string) {
    return this.view(await this.dependencies.jobs.get(workspaceId, jobId));
  }

  async cancel(input: { workspaceId: string; jobId: string; actorId: string }) {
    return this.view(
      await this.dependencies.jobs.cancel(input.workspaceId, input.jobId)
    );
  }

  async resumeBoundedMediaJob(input: {
    workspaceId: string;
    jobId: string;
    authorization: MediaBoundedExecutionAuthorization;
  }) {
    const record = await this.dependencies.jobs.get(
      input.workspaceId,
      input.jobId
    );
    const result = resultFromOutput(record.output);
    if (
      record.status !== 'failed' ||
      result?.status !== 'failed' ||
      result.failureCode !== 'MEDIA_BOUNDED_ITERATION_EXCEEDED' ||
      !result.boundedExecution
    ) {
      throw new Error(
        'Only a durably suspended bounded media job can be resumed.'
      );
    }
    const authorization = mediaBoundedExecutionAuthorizationSchema.parse(
      input.authorization
    );
    assertBoundedMediaRaise(result.boundedExecution, authorization);
    if (!this.dependencies.jobs.resumeFailed) {
      throw new Error(
        'The durable media job runtime cannot resume failed jobs.'
      );
    }
    const submission = submissionFromPayload(record.payload);
    const resumed = await this.dependencies.jobs.resumeFailed({
      workspaceId: input.workspaceId,
      jobId: input.jobId,
      expectedPayloadHash: record.payloadHash,
      payload: {
        ...structuredClone(record.payload),
        submission: {
          ...submission,
          mediaBoundedExecution: authorization,
        },
      },
    });
    return this.view(resumed);
  }

  async reconcileCancelledProviderTerminal(input: {
    workspaceId: string;
    jobId: string;
    providerTaskRef: string;
  }): Promise<CancelledMediaProviderTerminalOutcome> {
    const record = await this.dependencies.jobs.get(
      input.workspaceId,
      input.jobId
    );
    if (record.providerTaskRef !== input.providerTaskRef) {
      throw new Error(
        'Late provider terminal task reference does not match the cancelled job.'
      );
    }
    if (record.status !== 'cancelled') {
      throw new Error(
        'Late provider terminal reconciliation requires a cancelled media job.'
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
        'Late provider terminal reconciliation requires the media provider runtime.'
      );
    }
    const effect = new ModelMediaGenerationEffect({
      models: this.dependencies.models,
      provider,
    });
    const outcome = await effect.reconcileCancelledProviderTerminal(
      tracerRequestFromRecord(record)
    );
    if (outcome.status === 'pending') return outcome;
    const persisted =
      await this.dependencies.jobs.recordCancelledReconciliation(
        input.workspaceId,
        input.jobId,
        input.providerTaskRef,
        outcome.reconciliation.reconciliationKey,
        {
          result: outcome.result,
          cancelledProviderTerminal: outcome.reconciliation,
        }
      );
    const persistedResult = resultFromOutput(persisted.output);
    const persistedReconciliation = cancelledTerminalFromOutput(
      persisted.output
    );
    if (!persistedResult || !persistedReconciliation) {
      throw new Error(
        'Cancelled media reconciliation was not durably recorded.'
      );
    }
    return {
      status: persistedReconciliation.providerStatus,
      reconciliation: persistedReconciliation,
      result: persistedResult,
    };
  }

  private async view(
    record: TracerJobRecord
  ): Promise<DurableMediaGenerationJobView> {
    const completed = resultFromOutput(record.output);
    const submission = submissionFromPayload(record.payload);
    const result =
      completed ?? this.dependencies.models.previewMediaSubmission(submission);
    if (record.providerTaskRef && !result.attempt.providerTaskRef) {
      result.attempt.providerTaskRef = record.providerTaskRef;
      const current = result.attempts.find(
        (attempt) => attempt.id === result.attempt.id
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
      providerLifecycleLatencyMs: record.activeExecutionMs,
      ...(result.cancelledProviderTerminal
        ? {
            cancelledProviderTerminal: structuredClone(
              result.cancelledProviderTerminal
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
    }
  ) {}

  async execute(request: TracerExternalRequest) {
    requireMediaKind(request);
    const submission = submissionFromPayload(request.payload);
    return this.submitProviderRoute(submission, request, false);
  }

  async reconcile(request: TracerExternalRequest) {
    requireMediaKind(request);
    const submission = submissionFromPayload(request.payload);
    let providerSubmission = submission;
    if (request.providerTaskRef) {
      const pending = await this.recoverPending(submission);
      providerSubmission = submissionWithPendingSnapshot(
        submission,
        pending.snapshot,
      );
    }
    let providerRequest = await this.providerRequest(
      providerSubmission,
      request
    );
    let taskRef = request.providerTaskRef;
    if (!taskRef) {
      const submissionOutcome = await this.submitProviderRoute(
        submission,
        request,
        true
      );
      if (submissionOutcome.acceptance !== 'accepted') {
        return submissionOutcome;
      }
      taskRef = submissionOutcome.taskRef;
      if (!taskRef) return submissionOutcome;
      const pending = await this.recoverPending(submission);
      providerSubmission = submissionWithPendingSnapshot(
        submission,
        pending.snapshot,
      );
      providerRequest = await this.providerRequest(providerSubmission, request);
    }
    const providerState = await this.providerEffect(
      providerSubmission,
      providerRequest,
      'poll',
      () =>
        this.dependencies.provider.poll({
          ...providerRequest,
          taskRef,
        })
    );
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
                providerState.error ?? 'Provider media delivery is pending.'
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
        'failed'
      );
      await this.dependencies.models.reconcileProviderResult(
        submission,
        failed,
        'provider_poll_failed'
      );
      return {
        acceptance: 'accepted' as const,
        delivery: 'failed' as const,
        taskRef,
        error: providerErrorEvidence(
          'poll',
          providerState,
          providerState.error ?? 'Provider media delivery failed.'
        ),
      };
    }

    let downloaded: Awaited<ReturnType<MediaProviderLifecyclePort['download']>>;
    let asset: Awaited<
      ReturnType<ModelSupplyApplicationService['persistProviderAsset']>
    >;
    try {
      downloaded = await this.providerEffect(
        providerSubmission,
        providerRequest,
        'download',
        () =>
          this.dependencies.provider.download({
            ...providerRequest,
            taskRef,
          })
      );
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
        'completed'
      ),
      asset,
    };
    await this.dependencies.models.reconcileProviderResult(
      submission,
      completed,
      'provider_poll_completed_with_storage_receipt'
    );
    return {
      acceptance: 'accepted' as const,
      delivery: 'completed' as const,
      taskRef,
      output: { result: completed },
    };
  }

  async reconcileCancelledProviderTerminal(
    request: TracerExternalRequest
  ): Promise<CancelledMediaProviderTerminalOutcome> {
    requireMediaKind(request);
    const submission = submissionFromPayload(request.payload);
    const taskRef = request.providerTaskRef;
    if (!taskRef) {
      throw new Error(
        'Cancelled media reconciliation requires a provider task reference.'
      );
    }
    const pending = await this.recoverPending(submission);
    if (pending.status !== 'failed' || pending.usage.status !== 'refunded') {
      throw new Error(
        'Late provider terminal reconciliation requires a refunded cancelled result.'
      );
    }
    const providerSubmission = submissionWithPendingSnapshot(
      submission,
      pending.snapshot,
    );
    const providerRequest = await this.providerRequest(
      providerSubmission,
      request
    );
    const providerState = await this.providerEffect(
      providerSubmission,
      providerRequest,
      'late_poll',
      () =>
        this.dependencies.provider.poll({
          ...providerRequest,
          taskRef,
        })
    );
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
                providerState.error ?? 'Provider terminal is still pending.'
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
      const downloaded = await this.providerEffect(
        providerSubmission,
        providerRequest,
        'late_download',
        () =>
          this.dependencies.provider.download({
            ...providerRequest,
            taskRef,
          })
      );
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
      providerState.providerCost
    );
    const reconciliation: CancelledMediaProviderTerminalReconciliation = {
      reconciliationKey: lateTerminalReconciliationKey(
        pending,
        taskRef,
        providerState.status,
        providerCost,
        asset
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
              providerState.error
            ),
          }
        : {}),
      reconciledAt: new Date().toISOString(),
    };
    const result =
      await this.dependencies.models.recordCancelledProviderTerminal(
        submission,
        pending,
        reconciliation
      );
    return {
      status: reconciliation.providerStatus,
      reconciliation,
      result,
    };
  }

  private providerResponseForReceipt(
    receipt: MediaProviderSubmissionReceipt
  ): ProviderExecutionResponse {
    return {
      kind: 'failure',
      acceptance: receipt.acceptance,
      ...(receipt.taskRef ? { providerTaskRef: receipt.taskRef } : {}),
      ...(receipt.errorCode ? { errorCode: receipt.errorCode } : {}),
      ...(receipt.retryable === undefined
        ? {}
        : { retryable: receipt.retryable }),
      message:
        receipt.error ??
        (receipt.acceptance === 'rejected_before_accept'
          ? 'Provider rejected media generation before accepting it.'
          : 'Provider task was accepted and awaits reconciliation.'),
      providerCost: receipt.providerCost,
    };
  }

  private async submitProviderRoute(
    submission: ModelSupplySubmission,
    tracerRequest: TracerExternalRequest,
    recoverFirst: boolean
  ) {
    let finalReceipt: MediaProviderSubmissionReceipt | undefined;
    const result =
      await this.dependencies.models.executeMediaProviderSubmission(
        submission,
        {
          execute: async (supplyRequest: ProviderExecutionRequest) => {
            const attemptRequest: TracerExternalRequest = {
              ...tracerRequest,
              effectIdempotencyKey:
                supplyRequest.effectIdempotencyKey ??
                tracerRequest.effectIdempotencyKey,
            };
            const resolution = await this.resolveProviderRequest(
              supplyRequest.submission,
              attemptRequest,
              supplyRequest
            );
            if (resolution.kind === 'failure') {
              const message = `Reference asset resolution required: ${resolution.failures
                .map((failure) => `${failure.assetId} (${failure.reason})`)
                .join(', ')}.`;
              finalReceipt = {
                acceptance: 'rejected_before_accept',
                errorCode: 'reference_asset_resolution_required',
                retryable: false,
                error: message,
                providerCost: { amount: 0, currency: 'USD', usage: {} },
              };
              return this.providerResponseForReceipt(finalReceipt);
            }
            if (resolution.kind === 'policy_failure') {
              finalReceipt = {
                acceptance: 'rejected_before_accept',
                errorCode: resolution.error.code,
                retryable: false,
                error: resolution.error.message,
                providerCost: { amount: 0, currency: 'USD', usage: {} },
              };
              return this.providerResponseForReceipt(finalReceipt);
            }
            let receipt: MediaProviderSubmissionReceipt | null = null;
            if (recoverFirst) {
              receipt = await this.providerEffect(
                supplyRequest.submission,
                resolution.request,
                'recover',
                () => this.dependencies.provider.recover(resolution.request)
              );
              if (!receipt) {
                receipt = {
                  acceptance: 'acceptance_unknown',
                  errorCode: 'provider_receipt_unresolved',
                  retryable: false,
                  error:
                    'Provider acceptance remains unknown; recovery found no receipt and must not resubmit.',
                  providerCost: {
                    amount: 0,
                    currency:
                      resolution.request.deployment.region === 'domestic'
                        ? 'CNY'
                        : 'USD',
                    usage: {},
                  },
                };
              }
            }
            if (!receipt) {
              receipt = await this.submitProvider(
                supplyRequest.submission,
                resolution.request
              );
            }
            finalReceipt = receipt;
            return this.providerResponseForReceipt(receipt);
          },
        },
        {
          continueAfterRecoveredCheckpoint: true,
          useFrozenMediaCandidateSequence: true,
          attemptEffectGuardsCheckpoint: true,
          effectIdempotencyKey: tracerRequest.effectIdempotencyKey,
          reconcileProviderReceipt: recoverFirst,
        }
      );
    const receipt = finalReceipt;
    if (result.attempt.acceptance === 'rejected_before_accept') {
      return {
        acceptance: 'rejected_before_accept' as const,
        delivery: 'failed' as const,
        error: receipt
          ? providerErrorEvidence(
              'submit',
              receipt,
              receipt.error ?? 'Provider rejected media generation.'
            )
          : 'Provider rejected media generation.',
        output: { result },
        retryable: receipt?.retryable ?? false,
        ...(receipt?.taskRef ? { taskRef: receipt.taskRef } : {}),
      };
    }
    return {
      acceptance: result.attempt.acceptance,
      delivery:
        result.attempt.acceptance === 'acceptance_unknown'
          ? ('unknown' as const)
          : ('pending' as const),
      taskRef: result.attempt.providerTaskRef ?? receipt?.taskRef,
      ...(receipt?.error || receipt?.errorCode
        ? {
            error: providerErrorEvidence(
              'submit',
              receipt,
              receipt.error ?? 'Provider media submission is unresolved.'
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
    const shouldSettleAttempt = Boolean(taskRef) || hadPriorAttempt;
    const pending = shouldSettleAttempt
      ? await this.recoverPending(submission)
      : undefined;
    const providerSubmission = pending
      ? submissionWithPendingSnapshot(submission, pending.snapshot)
      : submission;
    if (!taskRef && hadPriorAttempt) {
      const providerRequest = await this.providerRequest(
        providerSubmission,
        request
      );
      const recovered = await this.providerEffect(
        providerSubmission,
        providerRequest,
        'recover',
        () => this.dependencies.provider.recover(providerRequest)
      );
      if (!recovered) {
        throw new Error(
          'Provider cancellation recovery has not confirmed whether the submitted task was accepted.'
        );
      }
      acceptance = recovered.acceptance;
      taskRef = recovered.taskRef;
      if (acceptance !== 'rejected_before_accept' && !taskRef) {
        throw new Error(
          'Provider cancellation recovery returned no task reference for a possibly accepted task.'
        );
      }
    }
    if (!taskRef && !hadPriorAttempt) {
      acceptance = 'rejected_before_accept';
    }
    if (taskRef) {
      const providerRequest = await this.providerRequest(
        providerSubmission,
        request
      );
      const cancellation = await this.providerEffect(
        providerSubmission,
        providerRequest,
        'cancel',
        () =>
          this.dependencies.provider.cancel({
            ...providerRequest,
            taskRef,
          })
      );
      acceptance = 'accepted';
      if (cancellation?.status === 'pending') {
        return {
          status: 'pending' as const,
          acceptance,
          taskRef,
          error: providerErrorEvidence(
            'cancel',
            cancellation,
            cancellation.error ?? 'Provider cancellation remains pending.'
          ),
        };
      }
    }
    if (!taskRef && acceptance !== 'rejected_before_accept') {
      throw new Error(
        'Provider cancellation is not confirmed, so the job remains pending reconciliation.'
      );
    }
    const result =
      pending ?? this.dependencies.models.previewMediaSubmission(submission);
    const cancelled = terminalResult(
      result,
      taskRef,
      {
        amount: result.providerCost.amount,
        currency: result.providerCost.currency,
        usage: structuredClone(result.providerCost.usage),
      },
      'failed',
      acceptance
    );
    if (shouldSettleAttempt) {
      await this.dependencies.models.reconcileProviderResult(
        submission,
        cancelled,
        taskRef ? 'provider_cancelled' : 'provider_rejected_before_cancel'
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
        throw new Error(
          'A persisted media attempt must reconcile, never resubmit.'
        );
      },
    });
  }

  private async submitProvider(
    submission: ModelSupplySubmission,
    request: MediaProviderEffectRequest
  ): Promise<MediaProviderSubmissionReceipt> {
    try {
      return await this.providerEffect(submission, request, 'submit', () =>
        this.dependencies.provider.submit(request)
      );
    } catch (error) {
      if (!(error instanceof ModelSupplyProviderAdmissionError)) throw error;
      return {
        acceptance:
          error.disposition === 'reconcile_without_resubmit'
            ? 'acceptance_unknown'
            : 'rejected_before_accept',
        errorCode: error.errorCode,
        error: error.message,
        retryable: error.retryable,
        providerCost: {
          amount: 0,
          currency: request.deployment.region === 'domestic' ? 'CNY' : 'USD',
          usage: {},
        },
      };
    }
  }

  private providerEffect<T>(
    submission: ModelSupplySubmission,
    request: MediaProviderEffectRequest,
    stage:
      | 'submit'
      | 'recover'
      | 'poll'
      | 'download'
      | 'cancel'
      | 'late_poll'
      | 'late_download',
    execute: () => Promise<T>
  ) {
    return this.dependencies.models.executeMediaProviderEffect({
      submission,
      effectIdempotencyKey: request.effectIdempotencyKey,
      stage,
      ...(request.attemptId ? { attemptId: request.attemptId } : {}),
      ...(request.attemptOrdinal
        ? { attemptOrdinal: request.attemptOrdinal }
        : {}),
      ...(request.routeSnapshot
        ? { routeSnapshot: request.routeSnapshot }
        : {}),
      model: request.model,
      deployment: request.deployment,
      ...(request.previousAttempts
        ? { previousAttempts: request.previousAttempts }
        : {}),
      ...(request.previousProviderCosts
        ? { previousProviderCosts: request.previousProviderCosts }
        : {}),
      execute,
    });
  }

  private async providerRequest(
    submission: ModelSupplySubmission,
    request: TracerExternalRequest,
    resolvedReferenceAssets?: ResolvedReferenceAsset[],
    resolvedInputAssets?: Array<
      ResolvedReferenceAsset & { role: CanvasGenerationInputAsset['role'] }
    >,
    supplyRequest?: ProviderExecutionRequest
  ): Promise<MediaProviderEffectRequest> {
    return {
      ...(supplyRequest ??
        (await this.dependencies.models.mediaProviderRequestForExecution(
          submission
        ))),
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
    supplyRequest?: ProviderExecutionRequest
  ): Promise<
    | { kind: 'request'; request: MediaProviderEffectRequest }
    | { kind: 'failure'; failures: ReferenceAssetResolutionFailure[] }
    | { kind: 'policy_failure'; error: ProviderReferencePolicyError }
  > {
    const declaredInputAssets =
      submission.input?.inputAssets ??
      (submission.input?.referenceAssetIds ?? []).map((assetId) => ({
        assetId,
        role: 'reference_image' as const,
      }));
    const assetIds = declaredInputAssets.map((asset) => asset.assetId);
    if (assetIds.length === 0) {
      return {
        kind: 'request',
        request: await this.providerRequest(
          submission,
          request,
          undefined,
          undefined,
          supplyRequest
        ),
      };
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
      assetIds
    );
    const failures = results.filter(
      (result): result is ReferenceAssetResolutionFailure =>
        result.kind === 'failure'
    );
    const resolved = results.filter(
      (result): result is ResolvedReferenceAsset => result.kind === 'resolved'
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
    const providerRequest = await this.providerRequest(
      submission,
      request,
      resolved,
      resolved.map((asset, index) => ({
        ...asset,
        role: declaredInputAssets[index]!.role,
      })),
      supplyRequest
    );
    try {
      (
        this.dependencies.referencePolicy ?? CURRENT_PROVIDER_REFERENCE_POLICY
      ).assertCanDispatch({
        deploymentId: providerRequest.deployment.id,
        ...(providerRequest.deployment.executionChannelId
          ? {
              executionChannelId: providerRequest.deployment.executionChannelId,
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
}

export function createMediaGenerationJobHandler(
  worker: Pick<DurableTracerWorkerLike, 'handle'>
): JobRuntimeHandler {
  return (envelope, context) => worker.handle(envelope, context);
}

interface DurableTracerWorkerLike {
  handle: JobRuntimeHandler;
}

function submissionWithPendingSnapshot(
  submission: ModelSupplySubmission,
  snapshot: RouteSnapshot,
): ModelSupplySubmission {
  return {
    ...structuredClone(submission),
    selection: {
      mode: 'fixed',
      catalogModelId: snapshot.actualCatalogModelId,
      fallbackConsent: submission.selection.fallbackConsent,
    },
    pricingTier: snapshot.pricingTier ?? submission.pricingTier ?? 'standard',
    frozenRouteSnapshot: structuredClone(snapshot),
  };
}

function terminalResult(
  pending: ModelSupplyResult,
  taskRef: string | undefined,
  cost: Omit<ProviderCost, 'id' | 'status'>,
  status: 'completed' | 'failed',
  acceptance: ModelSupplyResult['attempt']['acceptance'] = 'accepted'
): ModelSupplyResult {
  const observed: ProviderCost = {
    id: `${pending.providerCost.id}-${status}-observed`,
    status: 'observed',
    ...cost,
    ...(cost.failover || pending.providerCost.failover
      ? {
          failover: structuredClone(
            cost.failover ?? pending.providerCost.failover!,
          ),
        }
      : {}),
  };
  const attempt = {
    ...pending.attempt,
    acceptance,
    ...(taskRef ? { providerTaskRef: taskRef } : {}),
    status,
  };
  return applyActualRouteDecisionExplanation({
    ...structuredClone(pending),
    status,
    attempt,
    attempts: pending.attempts.map((candidate) =>
      candidate.id === attempt.id ? structuredClone(attempt) : candidate
    ),
    usage: {
      ...pending.usage,
      status: status === 'completed' ? 'committed' : 'refunded',
    },
    providerCost: observed,
    providerCosts: [...pending.providerCosts, observed],
  });
}

function submissionFromPayload(payload: Record<string, unknown>) {
  const submission = payload.submission;
  if (
    !submission ||
    typeof submission !== 'object' ||
    Array.isArray(submission)
  ) {
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

function cancelledTerminalFromOutput(output: Record<string, unknown> | null) {
  const terminal = output?.cancelledProviderTerminal;
  if (!terminal || typeof terminal !== 'object' || Array.isArray(terminal)) {
    return undefined;
  }
  return structuredClone(
    terminal
  ) as CancelledMediaProviderTerminalReconciliation;
}

function tracerRequestFromRecord(
  record: TracerJobRecord
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
  message: string
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
  cost: Omit<ProviderCost, 'id' | 'status'>
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
  asset?: { sha256: string }
) {
  return `late-provider-terminal-${createHash('sha256')
    .update(
      JSON.stringify({
        jobId: pending.jobId,
        taskRef,
        status,
        cost,
        assetSha256: asset?.sha256 ?? null,
      })
    )
    .digest('hex')
    .slice(0, 28)}`;
}

function assertRequestFingerprint(
  record: TracerJobRecord,
  requestFingerprint: string
) {
  if (record.payload.requestFingerprint !== requestFingerprint) {
    throw new Error(
      'Media generation idempotency key conflicts with another request.'
    );
  }
}

function assertBoundedMediaRaise(
  previous: NonNullable<ModelSupplyResult['boundedExecution']>,
  next: MediaBoundedExecutionAuthorization
) {
  const previousSnapshot = previous.snapshot;
  const nextSnapshot = next.snapshot;
  if (
    previous.triggeredLimit !== 'maxIterations' ||
    previousSnapshot.stopReason !== 'limit_reached' ||
    previousSnapshot.triggeredLimit !== 'maxIterations' ||
    nextSnapshot.stopReason !== null ||
    nextSnapshot.triggeredLimit !== null ||
    typeof previousSnapshot.maxIterations !== 'number' ||
    typeof nextSnapshot.maxIterations !== 'number' ||
    nextSnapshot.maxIterations <= previousSnapshot.maxIterations ||
    nextSnapshot.maxIterations <= nextSnapshot.consumption.iterations ||
    !isDeepStrictEqual(nextSnapshot.consumption, previous.consumption) ||
    !isDeepStrictEqual(
      nextSnapshot.requiredLimits,
      previousSnapshot.requiredLimits,
    ) ||
    nextSnapshot.maxCostCents !== previousSnapshot.maxCostCents ||
    nextSnapshot.maxWallClockMs !== previousSnapshot.maxWallClockMs ||
    nextSnapshot.maxDelegations !== previousSnapshot.maxDelegations ||
    !isDeepStrictEqual(
      next.countedAttemptIds,
      previous.consumedAttemptIds,
    ) ||
    !isDeepStrictEqual(
      next.countedProviderCostIds,
      previous.consumedProviderCostIds,
    )
  ) {
    throw new Error(
      'Bounded media resume requires the exact consumed checkpoint and a strictly raised iteration limit.'
    );
  }
}

function requireMediaKind(request: TracerExternalRequest) {
  if (request.kind !== MODEL_MEDIA_GENERATION_JOB_KIND) {
    throw new Error(`Unsupported media generation job kind ${request.kind}.`);
  }
}
