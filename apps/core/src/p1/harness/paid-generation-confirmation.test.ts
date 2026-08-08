/**
 * Symbol-anchor regression: confirmPaidGenerationExecution + triggersPaidMediaExecution
 * live in paid-generation-confirmation.ts (V31-14 / V3.1 §22.4 / XHS §3.2).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  confirmPaidGenerationExecution,
  triggersPaidMediaExecution,
} from './paid-generation-confirmation.js';
import type { HarnessWorkflowInput } from './task-admission.js';

const here = dirname(fileURLToPath(import.meta.url));

test('symbol anchors exist in paid-generation-confirmation module', () => {
  const source = readFileSync(
    join(here, 'paid-generation-confirmation.ts'),
    'utf8',
  );
  assert.match(source, /export async function confirmPaidGenerationExecution/);
  assert.match(source, /export function triggersPaidMediaExecution/);
  // workflow-core must re-export, not redefine
  const core = readFileSync(join(here, 'workflow-core.ts'), 'utf8');
  assert.match(core, /from '\.\/paid-generation-confirmation\.js'/);
  assert.doesNotMatch(
    core,
    /export function triggersPaidMediaExecution\s*\(/,
  );
});

test('pure copy reservation never triggers paid media gate (D-043)', () => {
  const request = {
    actorId: 'a',
    workspaceId: 'ws',
    packageId: 'p',
    expectedRevision: 0,
    workflowRevision: 1,
    creationMode: 'customized',
    rawInput: 'copy',
    intent: {
      context: { workId: 'w', intent: 'copy', sourceSummaries: [] },
      assetReferences: [],
    },
    executionSnapshot: {
      id: 'snap-1',
      quote: { id: 'q1', revision: 'r1' },
      lens: 'copy',
    },
    usageReservation: {
      id: 'u1',
      units: [{ resource: 'copy', quantity: 1 }],
    },
  } as unknown as HarnessWorkflowInput;
  assert.equal(triggersPaidMediaExecution(request), false);
});

test('image units on any path trigger paid media gate (XHS §3.2)', () => {
  const request = {
    actorId: 'a',
    workspaceId: 'ws',
    packageId: 'p',
    expectedRevision: 0,
    workflowRevision: 1,
    creationMode: 'customized',
    rawInput: 'image',
    intent: {
      context: { workId: 'w', intent: 'image', sourceSummaries: [] },
      assetReferences: [],
    },
    executionSnapshot: {
      id: 'snap-1',
      quote: { id: 'q1', revision: 'r1' },
      lens: 'copy',
    },
    usageReservation: {
      id: 'u1',
      units: [{ resource: 'image', quantity: 1 }],
    },
  } as unknown as HarnessWorkflowInput;
  assert.equal(triggersPaidMediaExecution(request), true);
});

test('confirmPaidGenerationExecution holds until approved', async () => {
  const request = {
    actorId: 'a',
    workspaceId: 'ws',
    packageId: 'p',
    expectedRevision: 0,
    workflowRevision: 1,
    creationMode: 'customized',
    rawInput: 'image',
    intent: {
      context: { workId: 'w', intent: 'image', sourceSummaries: [] },
      assetReferences: [],
    },
    executionSnapshot: {
      id: 'snap-1',
      quote: { id: 'q1', revision: 'r1' },
      lens: 'image',
    },
    usageReservation: {
      id: 'u1',
      units: [{ resource: 'image', quantity: 1 }],
    },
  } as unknown as HarnessWorkflowInput;

  let decisions = 0;
  const out = await confirmPaidGenerationExecution({
    workflowId: 'wf-1',
    request,
    reportProgress: async () => undefined,
    awaitResolvedDecision: async (question) => {
      decisions += 1;
      assert.equal(question.response.field, 'execution_confirmation');
      return {
        questionId: question.questionId,
        workflowRevision: question.workflowRevision,
        idempotencyKey: 'k1',
        patch: { field: 'execution_confirmation', value: 'approved' },
        decision: { state: 'accepted', value: 'approved' },
      } as never;
    },
    applyCurrentTaskDecision: async (_wf, req) => req,
  });
  assert.equal(decisions, 1);
  assert.equal(out.workflowRevision, 1);
});
