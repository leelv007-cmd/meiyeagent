import type {
  AskMerchantAnswer,
  CreationLensId,
  ExecutionConfirmationAnswer,
  HarnessInteractionRequest,
  QuestionCard,
} from '@meiye/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { toast } from 'sonner';

import { workbench_operation_failed } from '@/locale/paraglide/messages';
import {
  acknowledgeHarnessInteractionRenderer,
  decideExecutionConfirmation,
  readPendingHarnessDecision,
  readPendingHarnessInteraction,
  readPendingHarnessInteractionMessage,
  submitHarnessDecision,
  submitHarnessInteraction,
  submitHarnessInteractionMerchantMessage,
} from '@/product/harness-client';
import { projectResultTokenStream } from '@/product/results/result-token-stream';
import { useWorkflowEventStream } from '@/product/use-workflow-event-stream';

import { composerQuestionDecision } from './composer-question-card';
import type { ComposerQuestionSettlement } from './composer-question-timeout';
import {
  applyComposerPendingInterrupts,
  applyComposerProgress,
  applyComposerWorkflowState,
  bindComposerTask,
  type ComposerSession,
  type ComposerSessionTask,
} from './composer-session';
import { projectExperienceBasis } from './task-experience';

export type WorkflowEventSource = typeof useWorkflowEventStream;

export type ComposerInteractionTransports = {
  acknowledgeRenderer: typeof acknowledgeHarnessInteractionRenderer;
  decideExecutionConfirmation: typeof decideExecutionConfirmation;
  readDecision: typeof readPendingHarnessDecision;
  readInteraction: typeof readPendingHarnessInteraction;
  readInteractionMessage: typeof readPendingHarnessInteractionMessage;
  submitDecision: typeof submitHarnessDecision;
  submitInteraction: typeof submitHarnessInteraction;
  submitMerchantMessage: typeof submitHarnessInteractionMerchantMessage;
};

const LIVE_TRANSPORTS: ComposerInteractionTransports = {
  acknowledgeRenderer: acknowledgeHarnessInteractionRenderer,
  decideExecutionConfirmation,
  readDecision: readPendingHarnessDecision,
  readInteraction: readPendingHarnessInteraction,
  readInteractionMessage: readPendingHarnessInteractionMessage,
  submitDecision: submitHarnessDecision,
  submitInteraction: submitHarnessInteraction,
  submitMerchantMessage: submitHarnessInteractionMerchantMessage,
};

export type UseComposerInteractionsOptions = {
  costFeedbackPresent: boolean;
  executionConfirmOpen: boolean;
  lensId: CreationLensId | null;
  session: ComposerSession;
  setSession: Dispatch<SetStateAction<ComposerSession>>;
  eventSource?: WorkflowEventSource;
  transports?: Partial<ComposerInteractionTransports>;
};

/**
 * V31-63: the projected reprice-successor answer returns the successor's task
 * handle alongside the normal resume acknowledgement. Anything else (legacy
 * shapes, in-workflow resumes) simply yields null.
 */
function successorTaskFromInteractionResult(
  result: unknown
): ComposerSessionTask | null {
  if (typeof result !== 'object' || result === null) return null;
  const successor = (result as { successorTask?: unknown }).successorTask;
  if (typeof successor !== 'object' || successor === null) return null;
  const { taskId, workId, packageId } = successor as Record<string, unknown>;
  return typeof taskId === 'string' &&
    taskId &&
    typeof workId === 'string' &&
    workId &&
    typeof packageId === 'string' &&
    packageId
    ? { taskId, workId, packageId }
    : null;
}

