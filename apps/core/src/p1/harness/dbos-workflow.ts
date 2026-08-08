import { DBOS } from '@dbos-inc/dbos-sdk';
import {
  harnessInteractionAnswerSchema,
  questionCardSchema,
  structuredDecisionInputSchema,
  workflowProgressEnvelopeSchema,
  workflowTokenEnvelopeSchema,
  type BoundedExecutionLimitName,
  type HarnessInteractionRequest,
  type HarnessStage,
  type ProductUsageUnit,
  type QuestionCard,
  type StructuredDecisionInput,
} from '@meiye/contracts';

import {
  assertBoundedExecutionContinuationAuthorization,
  HarnessWorkflowCancellation,
  runHarnessWorkflow,
  harnessMediaJobTopic,
  type BoundedExecutionContinuationCapability,
  type HarnessStageCollaborators,
  type HarnessStagePorts,
  type HarnessWorkflowRuntime,
} from './workflow-core.js';
import { resumeWithRaisedServerLimit } from './bounded-execution-controller.js';
import type {
  HarnessWorkflowInput,
  HarnessWorkflowStarter,
} from './task-admission.js';
import {
  resolveDurableReplayBranch,
  verifyExecutionPlanSnapshotForDbos,
  type ExecutionPlanAdmissionPort,
  type SnapshotLiveFacts,
} from './execution-plan-admission.js';
import {
  projectLegacyFromMakeRequest,
  type ShadowReconciliationService,
} from './shadow-reconciliation.js';
import type {
  HarnessDecisionService,
  HarnessDecisionStore,
} from './decision-service.js';
import { normalizeHarnessTerminalFailure } from './terminal-failure.js';
import { harnessRuntimeId } from './workspace-scope.js';
import {
  buildSemanticDecisionResumption,
  type HarnessSemanticDecisionResumptionStore,
} from './semantic-decision-resumption.js';
import {
  authorizeHarnessAction,
  HarnessActionAuthorizationError,
} from './action-registry.js';
import { HARNESS_ACTION_CARRIERS } from './action-carriers.js';
import {
  isHarnessBillingCompensationConflictError,
  type HarnessBillingCompensationTask,
  type HarnessBillingSettlementExecutor,
  type HarnessBillingSettlementInput,
} from './billing-compensation.js';
import {
  harnessInteractionResumeSignalSchema,
  type HarnessInteractionResumeSignal,
} from './interaction-resume.js';
import {
  askMerchantInteractionRequestFromQuestion,
  executionConfirmationInteractionRequestFromQuestion,
  type HarnessInteractionStore,
  type HarnessInteractionService,
} from './interaction-service.js';
import { buildAskMerchantSemanticDefaultTimeoutPolicy } from './ask-merchant-timeout-authority.js';
import {
  HARNESS_CONFIRMATION_CARD_HOLD_TIMEOUT_CONFIG_KEY,
  HARNESS_CONFIRMATION_CARD_TIMEOUT_CONFIG_KEY,
  type AdminConfigRepository,
} from '../admin-config/foundation-module.js';
import type { TaskRecallDueInput } from '../due-delivery/task-recall-producer.js';
import type { MerchantExecutionPromotionPort } from '../product-billing/durable-service.js';

export const HARNESS_INTERACTION_CONTINUATION_LAYOUT =
  'bounded_followup_v1' as const;

export class HarnessInteractionLayoutResetRequiredError extends Error {
  readonly code = 'HARNESS_INTERACTION_LAYOUT_RESET_REQUIRED';
  readonly status = 409;

  constructor() {
    super(
      'This durable interaction layout is unsupported and requires an environment reset.',
    );
    this.name = 'HarnessInteractionLayoutResetRequiredError';
  }
}

export function assertHarnessInteractionContinuationLayout(
  projection: unknown,
) {
  if (!projection || typeof projection !== 'object') return;
  const value = projection as Record<string, unknown>;
  if (
    value.interactionRequest &&
    value.interactionContinuationLayout !==
      HARNESS_INTERACTION_CONTINUATION_LAYOUT
  ) {
    throw new HarnessInteractionLayoutResetRequiredError();
  }
}

export interface HarnessWorkflowPersistence {
  registerPending: HarnessDecisionStore['registerPending'];
  readPending: HarnessDecisionStore['readPending'];
  readPendingInteraction?: HarnessInteractionStore['readPendingInteraction'];
  recordStageTrace(input: {
    workspaceId: string;
    id: string;
    taskId: string;
    stage: string;
    payload: unknown;
  }): Promise<void>;
  recordTerminalFailure(input: {
    workspaceId: string;
    workflowId: string;
    failure: Record<string, unknown>;
  }): Promise<void>;
}

export interface HarnessRuntimeIdResolver {
  workflowRuntimeId(
    workspaceId: string,
    workflowId: string,
  ): Promise<string | null>;
  reservationReleased?(
    workspaceId: string,
    workflowId: string,
  ): Promise<boolean>;
}

type HarnessBoundedExecutionContinuationInput = Parameters<
  NonNullable<HarnessWorkflowRuntime['resumeBoundedExecution']>
>[0];

export interface HarnessBoundedExecutionContinuationResolver {
  capability(
    input: Omit<
      HarnessBoundedExecutionContinuationInput,
      'authorization' | 'command'
    > & {
      workspaceId: string;
    },
  ): Promise<BoundedExecutionContinuationCapability>;
  resolve(
    input: HarnessBoundedExecutionContinuationInput & {
      workspaceId: string;
    },
  ): Promise<{
    limit: BoundedExecutionLimitName;
    value: number;
  }>;
}

export async function resolveHarnessBoundedExecutionContinuation(
  input: HarnessBoundedExecutionContinuationInput,
  resolver: HarnessBoundedExecutionContinuationResolver,
) {
  assertBoundedExecutionContinuationAuthorization(input);
  const raise = await resolver.resolve({
    ...input,
    workspaceId: input.request.workspaceId,
  });
  return {
    ...input.request,
    boundedExecution: resumeWithRaisedServerLimit(
      input.suspension.snapshot,
      raise,
    ),
  };
}

export type HarnessDbosWorkflowInput =
  | HarnessWorkflowInput
  | { workflowId: string; request: HarnessWorkflowInput };

export interface HarnessBillingSettlementPort
  extends HarnessBillingSettlementExecutor {
  scheduleCompensation(input: HarnessBillingCompensationTask): Promise<void>;
  promoteMerchantExecution?: MerchantExecutionPromotionPort['promoteMerchantExecution'];
  completeCompensation?(
    input: HarnessBillingCompensationTask,
  ): Promise<void>;
}

export interface TaskRecallDuePort {
  produce(input: TaskRecallDueInput): Promise<unknown>;
}

export interface HarnessAskMerchantPrimitivePort {
  invoke(input: {
    idempotencyKey: string;
    question: QuestionCard;
    request: HarnessWorkflowInput;
    stage: HarnessStage;
    workspaceId: string;
  }): Promise<void>;
}

