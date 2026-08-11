/**
 * Campaign Work2 (and any subsequent slot) must carry a ProductQuote whose
 * submissionContractHash matches its signed fields. Work1 reuses the merchant
 * preview quote; Work2 changes intent and must mint a fresh quote (Lane K residual).
 *
 * Work2 also rebinds the Brief context intent (+ quote id) so admission does
 * not fail "Creative intent does not match the revision-bound Brief context."
 */
import {
  pickComposerSubmissionSignedFields,
  type ComposerSubmissionSignedFields,
} from '@meiye/contracts';
import {
  briefIntentRevisionId,
  type BriefRevisionContextRepository,
} from '../creation-experience/postgres-brief-revision-context.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';
import type { ComposerSubmissionRequest } from '../execution-spine/creation-execution-snapshot.js';
import type { ProductBillingApplicationPort } from '../product-billing/durable-service.js';
import type {
  ProductQuoteAuthority,
  PublicProductQuoteOperation,
} from '../product-billing/server-quote-authority.js';

const ACCEPTABLE_QUOTE_LIFECYCLES = new Set([
  'quoted',
  'confirmed',
  'reserved',
]);

export interface CampaignWorkQuoteMinter {
  /**
   * Ensures quote + brief facts match this slot's signed fields.
   * Drops briefConfirmation when a new quote is minted (Work1 confirmation
   * binds the preview quote and must not be reused).
   */
  ensureQuoteForSubmission(
    submission: ComposerSubmissionRequest,
  ): Promise<ComposerSubmissionRequest>;
}

function quoteMatchesSignedFields(
  quote: {
    catalogModelId?: string;
    lifecycleStatus?: string;
    revision?: string | number;
    submissionContractHash?: string;
  },
  input: {
    catalogModelId: string;
    signedHash: string;
  },
): boolean {
  return (
    quote.submissionContractHash === input.signedHash &&
    quote.catalogModelId === input.catalogModelId &&
    ACCEPTABLE_QUOTE_LIFECYCLES.has(String(quote.lifecycleStatus ?? ''))
  );
}

export function createCampaignWorkQuoteMinter(deps: {
  authority: ProductQuoteAuthority;
  quotes: Pick<
    ProductBillingApplicationPort,
    'buildQuote' | 'getQuote'
  >;
  /** Optional: rebind Brief intent/quote when Work2 diverges from preview. */
  briefContexts?: BriefRevisionContextRepository;
}): CampaignWorkQuoteMinter {
  return {
    async ensureQuoteForSubmission(submission) {
      const signed = pickComposerSubmissionSignedFields(
        submission as unknown as Record<string, unknown>,
      );
      const signedHash = fingerprintValue(signed);
      const catalogModelId = submission.catalogModel.id;
      const matchInput = { catalogModelId, signedHash };

      // 1) Current submission quote already matches (Work1 preview path).
      const current = await deps.quotes.getQuote(
        submission.quote.id,
        submission.workspaceId,
      );
      if (
        current &&
        String(current.revision) === String(submission.quote.revision) &&
        quoteMatchesSignedFields(current, matchInput)
      ) {
        return submission;
      }

      // 2) Stable campaign-slot quote id — reuse on recovery retries without
      //    re-buildQuote (expiresAt / formula churn would trip IDEMPOTENCY_CONFLICT).
      const stableQuoteId = `campaign-work-quote:${fingerprintValue({
        catalogModelId,
        idempotencyKey: submission.idempotencyKey,
        intent: submission.intent,
        workspaceId: submission.workspaceId,
      }).slice(0, 28)}`;
      const stable = await deps.quotes.getQuote(
        stableQuoteId,
        submission.workspaceId,
      );
      let nextQuote: { id: string; revision: string };
      if (stable && quoteMatchesSignedFields(stable, matchInput)) {
        nextQuote = {
          id: stable.quoteId,
          revision: String(stable.revision),
        };
      } else {
        // 3) Mint once under the stable id.
        const operation = publicOperationForComposerSubmission(
          submission,
          signed,
        );
        const build = await deps.authority.resolve({
          workspaceId: submission.workspaceId,
          catalogModelId,
          operation,
          quoteId: stableQuoteId,
          submission: signed,
          quantity: signed.deliverable.quantity,
          ...(signed.deliverable.aspectRatio
            ? { aspectRatio: signed.deliverable.aspectRatio }
            : {}),
          ...(signed.deliverable.durationSeconds !== undefined
            ? { targetSeconds: signed.deliverable.durationSeconds }
            : {}),
        });
        try {
          const quote = await deps.quotes.buildQuote(build);
          nextQuote = {
            id: quote.quoteId,
            revision: String(quote.revision),
          };
        } catch (error) {
          // Concurrent recovery may race the first mint; re-read stable id.
          const raced = await deps.quotes.getQuote(
            stableQuoteId,
            submission.workspaceId,
          );
          if (raced && quoteMatchesSignedFields(raced, matchInput)) {
            nextQuote = {
              id: raced.quoteId,
              revision: String(raced.revision),
            };
          } else {
            throw error;
          }
        }
      }

      let next: ComposerSubmissionRequest = {
        ...submission,
        quote: nextQuote,
      };
      // Work1's durable Brief confirmation is bound to the preview quote;
      // after remint it must not travel with Work2.
      if ('briefConfirmation' in next) {
        const { briefConfirmation: _drop, ...rest } = next as ComposerSubmissionRequest & {
          briefConfirmation?: unknown;
        };
        next = rest as ComposerSubmissionRequest;
      }

      if (deps.briefContexts && next.briefContext) {
        next = await rebindBriefForCampaignWork(
          deps.briefContexts,
          deps.quotes,
          next,
        );
      }
      return next;
    },
  };
}

