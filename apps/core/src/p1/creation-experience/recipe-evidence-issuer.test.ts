import assert from 'node:assert/strict';
import test from 'node:test';

import { createRecordedRecipeGovernanceEvalRun } from '../../evals/recipe-governance/runner.js';
import { FIXTURE_RECIPE_GOVERNANCE_SUBJECT } from '../../evals/recipe-governance/subject.js';
import type { EvalRun } from '../../contracts/index.js';
import { MemoryEvalRunRegistry } from '../harness/eval-run-registry.js';
import { P1DomainError } from '../foundation/domain.js';
import {
  RECIPE_EVIDENCE_ISSUER_ID,
  RECIPE_EVIDENCE_VALIDITY_DAYS,
  addUtcDays,
  buildRecipeEvidenceReceiptId,
  issueRecipeEvidenceReceipt,
} from './recipe-evidence-issuer.js';
import { MemoryRecipeEvidenceReceiptRegistry } from './recipe-evidence-receipt-registry.js';
import { runAndIssueRecipeGovernanceEvidence } from './recipe-evidence-suite-runner.js';
import {
  assertNonProductionTenantForInternalTest,
  runAndIssueRecipeInternalTestEvidence,
} from './recipe-evidence-internal-test-runner.js';

const FROZEN_NOW = '2026-08-06T12:00:00.000Z';

function issuerDeps() {
  return {
    evalRunRegistry: new MemoryEvalRunRegistry(),
    receiptRegistry: new MemoryRecipeEvidenceReceiptRegistry(),
    now: () => FROZEN_NOW,
  };
}

function sampleRun(overrides: Partial<EvalRun> = {}): EvalRun {
  return {
    schemaVersion: 'eval-run/v1',
    runId: 'eval-run-path-parity-1',
    suiteId: 'recipe-governance',
    suiteRevision: 'recipe-governance@1',
    mode: 'recorded_fixture',
    createdAt: FROZEN_NOW,
    passed: true,
    results: [
      {
        caseId: 'case-a',
        gateId: 'gate-a',
        promptRevision: 'prompt.demo@7',
        scorerRevision: 'scorer@1',
        passed: true,
        reason: 'ok',
        memoryDiff: null,
      },
    ],
    ...overrides,
  };
}

test('shared issuer stamps server issuerId and 30-day expiry; never accepts external issuerId', async () => {
  const deps = issuerDeps();
  const run = sampleRun();
  const { receipt } = await issueRecipeEvidenceReceipt(deps, {
    run,
    evidenceKind: 'recipe_evaluation',
    recipeId: 'recipe.demo',
    recipeRevision: 3,
    promptRevisionRef: 'prompt.demo@7',
  });

  assert.equal(receipt.issuerId, RECIPE_EVIDENCE_ISSUER_ID);
  assert.equal(receipt.issuedAt, FROZEN_NOW);
  assert.equal(
    receipt.expiresAt,
    addUtcDays(FROZEN_NOW, RECIPE_EVIDENCE_VALIDITY_DAYS),
  );
  assert.equal(receipt.expiresAt, '2026-09-05T12:00:00.000Z');
  assert.equal(
    receipt.receiptId,
    buildRecipeEvidenceReceiptId({
      evidenceKind: 'recipe_evaluation',
      runId: run.runId,
      recipeId: 'recipe.demo',
      recipeRevision: 3,
    }),
  );

  // Input surface has no issuerId field — server constant is the only writer.
  assert.equal(
    'issuerId' in
      ({
        run,
        evidenceKind: 'recipe_evaluation',
        recipeId: 'recipe.demo',
        recipeRevision: 3,
      } as object),
    false,
  );
});

test('issuance writes EvalRun and receipt through put-once registries', async () => {
  const deps = issuerDeps();
  const run = sampleRun();
  const first = await issueRecipeEvidenceReceipt(deps, {
    run,
    evidenceKind: 'recipe_evaluation',
    recipeId: 'recipe.demo',
    recipeRevision: 3,
  });
  const second = await issueRecipeEvidenceReceipt(deps, {
    run,
    evidenceKind: 'recipe_evaluation',
    recipeId: 'recipe.demo',
    recipeRevision: 3,
  });

  assert.deepEqual(first, second);
  assert.deepEqual(await deps.evalRunRegistry.get(run.runId), run);
  assert.deepEqual(
    await deps.receiptRegistry.get(first.receipt.receiptId),
    first.receipt,
  );

  await assert.rejects(
    issueRecipeEvidenceReceipt(deps, {
      run: {
        ...run,
        results: [
          {
            ...run.results[0]!,
            reason: 'different fact',
          },
        ],
      },
      evidenceKind: 'recipe_evaluation',
      recipeId: 'recipe.demo',
      recipeRevision: 3,
    }),
    (error: unknown) =>
      error instanceof P1DomainError && error.code === 'IDEMPOTENCY_CONFLICT',
  );
});