export async function invokeHarnessAskMerchantPrimitive(
  primitive: HarnessAskMerchantPrimitivePort | undefined,
  input: {
    question: QuestionCard;
    request: HarnessWorkflowInput;
    stage: HarnessStage;
    workspaceId: string;
  },
) {
  if (!primitive) return;
  await primitive.invoke({
    idempotencyKey: `harness-ask-merchant:${input.question.questionId}`,
    question: structuredClone(input.question),
    request: structuredClone(input.request),
    stage: input.stage,
    workspaceId: input.workspaceId,
  });
}

const PROGRESS_STREAM = 'progress';
export const DEFAULT_CONFIRMATION_CARD_HOLD_TIMEOUT_SECONDS = 48 * 60 * 60;
export const DEFAULT_CONFIRMATION_CARD_TIMEOUT_SECONDS = 30;

export function suspensionQuestionFailOpen(
  input: unknown,
  context: {
    workflowId: string;
    workflowRevision: number;
  },
): QuestionCard {
  const parsed = questionCardSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  return questionCardSchema.parse({
    questionId:
      `${context.workflowId}:suspension-recovery:r${context.workflowRevision}`,
    workflowId: context.workflowId,
    workflowRevision: context.workflowRevision,
    question: '任务已安全挂起，但原介入卡数据无效。请人工检查后再继续。',
    options: [
      {
        id: 'continue_after_review',
        label: '人工检查后继续',
      },
    ],
    freeText: {
      enabled: true,
      placeholder: '填写检查结论或修正说明',
    },
    response: {
      field: 'suspension_recovery',
      reason: '原挂起介入卡校验失败，需要人工确认恢复条件',
    },
    unattended: 'hold',
    scope: 'current_task',
  });
}

export async function readConfirmationCardTimeoutSeconds(
  config?: Pick<AdminConfigRepository, 'get'>,
) {
  const configured = (
    await config?.get(
      'global',
      '__global__',
      HARNESS_CONFIRMATION_CARD_TIMEOUT_CONFIG_KEY,
    )
  )?.value;
  const timeoutSeconds =
    configured === undefined
      ? DEFAULT_CONFIRMATION_CARD_TIMEOUT_SECONDS
      : configured;
  if (
    typeof timeoutSeconds !== 'number' ||
    !Number.isSafeInteger(timeoutSeconds) ||
    timeoutSeconds < 1 ||
    timeoutSeconds > 3_600
  ) {
    throw new Error(
      'Confirmation-card timeout config must be an integer from 1 to 3600.',
    );
  }
  return timeoutSeconds;
}

export async function readConfirmationCardHoldTimeoutSeconds(
  config?: Pick<AdminConfigRepository, 'get'>,
) {
  const configured = (
    await config?.get(
      'global',
      '__global__',
      HARNESS_CONFIRMATION_CARD_HOLD_TIMEOUT_CONFIG_KEY,
    )
  )?.value;
  const timeoutSeconds =
    configured === undefined
      ? DEFAULT_CONFIRMATION_CARD_HOLD_TIMEOUT_SECONDS
      : configured;
  if (
    typeof timeoutSeconds !== 'number' ||
    !Number.isSafeInteger(timeoutSeconds) ||
    timeoutSeconds < 3_600 ||
    timeoutSeconds > DEFAULT_CONFIRMATION_CARD_HOLD_TIMEOUT_SECONDS
  ) {
    throw new Error(
      'Confirmation-card hold timeout config must be an integer from 3600 to 172800.',
    );
  }
  return timeoutSeconds;
}

interface HarnessDbosWorkflowOptions {
  semanticResumptions?: HarnessSemanticDecisionResumptionStore;
  billing?: HarnessBillingSettlementPort;
  config?: Pick<AdminConfigRepository, 'get'>;
  decisions?: Pick<HarnessDecisionService, 'submitCoreTimeout'> &
    Partial<Pick<HarnessDecisionService, 'submitCoreHoldExpired'>>;
  boundedContinuations?: HarnessBoundedExecutionContinuationResolver;
  taskRecallDue?: TaskRecallDuePort;
  askMerchant?: HarnessAskMerchantPrimitivePort;
  interactions?: Pick<
    HarnessInteractionService,
    'expireUnrendered' | 'submitSystemDefault'
  >;
  /**
   * V31-12: DBOS pre-run verification against the admitted ExecutionPlanSnapshot.
   * When the request carries a snapshot, verification runs before context/rights
   * fence consumption (mismatch fail closed).
   */
  executionPlanAdmission?: Pick<
    ExecutionPlanAdmissionPort,
    'verifyAdmittedForDbos'
  >;
  /**
   * Optional live fence facts resolved just before DBOS verification.
   * Production may inject rights/context head readers here.
   */
  resolveExecutionPlanLiveFacts?: (input: {
    workflowId: string;
    request: HarnessWorkflowInput;
  }) => Promise<SnapshotLiveFacts | undefined> | SnapshotLiveFacts | undefined;
  /**
   * V31-14: ops kill switch force_legacy_five_stage — when true, Make keeps
   * legacy intent/brief LLM nodes even if a snapshot is present.
   *
   * V31-25 release SOP hook (D-038⑤): this flag is an admission-time path tag
   * for new runs only. In-flight durable instances stick to their
   * HARNESS_DBOS_APPLICATION_VERSION; do not hot-cut carrier programs mid-run.
   * See docs/ops/harness-release-sop.md §「V31-25 runner 收敛发布挂点」.
   */
  resolveForceLegacyFiveStage?: () =>
    | Promise<boolean>
    | boolean;
  /**
   * V31-13: shadow reconciliation on Make complete (sample + evidence only).
   * No daemon — triggered from this path only.
   */
  shadowReconciliation?: Pick<
    ShadowReconciliationService,
    'maybeReconcileOnExecutionComplete'
  >;
  /**
   * V31-16: dual-queue Make steering drain at terminal success (follow_up).
   * Page-unit steer drain is on note page progress; this is the all-complete hang.
   * Flag off / kill switch ⇒ port no-ops (zero behavior change).
   */
  makeSteeringBoundary?: import('./make-steering-boundary.js').MakeSteeringBoundaryPort;
}

