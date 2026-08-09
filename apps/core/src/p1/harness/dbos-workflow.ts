import { DBOS } from '@dbos-inc/dbos-sdk';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  harnessInteractionAnswerSchema,
  INTERRUPT_PAYLOAD_SCHEMA_VERSION,
  interruptPayloadSchema,
  questionCardSchema,
  structuredDecisionInputSchema,
  workflowProgressEnvelopeSchema,
  workflowTokenEnvelopeSchema,
  type BoundedExecutionLimitName,
  type HarnessInteractionRequest,
  type HarnessStage,
  type InterruptPayload,
  type ProductUsageUnit,
  type QuestionCard,
  type ResumeInterruptCommand,
  type StructuredDecisionInput,
} from '@meiye/contracts';

import {
  InterruptProtocolError,
  type InterruptResumeBridgeInput,
  type InterruptResumeBridgePort,
  type StoredInterrupt,
} from './interrupt-protocol.js';

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
import type {
  ExecutionConfirmationService,
} from '../agent-session/execution-confirmation-service.js';
import type {
  ConfirmationAuthorityAssembler,
  CreateExecutionConfirmationAuthorityInput,
} from '../agent-session/execution-confirmation-authority.js';
import type { ConfirmationAuthorityStore } from '../agent-session/execution-confirmation-authority-store.js';
import type { PlanCompiler } from '../agent-session/plan-compiler.js';
import { resumeWithRaisedServerLimit } from './bounded-execution-controller.js';
import {
  executionPlanAdmissionWorkflowId,
  type HarnessWorkflowInput,
  type HarnessWorkflowStarter,
} from './task-admission.js';
import {
  resolveDurableReplayBranch,
  verifyExecutionPlanSnapshotForDbos,
  type ExecutionPlanAdmissionPort,
  type SnapshotLiveFacts,
} from './execution-plan-admission.js';
import type { ShadowReconciliationService } from './shadow-reconciliation.js';
import type { LegacyShadowObservationReader } from './legacy-shadow-observation-reader.js';
import type {
  ProductionSampleInput,
  ProductionSampleOutcome,
} from '../eval/production-sampling.js';
import type { BindEvalResultInput } from '../eval/release-binding.js';
import type {
  QuickCheckToolCall,
  QuickCheckTrace,
} from '../agent-session/quick-checks.js';
import type {
  HarnessDecisionService,
  HarnessDecisionStore,
} from './decision-service.js';
import { normalizeHarnessTerminalFailure } from './terminal-failure.js';
import { HarnessExecutionFencePauseError } from './context-fence.js';
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
  HarnessInteractionError,
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
import { isPartialDeliveryBasis } from '../product-billing/partial-delivery-settlement.js';

export const HARNESS_INTERACTION_CONTINUATION_LAYOUT =
  'bounded_followup_v1' as const;

/**
 * V31-14 P1-a: typed Interrupt protocol closed loop.
 *
 * mirrorPending mirrors a pending confirmation question into the durable
 * p1_agent_interrupts store (home/mobile pending list). resolvePending syncs
 * the interrupt lifecycle when the workflow resolves a question through its
 * own channels. The resume direction is delivered by
 * createHarnessInterruptResumeBridge (InterruptProtocolService.resume → DBOS
 * recv channel), keeping duplicate resume side-effect free.
 */
export interface HarnessInterruptProtocolPort {
  mirrorPending(input: {
    workspaceId: string;
    question: QuestionCard;
    stage: HarnessStage;
    request: HarnessWorkflowInput;
    holdTimeoutSeconds?: number | null;
  }): Promise<void>;
  resolvePending(input: {
    workspaceId: string;
    interruptId: string;
    revision: number;
    source:
      | 'decision'
      | 'core_timeout'
      | 'core_hold_expired'
      | 'system_default'
      | 'reservation_released';
  }): Promise<void>;
}

export type HarnessInterruptResolutionSource =
  | 'decision'
  | 'core_timeout'
  | 'core_hold_expired'
  | 'system_default'
  | 'reservation_released';

/**
 * Typed mirror payload from a pending QuestionCard.
 *
 * interruptId === questionId so resume CAS and the workflow's decision topic
 * share one coordinate; revision === question.workflowRevision. The full
 * QuestionCard travels in args so the resume bridge can reconstruct the
 * StructuredDecisionInput (response.field / response.reason).
 */
