import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pickComposerSubmissionSignedFields } from '@meiye/contracts';

import { ComposerSubmissionAdmissionGate } from '../execution-spine/composer-submission-gate.js';
import type { ComposerSubmissionRequest } from '../execution-spine/creation-execution-snapshot.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';
import { CreationExperienceCatalogService } from './catalog-service.js';
import { CreationExperienceFoundationModule } from './foundation-module.js';
import {
  LAUNCH_SURFACE_ID,
  publishLaunchCatalog,
} from './launch-seeds.js';
import { MemoryCreationExperienceCatalogRepository } from './memory-repository.js';
import { validateRecipeForComposer } from './recipe-validator.js';
import { MemoryEvalRunRegistry } from '../harness/eval-run-registry.js';
import {
  createPermittingRecipeEvidencePorts,
  type RecipeEvaluationEvidencePort,
  type RecipeInternalTestEvidencePort,
} from './recipe-evidence-ports.js';
import {
  issueRecipeEvidenceReceipt,
} from './recipe-evidence-issuer.js';
import { MemoryRecipeEvidenceReceiptRegistry } from './recipe-evidence-receipt-registry.js';
import {
  RecipeStudioService,
  type RecipeStudioCompileInput,
} from './recipe-studio.js';

function createServices(
  unavailableSkillRefs: string[] = [],
  evidence?: {
    evaluation?: RecipeEvaluationEvidencePort;
    internalTest?: RecipeInternalTestEvidencePort;
  },
) {
  const repository = new MemoryCreationExperienceCatalogRepository();
  const catalog = new CreationExperienceCatalogService(
    repository,
    () => '2026-07-25T12:00:00.000Z',
  );
  return {
    catalog,
    repository,
    studio: new RecipeStudioService(
      catalog,
      () => '2026-07-25T12:00:00.000Z',
      {
        async listUnavailableFrozenRevisionRefs() {
          return unavailableSkillRefs;
        },
      },
      evidence,
    ),
  };
}

/** Full-chain tests inject permitting ports (Spec I replaces with real issuer). */
function createServicesWithPermittingEvidence(
  unavailableSkillRefs: string[] = [],
) {
  return createServices(
    unavailableSkillRefs,
    createPermittingRecipeEvidencePorts({
      now: () => '2026-07-25T12:00:00.000Z',
      issuerId: 'ops-1',
    }),
  );
}