export function registerHarnessDbosWorkflow(
  ports: HarnessStagePorts | HarnessStageCollaborators,
  persistence: HarnessWorkflowPersistence,
  options: HarnessDbosWorkflowOptions = {},
) {
  const {
    semanticResumptions,
    billing,
    config,
    decisions,
    boundedContinuations,
    taskRecallDue,
    askMerchant,
    interactions,
    executionPlanAdmission,
    resolveExecutionPlanLiveFacts,
    resolveForceLegacyFiveStage,
    shadowReconciliation,
    makeSteeringBoundary,
  } = options;
  const workflow = async (input: HarnessDbosWorkflowInput) => {
    const runtimeWorkflowId = DBOS.workflowID;
    if (!runtimeWorkflowId) {
      throw new Error('Harness workflow requires a DBOS workflow ID.');
    }
    const { request, workflowId } = normalizeHarnessDbosWorkflowInput(
      input,
      runtimeWorkflowId,
    );
    authorizeHarnessAction({
      actionId: HARNESS_ACTION_CARRIERS.replay,
      caller: 'server',
    });
    // V31-12: verification → context/rights fence. Snapshot path re-checks hash
    // against the admitted row; legacy path is independent (no dual-write).
    await DBOS.runStep(
      async () => {
        const branch = resolveDurableReplayBranch(request);
        if (branch.branch === 'legacy') {
          return { branch: 'legacy' as const };
        }
        const live = resolveExecutionPlanLiveFacts
          ? await resolveExecutionPlanLiveFacts({ workflowId, request })
          : undefined;
        // Always recompute hash on the request-carried snapshot (fail closed).
        verifyExecutionPlanSnapshotForDbos({
          snapshot: branch.snapshot,
          live,
        });
        // When the admission writer is wired, also re-verify the stored row.
        if (executionPlanAdmission) {
          await executionPlanAdmission.verifyAdmittedForDbos({
            workflowId,
            snapshotHash: branch.snapshot.snapshotHash,
            live,
          });
        }
        return {
          branch: 'execution_plan_snapshot' as const,
          snapshotHash: branch.snapshot.snapshotHash,
        };
      },
      { name: 'execution-plan-snapshot-verification' },
    );
    const runtime: HarnessWorkflowRuntime = {
      runStep(effectIdempotencyKey, operation) {
        return DBOS.runStep(operation, {
          name: effectIdempotencyKey.replaceAll(':', '-'),
        });
      },
      ...(billing?.promoteMerchantExecution
        ? {
            finalizeMerchantExecution: async (input) => {
              await billing.promoteMerchantExecution!(input);
            },
          }
        : {}),
      awaitSignal<T>(
        topic: string,
        options: { timeoutSeconds: number },
      ) {
        // DBOS.recv is an orchestration operation. It must stay outside every
        // DBOS.runStep so a pending provider job suspends the workflow.
        return DBOS.recv<T>(topic, options);
      },
      async progress(event) {
        const occurredAt = new Date(await DBOS.now()).toISOString();
        const envelope = workflowProgressEnvelopeSchema.parse({
          eventId: `${workflowId}:progress:${event.sequence}`,
          workflowId,
          workflowType: 'beauty_marketing_harness',
          sourceRevision: request.workflowRevision,
          ...event,
          occurredAt,
        });
        await DBOS.writeStream(PROGRESS_STREAM, envelope);
      },
      async token(event) {
        const occurredAt = new Date(await DBOS.now()).toISOString();
        const envelope = workflowTokenEnvelopeSchema.parse({
          eventId: `${workflowId}:token:${event.sequence}`,
          workflowId,
          sourceRevision: request.workflowRevision,
          ...event,
          occurredAt,
        });
        await DBOS.writeStream(PROGRESS_STREAM, envelope);
      },
      async hasRegisteredPendingQuestion(question) {
        // Keep this read outside DBOS.runStep: recovered registered workflows
        // must not gain a function ID before their original suspend/recv sequence.
        const pending = await persistence.readPending(
          request.workspaceId,
          workflowId,
          { includeResolved: true },
        );
        return (
          pending?.questionId === question.questionId &&
          pending.workflowRevision === question.workflowRevision
        );
      },
      async awaitDecision(question, stage) {
        question = suspensionQuestionFailOpen(question, {
          workflowId,
          workflowRevision: request.workflowRevision,
        });
        const pendingProjection = await DBOS.runStep(
          async () => {
            const hasSemanticDefaultAuthority =
              question.unattended === 'continue' &&
              question.semanticDefaultAuthority?.kind ===
                'non_resource_no_effect';
            const timeoutSeconds = hasSemanticDefaultAuthority
              ? await readConfirmationCardTimeoutSeconds(config)
              : null;
            const holdTimeoutSeconds =
              request.usageReservation &&
              question.unattended !== 'continue' &&
              !question.executionConfirmationAuthority
                ? await readConfirmationCardHoldTimeoutSeconds(config)
                : null;
            const executionInteractionRequest =
              executionConfirmationInteractionRequestFromQuestion({
                question,
                request,
              });
            if (!executionInteractionRequest) {
              await invokeHarnessAskMerchantPrimitive(askMerchant, {
                question,
                request,
                stage,
                workspaceId: request.workspaceId,
              });
            }
            const interactionRequest =
              executionInteractionRequest ??
              askMerchantInteractionRequestFromQuestion({
                question,
                stage,
                timeoutPolicy: buildAskMerchantSemanticDefaultTimeoutPolicy(
                    question,
                    timeoutSeconds,
                  ),
              });
            const registered = await persistence.registerPending(
              request.workspaceId,
              question,
              { interactionRequest, timeoutSeconds },
            );
            return {
              ...(registered ?? { timeoutSeconds }),
              holdTimeoutSeconds,
              ...(interactionRequest
                ? {
                    interactionContinuationLayout:
                      HARNESS_INTERACTION_CONTINUATION_LAYOUT,
                  }
                : {}),
            };
          },
          { name: `persist-pending-${question.questionId}` },
        );
        assertHarnessInteractionContinuationLayout(pendingProjection);
        await DBOS.setEvent('pending-structured-decision', question);
        if (question.unattended !== 'continue') {
          const holdTimeoutSeconds = pendingProjection?.holdTimeoutSeconds;
          if (holdTimeoutSeconds == null) {
            // Workflows suspended before C1 retain their original unbounded hold
            // layout. Branching into the new bounded layout would reuse a
            // historical recv function ID for a differently named runStep.
            {
              const resolved = await waitForDecisionWithoutTimeout(
                question,
                persistence,
                request.workspaceId,
              );
              if ('cancelled' in resolved) return resolved;
              return {
                command: resolved,
                resolutionSource: 'decision' as const,
              };
            }
          }
          const decision = await waitForHeldDecision(
            question,
            holdTimeoutSeconds,
            persistence,
            request.workspaceId,
          );
          if (decision) {
            if ('cancelled' in decision) return decision;
            return {
              command: decision,
              resolutionSource: 'decision' as const,
            };
          }
          const submitCoreHoldExpired =
            decisions?.submitCoreHoldExpired?.bind(decisions);
          if (!submitCoreHoldExpired) {
            throw new Error('Held decision expiry persistence is unavailable.');
          }
          const command = confirmationCardHoldExpired(question);
          const persisted = await DBOS.runStep(
            () =>
              submitCoreHoldExpired(
                request.workspaceId,
                workflowId,
                command,
              ),
            {
              name: `persist-core-hold-expired-${question.questionId}`,
            },
          );
          if ('consumedByOther' in persisted && persisted.consumedByOther) {
            {
              const resolved = await waitForDecisionWithoutTimeout(
                question,
                persistence,
                request.workspaceId,
              );
              if ('cancelled' in resolved) return resolved;
              return {
                command: resolved,
                resolutionSource: 'decision' as const,
              };
            }
          }
          return {
            cancelled: true as const,
            merchantMessage: '超时未选择，本次任务已取消，积分已退回',
            resolutionSource: 'core_hold_expired' as const,
          };
        }
        if (
          pendingProjection?.timeoutSeconds === null ||
          (!pendingProjection && !request.usageReservation)
        ) {
          {
            const resolved = await waitForDecisionWithoutTimeout(
              question,
              persistence,
              request.workspaceId,
            );
            if ('cancelled' in resolved) return resolved;
            return {
              command: resolved,
              resolutionSource: 'decision' as const,
            };
          }
        }
        // Pre-projection workflow records return no value from function ID 4.
        // They use the deterministic default instead of a live config read.
        const timeoutSeconds =
          pendingProjection?.timeoutSeconds ??
          DEFAULT_CONFIRMATION_CARD_TIMEOUT_SECONDS;
        const decision = await DBOS.recv<unknown>(
          decisionTopic(question.questionId),
          { timeoutSeconds },
        );
        if (isReleasedReservationCancellation(decision)) {
          return decision;
        }
        const command = confirmationCardDecision(
          question,
          decision,
          await currentDurableInteractionRevision(
            question,
            decision,
            persistence,
            request.workspaceId,
          ),
        );
        if (!decision) {
          if (pendingProjection?.interactionRequest) {
            const interactionRequest = pendingProjection.interactionRequest;
            if (!interactions) {
              throw new Error(
                'Typed interaction system-default persistence is unavailable.',
              );
            }
            const systemDefault = await DBOS.runStep(
              () =>
                interactions.submitSystemDefault(
                  request.workspaceId,
                  workflowId,
                ),
              {
                name: `persist-system-default-${question.questionId}`,
              },
            );
            let refreshIdentity = false;
            if (
              systemDefault.kind === 'held' &&
              systemDefault.reason === 'renderer'
            ) {
              const expiry = await DBOS.runStep(
                () =>
                  interactions.expireUnrendered(
                    request.workspaceId,
                    workflowId,
                    {
                      requestId: interactionRequest.requestId,
                      revision: interactionRequest.revision,
                      step: interactionRequest.step,
                    },
                  ),
                {
                  name: `persist-renderer-unavailable-${question.questionId}`,
                },
              );
              if (expiry === 'expired' || expiry === 'replayed') {
                return {
                  cancelled: true as const,
                  merchantMessage: request.usageReservation
                    ? '超时未选择，本次任务已取消，积分已退回'
                    : '超时未选择，本次任务已取消',
                  resolutionSource: 'core_hold_expired' as const,
                };
              }
              refreshIdentity = expiry === 'stale';
            }
            const followup = await waitForTypedInteractionAfterTimeout({
              identity: {
                requestId: interactionRequest.requestId,
                revision: interactionRequest.revision,
                step: interactionRequest.step,
              },
              interactions,
              persistence,
              question,
              refreshIdentity,
              timeoutSeconds,
              workspaceId: request.workspaceId,
            });
            if (followup === 'expired') {
              return {
                cancelled: true as const,
                merchantMessage: request.usageReservation
                  ? '超时未选择，本次任务已取消，积分已退回'
                  : '超时未选择，本次任务已取消',
                resolutionSource: 'core_hold_expired' as const,
              };
            }
            return followup;
          }
          if (!decisions) {
            throw new Error('Core timeout decision persistence is unavailable.');
          }
          const persisted = await DBOS.runStep(
            () =>
              decisions.submitCoreTimeout(
                request.workspaceId,
                workflowId,
                command,
              ),
            {
              name: `persist-core-timeout-${question.questionId}`,
            },
          );
          if ('consumedByOther' in persisted && persisted.consumedByOther) {
            {
              const resolved = await waitForDecisionWithoutTimeout(
                question,
                persistence,
                request.workspaceId,
              );
              if ('cancelled' in resolved) return resolved;
              return {
                command: resolved,
                resolutionSource: 'decision' as const,
              };
            }
          }
          return {
            command,
            resolutionSource: 'core_timeout' as const,
          };
        }
        return {
          command,
          resolutionSource: 'decision' as const,
        };
      },
      ...(semanticResumptions
        ? {
            async resubmitSemanticDecision(input) {
              const createdAt = new Date(await DBOS.now()).toISOString();
              return DBOS.runStep(
                async () => {
                  const resumption = buildSemanticDecisionResumption({
                    request: input.request,
                    command: input.command,
                    createdAt,
                  });
                  await semanticResumptions.claimSemanticDecisionResumption({
                    sourceSnapshotId: input.request.executionSnapshot.id,
                    workspaceId: input.request.workspaceId,
                    idempotencyKey: resumption.idempotencyKey,
                    payloadHash: resumption.payloadHash,
                    submission: resumption.submission,
                  });
                  return resumption.request;
                },
                {
                  name: `persist-semantic-resubmission-${input.command.idempotencyKey}`,
                },
              );
            },
          }
        : {}),
      ...(boundedContinuations
        ? {
            inspectBoundedExecutionContinuation(input) {
              return DBOS.runStep(
                () =>
                  boundedContinuations.capability({
                    ...input,
                    workspaceId: input.request.workspaceId,
                  }),
                {
                  name:
                    'inspect-bounded-continuation-' +
                    input.suspension.snapshot.triggeredLimit,
                },
              );
            },
            resumeBoundedExecution(input) {
              return DBOS.runStep(
                () =>
                  resolveHarnessBoundedExecutionContinuation(
                    input,
                    boundedContinuations,
                  ),
                {
                  name:
                    'resolve-bounded-continuation-' +
                    input.command.idempotencyKey.replaceAll(':', '-'),
                },
              );
            },
          }
        : {}),
      recordTrace(input, afterPersist) {
        return DBOS.runStep(
          async () => {
            await persistence.recordStageTrace({
              ...input,
              workspaceId: request.workspaceId,
            });
            await afterPersist?.();
          },
          { name: `persist-${input.stage}-trace` },
        );
      },
    };
    let closeProgressStream = true;
    try {
      let result;
      try {
        const forceLegacyFiveStage = resolveForceLegacyFiveStage
          ? await resolveForceLegacyFiveStage()
          : false;
        result = await runHarnessWorkflow(
          workflowId,
          request,
          ports,
          runtime,
          { forceLegacyFiveStage },
        );
      } catch (error) {
        if (error instanceof HarnessInteractionLayoutResetRequiredError) {
          closeProgressStream = false;
          throw error;
        }
        if (error instanceof HarnessWorkflowCancellation) {
          return settleHarnessCancellation({
            billing,
            cancellation: error,
            request,
            runStep: dbosBillingStep,
            workflowId,
          });
        }
        const settlement = harnessBillingSettlementInput(
          request,
          workflowId,
          undefined,
          true,
        );
        // Whether the reserved 积分 came back is part of what the merchant is
        // told (D-096 申报). It is known here and nowhere downstream, so it
        // travels with the persisted failure — and it is the refund's own
        // result, never the mere fact that a refund was attempted: a scheduled
        // compensation has not given anything back yet.
        if (billing && settlement) {
          await failHarnessWorkflowPreservingExecutionError({
            billing,
            input: settlement,
            error,
            runStep: dbosBillingStep,
            recordTerminalFailure: (quotaRefunded) =>
              persistence.recordTerminalFailure({
                workspaceId: request.workspaceId,
                workflowId,
                failure: {
                  ...normalizeHarnessTerminalFailure(error),
                  quotaRefunded,
                },
              }),
          });
        }
        // Reached only when there was no reservation to settle, so there is
        // nothing to give back either.
        await DBOS.runStep(
          () =>
            persistence.recordTerminalFailure({
              workspaceId: request.workspaceId,
              workflowId,
              failure: {
                ...normalizeHarnessTerminalFailure(error),
                quotaRefunded: false,
              },
            }),
          { name: 'persist-terminal-failure' },
        );
        throw error;
      }
      const settlement = harnessBillingSettlementInput(
        request,
        workflowId,
        result,
      );
      const completedAt = taskRecallDue
        ? new Date(await DBOS.now()).toISOString()
        : undefined;
      // V31-13: sample shadow reconcile on successful Make complete (no daemon).
      // Failures inside the service are swallowed; this step must not fail the run.
      if (shadowReconciliation && request.executionPlanSnapshot) {
        await DBOS.runStep(
          async () => {
            const snapshot = request.executionPlanSnapshot!;
            const decisionFactRefs = request.decisionReferences?.map(
              (ref) => ref.id,
            );
            const oldChain = projectLegacyFromMakeRequest({
              snapshot,
              boundedExecution: request.boundedExecution,
              observedDeliverables: request.executionSnapshot?.deliverables?.map(
                (item) => ({
                  kind: item.kind,
                  quantity: item.quantity,
                }),
              ),
              // Only pass when the request independently carries fact refs.
              observedFactRefs:
                decisionFactRefs && decisionFactRefs.length > 0
                  ? decisionFactRefs
                  : undefined,
            });
            if (!oldChain) return { sampled: false as const };
            const now = new Date(await DBOS.now()).toISOString();
            return shadowReconciliation.maybeReconcileOnExecutionComplete({
              workflowId,
              workspaceId: request.workspaceId,
              snapshot,
              oldChain,
              now,
              operatorId: 'system',
              correlationId: workflowId,
            });
          },
          { name: 'shadow-reconciliation-sample' },
        );
      }
      await settleHarnessTerminalSuccess({
        billing,
        completedAt,
        request,
        runStep: dbosBillingStep,
        settlement,
        taskRecallDue,
        workflowId,
        // V31-16: follow_up queue drains when the whole Make run is terminal.
        makeSteeringBoundary,
      });
      return result;
    } finally {
      if (closeProgressStream) {
        await DBOS.closeStream(PROGRESS_STREAM);
      }
    }
  };
  return DBOS.registerWorkflow(workflow, {
    name: 'beautyMarketingHarnessWorkflow',
  });
}