export function harnessInterruptMirrorInput(input: {
  question: QuestionCard;
  stage: HarnessStage;
  request: HarnessWorkflowInput;
  holdTimeoutSeconds?: number | null;
  agentCoordinates?: { threadId: string; runId: string };
}): { workspaceId: string; payload: InterruptPayload } {
  const { question, request, stage } = input;
  const executionConfirmation =
    question.executionConfirmationAuthority?.kind === 'external_action';
  const payload = interruptPayloadSchema.parse({
    schemaVersion: INTERRUPT_PAYLOAD_SCHEMA_VERSION,
    interruptId: question.questionId,
    threadId:
      input.agentCoordinates?.threadId ?? `harness-thread:${question.workflowId}`,
    runId: input.agentCoordinates?.runId ?? question.workflowId,
    workflowId: question.workflowId,
    step: stage,
    revision: question.workflowRevision,
    action: executionConfirmation ? 'confirm_paid_execution' : 'answer_question',
    args: { question: structuredClone(question) },
    config: executionConfirmation
      ? {
          allowAccept: true,
          allowEdit: false,
          allowReject: true,
          allowRespond: false,
        }
      : {
          allowAccept: true,
          allowEdit: false,
          allowReject: true,
          allowRespond: true,
        },
    description: question.question,
    // D-153: a business hold deadline only. Ordinary ask_merchant must not
    // expire (D-116 carrier TTL ban). The timestamp is best-effort; the mirror
    // helper tolerates a retried step re-computing it (same id + revision).
    ...(input.holdTimeoutSeconds != null
      ? {
          expiresAt: new Date(
            Date.now() + input.holdTimeoutSeconds * 1000,
          ).toISOString(),
        }
      : {}),
    resourceId: request.workspaceId,
  });
  return { workspaceId: request.workspaceId, payload };
}

export function interruptQuestionFromPayload(
  payload: InterruptPayload,
): QuestionCard {
  const args = payload.args as { question?: unknown } | undefined;
  const question = questionCardSchema.safeParse(args?.question);
  if (!question.success) {
    throw new Error('Interrupt payload does not carry a valid QuestionCard.');
  }
  if (
    question.data.questionId !== payload.interruptId ||
    question.data.workflowRevision !== payload.revision
  ) {
    throw new Error(
      'Interrupt payload QuestionCard does not match its id/revision.',
    );
  }
  return question.data;
}

/**
 * Typed resume → StructuredDecisionInput mapping (V31-14 §27.6).
 * accept/respond/edit map to 'accepted'; reject maps to 'ignored' (skip with
 * the rejection value, matching ask_merchant rejection semantics). respond and
 * edit require a merchant-supplied value; without one the resume fails closed.
 */
export function interruptResumeDecision(
  question: QuestionCard,
  command: ResumeInterruptCommand,
): StructuredDecisionInput {
  const args =
    typeof command.args === 'object' &&
    command.args !== null &&
    !Array.isArray(command.args)
      ? (command.args as { value?: unknown })
      : undefined;
  const value =
    typeof args?.value === 'string' && args.value.length > 0
      ? args.value
      : undefined;
  let state: StructuredDecisionInput['decision']['state'] = 'accepted';
  let resolvedValue = 'approved';
  switch (command.type) {
    case 'accept':
      state = 'accepted';
      resolvedValue = value ?? 'approved';
      break;
    case 'respond':
    case 'edit':
      state = 'accepted';
      if (!value) {
        throw new Error(
          `Interrupt resume type ${command.type} requires a merchant value.`,
        );
      }
      resolvedValue = value;
      break;
    case 'reject':
      state = 'ignored';
      resolvedValue = value ?? 'rejected';
      break;
  }
  return structuredDecisionInputSchema.parse({
    idempotencyKey:
      command.idempotencyKey ??
      `interrupt:${command.interruptId}:r${command.revision}`,
    questionId: question.questionId,
    workflowRevision: question.workflowRevision,
    patch: {
      field: question.response.field,
      value: resolvedValue,
      reason: question.response.reason,
    },
    decision: {
      state,
      value: resolvedValue,
    },
  });
}

export function interruptResumeInteractionAnswer(
  question: QuestionCard,
  payload: InterruptPayload,
  command: ResumeInterruptCommand,
) {
  const args =
    typeof command.args === 'object' &&
    command.args !== null &&
    !Array.isArray(command.args)
      ? (command.args as { value?: unknown })
      : undefined;
  const value =
    typeof args?.value === 'string' && args.value.length > 0
      ? args.value
      : undefined;
  const identity = {
    requestId: question.questionId,
    revision: question.workflowRevision,
    idempotencyKey:
      command.idempotencyKey ??
      `interrupt:${command.interruptId}:r${command.revision}`,
    resume: {
      runId: question.workflowId,
      step: payload.step,
    },
  };
  if (question.executionConfirmationAuthority) {
    if (command.type === 'respond' || command.type === 'edit') {
      throw new Error(
        `Execution confirmation does not accept ${command.type} resumes.`,
      );
    }
    return harnessInteractionAnswerSchema.parse({
      ...identity,
      response:
        command.type === 'accept'
          ? { kind: 'approved' }
          : {
              kind: 'rejected',
              ...(value ? { feedback: value } : {}),
            },
    });
  }
  if ((command.type === 'respond' || command.type === 'edit') && !value) {
    throw new Error(
      `Interrupt resume type ${command.type} requires a merchant value.`,
    );
  }
  return harnessInteractionAnswerSchema.parse({
    ...identity,
    response:
      command.type === 'reject'
        ? { kind: 'skipped' }
        : {
            kind: 'answer',
            items: [
              {
                itemId: question.response.field,
                result: {
                  kind: 'answer',
                  value: value ?? question.options[0]?.label ?? 'approved',
                },
              },
            ],
          },
  });
}

