import { z } from 'zod';
import { creativeExecutionContractSchema } from './uiux.js';

export const DEFAULT_CANVAS_WORK_NAME = 'canvas-work:untitled';
export const DEFAULT_CANVAS_TEMPLATE_NAME = 'canvas-template:untitled';
export const OFFICIAL_CANVAS_WORK_NAME_PREFIX = 'canvas-work:official:';
export const OFFICIAL_CANVAS_TEMPLATE_NAME_PREFIX =
  'canvas-template:official:';

export function officialCanvasWorkName(family: string) {
  return `${OFFICIAL_CANVAS_WORK_NAME_PREFIX}${family}`;
}

export function officialCanvasTemplateName(family: string) {
  return `${OFFICIAL_CANVAS_TEMPLATE_NAME_PREFIX}${family}`;
}

export const p1ModuleRequestSchema = z.object({
  module: z.enum([
    'advanced-canvas',
    'admin-config',
    'asset-memory',
    'context',
    'creation-experience',
    'operations',
    'entitlements',
    'integrations',
    'job-runtime',
    'marketing-identity',
    'model-supply',
    'product-billing',
    'redemptions',
    'result-delivery',
    'video-regeneration',
  ]),
  action: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export type P1ModuleRequest = z.infer<typeof p1ModuleRequestSchema>;

export const generatedCopyCandidateSchema = z.object({
  title: z.string().trim().min(1),
  body: z.string().trim().min(1),
  conversionHook: z.string().trim().min(1),
});

export const generatedCopyCandidatesSchema = z.object({
  candidates: z.array(generatedCopyCandidateSchema).length(3),
});

export type GeneratedCopyCandidateContent = z.infer<
  typeof generatedCopyCandidateSchema
>;
export type GeneratedCopyCandidates = z.infer<
  typeof generatedCopyCandidatesSchema
>;

export const generatedPlatformVariantContentSchema = z.object({
  title: z.string().trim().min(1),
  body: z.string().trim().min(1),
  conversionHook: z.string().trim().min(1),
  topics: z.array(z.string().trim().min(1)).min(1),
});

export const generatedPlatformVariantsSchema = z.object({
  xiaohongshu: generatedPlatformVariantContentSchema,
  douyin: generatedPlatformVariantContentSchema,
  video_account: generatedPlatformVariantContentSchema,
}).strict();

export type GeneratedPlatformVariantContent = z.infer<
  typeof generatedPlatformVariantContentSchema
>;
export type GeneratedPlatformVariants = z.infer<
  typeof generatedPlatformVariantsSchema
>;

export const assistantFieldPatchBaseSchema = z
  .object({
    field: z.string().trim().min(1).max(200),
    value: z.string().trim().min(1).max(2_000),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const assistantFieldPatchSchema = assistantFieldPatchBaseSchema.extend({
  field: z.enum(['intent', 'scene', 'tone', 'audience']),
});

export const assistantContextSchema = z.object({
  workId: z.string().trim().min(1),
  intent: z.string().trim().min(1).max(4_000),
  scene: z.string().trim().max(500).optional(),
  tone: z.string().trim().max(500).optional(),
  audience: z.string().trim().max(500).optional(),
  sourceSummaries: z.array(z.string().trim().min(1).max(1_000)).max(12),
});

export const assistantStreamRequestSchema = z.object({
  catalogModelId: z.string().trim().min(1),
  context: assistantContextSchema,
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(4_000),
      })
    )
    .min(1)
    .max(20),
});

export const copyStreamRequestSchema = z.object({
  catalogModelId: z.string().trim().min(1),
  workId: z.string().trim().min(1),
  submissionKey: z.string().trim().min(1).max(200),
  contract: creativeExecutionContractSchema,
});

export const assistantDataPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('context'), data: assistantContextSchema }),
  z.object({ type: z.literal('field_patch'), data: assistantFieldPatchSchema }),
]);

export const durationEstimateSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('observed'),
    p50Seconds: z.number().int().positive(),
    p90Seconds: z.number().int().positive(),
    sampleSize: z.number().int().min(5),
    windowDays: z.literal(30),
    asOf: z.iso.datetime(),
  }),
  z.object({
    status: z.literal('insufficient_data'),
    sampleSize: z.number().int().nonnegative(),
    minimumSampleSize: z.literal(5),
    windowDays: z.literal(30),
    asOf: z.iso.datetime(),
  }),
]);

export type AssistantStreamRequest = z.infer<
  typeof assistantStreamRequestSchema
>;
export type CopyStreamRequest = z.infer<typeof copyStreamRequestSchema>;
export type AssistantFieldPatch = z.infer<typeof assistantFieldPatchSchema>;
export type DurationEstimate = z.infer<typeof durationEstimateSchema>;