type BillingRunStep = <T>(
  name: string,
  operation: () => Promise<T>,
) => Promise<T>;

export async function settleHarnessTerminalSuccess(input: {
  billing?: HarnessBillingSettlementPort;
  completedAt?: string;
  request: HarnessWorkflowInput;
  runStep: BillingRunStep;
  settlement: HarnessBillingSettlementInput | null;
  taskRecallDue?: TaskRecallDuePort;
  workflowId: string;
  /**
   * V31-16: all-units-terminal drain for follow_up (and any remaining steer).
   * Gated inside the port — disabled flag/kill switch = zero work.
   */
  makeSteeringBoundary?: import('./make-steering-boundary.js').MakeSteeringBoundaryPort;
}) {
  if (input.billing && input.settlement) {
    await commitHarnessBillingOrSchedule({
      billing: input.billing,
      input: input.settlement,
      runStep: input.runStep,
    });
  }
  if (input.taskRecallDue) {
    if (!input.completedAt) {
      throw new Error('Task recall due requires a terminal completion time.');
    }
    const taskRecallDue = input.taskRecallDue;
    const completedAt = input.completedAt;
    await input.runStep('enqueue-task-recall', () =>
      taskRecallDue.produce({
        completedAt,
        sourceTaskId: input.workflowId,
        workspaceId: input.request.workspaceId,
      }),
    );
  }
  // V31-16: dual-queue follow_up inserts only after all units complete.
  if (input.makeSteeringBoundary) {
    await input.runStep('make-steering-all-units-terminal', () =>
      input.makeSteeringBoundary!.onUnitBoundary({
        workspaceId: input.request.workspaceId,
        taskId: input.workflowId,
        cursor: {
          justCompletedUnitId: null,
          remainingUnitIds: [],
          allUnitsTerminal: true,
        },
      }).then(() => undefined),
    );
  }
}