/**
 * Production resume bridge: after the interrupt CAS applies, deliver the
 * reconstructed decision into the suspended workflow's recv channel.
 * DBOS.send idempotency key = stable per (interrupt, revision, resume key),
 * so duplicate resumes after a failed delivery have zero extra side effects.
 */
export function createHarnessInterruptResumeBridge(
  resolver?: HarnessRuntimeIdResolver,
  interactions?: {
    submit(
      workspaceId: string,
      answer: unknown,
      expectedRunId?: string,
    ): Promise<unknown>;
  },
): InterruptResumeBridgePort {
  return {
    async deliver(input: InterruptResumeBridgeInput) {
      const { workspaceId, payload, command } = input;
      const question = interruptQuestionFromPayload(payload);
      if (interactions) {
        try {
          await interactions.submit(
            workspaceId,
            interruptResumeInteractionAnswer(question, payload, command),
            payload.workflowId,
          );
        } catch (error) {
          if (
            !(error instanceof HarnessInteractionError) ||
            error.code !== 'STALE_INTERACTION_REQUEST'
          ) {
            throw error;
          }
        }
        return;
      }
      const decision = interruptResumeDecision(question, command);
      const runtimeWorkflowId =
        (await resolver?.workflowRuntimeId(
          workspaceId,
          payload.workflowId,
        )) ?? harnessRuntimeId(workspaceId, payload.workflowId);
      await DBOS.send(
        runtimeWorkflowId,
        decision,
        decisionTopic(payload.interruptId),
        `harness-interrupt:${workspaceId}:${runtimeWorkflowId}:${payload.interruptId}:${command.idempotencyKey ?? `r${command.revision}`}`,
      );
    },
  };
}

/**
 * Ready-made mirror wiring for assembly: builds the typed payload from the
 * pending question and requests it through the protocol service. A durable
 * step retry that re-computes a hold expiry timestamp is tolerated (same id +
 * revision already pending → keep the first write); genuine conflicts throw.
 */
export function createHarnessInterruptProtocolPort(input: {
  request: (input: {
    workspaceId: string;
    payload: InterruptPayload;
  }) => Promise<{ record: StoredInterrupt; replayed: boolean }>;
  resolveByWorkflow: (input: {
    workspaceId: string;
    interruptId: string;
    revision: number;
    source: HarnessInterruptResolutionSource;
  }) => Promise<'applied' | 'replayed'>;
  getById: (interruptId: string) => Promise<StoredInterrupt | null>;
  resolveAgentCoordinates?: (input: {
    workspaceId: string;
    workflowId: string;
    request: HarnessWorkflowInput;
  }) => Promise<{ threadId: string; runId: string }>;
}): HarnessInterruptProtocolPort {
  return {
    async mirrorPending(mirrorInput) {
      const { workspaceId: _workspaceId, ...mirror } = mirrorInput;
      const agentCoordinates = input.resolveAgentCoordinates
        ? await input.resolveAgentCoordinates({
            workspaceId: mirrorInput.workspaceId,
            workflowId: mirror.question.workflowId,
            request: mirror.request,
          })
        : undefined;
      const { workspaceId, payload } = harnessInterruptMirrorInput({
        ...mirror,
        ...(agentCoordinates ? { agentCoordinates } : {}),
      });
      try {
        await input.request({ workspaceId, payload });
      } catch (error) {
        if (
          error instanceof InterruptProtocolError &&
          error.code === 'IDEMPOTENCY_CONFLICT'
        ) {
          const existing = await input.getById(payload.interruptId);
          if (
            existing?.status === 'pending' &&
            existing.payload.revision === payload.revision
          ) {
            // Durable step retry: only the hold expiry timestamp drifted.
            // Tolerate when the logical question is otherwise identical.
            const {
              expiresAt: _existingExpiry,
              ...existingRest
            } = existing.payload;
            const {
              expiresAt: _retriedExpiry,
              ...retriedRest
            } = payload;
            if (isDeepStrictEqual(existingRest, retriedRest)) return;
          }
        }
        throw error;
      }
    },
    async resolvePending(resolveInput) {
      await input.resolveByWorkflow(resolveInput);
    },
  };
}

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

