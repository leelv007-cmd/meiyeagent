import assert from 'node:assert/strict';
import test from 'node:test';

import type { EvalRun } from '../../contracts/index.js';
import type { RecipeEvidenceReceipt } from './recipe-evidence-ports.js';
import {
  emptyGateView,
  failedCasesFromEvalRun,
  projectRecipeEvidenceGateStatus,
} from './recipe-evidence-status.js';

const NOW = '2026-08-06T12:00:00.000Z';

function receipt(
  overrides: Partial<RecipeEvidenceReceipt> = {},
): RecipeEvidenceReceipt {
  return {
    receiptId: 'rcpt_demo',
    evidenceKind: 'recipe_evaluation',
    runId: 'run-demo',
    recipeId: 'recipe.demo',
    recipeRevision: 2,
    promptRevisionRef: 'prompt.demo@2',
    suiteId: 'recipe-governance',
    suiteRevision: 'recipe-governance@1',
    mode: 'recorded_fixture',
    passed: true,
    issuerId: 'system.recipe-eval-issuer',
    issuedAt: '2026-08-01T12:00:00.000Z',
    expiresAt: '2026-09-01T12:00:00.000Z',
    ...overrides,
  };
}

function failingRun(): EvalRun {
  return {
    schemaVersion: 'eval-run/v1',
    runId: 'run-failed',
    suiteId: 'recipe-governance',
    suiteRevision: 'recipe-governance@1',
    mode: 'recorded_fixture',
    createdAt: NOW,
    passed: false,
    results: [
      {
        caseId: 'case-ok',
        gateId: 'g1',
        promptRevision: 'prompt.demo@2',
        scorerRevision: 's@1',
        passed: true,
        reason: 'ok',
        memoryDiff: null,
      },
      {
        caseId: 'case-fail-redline',
        gateId: 'g2',
        promptRevision: 'prompt.demo@2',
        scorerRevision: 's@1',
        passed: false,
        reason: 'invented critical fact',
        memoryDiff: null,
      },
    ],
  };
}

test('projectRecipeEvidenceGateStatus: none when no receipts', () => {
  const view = projectRecipeEvidenceGateStatus({
    evidenceKind: 'recipe_evaluation',
    receipts: [],
    currentPromptRevisionRef: 'prompt.demo@2',
    now: () => NOW,
  });
  assert.equal(view.status, 'none');
  assert.equal(view.receiptId, null);
  assert.deepEqual(view.failedCases, []);
});

test('projectRecipeEvidenceGateStatus: expired when past expiresAt', () => {
  const view = projectRecipeEvidenceGateStatus({
    evidenceKind: 'recipe_evaluation',
    receipts: [
      receipt({
        expiresAt: '2026-08-05T12:00:00.000Z',
        receiptId: 'rcpt_expired',
      }),
    ],
    currentPromptRevisionRef: 'prompt.demo@2',
    now: () => NOW,
  });
  assert.equal(view.status, 'expired');
  assert.equal(view.receiptId, 'rcpt_expired');
});

test('projectRecipeEvidenceGateStatus: prompt_mismatch when Prompt differs', () => {
  const view = projectRecipeEvidenceGateStatus({
    evidenceKind: 'recipe_internal_test',
    receipts: [
      receipt({
        evidenceKind: 'recipe_internal_test',
        promptRevisionRef: 'prompt.old@1',
        receiptId: 'rcpt_prompt',
      }),
    ],
    currentPromptRevisionRef: 'prompt.demo@2',
    now: () => NOW,
  });
  assert.equal(view.status, 'prompt_mismatch');
  assert.equal(view.receiptId, 'rcpt_prompt');
  assert.equal(view.promptRevisionRef, 'prompt.old@1');
});

test('projectRecipeEvidenceGateStatus: ready when unexpired matching passed receipt', () => {
  const view = projectRecipeEvidenceGateStatus({
    evidenceKind: 'recipe_evaluation',
    receipts: [receipt({ receiptId: 'rcpt_ready', passed: true })],
    currentPromptRevisionRef: 'prompt.demo@2',
    now: () => NOW,
  });
  assert.equal(view.status, 'ready');
  assert.equal(view.receiptId, 'rcpt_ready');
  assert.equal(view.passed, true);
});

test('projectRecipeEvidenceGateStatus: failed run is none with failedCases visible', () => {
  const run = failingRun();
  const view = projectRecipeEvidenceGateStatus({
    evidenceKind: 'recipe_evaluation',
    receipts: [
      receipt({
        receiptId: 'rcpt_fail',
        runId: run.runId,
        passed: false,
      }),
    ],
    currentPromptRevisionRef: 'prompt.demo@2',
    evalRun: run,
    now: () => NOW,
  });
  assert.equal(view.status, 'none');
  assert.equal(view.receiptId, 'rcpt_fail');
  assert.deepEqual(view.failedCases, [
    { caseId: 'case-fail-redline', reason: 'invented critical fact' },
  ]);
});

test('failedCasesFromEvalRun extracts only failing cases', () => {
  assert.deepEqual(failedCasesFromEvalRun(failingRun()), [
    { caseId: 'case-fail-redline', reason: 'invented critical fact' },
  ]);
  assert.deepEqual(failedCasesFromEvalRun(null), []);
});

test('emptyGateView is none with empty fields', () => {
  const view = emptyGateView('recipe_internal_test');
  assert.equal(view.evidenceKind, 'recipe_internal_test');
  assert.equal(view.status, 'none');
  assert.equal(view.receiptId, null);
});

test('prompt_mismatch takes priority over expiry on the latest receipt', () => {
  const view = projectRecipeEvidenceGateStatus({
    evidenceKind: 'recipe_evaluation',
    receipts: [
      receipt({
        promptRevisionRef: 'prompt.other@9',
        expiresAt: '2026-08-01T00:00:00.000Z',
        receiptId: 'rcpt_both',
      }),
    ],
    currentPromptRevisionRef: 'prompt.demo@2',
    now: () => NOW,
  });
  assert.equal(view.status, 'prompt_mismatch');
});
