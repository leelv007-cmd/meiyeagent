import assert from 'node:assert/strict';
import test from 'node:test';

import type { QuestionCard } from '@meiye/contracts';

import type { P1Context } from '../foundation/domain.js';
import type { HarnessWorkflowInput } from '../harness/task-admission.js';
import { P1HarnessAskInvoker } from './p1-harness-ask-invoker.js';

const question: QuestionCard = {
  freeText: { enabled: true },
  options: [
    {
      description: 'Use the currently verified offer.',
      id: 'current-offer',
      label: 'Current offer',
    },
  ],
  question: 'Which offer should lead?',
  questionId: 'workflow-ask:offer',
  response: {
    field: 'offer',
    reason: 'The offer must be merchant-confirmed.',
  },
  scope: 'current_task',
  unattended: 'hold',
  workflowId: 'workflow-ask',
  workflowRevision: 3,
};

function request(): HarnessWorkflowInput {
  return {
    actorId: 'worker-ask',
    packageId: 'package-ask',
    expectedRevision: 0,
    creationMode: 'customized',
    rawInput: 'Create merchant-confirmed copy.',
    intent: {
      context: {
        workId: 'work-ask',
        intent: 'Create merchant-confirmed copy.',
        sourceSummaries: [],
      },
      assetReferences: [],
    },
    workspaceId: 'workspace-ask',
    workflowRevision: 3,
    executionAssembly: {
      schemaVersion: 'harness-execution-assembly/v1',
      workflowId: 'workflow-ask',
      skillStages: {
        intent_naming: [],
        context_injection: [],
        brief_compilation: [],
        execution_selection: [],
        assembly_delivery: [],
      },
      frozenRouteSnapshotDigest: 'no-copy-route',
      promptRevisionRefs: {},
      rootAxes: {
        axisScope: 'task_root',
        skillRevision: { kind: 'absent' },
        promptVersion: { kind: 'absent' },
        catalogRevision: { kind: 'absent' },
        scene: { kind: 'bound', value: 'harness:copy' },
      },
    },
  };
}

test('ask invoker carries the canonical card and frozen child axes through P1', async () => {
  const calls: unknown[] = [];
  const invoker = new P1HarnessAskInvoker(
    {
      async executeModule<
        TInput extends Record<string, unknown>,
        TOutput
      >(
        context: P1Context,
        name: string,
        input: TInput,
        idempotencyKey: string,
      ): Promise<TOutput> {
        calls.push({ context, idempotencyKey, input, name });
        return {
          requestRef: question.questionId,
          status: 'requested',
        } as TOutput;
      },
    },
    'worker-harness-ask',
  );
  const idempotencyKey = 'harness-ask-merchant:workflow-ask:offer';

  await invoker.invoke({
    idempotencyKey,
    question,
    request: request(),
    stage: 'intent_naming',
    workspaceId: 'workspace-ask',
  });

  assert.deepEqual(calls, [
    {
      context: {
        actor: 'worker',
        correlationId: idempotencyKey,
        userId: 'worker-harness-ask',
        workspaceId: 'workspace-ask',
      },
      idempotencyKey,
      input: {
        action: 'execute',
        payload: {
          harness: {
            question,
            stage: 'intent_naming',
          },
          modelInput: {
            question: question.question,
            options: [
              {
                label: 'Current offer',
              },
            ],
          },
          observability: {
            axisScope: 'execution_child',
            skillRevision: { kind: 'absent' },
            promptVersion: { kind: 'absent' },
            catalogRevision: { kind: 'absent' },
            scene: { kind: 'bound', value: 'harness:copy' },
          },
          primitiveId: 'ask_merchant',
          taskId: 'workflow-ask',
        },
      },
      name: 'agent-primitives',
    },
  ]);
});

test('ask invoker rejects a workspace mismatch before P1', async () => {
  let calls = 0;
  const invoker = new P1HarnessAskInvoker(
    {
      async executeModule<
        TInput extends Record<string, unknown>,
        TOutput
      >() {
        calls += 1;
        return undefined as TOutput;
      },
    },
    'worker-harness-ask',
  );

  await assert.rejects(
    invoker.invoke({
      idempotencyKey: 'ask-mismatch',
      question,
      request: request(),
      stage: 'intent_naming',
      workspaceId: 'workspace-forged',
    }),
    /workspace does not match/u,
  );
  assert.equal(calls, 0);
});