export async function commitHarnessBillingOrSchedule(input: {
  billing: HarnessBillingSettlementPort;
  input: HarnessBillingSettlementInput;
  runStep: BillingRunStep;
}) {
  const task: HarnessBillingCompensationTask = {
    action: 'commit',
    attempts: 0,
    ...input.input,
  };
  try {
    await input.runStep('commit-product-usage', async () => {
      let scheduled = false;
      try {
        await input.billing.scheduleCompensation(task);
        scheduled = true;
      } catch (error) {
        if (isHarnessBillingCompensationConflictError(error)) {
          throw error;
        }
        // Direct settlement can still close the reservation.
      }
      try {
        await input.billing.commit(input.input);
        if (scheduled) {
          try {
            await input.billing.completeCompensation?.(task);
          } catch {
            // The idempotent worker can observe the already-settled usage.
          }
        }
      } catch (error) {
        if (!scheduled) throw error;
      }
    });
  } catch (error) {
    if (isHarnessBillingCompensationConflictError(error)) {
      throw error;
    }
    await input.runStep('schedule-product-usage-commit', () =>
      input.billing.scheduleCompensation(task),
    );
  }
}

/**
 * What actually happened to the reservation. `scheduled` and `unavailable` both
 * mean the 积分 is not back yet — the merchant must not be told it is.
 */
export type HarnessRefundOutcome = 'refunded' | 'scheduled' | 'unavailable';

