/**
 * Spec I #396: registry-backed redeem adapters — negative matrix, anti-forgery,
 * end-to-end four-gate chain, and Langfuse isolation.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { EvalRun } from '../../contracts/index.js';
import { MemoryEvalRunRegistry } from '../harness/eval-run-registry.js';
import { P1DomainError } from '../foundation/domain.js';
import { CreationExperienceCatalogService } from './catalog-service.js';
import {
  LAUNCH_SURFACE_ID,
  publishLaunchCatalog,
} from './launch-seeds.js';
import { MemoryCreationExperienceCatalogRepository } from './memory-repository.js';
import {
  RECIPE_EVIDENCE_ISSUER_ID,
  issueRecipeEvidenceReceipt,
  issueRecipeEvidenceReceiptWithObservability,
} from './recipe-evidence-issuer.js';
import {
  RECIPE_EVIDENCE_REDEEM_ERRORS,
  createRegistryBackedRecipeEvidencePorts,
  redeemEvidenceReceipt,
} from './recipe-evidence-redeem.js';
import { MemoryRecipeEvidenceReceiptRegistry } from './recipe-evidence-receipt-registry.js';
import type { RecipeEvidenceReceipt } from './recipe-evidence-ports.js';
import {
  RecipeStudioService,
  type RecipeStudioCompileInput,
} from './recipe-studio.js';
import { runAndIssueRecipeGovernanceEvidence } from './recipe-evidence-suite-runner.js';
import { runAndIssueRecipeInternalTestEvidence } from './recipe-evidence-internal-test-runner.js';

const FROZEN_NOW = '2026-08-06T12:00:00.000Z';
const PROMPT_REF = 'prompt.hair-care-education@12';
const RECIPE_ID = 'recipe.hair-care.education';

function sampleEvalRun(overrides: Partial<EvalRun> = {}): EvalRun {
  return {
    schemaVersion: 'eval-run/v1',
    runId: 'eval-run-redeem-1',
    suiteId: 'recipe-governance',
    suiteRevision: 'recipe-governance@1',
    mode: 'recorded_fixture',
    createdAt: FROZEN_NOW,
    passed: true,
    results: [
      {
        caseId: 'case-a',
        gateId: 'gate-a',
        promptRevision: PROMPT_REF,
        scorerRevision: 'scorer@1',
        passed: true,
        reason: 'ok',
        memoryDiff: null,
      },
    ],
    ...overrides,
  };
}

function sampleDefinition(): RecipeStudioCompileInput {
  return {
    recipeId: RECIPE_ID,
    expectedRevision: null,
    actorId: 'ops-1',
    reason: '新增护发科普玩法',
    correlationId: 'corr-recipe-studio-redeem',
    industryKey: 'hair_care',
    presentation: {
      title: '护发误区科普',
      summary: '用门店项目与专业知识生成护发科普内容',
    },
    dependencies: {
      promptRevisionRef: PROMPT_REF,
      skillRevisionRefs: [
        'skill.beauty-story-structure@3',
        'skill.platform-adaptation@7',
      ],
      workflowRevisionRef: 'workflow.recipe-studio@2',
      outputContractRef: 'output.image-text-note@4',
      quotePolicyRevisionRef: 'quote.policy@5',
    },
    modelPolicy: { mode: 'auto' as const },
    blocks: [
      {
        id: 'intent',
        stage: 'intent_naming' as const,
        type: 'intent_type' as const,
        config: { intentTypes: ['daily_exposure'] },
      },
      {
        id: 'facts',
        stage: 'context_injection' as const,
        type: 'fact_slots' as const,
        config: { factTypes: ['service', 'staff_experience'] },
      },
      {
        id: 'story',
        stage: 'brief_compilation' as const,
        type: 'story_structure' as const,
        config: {
          segments: [
            'pain_point',
            'professional_insight',
            'service_solution',
            'cta',
          ],
        },
      },
      {
        id: 'output',
        stage: 'brief_compilation' as const,
        type: 'output_contract' as const,
        config: {
          outputKind: 'image_text_note',
          quantity: 1,
          aspectRatio: '3:4',
          notePageBound: 3,
        },
      },
      {
        id: 'candidate',
        stage: 'execution_selection' as const,
        type: 'candidate_strategy' as const,
        config: { strategy: 'dual_style_user_choice' },
      },
      {
        id: 'platform',
        stage: 'assembly_delivery' as const,
        type: 'platform_adapter' as const,
        config: {
          contentPackagePlatform: 'xiaohongshu',
          distributionTarget: 'export',
        },
      },
    ],
  };
}

function createRegistries() {
  return {
    evalRunRegistry: new MemoryEvalRunRegistry(),
    receiptRegistry: new MemoryRecipeEvidenceReceiptRegistry(),
  };
}

function createStudioWithRedeem(
  registries: ReturnType<typeof createRegistries>,
  now: () => string = () => FROZEN_NOW,
) {
  const repository = new MemoryCreationExperienceCatalogRepository();
  const catalog = new CreationExperienceCatalogService(repository, now);
  const ports = createRegistryBackedRecipeEvidencePorts({
    ...registries,
    now,
  });
  const studio = new RecipeStudioService(
    catalog,
    now,
    {
      async listUnavailableFrozenRevisionRefs() {
        return [];
      },
    },
    ports,
  );
  return { catalog, repository, studio, ports };
}

async function issuePassingReceipt(
  registries: ReturnType<typeof createRegistries>,
  input: {
    evidenceKind: 'recipe_evaluation' | 'recipe_internal_test';
    recipeId: string;
    recipeRevision: number;
    promptRevisionRef: string;
    run?: EvalRun;
    now?: string;
  },
) {
  const run =
    input.run ??
    sampleEvalRun({
      runId: `run-${input.evidenceKind}-${input.recipeRevision}`,
    });
  return issueRecipeEvidenceReceipt(
    {
      ...registries,
      now: () => input.now ?? FROZEN_NOW,
    },
    {
      run,
      evidenceKind: input.evidenceKind,
      recipeId: input.recipeId,
      recipeRevision: input.recipeRevision,
      promptRevisionRef: input.promptRevisionRef,
    },
  );
}

function assertDomainToken(error: unknown, token: string) {
  assert.ok(error instanceof P1DomainError, 'expected P1DomainError');
  assert.equal(error.code, 'INVALID_STATE');
  assert.match(error.message, new RegExp(token, 'u'));
}

describe('recipe evidence redeem (#396)', () => {
  it('negative matrix: each failure mode returns a unique distinguishable token', async () => {
    const registries = createRegistries();
    const ports = createRegistryBackedRecipeEvidencePorts({
      ...registries,
      now: () => FROZEN_NOW,
    });
    const baseInput = {
      evidenceReceiptId: 'rcpt_missing',
      recipeId: RECIPE_ID,
      recipeRevision: 1,
      promptRevisionRef: PROMPT_REF,
    };

    // 1. receipt not found
    await assert.rejects(
      () => ports.evaluation.redeem(baseInput),
      (error: unknown) => {
        assertDomainToken(error, 'receipt-not-found');
        return true;
      },
    );

    const goodRun = sampleEvalRun({ runId: 'run-matrix-good' });
    const { receipt: goodReceipt } = await issuePassingReceipt(registries, {
      evidenceKind: 'recipe_evaluation',
      recipeId: RECIPE_ID,
      recipeRevision: 1,
      promptRevisionRef: PROMPT_REF,
      run: goodRun,
    });

    // 2. kind mismatch — evaluation receipt against internal-test port
    await assert.rejects(
      () =>
        ports.internalTest.redeem({
          ...baseInput,
          evidenceReceiptId: goodReceipt.receiptId,
        }),
      (error: unknown) => {
        assertDomainToken(error, 'evidence-kind-mismatch');
        return true;
      },
    );

    // 3. expired
    const expiredRun = sampleEvalRun({ runId: 'run-matrix-expired' });
    const { receipt: expiredReceipt } = await issuePassingReceipt(
      registries,
      {
        evidenceKind: 'recipe_evaluation',
        recipeId: RECIPE_ID,
        recipeRevision: 1,
        promptRevisionRef: PROMPT_REF,
        run: expiredRun,
        now: '2020-01-01T00:00:00.000Z',
      },
    );
    await assert.rejects(
      () =>
        ports.evaluation.redeem({
          ...baseInput,
          evidenceReceiptId: expiredReceipt.receiptId,
        }),
      (error: unknown) => {
        assertDomainToken(error, 'receipt-expired');
        return true;
      },
    );

    // 4. recipeId / revision mismatch
    await assert.rejects(
      () =>
        ports.evaluation.redeem({
          evidenceReceiptId: goodReceipt.receiptId,
          recipeId: RECIPE_ID,
          recipeRevision: 99,
          promptRevisionRef: PROMPT_REF,
        }),
      (error: unknown) => {
        assertDomainToken(error, 'recipe-revision-mismatch');
        return true;
      },
    );

    // 5. promptRevisionRef mismatch
    await assert.rejects(
      () =>
        ports.evaluation.redeem({
          evidenceReceiptId: goodReceipt.receiptId,
          recipeId: RECIPE_ID,
          recipeRevision: 1,
          promptRevisionRef: 'prompt.other@9',
        }),
      (error: unknown) => {
        assertDomainToken(error, 'prompt-revision-mismatch');
        return true;
      },
    );

    // 6. EvalRun missing from registry
    const orphanReceipt: RecipeEvidenceReceipt = {
      ...goodReceipt,
      receiptId: 'rcpt_orphan_eval',
      runId: 'run-never-written',
    };
    await registries.receiptRegistry.putImmutable(
      orphanReceipt.receiptId,
      orphanReceipt,
    );
    await assert.rejects(
      () =>
        ports.evaluation.redeem({
          ...baseInput,
          evidenceReceiptId: orphanReceipt.receiptId,
        }),
      (error: unknown) => {
        assertDomainToken(error, 'eval-run-missing');
        return true;
      },
    );

    // 7. EvalRun parse failure (corrupt stored facts via direct map poke)
    const corruptRun = sampleEvalRun({ runId: 'run-matrix-corrupt' });
    await registries.evalRunRegistry.putImmutable(
      corruptRun.runId,
      corruptRun,
    );
    // Bypass schema by writing a receipt that points at a run we then replace
    // with an unparseable object through a custom registry wrapper.
    const corruptEvalRegistry = {
      async putImmutable(runId: string, run: EvalRun) {
        return registries.evalRunRegistry.putImmutable(runId, run);
      },
      async get(runId: string) {
        if (runId === 'run-matrix-corrupt') {
          return { schemaVersion: 'not-a-valid-eval-run' } as unknown as EvalRun;
        }
        return registries.evalRunRegistry.get(runId);
      },
    };
    const corruptPorts = createRegistryBackedRecipeEvidencePorts({
      evalRunRegistry: corruptEvalRegistry,
      receiptRegistry: registries.receiptRegistry,
      now: () => FROZEN_NOW,
    });
    const corruptReceipt: RecipeEvidenceReceipt = {
      ...goodReceipt,
      receiptId: 'rcpt_corrupt_eval',
      runId: 'run-matrix-corrupt',
    };
    await registries.receiptRegistry.putImmutable(
      corruptReceipt.receiptId,
      corruptReceipt,
    );
    await assert.rejects(
      () =>
        corruptPorts.evaluation.redeem({
          ...baseInput,
          evidenceReceiptId: corruptReceipt.receiptId,
        }),
      (error: unknown) => {
        assertDomainToken(error, 'eval-run-invalid');
        return true;
      },
    );

    // 8. passed false — trust registry EvalRun, not receipt.passed
    const failingRun = sampleEvalRun({
      runId: 'run-matrix-fail',
      passed: false,
      results: [
        {
          caseId: 'case-a',
          gateId: 'gate-a',
          promptRevision: PROMPT_REF,
          scorerRevision: 'scorer@1',
          passed: false,
          reason: 'fail',
          memoryDiff: null,
        },
      ],
    });
    const { receipt: failingReceipt } = await issuePassingReceipt(registries, {
      evidenceKind: 'recipe_evaluation',
      recipeId: RECIPE_ID,
      recipeRevision: 1,
      promptRevisionRef: PROMPT_REF,
      run: failingRun,
    });
    // Receipt still stores passed=false; redeem re-checks EvalRun.
    assert.equal(failingReceipt.passed, false);
    await assert.rejects(
      () =>
        ports.evaluation.redeem({
          ...baseInput,
          evidenceReceiptId: failingReceipt.receiptId,
        }),
      (error: unknown) => {
        assertDomainToken(error, 'eval-run-failed');
        return true;
      },
    );

    // 9. case promptRevision inconsistent with frozen compile
    const mixedCaseRun = sampleEvalRun({
      runId: 'run-matrix-mixed-prompt',
      results: [
        {
          caseId: 'case-a',
          gateId: 'gate-a',
          promptRevision: PROMPT_REF,
          scorerRevision: 'scorer@1',
          passed: true,
          reason: 'ok',
          memoryDiff: null,
        },
        {
          caseId: 'case-b',
          gateId: 'gate-b',
          promptRevision: 'prompt.other@1',
          scorerRevision: 'scorer@1',
          passed: true,
          reason: 'ok',
          memoryDiff: null,
        },
      ],
    });
    // Issuer refuses mixed prompts — plant registry facts directly.
    await registries.evalRunRegistry.putImmutable(
      mixedCaseRun.runId,
      mixedCaseRun,
    );
    const mixedReceipt: RecipeEvidenceReceipt = {
      receiptId: 'rcpt_mixed_prompt',
      evidenceKind: 'recipe_evaluation',
      runId: mixedCaseRun.runId,
      recipeId: RECIPE_ID,
      recipeRevision: 1,
      promptRevisionRef: PROMPT_REF,
      suiteId: mixedCaseRun.suiteId,
      suiteRevision: mixedCaseRun.suiteRevision,
      mode: mixedCaseRun.mode,
      passed: true,
      issuerId: RECIPE_EVIDENCE_ISSUER_ID,
      issuedAt: FROZEN_NOW,
      expiresAt: '2026-09-05T12:00:00.000Z',
    };
    await registries.receiptRegistry.putImmutable(
      mixedReceipt.receiptId,
      mixedReceipt,
    );
    await assert.rejects(
      () =>
        ports.evaluation.redeem({
          ...baseInput,
          evidenceReceiptId: mixedReceipt.receiptId,
        }),
      (error: unknown) => {
        assertDomainToken(error, 'case-prompt-revision-mismatch');
        return true;
      },
    );

    // 10. issuer not on allowlist
    const foreignRun = sampleEvalRun({ runId: 'run-matrix-foreign-issuer' });
    await registries.evalRunRegistry.putImmutable(
      foreignRun.runId,
      foreignRun,
    );
    const foreignReceipt: RecipeEvidenceReceipt = {
      receiptId: 'rcpt_foreign_issuer',
      evidenceKind: 'recipe_evaluation',
      runId: foreignRun.runId,
      recipeId: RECIPE_ID,
      recipeRevision: 1,
      promptRevisionRef: PROMPT_REF,
      suiteId: foreignRun.suiteId,
      suiteRevision: foreignRun.suiteRevision,
      mode: foreignRun.mode,
      passed: true,
      issuerId: 'attacker.forged-issuer',
      issuedAt: FROZEN_NOW,
      expiresAt: '2026-09-05T12:00:00.000Z',
    };
    await registries.receiptRegistry.putImmutable(
      foreignReceipt.receiptId,
      foreignReceipt,
    );
    await assert.rejects(
      () =>
        ports.evaluation.redeem({
          ...baseInput,
          evidenceReceiptId: foreignReceipt.receiptId,
        }),
      (error: unknown) => {
        assertDomainToken(error, 'issuer-not-allowed');
        return true;
      },
    );

    // Token uniqueness across the matrix
    const tokens = Object.values(RECIPE_EVIDENCE_REDEEM_ERRORS).map(
      (entry) => entry.token,
    );
    assert.equal(new Set(tokens).size, tokens.length);
  });

  it('anti-forgery: client-constructed EvalRun fields never authorize; only issued receiptId redeems', async () => {
    const registries = createRegistries();
    const { studio } = createStudioWithRedeem(registries);
    const compiled = await studio.compile(sampleDefinition());
    const validated = await studio.validate({
      recipeId: compiled.recipeId,
      expectedRevision: compiled.revision,
      actorId: 'ops-1',
      reason: 'validate',
      correlationId: 'corr-anti-forge-validate',
    });

    // Forged receipt id (no registry row) is refused.
    await assert.rejects(
      () =>
        studio.recordEvaluation({
          recipeId: validated.recipeId,
          expectedRevision: validated.revision,
          actorId: 'ops-1',
          reason: 'client forges receipt id',
          correlationId: 'corr-anti-forge-eval',
          evidenceReceiptId: 'client-forged-eval-run',
        }),
      /receipt-not-found/u,
    );

    // Server-issued receipt advances the gate.
    const issued = await issuePassingReceipt(registries, {
      evidenceKind: 'recipe_evaluation',
      recipeId: validated.recipeId,
      recipeRevision: validated.revision,
      promptRevisionRef: PROMPT_REF,
      run: sampleEvalRun({
        runId: 'run-anti-forge-eval',
        suiteId: 'recipe-governance',
        suiteRevision: 'recipe-governance@1',
      }),
    });
    const evaluated = await studio.recordEvaluation({
      recipeId: validated.recipeId,
      expectedRevision: validated.revision,
      actorId: 'ops-1',
      reason: 'real receipt',
      correlationId: 'corr-anti-forge-eval-ok',
      evidenceReceiptId: issued.receipt.receiptId,
    });
    assert.equal(evaluated.studioRelease?.phase, 'evaluated');
    assert.equal(
      evaluated.studioRelease?.evaluation?.runId,
      'run-anti-forge-eval',
    );
    assert.equal(
      evaluated.studioRelease?.evaluation?.suiteId,
      'recipe-governance',
    );
    assert.equal(
      evaluated.studioRelease?.evaluation?.suiteRevision,
      'recipe-governance@1',
    );
  });

  it('writes studioRelease runId/suiteId/suiteRevision from registry EvalRun, not forged receipt copies', async () => {
    const registries = createRegistries();
    const { studio } = createStudioWithRedeem(registries);
    const compiled = await studio.compile(sampleDefinition());
    const validated = await studio.validate({
      recipeId: compiled.recipeId,
      expectedRevision: compiled.revision,
      actorId: 'ops-1',
      reason: 'validate',
      correlationId: 'corr-registry-facts-validate',
    });

    const run = sampleEvalRun({
      runId: 'run-registry-authority',
      suiteId: 'suite-from-registry',
      suiteRevision: 'suite-from-registry@3',
    });
    await registries.evalRunRegistry.putImmutable(run.runId, run);
    // Plant a receipt whose suite copies deliberately disagree with EvalRun.
    // Redeem must re-stamp from the registry EvalRun.
    const planted: RecipeEvidenceReceipt = {
      receiptId: 'rcpt_stale_suite_copy',
      evidenceKind: 'recipe_evaluation',
      runId: run.runId,
      recipeId: validated.recipeId,
      recipeRevision: validated.revision,
      promptRevisionRef: PROMPT_REF,
      suiteId: 'forged-suite-on-receipt',
      suiteRevision: 'forged-suite@9',
      mode: 'recorded_fixture',
      passed: true,
      issuerId: RECIPE_EVIDENCE_ISSUER_ID,
      issuedAt: FROZEN_NOW,
      expiresAt: '2026-09-05T12:00:00.000Z',
    };
    await registries.receiptRegistry.putImmutable(planted.receiptId, planted);

    const redeemed = await redeemEvidenceReceipt(
      { ...registries, now: () => FROZEN_NOW },
      {
        evidenceReceiptId: planted.receiptId,
        recipeId: validated.recipeId,
        recipeRevision: validated.revision,
        promptRevisionRef: PROMPT_REF,
      },
      'recipe_evaluation',
    );
    assert.equal(redeemed.suiteId, 'suite-from-registry');
    assert.equal(redeemed.suiteRevision, 'suite-from-registry@3');
    assert.equal(redeemed.runId, 'run-registry-authority');

    const evaluated = await studio.recordEvaluation({
      recipeId: validated.recipeId,
      expectedRevision: validated.revision,
      actorId: 'ops-1',
      reason: 'registry authority',
      correlationId: 'corr-registry-facts-eval',
      evidenceReceiptId: planted.receiptId,
    });
    assert.deepEqual(
      {
        runId: evaluated.studioRelease?.evaluation?.runId,
        suiteId: evaluated.studioRelease?.evaluation?.suiteId,
        suiteRevision: evaluated.studioRelease?.evaluation?.suiteRevision,
      },
      {
        runId: 'run-registry-authority',
        suiteId: 'suite-from-registry',
        suiteRevision: 'suite-from-registry@3',
      },
    );
  });

  it('end-to-end: compile → validate → issue eval → record → issue internal → record → production switch', async () => {
    const registries = createRegistries();
    const { catalog, studio } = createStudioWithRedeem(registries);
    const launch = await publishLaunchCatalog(catalog, {
      skillRevisionValidation: {
        async listUnavailableFrozenRevisionRefs() {
          return [];
        },
      },
      // Launch seed still uses permitting ports; studio under test uses registry.
    });

    const compiled = await studio.compile(sampleDefinition());
    assert.equal(compiled.studioRelease?.phase, 'compiled');

    const validated = await studio.validate({
      recipeId: compiled.recipeId,
      expectedRevision: compiled.revision,
      actorId: 'ops-1',
      reason: 'validate',
      correlationId: 'corr-e2e-validate',
    });
    assert.equal(validated.studioRelease?.phase, 'validated');

    const evalIssued = await runAndIssueRecipeGovernanceEvidence(registries, {
      subject: {
        recipeId: validated.recipeId,
        recipeRevision: validated.revision,
        promptRevisionRef: PROMPT_REF,
        factTypes: ['service', 'staff_experience'],
        intentTypes: ['daily_exposure'],
        output: {
          outputKind: 'image_text_note',
          quantity: 1,
          aspectRatio: '3:4',
          notePageBound: 3,
        },
      },
      now: () => FROZEN_NOW,
      runOptions: {
        runId: 'e2e-governance-run',
        createdAt: FROZEN_NOW,
      },
    });
    assert.equal(evalIssued.receipt.issuerId, RECIPE_EVIDENCE_ISSUER_ID);

    const evaluated = await studio.recordEvaluation({
      recipeId: validated.recipeId,
      expectedRevision: validated.revision,
      actorId: 'ops-1',
      reason: 'record eval',
      correlationId: 'corr-e2e-eval',
      evidenceReceiptId: evalIssued.receipt.receiptId,
    });
    assert.equal(evaluated.studioRelease?.phase, 'evaluated');
    assert.equal(
      evaluated.studioRelease?.evaluation?.runId,
      evalIssued.run.runId,
    );
    assert.equal(
      evaluated.studioRelease?.evaluation?.suiteId,
      evalIssued.run.suiteId,
    );
    assert.equal(
      evaluated.studioRelease?.evaluation?.suiteRevision,
      evalIssued.run.suiteRevision,
    );

    const internalIssued = await runAndIssueRecipeInternalTestEvidence(
      registries,
      {
        subject: {
          recipeId: evaluated.recipeId,
          recipeRevision: evaluated.revision,
          promptRevisionRef: PROMPT_REF,
        },
        env: { APP_ENV: 'development' },
        now: () => FROZEN_NOW,
        executeCreation: async () => ({
          runId: 'e2e-internal-run',
          passed: true,
          reason: 'fixture creation passed',
          createdAt: FROZEN_NOW,
        }),
      },
    );

    const internalTested = await studio.recordInternalTest({
      recipeId: evaluated.recipeId,
      expectedRevision: evaluated.revision,
      actorId: 'ops-1',
      reason: 'record internal',
      correlationId: 'corr-e2e-internal',
      evidenceReceiptId: internalIssued.receipt.receiptId,
    });
    assert.equal(internalTested.studioRelease?.phase, 'internal_tested');
    assert.equal(
      internalTested.studioRelease?.internalTest?.runId,
      internalIssued.run.runId,
    );
    assert.equal(
      internalTested.studioRelease?.internalTest?.label,
      'internal-test',
    );

    const production = await studio.switchProduction({
      recipeId: internalTested.recipeId,
      expectedRevision: internalTested.revision,
      surfaceId: LAUNCH_SURFACE_ID,
      expectedSurfaceRevision: launch.surface.revision,
      actorId: 'ops-1',
      reason: 'switch production',
      correlationId: 'corr-e2e-prod',
    });
    assert.equal(production.recipe.status, 'published');
    assert.equal(production.surface.status, 'published');
  });

  it('Langfuse push failure is recorded and does not block issuance or redeem', async () => {
    const registries = createRegistries();
    const recordedFailures: string[] = [];
    const run = sampleEvalRun({ runId: 'run-langfuse-isolation' });

    const issued = await issueRecipeEvidenceReceiptWithObservability(
      {
        ...registries,
        now: () => FROZEN_NOW,
      },
      {
        run,
        evidenceKind: 'recipe_evaluation',
        recipeId: RECIPE_ID,
        recipeRevision: 1,
        promptRevisionRef: PROMPT_REF,
      },
      {
        push: async () => {
          throw new Error('Langfuse dataset item import failed with HTTP 503.');
        },
        onPushFailure: (error) => {
          recordedFailures.push(
            error instanceof Error ? error.message : String(error),
          );
        },
      },
    );

    assert.ok(issued.receipt.receiptId);
    assert.match(
      issued.observabilityFailure ?? '',
      /Langfuse dataset item import failed with HTTP 503/u,
    );
    assert.deepEqual(recordedFailures, [
      'Langfuse dataset item import failed with HTTP 503.',
    ]);

    // Gate still redeems the issued receipt.
    const ports = createRegistryBackedRecipeEvidencePorts({
      ...registries,
      now: () => FROZEN_NOW,
    });
    const redeemed = await ports.evaluation.redeem({
      evidenceReceiptId: issued.receipt.receiptId,
      recipeId: RECIPE_ID,
      recipeRevision: 1,
      promptRevisionRef: PROMPT_REF,
    });
    assert.equal(redeemed.runId, run.runId);
    assert.equal(redeemed.passed, true);
  });
});
