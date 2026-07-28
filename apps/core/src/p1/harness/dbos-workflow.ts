import { DBOS } from '@dbos-inc/dbos-sdk';
import {
  structuredDecisionInputSchema,
  workflowProgressEnvelopeSchema,
  workflowTokenEnvelopeSchema,
  type ProductUsageUnit,
  type QuestionCard,
  type StructuredDecisionInput,
} from '@meiye/contracts';

import {
  HarnessWorkflowCancellation,
  runHarnessWorkflow,
  harnessMediaJobTopic,
  type HarnessStagePorts,
  type HarnessWorkflowRuntime,
} from './workflow-core.js';
import type {
  HarnessWorkflowInput,
  HarnessWorkflowStarter,
} from './task-admission.js';
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
import type {
  HarnessBillingCompensationTask,
  HarnessBillingSettlementExecutor,
  HarnessBillingSettlementInput,
} from './billing-compensation.js';
import {
  HARNESS_CONFIRMATION_CARD_HOLD_TIMEOUT_CONFIG_KEY,
  HARNESS_CONFIRMATION_CARD_TIMEOUT_CONFIG_KEY,
  type AdminConfigRepository,
} from '../admin-config/foundation-module.js';

export interface HarnessWorkflowPersistence {
  registerPending: HarnessDecisionStore['registerPending'];
  readPending: HarnessDecisionStore['readPending'];
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
}

export type HarnessDbosWorkflowInput =
  | HarnessWorkflowInput
  | { workflowId: string; request: HarnessWorkflowInput };

export interface HarnessBillingSettlementPort
  extends HarnessBillingSettlementExecutor {
  scheduleCompensation(input: HarnessBillingCompensationTask): Promise<void>;
}

const PROGRESS_STREAM = 'progress';
export const DEFAULT_CONFIRMATION_CARD_HOLD_TIMEOUT_SECONDS = 48 * 60 * 60;
export const DEFAULT_CONFIRMATION_CARD_TIMEOUT_SECONDS = 30;

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

