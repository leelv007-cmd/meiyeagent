import { DBOS } from '@dbos-inc/dbos-sdk';
import {
  structuredDecisionInputSchema,
  workflowProgressEnvelopeSchema,
  workflowTokenEnvelopeSchema,
  type QuestionCard,
  type StructuredDecisionInput,
} from '@meiye/contracts';

import {
  runHarnessWorkflow,
  type HarnessStagePorts,
  type HarnessWorkflowRuntime,
} from './workflow-core.js';
import type {
  HarnessWorkflowInput,
  HarnessWorkflowStarter,
} from './task-admission.js';
import type { HarnessDecisionStore } from './decision-service.js';
import { normalizeHarnessTerminalFailure } from './terminal-failure.js';
import { harnessRuntimeId } from './workspace-scope.js';
import {
  buildSemanticDecisionResumption,
  type HarnessSemanticDecisionResumptionStore,
} from './semantic-decision-resumption.js';

export interface HarnessWorkflowPersistence {
  registerPending: HarnessDecisionStore['registerPending'];
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

export interface HarnessBillingSettlementPort {
  commit(input: { workspaceId: string; taskId: string }): Promise<void>;
  refund(input: { workspaceId: string; taskId: string }): Promise<void>;
}

const PROGRESS_STREAM = 'progress';
const DECISION_TIMEOUT_SECONDS = 48 * 60 * 60;

export function registerHarnessDbosWorkflow(
  ports: HarnessStagePorts,
  persistence: HarnessWorkflowPersistence,
  semanticResumptions?: HarnessSemanticDecisionResumptionStore,
  billing?: HarnessBillingSettlementPort,
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
      async awaitDecision(question) {
        await DBOS.runStep(
          () => persistence.registerPending(request.workspaceId, question),
          { name: `persist-pending-${question.questionId}` },
        );
        await DBOS.setEvent('pending-structured-decision', question);
        const decision = await DBOS.recv<StructuredDecisionInput>(
          decisionTopic(question.questionId),
          { timeoutSeconds: DECISION_TIMEOUT_SECONDS },
        );
        return assertMatchingDecision(question, decision);
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
        if (billing) {
          await DBOS.runStep(
            () =>
              billing.refund({
                workspaceId: request.workspaceId,
                taskId: workflowId,
              }),
            { name: 'refund-product-usage' },
          );
        }
        await DBOS.runStep(
          () =>
            persistence.recordTerminalFailure({
              workspaceId: request.workspaceId,
              workflowId,
              failure: normalizeHarnessTerminalFailure(error),
            }),
          { name: 'persist-terminal-failure' },
        );
        throw error;
      }
      if (billing) {
        await DBOS.runStep(
          () =>
            billing.commit({
              workspaceId: request.workspaceId,
              taskId: workflowId,
            }),
          { name: 'commit-product-usage' },
        );
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

export function normalizeHarnessDbosWorkflowInput(
  input: HarnessDbosWorkflowInput,
  runtimeWorkflowId: string,
) {
  return 'request' in input
    ? input
    : { workflowId: runtimeWorkflowId, request: input };
}

function assertMatchingDecision(
  question: QuestionCard,
  decision: StructuredDecisionInput | null,
) {
  if (!decision) throw new Error('Structured decision timed out.');
  const parsed = structuredDecisionInputSchema.parse(decision);
  if (parsed.questionId !== question.questionId) {
    throw new Error('Structured decision does not match the pending question.');
  }
  if (parsed.workflowRevision !== question.workflowRevision) {
    throw new Error('Structured decision targets a stale workflow revision.');
  }
  return parsed;
}

function decisionTopic(questionId: string) {
  return `structured-decision:${questionId}`;
}
