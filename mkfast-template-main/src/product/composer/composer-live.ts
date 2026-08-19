import type {
  BriefBoundRevisions,
  BriefConfirmation,
  BriefSourceSignal,
  BriefHighRiskFactSignal,
  BriefTriggerInput,
  BriefTriggerProjection,
  BrowserSurfaceProjection,
  ComposerSubmissionSignedFields,
  CreationLensId,
  ProductQuoteSnapshot,
  RecipeDraftFields,
  RecipePatchPreview,
} from '@meiye/contracts';

import { CORE_OPERATION_TIMEOUT_MS } from '@/lib/core-request';
import { stableJsonHash } from '@/p1/canonical-json';
import { commandP1, type P1CommandWait, queryP1 } from '@/p1/client';
import type { CatalogModelView } from '@/p1/settings-view-model';

export type RawComposerCatalog = {
  revisionId?: string;
  models?: unknown[];
  deployments?: unknown[];
};

export type ComposerQueryTransport = (
  module: Parameters<typeof queryP1>[0],
  call: Parameters<typeof queryP1>[1],
  signal?: AbortSignal
) => Promise<unknown>;

type CommandTransport = (
  module: Parameters<typeof commandP1>[0],
  call: Parameters<typeof commandP1>[1],
  idempotencyKey?: string,
  wait?: P1CommandWait
) => Promise<unknown>;

export const COMPOSER_LAUNCH_SURFACE_ID = 'surface.home.launch';

export const COMPOSER_OPERATION_BY_LENS = {
  copy: 'copy.generate',
  image_text: 'image.generate',
  video: 'video.generate',
} as const satisfies Record<CreationLensId, string>;

/**
 * There is deliberately no lens→model table here (#240①).
 *
 * The browser used to carry a hardcoded production opinion about which model
 * each lens falls back to. It was a second source: operations edit
 * `platform.defaultModel.<configKey>` in the backend (D-044), that value is
 * what Day-0 provisioning writes and what activation evidence validates, and
 * none of that could reach a constant baked into the bundle. The platform
 * default now arrives with the rest of the preferences
 * (`fetchComposerPreferences` → `platformDefault`), and when the platform has
 * not configured one the composer has none — it does not invent one.
 */

export async function fetchComposerSurface(
  signal?: AbortSignal,
  query: ComposerQueryTransport = queryP1
) {
  return (await query(
    'creation-experience',
    {
      action: 'surface_browser',
      payload: { surfaceId: COMPOSER_LAUNCH_SURFACE_ID },
    },
    signal
  )) as BrowserSurfaceProjection;
}

export async function fetchComposerCatalogSource(
  signal?: AbortSignal,
  query: ComposerQueryTransport = queryP1
): Promise<{
  surface: BrowserSurfaceProjection;
}> {
  const surface = await fetchComposerSurface(signal, query);
  return { surface };
}

export async function fetchComposerCatalog(
  lensId: CreationLensId,
  signal?: AbortSignal,
  query: ComposerQueryTransport = queryP1
) {
  return (await query(
    'model-supply',
    {
      action: 'catalog',
      payload: { operation: COMPOSER_OPERATION_BY_LENS[lensId] },
    },
    signal
  )) as RawComposerCatalog;
}

export async function fetchComposerPreferences(
  lensId: CreationLensId,
  signal?: AbortSignal,
  query: ComposerQueryTransport = queryP1
) {
  return query(
    'model-supply',
    {
      action: 'preferences',
      payload: { operation: COMPOSER_OPERATION_BY_LENS[lensId] },
    },
    signal
  );
}

export function buildLiveQuoteInput(input: {
  sessionId: string;
  lensId: CreationLensId;
  // The catalog revision is not a separate parameter: it reaches the server
  // inside `submission.catalogModel.revision`, and quote identity now derives
  // from the payload rather than from a parallel list of fields.
  model: CatalogModelView;
  quantity?: number;
  durationSeconds?: number;
  aspectRatio?: '1:1' | '3:4' | '9:16';
  submission: ComposerSubmissionSignedFields;
}) {
  const quantity = Math.max(1, input.quantity ?? 1);
  const operation =
    input.lensId === 'image_text' && input.submission.imageOperation
      ? input.submission.imageOperation
      : COMPOSER_OPERATION_BY_LENS[input.lensId];

  // Everything the server bills off, quote identity excluded — see below.
  const billablePayload = {
    catalogModelId: input.model.id,
    operation,
    quantity,
    submission: input.submission,
    ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
    ...(input.lensId === 'video'
      ? {
          targetSeconds: input.durationSeconds ?? 15,
        }
      : {}),
  } as const;

  return {
    // Quote identity is a digest of the *whole* billable payload, not a
    // hand-picked subset of it (#240 P0). The old id listed model, revision,
    // quantity, duration, ratio, platform, target, deliverable kind and image
    // operation — but not `submission.intent`, `submission.creationMode` or
    // `submission.recipe`, all of which travel in the payload. Editing the
    // intent therefore re-sent a different body under the same
    // `composer-quote:<id>` idempotency key, and the server — which conflicts
    // on key + payload hash — answered IDEMPOTENCY_CONFLICT. Deriving the id
    // from the payload makes that unrepresentable: a changed payload is a
    // changed key, so re-quoting after an edit is a new request and retrying
    // an unchanged one is genuinely idempotent.
    //
    // The session and lens stay readable in front of the digest so a key is
    // still recognisable in a log; nothing time-varying is folded in, or the
    // key would drift on its own and defeat retry.
    quoteId: [
      'composer',
      input.sessionId,
      input.lensId,
      stableJsonHash(billablePayload),
    ].join(':'),
    ...billablePayload,
  } as const;
}

