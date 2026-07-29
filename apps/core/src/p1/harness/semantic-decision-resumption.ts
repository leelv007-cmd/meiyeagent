import { createHash } from 'node:crypto';
import type { StructuredDecisionInput } from '@meiye/contracts';

import {
  creationExecutionSnapshotSchema,
  type CreationExecutionSnapshot,
} from '../execution-spine/creation-execution-snapshot.js';
import type { CreationSubmissionRecord } from '../execution-spine/submission-coordinator.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';
import type { HarnessWorkflowInput } from './task-admission.js';
import { authorizeHarnessAction } from './action-registry.js';

export interface HarnessSemanticDecisionResumptionStore {
  claimSemanticDecisionResumption(input: {
    sourceSnapshotId: string;
    workspaceId: string;
    idempotencyKey: string;
    payloadHash: string;
    submission: CreationSubmissionRecord;
  }): Promise<'created' | 'replayed'>;
}

export function buildSemanticDecisionResumption(input: {
  request: HarnessWorkflowInput & {
    executionSnapshot: CreationExecutionSnapshot;
  };
  command: StructuredDecisionInput;
  createdAt: string;
}) {
  if (
    input.request.executionSnapshot.workspaceId !== input.request.workspaceId
  ) {
    throw new Error(
      'Semantic decision resumption workspace does not match its durable snapshot.',
    );
  }
  authorizeHarnessAction({
    actionId: 'workflow.semantic_resubmission',
    caller: 'server',
  });
  if (!input.request.usageReservation) {
    throw new Error(
      'Semantic decision resumption requires explicit product usage units.',
    );
  }
  const value = input.command.decision.value;
  const reference = {
    id: decisionReferenceId(input.request.executionSnapshot.id, input.command),
    field: input.command.patch.field,
    value,
    revision: input.command.workflowRevision,
  };
  const snapshot = creationExecutionSnapshotSchema.parse({
    ...input.request.executionSnapshot,
    id: semanticDecisionSnapshotId(
      input.request.executionSnapshot.id,
      input.command,
    ),
    createdAt: input.createdAt,
    semanticDecision: {
      sourceSnapshotId: input.request.executionSnapshot.id,
      reference,
    },
  });
  const request: HarnessWorkflowInput = {
    ...input.request,
    intent: {
      ...input.request.intent,
      context: {
        ...input.request.intent.context,
        [input.command.patch.field]: value,
        sourceSummaries: [
          ...input.request.intent.context.sourceSummaries.slice(-11),
          `Merchant decision (${input.command.patch.field}): ${value}`,
        ],
      },
    },
    decisionReferences: [
      ...(input.request.decisionReferences ?? []),
      reference,
    ],
    executionSnapshot: snapshot,
  };
  const submission: CreationSubmissionRecord = {
    snapshot,
    task: { id: snapshot.task.id },
    work: { id: snapshot.work.id },
    contentPackage: { ...snapshot.contentPackage },
    usageReservation: structuredClone(input.request.usageReservation),
  };
  const idempotencyKey = `semantic-decision:${input.command.idempotencyKey}`;
  return {
    idempotencyKey,
    payloadHash: fingerprintValue({
      sourceSnapshotId: input.request.executionSnapshot.id,
      reference,
    }),
    request,
    submission,
  };
}

export function buildTerminalSemanticDecisionSuccessor(input: {
  command: StructuredDecisionInput;
  contentPackageId: string;
  createdAt: string;
  quote: { id: string; revision: string };
  sourceSnapshot: CreationExecutionSnapshot;
  workflowId: string;
  workId: string;
}) {
  const command = input.command;
  const reference = {
    id: decisionReferenceId(input.sourceSnapshot.id, command),
    field: command.patch.field,
    value: command.decision.value,
    revision: command.workflowRevision,
  };
  return creationExecutionSnapshotSchema.parse({
    ...input.sourceSnapshot,
    id: `snapshot-${input.workflowId}`,
    createdAt: input.createdAt,
    task: { id: input.workflowId },
    work: { id: input.workId },
    contentPackage: {
      id: input.contentPackageId,
      expectedRevision: 0,
    },
    quote: input.quote,
    semanticDecision: {
      sourceSnapshotId: input.sourceSnapshot.id,
      reference,
    },
  });
}

function decisionReferenceId(
  sourceSnapshotId: string,
  command: StructuredDecisionInput,
) {
  const digest = createHash('sha256')
    .update(`${sourceSnapshotId}:${command.questionId}:${command.idempotencyKey}`)
    .digest('hex')
    .slice(0, 24);
  return `decision-${digest}`;
}

function semanticDecisionSnapshotId(
  sourceSnapshotId: string,
  command: StructuredDecisionInput,
) {
  const digest = createHash('sha256')
    .update(`${sourceSnapshotId}:${command.questionId}:${command.idempotencyKey}`)
    .digest('hex')
    .slice(0, 24);
  return `snapshot-decision-${digest}`;
}
