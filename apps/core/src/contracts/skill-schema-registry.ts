import { z } from 'zod';
import {
  assistantContextSchema,
  marketingSceneSchema,
  nonEmptyTrimmedStringSchema,
} from '@meiye/contracts';

const skillAssetReferenceSchema = nonEmptyTrimmedStringSchema.max(200);
const intentDecisionFieldSchema = nonEmptyTrimmedStringSchema.max(200);
const intentDecisionQuestionSchema = nonEmptyTrimmedStringSchema.max(2_000);
const intentDecisionOptionSchema = nonEmptyTrimmedStringSchema.max(500);

export const SKILL_OPERATING_ASSET_CATEGORIES = [
  'store',
  'product_service',
  'promotion_activity',
  'brand',
  'personal_ip',
  'material',
  'history_preference',
  'industry_category',
] as const;

export const skillOperatingAssetCategorySchema = z.enum(
  SKILL_OPERATING_ASSET_CATEGORIES,
);

export const dailyIndustrySkillInputSchema = z
  .object({
    context: assistantContextSchema.strict(),
    assetReferences: z.array(skillAssetReferenceSchema).max(50),
  })
  .strict();

const intentDecisionBlockingGapSchema = z
  .object({
    field: intentDecisionFieldSchema,
    question: intentDecisionQuestionSchema,
    options: z.array(intentDecisionOptionSchema).max(12),
    allowFreeText: z.boolean(),
    scope: z.enum(['current_task', 'current_series', 'workspace']),
  })
  .strict();

export const intentDecisionSkillOutputSchema = z
  .object({
    normalizedIntent: nonEmptyTrimmedStringSchema.max(4_000),
    taskType: marketingSceneSchema,
    deliveryLayer: z.enum(['copy', 'finished_media']),
    relevantAssetCategories: z
      .array(skillOperatingAssetCategorySchema)
      .max(SKILL_OPERATING_ASSET_CATEGORIES.length),
    usedAssetCategories: z
      .array(skillOperatingAssetCategorySchema)
      .max(SKILL_OPERATING_ASSET_CATEGORIES.length),
    route: z.enum(['customized', 'guidance']),
    implicitConstraints: z.array(nonEmptyTrimmedStringSchema).max(30),
    blockingGap: intentDecisionBlockingGapSchema.nullable(),
  })
  .strict()
  .superRefine((output, context) => {
    const relevantCategories = new Set(output.relevantAssetCategories);
    if (
      output.usedAssetCategories.some(
        (category) => !relevantCategories.has(category),
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Used asset categories must also be relevant.',
        path: ['usedAssetCategories'],
      });
    }
    if (output.route === 'customized') {
      if (output.usedAssetCategories.length === 0) {
        context.addIssue({
          code: 'custom',
          message: 'Customized routing requires at least one useful category.',
          path: ['usedAssetCategories'],
        });
      }
      if (output.blockingGap !== null) {
        context.addIssue({
          code: 'custom',
          message: 'Customized routing cannot carry a guidance question.',
          path: ['blockingGap'],
        });
      }
    }
    if (output.route === 'guidance' && output.blockingGap === null) {
      context.addIssue({
        code: 'custom',
        message: 'Guidance routing requires one focused question.',
        path: ['blockingGap'],
      });
    }
  });

export const SKILL_SCHEMA_REFS = Object.freeze([
  'skill-input.daily-industry@1',
  'skill-output.intent-decision@1',
] as const);

export type SkillSchemaRef = (typeof SKILL_SCHEMA_REFS)[number];

const skillSchemaRegistry = {
  'skill-input.daily-industry@1': dailyIndustrySkillInputSchema,
  'skill-output.intent-decision@1': intentDecisionSkillOutputSchema,
} as const satisfies Record<SkillSchemaRef, z.ZodType<unknown>>;

const skillSchemaRefPattern =
  /^skill-(?:input|output)\.[a-z0-9]+(?:[._-][a-z0-9]+)*@[1-9][0-9]*$/u;

export function listSkillSchemaRefs(): readonly SkillSchemaRef[] {
  return [...SKILL_SCHEMA_REFS];
}

export function resolveSkillSchema(ref: string): z.ZodType<unknown> {
  if (!skillSchemaRefPattern.test(ref)) {
    throw new Error(`Invalid Skill schema ref: ${ref}`);
  }
  if (!Object.hasOwn(skillSchemaRegistry, ref)) {
    throw new Error(`Unknown Skill schema ref: ${ref}`);
  }
  return skillSchemaRegistry[ref as SkillSchemaRef];
}

export function parseSkillSchema(ref: string, value: unknown): unknown {
  return resolveSkillSchema(ref).parse(value);
}
