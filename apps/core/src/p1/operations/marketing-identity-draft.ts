/**
 * W12② / D-142 — the identity draft assistant.
 *
 * The merchant says one line about who this voice is, optionally hands over a
 * reference image (read by the existing parse chain before it gets here), and
 * the model proposes the expressive fields. Three things this deliberately does
 * not do:
 *
 * 1. It cannot touch the consent record. `marketingIdentitySuggestionSchema`
 *    has no slot for the authorization proof, the authorized reach, or the
 *    portrait/voice permissions, and the contract refuses to register those as
 *    anything but `user` — so W12①'s two scope questions stay questions.
 * 2. Nothing it returns is an answer. Every proposal travels with `document` or
 *    `ai_suggestion` provenance and the wizard holds it unconfirmed until the
 *    merchant reads it, which is the same static-upgrade defence the five-step
 *    intake already runs on.
 * 3. It never blocks registration by hand. An unavailable provider is reported
 *    as unavailable rather than being passed off as an empty merchant input.
 */

import {
  EMPTY_MARKETING_IDENTITY_SUGGESTION,
  marketingIdentitySuggestionSchema,
  type MarketingIdentitySuggestion,
} from '@meiye/contracts';

import type {
  StructuredNodeRunner,
} from '../model-supply/structured-node-runner.js';

export const MARKETING_IDENTITY_DRAFT_SCHEMA_NAME =
  'marketing_identity_draft_v1';

export interface ResolvedMarketingIdentityDraftRequest {
  kind: 'brand' | 'person';
  background: string;
  reference: {
    draftId: string;
    draftRevision: number;
    parsedDocumentId: string;
    text: string;
  } | null;
}

export interface MarketingIdentityDraftOutcome {
  status: 'suggested' | 'empty' | 'unavailable';
  suggestion: MarketingIdentitySuggestion;
  errorCode: 'model_execution_failed' | null;
}

export interface MarketingIdentityDraftRunnerFactory {
  create(input: {
    workspaceId: string;
    actorId: string;
  }): StructuredNodeRunner;
}

export interface MarketingIdentityDraftPort {
  suggest(input: {
    abortSignal?: AbortSignal;
    workspaceId: string;
    actorId: string;
    effectIdempotencyKey: string;
    request: ResolvedMarketingIdentityDraftRequest;
  }): Promise<MarketingIdentityDraftOutcome>;
}

const INSTRUCTIONS = [
  'Draft one beauty-industry marketing identity from a merchant background line and optional reference text.',
  'Return null for any field the input does not support. Never invent an owner, a claim, or a boundary that the merchant did not imply.',
  'Set provenance to document only when the value comes from the supplied reference text; include an exactQuote citation copied from that text. Otherwise set ai_suggestion and omit citation.',
  'forbiddenClaims, visualPrinciples and seriesAnchors apply to a brand identity; return null for all three when kind is person.',
  'professionalBoundaries, expressionSamples, forbiddenClaims, visualPrinciples and seriesAnchors may hold several entries separated by newlines.',
  'Write every value in the merchant-facing language of the background line, in plain merchant wording.',
  'Never claim a portrait, voice, platform, scene or authorization permission — those are the merchant’s own answers and have no field here.',
].join(' ');

export class StructuredMarketingIdentityDrafter
  implements MarketingIdentityDraftPort
{
  constructor(private readonly runners: MarketingIdentityDraftRunnerFactory) {}

  async suggest(input: {
    abortSignal?: AbortSignal;
    workspaceId: string;
    actorId: string;
    effectIdempotencyKey: string;
    request: ResolvedMarketingIdentityDraftRequest;
  }): Promise<MarketingIdentityDraftOutcome> {
    const background = input.request.background.trim();
    if (!background) {
      return {
        status: 'empty',
        suggestion: EMPTY_MARKETING_IDENTITY_SUGGESTION,
        errorCode: null,
      };
    }
    const referenceText = input.request.reference?.text.trim();
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
          prompt: JSON.stringify({
            background,
            kind: input.request.kind,
            ...(referenceText ? { referenceText } : {}),
          }),
          schema: marketingIdentitySuggestionSchema,
          schemaName: MARKETING_IDENTITY_DRAFT_SCHEMA_NAME,
          schemaRevision: 'marketing-identity-draft-v2',
        });
      const parsed = marketingIdentitySuggestionSchema.parse(result.output);
      const kindSafe = input.request.kind === 'person'
        ? {
            ...parsed,
            // A person has no brand guidance to answer, so a model that filled
            // those three anyway would hand the merchant questions their own
            // wizard never asks.
            forbiddenClaims: null,
            visualPrinciples: null,
            seriesAnchors: null,
          }
        : parsed;
      const suggestion = verifyDocumentCitations(kindSafe, referenceText);
      return {
        status: Object.values(suggestion).some(Boolean) ? 'suggested' : 'empty',
        suggestion,
        errorCode: null,
      };
    } catch {
      return {
        status: 'unavailable',
        suggestion: EMPTY_MARKETING_IDENTITY_SUGGESTION,
        errorCode: 'model_execution_failed',
      };
    }
  }
}

function verifyDocumentCitations(
  suggestion: MarketingIdentitySuggestion,
  referenceText: string | undefined,
): MarketingIdentitySuggestion {
  return Object.fromEntries(
    Object.entries(suggestion).map(([field, proposed]) => {
      if (!proposed || proposed.provenance !== 'document') {
        return [field, proposed];
      }
      if (
        referenceText &&
        referenceText.includes(proposed.citation.exactQuote)
      ) {
        return [field, proposed];
      }
      return [
        field,
        { value: proposed.value, provenance: 'ai_suggestion' as const },
      ];
    }),
  ) as MarketingIdentitySuggestion;
}
