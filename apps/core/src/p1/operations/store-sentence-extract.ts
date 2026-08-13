/**
 * V31-89 — spoken-sentence store-profile extract.
 *
 * Suggestion only. The wizard still writes through `finalize_store_intake`.
 * Fixture mode uses the canned compiler inside FixtureAiStructuredObjectExecutor
 * (same structured-model path as `draft_marketing_identity`). Failures return
 * empty suggestions instead of throwing.
 */

import {
  STORE_SENTENCE_EXTRACT_SCHEMA_NAME,
  STORE_SENTENCE_FACT_IDS,
  extractStoreSentenceResultSchema,
  storeSentenceModelOutputSchema,
  type ExtractStoreSentenceResult,
  type StoreSentenceFactId,
  type StoreSentenceModelOutput,
  type StoreSentenceSuggestion,
} from '@meiye/contracts';

import type { StructuredNodeRunner } from '../model-supply/structured-node-runner.js';

export const STORE_SENTENCE_EXTRACT_SCHEMA_REVISION =
  'store-sentence-extract-v1';

const KNOWN_INDUSTRY_SLUGS = new Set([
  'hair_care',
  'nail',
  'lash',
  'skin_management',
  'beauty_salon',
  'hair_growth',
]);

const INDUSTRY_ALIASES: Record<string, string> = {
  美发: 'hair_care',
  护发: 'hair_care',
  理发: 'hair_care',
  染发: 'hair_care',
  头皮: 'hair_care',
  头皮护理: 'hair_care',
  美甲: 'nail',
  美睫: 'lash',
  睫毛: 'lash',
  皮肤: 'skin_management',
  护肤: 'skin_management',
  皮肤管理: 'skin_management',
  生发: 'hair_growth',
  美容: 'beauty_salon',
};

const INSTRUCTIONS = [
  'Extract beauty-store profile fields from one spoken merchant sentence.',
  'Return null for any field the sentence does not support. Never invent a store name, city, project, price, or industry.',
  'Use only these field ids: name, city, district, address, booking, projectName, projectPrice, industry.',
  'projectPrice must be a numeric string without currency (for example 388). Convert Chinese numerals when the merchant said them that way.',
  'industry must be one of hair_care, nail, lash, skin_management, beauty_salon, hair_growth when the sentence clearly names that trade; otherwise null.',
  'Write every value in the merchant-facing language of the sentence.',
  'This is a suggestion. It is not a store write.',
].join(' ');

export interface StoreSentenceExtractInput {
  abortSignal?: AbortSignal;
  workspaceId: string;
  actorId: string;
  effectIdempotencyKey: string;
  sentence: string;
}

export interface StoreSentenceExtractPort {
  extract(input: StoreSentenceExtractInput): Promise<ExtractStoreSentenceResult>;
}

export interface StoreSentenceExtractRunnerFactory {
  create(input: {
    workspaceId: string;
    actorId: string;
  }): StructuredNodeRunner;
}

export class StructuredStoreSentenceExtractor
  implements StoreSentenceExtractPort
{
  constructor(private readonly runners: StoreSentenceExtractRunnerFactory) {}

  async extract(
    input: StoreSentenceExtractInput,
  ): Promise<ExtractStoreSentenceResult> {
    const sentence = input.sentence.trim();
    if (!sentence) {
      return emptyResult();
    }
    try {
      const result = await this.runners
        .create({
          workspaceId: input.workspaceId,
          actorId: input.actorId,
        })
        .run({
          abortSignal: input.abortSignal,
          effectIdempotencyKey: input.effectIdempotencyKey,
          instructions: INSTRUCTIONS,
          prompt: JSON.stringify({ sentence }),
          schema: storeSentenceModelOutputSchema,
          schemaName: STORE_SENTENCE_EXTRACT_SCHEMA_NAME,
          schemaRevision: STORE_SENTENCE_EXTRACT_SCHEMA_REVISION,
        });
      const parsed = storeSentenceModelOutputSchema.parse(result.output);
      const suggestions = suggestionsFromModel(parsed);
      return extractStoreSentenceResultSchema.parse({
        status: suggestions.length > 0 ? 'suggested' : 'empty',
        suggestions,
        errorCode: null,
      });
    } catch {
      return {
        status: 'unavailable',
        suggestions: [],
        errorCode: 'model_execution_failed',
      };
    }
  }
}

export function emptyStoreSentenceExtract(): ExtractStoreSentenceResult {
  return {
    status: 'unavailable',
    suggestions: [],
    errorCode: 'model_unavailable',
  };
}

export function suggestionsFromModel(
  output: StoreSentenceModelOutput,
): StoreSentenceSuggestion[] {
  const suggestions: StoreSentenceSuggestion[] = [];
  for (const id of STORE_SENTENCE_FACT_IDS) {
    const proposed = output[id];
    if (!proposed) continue;
    const value = sanitizeField(id, proposed.value);
    if (!value) continue;
    suggestions.push({
      id,
      value,
      confidence: proposed.confidence,
      provenance: 'ai_suggestion',
      source: 'spoken_sentence',
    });
  }
  return suggestions;
}

function emptyResult(): ExtractStoreSentenceResult {
  return { status: 'empty', suggestions: [], errorCode: null };
}

function sanitizeField(id: StoreSentenceFactId, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (id === 'projectPrice') {
    return trimmed.match(/(\d+(?:\.\d{1,2})?)/u)?.[1];
  }
  if (id === 'industry') {
    if (KNOWN_INDUSTRY_SLUGS.has(trimmed)) return trimmed;
    return INDUSTRY_ALIASES[trimmed];
  }
  return trimmed;
}


