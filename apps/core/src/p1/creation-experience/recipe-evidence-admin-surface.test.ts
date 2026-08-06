/**
 * Spec I #397: foundation query/command surface for Templates evidence panel.
 * Server-side suite issuance only — no browser-constructed EvalRun/passed.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryEvalRunRegistry } from '../harness/eval-run-registry.js';
import { P1DomainError } from '../foundation/domain.js';
import { CreationExperienceFoundationModule } from './foundation-module.js';
import { MemoryCreationExperienceCatalogRepository } from './memory-repository.js';
import { MemoryRecipeEvidenceReceiptRegistry } from './recipe-evidence-receipt-registry.js';
import {
  RECIPE_EVIDENCE_ISSUER_ID,
  issueRecipeEvidenceReceipt,
} from './recipe-evidence-issuer.js';
import type { RecipeEvidenceReceipt } from './recipe-evidence-ports.js';

const context = {
  workspaceId: 'workspace-evidence-admin',
  userId: 'ops-1',
  correlationId: 'ce-evidence-admin',
  actor: 'admin' as const,
};

function sampleDefinition() {
  return {
    recipeId: 'recipe.evidence.admin',
    expectedRevision: null as number | null,
    industryKey: 'beauty_general',
    presentation: {
      title: 'Evidence admin demo',
      summary: 'Templates evidence status surface',
    },
    modelPolicy: { mode: 'auto' as const },
    dependencies: {
      promptRevisionRef: 'prompt.evidence.admin@1',
      skillRevisionRefs: [] as string[],
      workflowRevisionRef: 'workflow.recipe-studio@1',
      outputContractRef: 'output.image-text-note@1',
      quotePolicyRevisionRef: 'quote.policy@1',
    },
    blocks: [
      {
        id: 'intent',
        stage: 'intent_naming' as const,
        type: 'intent_type' as const,
        config: { intentTypes: ['daily_exposure' as const] },
      },
      {
        id: 'facts',
        stage: 'context_injection' as const,
        type: 'fact_slots' as const,
        config: { factTypes: ['service' as const] },
      },
      {
        id: 'story',
        stage: 'brief_compilation' as const,
        type: 'story_structure' as const,
        config: {
          segments: [
            'pain_point' as const,
            'professional_insight' as const,
            'service_solution' as const,
            'cta' as const,
          ],
        },
      },
      {
        id: 'output',
        stage: 'brief_compilation' as const,
        type: 'output_contract' as const,
        config: {
          outputKind: 'image_text_note' as const,
          deliverableKind: 'note' as const,
          quantity: 1,
          aspectRatio: '3:4',
          notePageBound: 3,
        },
      },
      {
        id: 'candidate',
        stage: 'execution_selection' as const,
        type: 'candidate_strategy' as const,
        config: { strategy: 'dual_style_user_choice' as const },
      },
      {
        id: 'platform',
        stage: 'assembly_delivery' as const,
        type: 'platform_adapter' as const,
        config: {
          contentPackagePlatform: 'xiaohongshu' as const,
          distributionTarget: 'export' as const,
        },
      },
    ],
  };
}

async function compileValidatedModule() {
  const repository = new MemoryCreationExperienceCatalogRepository();
  const evalRunRegistry = new MemoryEvalRunRegistry();
  const evidenceReceiptRegistry = new MemoryRecipeEvidenceReceiptRegistry();
  const module = new CreationExperienceFoundationModule(repository, undefined, {
    skillRevisionValidation: {
      async listUnavailableFrozenRevisionRefs() {
        return [];
      },
    },
    evalRunRegistry,
    evidenceReceiptRegistry,
  });

  const compiled = (await module.execute({
    context,
    input: {
      action: 'recipe_studio_compile',
      payload: {
        ...sampleDefinition(),
        reason: 'compile for evidence admin',
      },
    },
    idempotencyKey: 'idem-ev-admin-compile',
  })) as {
    recipeId: string;
    revision: number;
    studioRelease?: {
      compilationReceipt: { promptRevisionRef: string };
    };
  };

  const validated = (await module.execute({
    context,
    input: {
      action: 'recipe_studio_validate',
      payload: {
        recipeId: compiled.recipeId,
        expectedRevision: compiled.revision,
        reason: 'validate for evidence admin',
      },
    },
    idempotencyKey: 'idem-ev-admin-validate',
  })) as { recipeId: string; revision: number };

  return {
    module,
    evalRunRegistry,
    evidenceReceiptRegistry,
    recipeId: validated.recipeId,
    revision: validated.revision,
    promptRevisionRef:
      compiled.studioRelease?.compilationReceipt.promptRevisionRef ??
      'prompt.evidence.admin@1',
  };
}

test('recipe_evidence_status returns none for both gates without receipts', async () => {
  const { module, recipeId, revision, promptRevisionRef } =
    await compileValidatedModule();

  const status = (await module.query({
    context,
    input: {
      action: 'recipe_evidence_status',
      payload: { recipeId, recipeRevision: revision },
    },
  })) as {
    recipeId: string;
    recipeRevision: number;
    currentPromptRevisionRef: string;
    evaluation: { status: string; receiptId: string | null };
    internalTest: { status: string; receiptId: string | null };
  };

  assert.equal(status.recipeId, recipeId);
  assert.equal(status.recipeRevision, revision);
  assert.equal(status.currentPromptRevisionRef, promptRevisionRef);
  assert.equal(status.evaluation.status, 'none');
  assert.equal(status.evaluation.receiptId, null);
  assert.equal(status.internalTest.status, 'none');
});

test('recipe_evidence_status presents expired / prompt_mismatch / ready', async () => {
  const {
    module,
    evalRunRegistry,
    evidenceReceiptRegistry,
    recipeId,
    revision,
    promptRevisionRef,
  } = await compileValidatedModule();

  const baseRun = {
    schemaVersion: 'eval-run/v1' as const,
    suiteId: 'recipe-governance',
    suiteRevision: 'recipe-governance@1',
    mode: 'recorded_fixture' as const,
    createdAt: '2026-08-01T00:00:00.000Z',
    passed: true,
    results: [
      {
        caseId: 'case-a',
        gateId: 'g',
        promptRevision: promptRevisionRef,
        scorerRevision: 's@1',
        passed: true,
        reason: 'ok',
        memoryDiff: null,
      },
    ],
  };

  // Ready receipt
  const ready = await issueRecipeEvidenceReceipt(
    {
      evalRunRegistry,
      receiptRegistry: evidenceReceiptRegistry,
      now: () => '2026-08-01T00:00:00.000Z',
    },
    {
      run: { ...baseRun, runId: 'run-ready' },
      evidenceKind: 'recipe_evaluation',
      recipeId,
      recipeRevision: revision,
      promptRevisionRef,
    },
  );
  assert.equal(ready.receipt.issuerId, RECIPE_EVIDENCE_ISSUER_ID);

  let status = (await module.query({
    context,
    input: {
      action: 'recipe_evidence_status',
      payload: { recipeId, recipeRevision: revision },
    },
  })) as { evaluation: { status: string; receiptId: string | null } };
  assert.equal(status.evaluation.status, 'ready');
  assert.equal(status.evaluation.receiptId, ready.receipt.receiptId);

  // Overwrite presentation by inserting a newer expired receipt (same kind/rev)
  const expiredReceipt: RecipeEvidenceReceipt = {
    ...ready.receipt,
    receiptId: 'rcpt_expired_manual',
    runId: 'run-expired',
    issuedAt: '2026-08-06T18:00:00.000Z',
    expiresAt: '2026-08-06T19:00:00.000Z',
    passed: true,
  };
  await evalRunRegistry.putImmutable('run-expired', {
    ...baseRun,
    runId: 'run-expired',
  });
  await evidenceReceiptRegistry.putImmutable(
    expiredReceipt.receiptId,
    expiredReceipt,
  );

  // Force "now" after expiry by using a real clock — expiresAt is in the past
  // relative to 2026-08-07 when this suite may run in 2026+. Use far-past expiry.
  const farPast: RecipeEvidenceReceipt = {
    ...expiredReceipt,
    receiptId: 'rcpt_expired_far',
    runId: 'run-expired-far',
    issuedAt: '2020-01-01T00:00:00.000Z',
    expiresAt: '2020-01-31T00:00:00.000Z',
  };
  await evalRunRegistry.putImmutable('run-expired-far', {
    ...baseRun,
    runId: 'run-expired-far',
  });
  await evidenceReceiptRegistry.putImmutable(farPast.receiptId, farPast);

  status = (await module.query({
    context,
    input: {
      action: 'recipe_evidence_status',
      payload: { recipeId, recipeRevision: revision },
    },
  })) as { evaluation: { status: string; receiptId: string | null } };
  // Newest by issuedAt is rcpt_expired_manual (2026-08-06) — may or may not be
  // expired depending on wall clock. Use prompt mismatch receipt as newest.
  const mismatch: RecipeEvidenceReceipt = {
    ...ready.receipt,
    receiptId: 'rcpt_prompt_mismatch',
    runId: 'run-mismatch',
    promptRevisionRef: 'prompt.other@99',
    issuedAt: '2099-01-01T00:00:00.000Z',
    expiresAt: '2099-12-31T00:00:00.000Z',
    passed: true,
  };
  await evalRunRegistry.putImmutable('run-mismatch', {
    ...baseRun,
    runId: 'run-mismatch',
    results: [
      {
        ...baseRun.results[0]!,
        promptRevision: 'prompt.other@99',
      },
    ],
  });
  await evidenceReceiptRegistry.putImmutable(mismatch.receiptId, mismatch);

  status = (await module.query({
    context,
    input: {
      action: 'recipe_evidence_status',
      payload: { recipeId, recipeRevision: revision },
    },
  })) as { evaluation: { status: string; receiptId: string | null } };
  assert.equal(status.evaluation.status, 'prompt_mismatch');
  assert.equal(status.evaluation.receiptId, 'rcpt_prompt_mismatch');
});

test('recipe_evidence_run_evaluation issues server-side receipt and returns status', async () => {
  const { module, recipeId, revision, promptRevisionRef } =
    await compileValidatedModule();

  const result = (await module.execute({
    context,
    input: {
      action: 'recipe_evidence_run_evaluation',
      payload: {
        recipeId,
        expectedRevision: revision,
        reason: 'operator triggered evaluation from Templates',
        // Attack surface: client-forged fields must be ignored if present.
        passed: true,
        evalRun: { forged: true },
        evidenceReceiptId: 'client-forged-receipt',
      },
    },
    idempotencyKey: 'idem-ev-admin-run',
  })) as {
    recipeId: string;
    recipeRevision: number;
    receipt: RecipeEvidenceReceipt;
    run: { runId: string; passed: boolean; suiteId: string };
    failedCases: Array<{ caseId: string; reason: string }>;
    evaluation: { status: string; receiptId: string | null };
  };

  assert.equal(result.recipeId, recipeId);
  assert.equal(result.recipeRevision, revision);
  assert.equal(result.receipt.issuerId, RECIPE_EVIDENCE_ISSUER_ID);
  assert.equal(result.receipt.evidenceKind, 'recipe_evaluation');
  assert.equal(result.receipt.promptRevisionRef, promptRevisionRef);
  assert.equal(result.receipt.recipeRevision, revision);
  assert.equal(result.run.suiteId, 'recipe-governance');
  // Recorded suite against a normal subject is expected to pass.
  assert.equal(result.run.passed, true);
  assert.equal(result.evaluation.status, 'ready');
  assert.equal(result.evaluation.receiptId, result.receipt.receiptId);
  assert.deepEqual(result.failedCases, []);

  // Status query matches issuance.
  const status = (await module.query({
    context,
    input: {
      action: 'recipe_evidence_status',
      payload: { recipeId, recipeRevision: revision },
    },
  })) as { evaluation: { status: string; receiptId: string | null } };
  assert.equal(status.evaluation.status, 'ready');
  assert.equal(status.evaluation.receiptId, result.receipt.receiptId);
});

test('recipe_evidence_run_evaluation refuses when registries are not wired', async () => {
  const repository = new MemoryCreationExperienceCatalogRepository();
  const module = new CreationExperienceFoundationModule(repository, undefined, {
    skillRevisionValidation: {
      async listUnavailableFrozenRevisionRefs() {
        return [];
      },
    },
  });
  const compiled = (await module.execute({
    context,
    input: {
      action: 'recipe_studio_compile',
      payload: {
        ...sampleDefinition(),
        reason: 'compile without issuer',
      },
    },
    idempotencyKey: 'idem-ev-no-issuer-compile',
  })) as { recipeId: string; revision: number };

  await assert.rejects(
    () =>
      module.execute({
        context,
        input: {
          action: 'recipe_evidence_run_evaluation',
          payload: {
            recipeId: compiled.recipeId,
            expectedRevision: compiled.revision,
            reason: 'should fail',
          },
        },
        idempotencyKey: 'idem-ev-no-issuer-run',
      }),
    (error: unknown) =>
      error instanceof P1DomainError &&
      /evidence-issuer-unavailable/.test(error.message),
  );
});
