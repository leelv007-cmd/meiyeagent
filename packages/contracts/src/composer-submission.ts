import { z } from 'zod';
import { nonEmptyTrimmedStringSchema } from './identifiers.js';
import {
  MAX_NOTE_PLAN_PAGE_COUNT,
  MIN_NOTE_PLAN_PAGE_COUNT,
} from './note-plan.js';
import { creationModeSchema } from './harness.js';
import { imageIntentOperationSchema } from './image-intent.js';
import {
  beautyVoiceRoleSchema,
  thinkingLevelSchema,
} from './composer-generation-params.js';

const identifierSchema = nonEmptyTrimmedStringSchema.max(200);
const revisionSchema = nonEmptyTrimmedStringSchema.max(200);

export const composerContentPackagePlatformIds = [
  'xiaohongshu',
  'douyin',
  'video_account',
  'wechat_moments',
  'offline_material',
  'generic',
] as const;

export const composerContentPackagePlatformSchema = z.enum(
  composerContentPackagePlatformIds,
);

export const composerDistributionTargetIds = [
  'export',
  'manual_copy',
  'assisted_handoff',
] as const;

export const composerDistributionTargetSchema = z.enum(
  composerDistributionTargetIds,
);

export const composerDeliverableKindIds = [
  'copy_document',
  'note',
  'image_set',
  'poster',
  'image_text_package',
  'video_package',
] as const;

export const composerDeliverableKindSchema = z.enum(
  composerDeliverableKindIds,
);

export const composerRevisionReferenceSchema = z
  .object({
    id: identifierSchema,
    revision: revisionSchema,
  })
  .strict();

export const composerSubmissionDeliverableSchema = z
  .object({
    kind: composerDeliverableKindSchema,
    quantity: z.number().int().min(1).max(20),
    aspectRatio: z.enum(['1:1', '3:4', '9:16']).optional(),
    durationSeconds: z.number().int().min(1).max(3_600).optional(),
    notePageBound: z
      .number()
      .int()
      .min(MIN_NOTE_PLAN_PAGE_COUNT)
      .max(MAX_NOTE_PLAN_PAGE_COUNT)
      .optional(),
  })
  .strict();

export const composerAiCoverBeautyPresetIds = [
  'beauty_soft',
  'beauty_editorial',
  'before_after',
  'spa_minimal',
  'salon_photo',
] as const;

export const composerAiCoverBeautyPresetSchema = z.enum(
  composerAiCoverBeautyPresetIds,
);

/**
 * The provider size is signed together with the merchant-facing ratio. A
 * discriminated union prevents a valid ratio from being paired with a size
 * belonging to another output shape.
 */
export const composerAiCoverSchema = z.discriminatedUnion('aspectRatio', [
  z
    .object({
      aspectRatio: z.literal('3:4'),
      style: composerAiCoverBeautyPresetSchema,
      size: z.literal('1536x2048'),
    })
    .strict(),
  z
    .object({
      aspectRatio: z.literal('1:1'),
      style: composerAiCoverBeautyPresetSchema,
      size: z.literal('2048x2048'),
    })
    .strict(),
  z
    .object({
      aspectRatio: z.literal('9:16'),
      style: composerAiCoverBeautyPresetSchema,
      size: z.literal('1152x2048'),
    })
    .strict(),
]);

export const composerViralAdaptSourceSchema = z
  .object({
    schemaVersion: z.literal('viral-adapt-source/v1'),
    track: z.enum(['paste', 'opencli_link']),
    noteText: nonEmptyTrimmedStringSchema.max(4_000),
    authorizedAssetIds: z.array(identifierSchema).max(50),
  })
  .strict();

/**
 * User-confirmed fields covered by the quote preview and admission freeze.
 *
 * The picker derives its allowlist from this schema shape, so adding a future
 * signed field (for example `creationMode`) extends the contract without
 * creating a second signing or freeze mechanism.
 */
