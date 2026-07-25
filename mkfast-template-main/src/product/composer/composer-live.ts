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
  CreativeToolEntry,
  ProductQuoteSnapshot,
  RecipeDraftFields,
  RecipePatchPreview,
} from '@meiye/contracts';

import { commandP1, queryP1 } from '@/p1/client';
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
  idempotencyKey?: string
) => Promise<unknown>;

export const COMPOSER_LAUNCH_SURFACE_ID = 'surface.home.launch';

export const COMPOSER_OPERATION_BY_LENS = {
  copy: 'copy.generate',
  image_text: 'image.generate',
  video: 'video.generate',
} as const satisfies Record<CreationLensId, string>;

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
  tools: CreativeToolEntry[];
}> {
  const [surface, tools] = await Promise.all([
    fetchComposerSurface(signal, query),
    query(
      'creation-experience',
      { action: 'tool_list', payload: {} },
      signal
    ) as Promise<CreativeToolEntry[]>,
  ]);
  return { surface, tools };
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

export function buildLiveQuoteInput(input: {
  sessionId: string;
  lensId: CreationLensId;
  catalogRevision: string;
  model: CatalogModelView;
  quantity?: number;
  durationSeconds?: number;
  aspectRatio?: '1:1' | '3:4' | '9:16';
  submission: ComposerSubmissionSignedFields;
}) {
  const quantity = Math.max(1, input.quantity ?? 1);
  const operation = COMPOSER_OPERATION_BY_LENS[input.lensId];

  return {
    quoteId: [
      'composer',
      input.sessionId,
      input.lensId,
      input.model.id,
      input.catalogRevision,
      String(quantity),
      String(input.durationSeconds ?? (input.lensId === 'video' ? 15 : 0)),
      ...(input.aspectRatio ? [input.aspectRatio] : []),
      input.submission.contentPackagePlatform,
      input.submission.distributionTarget,
      input.submission.deliverable.kind,
    ].join(':'),
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
}

export async function requestComposerQuote(
  input: ReturnType<typeof buildLiveQuoteInput>,
  command: CommandTransport = commandP1
) {
  return (await command(
    'product-billing',
    { action: 'quote', payload: input },
    `composer-quote:${input.quoteId}`
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
