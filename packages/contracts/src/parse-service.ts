import { z } from 'zod';

import { storeFactCandidateDraftSchema } from './asset-intake.js';

const idSchema = z.string().trim().min(1);
const timestampSchema = z.iso.datetime();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const PARSE_INPUT_KINDS = [
  'document_image',
  'document_pdf',
  'office_document',
  'html',
  'visual_asset',
  'sensitive_document',
] as const;

export const ASSET_DRAFT_TARGETS = [
  'price_list',
  'group_buy',
  'store_profile',
  'brand_reference',
  'visual_asset',
] as const;

export const ASSET_FIELD_PROVENANCE = [
  'user',
  'photo_extract',
  'ai_suggestion',
] as const;

export const VISUAL_ASSET_SLOTS = [
  'work_case',
  'store_scene',
  'product',
  'subject_person',
] as const;

export const PARSE_PROVIDER_KINDS = ['mineru_official', 'fixture'] as const;

export const parseSourceAssetInputSchema = z
  .object({
    assetId: idSchema,
    objectKey: idSchema,
    sha256: sha256Schema,
    sizeBytes: z.number().int().positive(),
    contentType: idSchema,
    sourceUrl: z.url().nullable(),
    inputKind: z.enum(PARSE_INPUT_KINDS),
    target: z.enum(ASSET_DRAFT_TARGETS),
    rightsStatus: z.enum(['confirmed', 'unconfirmed', 'not_required']),
  })
  .strict();

export const parseOwnedAssetSchema = parseSourceAssetInputSchema
  .extend({
    workspaceId: idSchema,
    createdAt: timestampSchema,
  })
  .strict();

export const parsedDocumentSchema = z
  .object({
    parsedDocumentId: idSchema,
    workspaceId: idSchema,
    taskId: idSchema,
    sourceAssetId: idSchema,
    parser: z
      .object({
        kind: z.enum(PARSE_PROVIDER_KINDS),
        version: idSchema,
        providerTaskRef: idSchema,
      })
      .strict(),
    markdown: z.string(),
    structured: z.json(),
    extractedPages: z.number().int().nonnegative(),
    totalPages: z.number().int().positive(),
    createdAt: timestampSchema,
  })
  .strict()
  .superRefine((document, context) => {
    if (document.extractedPages > document.totalPages) {
      context.addIssue({
        code: 'custom',
        message: 'extractedPages cannot exceed totalPages.',
        path: ['extractedPages'],
      });
    }
  });

export const assetDraftFieldSchema = z
  .object({
    key: idSchema,
    value: z.json(),
    provenance: z.enum(ASSET_FIELD_PROVENANCE),
    status: z.literal('unconfirmed'),
  })
  .strict();

export const visualAssetClassificationSchema = z
  .object({
    slot: z.enum(VISUAL_ASSET_SLOTS),
    description: idSchema,
    rightsPrompt: z
      .object({
        message: idSchema,
        skippable: z.literal(true),
        blocking: z.literal(false),
      })
      .strict(),
  })
  .strict();

export const assetDraftSchema = z
  .object({
    draftId: idSchema,
    revision: z.number().int().positive(),
    workspaceId: idSchema,
    taskId: idSchema,
    sourceAssetId: idSchema,
    parsedDocumentId: idSchema.nullable(),
    target: z.enum(ASSET_DRAFT_TARGETS),
    origin: z.enum(['parsed', 'manual', 'fallback', 'ai_suggestion']),
    fields: z.array(assetDraftFieldSchema),
    factCandidates: z.array(storeFactCandidateDraftSchema),
    visualClassification: visualAssetClassificationSchema.nullable(),
    createdAt: timestampSchema,
  })
  .strict()
  .superRefine((draft, context) => {
    if (draft.origin === 'parsed' && draft.parsedDocumentId === null) {
      context.addIssue({
        code: 'custom',
        message: 'Parsed drafts require a ParsedDocument.',
        path: ['parsedDocumentId'],
      });
    }
    if (
      draft.fields.some((field) =>
        draft.origin === 'manual'
          ? field.provenance !== 'user'
          : draft.origin === 'parsed'
            ? field.provenance !== 'photo_extract'
            : field.provenance !== 'ai_suggestion',
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Draft field provenance must match its origin.',
        path: ['fields'],
      });
    }
  });

