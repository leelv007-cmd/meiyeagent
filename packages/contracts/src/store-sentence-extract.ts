import { z } from 'zod';

import { nonEmptyTrimmedStringSchema } from './identifiers.js';

/**
 * Spoken-sentence store-profile extract (V31-89).
 *
 * Chosen as a new command (`extract_store_sentence`) rather than a
 * `spoken_sentence` parse target: parse lanes require a verified source asset
 * (sha256 / objectKey / sizeBytes) and compile photo or document drafts. A
 * merchant sentence has none of that, and the Phase-2 feasibility note already
 * ruled out `store_workflow_capture` (recipe tools/steps, not profile fields).
 * Closest existing pattern is `draft_marketing_identity`: suggestion-only
 * structured extract, write channel unchanged.
 *
 * Field ids are the existing ProgressiveFact / store-profile vocabulary.
 * This file does not add profile fields and does not write anything —
 * `finalize_store_intake` remains the only intake write channel.
 */
export const STORE_SENTENCE_FACT_IDS = [
  'name',
  'city',
  'district',
  'address',
  'booking',
  'projectName',
  'projectPrice',
  'industry',
] as const;

export type StoreSentenceFactId = (typeof STORE_SENTENCE_FACT_IDS)[number];

export const STORE_SENTENCE_EXTRACT_SCHEMA_NAME = 'store_sentence_extract_v1';

export const extractStoreSentenceCommandSchema = z
  .object({
    sentence: nonEmptyTrimmedStringSchema.max(2_000),
  })
  .strict();

export type ExtractStoreSentenceCommand = z.infer<
  typeof extractStoreSentenceCommandSchema
>;

export const storeSentenceExtractedFieldSchema = z
  .object({
    value: nonEmptyTrimmedStringSchema.max(200),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type StoreSentenceExtractedField = z.infer<
  typeof storeSentenceExtractedFieldSchema
>;

/**
 * Governed structured-model output. Every key is nullable so the model must
 * say "nothing" out loud instead of inventing a field.
 */
export const storeSentenceModelOutputSchema = z
  .object({
    name: storeSentenceExtractedFieldSchema.nullable(),
    city: storeSentenceExtractedFieldSchema.nullable(),
    district: storeSentenceExtractedFieldSchema.nullable(),
    address: storeSentenceExtractedFieldSchema.nullable(),
    booking: storeSentenceExtractedFieldSchema.nullable(),
    projectName: storeSentenceExtractedFieldSchema.nullable(),
    projectPrice: storeSentenceExtractedFieldSchema.nullable(),
    industry: storeSentenceExtractedFieldSchema.nullable(),
  })
  .strict();

export type StoreSentenceModelOutput = z.infer<
  typeof storeSentenceModelOutputSchema
>;

export const EMPTY_STORE_SENTENCE_MODEL_OUTPUT: StoreSentenceModelOutput = {
  name: null,
  city: null,
  district: null,
  address: null,
  booking: null,
  projectName: null,
  projectPrice: null,
  industry: null,
};

export const storeSentenceSuggestionSchema = z
  .object({
    id: z.enum(STORE_SENTENCE_FACT_IDS),
    value: nonEmptyTrimmedStringSchema.max(200),
    confidence: z.number().min(0).max(1),
    provenance: z.literal('ai_suggestion'),
    source: z.literal('spoken_sentence'),
  })
  .strict();

export type StoreSentenceSuggestion = z.infer<
  typeof storeSentenceSuggestionSchema
>;

export const extractStoreSentenceResultSchema = z
  .object({
    status: z.enum(['suggested', 'empty', 'unavailable']),
    suggestions: z
      .array(storeSentenceSuggestionSchema)
      .max(STORE_SENTENCE_FACT_IDS.length),
    errorCode: z
      .enum(['model_unavailable', 'model_execution_failed'])
      .nullable(),
  })
  .strict()
  .superRefine((result, context) => {
    const hasSuggestion = result.suggestions.length > 0;
    if ((result.status === 'suggested') !== hasSuggestion) {
      context.addIssue({
        code: 'custom',
        message: 'Extract status must agree with whether suggestions exist.',
        path: ['status'],
      });
    }
    if ((result.status === 'unavailable') !== (result.errorCode !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'Only unavailable extracts carry an observable error code.',
        path: ['errorCode'],
      });
    }
  });

export type ExtractStoreSentenceResult = z.infer<
  typeof extractStoreSentenceResultSchema
>;
