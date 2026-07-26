import {
  structuredDecisionInputSchema,
  type QuestionCard,
  type StructuredDecisionInput,
} from '@meiye/contracts';
import { createHash } from 'node:crypto';

import { fingerprintValue } from '../job-runtime/job-contracts.js';
import type { HarnessWorkflowInput } from './task-admission.js';

export interface HarnessDecisionEvent {
  id: string;
  taskId: string;
  questionId: string;
  workflowRevision: number;
  idempotencyKey: string;
  payloadFingerprint: string;
  patch: StructuredDecisionInput['patch'];
  decision: StructuredDecisionInput['decision'];
}

export interface HarnessDecisionTrace {
  id: string;
  taskId: string;
  stage: 'intent_naming';
  kind: 'structured_decision';
  eventId: string;
  questionId: string;
  workflowRevision: number;
  outcome: StructuredDecisionInput['decision']['state'];
}

export interface HarnessDecisionStore {
  registerPending(workspaceId: string, question: QuestionCard): Promise<void>;
  readPending(
    workspaceId: string,
    taskId: string,
    options?: { includeResolved?: boolean },
  ): Promise<QuestionCard | null>;
  readDecisionTarget?(
    workspaceId: string,
    taskId: string,
  ): Promise<{
    question: QuestionCard;
    request: HarnessWorkflowInput;
    resolvedByCoreTimeout: boolean;
    status: 'pending' | 'resolved';
  } | null>;
  submit(input: {
    workspaceId: string;
    taskId: string;
    command: StructuredDecisionInput;
    event: HarnessDecisionEvent;
    trace: HarnessDecisionTrace;
    mode?: 'decision' | 'core_timeout' | 'late_answer';
  }): Promise<{
    outcome:
      | 'created'
      | 'replayed'
      | 'stale_question'
      | 'stale_revision'
      | 'idempotency_conflict';
    command?: StructuredDecisionInput;
    resumeRequired: boolean;
  }>;
  claimDecisionResume(
    workspaceId: string,
    taskId: string,
    eventId: string,
  ): Promise<boolean>;
  releaseDecisionResume(
    workspaceId: string,
    taskId: string,
    eventId: string,
  ): Promise<void>;
  markDecisionResumed(
    workspaceId: string,
    taskId: string,
    eventId: string,
  ): Promise<void>;
}

export interface HarnessWorkflowResumer {
  resume(
    workspaceId: string,
    taskId: string,
    command: StructuredDecisionInput,
  ): Promise<void>;
  startSuccessor?(input: {
    command: StructuredDecisionInput;
    request: HarnessWorkflowInput;
    sourceTaskId: string;
    workflowId: string;
    workspaceId: string;
  }): Promise<void>;
}

export class HarnessDecisionError extends Error {
  readonly status = 409;

  constructor(
    readonly code:
      | 'STALE_QUESTION'
      | 'STALE_WORKFLOW_REVISION'
      | 'DECISION_IDEMPOTENCY_CONFLICT'
      | 'DECISION_TARGET_MISMATCH',
    message: string
  ) {
    super(message);
    this.name = 'HarnessDecisionError';
  }
}

export class HarnessDecisionResumeError extends Error {
  readonly code = 'HARNESS_DECISION_RESUME_UNAVAILABLE';
  readonly status = 503;

  constructor(options: { cause: unknown }) {
    super('The persisted decision could not resume the workflow yet.', options);
    this.name = 'HarnessDecisionResumeError';
  }
}

export class HarnessDecisionService {
  constructor(
    private readonly store: HarnessDecisionStore,
    private readonly workflow: HarnessWorkflowResumer
  ) {}

  readPending(workspaceId: string, taskId: string) {
    return this.store.readPending(workspaceId, taskId);
  }

  async submit(
    workspaceId: string,
    taskId: string,
    input: StructuredDecisionInput,
  ) {
    const submitted = structuredDecisionInputSchema.parse(input);
    const target = await this.readTarget(workspaceId, taskId);
    const lateAnswer =
      target?.status === 'resolved' && target.resolvedByCoreTimeout;
    const command = lateAnswer
      ? structuredDecisionInputSchema.parse({
          ...submitted,
          idempotencyKey: `${submitted.questionId}:late_answer`,
        })
      : submitted;
    return this.persistAndDispatch({
      command,
      mode: lateAnswer ? 'late_answer' : 'decision',
      target,
      taskId,
      workspaceId,
    });
  }

  async submitCoreTimeout(
    workspaceId: string,
    taskId: string,
    input: StructuredDecisionInput,
  ) {
    const command = structuredDecisionInputSchema.parse(input);
    if (!command.idempotencyKey.endsWith(':core_timeout')) {
      throw new Error('Core timeout decisions require a :core_timeout suffix.');
    }
    try {
      return await this.persistAndDispatch({
        command,
        mode: 'core_timeout',
        target: await this.readTarget(workspaceId, taskId),
        taskId,
        workspaceId,
      });
    } catch (error) {
      if (
        error instanceof HarnessDecisionError &&
        error.code === 'STALE_QUESTION'
      ) {
        return {
          consumedByOther: true as const,
          eventId: null,
          replayed: true,
        };
      }
      throw error;
    }
  }