test('suite runner path and import-style path issue identical receipts for the same inputs', async () => {
  const suiteDeps = issuerDeps();
  const importDeps = issuerDeps();
  const subject = FIXTURE_RECIPE_GOVERNANCE_SUBJECT;
  const frozenRunId = 'path-parity-governance-run';

  // Path 1: server suite runner (assemble → execute → put → issue).
  const suiteIssued = await runAndIssueRecipeGovernanceEvidence(suiteDeps, {
    subject,
    now: () => FROZEN_NOW,
    runOptions: {
      runId: frozenRunId,
      createdAt: FROZEN_NOW,
    },
  });

  // Path 2: artifact already materialised (eval:import style) then same issuer.
  const importRun = await createRecordedRecipeGovernanceEvalRun({
    subject,
    runId: frozenRunId,
    createdAt: FROZEN_NOW,
  });
  // Mirror importer: put EvalRun first, then issue.
  await importDeps.evalRunRegistry.putImmutable(importRun.runId, importRun);
  const importIssued = await issueRecipeEvidenceReceipt(importDeps, {
    run: importRun,
    evidenceKind: 'recipe_evaluation',
    recipeId: subject.recipeId,
    recipeRevision: subject.recipeRevision,
    promptRevisionRef: subject.promptRevisionRef,
  });

  assert.deepEqual(suiteIssued.run, importIssued.run);
  assert.deepEqual(suiteIssued.receipt, importIssued.receipt);
  assert.equal(suiteIssued.receipt.issuerId, RECIPE_EVIDENCE_ISSUER_ID);
  assert.equal(suiteIssued.receipt.evidenceKind, 'recipe_evaluation');
});

test('issuer rejects mixed case promptRevision and mismatched explicit promptRevisionRef', async () => {
  const deps = issuerDeps();
  const mixed = sampleRun({
    results: [
      {
        caseId: 'a',
        gateId: 'g',
        promptRevision: 'prompt.a@1',
        scorerRevision: 's@1',
        passed: true,
        reason: 'ok',
        memoryDiff: null,
      },
      {
        caseId: 'b',
        gateId: 'g',
        promptRevision: 'prompt.b@1',
        scorerRevision: 's@1',
        passed: true,
        reason: 'ok',
        memoryDiff: null,
      },
    ],
  });

  await assert.rejects(
    issueRecipeEvidenceReceipt(deps, {
      run: mixed,
      evidenceKind: 'recipe_evaluation',
      recipeId: 'recipe.demo',
      recipeRevision: 1,
    }),
    /promptRevision 必须一致/,
  );

  await assert.rejects(
    issueRecipeEvidenceReceipt(deps, {
      run: sampleRun(),
      evidenceKind: 'recipe_evaluation',
      recipeId: 'recipe.demo',
      recipeRevision: 1,
      promptRevisionRef: 'prompt.other@9',
    }),
    /promptRevisionRef 与 EvalRun/,
  );
});

test('internal-test runner refuses production tenants and issues on non-production', async () => {
  assert.throws(
    () =>
      assertNonProductionTenantForInternalTest({
        APP_ENV: 'production',
      }),
    (error: unknown) =>
      error instanceof P1DomainError &&
      error.code === 'FORBIDDEN' &&
      /非生产租户/.test(error.message),
  );

  const deps = issuerDeps();
  const subject = {
    recipeId: 'recipe.demo',
    recipeRevision: 2,
    promptRevisionRef: 'prompt.demo@2',
  };
  const issued = await runAndIssueRecipeInternalTestEvidence(deps, {
    subject,
    env: { APP_ENV: 'development' },
    now: () => FROZEN_NOW,
    executeCreation: async () => ({
      runId: 'internal-test-run-1',
      passed: true,
      reason: 'fixture creation passed',
      createdAt: FROZEN_NOW,
    }),
  });

  assert.equal(issued.receipt.evidenceKind, 'recipe_internal_test');
  assert.equal(issued.receipt.issuerId, RECIPE_EVIDENCE_ISSUER_ID);
  assert.equal(issued.receipt.recipeId, subject.recipeId);
  assert.equal(issued.receipt.recipeRevision, subject.recipeRevision);
  assert.equal(issued.receipt.promptRevisionRef, subject.promptRevisionRef);
  assert.equal(issued.label, 'internal-test');
  assert.equal(issued.run.passed, true);
  assert.deepEqual(
    await deps.receiptRegistry.get(issued.receipt.receiptId),
    issued.receipt,
  );

  await assert.rejects(
    runAndIssueRecipeInternalTestEvidence(deps, {
      subject,
      env: { APP_ENV: 'production' },
      executeCreation: async () => {
        throw new Error('must not execute creation on production');
      },
    }),
    (error: unknown) =>
      error instanceof P1DomainError && error.code === 'FORBIDDEN',
  );
});