export async function refundHarnessBillingPreservingFailure(input: {
  billing: HarnessBillingSettlementPort;
  input: HarnessBillingSettlementInput;
  runStep: BillingRunStep;
}): Promise<HarnessRefundOutcome> {
  const task: HarnessBillingCompensationTask = {
    action: 'refund',
    attempts: 0,
    ...input.input,
  };
  try {
    return await input.runStep('refund-product-usage', async () => {
      let scheduled = false;
      try {
        await input.billing.scheduleCompensation(task);
        scheduled = true;
      } catch (error) {
        if (isHarnessBillingCompensationConflictError(error)) {
          throw error;
        }
        // Direct settlement can still close the reservation.
      }
      try {
        await input.billing.refund(input.input);
        if (scheduled) {
          try {
            await input.billing.completeCompensation?.(task);
          } catch {
            // The idempotent worker can observe the already-refunded usage.
          }
        }
        return 'refunded';
      } catch (error) {
        if (scheduled) return 'scheduled';
        throw error;
      }
    });
  } catch (error) {
    if (isHarnessBillingCompensationConflictError(error)) {
      throw error;
    }
    try {
      await input.runStep('schedule-product-usage-refund', () =>
        input.billing.scheduleCompensation(task),
      );
      return 'scheduled';
    } catch (scheduleError) {
      if (isHarnessBillingCompensationConflictError(scheduleError)) {
        throw scheduleError;
      }
      // Terminal failure persistence and the original execution error take
      // precedence when the compensation store is also unavailable.
      return 'unavailable';
    }
  }
}

export async function settleHarnessCancellation(input: {
  billing?: HarnessBillingSettlementPort;
  cancellation: HarnessWorkflowCancellation;
  request: HarnessWorkflowInput;
  runStep: BillingRunStep;
  workflowId: string;
}) {
  const settlement = harnessBillingSettlementInput(
    input.request,
    input.workflowId,
    undefined,
    true,
  );
  if (input.request.usageReservation && (!input.billing || !settlement)) {
    throw new Error(
      'Harness cancellation requires its reserved billing input.',
    );
  }
  if (input.billing && settlement) {
    const outcome = await refundHarnessBillingPreservingFailure({
      billing: input.billing,
      input: settlement,
      runStep: input.runStep,
    });
    if (outcome !== 'refunded') {
      return {
        ...input.cancellation.result,
        merchantMessage:
          input.cancellation.result.resolutionSource === 'decision'
            ? '本次任务已结束，积分退款处理中'
            : '超时未选择，本次任务已取消，积分退款处理中',
      };
    }
  }
  return input.cancellation.result;
}

export async function failHarnessWorkflowPreservingExecutionError(input: {
  billing: HarnessBillingSettlementPort;
  input: HarnessBillingSettlementInput;
  error: unknown;
  runStep: BillingRunStep;
  /**
   * Told whether the reservation is genuinely back, not whether a refund was
   * attempted — the 申报卡 quotes this to the merchant.
   */
  recordTerminalFailure: (quotaRefunded: boolean) => Promise<void>;
}): Promise<never> {
  const outcome = await refundHarnessBillingPreservingFailure(input);
  await input.runStep('persist-terminal-failure', () =>
    input.recordTerminalFailure(outcome === 'refunded'),
  );
  throw input.error;
}

export function harnessBillingSettlementInput(
  request: HarnessWorkflowInput,
  workflowId: string,
  result?: unknown,
  forceCreditRefund = false,
): HarnessBillingSettlementInput | null {
  const snapshot = request.executionSnapshot;
  if (!snapshot) return null;
  const trustedUsage = billingTrustedUsage(result);
  return {
    workspaceId: request.workspaceId,
    taskId: workflowId,
    quoteId: snapshot.quote.id,
    quoteRevision: snapshot.quote.revision,
    ...(trustedUsage ? { trustedUsage } : {}),
    ...(forceCreditRefund ? { forceCreditRefund: true } : {}),
  };
}

function billingTrustedUsage(
  result: unknown,
): HarnessBillingSettlementInput['trustedUsage'] {
  if (!result || typeof result !== 'object' || !('billingReceipt' in result)) {
    return undefined;
  }
  const receipt = result.billingReceipt;
  if (
    !receipt ||
    typeof receipt !== 'object' ||
    !('trustedUsage' in receipt) ||
    !receipt.trustedUsage ||
    typeof receipt.trustedUsage !== 'object'
  ) {
    return undefined;
  }
  const usage = receipt.trustedUsage;
  if ('kind' in usage && usage.kind === 'product_units') {
    const units = productUsageUnits(
      'units' in usage ? usage.units : undefined,
    );
    if (!units) return undefined;
    return {
      kind: 'product_units',
      units,
      ...('evidenceRef' in usage && typeof usage.evidenceRef === 'string'
        ? { evidenceRef: usage.evidenceRef }
        : {}),
    };
  }
  if (
    !('kind' in usage) ||
    usage.kind !== 'media_duration' ||
    !('actualSeconds' in usage) ||
    typeof usage.actualSeconds !== 'number' ||
    !Number.isFinite(usage.actualSeconds) ||
    usage.actualSeconds <= 0
  ) {
    return undefined;
  }
  return {
    kind: 'media_duration',
    actualSeconds: usage.actualSeconds,
    ...('evidenceRef' in usage && typeof usage.evidenceRef === 'string'
      ? { evidenceRef: usage.evidenceRef }
      : {}),
  };
}

function productUsageUnits(value: unknown): ProductUsageUnit[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const resources = new Set<ProductUsageUnit['resource']>();
  const units: ProductUsageUnit[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const candidate = entry as { quantity?: unknown; resource?: unknown };
    if (
      !['copy', 'image', 'video'].includes(candidate.resource as string) ||
      !Number.isSafeInteger(candidate.quantity) ||
      (candidate.quantity as number) < 1
    ) {
      return null;
    }
    const resource = candidate.resource as ProductUsageUnit['resource'];
    if (resources.has(resource)) return null;
    resources.add(resource);
    units.push({ resource, quantity: candidate.quantity as number });
  }
  return units;
}

function dbosBillingStep<T>(name: string, operation: () => Promise<T>) {
  return DBOS.runStep(operation, { name });
}

export class DbosHarnessWorkflowStarter implements HarnessWorkflowStarter {
  constructor(
    private readonly workflow: ReturnType<typeof registerHarnessDbosWorkflow>,
  ) {}

  async start(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    runtimeId?: string;
  }) {
    authorizeHarnessAction({
      actionId: HARNESS_ACTION_CARRIERS.start,
      caller: 'server',
    });
    const handle = await DBOS.startWorkflow(this.workflow, {
      workflowID:
        input.runtimeId ??
        harnessRuntimeId(input.request.workspaceId, input.workflowId),
    })({ workflowId: input.workflowId, request: input.request });
    void handle;
    return { workflowId: input.workflowId };
  }
}

export async function resumeHarnessDbosWorkflow(
  workspaceId: string,
  workflowId: string,
  command: unknown,
  resolver?: HarnessRuntimeIdResolver,
) {
  if (await resolver?.reservationReleased?.(workspaceId, workflowId)) {
    throw new Error(
      'Harness workflow cannot resume after its reservation was released.',
    );
  }
  const parsedCommand = structuredDecisionInputSchema.parse(command);
  const runtimeWorkflowId =
    (await resolver?.workflowRuntimeId(workspaceId, workflowId)) ??
    harnessRuntimeId(workspaceId, workflowId);
  await DBOS.send(
    runtimeWorkflowId,
    parsedCommand,
    decisionTopic(parsedCommand.questionId),
    `harness-decision:${workspaceId}:${runtimeWorkflowId}:${parsedCommand.idempotencyKey}`,
  );
}