function sampleDefinition(): RecipeStudioCompileInput {
  return {
    recipeId: 'recipe.hair-care.education',
    expectedRevision: null,
    actorId: 'ops-1',
    reason: '新增护发科普玩法',
    correlationId: 'corr-recipe-studio-1',
    industryKey: 'hair_care',
    presentation: {
      title: '护发误区科普',
      summary: '用门店项目与专业知识生成护发科普内容',
    },
    dependencies: {
      promptRevisionRef: 'prompt.hair-care-education@12',
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

describe('Recipe Studio controlled compiler', () => {
  it('exposes controlled compilation through the existing admin command seam', async () => {
    const repository = new MemoryCreationExperienceCatalogRepository();
    const catalog = new CreationExperienceCatalogService(
      repository,
      () => '2026-07-25T12:00:00.000Z',
    );
    const module = new CreationExperienceFoundationModule(repository, catalog);
    const definition = sampleDefinition();

    const result = await module.execute({
      context: {
        workspaceId: 'workspace-a',
        userId: 'ops-1',
        correlationId: 'corr-admin-command',
        actor: 'admin',
      },
      idempotencyKey: 'compile-hair-care-v1',
      input: {
        action: 'recipe_studio_compile',
        payload: {
          ...definition,
          actorId: undefined,
          correlationId: undefined,
          reason: '新增护发科普玩法',
        },
      },
    });

    assert.equal((result as { revision: number }).revision, 1);
    assert.equal(
      (result as { studioRelease?: { phase: string } }).studioRelease?.phase,
      'compiled',
    );
  });

  it('compiles controlled blocks into an immutable Recipe revision with pinned dependencies', async () => {
    const { studio: service } = createServices();

    const compiled = await service.compile(sampleDefinition());

    assert.equal(compiled.status, 'draft');
    assert.equal(compiled.revision, 1);
    assert.deepEqual(compiled.factTypes, ['service', 'staff_experience']);
    assert.equal(compiled.promptRevisionRef, 'prompt.hair-care-education@12');
    assert.deepEqual(compiled.skillRevisionRefs, [
      'skill.beauty-story-structure@3',
      'skill.platform-adaptation@7',
    ]);
    assert.equal(compiled.studioRelease?.phase, 'compiled');
    assert.equal(compiled.studioRelease?.compilationReceipt.industryKey, 'hair_care');
    assert.equal(
      compiled.studioRelease?.compilationReceipt.promptRevisionRef,
      'prompt.hair-care-education@12',
    );
    assert.deepEqual(
      compiled.studioRelease?.compilationReceipt.skillRevisionRefs,
      [
        'skill.beauty-story-structure@3',
        'skill.platform-adaptation@7',
      ],
    );
  });

  it('records the shared Composer validator result as a new immutable revision', async () => {
    const { studio: service } = createServices();
    const compiled = await service.compile(sampleDefinition());

    const validated = await service.validate({
      recipeId: compiled.recipeId,
      expectedRevision: compiled.revision,
      actorId: 'ops-1',
      reason: '运行生产同源校验',
      correlationId: 'corr-recipe-studio-validate',
    });

    assert.equal(validated.revision, 2);
    assert.equal(validated.contentHash, compiled.contentHash);
    assert.equal(validated.studioRelease?.phase, 'validated');
    assert.deepEqual(validated.studioRelease?.validation, {
      checkedAt: '2026-07-25T12:00:00.000Z',
      passed: true,
    });
    assert.equal(compiled.studioRelease?.validation, null);
  });

  it('fails closed when a versioned Skill dependency does not exist or is not frozen', async () => {
    const unavailable = 'skill.platform-adaptation@7';
    const { studio } = createServices([unavailable]);
    const compiled = await studio.compile(sampleDefinition());

    await assert.rejects(
      () =>
        studio.validate({
          recipeId: compiled.recipeId,
          expectedRevision: compiled.revision,
          actorId: 'ops-1',
          reason: '运行生产同源校验',
          correlationId: 'corr-recipe-studio-missing-skill',
        }),
      new RegExp(`不存在或尚未受理冻结：${unavailable}`, 'u'),
    );
  });

  it('refuses evaluation and internal-test gates without a server-issued evidence receipt', async () => {
    // Default-deny ports: a self-consistent client "pass" object is no longer accepted.
    const { catalog, studio: service } = createServices();
    const compiled = await service.compile(sampleDefinition());
    const validated = await service.validate({
      recipeId: compiled.recipeId,
      expectedRevision: compiled.revision,
      actorId: 'ops-1',
      reason: '运行生产同源校验',
      correlationId: 'corr-recipe-studio-validate',
    });
    assert.equal(validated.studioRelease?.phase, 'validated');

    await assert.rejects(
      () =>
        service.recordEvaluation({
          recipeId: validated.recipeId,
          expectedRevision: validated.revision,
          actorId: 'ops-1',
          reason: '伪造客户端评测通过对象',
          correlationId: 'corr-recipe-studio-eval-forged',
          // Receipt id without a Spec I issuer must not advance the gate.
          evidenceReceiptId: 'client-forged-eval-run',
        }),
      /evidence-unavailable/u,
    );

    await assert.rejects(
      () =>
        service.recordEvaluation({
          recipeId: validated.recipeId,
          expectedRevision: validated.revision,
          actorId: 'ops-1',
          reason: '缺少回执仍尝试过门',
          correlationId: 'corr-recipe-studio-eval-missing',
          evidenceReceiptId: '',
        }),
      /evidenceReceiptId/u,
    );

    assert.equal(
      (await catalog.getRecipeHead(validated.recipeId))?.studioRelease?.phase,
      'validated',
    );

    // Internal-test cannot be reached without evaluation; with default-deny both fail.
    await assert.rejects(
      () =>
        service.recordInternalTest({
          recipeId: validated.recipeId,
          expectedRevision: validated.revision,
          actorId: 'ops-1',
          reason: '伪造内测通过',
          correlationId: 'corr-recipe-studio-internal-forged',
          evidenceReceiptId: 'client-forged-internal-run',
        }),
      /必须先通过评测门/u,
    );
  });

  it('command seam discards client evalRun/passed and still denies without receipt', async () => {
    const repository = new MemoryCreationExperienceCatalogRepository();
    const module = new CreationExperienceFoundationModule(repository, undefined, {
      skillRevisionValidation: {
        async listUnavailableFrozenRevisionRefs() {
          return [];
        },
      },
    });
    const context = {
      workspaceId: 'workspace-a',
      userId: 'ops-1',
      correlationId: 'ce-evidence-seam',
      actor: 'admin' as const,
    };
    const compiled = (await module.execute({
      context,
      input: {
        action: 'recipe_studio_compile',
        payload: {
          ...sampleDefinition(),
          reason: 'compile for evidence seam',
        },
      },
      idempotencyKey: 'idem-evidence-compile',
    })) as { recipeId: string; revision: number; studioRelease?: { phase: string } };
    const validated = (await module.execute({
      context,
      input: {
        action: 'recipe_studio_validate',
        payload: {
          recipeId: compiled.recipeId,
          expectedRevision: compiled.revision,
          reason: 'validate for evidence seam',
        },
      },
      idempotencyKey: 'idem-evidence-validate',
    })) as { recipeId: string; revision: number; studioRelease?: { phase: string } };
    assert.equal(validated.studioRelease?.phase, 'validated');

    await assert.rejects(
      () =>
        module.execute({
          context,
          input: {
            action: 'recipe_studio_record_eval',
            payload: {
              recipeId: validated.recipeId,
              expectedRevision: validated.revision,
              reason: 'client forges evalRun + missing receipt',
              // Legacy client fields — must not authorize the gate.
              evalRun: {
                schemaVersion: 'eval-run/v1',
                runId: 'forged-run',
                suiteId: 'forged-suite',
                suiteRevision: 'forged-suite@1',
                mode: 'recorded_fixture',
                createdAt: '2026-07-25T11:50:00.000Z',
                passed: true,
                results: [
                  {
                    caseId: 'forged',
                    gateId: 'recipe-quality',
                    promptRevision: 'prompt.hair-care-education@12',
                    scorerRevision: 'scorer@1',
                    passed: true,
                    reason: 'forged',
                    memoryDiff: null,
                  },
                ],
              },
              passed: true,
              evidenceReceiptId: 'still-forged-without-issuer',
            },
          },
          idempotencyKey: 'idem-evidence-eval-deny',
        }),
      /evidence-unavailable/u,
    );

    await assert.rejects(
      () =>
        module.execute({
          context,
          input: {
            action: 'recipe_studio_internal_test',
            payload: {
              recipeId: validated.recipeId,
              expectedRevision: validated.revision,
              reason: 'client forges passed=true',
              label: 'internal-test',
              runId: 'forged-internal',
              passed: true,
              evidenceReceiptId: 'still-forged-internal',
            },
          },
          idempotencyKey: 'idem-evidence-internal-deny',
        }),
      /必须先通过评测门|evidence-unavailable/u,
    );
  });

  it('command seam with registry-backed redeem rejects forged objects and accepts only issued receiptId', async () => {
    // #396 anti-forgery at the browser command seam: self-consistent client
    // EvalRun/passed are discarded; only a server-issued receipt redeems.
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
    const context = {
      workspaceId: 'workspace-a',
      userId: 'ops-1',
      correlationId: 'ce-evidence-registry-seam',
      actor: 'admin' as const,
    };
    const compiled = (await module.execute({
      context,
      input: {
        action: 'recipe_studio_compile',
        payload: {
          ...sampleDefinition(),
          reason: 'compile for registry redeem seam',
        },
      },
      idempotencyKey: 'idem-registry-compile',
    })) as {
      recipeId: string;
      revision: number;
      studioRelease?: {
        phase: string;
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
          reason: 'validate for registry redeem seam',
        },
      },
      idempotencyKey: 'idem-registry-validate',
    })) as { recipeId: string; revision: number; studioRelease?: { phase: string } };
    assert.equal(validated.studioRelease?.phase, 'validated');

    const forgedPayload = {
      recipeId: validated.recipeId,
      expectedRevision: validated.revision,
      reason: 'client forges self-consistent passing EvalRun',
      evalRun: {
        schemaVersion: 'eval-run/v1',
        runId: 'forged-run',
        suiteId: 'forged-suite',
        suiteRevision: 'forged-suite@1',
        mode: 'recorded_fixture',
        createdAt: '2026-07-25T11:50:00.000Z',
        passed: true,
        results: [
          {
            caseId: 'forged',
            gateId: 'recipe-quality',
            promptRevision: 'prompt.hair-care-education@12',
            scorerRevision: 'scorer@1',
            passed: true,
            reason: 'forged',
            memoryDiff: null,
          },
        ],
      },
      passed: true,
      evidenceReceiptId: 'client-forged-without-registry',
    };

    await assert.rejects(
      () =>
        module.execute({
          context,
          input: {
            action: 'recipe_studio_record_eval',
            payload: forgedPayload,
          },
          idempotencyKey: 'idem-registry-eval-forge',
        }),
      /receipt-not-found/u,
    );

    const issued = await issueRecipeEvidenceReceipt(
      {
        evalRunRegistry,
        receiptRegistry: evidenceReceiptRegistry,
        now: () => '2026-07-25T12:00:00.000Z',
      },
      {
        run: {
          schemaVersion: 'eval-run/v1',
          runId: 'issued-eval-run-1',
          suiteId: 'recipe-governance',
          suiteRevision: 'recipe-governance@1',
          mode: 'recorded_fixture',
          createdAt: '2026-07-25T11:50:00.000Z',
          passed: true,
          results: [
            {
              caseId: 'case-a',
              gateId: 'gate-a',
              promptRevision: 'prompt.hair-care-education@12',
              scorerRevision: 'scorer@1',
              passed: true,
              reason: 'ok',
              memoryDiff: null,
            },
          ],
        },
        evidenceKind: 'recipe_evaluation',
        recipeId: validated.recipeId,
        recipeRevision: validated.revision,
        promptRevisionRef: 'prompt.hair-care-education@12',
      },
    );

    const evaluated = (await module.execute({
      context,
      input: {
        action: 'recipe_studio_record_eval',
        payload: {
          ...forgedPayload,
          // Same forged EvalRun/passed still present — must be ignored.
          evidenceReceiptId: issued.receipt.receiptId,
          reason: 'server-issued receipt only',
        },
      },
      idempotencyKey: 'idem-registry-eval-ok',
    })) as {
      studioRelease?: {
        phase: string;
        evaluation?: {
          runId: string;
          suiteId: string;
          suiteRevision: string;
          passed?: boolean;
        };
      };
    };
    assert.equal(evaluated.studioRelease?.phase, 'evaluated');
    assert.equal(evaluated.studioRelease?.evaluation?.runId, 'issued-eval-run-1');
    assert.equal(
      evaluated.studioRelease?.evaluation?.suiteId,
      'recipe-governance',
    );
    assert.equal(
      evaluated.studioRelease?.evaluation?.suiteRevision,
      'recipe-governance@1',
    );
    assert.equal(evaluated.studioRelease?.evaluation?.passed, true);
    // Registry identity, not the forged payload suite.
    assert.notEqual(evaluated.studioRelease?.evaluation?.suiteId, 'forged-suite');
  });

  it('redeems server evidence receipts into evaluated and internal_tested phases', async () => {
    const { studio: service } = createServicesWithPermittingEvidence();
    const compiled = await service.compile(sampleDefinition());
    const validated = await service.validate({
      recipeId: compiled.recipeId,
      expectedRevision: compiled.revision,
      actorId: 'ops-1',
      reason: '运行生产同源校验',
      correlationId: 'corr-recipe-studio-validate',
    });

    const evaluated = await service.recordEvaluation({
      recipeId: validated.recipeId,
      expectedRevision: validated.revision,
      actorId: 'ops-1',
      reason: '记录护发 Recipe 评测',
      correlationId: 'corr-recipe-studio-eval',
      evidenceReceiptId: 'recipe-hair-care-eval-1',
    });
    assert.equal(evaluated.studioRelease?.phase, 'evaluated');
    assert.equal(
      evaluated.studioRelease?.evaluation?.runId,
      'recipe-hair-care-eval-1',
    );

    const internalTested = await service.recordInternalTest({
      recipeId: evaluated.recipeId,
      expectedRevision: evaluated.revision,
      actorId: 'ops-1',
      reason: '内测标签试跑通过',
      correlationId: 'corr-recipe-studio-internal',
      evidenceReceiptId: 'internal-run-hair-care-1',
    });
    assert.equal(internalTested.studioRelease?.phase, 'internal_tested');
    assert.deepEqual(internalTested.studioRelease?.internalTest, {
      checkedAt: '2026-07-25T12:00:00.000Z',
      label: 'internal-test',
      runId: 'internal-run-hair-care-1',
      passed: true,
    });
  });

  it('switches a fully gated revision into the production Surface for Composer submission', async () => {
    const { catalog, repository, studio } = createServicesWithPermittingEvidence();
    const launch = await publishLaunchCatalog(catalog);
    const compiled = await studio.compile(sampleDefinition());
    const validated = await studio.validate({
      recipeId: compiled.recipeId,
      expectedRevision: compiled.revision,
      actorId: 'ops-1',
      reason: '运行生产同源校验',
      correlationId: 'corr-production-validate',
    });
    const evaluated = await studio.recordEvaluation({
      recipeId: validated.recipeId,
      expectedRevision: validated.revision,
      actorId: 'ops-1',
      reason: '记录评测',
      correlationId: 'corr-production-eval',
      evidenceReceiptId: 'recipe-production-eval-1',
    });
    const internalTested = await studio.recordInternalTest({
      recipeId: evaluated.recipeId,
      expectedRevision: evaluated.revision,
      actorId: 'ops-1',
      reason: '内测试跑通过',
      correlationId: 'corr-production-internal',
      evidenceReceiptId: 'internal-run-hair-care-1',
    });

    const production = await studio.switchProduction({
      recipeId: internalTested.recipeId,
      expectedRevision: internalTested.revision,
      surfaceId: LAUNCH_SURFACE_ID,
      expectedSurfaceRevision: launch.surface.revision,
      actorId: 'ops-1',
      reason: '切换护发 Recipe 到生产',
      correlationId: 'corr-production-switch',
    });

    assert.equal(production.recipe.status, 'published');
    assert.equal(production.surface.status, 'published');
    const browser = await catalog.projectBrowserSurface(LAUNCH_SURFACE_ID);
    const projected = browser.recipes.find(
      (recipe) => recipe.revisionId === production.recipe.revisionId,
    );
    assert.ok(projected);
    assert.equal('studioRelease' in projected, false);
    const admission = validateRecipeForComposer(production.recipe, {
      creationMode: 'customized',
      intent: '生成一篇护发误区科普笔记',
      catalogModel: {
        id: 'catalog.deepseek-v4-pro',
        revision: 'catalog.deepseek-v4-pro@1',
      },
      recipe: {
        id: production.recipe.recipeId,
        revision: production.recipe.revisionId,
      },
      contentPackagePlatform: 'xiaohongshu',
      distributionTarget: 'export',
      deliverable: {
        kind: 'note',
        quantity: 1,
        aspectRatio: '3:4',
        notePageBound: 3,
      },
    });
    assert.deepEqual(admission.errors, []);
    assert.equal(admission.binding?.lens, 'image_text_note');

    const submission: ComposerSubmissionRequest = {
      actorId: 'merchant-1',
      workspaceId: 'workspace-1',
      idempotencyKey: 'submit-recipe-studio-1',
      briefContext: { id: 'brief-context-1', revision: 1 },
      catalogModel: {
        id: 'catalog.deepseek-v4-pro',
        revision: 'catalog.deepseek-v4-pro@1',
      },
      contentPackagePlatform: 'xiaohongshu',
      distributionTarget: 'export',
      deliverable: {
        kind: 'note',
        quantity: 1,
        aspectRatio: '3:4',
        notePageBound: 3,
      },
      creationMode: 'customized',
      intent: '生成一篇护发误区科普笔记',
      quote: { id: 'quote-recipe-studio-1', revision: 'quote@1' },
      recipe: {
        id: production.recipe.recipeId,
        revision: production.recipe.revisionId,
      },
      sources: { assets: [] },
      surface: {
        id: production.surface.surfaceId,
        revision: production.surface.revisionId,
      },
    };
    const gate = new ComposerSubmissionAdmissionGate({
      assets: { async inspect() { return []; } },
      briefs: { async assertCurrent() {} },
      briefConfirmations: {
        async getBriefConfirmation() {
          return null;
        },
      },
      capabilities: { async assertReady() {} },
      catalog: repository,
      identities: { async listActive() { return []; } },
      modelPreferences: {
        async getPreferences() {
          return {
            favorites: [],
            platformDefault: 'catalog.deepseek-v4-pro',
            platformDefaultRevision: 'admin-config:1',
            recent: [],
          };
        },
      },
      noteSettings: {
        async read() {
          return {
            styles: {
              styles: [
                {
                  id: 'facts',
                  name: '干货版',
                  writingGuide: '解释清楚',
                  structureTemplate: '结论先行',
                  platforms: ['xiaohongshu'],
                },
                {
                  id: 'story',
                  name: '叙事版',
                  writingGuide: '场景叙事',
                  structureTemplate: '场景展开',
                  platforms: ['xiaohongshu'],
                },
              ],
            },
          };
        },
      },
      quotes: {
        async getQuote() {
          return {
            catalogModelId: submission.catalogModel.id,
            catalogModelRevision: submission.catalogModel.revision,
            lifecycleStatus: 'quoted',
            quoteId: submission.quote.id,
            revision: submission.quote.revision,
            routeSnapshotRef: 'route-recipe-studio-1',
            submissionContractHash: fingerprintValue(
              pickComposerSubmissionSignedFields(submission),
            ),
          } as never;
        },
        async confirm(input) {
          return {
            lifecycleStatus: 'confirmed',
            taskId: input.taskId,
          } as never;
        },
      },
      rights: {
        async resolve() {
          return { knownAssetIds: [], unauthorizedAssetIds: [] };
        },
      },
      routeResolver: {
        async resolve() {
          return {
            allowedCandidates: [
              {
                catalogModelId: submission.catalogModel.id,
                deploymentId: 'deployment-deepseek-1',
              },
            ],
            catalogRevision: submission.catalogModel.revision,
            id: 'route-recipe-studio-1',
            requestedCatalogModelId: submission.catalogModel.id,
            selectionMode: 'fixed',
            workspaceId: submission.workspaceId,
          } as never;
        },
      },
      sourcePackages: {
        async get() {
          return null;
        },
      },
    });
    const admitted = await gate.admit(submission);
    assert.match(admitted.taskId, /^composer-task:[a-f0-9]{64}$/u);
    assert.equal(admitted.recipeBinding.lens, 'image_text_note');
  });

  it('blocks production switching before eval and internal-test gates pass', async () => {
    const { catalog, studio } = createServices();
    const launch = await publishLaunchCatalog(catalog);
    const compiled = await studio.compile(sampleDefinition());
    const validated = await studio.validate({
      recipeId: compiled.recipeId,
      expectedRevision: compiled.revision,
      actorId: 'ops-1',
      reason: '只完成 validator',
      correlationId: 'corr-incomplete-gates',
    });

    await assert.rejects(
      () =>
        studio.switchProduction({
          recipeId: validated.recipeId,
          expectedRevision: validated.revision,
          surfaceId: LAUNCH_SURFACE_ID,
          expectedSurfaceRevision: launch.surface.revision,
          actorId: 'ops-1',
          reason: '不应允许切生产',
          correlationId: 'corr-incomplete-switch',
        }),
      /必须依次通过校验、评测和内测试跑/u,
    );

    assert.equal(
      (await catalog.getSurfaceHead(LAUNCH_SURFACE_ID))?.revision,
      launch.surface.revision,
    );
  });

  it('rejects unknown fact slots and incomplete platform semantics in operator-readable Chinese', async () => {
    const { studio } = createServices();
    const invalidFact = sampleDefinition();
    const factBlock = invalidFact.blocks.find(
      (block) => block.type === 'fact_slots',
    );
    assert.ok(factBlock?.type === 'fact_slots');
    factBlock.config.factTypes = ['medical_claim' as never];
    await assert.rejects(
      () => studio.compile(invalidFact),
      /事实槽“medical_claim”不在门店事实分类中/u,
    );

    const missingPlatform = sampleDefinition();
    const platformBlock = missingPlatform.blocks.find(
      (block) => block.type === 'platform_adapter',
    );
    assert.ok(platformBlock?.type === 'platform_adapter');
    platformBlock.config.contentPackagePlatform = undefined as never;
    const compiled = await studio.compile(missingPlatform);
    await assert.rejects(
      () =>
        studio.validate({
          recipeId: compiled.recipeId,
          expectedRevision: compiled.revision,
          actorId: 'ops-1',
          reason: '校验缺失平台字段',
          correlationId: 'corr-invalid-platform',
        }),
      /必须同时声明内容平台和交付方式/u,
    );
  });

  it('rejects latest and unversioned Prompt or Skill dependencies', async () => {
    const { studio } = createServices();
    const latestPrompt = sampleDefinition();
    latestPrompt.dependencies.promptRevisionRef = 'prompt.hair-care@latest';
    await assert.rejects(
      () => studio.compile(latestPrompt),
      /Prompt必须引用精确版本/u,
    );

    const unversionedSkill = sampleDefinition();
    unversionedSkill.dependencies.skillRevisionRefs = [
      'skill.beauty-story-structure',
    ];
    await assert.rejects(
      () => studio.compile(unversionedSkill),
      /Skill必须引用精确版本/u,
    );
  });

  it('rolls the production Surface back to the previous published Recipe revision', async () => {
    const { catalog, studio } = createServicesWithPermittingEvidence();
    const launch = await publishLaunchCatalog(catalog);

    const gate = async (
      definition: RecipeStudioCompileInput,
      runSuffix: string,
    ) => {
      const compiled = await studio.compile(definition);
      const validated = await studio.validate({
        recipeId: compiled.recipeId,
        expectedRevision: compiled.revision,
        actorId: 'ops-1',
        reason: `validator ${runSuffix}`,
        correlationId: `corr-validator-${runSuffix}`,
      });
      const evaluated = await studio.recordEvaluation({
        recipeId: validated.recipeId,
        expectedRevision: validated.revision,
        actorId: 'ops-1',
        reason: `eval ${runSuffix}`,
        correlationId: `corr-eval-${runSuffix}`,
        evidenceReceiptId: `eval-${runSuffix}`,
      });
      return studio.recordInternalTest({
        recipeId: evaluated.recipeId,
        expectedRevision: evaluated.revision,
        actorId: 'ops-1',
        reason: `internal ${runSuffix}`,
        correlationId: `corr-internal-${runSuffix}`,
        evidenceReceiptId: `internal-${runSuffix}`,
      });
    };

    const v1Ready = await gate(sampleDefinition(), 'v1');
    const v1 = await studio.switchProduction({
      recipeId: v1Ready.recipeId,
      expectedRevision: v1Ready.revision,
      surfaceId: LAUNCH_SURFACE_ID,
      expectedSurfaceRevision: launch.surface.revision,
      actorId: 'ops-1',
      reason: 'publish v1',
      correlationId: 'corr-publish-v1',
    });

    const v2Definition = sampleDefinition();
    v2Definition.expectedRevision = v1.recipe.revision;
    v2Definition.presentation.title = '护发误区科普新版';
    v2Definition.dependencies.promptRevisionRef =
      'prompt.hair-care-education@13';
    const v2Ready = await gate(v2Definition, 'v2');
    const v2 = await studio.switchProduction({
      recipeId: v2Ready.recipeId,
      expectedRevision: v2Ready.revision,
      surfaceId: LAUNCH_SURFACE_ID,
      expectedSurfaceRevision: v1.surface.revision,
      actorId: 'ops-1',
      reason: 'publish v2',
      correlationId: 'corr-publish-v2',
    });

    const rolledBack = await studio.rollbackProduction({
      recipeId: v2.recipe.recipeId,
      expectedRevision: v2.recipe.revision,
      targetRevision: v1.recipe.revision,
      surfaceId: LAUNCH_SURFACE_ID,
      expectedSurfaceRevision: v2.surface.revision,
      actorId: 'ops-1',
      reason: 'rollback to v1',
      correlationId: 'corr-rollback-v1',
    });

    assert.equal(rolledBack.recipe.status, 'published');
    assert.equal(
      rolledBack.recipe.rolledBackToRevision,
      v1.recipe.revision,
    );
    const browser = await catalog.projectBrowserSurface(LAUNCH_SURFACE_ID);
    const visible = browser.recipes.find(
      (recipe) => recipe.recipeId === v1.recipe.recipeId,
    );
    assert.equal(visible?.revisionId, rolledBack.recipe.revisionId);
    assert.equal(visible?.presentation.title, '护发误区科普');
  });
});