  private async persistAndDispatch(input: {
    command: StructuredDecisionInput;
    mode: 'decision' | 'core_timeout' | 'late_answer';
    target: Awaited<ReturnType<HarnessDecisionService['readTarget']>>;
    taskId: string;
    workspaceId: string;
  }) {
    const { command, mode, target, taskId, workspaceId } = input;
    const pending = target?.question ?? null;
    if (
      pending?.questionId === command.questionId &&
      pending.workflowRevision === command.workflowRevision &&
      (pending.response.field !== command.patch.field ||
        pending.response.reason !== command.patch.reason)
    ) {
      throw new HarnessDecisionError(
        'DECISION_TARGET_MISMATCH',
        'The decision target does not match the authoritative question.'
      );
    }
    const payloadFingerprint = fingerprintValue(command);
    const event: HarnessDecisionEvent = {
      id: `event-${taskId}-${command.questionId}-${command.idempotencyKey}`,
      taskId,
      questionId: command.questionId,
      workflowRevision: command.workflowRevision,
      idempotencyKey: command.idempotencyKey,
      payloadFingerprint,
      patch: command.patch,
      decision: command.decision,
    };
    const trace: HarnessDecisionTrace = {
      id: `trace-${event.id}`,
      taskId,
      stage: 'intent_naming',
      kind: 'structured_decision',
      eventId: event.id,
      questionId: command.questionId,
      workflowRevision: command.workflowRevision,
      outcome: command.decision.state,
    };
    const result = await this.store.submit({
      workspaceId,
      taskId,
      command,
      event,
      trace,
      mode,
    });
    if (result.outcome !== 'created' && result.outcome !== 'replayed') {
      throw decisionConflict(result.outcome);
    }
    if (
      result.resumeRequired &&
      (await this.store.claimDecisionResume(
        workspaceId,
        taskId,
        event.id,
      ))
    ) {
      try {
        const persistedCommand = result.command ?? command;
        if (mode === 'late_answer') {
          if (!target?.request || !this.workflow.startSuccessor) {
            throw new Error('Late-answer successor workflow is unavailable.');
          }
          await this.workflow.startSuccessor({
            command: persistedCommand,
            request: target.request,
            sourceTaskId: taskId,
            workflowId: lateAnswerSuccessorWorkflowId(
              taskId,
              persistedCommand.questionId,
            ),
            workspaceId,
          });
        } else {
          await this.workflow.resume(workspaceId, taskId, persistedCommand);
        }
        await this.store.markDecisionResumed(workspaceId, taskId, event.id);
      } catch (error) {
        await this.store.releaseDecisionResume(
          workspaceId,
          taskId,
          event.id,
        );
        throw new HarnessDecisionResumeError({ cause: error });
      }
    }
    return {
      eventId: event.id,
      replayed: result.outcome === 'replayed',
      ...(mode === 'late_answer'
        ? {
            successor: {
              snapshotId: `snapshot-${lateAnswerSuccessorWorkflowId(
                taskId,
                command.questionId,
              )}`,
              workflowId: lateAnswerSuccessorWorkflowId(
                taskId,
                command.questionId,
              ),
            },
          }
        : {}),
    };
  }

  private async readTarget(workspaceId: string, taskId: string) {
    if (this.store.readDecisionTarget) {
      return this.store.readDecisionTarget(workspaceId, taskId);
    }
    const question = await this.store.readPending(workspaceId, taskId, {
      includeResolved: true,
    });
    return question
      ? {
          question,
          request: undefined,
          resolvedByCoreTimeout: false,
          status: 'pending' as const,
        }
      : null;
  }
}

export function lateAnswerSuccessorWorkflowId(
  taskId: string,
  questionId: string,
) {
  const digest = createHash('sha256')
    .update(`${taskId}:${questionId}:late_answer`)
    .digest('hex')
    .slice(0, 24);
  return `composer-task:late-answer-${digest}`;
}

function decisionConflict(
  outcome: 'stale_question' | 'stale_revision' | 'idempotency_conflict'
) {
  switch (outcome) {
    case 'stale_question':
      return new HarnessDecisionError(
        'STALE_QUESTION',
        'The question is no longer the authoritative pending node.'
      );
    case 'stale_revision':
      return new HarnessDecisionError(
        'STALE_WORKFLOW_REVISION',
        'The decision targets a stale workflow revision.'
      );
    case 'idempotency_conflict':
      return new HarnessDecisionError(
        'DECISION_IDEMPOTENCY_CONFLICT',
        'The decision idempotency key was reused with another payload.'
      );
  }
}