export interface HarnessDbosWorkflowOptions {
  semanticResumptions?: HarnessSemanticDecisionResumptionStore;
  billing?: HarnessBillingSettlementPort;
  /**
   * Authoritative confirmation decision used to admit the exact paid plan.
   */
  executionConfirmation?: Pick<ConfirmationAuthorityAssembler, 'createRequest'> &
    Pick<ExecutionConfirmationService, 'getDecisionForWorkspace'> & {
      putCurrent: ConfirmationAuthorityStore['putCurrent'];
    };
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
    'admitSnapshot' | 'verifyAdmittedForDbos'
  >;
  /**
   * Optional live fence facts resolved just before DBOS verification.
   * Production may inject rights/context head readers here.
   */
  resolveExecutionPlanLiveFacts?: (input: {
    workflowId: string;
    request: HarnessWorkflowInput;
  }) => Promise<SnapshotLiveFacts | undefined> | SnapshotLiveFacts | undefined;
  /** Compiler-owned append-only writer for a post-confirm live binding refresh. */
  refreshExecutionPlanLiveBindings?: PlanCompiler['refreshLiveBindings'];
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
    'maybeReconcileOnExecutionComplete' | 'shouldObserveLegacyExecution'
  >;
  /** Read-only legacy pilot receipt. Missing receipt means no shadow sample. */
  legacyShadowObservationReader?: LegacyShadowObservationReader;
  /**
   * V31-23 L0.5: production sampling on Make complete (same sampling point as
   * shadow reconciliation). shouldSample gates by admin-config sample rate;
   * sample persists the l0.5 verdict bound to the release; recordAndEmit
   * writes it through the eval writer (Langfuse outbox). Failures are
   * swallowed — sampling must never fail the run.
   */
  productionSampling?: {
    shouldSample(sampleKey: string): boolean | Promise<boolean>;
    sample(input: ProductionSampleInput): Promise<ProductionSampleOutcome>;
    recordAndEmit(input: BindEvalResultInput): Promise<unknown>;
  };
  /**
   * V31-16: dual-queue Make steering drain at terminal success (follow_up).
   * Page-unit steer drain is on note page progress; this is the all-complete hang.
   * Flag off / kill switch ⇒ port no-ops (zero behavior change).
   */
  makeSteeringBoundary?: import('./make-steering-boundary.js').MakeSteeringBoundaryPort;
  /**
   * V31-14 P1-a: typed Interrupt protocol closed loop. Mirrors pending
   * confirmation questions into p1_agent_interrupts and syncs their lifecycle
   * when the workflow resolves a question through its own channels. The resume
   * direction flows back through InterruptProtocolService.resume's bridge.
   */
  interrupts?: HarnessInterruptProtocolPort;
}

