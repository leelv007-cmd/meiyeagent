/**
 * W12② / D-142 — the identity draft assistant.
 *
 * The merchant says one line about who this voice is, optionally hands over a
 * reference file (read by the existing parse chain before it gets here), and
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
 * 3. It never blocks. A provider that fails returns an empty proposal, and the
 *    merchant answers the questions themselves — the wizard worked before this
 *    assistant existed and still does.
 */

import {
  EMPTY_MARKETING_IDENTITY_SUGGESTION,
  marketingIdentitySuggestionSchema,
  type MarketingIdentityDraftRequest,
  type MarketingIdentitySuggestion,
} from '@meiye/contracts';

import type { StructuredObjectExecutor } from '../model-supply/index.js';

export const MARKETING_IDENTITY_DRAFT_SCHEMA_NAME =
  'marketing_identity_draft_v1';

export interface MarketingIdentityDraftPort {
  suggest(input: {
    abortSignal?: AbortSignal;
    request: MarketingIdentityDraftRequest;
  }): Promise<MarketingIdentitySuggestion>;
}

const INSTRUCTIONS = [
  'Draft one beauty-industry marketing identity from a merchant background line and optional reference text.',
  'Return null for any field the input does not support. Never invent an owner, a claim, or a boundary that the merchant did not imply.',
  'Set provenance to document only when the value comes from the supplied reference text; otherwise set ai_suggestion.',
  'forbiddenClaims, visualPrinciples and seriesAnchors apply to a brand identity; return null for all three when kind is person.',
  'professionalBoundaries, expressionSamples, forbiddenClaims, visualPrinciples and seriesAnchors may hold several entries separated by newlines.',
  'Write every value in the merchant-facing language of the background line, in plain merchant wording.',
  'Never claim a portrait, voice, platform, scene or authorization permission — those are the merchant’s own answers and have no field here.',
].join(' ');

export class StructuredMarketingIdentityDrafter
  implements MarketingIdentityDraftPort
{
  constructor(private readonly executor: StructuredObjectExecutor) {}

  async suggest(input: {
    abortSignal?: AbortSignal;
    request: MarketingIdentityDraftRequest;
  }): Promise<MarketingIdentitySuggestion> {
    const background = input.request.background.trim();
    if (!background) return EMPTY_MARKETING_IDENTITY_SUGGESTION;
    const referenceText = input.request.referenceText?.trim();
    try {
      const result = await this.executor.generate({
        abortSignal: input.abortSignal,
        instructions: INSTRUCTIONS,
        prompt: JSON.stringify({
          background,
          kind: input.request.kind,
          ...(referenceText ? { referenceText } : {}),
        }),
        schema: marketingIdentitySuggestionSchema,
        schemaName: MARKETING_IDENTITY_DRAFT_SCHEMA_NAME,
      });
      const suggestion = marketingIdentitySuggestionSchema.parse(result.output);
      return input.request.kind === 'person'
        ? {
            ...suggestion,
            // A person has no brand guidance to answer, so a model that filled
            // those three anyway would hand the merchant questions their own
            // wizard never asks.
            forbiddenClaims: null,
            visualPrinciples: null,
            seriesAnchors: null,
          }
        : suggestion;
    } catch {
      return EMPTY_MARKETING_IDENTITY_SUGGESTION;
    }
  }
}