export const composerSubmissionSignedFieldsBaseSchema = z
  .object({
    creationMode: creationModeSchema,
    intent: nonEmptyTrimmedStringSchema.max(4_000),
    imageOperation: imageIntentOperationSchema.optional(),
    catalogModel: composerRevisionReferenceSchema,
    recipe: composerRevisionReferenceSchema,
    contentPackagePlatform: composerContentPackagePlatformSchema,
    distributionTarget: composerDistributionTargetSchema,
    deliverable: composerSubmissionDeliverableSchema,
    aiCover: composerAiCoverSchema.optional(),
    viralAdaptSource: composerViralAdaptSourceSchema.optional(),
    beautyVoiceRole: beautyVoiceRoleSchema.optional(),
    thinkingLevel: thinkingLevelSchema.optional(),
  })
  .strict();

export const composerSubmissionSignedFieldsSchema =
  composerSubmissionSignedFieldsBaseSchema.superRefine((submission, context) => {
    const usesViralAdaptRecipe = submission.recipe.id === 'recipe.viral_adapt';
    if (usesViralAdaptRecipe !== (submission.viralAdaptSource !== undefined)) {
      context.addIssue({
        code: 'custom',
        message:
          'Viral adapt requires both the exact recipe.viral_adapt binding and one structured source.',
        path: ['viralAdaptSource'],
      });
    }
    if (
      submission.creationMode === 'customized' &&
      submission.beautyVoiceRole !== undefined
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Customized creation uses MarketingIdentity and cannot carry a hidden beauty voice override.',
        path: ['beautyVoiceRole'],
      });
    }
    if (
      submission.creationMode === 'customized' &&
      submission.thinkingLevel !== undefined &&
      submission.thinkingLevel !== 'standard'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Customized creation uses standard thinking.',
        path: ['thinkingLevel'],
      });
    }
    if (
      submission.imageOperation !== undefined &&
      submission.creationMode !== 'free'
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Only free image creation may declare an explicit image operation.',
        path: ['imageOperation'],
      });
    }
    if (
      submission.imageOperation !== undefined &&
      submission.deliverable.kind !== 'image_set' &&
      submission.deliverable.kind !== 'poster'
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'An explicit image operation requires an image deliverable.',
        path: ['imageOperation'],
      });
    }
    if (submission.aiCover === undefined) return;
    if (
      submission.creationMode !== 'free' ||
      submission.imageOperation !== 'image.generate' ||
      submission.recipe.id !== 'recipe.promotion_poster' ||
      submission.contentPackagePlatform !== 'xiaohongshu' ||
      submission.deliverable.kind !== 'poster' ||
      submission.deliverable.quantity !== 1
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'AI cover requires the promotion-poster recipe and one free Xiaohongshu image.',
        path: ['aiCover'],
      });
    }
    if (
      submission.deliverable.aspectRatio !== submission.aiCover.aspectRatio
    ) {
      context.addIssue({
        code: 'custom',
        message: 'AI cover ratio must match the signed deliverable ratio.',
        path: ['aiCover', 'aspectRatio'],
      });
    }
  });

export type ComposerContentPackagePlatform = z.infer<
  typeof composerContentPackagePlatformSchema
>;
export type ComposerDistributionTarget = z.infer<
  typeof composerDistributionTargetSchema
>;
export type ComposerDeliverableKind = z.infer<
  typeof composerDeliverableKindSchema
>;
export type ComposerSubmissionSignedFields = z.infer<
  typeof composerSubmissionSignedFieldsSchema
>;

export function pickComposerSubmissionSignedFields(
  input: Record<string, unknown>,
): ComposerSubmissionSignedFields {
  const picked: Record<string, unknown> = {};
  for (const key of Object.keys(composerSubmissionSignedFieldsBaseSchema.shape)) {
    if (input[key] !== undefined) picked[key] = input[key];
  }
  return composerSubmissionSignedFieldsSchema.parse(picked);
}

export function isComposerVariantPlatform(
  platform: ComposerContentPackagePlatform,
): platform is 'xiaohongshu' | 'douyin' | 'video_account' {
  return (
    platform === 'xiaohongshu' ||
    platform === 'douyin' ||
    platform === 'video_account'
  );
}
