import {
  structuredDecisionInputSchema,
  type QuestionCard,
  type StructuredDecisionInput,
} from '@meiye/contracts';

import { fingerprintValue } from '../job-runtime/job-contracts.js';

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
  readPending(workspaceId: string, taskId: string): Promise<QuestionCard | null>;
  submit(input: {
    workspaceId: string;
    taskId: string;
    command: StructuredDecisionInput;
    event: HarnessDecisionEvent;
    trace: HarnessDecisionTrace;
  }): Promise<{
    outcome:
      | 'created'
      | 'replayed'
      | 'stale_question'
      | 'stale_revision'
      | 'idempotency_conflict';
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
    const command = structuredDecisionInputSchema.parse(input);
    const pending = await this.store.readPending(workspaceId, taskId);
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
        await this.workflow.resume(workspaceId, taskId, command);
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
    return { eventId: event.id, replayed: result.outcome === 'replayed' };
  }
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