export function useComposerInteractions(
  taskId: string,
  options: UseComposerInteractionsOptions
) {
  const transports = { ...LIVE_TRANSPORTS, ...options.transports };
  const useEventSource = options.eventSource ?? useWorkflowEventStream;
  const [questionPending, setQuestionPending] = useState(false);
  const workflowQueryKey = useMemo(
    () => ['harness', 'workflow', taskId] as const,
    [taskId]
  );
  const decisionQueryKey = useMemo(
    () => ['harness', 'decision', taskId] as const,
    [taskId]
  );
  const interactionQueryKey = useMemo(
    () => ['harness', 'interaction', taskId] as const,
    [taskId]
  );
  const interactionMessageQueryKey = useMemo(
    () => ['harness', 'interaction-message', taskId] as const,
    [taskId]
  );
  const workflowStream = useEventSource({
    enabled: Boolean(taskId),
    workflowId: taskId,
    workflowQueryKey,
  });

  useEffect(() => {
    if (!workflowStream.latestProgress) return;
    options.setSession((current) =>
      applyComposerProgress(current, workflowStream.latestProgress!)
    );
  }, [options.setSession, workflowStream.latestProgress]);

  useEffect(() => {
    if (!workflowStream.workflowState) return;
    options.setSession((current) =>
      applyComposerWorkflowState(
        current,
        workflowStream.workflowState!,
        workflowStream.harnessDelivery,
        workflowStream.harnessCancellation,
        workflowStream.merchantReport
      )
    );
  }, [
    options.setSession,
    workflowStream.harnessCancellation,
    workflowStream.harnessDelivery,
    workflowStream.merchantReport,
    workflowStream.workflowState,
  ]);

  const decisionQuery = useQuery({
    enabled: Boolean(taskId) && options.session.phase !== 'delivered',
    queryKey: decisionQueryKey,
    queryFn: ({ signal }) => transports.readDecision(taskId, signal),
    refetchInterval: options.session.phase === 'delivered' ? false : 2_000,
  });
  const interactionQuery = useQuery({
    enabled: Boolean(taskId) && options.session.phase !== 'delivered',
    queryKey: interactionQueryKey,
    queryFn: ({ signal }) => transports.readInteraction(taskId, signal),
    refetchInterval: options.session.phase === 'delivered' ? false : 2_000,
  });
  const interactionMessageQuery = useQuery({
    enabled: Boolean(taskId) && options.session.phase !== 'delivered',
    queryKey: interactionMessageQueryKey,
    queryFn: ({ signal }) => transports.readInteractionMessage(taskId, signal),
    refetchInterval: options.session.phase === 'delivered' ? false : 2_000,
  });

  const pendingAskRequest =
    interactionQuery.data?.kind === 'ask_merchant'
      ? interactionQuery.data
      : null;
  const pendingExecutionConfirmation =
    interactionQuery.data?.kind === 'execution_confirmation'
      ? interactionQuery.data
      : null;
  const pendingExecutionWaitingMessage =
    interactionMessageQuery.data?.kind === 'execution_confirmation'
      ? interactionMessageQuery.data
      : null;
  const pendingQuestion: QuestionCard | null =
    decisionQuery.data?.question ?? null;
  const questionReservationReleased =
    decisionQuery.data?.reservationReleased === true;
  const questionResolutionSource =
    decisionQuery.data?.resolutionSource === 'core_timeout' ||
    decisionQuery.data?.resolutionSource === 'core_hold_expired'
      ? decisionQuery.data.resolutionSource
      : null;
  const questionTimeoutSeconds = decisionQuery.data?.timeoutSeconds ?? null;
  const pendingExecutionConfirmTurnId =
    pendingExecutionConfirmation?.requestId ??
    pendingExecutionWaitingMessage?.requestId ??
    (options.executionConfirmOpen ? 'client-execution-confirm' : null);
  const pendingQuestionTurnId =
    pendingAskRequest?.requestId ?? pendingQuestion?.questionId ?? null;

  useEffect(() => {
    options.setSession((current) =>
      applyComposerPendingInterrupts(current, {
        questionId: pendingQuestionTurnId,
        executionConfirmId: pendingExecutionConfirmTurnId,
      })
    );
  }, [
    options.setSession,
    pendingExecutionConfirmTurnId,
    pendingQuestionTurnId,
    questionResolutionSource,
    workflowStream.workflowState,
  ]);

  const answerQuestion = useCallback(
    async (input: {
      settlement: ComposerQuestionSettlement;
      value: string;
    }) => {
      if (!pendingQuestion || !taskId) return;
      setQuestionPending(true);
      try {
        const result = await transports.submitDecision(
          taskId,
          composerQuestionDecision({
            question: pendingQuestion,
            idempotencyKey: `composer-decision:${pendingQuestion.questionId}:${input.settlement}`,
            settlement: input.settlement,
            value: input.value,
          })
        );
        if ('consumedByOther' in result) {
          toast.info('系统已先一步处理，正在同步最新状态。');
        } else if (result.successor) {
          toast.success('已收到补充，正在生成精修版本。');
        }
        await decisionQuery.refetch();
        return result;
      } catch (error) {
        toast.error(workbench_operation_failed());
        throw error;
      } finally {
        setQuestionPending(false);
      }
    },
    [decisionQuery, pendingQuestion, taskId, transports]
  );

  const answerAskMerchant = useCallback(
    async (response: AskMerchantAnswer['response']) => {
      if (!pendingAskRequest || !taskId) return;
      setQuestionPending(true);
      try {
        await transports.submitInteraction(taskId, {
          requestId: pendingAskRequest.requestId,
          revision: pendingAskRequest.revision,
          idempotencyKey:
            `composer-interaction:${pendingAskRequest.requestId}:` +
            `r${pendingAskRequest.revision}:merchant`,
          resume: {
            runId: pendingAskRequest.runId,
            step: pendingAskRequest.step,
          },
          response,
        });
        await Promise.all([
          interactionQuery.refetch(),
          decisionQuery.refetch(),
        ]);
      } catch {
        toast.error(workbench_operation_failed());
        throw new Error('The merchant interaction could not be submitted.');
      } finally {
        setQuestionPending(false);
      }
    },
    [decisionQuery, interactionQuery, pendingAskRequest, taskId, transports]
  );

  const answerExecutionConfirmation = useCallback(
    async (response: ExecutionConfirmationAnswer['response']) => {
      if (!pendingExecutionConfirmation || !taskId) return;
      setQuestionPending(true);
      const resumeExecution = async () =>
        transports.submitInteraction(taskId, {
          requestId: pendingExecutionConfirmation!.requestId,
          revision: pendingExecutionConfirmation!.revision,
          idempotencyKey:
            `composer-interaction:${pendingExecutionConfirmation!.requestId}:` +
            `r${pendingExecutionConfirmation!.revision}:merchant`,
          resume: {
            runId: pendingExecutionConfirmation!.runId,
            step: pendingExecutionConfirmation!.step,
          },
          response,
        });
      try {
        // V31-11: record the immutable confirmation decision first (confirmed
        // keeps the hold; rejected refunds it), then resume the workflow.
        const decided = await transports.decideExecutionConfirmation(
          pendingExecutionConfirmation.requestId,
          {
            decisionId:
              `composer-confirmation-decision:` +
              `${pendingExecutionConfirmation.requestId}`,
            decision: response.kind === 'approved' ? 'confirmed' : 'rejected',
            decidedAt: new Date().toISOString(),
          }
        );
        if (decided.merchantMessage) {
          toast.success(decided.merchantMessage);
        }
        const resumed = await resumeExecution();
        // V31-63: an approved reprice-successor card starts a NEW run. The
        // server hands its task handle back; bind the conversation onto it so
        // the successor's progress and delivery land in this same thread.
        const successorTask = successorTaskFromInteractionResult(resumed);
        if (successorTask) {
          options.setSession((current) =>
            bindComposerTask(current, successorTask)
          );
        }
        await interactionQuery.refetch();
      } catch {
        // The immutable domain decision is the only authority that can release
        // paid execution. Keep the workflow suspended when that write fails.
        toast.error(workbench_operation_failed());
        throw new Error('The execution confirmation could not be submitted.');
      } finally {
        setQuestionPending(false);
      }
    },
    [
      interactionQuery,
      options.setSession,
      pendingExecutionConfirmation,
      taskId,
      transports,
    ]
  );

  const answerExecutionWaitingMessage = useCallback(
    async (
      request: Extract<
        HarnessInteractionRequest,
        { kind: 'execution_confirmation' }
      >,
      message: string
    ) => {
      if (!taskId || request.runId !== taskId) return;
      setQuestionPending(true);
      try {
        await transports.submitMerchantMessage(taskId, {
          requestId: request.requestId,
          revision: request.revision,
          step: request.step,
          carrier: 'conversation',
          idempotencyKey:
            `composer-interaction:${request.requestId}:` +
            `r${request.revision}:merchant-message`,
          message,
        });
        await Promise.all([
          interactionMessageQuery.refetch(),
          interactionQuery.refetch(),
          decisionQuery.refetch(),
        ]);
      } catch {
        toast.error(workbench_operation_failed());
        throw new Error('The merchant continuation could not be submitted.');
      } finally {
        setQuestionPending(false);
      }
    },
    [
      decisionQuery,
      interactionMessageQuery,
      interactionQuery,
      taskId,
      transports,
    ]
  );

  const acknowledgeAskMerchantRenderer = useCallback(
    async (request: HarnessInteractionRequest) =>
      transports.acknowledgeRenderer(taskId, {
        requestId: request.requestId,
        revision: request.revision,
        step: request.step,
        carrier: 'conversation',
      }),
    [taskId, transports]
  );
  const refreshInteractionAfterRendererRejection = useCallback(async () => {
    await Promise.all([
      interactionQuery.refetch(),
      interactionMessageQuery.refetch(),
    ]);
  }, [interactionMessageQuery, interactionQuery]);

  const experienceBasis = useMemo(
    () =>
      projectExperienceBasis({
        producerSettled:
          Boolean(workflowStream.harnessExperienceBasis) ||
          workflowStream.workflowState === 'success' ||
          workflowStream.workflowState === 'failed',
        confirmedPreferences:
          workflowStream.harnessExperienceBasis?.confirmedPreferences ?? [],
      }),
    [workflowStream.harnessExperienceBasis, workflowStream.workflowState]
  );
  const tokenStream = useMemo(
    () =>
      projectResultTokenStream({
        workspaceKind: options.lensId === 'image_text' ? 'image_text' : 'copy',
        partialCandidates: workflowStream.copyCandidates,
        progressState: workflowStream.workflowState,
        loading:
          options.session.phase === 'running' ||
          options.session.phase === 'submitting',
        completed: options.session.phase === 'delivered',
        reconnecting: workflowStream.transportStatus === 'degraded',
      }),
    [
      options.lensId,
      options.session.phase,
      workflowStream.copyCandidates,
      workflowStream.transportStatus,
      workflowStream.workflowState,
    ]
  );

  return {
    acknowledgeAskMerchantRenderer,
    answerAskMerchant,
    answerExecutionConfirmation,
    answerExecutionWaitingMessage,
    answerQuestion,
    experienceBasis,
    hasExecutionConfirmBody:
      Boolean(pendingExecutionConfirmation) ||
      Boolean(pendingExecutionWaitingMessage) ||
      options.executionConfirmOpen ||
      options.costFeedbackPresent,
    pendingAskRequest,
    pendingExecutionConfirmation,
    pendingExecutionWaitingMessage,
    pendingQuestion,
    questionPending,
    questionReservationReleased,
    questionResolutionSource,
    questionTimeoutSeconds,
    refreshInteractionAfterRendererRejection,
    tokenStream,
    workflowStream,
  };
}