export function registerHarnessDbosWorkflow(
  ports: HarnessStagePorts | HarnessStageCollaborators,
  persistence: HarnessWorkflowPersistence,
  options: HarnessDbosWorkflowOptions = {},
) {
    const {
      semanticResumptions,
      billing,
      executionConfirmation,
      config,
      decisions,
      boundedContinuations,
      taskRecallDue,
      askMerchant,
      interactions,
      executionPlanAdmission,
      resolveExecutionPlanLiveFacts,
      refreshExecutionPlanLiveBindings,
      resolveForceLegacyFiveStage,
      shadowReconciliation,
      legacyShadowObservationReader,
      productionSampling,
      makeSteeringBoundary,
      interrupts,
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
    //
    // The branch test stays OUTSIDE DBOS.runStep deliberately. DBOS assigns a
    // function ID to every step in the workflow body and replays recovery by
    // that index, so wrapping the legacy branch in a step gave every durable
    // legacy workflow a new step 0 and made in-flight runs unrecoverable
    // ("function skill-resolve-intent was recorded when
    // execution-plan-snapshot-verification was expected"). The branch resolver
    // is pure request parsing, so evaluating it in the body stays deterministic.
    const replayBranch = resolveDurableReplayBranch(request);
    if (replayBranch.branch !== 'legacy') {
      await DBOS.runStep(
        async () => {
          const live = resolveExecutionPlanLiveFacts
            ? await resolveExecutionPlanLiveFacts({ workflowId, request })
            : undefined;
          // Always recompute hash on the request-carried snapshot (fail
          // closed). A pending-confirmation replay carries only the admitted
          // hash, so its verification is the stored-row check below.
          if (replayBranch.branch === 'execution_plan_snapshot') {
            verifyExecutionPlanSnapshotForDbos({
              snapshot: replayBranch.snapshot,
              live,
            });
          }
          const replaySnapshotHash =
            replayBranch.branch === 'execution_plan_snapshot'
              ? replayBranch.snapshot.snapshotHash
              : replayBranch.snapshotHash;
          // When the admission writer is wired, also re-verify the stored row.
          if (executionPlanAdmission) {
            await executionPlanAdmission.verifyAdmittedForDbos({
              workflowId,
              snapshotHash: replaySnapshotHash,
              live,
            });
          }
          return {
            branch: replayBranch.branch,
            snapshotHash: replaySnapshotHash,
          };
        },
        { name: 'execution-plan-snapshot-verification' },
      );
    }
    const runtime: HarnessWorkflowRuntime = {
      runStep(effectIdempotencyKey, operation) {
        return DBOS.runStep(operation, {
          name: effectIdempotencyKey.replaceAll(':', '-'),
        });
      },
      recordLegacyShadowObservation(input) {
        return DBOS.runStep(
          () =>
            persistence.recordStageTrace({
              workspaceId: input.workspaceId,
              id: `trace-${input.workflowId}-legacy-shadow-observation`,
              taskId: input.workflowId,
              stage: 'legacy_shadow_observation',
              payload: { legacyShadowObservation: input.observation },
            }),
          { name: 'persist-legacy-shadow-observation' },
        );
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
            // V31-14 P1-a: mirror the pending question into the typed Interrupt
            // store. Idempotent on identical payload; a durable retry of this
            // step replays registerPending and the mirror without conflicts.
            await interrupts?.mirrorPending({
              workspaceId: request.workspaceId,
              question,
              stage,
              request,
              holdTimeoutSeconds,
            });
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
        // V31-14 P1-a: sync the mirrored interrupt lifecycle when this question
        // resolves through any channel. Idempotent: a resume that already
        // CAS-resolved the row replays as a no-op.
        const resolveInterrupt = async (
          source: HarnessInterruptResolutionSource,
        ) => {
          await interrupts?.resolvePending({
            workspaceId: request.workspaceId,
            interruptId: question.questionId,
            revision: question.workflowRevision,
            source,
          });
        };
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
              if ('cancelled' in resolved) {
                await resolveInterrupt(resolved.resolutionSource);
                return resolved;
              }
              await resolveInterrupt('decision');
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
            if ('cancelled' in decision) {
              await resolveInterrupt(decision.resolutionSource);
              return decision;
            }
            await resolveInterrupt('decision');
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
              if ('cancelled' in resolved) {
                await resolveInterrupt(resolved.resolutionSource);
                return resolved;
              }
              await resolveInterrupt('decision');
              return {
                command: resolved,
                resolutionSource: 'decision' as const,
              };
            }
          }
          await resolveInterrupt('core_hold_expired');
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
            if ('cancelled' in resolved) {
              await resolveInterrupt(resolved.resolutionSource);
              return resolved;
            }
            await resolveInterrupt('decision');
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
        if (
          isReleasedReservationCancellation(decision) ||
          isCoreHoldExpiredCancellation(decision, question)
        ) {
          await resolveInterrupt(decision.resolutionSource);
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
                await resolveInterrupt('core_hold_expired');
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
              await resolveInterrupt('core_hold_expired');
              return {
                cancelled: true as const,
                merchantMessage: request.usageReservation
                  ? '超时未选择，本次任务已取消，积分已退回'
                  : '超时未选择，本次任务已取消',
                resolutionSource: 'core_hold_expired' as const,
              };
            }
            await resolveInterrupt(followup.resolutionSource);
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
              if ('cancelled' in resolved) {
                await resolveInterrupt(resolved.resolutionSource);
                return resolved;
              }
              await resolveInterrupt('decision');
              return {
                command: resolved,
                resolutionSource: 'decision' as const,
              };
            }
          }
          await resolveInterrupt('core_timeout');
          return {
            command,
            resolutionSource: 'core_timeout' as const,
          };
        }
        await resolveInterrupt('decision');
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
    let effectiveRequest = request;
    try {
      let result;
      try {
        let activeWorkflowRequest = request;
        // V31-12: verification → context/rights fence. Keep this inside the
        // billing compensation boundary so an admitted stale snapshot cannot
        // strand its reservation before workflow execution starts.
        await DBOS.runStep(
          async () => {
            const branch = resolveDurableReplayBranch(request);
            if (branch.branch === 'pending_confirmation') {
              return {
                branch: 'pending_confirmation' as const,
                snapshotHash: branch.snapshotHash,
              };
            }
            if (branch.branch === 'legacy') {
              return { branch: 'legacy' as const };
            }
            const live = resolveExecutionPlanLiveFacts
              ? await resolveExecutionPlanLiveFacts({ workflowId, request })
              : undefined;
            verifyExecutionPlanSnapshotForDbos({
              snapshot: branch.snapshot,
              live,
            });
            if (executionPlanAdmission) {
              await executionPlanAdmission.verifyAdmittedForDbos({
                workflowId: executionPlanAdmissionWorkflowId(workflowId, {
                  executionPlanSnapshot: branch.snapshot,
                }),
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
        const forceLegacyFiveStage = resolveForceLegacyFiveStage
          ? await resolveForceLegacyFiveStage()
          : false;
        const executionPorts = withExecutionConfirmationStagePort(
          ports,
          executionConfirmation,
          executionPlanAdmission,
          resolveExecutionPlanLiveFacts,
          refreshExecutionPlanLiveBindings,
        );
        for (;;) {
          try {
            result = await runHarnessWorkflow(
              workflowId,
              activeWorkflowRequest,
              executionPorts,
              runtime,
              {
                forceLegacyFiveStage,
                onActiveRequest(activeRequest) {
                  effectiveRequest = activeRequest;
                },
              },
            );
            break;
          } catch (error) {
            if (!(error instanceof HarnessExecutionFencePauseError)) {
              throw error;
            }
            activeWorkflowRequest =
              error.resumeRequest ?? activeWorkflowRequest;
            const question = contextFencePauseQuestion({
              workflowId,
              workflowRevision: request.workflowRevision,
              error,
            });
            const resolved = await runtime.awaitDecision(
              question,
              'context_injection',
            );
            if ('cancelled' in resolved) {
              throw new HarnessWorkflowCancellation(
                resolved.merchantMessage,
                resolved.resolutionSource,
              );
            }
            const command = 'command' in resolved ? resolved.command : resolved;
            if (command.decision.state !== 'accepted') {
              throw new HarnessWorkflowCancellation(
                '你已选择不继续使用变化后的事实，本次任务已结束。',
                'decision',
              );
            }
            const shared = 'shared' in executionPorts
              ? executionPorts.shared
              : executionPorts;
            if (!shared.acknowledgeContextFence) {
              throw new Error(
                'Context fence pause requires an acknowledgement port.',
              );
            }
            await shared.acknowledgeContextFence({
              workflowId,
              diff: error.diff,
            });
          }
        }
      } catch (error) {
        if (error instanceof HarnessInteractionLayoutResetRequiredError) {
          closeProgressStream = false;
          throw error;
        }
        if (error instanceof HarnessWorkflowCancellation) {
          return settleHarnessCancellation({
            billing,
            cancellation: error,
            request: effectiveRequest,
            runStep: dbosBillingStep,
            workflowId,
          });
        }
        const settlement = harnessBillingSettlementInput(
          effectiveRequest,
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
        effectiveRequest,
        workflowId,
        result,
      );
      const completedAt = taskRecallDue
        ? new Date(await DBOS.now()).toISOString()
        : undefined;
      // V31-13: sample shadow reconcile on successful Make complete (no daemon).
      // Failures inside the service are swallowed; this step must not fail the run.
      if (
        shadowReconciliation &&
        legacyShadowObservationReader &&
        effectiveRequest.executionPlanSnapshot
      ) {
        await DBOS.runStep(
          async () => {
            try {
              const snapshot = effectiveRequest.executionPlanSnapshot!;
              if (
                !(await shadowReconciliation.shouldObserveLegacyExecution(
                  workflowId,
                ))
              ) {
                return { sampled: false as const };
              }
              const oldChain = await legacyShadowObservationReader.read({
                workflowId,
                workspaceId: effectiveRequest.workspaceId,
              });
              if (!oldChain) return { sampled: false as const };
              const now = new Date(await DBOS.now()).toISOString();
              return shadowReconciliation.maybeReconcileOnExecutionComplete({
                workflowId,
                workspaceId: effectiveRequest.workspaceId,
                snapshot,
                oldChain,
                now,
                operatorId: 'system',
                correlationId: workflowId,
              });
            } catch (error) {
              console.error('Legacy shadow observation failed.', error);
              return { sampled: false as const };
            }
          },
          { name: 'shadow-reconciliation-sample' },
        );
      }
      // V31-23 L0.5: production quick-check sample on Make complete, gated by
      // the same admin-config sample rate as shadow reconciliation. The Make
      // boundary cannot observe the session tool chain (read_context →
      // generate → check → record), so the trace is synthesized from request
      // facts and the toolOrder/level0/readonly assertions are excluded —
      // sampled verdicts assert bounded + error-free execution structure.
      // Failures are swallowed; sampling must never fail the run.
      if (productionSampling && effectiveRequest.executionPlanSnapshot) {
        await DBOS.runStep(
          () =>
            sampleProductionL05({
              productionSampling,
              workflowId,
              request: effectiveRequest,
            }),
          { name: 'production-l0-5-sample' },
        );
      }
      await settleHarnessTerminalSuccess({
        billing,
        completedAt,
        request: effectiveRequest,
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

export function contextFencePauseQuestion(input: {
  workflowId: string;
  workflowRevision: number;
  error: HarnessExecutionFencePauseError;
}): QuestionCard {
  const diffId = createHash('sha256')
    .update(JSON.stringify(input.error.diff))
    .digest('hex')
    .slice(0, 16);
  return questionCardSchema.parse({
    questionId: `${input.workflowId}:context-fence:${diffId}`,
    workflowId: input.workflowId,
    workflowRevision: input.workflowRevision,
    question: input.error.merchantMessage,
    options: [
      { id: 'continue_after_review', label: '确认变化后继续' },
      { id: 'stop', label: '停止本次任务' },
    ],
    freeText: { enabled: false },
    response: {
      field: 'context_fence_acknowledgement',
      reason: '已引用的价格、日期或权利版本发生变化',
    },
    unattended: 'hold',
    scope: 'current_task',
  });
}

type BillingRunStep = <T>(
  name: string,
  operation: () => Promise<T>,
) => Promise<T>;

/** Bind the confirmed decision and immutable snapshot admission to Make. */
function withExecutionConfirmationStagePort(
  ports: HarnessStagePorts | HarnessStageCollaborators,
  executionConfirmation: HarnessDbosWorkflowOptions['executionConfirmation'] |
    undefined,
  executionPlanAdmission:
    | Pick<ExecutionPlanAdmissionPort, 'admitSnapshot' | 'verifyAdmittedForDbos'>
    | undefined,
  resolveExecutionPlanLiveFacts:
    | NonNullable<HarnessDbosWorkflowOptions['resolveExecutionPlanLiveFacts']>
    | undefined,
  refreshExecutionPlanLiveBindings:
    | NonNullable<HarnessDbosWorkflowOptions['refreshExecutionPlanLiveBindings']>
    | undefined,
): HarnessStagePorts | HarnessStageCollaborators {
  if (!executionConfirmation || !executionPlanAdmission) return ports;
  const confirmationPorts = {
    getExecutionConfirmationDecision: (workspaceId: string, requestId: string) =>
      executionConfirmation.getDecisionForWorkspace(workspaceId, requestId),
    async admitExecutionPlanSnapshot(input: {
      workflowId: string;
      workspaceId: string;
      snapshot: import('@meiye/contracts').ExecutionPlanSnapshot;
      live?: SnapshotLiveFacts;
    }) {
      const admitted = await executionPlanAdmission.admitSnapshot(input);
      await executionPlanAdmission.verifyAdmittedForDbos({
        workflowId: input.workflowId,
        snapshotHash: admitted.admitted.snapshot.snapshotHash,
        ...(input.live ? { live: input.live } : {}),
      });
      return admitted.admitted.snapshot;
    },
    resolveExecutionPlanLiveFacts: resolveExecutionPlanLiveFacts
      ? async (input: {
          workflowId: string;
          request: HarnessWorkflowInput;
          snapshot: import('@meiye/contracts').ExecutionPlanSnapshot;
        }) =>
          resolveExecutionPlanLiveFacts({
            workflowId: input.workflowId,
            request: {
              ...input.request,
              executionPlanSnapshot: input.snapshot,
            },
          })
      : undefined,
    refreshExecutionPlanLiveBindings,
    putExecutionConfirmationAuthority: (input: Parameters<
      ConfirmationAuthorityStore['putCurrent']
    >[0]) => executionConfirmation.putCurrent(input),
    createExecutionConfirmationRequest: (
      input: CreateExecutionConfirmationAuthorityInput,
    ) =>
      executionConfirmation.createRequest(input),
  };
  if ('shared' in ports) {
    Object.assign(ports.shared, confirmationPorts);
    return {
      ...ports,
      shared: { ...ports.shared, ...confirmationPorts },
    };
  }
  return {
    ...(ports as HarnessStagePorts),
    ...confirmationPorts,
  };
}

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
  const admittedPlan = request.executionPlanSnapshot;
  const pendingPlan = request.pendingExecutionPlanSnapshot?.content;
  const effectiveQuote =
    pendingPlan &&
    (!admittedPlan || pendingPlan.planRevision > admittedPlan.planRevision)
      ? pendingPlan.quoteRef
      : (admittedPlan?.quoteRef ?? snapshot.quote);
  const trustedUsage = billingTrustedUsage(result);
  const partialDelivery = billingPartialDelivery(result);
  return {
    workspaceId: request.workspaceId,
    taskId: workflowId,
    quoteId: effectiveQuote.id,
    quoteRevision: String(effectiveQuote.revision),
    ...(request.executionConfirmationReservationIdempotencyKey
      ? {
          creditUsageOperationId:
            request.executionConfirmationReservationIdempotencyKey,
        }
      : {}),
    ...(trustedUsage ? { trustedUsage } : {}),
    ...(partialDelivery ? { partialDelivery } : {}),
    ...(forceCreditRefund ? { forceCreditRefund: true } : {}),
  };
}

/**
 * Executor-declared delivered/total billable units (V31-16 partial settle).
 *
 * Read from the same server-built billing receipt as trustedUsage — a browser
 * never reaches this shape, and an absent declaration keeps the full charge.
 */
function billingPartialDelivery(
  result: unknown,
): HarnessBillingSettlementInput['partialDelivery'] {
  if (!result || typeof result !== 'object' || !('billingReceipt' in result)) {
    return undefined;
  }
  const receipt = result.billingReceipt;
  if (
    !receipt ||
    typeof receipt !== 'object' ||
    !('partialDelivery' in receipt)
  ) {
    return undefined;
  }
  const candidate = receipt.partialDelivery;
  if (!isPartialDeliveryBasis(candidate)) return undefined;
  return {
    totalUnits: candidate.totalUnits,
    deliveredUnits: candidate.deliveredUnits,
  };
}

/**
 * V31-23 L0.5 skeleton trace synthesized from request facts at Make complete.
 * The Make boundary cannot observe the session tool chain (read_context →
 * generate → check → record), so the trace carries only provable primitives:
 * context materialization (read_context), generation (generate), and terminal
 * recording (record). Callers exclude session-only assertions (toolOrder /
 * level0 / readonly) so sampled verdicts stay honest.
 */
function l05MakeCompleteTrace(
  request: HarnessWorkflowInput,
): QuickCheckTrace {
  const toolCalls: QuickCheckToolCall[] = [];
  const snapshot = request.executionPlanSnapshot;
  const execution = request.executionSnapshot;
  if (snapshot?.contextBundleRef) {
    toolCalls.push({ toolName: 'read_context', sideEffect: 'none' });
  }
  if (execution) {
    toolCalls.push({ toolName: 'generate', sideEffect: 'paid' });
    toolCalls.push({ toolName: 'record', sideEffect: 'internal_write' });
  }
  return {
    toolCalls,
    tags: ['l0.5', 'make'],
    output: {
      lens: execution?.lens,
      planId: snapshot?.planId,
      planRevision: snapshot?.planRevision,
    },
  };
}

export type ProductionL05SampleOutcome = {
  sampled: boolean;
  verdict?: string;
  error?: true;
};

/**
 * V31-23 L0.5 production sample at Make complete. Gates by admin-config sample
 * rate, persists the verdict bound to the execution plan's release, and emits
 * through recordAndEmit. Never throws — sampling must not fail the run.
 */
export async function sampleProductionL05(input: {
  productionSampling: NonNullable<
    HarnessDbosWorkflowOptions['productionSampling']
  >;
  workflowId: string;
  request: HarnessWorkflowInput;
}): Promise<ProductionL05SampleOutcome> {
  const releaseId = input.request.executionPlanSnapshot?.harnessReleaseId;
  if (!releaseId) return { sampled: false };
  if (!(await input.productionSampling.shouldSample(input.workflowId))) {
    return { sampled: false };
  }
  try {
    const outcome = await input.productionSampling.sample({
      harnessReleaseId: releaseId,
      trace: l05MakeCompleteTrace(input.request),
      sampleTraceId: `make:${input.workflowId}`,
      includeTags: ['l0.5'],
      excludeTags: ['toolOrder', 'level0', 'readonly'],
      resultId: `l0.5:make:${input.workflowId}`,
    });
    await input.productionSampling.recordAndEmit({
      harnessReleaseId: releaseId,
      layer: 'l0.5',
      gates: outcome.result.gates,
      quickCheckIds: outcome.result.quickCheckIds,
      evalSuiteRevision: outcome.result.evalSuiteRevision,
      sampleTraceId: `make:${input.workflowId}`,
      resultId: outcome.result.resultId,
      createdAt: outcome.result.createdAt,
    });
    return { sampled: true, verdict: outcome.result.verdict };
  } catch (error) {
    console.error('L0.5 production sampling failed.', error);
    return { sampled: false, error: true };
  }
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
  const payload = isCoreHoldExpiredCommand(parsedCommand)
    ? {
        cancelled: true as const,
        interruptId: parsedCommand.questionId,
        merchantMessage: '超时未选择，本次任务已取消，积分已退回',
        resolutionSource: 'core_hold_expired' as const,
        revision: parsedCommand.workflowRevision,
      }
    : parsedCommand;
  await DBOS.send(
    runtimeWorkflowId,
    payload,
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

function isCoreHoldExpiredCommand(
  command: StructuredDecisionInput,
): boolean {
  return (
    command.idempotencyKey ===
      `${command.questionId}:r${command.workflowRevision}:core_hold_expired` &&
    command.decision.state === 'ignored' &&
    command.decision.value === '超时未选择，本次任务已取消，积分已退回'
  );
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
  if (
    isReleasedReservationCancellation(decision) ||
    isCoreHoldExpiredCancellation(decision, question)
  ) {
    return decision;
  }
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

function isCoreHoldExpiredCancellation(
  value: unknown,
  question: QuestionCard,
): value is {
  cancelled: true;
  interruptId: string;
  merchantMessage: string;
  resolutionSource: 'core_hold_expired';
  revision: number;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as {
    cancelled?: unknown;
    interruptId?: unknown;
    merchantMessage?: unknown;
    resolutionSource?: unknown;
    revision?: unknown;
  };
  return (
    candidate.cancelled === true &&
    candidate.interruptId === question.questionId &&
    typeof candidate.merchantMessage === 'string' &&
    candidate.resolutionSource === 'core_hold_expired' &&
    candidate.revision === question.workflowRevision
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
    if (
      isReleasedReservationCancellation(decision) ||
      isCoreHoldExpiredCancellation(decision, question)
    ) {
      return decision;
    }
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
