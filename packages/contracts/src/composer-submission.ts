import { z } from 'zod';

const identifierSchema = z.string().trim().min(1).max(200);
const revisionSchema = z.string().trim().min(1).max(200);

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
  'publish:xiaohongshu',
  'publish:douyin',
  'publish:video_account',
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
  })
  .strict();

/**
 * User-confirmed fields covered by the quote preview and admission freeze.
 *
 * The picker derives its allowlist from this schema shape, so adding a future
 * signed field (for example `creationMode`) extends the contract without
 * creating a second signing or freeze mechanism.
 */
export const composerSubmissionSignedFieldsSchema = z
  .object({
    catalogModel: composerRevisionReferenceSchema,
    recipe: composerRevisionReferenceSchema,
    contentPackagePlatform: composerContentPackagePlatformSchema,
    distributionTarget: composerDistributionTargetSchema,
    deliverable: composerSubmissionDeliverableSchema,
  })
  .strict();

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
  for (const key of Object.keys(composerSubmissionSignedFieldsSchema.shape)) {
    picked[key] = input[key];
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