export async function resumeHarnessDbosInteractionWorkflow(
  workspaceId: string,
  workflowId: string,
  signal: unknown,
  resolver?: HarnessRuntimeIdResolver,
) {
  if (await resolver?.reservationReleased?.(workspaceId, workflowId)) {
    throw new Error(
      'Harness workflow cannot resume after its reservation was released.',
    );
  }
  const parsedSignal = harnessInteractionResumeSignalSchema.parse(signal);
  if (parsedSignal.runId !== workflowId) {
    throw new Error(
      'Interaction resume signal does not match its target workflow.',
    );
  }
  const runtimeWorkflowId =
    (await resolver?.workflowRuntimeId(workspaceId, workflowId)) ??
    harnessRuntimeId(workspaceId, workflowId);
  await DBOS.send(
    runtimeWorkflowId,
    parsedSignal,
    decisionTopic(parsedSignal.requestId),
    `harness-interaction:${workspaceId}:${runtimeWorkflowId}:${parsedSignal.idempotencyKey}`,
  );
}

export async function abandonReleasedHarnessReservation(
  workspaceId: string,
  workflowId: string,
  questionId: string,
  resolver?: HarnessRuntimeIdResolver,
) {
  const runtimeWorkflowId =
    (await resolver?.workflowRuntimeId(workspaceId, workflowId)) ??
    harnessRuntimeId(workspaceId, workflowId);
  await DBOS.send(
    runtimeWorkflowId,
    {
      cancelled: true as const,
      merchantMessage:
        '之前占用的积分已经放回。已按你刚才的回答重新排队，不会重复占用。',
      resolutionSource: 'reservation_released' as const,
    },
    decisionTopic(questionId),
    `reservation-released:${workspaceId}:${workflowId}:${questionId}`,
  );
}

export type HarnessMediaJobTerminalNotification = {
  workspaceId: string;
  jobId: string;
  kind: string;
  payload: Record<string, unknown>;
  status: 'completed' | 'failed';
  output?: Record<string, unknown>;
};

/**
 * pg-boss remains the execution transport. This is its production binding
 * back into the DBOS workflow message channel after a terminal job outcome.
 */
export async function sendHarnessMediaJobTerminal(
  input: HarnessMediaJobTerminalNotification,
) {
  if (input.kind !== 'model.media-generation') return false;
  const payload = input.payload.submission;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  const orchestrationWorkflowId = (payload as { correlationId?: unknown })
    .correlationId;
  if (typeof orchestrationWorkflowId !== 'string' || !orchestrationWorkflowId) {
    return false;
  }
  const targetWorkspaceId = (payload as { workspaceId?: unknown }).workspaceId;
  if (typeof targetWorkspaceId !== 'string' || !targetWorkspaceId) {
    return false;
  }
  if (targetWorkspaceId !== input.workspaceId) {
    throw new HarnessActionAuthorizationError(
      'The durable media job does not belong to the signaling workspace.',
    );
  }
  authorizeHarnessAction({
    actionId: HARNESS_ACTION_CARRIERS.mediaSignal,
    caller: 'worker',
  });
  const destination = harnessRuntimeId(
    input.workspaceId,
    orchestrationWorkflowId,
  );
  const message = {
    jobId: input.jobId,
    status: input.status,
    ...(input.output ? { output: input.output } : {}),
  };
  await DBOS.send(
    destination,
    message,
    harnessMediaJobTopic(input.jobId),
    `harness-media-terminal:${input.workspaceId}:${input.jobId}:${input.status}`,
  );
  return true;
}

export function normalizeHarnessDbosWorkflowInput(
  input: HarnessDbosWorkflowInput,
  runtimeWorkflowId: string,
) {
  return 'request' in input
    ? input
    : { workflowId: runtimeWorkflowId, request: input };
}

export function confirmationCardDecision(
  question: QuestionCard,
  decision: unknown,
  currentInteractionRevision = question.workflowRevision,
) {
  if (!decision) {
    return structuredDecisionInputSchema.parse({
      idempotencyKey: `${question.questionId}:r${question.workflowRevision}:core_timeout`,
      questionId: question.questionId,
      workflowRevision: question.workflowRevision,
      patch: {
        field: question.response.field,
        value: '超时未作答，已按通用口径继续',
        reason: question.response.reason,
      },
      decision: {
        state: 'ignored',
        value: '超时未作答，已按通用口径继续',
      },
    });
  }
  const interaction = harnessInteractionResumeSignalSchema.safeParse(decision);
  if (interaction.success) {
    return interactionConfirmationCardDecision(
      question,
      interaction.data,
      currentInteractionRevision,
    );
  }
  const parsed = structuredDecisionInputSchema.parse(decision);
  if (parsed.questionId !== question.questionId) {
    throw new Error('Structured decision does not match the pending question.');
  }
  if (parsed.workflowRevision !== question.workflowRevision) {
    throw new Error('Structured decision targets a stale workflow revision.');
  }
  return parsed;
}

function interactionConfirmationCardDecision(
  question: QuestionCard,
  signal: HarnessInteractionResumeSignal,
  currentInteractionRevision: number,
) {
  if (
    signal.requestId !== question.questionId ||
    signal.revision !== currentInteractionRevision ||
    signal.runId !== question.workflowId
  ) {
    throw new Error(
      'Interaction resume signal does not match the pending question.',
    );
  }
  const answer = harnessInteractionAnswerSchema.parse({
    requestId: signal.requestId,
    revision: signal.revision,
    idempotencyKey: signal.idempotencyKey,
    resume: {
      runId: signal.runId,
      step: signal.step,
    },
    response: signal.resumeData,
  });
  let state: StructuredDecisionInput['decision']['state'];
  let value: string;
  if (
    answer.response.kind === 'answer' ||
    answer.response.kind === 'skipped'
  ) {
    if (answer.response.kind === 'skipped') {
      state = 'ignored';
      value = '暂未确定';
    } else {
      if (answer.response.items.length !== 1) {
        throw new Error(
          'Grouped merchant answers require a grouped workflow consumer.',
        );
      }
      const item =
        answer.response.items.find(
          (candidate) => candidate.itemId === question.response.field,
        ) ??
        (answer.response.items.length === 1
          ? answer.response.items[0]
          : undefined);
      if (!item) {
        throw new Error(
          'Interaction answer does not identify the pending question field.',
        );
      }
      state = item.result.kind === 'answer' ? 'accepted' : 'ignored';
      value =
        item.result.kind === 'answer' ? item.result.value : '暂未确定';
    }
  } else if (answer.response.kind === 'approved') {
    state = 'accepted';
    value = 'approved';
  } else if (answer.response.feedback) {
    state = 'accepted';
    value = answer.response.feedback;
  } else {
    throw new Error(
      'A rejection without feedback must remain waiting for the merchant.',
    );
  }
  return structuredDecisionInputSchema.parse({
    idempotencyKey: signal.idempotencyKey,
    questionId: question.questionId,
    workflowRevision: question.workflowRevision,
    patch: {
      field: question.response.field,
      value,
      reason: question.response.reason,
    },
    decision: {
      state,
      value,
    },
  });
}