export const assetDraftViewSchema = assetDraftSchema
  .extend({
    parser: z
      .object({
        kind: z.enum(PARSE_PROVIDER_KINDS),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const parseTaskSchema = z
  .object({
    taskId: idSchema,
    workspaceId: idSchema,
    mode: z.enum(['single_sync', 'batch_async']),
    status: z.enum([
      'queued',
      'running',
      'completed',
      'completed_with_fallback',
      'failed',
    ]),
    sourceAssetIds: z.array(idSchema).min(1).max(200),
    progress: z
      .object({
        completed: z.number().int().nonnegative(),
        total: z.number().int().positive(),
        message: idSchema,
      })
      .strict(),
    disclosure: idSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()
  .superRefine((task, context) => {
    if (task.progress.total !== task.sourceAssetIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Task progress total must match its source count.',
        path: ['progress', 'total'],
      });
    }
    if (task.progress.completed > task.progress.total) {
      context.addIssue({
        code: 'custom',
        message: 'Task progress cannot exceed its total.',
        path: ['progress', 'completed'],
      });
    }
    if (task.mode === 'single_sync' && task.sourceAssetIds.length !== 1) {
      context.addIssue({
        code: 'custom',
        message: 'A synchronous parse task owns exactly one source.',
        path: ['sourceAssetIds'],
      });
    }
    if (task.mode === 'batch_async' && task.sourceAssetIds.length < 2) {
      context.addIssue({
        code: 'custom',
        message: 'An asynchronous parse task requires at least two sources.',
        path: ['sourceAssetIds'],
      });
    }
  });

export const parseSingleAssetCommandSchema = z
  .object({
    taskId: idSchema,
    source: parseSourceAssetInputSchema,
  })
  .strict();

export const parseAssetBatchCommandSchema = z
  .object({
    taskId: idSchema,
    sources: z.array(parseSourceAssetInputSchema).min(2).max(200),
  })
  .strict()
  .superRefine((command, context) => {
    const ids = new Set(command.sources.map((source) => source.assetId));
    if (ids.size !== command.sources.length) {
      context.addIssue({
        code: 'custom',
        message: 'Batch source asset ids must be unique.',
        path: ['sources'],
      });
    }
  });

export const prepareManualAssetDraftCommandSchema = z
  .object({
    taskId: idSchema,
    source: parseSourceAssetInputSchema,
    fields: z.array(z.object({ key: idSchema, value: z.json() }).strict()),
    factCandidates: z.array(storeFactCandidateDraftSchema),
  })
  .strict();

export const promoteAssetDraftCommandSchema = z
  .object({
    draftId: idSchema,
    draftRevision: z.number().int().positive(),
    batchId: idSchema,
  })
  .strict();

export const parseTaskViewQuerySchema = z
  .object({ taskId: idSchema })
  .strict();

export const assetDraftViewQuerySchema = z
  .object({
    draftId: idSchema,
    revision: z.number().int().positive().optional(),
  })
  .strict();

export const ASSET_INTAKE_GUIDANCE_CONFIG_KEY = 'asset-intake.guidance';

export const assetIntakeGuidanceConfigSchema = z
  .object({
    entries: z
      .array(
        z
          .object({
            industry: idSchema,
            assetType: idSchema,
            examples: z
              .array(
                z
                  .object({
                    exampleId: idSchema,
                    title: idSchema,
                    summary: idSchema,
                    sourceRef: idSchema,
                  })
                  .strict(),
              )
              .min(1),
            recommendations: z
              .array(
                z
                  .object({
                    recommendationId: idSchema,
                    label: idSchema,
                  })
                  .strict(),
              )
              .min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const assetIntakeExperienceQuerySchema = z
  .object({
    industry: idSchema,
    assetType: idSchema,
  })
  .strict();

export const assetIntakeExperienceSchema = z
  .object({
    industry: idSchema,
    assetType: idSchema,
    configRevision: z.number().int().nonnegative(),
    steps: z.tuple([
      z.object({ id: z.literal('see_examples'), optional: z.literal(true) }),
      z.object({ id: z.literal('choose_recommendations'), optional: z.literal(true) }),
      z.object({ id: z.literal('say_or_upload'), optional: z.literal(true) }),
      z.object({ id: z.literal('ai_arrange'), optional: z.literal(true) }),
      z.object({ id: z.literal('confirm_each'), optional: z.literal(false) }),
    ]),
    examples: assetIntakeGuidanceConfigSchema.shape.entries.element.shape.examples,
    recommendations:
      assetIntakeGuidanceConfigSchema.shape.entries.element.shape.recommendations,
    disclosure: idSchema,
  })
  .strict();

export type ParseSourceAssetInput = z.infer<
  typeof parseSourceAssetInputSchema
>;
export type ParseOwnedAsset = z.infer<typeof parseOwnedAssetSchema>;
export type ParsedDocument = z.infer<typeof parsedDocumentSchema>;
export type AssetDraft = z.infer<typeof assetDraftSchema>;
export type AssetDraftView = z.infer<typeof assetDraftViewSchema>;
export type ParseTask = z.infer<typeof parseTaskSchema>;
export type ParseSingleAssetCommand = z.infer<
  typeof parseSingleAssetCommandSchema
>;
export type ParseAssetBatchCommand = z.infer<
  typeof parseAssetBatchCommandSchema
>;
export type PrepareManualAssetDraftCommand = z.infer<
  typeof prepareManualAssetDraftCommandSchema
>;
export type AssetIntakeGuidanceConfig = z.infer<
  typeof assetIntakeGuidanceConfigSchema
>;
