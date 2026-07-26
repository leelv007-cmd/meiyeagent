import type { RecipeStudioCompileInput } from './recipe-studio.js';

type RecipeStudioSampleDefinition = Omit<
  RecipeStudioCompileInput,
  'actorId' | 'correlationId' | 'expectedRevision' | 'reason'
>;

function sample(
  input: Pick<
    RecipeStudioSampleDefinition,
    'industryKey' | 'presentation' | 'recipeId'
  > & {
    factTypes: Array<
      'qualification' | 'service' | 'staff_experience'
    >;
    promptRevisionRef: string;
    segments: Array<
      | 'cta'
      | 'pain_point'
      | 'professional_insight'
      | 'proof'
      | 'service_solution'
    >;
  },
): RecipeStudioSampleDefinition {
  return {
    recipeId: input.recipeId,
    industryKey: input.industryKey,
    presentation: input.presentation,
    dependencies: {
      promptRevisionRef: input.promptRevisionRef,
      skillRevisionRefs: [
        'skill.beauty-story-structure@1',
        'skill.platform-adaptation@1',
      ],
      workflowRevisionRef: 'workflow.recipe-studio@1',
      outputContractRef: 'output.image-text-note@1',
      quotePolicyRevisionRef: 'quote.policy@1',
    },
    modelPolicy: { mode: 'auto' },
    blocks: [
      {
        id: 'intent',
        stage: 'intent_naming',
        type: 'intent_type',
        config: { intentTypes: ['daily_exposure'] },
      },
      {
        id: 'facts',
        stage: 'context_injection',
        type: 'fact_slots',
        config: { factTypes: input.factTypes },
      },
      {
        id: 'story',
        stage: 'brief_compilation',
        type: 'story_structure',
        config: { segments: input.segments },
      },
      {
        id: 'output',
        stage: 'brief_compilation',
        type: 'output_contract',
        config: {
          outputKind: 'image_text_note',
          quantity: 1,
          aspectRatio: '3:4',
          notePageBound: 3,
        },
      },
      {
        id: 'candidate',
        stage: 'execution_selection',
        type: 'candidate_strategy',
        config: { strategy: 'dual_style_user_choice' },
      },
      {
        id: 'platform',
        stage: 'assembly_delivery',
        type: 'platform_adapter',
        config: {
          contentPackagePlatform: 'xiaohongshu',
          distributionTarget: 'export',
        },
      },
    ],
  };
}

/**
 * Credential-free examples used before C-6 industry priors are supplied.
 * They remain Recipe Studio authoring inputs and do not change the formal
 * eight launch Recipe seeds.
 */
export const RECIPE_STUDIO_SAMPLE_DEFINITIONS: readonly RecipeStudioSampleDefinition[] =
  [
    sample({
      recipeId: 'recipe.sample.hair-care',
      industryKey: 'hair_care',
      presentation: {
        title: '护发误区科普',
        summary: '用项目与技师经验讲清日常护发误区',
      },
      factTypes: ['service', 'staff_experience'],
      promptRevisionRef: 'prompt.sample.hair-care@1',
      segments: [
        'pain_point',
        'professional_insight',
        'service_solution',
        'cta',
      ],
    }),
    sample({
      recipeId: 'recipe.sample.skin-management',
      industryKey: 'skin_management',
      presentation: {
        title: '皮肤管理方案说明',
        summary: '用服务项目与资质信息说明护理方案',
      },
      factTypes: ['service', 'qualification'],
      promptRevisionRef: 'prompt.sample.skin-management@1',
      segments: [
        'pain_point',
        'professional_insight',
        'service_solution',
        'proof',
        'cta',
      ],
    }),
    sample({
      recipeId: 'recipe.sample.hair-growth',
      industryKey: 'hair_growth',
      presentation: {
        title: '头皮养护知识',
        summary: '用项目、资质与专业经验生成头皮养护内容',
      },
      factTypes: ['service', 'qualification', 'staff_experience'],
      promptRevisionRef: 'prompt.sample.hair-growth@1',
      segments: [
        'pain_point',
        'professional_insight',
        'proof',
        'service_solution',
        'cta',
      ],
    }),
  ];

export function listRecipeStudioSampleDefinitions() {
  return structuredClone(RECIPE_STUDIO_SAMPLE_DEFINITIONS);
}
