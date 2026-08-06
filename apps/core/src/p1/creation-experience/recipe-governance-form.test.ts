import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CreationExperienceCatalogService } from './catalog-service.js';
import { CreationExperienceFoundationModule } from './foundation-module.js';
import { MemoryCreationExperienceCatalogRepository } from './memory-repository.js';
import {
  RECIPE_GOVERNANCE_BLOCK_IDS,
  adaptRecipeGovernanceFormToCompileInput,
  parseRecipeGovernanceFormInput,
  type RecipeGovernanceFormInput,
} from './recipe-governance-form.js';
import type { ServerRecipeRecord } from './types.js';

const context = {
  workspaceId: 'workspace-a',
  userId: 'ops-1',
  correlationId: 'corr-recipe-governance-1',
  actor: 'admin' as const,
};

function sampleFormPayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    recipeId: 'recipe.hair-care.education',
    expectedRevision: null,
    reason: 'Templates 治理保存',
    industryKey: 'hair_care',
    presentation: {
      title: '护发误区科普',
      summary: '用门店项目与专业知识生成护发科普内容',
    },
    familyId: 'education_note',
    contextPatches: { tone: 'professional' },
    settingsPatches: { locale: 'zh-CN' },
    modelPolicy: { mode: 'auto' },
    promptRevisionRef: 'prompt.hair-care-education@12',
    skillRevisionRefs: [
      'skill.beauty-story-structure@3',
      'skill.platform-adaptation@7',
    ],
    workflowRevisionRef: 'workflow.recipe-studio@2',
    outputContractRef: 'output.image-text-note@4',
    quotePolicyRevisionRef: 'quote.policy@5',
    factTypes: ['service', 'staff_experience'],
    sourceRequirements: [{ slot: 'store_facts', required: true }],
    intentTypes: ['daily_exposure'],
    storySegments: [
      'pain_point',
      'professional_insight',
      'service_solution',
      'cta',
    ],
    output: {
      outputKind: 'image_text_note',
      quantity: 1,
      aspectRatio: '3:4',
      notePageBound: 3,
    },
    candidateStrategy: 'dual_style_user_choice',
    platform: {
      contentPackagePlatform: 'xiaohongshu',
      distributionTarget: 'export',
    },
    ...overrides,
  };
}

function createModule(unavailableSkillRefs: string[] = []) {
  const repository = new MemoryCreationExperienceCatalogRepository();
  const catalog = new CreationExperienceCatalogService(
    repository,
    () => '2026-07-25T12:00:00.000Z',
  );
  const module = new CreationExperienceFoundationModule(repository, catalog, {
    skillRevisionValidation: {
      async listUnavailableFrozenRevisionRefs() {
        return unavailableSkillRefs;
      },
    },
  });
  return { module, catalog, repository };
}