export function confirmationCardHoldExpired(question: QuestionCard) {
  return structuredDecisionInputSchema.parse({
    idempotencyKey: `${question.questionId}:r${question.workflowRevision}:core_hold_expired`,
    questionId: question.questionId,
    workflowRevision: question.workflowRevision,
    patch: {
      field: question.response.field,
      value: '超时未选择，本次任务已取消，积分已退回',
      reason: question.response.reason,
    },
    decision: {
      state: 'ignored',
      value: '超时未选择，本次任务已取消，积分已退回',
    },
  });
}

async function waitForHeldDecision(
  question: QuestionCard,
  timeoutSeconds: number,
  persistence: HarnessWorkflowPersistence,
  workspaceId: string,
) {
  const decision = await DBOS.recv<unknown>(
    decisionTopic(question.questionId),
    { timeoutSeconds },
  );
  if (isReleasedReservationCancellation(decision)) return decision;
  return decision
    ? confirmationCardDecision(
        question,
        decision,
        await currentDurableInteractionRevision(
          question,
          decision,
          persistence,
          workspaceId,
        ),
      )
    : null;
}


function isReleasedReservationCancellation(
  value: unknown,
): value is {
  cancelled: true;
  merchantMessage: string;
  resolutionSource: 'reservation_released';
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as {
    cancelled?: unknown;
    merchantMessage?: unknown;
    resolutionSource?: unknown;
  };
  return (
    candidate.cancelled === true &&
    typeof candidate.merchantMessage === 'string' &&
    candidate.resolutionSource === 'reservation_released'
  );
}

async function waitForDecisionWithoutTimeout(
  question: QuestionCard,
  persistence: HarnessWorkflowPersistence,
  workspaceId: string,
) {
  for (;;) {
    const decision = await DBOS.recv<unknown>(
      decisionTopic(question.questionId),
    );
    if (!decision) continue;
    if (isReleasedReservationCancellation(decision)) return decision;
    return confirmationCardDecision(
      question,
      decision,
      await currentDurableInteractionRevision(
        question,
        decision,
        persistence,
        workspaceId,
      ),
    );
  }
}

async function waitForDecisionWithResolutionSource(
  question: QuestionCard,
  persistence: HarnessWorkflowPersistence,
  workspaceId: string,
) {
  for (;;) {
    const decision = await DBOS.recv<unknown>(
      decisionTopic(question.questionId),
    );
    if (!decision) continue;
    const interaction = harnessInteractionResumeSignalSchema.safeParse(decision);
    return {
      command: confirmationCardDecision(
        question,
        decision,
        await currentDurableInteractionRevision(
          question,
          decision,
          persistence,
          workspaceId,
        ),
      ),
      resolutionSource: interaction.success
        ? interaction.data.resolutionSource
        : ('decision' as const),
    };
  }
}

type HarnessInteractionIdentity = Pick<
  HarnessInteractionRequest,
  'requestId' | 'revision' | 'step'
>;

async function waitForTypedInteractionAfterTimeout(input: {
  identity: HarnessInteractionIdentity;
  interactions: Pick<
    HarnessInteractionService,
    'expireUnrendered' | 'submitSystemDefault'
  >;
  persistence: HarnessWorkflowPersistence;
  question: QuestionCard;
  refreshIdentity: boolean;
  timeoutSeconds: number;
  workspaceId: string;
}) {
  let identity = input.refreshIdentity
    ? await readReaskedInteractionIdentity(
        input.persistence,
        input.workspaceId,
        input.question,
        input.identity,
      )
    : input.identity;
  for (;;) {
    const decision = await DBOS.recv<unknown>(
      decisionTopic(input.question.questionId),
      { timeoutSeconds: input.timeoutSeconds },
    );
    if (decision) {
      const interaction =
        harnessInteractionResumeSignalSchema.safeParse(decision);
      return {
        command: confirmationCardDecision(
          input.question,
          decision,
          await currentDurableInteractionRevision(
            input.question,
            decision,
            input.persistence,
            input.workspaceId,
          ),
        ),
        resolutionSource: interaction.success
          ? interaction.data.resolutionSource
          : ('decision' as const),
      };
    }
    const systemDefault = await DBOS.runStep(
      () =>
        input.interactions.submitSystemDefault(
          input.workspaceId,
          input.question.workflowId,
        ),
      {
        name: `persist-system-default-${input.question.questionId}-r${identity.revision}`,
      },
    );
    if (
      systemDefault.kind !== 'held' ||
      systemDefault.reason !== 'renderer'
    ) {
      continue;
    }
    const expiry = await DBOS.runStep(
      () =>
        input.interactions.expireUnrendered(
          input.workspaceId,
          input.question.workflowId,
          identity,
        ),
      {
        name: `persist-renderer-unavailable-${input.question.questionId}-r${identity.revision}`,
      },
    );
    if (expiry === 'expired' || expiry === 'replayed') {
      return 'expired' as const;
    }
    if (expiry === 'stale') {
      identity = await readReaskedInteractionIdentity(
        input.persistence,
        input.workspaceId,
        input.question,
        identity,
      );
    }
  }
}

async function readReaskedInteractionIdentity(
  persistence: HarnessWorkflowPersistence,
  workspaceId: string,
  question: QuestionCard,
  staleIdentity: HarnessInteractionIdentity,
) {
  if (!persistence.readPendingInteraction) {
    throw new Error('Typed interaction replay state is unavailable.');
  }
  const current = await DBOS.runStep(
    () =>
      persistence.readPendingInteraction!(
        workspaceId,
        question.workflowId,
        { includeResolved: true },
      ),
    {
      name: `read-reasked-interaction-${question.questionId}-after-r${staleIdentity.revision}`,
    },
  );
  if (
    !current ||
    current.requestId !== staleIdentity.requestId ||
    current.revision <= staleIdentity.revision ||
    current.step !== staleIdentity.step
  ) {
    throw new Error('Current reasked interaction identity is unavailable.');
  }
  return {
    requestId: current.requestId,
    revision: current.revision,
    step: current.step,
  };
}

async function currentDurableInteractionRevision(
  question: QuestionCard,
  decision: unknown,
  persistence: HarnessWorkflowPersistence,
  workspaceId: string,
) {
  const signal = harnessInteractionResumeSignalSchema.safeParse(decision);
  if (!signal.success) return question.workflowRevision;
  const current = await persistence.readPendingInteraction?.(
    workspaceId,
    question.workflowId,
    { includeResolved: true },
  );
  if (!current || current.requestId !== question.questionId) {
    throw new Error(
      'Current durable interaction revision is unavailable.',
    );
  }
  return current.revision;
}

function decisionTopic(questionId: string) {
  return `structured-decision:${questionId}`;
}