export function registerHarnessDbosWorkflow(
  ports: HarnessStagePorts,
  persistence: HarnessWorkflowPersistence,
  semanticResumptions?: HarnessSemanticDecisionResumptionStore,
  billing?: HarnessBillingSettlementPort,
  config?: Pick<AdminConfigRepository, 'get'>,
  decisions?: Pick<HarnessDecisionService, 'submitCoreTimeout'> &
    Partial<Pick<HarnessDecisionService, 'submitCoreHoldExpired'>>,
) {
  const workflow = async (input: HarnessDbosWorkflowInput) => {
    const runtimeWorkflowId = DBOS.workflowID;
    if (!runtimeWorkflowId) {
      throw new Error('Harness workflow requires a DBOS workflow ID.');
    }
    const { request, workflowId } = normalizeHarnessDbosWorkflowInput(
      input,
      runtimeWorkflowId,
    );
    const runtime: HarnessWorkflowRuntime = {
      runStep(effectIdempotencyKey, operation) {
        return DBOS.runStep(operation, {
          name: effectIdempotencyKey.replaceAll(':', '-'),
        });
      },
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
      async awaitDecision(question) {
        const pendingProjection = await DBOS.runStep(
          async () => {
            const timeoutSeconds =
              request.usageReservation &&
              question.unattended === 'continue'
                ? await readConfirmationCardTimeoutSeconds(config)
                : null;
            const holdTimeoutSeconds =
              request.usageReservation && question.unattended !== 'continue'
                ? await readConfirmationCardHoldTimeoutSeconds(config)
                : null;
            const registered = await persistence.registerPending(
              request.workspaceId,
              question,
              { timeoutSeconds },
            );
            return {
              ...(registered ?? { timeoutSeconds }),
              holdTimeoutSeconds,
            };
          },
          { name: `persist-pending-${question.questionId}` },
        );
        await DBOS.setEvent('pending-structured-decision', question);
        if (!request.usageReservation) {
          return {
            command: await waitForDecisionWithoutTimeout(question),
            resolutionSource: 'decision' as const,
          };
        }
        if (question.unattended !== 'continue') {
          const holdTimeoutSeconds = pendingProjection?.holdTimeoutSeconds;
          if (holdTimeoutSeconds == null) {
            // Workflows suspended before C1 retain their original unbounded hold
            // layout. Branching into the new bounded layout would reuse a
            // historical recv function ID for a differently named runStep.
            return {
              command: await waitForDecisionWithoutTimeout(question),
              resolutionSource: 'decision' as const,
            };
          }
          const decision = await waitForHeldDecision(
            question,
            holdTimeoutSeconds,
          );
          if (decision) {
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
            return {
              command: await waitForDecisionWithoutTimeout(question),
              resolutionSource: 'decision' as const,
            };
          }
          return {
            cancelled: true as const,
            merchantMessage: '超时未选择，本次任务已取消，额度已退回',
            resolutionSource: 'core_hold_expired' as const,
          };
        }
        // Pre-projection workflow records return no value from function ID 4.
        // They use the deterministic default instead of a live config read.
        const timeoutSeconds =
          pendingProjection?.timeoutSeconds ??
          DEFAULT_CONFIRMATION_CARD_TIMEOUT_SECONDS;
        const decision = await DBOS.recv<StructuredDecisionInput>(
          decisionTopic(question.questionId),
          { timeoutSeconds },
        );
        const command = confirmationCardDecision(question, decision);
        if (!decision) {
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
            return {
              command: await waitForDecisionWithoutTimeout(question),
              resolutionSource: 'decision' as const,
            };
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
      recordTrace(input) {
        return DBOS.runStep(
          () =>
            persistence.recordStageTrace({
              ...input,
              workspaceId: request.workspaceId,
            }),
          { name: `persist-${input.stage}-trace` },
        );
      },
    };
    try {
      let result;
      try {
        result = await runHarnessWorkflow(workflowId, request, ports, runtime);
      } catch (error) {
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
        );
        // Whether the reserved 额度 came back is part of what the merchant is
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
      if (billing && settlement) {
        await commitHarnessBillingOrSchedule({
          billing,
          input: settlement,
          runStep: dbosBillingStep,
        });
      }
      return result;
    } finally {
      await DBOS.closeStream(PROGRESS_STREAM);
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

export async function commitHarnessBillingOrSchedule(input: {
  billing: HarnessBillingSettlementPort;
  input: HarnessBillingSettlementInput;
  runStep: BillingRunStep;
}) {
  try {
    await input.runStep('commit-product-usage', () =>
      input.billing.commit(input.input),
    );
  } catch {
    await input.runStep('schedule-product-usage-commit', () =>
      input.billing.scheduleCompensation({
        action: 'commit',
        attempts: 0,
        ...input.input,
      }),
    );
  }
}

/**
 * What actually happened to the reservation. `scheduled` and `unavailable` both
 * mean the 额度 is not back yet — the merchant must not be told it is.
 */
export type HarnessRefundOutcome = 'refunded' | 'scheduled' | 'unavailable';

export async function refundHarnessBillingPreservingFailure(input: {
  billing: HarnessBillingSettlementPort;
  input: HarnessBillingSettlementInput;
  runStep: BillingRunStep;
}): Promise<HarnessRefundOutcome> {
  try {
    await input.runStep('refund-product-usage', () =>
      input.billing.refund(input.input),
    );
    return 'refunded';
  } catch {
    try {
      await input.runStep('schedule-product-usage-refund', () =>
        input.billing.scheduleCompensation({
          action: 'refund',
          attempts: 0,
          ...input.input,
        }),
      );
      return 'scheduled';
    } catch {
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
  );
  if (input.request.usageReservation && (!input.billing || !settlement)) {
    throw new Error(
      'Harness cancellation requires its reserved billing input.',
    );
  }
  if (input.billing && settlement) {
    await refundHarnessBillingPreservingFailure({
      billing: input.billing,
      input: settlement,
      runStep: input.runStep,
    });
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
  command: StructuredDecisionInput,
  resolver?: HarnessRuntimeIdResolver,
) {
  const runtimeWorkflowId =
    (await resolver?.workflowRuntimeId(workspaceId, workflowId)) ??
    harnessRuntimeId(workspaceId, workflowId);
  await DBOS.send(
    runtimeWorkflowId,
    command,
    decisionTopic(command.questionId),
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
  decision: StructuredDecisionInput | null,
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
  const parsed = structuredDecisionInputSchema.parse(decision);
  if (parsed.questionId !== question.questionId) {
    throw new Error('Structured decision does not match the pending question.');
  }
  if (parsed.workflowRevision !== question.workflowRevision) {
    throw new Error('Structured decision targets a stale workflow revision.');
  }
  return parsed;
}

export function confirmationCardHoldExpired(question: QuestionCard) {
  return structuredDecisionInputSchema.parse({
    idempotencyKey: `${question.questionId}:r${question.workflowRevision}:core_hold_expired`,
    questionId: question.questionId,
    workflowRevision: question.workflowRevision,
    patch: {
      field: question.response.field,
      value: '超时未选择，本次任务已取消，额度已退回',
      reason: question.response.reason,
    },
    decision: {
      state: 'ignored',
      value: '超时未选择，本次任务已取消，额度已退回',
    },
  });
}

async function waitForHeldDecision(
  question: QuestionCard,
  timeoutSeconds: number,
) {
  const decision = await DBOS.recv<StructuredDecisionInput>(
    decisionTopic(question.questionId),
    { timeoutSeconds },
  );
  return decision ? confirmationCardDecision(question, decision) : null;
}

async function waitForDecisionWithoutTimeout(question: QuestionCard) {
  for (;;) {
    const decision = await DBOS.recv<StructuredDecisionInput>(
      decisionTopic(question.questionId),
    );
    if (decision) return confirmationCardDecision(question, decision);
  }
}

function decisionTopic(questionId: string) {
  return `structured-decision:${questionId}`;
}