describe('RecipeGovernanceFormInput adapter (#372)', () => {
  it('maps form fields to six controlled blocks, industryKey, and dependencies without studioRelease', () => {
    const form = parseRecipeGovernanceFormInput(sampleFormPayload(), {
      actorId: 'ops-1',
      reason: 'Templates 治理保存',
      correlationId: 'corr-map',
    });
    const compileInput = adaptRecipeGovernanceFormToCompileInput(form);

    assert.equal(compileInput.industryKey, 'hair_care');
    assert.equal(compileInput.familyId, 'education_note');
    assert.deepEqual(compileInput.contextPatches, { tone: 'professional' });
    assert.deepEqual(compileInput.settingsPatches, { locale: 'zh-CN' });
    assert.deepEqual(compileInput.dependencies, {
      promptRevisionRef: 'prompt.hair-care-education@12',
      skillRevisionRefs: [
        'skill.beauty-story-structure@3',
        'skill.platform-adaptation@7',
      ],
      workflowRevisionRef: 'workflow.recipe-studio@2',
      outputContractRef: 'output.image-text-note@4',
      quotePolicyRevisionRef: 'quote.policy@5',
    });
    assert.deepEqual(
      compileInput.blocks.map((block) => block.type),
      [
        'intent_type',
        'fact_slots',
        'story_structure',
        'output_contract',
        'candidate_strategy',
        'platform_adapter',
      ],
    );
    assert.deepEqual(
      compileInput.blocks.map((block) => block.id),
      Object.values(RECIPE_GOVERNANCE_BLOCK_IDS),
    );
    assert.equal('studioRelease' in compileInput, false);
    assert.equal(
      Object.prototype.hasOwnProperty.call(compileInput, 'studioRelease'),
      false,
    );

    const intent = compileInput.blocks.find(
      (block) => block.type === 'intent_type',
    );
    const facts = compileInput.blocks.find(
      (block) => block.type === 'fact_slots',
    );
    const story = compileInput.blocks.find(
      (block) => block.type === 'story_structure',
    );
    const output = compileInput.blocks.find(
      (block) => block.type === 'output_contract',
    );
    const candidate = compileInput.blocks.find(
      (block) => block.type === 'candidate_strategy',
    );
    const platform = compileInput.blocks.find(
      (block) => block.type === 'platform_adapter',
    );
    assert.ok(intent?.type === 'intent_type');
    assert.deepEqual(intent.config.intentTypes, ['daily_exposure']);
    assert.ok(facts?.type === 'fact_slots');
    assert.deepEqual(facts.config.factTypes, ['service', 'staff_experience']);
    assert.deepEqual(facts.config.sourceRequirements, [
      { slot: 'store_facts', required: true },
    ]);
    assert.ok(story?.type === 'story_structure');
    assert.deepEqual(story.config.segments, [
      'pain_point',
      'professional_insight',
      'service_solution',
      'cta',
    ]);
    assert.ok(output?.type === 'output_contract');
    assert.equal(output.config.outputKind, 'image_text_note');
    assert.equal(output.config.notePageBound, 3);
    assert.ok(candidate?.type === 'candidate_strategy');
    assert.equal(candidate.config.strategy, 'dual_style_user_choice');
    assert.ok(platform?.type === 'platform_adapter');
    assert.equal(platform.config.contentPackagePlatform, 'xiaohongshu');
    assert.equal(platform.config.distributionTarget, 'export');
  });

  it('saves through the creation-experience command seam with server-only studioRelease', async () => {
    const { module } = createModule();
    const payload = sampleFormPayload();

    const result = (await module.execute({
      context,
      idempotencyKey: 'gov-save-hair-care-v1',
      input: {
        action: 'recipe_governance_save',
        payload,
      },
    })) as ServerRecipeRecord;

    assert.equal(result.revision, 2);
    assert.equal(result.status, 'draft');
    assert.equal(result.studioRelease?.phase, 'validated');
    assert.equal(
      result.studioRelease?.compilationReceipt.industryKey,
      'hair_care',
    );
    assert.equal(
      result.studioRelease?.compilationReceipt.promptRevisionRef,
      'prompt.hair-care-education@12',
    );
    assert.deepEqual(
      result.studioRelease?.compilationReceipt.skillRevisionRefs,
      [
        'skill.beauty-story-structure@3',
        'skill.platform-adaptation@7',
      ],
    );
    assert.deepEqual(result.factTypes, ['service', 'staff_experience']);
    assert.equal(result.promptRevisionRef, 'prompt.hair-care-education@12');
    assert.deepEqual(result.skillRevisionRefs, [
      'skill.beauty-story-structure@3',
      'skill.platform-adaptation@7',
    ]);
    assert.equal(
      (result.contextPatches as { recipeStudioPlan?: { industryKey?: string } })
        .recipeStudioPlan?.industryKey,
      'hair_care',
    );
    assert.equal(
      (result.settingsPatches as { candidateStrategy?: string })
        .candidateStrategy,
      'dual_style_user_choice',
    );
    assert.equal(
      (result.settingsPatches as { outputKind?: string }).outputKind,
      'image_text_note',
    );
    // Pass-through patches retained under server overlays.
    assert.equal(
      (result.contextPatches as { tone?: string }).tone,
      'professional',
    );
    assert.equal((result.settingsPatches as { locale?: string }).locale, 'zh-CN');
  });

  it('rejects missing required form fields through the command seam', async () => {
    const { module } = createModule();
    await assert.rejects(
      () =>
        module.execute({
          context,
          idempotencyKey: 'gov-missing-industry',
          input: {
            action: 'recipe_governance_save',
            payload: sampleFormPayload({ industryKey: '' }),
          },
        }),
      /行业标识不能为空/u,
    );
    await assert.rejects(
      () =>
        module.execute({
          context,
          idempotencyKey: 'gov-missing-prompt',
          input: {
            action: 'recipe_governance_save',
            payload: sampleFormPayload({ promptRevisionRef: undefined }),
          },
        }),
      /Prompt 版本引用不能为空/u,
    );
    await assert.rejects(
      () =>
        module.execute({
          context,
          idempotencyKey: 'gov-missing-intent',
          input: {
            action: 'recipe_governance_save',
            payload: sampleFormPayload({ intentTypes: undefined }),
          },
        }),
      /意图类型必须是列表/u,
    );
  });

  it('rejects invalid / latest revision refs through the command seam', async () => {
    const { module } = createModule();
    await assert.rejects(
      () =>
        module.execute({
          context,
          idempotencyKey: 'gov-latest-prompt',
          input: {
            action: 'recipe_governance_save',
            payload: sampleFormPayload({
              promptRevisionRef: 'prompt.hair-care@latest',
            }),
          },
        }),
      /Prompt.*精确版本/u,
    );
    await assert.rejects(
      () =>
        module.execute({
          context,
          idempotencyKey: 'gov-unversioned-skill',
          input: {
            action: 'recipe_governance_save',
            payload: sampleFormPayload({
              skillRevisionRefs: ['skill.beauty-story-structure'],
            }),
          },
        }),
      /Skill.*精确版本/u,
    );
  });

  it('rejects client-carried release state, blocks, and evidence fields on the form', async () => {
    const { module } = createModule();
    await assert.rejects(
      () =>
        module.execute({
          context,
          idempotencyKey: 'gov-forged-release',
          input: {
            action: 'recipe_governance_save',
            payload: sampleFormPayload({
              studioRelease: {
                phase: 'validated',
                compilationReceipt: { receiptId: 'forged' },
              },
            }),
          },
        }),
      /不得携带服务端专属字段“studioRelease”/u,
    );
    await assert.rejects(
      () =>
        module.execute({
          context,
          idempotencyKey: 'gov-raw-blocks',
          input: {
            action: 'recipe_governance_save',
            payload: sampleFormPayload({
              blocks: [
                {
                  id: 'intent',
                  stage: 'intent_naming',
                  type: 'intent_type',
                  config: { intentTypes: ['daily_exposure'] },
                },
                {
                  id: 'intent-dup',
                  stage: 'intent_naming',
                  type: 'intent_type',
                  config: { intentTypes: ['conversion'] },
                },
              ],
            }),
          },
        }),
      /不得携带服务端专属字段“blocks”/u,
    );
    await assert.rejects(
      () =>
        module.execute({
          context,
          idempotencyKey: 'gov-passed',
          input: {
            action: 'recipe_governance_save',
            payload: sampleFormPayload({ passed: true }),
          },
        }),
      /不得携带服务端专属字段“passed”/u,
    );
  });

  it('rejects duplicate controlled blocks on the studio compile command seam', async () => {
    const { module } = createModule();
    const form = parseRecipeGovernanceFormInput(sampleFormPayload(), {
      actorId: 'ops-1',
      reason: 'dup blocks',
      correlationId: 'corr-dup',
    });
    const compileInput = adaptRecipeGovernanceFormToCompileInput(form);
    const duplicateBlocks = [
      ...compileInput.blocks,
      {
        id: 'intent-dup',
        stage: 'intent_naming' as const,
        type: 'intent_type' as const,
        config: { intentTypes: ['conversion' as const] },
      },
    ];

    await assert.rejects(
      () =>
        module.execute({
          context,
          idempotencyKey: 'studio-dup-blocks',
          input: {
            action: 'recipe_studio_compile',
            payload: {
              ...compileInput,
              blocks: duplicateBlocks,
              actorId: undefined,
              correlationId: undefined,
              reason: 'dup blocks',
            },
          },
        }),
      /受控积木“intent_type”必须且只能出现一次/u,
    );
  });

  it('keeps ordinary recipe_draft from becoming a governed save channel', async () => {
    const { module } = createModule();
    const draft = (await module.execute({
      context,
      idempotencyKey: 'draft-not-governed',
      input: {
        action: 'recipe_draft',
        payload: {
          recipeId: 'recipe.plain.draft',
          expectedRevision: null,
          reason: 'ordinary draft with forged release',
          body: {
            lensId: 'image_text',
            presentation: {
              title: '普通草稿',
              summary: '不得成为治理保存通道',
            },
            modelPolicy: { mode: 'auto' },
            promptRevisionRef: 'prompt.plain@1',
            skillRevisionRefs: ['skill.platform-adaptation@1'],
            targetWorkspaceKind: 'image_text',
            delivery: {
              contentPackagePlatform: 'xiaohongshu',
              distributionTarget: 'export',
              deliverableKind: 'note',
              quantity: 1,
            },
            studioRelease: {
              phase: 'validated',
              compilationReceipt: {
                receiptId: 'forged-receipt',
                compiledAt: '2026-01-01T00:00:00.000Z',
                industryKey: 'forged',
                stageRegistryRevision: 'recipe-studio-stage-registry@1',
                validatorRevision: 'recipe-validator@1',
                promptRevisionRef: 'prompt.plain@1',
                skillRevisionRefs: [],
                workflowRevisionRef: 'workflow.forged@1',
                outputContractRef: 'output.forged@1',
                quotePolicyRevisionRef: 'quote.forged@1',
              },
              validation: { checkedAt: '2026-01-01T00:00:00.000Z', passed: true },
              evaluation: null,
              internalTest: null,
            },
            hiddenPromptBody: 'SYSTEM: forged-hidden',
          },
        },
      },
    })) as ServerRecipeRecord;

    assert.equal(draft.studioRelease, undefined);
    assert.equal(draft.hiddenPromptBody, undefined);
    assert.doesNotMatch(JSON.stringify(draft), /forged-receipt|forged-hidden/);
  });

  it('preserves compile receipt, skill freeze, and production-homologous validation gates', async () => {
    // Positive: frozen skills → validated with receipt
    const ok = createModule();
    const validated = (await ok.module.execute({
      context,
      idempotencyKey: 'gov-gates-ok',
      input: {
        action: 'recipe_governance_save',
        payload: sampleFormPayload({ recipeId: 'recipe.gate.ok' }),
      },
    })) as ServerRecipeRecord;
    assert.equal(validated.studioRelease?.phase, 'validated');
    assert.equal(validated.studioRelease?.validation?.passed, true);
    assert.ok(validated.studioRelease?.compilationReceipt.receiptId);

    // Skill freeze: unavailable skill blocks validate step
    const frozen = createModule(['skill.platform-adaptation@7']);
    await assert.rejects(
      () =>
        frozen.module.execute({
          context,
          idempotencyKey: 'gov-gates-skill-freeze',
          input: {
            action: 'recipe_governance_save',
            payload: sampleFormPayload({ recipeId: 'recipe.gate.skill' }),
          },
        }),
      /不存在或尚未受理冻结：skill\.platform-adaptation@7/u,
    );

    // Production-homologous validator: missing platform semantics fail closed
    const badPlatform = createModule();
    await assert.rejects(
      () =>
        badPlatform.module.execute({
          context,
          idempotencyKey: 'gov-gates-platform',
          input: {
            action: 'recipe_governance_save',
            payload: sampleFormPayload({
              recipeId: 'recipe.gate.platform',
              platform: {
                contentPackagePlatform: 'xiaohongshu',
                // distributionTarget intentionally wrong type to fail validator after compile
                distributionTarget: undefined,
              },
            }),
          },
        }),
      /交付方式不能为空|必须同时声明内容平台和交付方式|治理表单输入不完整/u,
    );
  });

  it('does not infer industryKey from lens and keeps form industryKey authoritative', () => {
    const form = parseRecipeGovernanceFormInput(
      sampleFormPayload({ industryKey: 'skin_management' }),
      {
        actorId: 'ops-1',
        reason: 'industry authority',
        correlationId: 'corr-industry',
      },
    ) as RecipeGovernanceFormInput;
    const compileInput = adaptRecipeGovernanceFormToCompileInput(form);
    assert.equal(compileInput.industryKey, 'skin_management');
    // Adapter never reads a lensId field — form has no lens to guess from.
    assert.equal('lensId' in form, false);
    assert.equal('lensId' in compileInput, false);
  });
});