/**
 * Upper bound on one quote round trip (#240). Long enough that a warm core
 * answers well inside it, short enough that a stuck one becomes a retryable
 * failure the merchant can see rather than an endless 正在读取.
 */
export const COMPOSER_QUOTE_TIMEOUT_MS =
  CORE_OPERATION_TIMEOUT_MS['product-billing.quote'];

export async function requestComposerQuote(
  input: ReturnType<typeof buildLiveQuoteInput>,
  command: CommandTransport = commandP1,
  wait: P1CommandWait = {}
) {
  return (await command(
    'product-billing',
    { action: 'quote', payload: input },
    `composer-quote:${input.quoteId}`,
    {
      signal: wait.signal,
      timeoutMs: wait.timeoutMs ?? COMPOSER_QUOTE_TIMEOUT_MS,
    }
  )) as ProductQuoteSnapshot;
}

export function buildLiveBriefInput(input: {
  briefContextId: string;
  lensId: CreationLensId;
  quote: ProductQuoteSnapshot;
  currentRevisions: BriefBoundRevisions;
  delivery?: { platform?: string | null; deliverableKind?: string | null };
  deliverableCount?: number;
  imageCount?: number;
  sources?: BriefSourceSignal[];
  highRiskFacts?: BriefHighRiskFactSignal[];
}): BriefTriggerInput {
  const platform = input.delivery?.platform;
  return {
    briefContextId: input.briefContextId,
    lensId: input.lensId,
    deliverableKind: input.delivery?.deliverableKind ?? null,
    deliverableCount: input.deliverableCount ?? 1,
    platforms: platform ? [platform] : [],
    imageCount: input.imageCount ?? 0,
    sources: input.sources ?? [],
    highRiskFacts: input.highRiskFacts ?? [],
    quote: {
      quoteRevisionId: input.quote.revision,
      amount: input.quote.confirmedAmount ?? 0,
      extraConfirmThreshold: 20,
      quotePolicyRevision: input.quote.quotePolicyRevision,
    },
    currentRevisions: input.currentRevisions,
    summaryHints: {
      targetDeliverable: input.delivery?.deliverableKind ?? null,
      platforms: platform ? [platform] : [],
      modelAndSettings: input.quote.catalogModelId,
      estimatedCost: String(input.quote.confirmedAmount ?? 0),
      estimatedDuration:
        input.quote.quotedSeconds == null
          ? null
          : `${input.quote.quotedSeconds} 秒`,
    },
  };
}

export type ComposerBriefContext = {
  briefContextId: string;
  currentRevisions: BriefBoundRevisions;
  revision: number;
};

export async function syncComposerBriefContext(
  input: {
    briefContextId: string;
    draft: Record<string, unknown>;
    expectedRevision: number | null;
    lensId: CreationLensId;
    quoteId: string;
    recipeRevisionId: string | null;
    sourceIds: string[];
    surfaceRevisionId: string | null;
  },
  command: CommandTransport = commandP1
) {
  return (await command(
    'creation-experience',
    { action: 'brief_context_sync', payload: input },
    `brief-context:${input.briefContextId}:${input.expectedRevision ?? 0}`
  )) as ComposerBriefContext;
}

export async function requestComposerBrief(
  input: BriefTriggerInput,
  query: ComposerQueryTransport = queryP1,
  signal?: AbortSignal
) {
  return (await query(
    'creation-experience',
    {
      action: 'brief_project',
      payload: input as unknown as Record<string, unknown>,
    },
    signal
  )) as BriefTriggerProjection;
}

export async function confirmComposerBrief(
  input: BriefTriggerInput & { confirmationId: string },
  command: CommandTransport = commandP1
) {
  return (await command(
    'creation-experience',
    {
      action: 'brief_confirm',
      payload: input as unknown as Record<string, unknown>,
    },
    input.confirmationId
  )) as BriefConfirmation & { confirmationId: string };
}

export async function requestRecipePatchPreview(
  input: {
    recipeRevisionId: string;
    currentLens: CreationLensId | null;
    surfaceRevisionId?: string;
    draft: RecipeDraftFields;
  },
  query: ComposerQueryTransport = queryP1,
  signal?: AbortSignal
) {
  return (await query(
    'creation-experience',
    {
      action: 'recipe_patch_preview',
      payload: input as unknown as Record<string, unknown>,
    },
    signal
  )) as RecipePatchPreview;
}