/**
 * Advance Brief context to this Work's intent + quote while keeping a
 * projected lastProjection so admission still sees a current brief. bindRevisions
 * quote/model ids are rewritten to the minted quote so they match
 * resolveCurrentRevisions. requiresBrief is cleared for campaign slots — plan_only
 * already authorized the schedule; Work N does not re-open Brief confirm.
 */
async function rebindBriefForCampaignWork(
  contexts: BriefRevisionContextRepository,
  quotes: Pick<ProductBillingApplicationPort, 'getQuote'>,
  submission: ComposerSubmissionRequest,
): Promise<ComposerSubmissionRequest> {
  const briefContext = submission.briefContext;
  if (!briefContext) return submission;
  const current = await contexts.getBriefRevisionContext(
    submission.workspaceId,
    briefContext.id,
  );
  if (!current?.lastProjection) {
    return submission;
  }
  const nextIntentRevision = briefIntentRevisionId(submission.intent);
  if (
    current.intentRevisionId === nextIntentRevision &&
    current.quoteId === submission.quote.id &&
    current.revision === briefContext.revision
  ) {
    return submission;
  }
  const mintedQuote = await quotes.getQuote(
    submission.quote.id,
    submission.workspaceId,
  );
  const synced = await contexts.syncBriefRevisionContext(
    submission.workspaceId,
    {
      briefContextId: current.briefContextId,
      draftRevisionId: current.draftRevisionId,
      intentRevisionId: nextIntentRevision,
      lensId: current.lensId,
      projectionFacts: current.projectionFacts,
      quoteId: submission.quote.id,
      recipeRevisionId: current.recipeRevisionId,
      sourceRevisionId: current.sourceRevisionId,
      surfaceRevisionId: current.surfaceRevisionId,
    },
    current.revision,
  );
  await contexts.recordBriefProjection(
    submission.workspaceId,
    synced.briefContextId,
    synced.revision,
    {
      requiresBrief: false,
      bindRevisions: {
        ...current.lastProjection.bindRevisions,
        quoteRevisionId: String(
          mintedQuote?.revision ?? submission.quote.revision,
        ),
        ...(mintedQuote?.catalogModelRevision
          ? { modelRevisionId: mintedQuote.catalogModelRevision }
          : {}),
      },
    },
  );
  return {
    ...submission,
    briefContext: {
      id: synced.briefContextId,
      revision: synced.revision,
    },
  };
}

/** Map Composer deliverable/lens to the public quote operation vocabulary. */
export function publicOperationForComposerSubmission(
  submission: ComposerSubmissionRequest,
  signed: ComposerSubmissionSignedFields = pickComposerSubmissionSignedFields(
    submission as unknown as Record<string, unknown>,
  ),
): PublicProductQuoteOperation {
  // The Composer request schema omits `operation` (server-owned snapshot
  // field). The quote operation is derived only from signed/server-owned
  // fields: the explicit free-mode image operation or the signed deliverable.
  if (signed.imageOperation) {
    return signed.imageOperation as PublicProductQuoteOperation;
  }
  switch (signed.deliverable.kind) {
    case 'copy_document':
      return 'copy.generate';
    case 'video_package':
      return 'video.generate';
    case 'note':
    case 'image_set':
    case 'poster':
    case 'image_text_package':
    default:
      return 'image.generate';
  }
}
