/**
 * Composer home host — D-114 定制创作主容器 (T30 / #224 reshell).
 *
 * Primary creation entry mounted by dashboard/index. The live seams are
 * unchanged: three-in/three-out HTTP+SSE is still the only backend language,
 * T08 still signs and freezes the submission, T11 still owns routing.
 *
 * What the reshell changed (ADR-0014):
 *  - 提交后不跳转. The run streams in this container and finishes as a 成品预览卡;
 *    clicking that card is what opens the Result Center.
 *  - The settings grid is gone. Its five controls were exactly the T08 signed
 *    fields, so editing them here was a D-031 槽位填表 over a contract the server
 *    owns. 「发到哪」stays as one chip question; the rest read back read-only.
 *  - 旧内容复用的三段选择表单收进对话流 (chips + one sentence).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';
import { useProStudioEntitlement } from '@/hooks/use-pro-studio-entitlement';
import { emitTelemetry } from '@/lib/product-telemetry';
import {
  account_usage_retry,
  creation_entry_intent_aria,
  creation_entry_intent_placeholder,
  creation_entry_submit,
  workbench_grounding_go_to_store,
  workbench_grounding_qualification_action,
  workbench_grounding_qualification_required,
  workbench_grounding_source_required,
  workbench_grounding_store_required,
  workbench_operation_failed,
  workbench_work_create_failed,
  workbench_work_created,
} from '@/locale/paraglide/messages';
import { commandP1, P1RequestError, p1ErrorCode, queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import {
  normalizeCatalog,
  normalizePreferences,
} from '@/p1/settings-view-model';
import { resolveCreationModelSelection } from '@/p1/model-current-selection';
import { useComplianceDefaults } from '@/p1/use-compliance-defaults';
import type {
  BriefBoundRevisions,
  BriefSourceSignal,
  BriefTriggerInput,
  BriefTriggerProjection,
  BrowserRecipeProjection,
  CreationLensId,
  MarketingIdentityAsset,
  ProductQuoteSnapshot,
  QuestionCard,
  ResultPanel,
  StoreFact,
} from '@meiye/contracts';
import { composerSubmissionSignedFieldsSchema } from '@meiye/contracts';
import type { AccountUsageProjection } from '@/product/account-usage';
import { uploadProductAsset } from '@/api/product-assets';
import { assetAuthorizationIdempotencyKey } from '@/product/asset-authorization-model';
import {
  ComposerImageInput,
  type ComposerImageIdentity,
} from '@/product/composer-image-input';
import { executeProductCommand, useProductState } from '@/product/client';
import { DashboardHomeSurface } from '@/product/dashboard-home-surface';
import type { ConfirmedAssetFacts } from '@/product/creation-entry-model';
import {
  missingCreativeGrounding,
  type CreativeGroundingRequirement,
} from '@/product/creative-brief-editor';
import {
  readActiveHarnessTasks,
  readPendingHarnessDecision,
  submitHarnessDecision,
} from '@/product/harness-client';
import { LandingHandoffRestore } from '@/product/landing-handoff-restore';
import { navigateAfterSubmitSuccess } from '@/product/results/result-center-navigation';
import { projectResultTokenStream } from '@/product/results/result-token-stream';
import { useWorkflowEventStream } from '@/product/use-workflow-event-stream';
import {
  invalidateMarketingIdentity,
  marketingIdentityProjectionQuery,
} from '@/product/marketing-identity-queries';

import { BriefSurface } from './brief-surface-panel';
import { applyCatalogRecipeSelection } from './catalog-selection';
import { ProgressiveFactCard } from './progressive-fact-card';
import {
  hasMissingProgressiveStoreFacts,
  shouldShowProgressiveFactCard,
} from './progressive-fact';
import {
  BRIEF_STALE_QUOTE_NOTICE,
  cancelBriefSurface,
  confirmBriefSurface,
  createBriefSurfaceState,
  decideSubmitPath,
  openBriefSurface,
  projectBriefSurfaceView,
  type BriefSurfaceState,
} from './brief-surface';
import { ComposerToolsStrip } from './composer-tools-strip';
import {
  bindQuoteView,
  canSubmit,
  createComposerLensState,
  reopenComposer,
  selectLens,
  submitComposer,
  updateSettings,
  updateSources,
  updateDeliverySuggestion,
  updateUserText,
  type ComposerLensState,
} from './lens-state-machine';
import { LensRadiogroup } from './lens-radiogroup';
import { LensSwitchPreviewPanel } from './lens-switch-preview-panel';
import { ComposerIdentityCard } from './composer-identity-card';
import { projectIdentitySelection } from './identity-selection';
import { isTwoColumnMobileViewport } from './mobile-layout';
import {
  composerDestinationCapability,
  composerDestinationContract,
} from './destination-contract';
import { mapComposerDestination } from './composer-destination-client';
import {
  groundingBlockerFromMissing,
  type ComposerGroundingBlocker,
} from './composer-grounding-blocker';
import {
  decideComposerDestinationPreflight,
  type ComposerDestinationPreflightState,
} from './composer-destination-preflight';
import { projectComposerQuoteView } from './quote-wiring';
import {
  composerQueryPhase,
  currentComposerQuoteView,
  resolveComposerQuoteReadiness,
  type ComposerQuoteRetryTarget,
} from './quote-readiness';
import { ComposerQuoteStatusLine } from './quote-status-line';
import {
  listColdCardsFromSeeds,
  listColdCardsFromSurface,
} from './recipe-cards';
import { RecipeCardsPanel } from './recipe-cards-panel';
import { QuotaBlockingCard } from './quota-blocking-card';
import {
  composerQuotaRequirements,
  projectQuotaPassiveView,
} from './quota-blocking';
import {
  buildLiveBriefInput,
  buildLiveQuoteInput,
  COMPOSER_OPERATION_BY_LENS,
  COMPOSER_PLATFORM_DEFAULT_MODEL_BY_LENS,
  fetchComposerCatalog,
  fetchComposerPreferences,
  fetchComposerSurface,
  confirmComposerBrief,
  requestComposerBrief,
  requestComposerQuote,
  requestRecipePatchPreview,
  syncComposerBriefContext,
} from './composer-live';
import { composerDraftToRecipeFields } from './recipe-patch-preview-client';
import { submitComposerSubmission } from './composer-submission-client';
import {
  ComposerConversation,
  ComposerPromptBar,
  focusComposerIntentInput,
  type ComposerCreationMode,
  type ComposerReuseChip,
} from './composer-conversation';
import {
  ComposerQuestionCard,
  composerQuestionDecision,
} from './composer-question-card';
import {
  composerQuestionHold,
  type ComposerQuestionSettlement,
} from './composer-question-timeout';
import type { ComposerDeliveryOpenInput } from './composer-delivery-card';
import { projectComposerSignedPreview } from './composer-signed-preview';
import {
  ComposerImageOperationPicker,
  imageOperationAttachmentHint,
  imageOperationCardinality,
  type ComposerImageOperation,
} from './image-operation-picker';
import {
  applyComposerProgress,
  applyComposerQuestion,
  applyComposerWorkflowState,
  bindComposerTask,
  COMPOSER_SESSION_STORAGE_KEY,
  composerSessionMerchantText,
  createComposerSession,
  failComposerSession,
  openComposerTurn,
  rebindComposerSession,
  restoreComposerSession,
  restoreComposerSessionFromActiveTask,
  serializeComposerSession,
  type ComposerSession,
} from './composer-session';
import type { ComposerRecoveryInput } from './composer-report-card';

/** Which Result Center panel each 成品交付卡 action opens (T31 / #225). */
const DELIVERY_ACTION_PANELS: Record<
  ComposerDeliveryOpenInput['action'],
  ResultPanel
> = {
  adjust: 'adjust',
  adopt: 'result',
  export: 'delivery',
  open: 'run',
};

/**
 * 旧内容换平台 as conversation. Tapping a chip writes the merchant's own
 * sentence into the draft — the retired panel instead demanded source + form +
 * carrier before anything could start (D-031 违规位 ①, 归桶矩阵 §6.10).
 */
const COMPOSER_REUSE_CHIPS: ComposerReuseChip[] = [
  {
    id: 'xiaohongshu',
    label: '发小红书',
    intent: '把我之前发过的一条内容改成适合小红书的版本',
  },
  {
    id: 'douyin',
    label: '发抖音',
    intent: '把我之前发过的一条内容改成适合抖音的版本',
  },
  {
    id: 'wechat_moments',
    label: '发朋友圈',
    intent: '把我之前发过的一条内容改成适合朋友圈转发的版本',
  },
];

function briefSourcesFromDraft(sources: unknown[]): BriefSourceSignal[] {
  return sources.flatMap((source, index) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return [];
    }
    const value = source as Record<string, unknown>;
    return [
      {
        id: typeof value.id === 'string' ? value.id : `source-${index + 1}`,
        ...(typeof value.kind === 'string' ? { kind: value.kind } : {}),
        ...(typeof value.category === 'string'
          ? { category: value.category }
          : {}),
        ...(typeof value.containsPerson === 'boolean'
          ? { containsPerson: value.containsPerson }
          : {}),
        ...(typeof value.restricted === 'boolean'
          ? { restricted: value.restricted }
          : {}),
        ...(typeof value.rightsStatus === 'string'
          ? { rightsStatus: value.rightsStatus }
          : {}),
      },
    ];
  });
}

function sourceReferencesFromDraft(sources: unknown[]) {
  return sources.flatMap((source) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return [];
    }
    const id = (source as Record<string, unknown>).id;
    return typeof id === 'string' ? [{ id, kind: 'asset' as const }] : [];
  });
}

function groundingBlockerMessage(blocker: ComposerGroundingBlocker) {
  if (blocker === 'store') return workbench_grounding_store_required();
  if (blocker === 'qualification') {
    return workbench_grounding_qualification_required();
  }
  return workbench_grounding_source_required();
}

function groundingBlockerFromError(error: unknown) {
  if (!(error instanceof P1RequestError)) return null;
  const missing = error.details?.missing;
  if (!Array.isArray(missing)) return null;
  return groundingBlockerFromMissing(
    missing.filter(
      (value): value is CreativeGroundingRequirement =>
        value === 'confirmed_store' ||
        value === 'confirmed_project' ||
        value === 'confirmed_qualification' ||
        value === 'real_authorized_asset'
    )
  );
}

function sameBriefRevisions(
  left: BriefBoundRevisions,
  right: BriefBoundRevisions
) {
  return (
    left.draftRevisionId === right.draftRevisionId &&
    (left.recipeRevisionId ?? null) === (right.recipeRevisionId ?? null) &&
    (left.modelRevisionId ?? null) === (right.modelRevisionId ?? null) &&
    (left.quoteRevisionId ?? null) === (right.quoteRevisionId ?? null) &&
    (left.sourceRevisionId ?? null) === (right.sourceRevisionId ?? null) &&
    (left.surfaceRevisionId ?? null) === (right.surfaceRevisionId ?? null) &&
    (left.lensId ?? null) === (right.lensId ?? null)
  );
}

/**
 * One id per run. It keys the 报价 and the Brief context, both of which are
 * idempotent server-side — so a second attempt that reuses it is refused as a
 * key reused with a different payload, and the composer sits there re-quoting
 * into 409s. Every fresh attempt therefore gets a fresh id.
 */
function newComposerSessionId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `composer-${Date.now()}`;
}

export type ComposerHomeProps = {
  /** Optional viewport override for tests. */
  viewportWidth?: number;
  /** When true, skip live create and bind the session to a fixture task. */
  fixtureSubmit?: boolean;
  initialRecipeRevisionId?: string;
  initialSurfaceRevisionId?: string;
  /** T33: identity handed over by the identity page for this session only. */
  initialSessionIdentityId?: string;
  /** D-145 时间桥深链: reopen this in-flight run rather than the newest one. */
  initialTaskId?: string;
  /** Injectable for tests; browser sessionStorage is used by default. */
  sessionStore?: Storage;
};

export function ComposerHome({
  viewportWidth,
  fixtureSubmit = false,
  initialRecipeRevisionId,
  initialSessionIdentityId,
  initialSurfaceRevisionId,
  initialTaskId,
  sessionStore,
}: ComposerHomeProps = {}) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const product = useProductState();
  const storeFacts = useQuery({
    enabled: Boolean(product.state?.workspaceId),
    queryKey: p1QueryKeys.request('context', 'store_facts_active', {
      scope: { storeId: product.state?.workspaceId ?? '' },
    }),
    queryFn: ({ signal }) =>
      queryP1<StoreFact[]>(
        'context',
        {
          action: 'store_facts_active',
          payload: {
            scope: { storeId: product.state?.workspaceId ?? '' },
            at: new Date().toISOString(),
          },
        },
        signal
      ),
  });
  // `regulated` is a platform/category admission call, not a merchant answer:
  // the Day-0 profile has to be seeded with the admin default rather than a
  // hardcoded `false` (W01 / D-151④).
  const complianceDefaults = useComplianceDefaults();
  const primaryProjectId = product.state?.store?.projects[0]?.id;
  const primaryServiceFactId = primaryProjectId
    ? `store-project:${primaryProjectId}:service`
    : undefined;
  const primaryPriceFactId = primaryProjectId
    ? `store-project:${primaryProjectId}:price`
    : undefined;
  const activeStoreFactIds = new Set(
    (storeFacts.data ?? []).map((fact) => fact.factId)
  );
  const needsServiceHistory =
    storeFacts.isSuccess &&
    Boolean(
      primaryServiceFactId && !activeStoreFactIds.has(primaryServiceFactId)
    );
  const needsPriceHistory =
    storeFacts.isSuccess &&
    Boolean(primaryPriceFactId && !activeStoreFactIds.has(primaryPriceFactId));
  const serviceFactHistory = useQuery({
    enabled: needsServiceHistory,
    queryKey: p1QueryKeys.request('context', 'store_fact_history', {
      factId: primaryServiceFactId ?? '',
    }),
    queryFn: ({ signal }) =>
      queryP1<StoreFact[]>(
        'context',
        {
          action: 'store_fact_history',
          payload: { factId: primaryServiceFactId ?? '' },
        },
        signal
      ),
  });
  const priceFactHistory = useQuery({
    enabled: needsPriceHistory,
    queryKey: p1QueryKeys.request('context', 'store_fact_history', {
      factId: primaryPriceFactId ?? '',
    }),
    queryFn: ({ signal }) =>
      queryP1<StoreFact[]>(
        'context',
        {
          action: 'store_fact_history',
          payload: { factId: primaryPriceFactId ?? '' },
        },
        signal
      ),
  });
  const sourcePickerRef = useRef<HTMLElement | null>(null);
  const sourceFactsRef = useRef(new Map<string, ConfirmedAssetFacts>());
  const sourceRevisionRef = useRef(new Map<string, string>());
  const catalogSelectionAppliedRef = useRef(false);
  const sessionIdRef = useRef(newComposerSessionId());
  /**
   * Bumped whenever `sessionIdRef` is replaced. A ref is not reactive, so
   * without this the 报价 memo below would keep quoting under the id of the run
   * that already failed.
   */
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const briefContextRevisionRef = useRef<number | null>(null);
  const briefInputRef = useRef<BriefTriggerInput | null>(null);
  const [lensState, setLensState] = useState<ComposerLensState>(() =>
    createComposerLensState()
  );
  const [showRequiredHint, setShowRequiredHint] = useState(false);
  const [briefState, setBriefState] = useState<BriefSurfaceState>(() =>
    createBriefSurfaceState()
  );
  const [briefPending, setBriefPending] = useState(false);
  const [submissionQuotaBlocked, setSubmissionQuotaBlocked] = useState(false);
  const [submissionGroundingBlocked, setSubmissionGroundingBlocked] =
    useState<ComposerGroundingBlocker | null>(null);
  const [uploadsReady, setUploadsReady] = useState(true);
  // D-111 双入口: the entry declares itself, the server decides the route.
  const [creationMode, setCreationMode] =
    useState<ComposerCreationMode>('customized');
  const [imageOperation, setImageOperation] =
    useState<ComposerImageOperation>('image.generate');
  const [session, setSession] = useState<ComposerSession>(() =>
    createComposerSession(sessionIdRef.current)
  );
  const [questionPending, setQuestionPending] = useState(false);
  const [destinationMapPending, setDestinationMapPending] = useState(false);
  const destinationMapPendingRef = useRef(false);
  const destinationAutoSubmitIntentRef = useRef<string | null>(null);
  // 「再生成一次」thaws the lens first, so the actual submit has to wait for the
  // reopened state to land (attemptSubmit reads lensState from the closure).
  const [retryAfterReport, setRetryAfterReport] = useState(false);
  const [destinationPreflight, setDestinationPreflight] =
    useState<ComposerDestinationPreflightState | null>(null);
  const [sessionIdentityId, setSessionIdentityId] = useState<
    string | null | undefined
  >(undefined);

  const width =
    viewportWidth ?? (typeof window !== 'undefined' ? window.innerWidth : 1280);
  const singleColumn = !isTwoColumnMobileViewport({ width });
  const viewportKind = isMobile || singleColumn ? 'mobile' : 'desktop';

  const lensId = lensState.phase === 'unselected' ? null : lensState.lensId;
  const userText = lensState.draft.userText;
  const quoteView = lensState.draft.quoteView;
  const sourceReferences = useMemo(
    () => sourceReferencesFromDraft(lensState.draft.sources),
    [lensState.draft.sources]
  );
  const missingGrounding = useMemo(
    () => missingCreativeGrounding(product.state, sourceReferences),
    [product.state, sourceReferences]
  );

  const surfaceQuery = useQuery({
    queryKey: p1QueryKeys.request('creation-experience', 'surface_browser', {
      surfaceId: 'surface.home.launch',
    }),
    queryFn: ({ signal }) => fetchComposerSurface(signal),
  });
  // R-08 / #211: the Pro Studio entry states what the gate will decide.
  const proStudioEntitlement = useProStudioEntitlement();
  const identitiesQuery = useQuery(marketingIdentityProjectionQuery);
  const identitySelection = useMemo(
    () =>
      projectIdentitySelection({
        query: identitiesQuery.isPending
          ? { state: 'loading' }
          : identitiesQuery.isError
            ? { state: 'failed' }
            : {
                state: 'ready',
                identities: (identitiesQuery.data?.identities ?? []).map(
                  (identity) => ({
                    id: identity.identityId,
                    revision: String(identity.version),
                    label: identity.displayName,
                  })
                ),
                defaultIdentityId:
                  identitiesQuery.data?.defaultIdentity?.identityId ?? null,
              },
        sessionIdentityId,
      }),
    [
      identitiesQuery.data,
      identitiesQuery.isError,
      identitiesQuery.isPending,
      sessionIdentityId,
    ]
  );
  const sessionIdentityDecision = useMutation({
    mutationFn: (identityId: string | null) => {
      const identity = identitySelection.identities.find(
        (candidate) => candidate.id === identityId
      );
      return commandP1(
        'marketing-identity',
        {
          action: 'select_marketing_identity_for_session',
          payload: {
            identity: identity
              ? { identityId: identity.id, version: Number(identity.revision) }
              : null,
            reason: identity
              ? 'Use the selected voice for this Composer session.'
              : 'Use the official neutral store voice for this Composer session.',
            sessionId: sessionIdRef.current,
          },
        },
        `identity-session:${sessionIdRef.current}:${identity?.id ?? 'official-neutral'}`
      );
    },
    onSuccess: async () => {
      await invalidateMarketingIdentity(queryClient);
    },
    onError: () => toast.error('本次身份选择未能记入决策记录，请重试。'),
  });
  const defaultIdentityDecision = useMutation({
    mutationFn: (identityId: string) => {
      const identity = identitySelection.identities.find(
        (candidate) => candidate.id === identityId
      );
      if (!identity) throw new Error('Selected identity is unavailable.');
      return commandP1(
        'marketing-identity',
        {
          action: 'set_default_marketing_identity',
          payload: {
            expectedDecisionRevision:
              identitiesQuery.data?.defaultDecision?.decisionRevision ?? 0,
            identity: {
              identityId: identity.id,
              version: Number(identity.revision),
            },
            reason: 'Remember the voice chosen in Composer.',
          },
        },
        `identity-default:${identity.id}:${identity.revision}:${Date.now()}`
      );
    },
    onSuccess: async () => {
      await invalidateMarketingIdentity(queryClient);
    },
    onError: () => toast.error('默认身份未能保存，请重试。'),
  });
  // T33 / #227: the identity page's「本次会话选择」has no session of its own, so
  // it hands the choice over here. Session-scoped on purpose — this never
  // touches the remembered default.
  const handedOverIdentityRef = useRef(false);
  useEffect(() => {
    if (handedOverIdentityRef.current || !initialSessionIdentityId) return;
    const known = identitySelection.identities.some(
      (candidate) => candidate.id === initialSessionIdentityId
    );
    if (!known) return;
    handedOverIdentityRef.current = true;
    setSessionIdentityId(initialSessionIdentityId);
    sessionIdentityDecision.mutate(initialSessionIdentityId);
  }, [
    identitySelection.identities,
    initialSessionIdentityId,
    sessionIdentityDecision,
  ]);
  const usageQuery = useQuery({
    queryKey: p1QueryKeys.request('entitlements', 'projection'),
    queryFn: ({ signal }) =>
      queryP1<AccountUsageProjection>(
        'entitlements',
        { action: 'projection', payload: {} },
        signal
      ),
    staleTime: 30_000,
  });
  const catalogQuery = useQuery({
    enabled: lensId != null,
    queryKey: p1QueryKeys.request('model-supply', 'catalog', {
      operation: lensId ? COMPOSER_OPERATION_BY_LENS[lensId] : 'unselected',
    }),
    queryFn: ({ signal }) => {
      if (!lensId) throw new Error('Composer lens is required.');
      return fetchComposerCatalog(lensId, signal);
    },
  });
  const preferencesQuery = useQuery({
    enabled: lensId != null,
    queryKey: p1QueryKeys.request('model-supply', 'preferences', {
      operation: lensId ? COMPOSER_OPERATION_BY_LENS[lensId] : 'unselected',
    }),
    queryFn: ({ signal }) => {
      if (!lensId) throw new Error('Composer lens is required.');
      return fetchComposerPreferences(lensId, signal);
    },
  });
  const catalog = useMemo(
    () =>
      lensId && catalogQuery.data
        ? normalizeCatalog(
            catalogQuery.data,
            COMPOSER_OPERATION_BY_LENS[lensId]
          )
        : { models: [] },
    [catalogQuery.data, lensId]
  );
  const submissionRecipe = useMemo(() => {
    if (!lensId || !surfaceQuery.data) return undefined;
    const exact = lensState.draft.recipeRevisionId
      ? surfaceQuery.data.recipes.find(
          (recipe) =>
            recipe.revisionId === lensState.draft.recipeRevisionId &&
            recipe.lensId === lensId &&
            recipe.status === 'published'
        )
      : undefined;
    if (exact) return exact;
    const visibleRevisions = new Set(
      surfaceQuery.data.recipeRefs
        .filter((reference) => reference.visible && reference.lensId === lensId)
        .map((reference) => reference.recipeRevisionId)
    );
    return surfaceQuery.data.recipes.find(
      (recipe) =>
        recipe.lensId === lensId &&
        recipe.status === 'published' &&
        visibleRevisions.has(recipe.revisionId)
    );
  }, [lensId, lensState.draft.recipeRevisionId, surfaceQuery.data]);
  const selectedModel = useMemo(() => {
    if (!lensId || !preferencesQuery.isSuccess) return undefined;
    const explicitId = lensState.draft.fieldMeta.catalogModelId?.dirty
      ? (lensState.draft.settings.catalogModelId ?? undefined)
      : submissionRecipe?.modelPolicy.mode === 'fixed'
        ? submissionRecipe.modelPolicy.catalogModelId
        : undefined;
    const preferences = normalizePreferences(preferencesQuery.data);
    return resolveCreationModelSelection({
      catalog: catalog.models,
      currentSelection: explicitId,
      platformDefault: COMPOSER_PLATFORM_DEFAULT_MODEL_BY_LENS[lensId],
      userDefault: preferences.userDefault,
      workspaceDefault: preferences.workspaceDefault,
    })?.model;
  }, [
    catalog,
    lensId,
    lensState.draft.fieldMeta.catalogModelId?.dirty,
    lensState.draft.settings.catalogModelId,
    preferencesQuery.data,
    preferencesQuery.isSuccess,
    submissionRecipe?.modelPolicy,
  ]);
  const catalogRevision = catalogQuery.data?.revisionId ?? 'catalog-current';
  const submissionQuantity =
    (lensState.draft.fieldMeta.quantity?.dirty
      ? lensState.draft.settings.quantity
      : submissionRecipe?.delivery.quantity) ??
    lensState.draft.settings.quantity ??
    1;
  const submissionAspectRatio =
    lensState.draft.settings.aspectRatio ??
    submissionRecipe?.delivery.aspectRatio ??
    undefined;
  const submissionDurationSeconds =
    lensState.draft.settings.durationSeconds ??
    submissionRecipe?.delivery.durationSeconds ??
    undefined;
  const destination = composerDestinationContract(
    lensState.draft.delivery.platform ??
      submissionRecipe?.delivery.contentPackagePlatform,
    lensState.draft.delivery.distributionTarget
  );
  const submissionDelivery = {
    deliverableKind:
      lensState.draft.delivery.deliverableKind ??
      submissionRecipe?.delivery.deliverableKind ??
      null,
    platform:
      lensState.draft.delivery.platform ??
      submissionRecipe?.delivery.contentPackagePlatform ??
      null,
  };
  const submissionSettings = {
    ...lensState.draft.settings,
    aspectRatio: submissionAspectRatio ?? null,
    durationSeconds: submissionDurationSeconds ?? null,
    quantity: submissionQuantity,
  };
  const explicitImageOperation =
    creationMode === 'free' &&
    lensId === 'image_text' &&
    (submissionDelivery.deliverableKind === 'image_set' ||
      submissionDelivery.deliverableKind === 'poster')
      ? imageOperation
      : undefined;
  const imageCardinality = explicitImageOperation
    ? imageOperationCardinality(explicitImageOperation, sourceReferences.length)
    : { message: null, valid: true };
  const signedSubmissionParse =
    selectedModel && submissionRecipe && destination
      ? composerSubmissionSignedFieldsSchema.safeParse({
          creationMode,
          intent: userText,
          ...(explicitImageOperation
            ? { imageOperation: explicitImageOperation }
            : {}),
          catalogModel: {
            id: selectedModel.id,
            revision: catalogRevision,
          },
          recipe: {
            id: submissionRecipe.recipeId,
            revision: submissionRecipe.revisionId,
          },
          ...destination,
          deliverable: {
            kind: submissionDelivery.deliverableKind,
            quantity: submissionQuantity,
            ...(submissionAspectRatio
              ? { aspectRatio: submissionAspectRatio }
              : {}),
            ...(submissionDurationSeconds
              ? { durationSeconds: submissionDurationSeconds }
              : {}),
            ...(submissionRecipe.delivery.notePageBound
              ? { notePageBound: submissionRecipe.delivery.notePageBound }
              : {}),
          },
        })
      : null;
  const signedSubmission =
    signedSubmissionParse?.success === true ? signedSubmissionParse.data : null;
  const quoteInput = useMemo(() => {
    if (!lensId || !selectedModel || !signedSubmission) return null;
    return buildLiveQuoteInput({
      sessionId: sessionIdRef.current,
      lensId,
      model: selectedModel,
      // `signedSubmission` already carries the catalog revision, and quote
      // identity is derived from this payload — so the revision moves the key
      // through the submission rather than through a parallel argument.
      submission: signedSubmission,
      quantity: submissionQuantity,
      durationSeconds: submissionDurationSeconds,
      aspectRatio:
        submissionAspectRatio === '1:1' ||
        submissionAspectRatio === '3:4' ||
        submissionAspectRatio === '9:16'
          ? submissionAspectRatio
          : undefined,
    });
  }, [
    lensId,
    selectedModel,
    sessionEpoch,
    signedSubmission,
    submissionAspectRatio,
    submissionDurationSeconds,
    submissionQuantity,
  ]);
  /**
   * Quote identity is a digest of the whole billable payload, so every distinct
   * payload is its own quote — and quoting on each keystroke would leave a
   * trail of priced-but-never-submitted quotes behind the merchant's typing.
   * The window holds the request until the sentence stops moving, and asks once
   * for the version they actually stopped on.
   *
   * Held is not in flight: while this is open the composer says so in its own
   * words (`settling`), and the merchant can end it by pressing send.
   */
  const quoteId = quoteInput?.quoteId ?? null;
  const [settledQuoteId, setSettledQuoteId] = useState<string | null>(null);
  const quoteSettling = quoteId !== null && settledQuoteId !== quoteId;
  /**
   * The sentence the merchant pressed send on. Pressing inside the window ends
   * it *and* stands as the submit they asked for, so the run starts on the
   * price that sentence produces — otherwise the first press would only change
   * a status line and they would have to press again to be heard.
   */
  const armedQuoteIdRef = useRef<string | null>(null);
  const flushQuoteSettle = () => {
    if (quoteId !== null && settledQuoteId !== quoteId) {
      setSettledQuoteId(quoteId);
    }
  };
  useEffect(() => {
    if (quoteId === null) return;
    const timer = setTimeout(() => setSettledQuoteId(quoteId), 350);
    return () => clearTimeout(timer);
  }, [quoteId]);
  const quoteQuery = useQuery({
    enabled: quoteInput != null && settledQuoteId === quoteId,
    queryKey: p1QueryKeys.request('product-billing', 'quote', quoteInput ?? {}),
    queryFn: ({ signal }) => {
      if (!quoteInput) throw new Error('Composer quote input is required.');
      // The signal cancels a quote whose input the merchant already changed;
      // the command's own deadline bounds one that the server never answers.
      return requestComposerQuote(quoteInput, commandP1, { signal });
    },
    // One retry, not the default three: past that the merchant is waiting on
    // backoff with nothing on screen, which is the defect this ticket removes.
    retry: 1,
    staleTime: Number.POSITIVE_INFINITY,
  });
  /**
   * The bound view survives edits — it lives in the draft, and nothing clears
   * it when the merchant keeps typing. Held against the identity that produced
   * it, that is a stale price: the intent has moved on, the new quote is still
   * in flight (or conflicted, or timed out), and the old number would sit there
   * looking settled. Since quote identity is now a digest of the whole billable
   * payload, "still the current quote" is exactly "same quoteId", and anything
   * else falls back to the live state (#240 P1).
   */
  const currentQuoteView = currentComposerQuoteView(
    quoteView,
    quoteInput?.quoteId
  );
  /**
   * #240: "a query is in flight" and "a precondition never came together" used
   * to render the same 正在读取模型与报价… line, so a missing recipe, an absent
   * or unpriced default model, a missing destination and a failed preferences
   * read all looked like loading that would never end. Recomputed every render
   * rather than memoised — it is nine booleans and a lookup table.
   */
  const quoteReadiness = resolveComposerQuoteReadiness({
    lensSelected: lensId != null,
    surface: composerQueryPhase(surfaceQuery),
    catalog: composerQueryPhase(catalogQuery),
    preferences: composerQueryPhase(preferencesQuery),
    quote: quoteInput == null ? 'disabled' : composerQueryPhase(quoteQuery),
    settling: quoteSettling,
    hasRecipe: submissionRecipe != null,
    hasModel: selectedModel != null,
    hasDestination: destination != null,
    hasSignedSubmission: signedSubmission != null,
    hasQuoteView: currentQuoteView != null,
  });
  const retryQuoteReadiness = (
    target: Exclude<ComposerQuoteRetryTarget, null>
  ) => {
    if (target === 'surface') {
      void surfaceQuery.refetch();
      return;
    }
    if (target === 'catalog') {
      // Both feed `selectedModel`; retrying one alone leaves the other stale.
      void catalogQuery.refetch();
      void preferencesQuery.refetch();
      return;
    }
    void quoteQuery.refetch();
  };
  const coldCards = useMemo(
    () =>
      surfaceQuery.data
        ? listColdCardsFromSurface(surfaceQuery.data)
        : listColdCardsFromSeeds(),
    [surfaceQuery.data]
  );
  // Read-only echo of the fields the server signs and admission freezes (T08).
  // Deliberately a projection, never inputs: the retired settings grid edited
  // these five values in place, which is the D-031 槽位填表 this shell removes.
  const signedPreview = useMemo(
    () =>
      signedSubmission
        ? projectComposerSignedPreview({
            signed: signedSubmission,
            modelName: selectedModel?.displayName,
          })
        : null,
    [selectedModel?.displayName, signedSubmission]
  );
  // 图文 debits two buckets server-side (copy 1 + image·pages). Pre-checking
  // only the image bucket let an image-rich / copy-empty merchant submit a run
  // the server was always going to reject (P0-5 / W05 ①).
  //
  // Count from `submissionQuantity` — the same value that becomes
  // `deliverable.quantity` in the signed submission below, and therefore the
  // one the server bills off (`server-quote-authority.ts` reads
  // `submission.deliverable.quantity`). The draft setting is not that number:
  // until the merchant dirties the field it is the recipe that decides, so an
  // image_set recipe of 4 against an untouched draft of 1 would pre-check a
  // quarter of what the run actually debits — the same class of defect this
  // pre-check exists to kill, in a new shape.
  const quotaRequirements = useMemo(
    () =>
      composerQuotaRequirements({
        lensId,
        deliverableKind: submissionDelivery.deliverableKind,
        quantity: submissionQuantity,
        notePageBound: submissionRecipe?.delivery.notePageBound ?? null,
      }),
    [
      lensId,
      submissionQuantity,
      submissionDelivery.deliverableKind,
      submissionRecipe?.delivery.notePageBound,
    ]
  );
  const quotaPassive = useMemo(
    () =>
      projectQuotaPassiveView({
        requirements: quotaRequirements,
        available: {
          copy: usageQuery.data?.usage.copy.available ?? null,
          image: usageQuery.data?.usage.image.available ?? null,
          video: usageQuery.data?.usage.video.available ?? null,
        },
      }),
    [quotaRequirements, usageQuery.data]
  );
  const quotaBlocked = quotaPassive.short || submissionQuotaBlocked;

  useEffect(() => {
    emitTelemetry('identity_state', { state: identitySelection.state });
  }, [identitySelection.state]);

  // `quote_state` was reserved in the telemetry allowlist with nothing emitting
  // it; with the states enumerated there is finally something to report, and a
  // precondition that silently blocks quoting is now visible off-box (#240).
  useEffect(() => {
    if (!lensId) return;
    emitTelemetry('quote_state', {
      operation: COMPOSER_OPERATION_BY_LENS[lensId],
      state: quoteReadiness.state,
    });
  }, [lensId, quoteReadiness.state]);

  useEffect(() => {
    if (
      catalogSelectionAppliedRef.current ||
      !initialRecipeRevisionId ||
      !initialSurfaceRevisionId ||
      !surfaceQuery.data
    ) {
      return;
    }
    catalogSelectionAppliedRef.current = true;
    setLensState(
      (current) =>
        applyCatalogRecipeSelection({
          state: current,
          surface: surfaceQuery.data!,
          recipeRevisionId: initialRecipeRevisionId,
          surfaceRevisionId: initialSurfaceRevisionId,
        }).state
    );
  }, [initialRecipeRevisionId, initialSurfaceRevisionId, surfaceQuery.data]);

  useEffect(() => {
    if (!selectedModel || lensState.phase === 'frozen') return;
    if (
      lensState.draft.settings.catalogModelId === selectedModel.id &&
      lensState.draft.settings.catalogModelRevision === catalogRevision
    ) {
      return;
    }
    setLensState((current) =>
      updateSettings(
        current,
        {
          catalogModelId: selectedModel.id,
          catalogModelName: selectedModel.displayName,
          catalogModelRevision: catalogRevision,
        },
        'system'
      )
    );
  }, [catalogRevision, lensState, selectedModel]);

  useEffect(() => {
    if (!quoteQuery.data || lensState.phase === 'frozen') return;
    const nextView = projectComposerQuoteView(
      quoteQuery.data,
      lensState.draft.settings.quantity ?? 1
    );
    // Revision alone is not identity. The server fingerprints a revision by the
    // priced facts, so 再生成一次 — same sentence, same model, new session —
    // comes back on the revision already bound while the quote *id* has moved.
    // The gate compares ids (`currentComposerQuoteView`), so a bind that only
    // watches revisions would leave the failed run's id bound forever and the
    // send button disabled with nothing on screen to explain it (#236 W03).
    if (
      lensState.draft.quoteRevisionId === nextView.revision &&
      lensState.draft.quoteView?.quoteId === nextView.quoteId
    ) {
      return;
    }
    setLensState((current) => bindQuoteView(current, nextView));
  }, [quoteQuery.data, lensState]);

  const store = useMemo(() => {
    if (sessionStore) return sessionStore;
    return typeof window === 'undefined' ? null : window.sessionStorage;
  }, [sessionStore]);

  // Refresh restore. Only the task handle was persisted; the transcript comes
  // back because the workflow event log replays from the start for a subscriber
  // without `last-event-id`.
  useEffect(() => {
    if (!store) return;
    const restored = restoreComposerSession({
      raw: store.getItem(COMPOSER_SESSION_STORAGE_KEY),
      nowIso: new Date().toISOString(),
    });
    if (restored.kind !== 'restored') {
      if (restored.kind !== 'missing') {
        store.removeItem(COMPOSER_SESSION_STORAGE_KEY);
      }
      return;
    }
    // A deep link names the run the merchant asked for. The tab's own handle is
    // just whatever it held last, so it must not open ahead of that ask — the
    // server restore below binds the named run instead.
    if (initialTaskId && restored.session.task?.taskId !== initialTaskId) {
      return;
    }
    sessionIdRef.current = restored.session.sessionId;
    setSession(restored.session);
    setLensState((current) =>
      updateUserText(
        current,
        restored.session.turns[0]?.kind === 'merchant'
          ? restored.session.turns[0].text
          : ''
      )
    );
  }, [store]);

  useEffect(() => {
    if (!store) return;
    const persisted = serializeComposerSession(
      session,
      new Date().toISOString()
    );
    if (!persisted) return;
    store.setItem(COMPOSER_SESSION_STORAGE_KEY, JSON.stringify(persisted));
  }, [session, store]);

  /**
   * 时间桥拉回 (D-145). The browser handle lives in sessionStorage, so closing
   * the tab used to be a permanent way out of a run that was still going. The
   * server keeps the only truth, so the composer asks it on mount: if something
   * is still in flight the handle comes back, and the event log replay rebuilds
   * the transcript exactly as it stood.
   *
   * Deliberately never overrides a live session — only a composer with nothing
   * bound adopts a server-side run.
   */
  const activeTasksQuery = useQuery({
    queryKey: ['harness', 'active-tasks'],
    queryFn: ({ signal }) => readActiveHarnessTasks(signal),
    // One shot per mount; the run itself streams over SSE from there on.
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 30_000,
  });
  const restoredFromServerRef = useRef(false);

  useEffect(() => {
    if (restoredFromServerRef.current) return;
    // Nothing to adopt when the composer already holds the run being asked for
    // (or holds one and nothing else was asked for). Only an explicit deep link
    // may displace a bound session, and only in favour of the run it names.
    if (
      session.task &&
      (!initialTaskId || session.task.taskId === initialTaskId)
    ) {
      return;
    }
    const tasks = activeTasksQuery.data?.tasks ?? [];
    // A deep link from the task centre names the run it wants reopened; without
    // one the newest in-flight run is the conversation to come back to.
    const task = initialTaskId
      ? tasks.find((candidate) => candidate.taskId === initialTaskId)
      : tasks[0];
    if (!task) return;
    restoredFromServerRef.current = true;
    const restored = restoreComposerSessionFromActiveTask({
      sessionId: sessionIdRef.current,
      task,
    });
    setSession(restored);
    setLensState((current) => updateUserText(current, task.merchantText));
  }, [activeTasksQuery.data, initialTaskId, session.task]);

  const taskId = session.task?.taskId ?? '';
  // Harness tasks are not a P1 query module — the existing harness surfaces key
  // them by hand (see product/harness-question-card.tsx).
  const workflowQueryKey = useMemo(
    () => ['harness', 'workflow', taskId] as const,
    [taskId]
  );
  const decisionQueryKey = useMemo(
    () => ['harness', 'decision', taskId] as const,
    [taskId]
  );
  const workflowStream = useWorkflowEventStream({
    enabled: Boolean(taskId),
    workflowId: taskId,
    workflowQueryKey,
  });

  useEffect(() => {
    if (!workflowStream.latestProgress) return;
    setSession((current) =>
      applyComposerProgress(current, workflowStream.latestProgress!)
    );
  }, [workflowStream.latestProgress]);

  useEffect(() => {
    if (!workflowStream.workflowState) return;
    // 成品版本 rides the same terminal frame as the status, so the delivery card
    // binds its actions to the revision the server actually delivered — and so
    // does the 失败/partial 申报 (W03), which is why neither needs a second read.
    setSession((current) =>
      applyComposerWorkflowState(
        current,
        workflowStream.workflowState!,
        workflowStream.harnessDelivery,
        workflowStream.harnessCancellation,
        workflowStream.merchantReport
      )
    );
  }, [
    workflowStream.workflowState,
    workflowStream.harnessDelivery,
    workflowStream.harnessCancellation,
    workflowStream.merchantReport,
  ]);

  useEffect(() => {
    // 额度退还可见: a failed run gives the reservation back, so the passive quota
    // line must stop showing the number from before the run.
    if (workflowStream.workflowState !== 'failed') return;
    void queryClient.invalidateQueries({
      queryKey: ['harness', 'active-tasks'],
    });
    void usageQuery.refetch();
  }, [workflowStream.workflowState]);

  // 需要用户的一个问题 — the third inbound seam message. Polled while the run is
  // live so a suspended workflow surfaces its card without a page action.
  const decisionQuery = useQuery({
    enabled: Boolean(taskId) && session.phase !== 'delivered',
    queryKey: decisionQueryKey,
    queryFn: ({ signal }) => readPendingHarnessDecision(taskId, signal),
    refetchInterval: session.phase === 'delivered' ? false : 2_000,
  });
  const pendingQuestion: QuestionCard | null =
    decisionQuery.data?.question ?? null;
  const questionResolutionSource =
    decisionQuery.data?.resolutionSource === 'core_timeout' ||
    decisionQuery.data?.resolutionSource === 'core_hold_expired'
      ? decisionQuery.data.resolutionSource
      : null;
  const questionTimeoutSeconds = decisionQuery.data?.timeoutSeconds ?? null;

  useEffect(() => {
    setSession((current) =>
      applyComposerQuestion(current, pendingQuestion?.questionId ?? null)
    );
  }, [
    pendingQuestion?.questionId,
    questionResolutionSource,
    workflowStream.workflowState,
  ]);

  const tokenStream = useMemo(
    () =>
      projectResultTokenStream({
        workspaceKind: lensId === 'image_text' ? 'image_text' : 'copy',
        partialCandidates: workflowStream.copyCandidates,
        progressState: workflowStream.workflowState,
        loading: session.phase === 'running' || session.phase === 'submitting',
        completed: session.phase === 'delivered',
        reconnecting: workflowStream.transportStatus === 'degraded',
      }),
    [
      lensId,
      session.phase,
      workflowStream.copyCandidates,
      workflowStream.transportStatus,
      workflowStream.workflowState,
    ]
  );

  const answerQuestion = useCallback(
    async (input: {
      settlement: ComposerQuestionSettlement;
      value: string;
    }) => {
      if (!pendingQuestion || !taskId) return;
      setQuestionPending(true);
      try {
        const result = await submitHarnessDecision(
          taskId,
          composerQuestionDecision({
            question: pendingQuestion,
            // The settlement is part of the key: an explicit 「继续」 and a
            // countdown release are different acts and must stay separable in
            // the ledger, even though both route as ignored.
            idempotencyKey: `composer-decision:${pendingQuestion.questionId}:${input.settlement}`,
            settlement: input.settlement,
            value: input.value,
          })
        );
        if ('consumedByOther' in result) {
          toast.info('系统已先一步处理，正在同步最新状态。');
        } else if (result.successor) {
          toast.success('已收到补充，正在生成精修版本。');
        }
        await decisionQuery.refetch();
        return result;
      } catch (error) {
        toast.error(workbench_operation_failed());
        // Rethrow: the card claimed a settlement synchronously so the countdown
        // could not race it, and nothing reached the ledger, so that claim has
        // to be released rather than left standing as 「已按…继续」.
        throw error;
      } finally {
        setQuestionPending(false);
      }
    },
    [decisionQuery, pendingQuestion, taskId]
  );

  const addSource = (assetId: string) => {
    const facts = sourceFactsRef.current.get(assetId);
    const revision = sourceRevisionRef.current.get(assetId);
    if (!facts || !revision) return;
    setLensState((current) =>
      updateSources(current, [
        ...current.draft.sources.filter(
          (source) =>
            !source ||
            typeof source !== 'object' ||
            Array.isArray(source) ||
            (source as Record<string, unknown>).id !== assetId
        ),
        {
          id: assetId,
          kind: 'asset',
          revision,
          category: facts.category,
          containsPerson: facts.containsPerson,
          restricted:
            facts.category === 'customer_case' ||
            facts.category === 'before_after' ||
            facts.containsPerson,
          rightsStatus: facts.consentScope,
        },
      ])
    );
  };

  const removeSource = (assetId: string) => {
    sourceFactsRef.current.delete(assetId);
    sourceRevisionRef.current.delete(assetId);
    setLensState((current) =>
      updateSources(
        current,
        current.draft.sources.filter(
          (source) =>
            !source ||
            typeof source !== 'object' ||
            Array.isArray(source) ||
            (source as Record<string, unknown>).id !== assetId
        )
      )
    );
  };

  /**
   * The submission gate reads `product.state`, and `useProductState` only
   * fetches on mount — so an asset written straight through
   * `executeProductCommand` never enters the state the gate consults, and
   * `missingCreativeGrounding` keeps reporting `real_authorized_asset` missing
   * for a source the server has already authorized. Every inline asset write
   * ends here, the same way the ProgressiveFactCard confirm below does.
   */
  const refreshAfterAssetWrite = async () => {
    setSubmissionGroundingBlocked(null);
    await product.refresh();
  };

  const uploadComposerImage = async (
    file: File,
    facts: ConfirmedAssetFacts,
    identity: ComposerImageIdentity
  ) => {
    const body = new FormData();
    body.append('file', file);
    body.append('uploadId', identity.uploadId);
    body.append('contentHash', identity.contentHash);
    const receipt = await uploadProductAsset({ data: body });
    await executeProductCommand(
      {
        type: 'add_asset',
        asset: {
          id: identity.assetId,
          mediaType: 'image',
          objectKey: receipt.key,
          sourceType: 'real',
          tags: file.name.trim() ? [file.name.slice(0, 40)] : [],
          category: facts.category,
          consentScope: 'internal_only',
          containsPerson: facts.containsPerson,
          containsSensitiveData: facts.containsSensitiveData,
          minorStatus: facts.minorStatus,
          rightsOwner:
            facts.rightsOwner?.trim() ||
            product.state?.store?.name?.trim() ||
            '门店',
        },
      },
      `composer-asset:${identity.contentHash}`
    );
    sourceRevisionRef.current.set(identity.assetId, receipt.contentHash);
    sourceFactsRef.current.set(identity.assetId, facts);
    if (facts.consentScope === 'internal_only') {
      await refreshAfterAssetWrite();
      return { attached: false };
    }
    const authorization = {
      type: 'authorize_asset' as const,
      assetId: identity.assetId,
      consentScope: facts.consentScope,
      rightsEvidence: facts.rightsEvidence,
      rightsNoFixedExpiry: facts.rightsNoFixedExpiry,
      rightsPlatforms: facts.rightsPlatforms,
      rightsValidUntil: facts.rightsValidUntil,
    };
    await executeProductCommand(
      authorization,
      await assetAuthorizationIdempotencyKey(authorization)
    );
    await refreshAfterAssetWrite();
    return { attached: true };
  };

  const authorizeComposerImage = async (
    assetId: string,
    facts: ConfirmedAssetFacts
  ) => {
    if (facts.consentScope !== 'public_marketing') return;
    const authorization = {
      type: 'authorize_asset' as const,
      assetId,
      consentScope: facts.consentScope,
      rightsEvidence: facts.rightsEvidence,
      rightsNoFixedExpiry: facts.rightsNoFixedExpiry,
      rightsPlatforms: facts.rightsPlatforms,
      rightsValidUntil: facts.rightsValidUntil,
    };
    await executeProductCommand(
      authorization,
      await assetAuthorizationIdempotencyKey(authorization)
    );
    sourceFactsRef.current.set(assetId, facts);
    await refreshAfterAssetWrite();
  };

  const createWork = useMutation({
    mutationFn: async (input: {
      briefConfirmationId?: string;
      briefContextId: string;
      briefContextRevision: number;
      briefInput: BriefTriggerInput;
      identity?: MarketingIdentityAsset;
      identityDecision?: { id: string; revision: number };
      lensId: CreationLensId;
      intent: string;
      quote: ProductQuoteSnapshot;
      recipe: BrowserRecipeProjection;
      videoConfirmAccepted?: boolean;
    }) => {
      if (fixtureSubmit) {
        return {
          contentPackage: {
            expectedRevision: 0,
            id: `fixture-package-${input.lensId}`,
          },
          task: { id: `fixture-task-${input.lensId}` },
          work: { id: `fixture-work-${input.lensId}` },
        };
      }
      if (input.lensId === 'video' && !input.videoConfirmAccepted) {
        throw new Error('Video quote confirmation is required.');
      }
      const currentBrief = await requestComposerBrief({
        ...input.briefInput,
        ...(input.briefConfirmationId
          ? { confirmationId: input.briefConfirmationId }
          : {}),
      });
      if (
        currentBrief.requiresBrief ||
        (input.briefConfirmationId && !currentBrief.confirmationValid)
      ) {
        throw new Error('Brief confirmation is no longer current.');
      }

      if (!signedSubmission) {
        throw new Error('Composer delivery contract is incomplete.');
      }
      const catalogModelRevision = input.quote.catalogModelRevision;
      if (!catalogModelRevision) {
        throw new Error('Composer quote is missing its catalog revision.');
      }
      const assets = lensState.draft.sources.flatMap((source) => {
        if (!source || typeof source !== 'object' || Array.isArray(source)) {
          return [];
        }
        const candidate = source as Record<string, unknown>;
        return typeof candidate.id === 'string' &&
          typeof candidate.revision === 'string'
          ? [
              {
                id: candidate.id,
                revision: candidate.revision,
                role: 'reference' as const,
              },
            ]
          : [];
      });
      if (assets.length !== sourceReferences.length) {
        throw new Error('Composer source revisions are incomplete.');
      }
      return submitComposerSubmission({
        ...signedSubmission,
        ...(input.briefConfirmationId
          ? {
              briefConfirmation: {
                id: input.briefConfirmationId,
                revision: currentBrief.bindRevisions.draftRevisionId,
              },
            }
          : {}),
        briefContext: {
          id: input.briefContextId,
          revision: input.briefContextRevision,
        },
        catalogModel: {
          id: input.quote.catalogModelId,
          revision: catalogModelRevision,
        },
        ...(input.identity
          ? {
              identity: {
                id: input.identity.identityId,
                revision: String(input.identity.version),
              },
            }
          : {}),
        ...(input.identityDecision
          ? { identityDecision: input.identityDecision }
          : {}),
        idempotencyKey: `composer-submit:${sessionIdRef.current}:${input.quote.revision}`,
        creationMode,
        intent: input.intent,
        quote: {
          id: input.quote.quoteId,
          revision: input.quote.revision,
        },
        recipe: {
          id: input.recipe.recipeId,
          revision: input.recipe.revisionId,
        },
        sources: { assets },
        surface: {
          id: surfaceQuery.data!.surfaceId,
          revision: surfaceQuery.data!.revisionId,
        },
      });
    },
    onSuccess: (created, variables) => {
      const submitted = submitComposer(lensState, {
        videoConfirmAccepted:
          variables.lensId === 'video'
            ? variables.videoConfirmAccepted
            : undefined,
        confirmPriceMatchesCharge: true,
      });
      if (submitted.ok) {
        setLensState(submitted.state);
      }
      toast.success(workbench_work_created());
      // ADR-0014「提交后不跳转」— the run streams here and finishes as a
      // 成品预览卡. Opening the Result Center stays a merchant action.
      setSession((current) =>
        bindComposerTask(current, {
          taskId: created.task.id,
          workId: created.work.id,
          packageId: created.contentPackage.id,
        })
      );
    },
    onMutate: () => setSubmissionGroundingBlocked(null),
    onError: (error) => {
      setSession((current) => failComposerSession(current));
      if (p1ErrorCode(error) === 'CREATIVE_GROUNDING_INCOMPLETE') {
        const blocker =
          groundingBlockerFromError(error) ??
          groundingBlockerFromMissing(missingGrounding);
        if (blocker) {
          setSubmissionGroundingBlocked(blocker);
          toast.error(groundingBlockerMessage(blocker));
          return;
        }
      }
      if (
        p1ErrorCode(error) === 'INSUFFICIENT_ENTITLEMENT' ||
        p1ErrorCode(error) === 'ENTITLEMENT_INSUFFICIENT'
      ) {
        setSubmissionQuotaBlocked(true);
        void queryClient.invalidateQueries({
          queryKey: p1QueryKeys.request('entitlements', 'projection'),
        });
      }
      toast.error(workbench_work_create_failed());
    },
  });

  const runCreate = (
    selectedLens: CreationLensId,
    videoConfirmAccepted?: boolean,
    briefConfirmationId?: string
  ) => {
    const identity = identitiesQuery.data?.identities.find(
      (candidate) => candidate.identityId === identitySelection.selected?.id
    );
    const briefInput = briefInputRef.current;
    const briefContextRevision = briefContextRevisionRef.current;
    // `quote` joins the guard rather than staying a `!` assertion: every caller
    // already checks it, and a run must carry the price it was admitted on.
    const quote = quoteQuery.data;
    if (
      !submissionRecipe ||
      !briefInput?.briefContextId ||
      briefContextRevision === null ||
      !quote
    ) {
      toast.error(workbench_operation_failed());
      return;
    }
    const intent =
      lensState.draft.userText.trim() || coldCards[0]?.title || '创作';
    createWork.mutate({
      briefContextId: briefInput.briefContextId,
      briefContextRevision,
      briefInput,
      identity,
      ...(identitySelection.source === 'default' &&
      identitiesQuery.data?.defaultDecision
        ? {
            identityDecision: {
              id: identitiesQuery.data.defaultDecision.decisionId,
              revision: identitiesQuery.data.defaultDecision.decisionRevision,
            },
          }
        : {}),
      lensId: selectedLens,
      intent,
      quote,
      recipe: submissionRecipe,
      videoConfirmAccepted,
      ...(briefConfirmationId
        ? {
            briefConfirmationId,
          }
        : {}),
    });
  };

  const handleLensChange = (next: CreationLensId) => {
    setShowRequiredHint(false);
    setSubmissionGroundingBlocked(null);
    setLensState(selectLens(lensState, next));
  };

  const handleIntentChange = (value: string) => {
    setSubmissionGroundingBlocked(null);
    destinationAutoSubmitIntentRef.current = null;
    setDestinationPreflight(null);
    setLensState((current) => {
      const withoutSystemDestination =
        current.draft.fieldMeta.deliveryPlatform?.ownership === 'system'
          ? updateDeliverySuggestion(
              current,
              { distributionTarget: null, platform: null },
              'system'
            )
          : current;
      return updateUserText(withoutSystemDestination, value);
    });
  };

  /**
   * The delivery card is the only navigation out of the conversation
   * (ADR-0014 提交后不跳转). Each action opens the Result Center panel that owns
   * it, bound to the revision the workflow actually delivered — the card never
   * mutates, so adoption keeps running through the canonical command path.
   */
  const openDelivery = (input: ComposerDeliveryOpenInput) => {
    const location = navigateAfterSubmitSuccess({
      workId: input.workId,
      sourceRoute: '/dashboard',
      panel: DELIVERY_ACTION_PANELS[input.action],
    });
    void navigate({
      to: '/dashboard/results/$workId',
      params: { workId: input.workId },
      search: {
        ...location.search,
        // No taskId: the result route reconnects canonically from the Work
        // (content_packages binds Work and Task atomically, H01), so a task id
        // in the URL is a second truth with no reader — and a stale link would
        // be the one thing able to disagree with the server.
        ...(input.revision
          ? {
              contentId: input.revision.packageId,
              versionId: input.revision.versionId,
            }
          : {}),
      },
      replace: false,
    });
  };

  /**
   * 可恢复入口 (W03). A 申报卡 without a way back in is just a nicer dead end, so
   * every entry lands the merchant somewhere they can act: back in the composer
   * with their own sentence, on a different form, or on the part that did land.
   */
  const recoverFromReport = (input: ComposerRecoveryInput) => {
    const merchantText = composerSessionMerchantText(session);
    // A failed run leaves the lens frozen, which disables the composer and
    // makes canSubmit refuse — so every entry has to thaw before it can act,
    // or the button is decoration.
    if (input.action !== 'review_partial') {
      setLensState((current) => {
        const reopened = reopenComposer(current);
        // Put their sentence back only when the composer lost it — once they
        // start editing after 改一下要求, the field is theirs.
        return merchantText && !reopened.draft.userText.trim()
          ? updateUserText(reopened, merchantText)
          : reopened;
      });
      // Coming back in starts a new attempt, and the session id is what names
      // an attempt: 报价 and Brief context are both idempotent on it, so the
      // server refuses the next quote under the id that already ran. Reusing it
      // would leave the composer editable but unable to submit — the same dead
      // end through a different door.
      sessionIdRef.current = newComposerSessionId();
      setSessionEpoch((current) => current + 1);
      briefContextRevisionRef.current = null;
      briefInputRef.current = null;
      // Rebinding unbinds the finished run, which would otherwise look to the
      // mount-time restore like a composer with nothing in it and invite some
      // other in-flight run into the tab mid-edit. The merchant has taken this
      // conversation over; the restore decision is behind us.
      restoredFromServerRef.current = true;
      setSession((current) =>
        rebindComposerSession(current, sessionIdRef.current)
      );
    }
    switch (input.action) {
      case 'retry':
        setSession(createComposerSession(sessionIdRef.current));
        // Deferred: attemptSubmit reads the closure's lensState, which is still
        // frozen on this tick. The effect below fires it once the thaw lands.
        setRetryAfterReport(true);
        return;
      case 'adjust_intent':
        focusComposerIntentInput();
        return;
      case 'switch_form':
        // The lens radiogroup is the one place a form is chosen; sending the
        // merchant there beats inventing a second switch inside the card.
        document
          .querySelector<HTMLElement>(
            '[data-testid="composer-lens-radiogroup"]'
          )
          ?.scrollIntoView?.({ block: 'nearest' });
        focusComposerIntentInput();
        return;
      case 'review_partial': {
        const task = session.task;
        if (!task) return;
        openDelivery({
          action: 'open',
          revision: null,
          taskId: task.taskId,
          workId: task.workId,
        });
      }
    }
  };

  const attemptSubmit = async () => {
    if (!imageCardinality.valid) {
      document
        .querySelector<HTMLElement>(
          '[data-testid="composer-image-operation-picker"]'
        )
        ?.focus();
      return;
    }
    const gate = canSubmit(lensState);
    if (!gate.allowed && gate.reason !== 'video_confirm_required') {
      setShowRequiredHint(true);
      if (gate.focusTarget === 'lens_group') {
        document
          .querySelector<HTMLElement>(
            '[data-testid="composer-lens-radiogroup"]'
          )
          ?.focus();
      }
      return;
    }

    if (lensState.phase !== 'selected') return;
    const destinationDecision = decideComposerDestinationPreflight({
      hasExplicitDestination:
        lensState.draft.fieldMeta.deliveryPlatform?.ownership === 'user' &&
        lensState.draft.fieldMeta.deliveryPlatform.dirty,
      intent: lensState.draft.userText,
      state: destinationPreflight,
    });
    if (destinationDecision.kind === 'map') {
      if (destinationMapPendingRef.current) return;
      destinationMapPendingRef.current = true;
      setDestinationMapPending(true);
      try {
        const result = await mapComposerDestination(
          destinationDecision.destination
        );
        setDestinationPreflight({
          intent: destinationDecision.destination,
          result,
        });
        if (result.status === 'mapped') {
          destinationAutoSubmitIntentRef.current =
            destinationDecision.destination;
          setLensState((current) =>
            current.draft.userText.trim() === destinationDecision.destination
              ? updateDeliverySuggestion(
                  current,
                  {
                    distributionTarget: result.distributionTarget,
                    platform: result.contentPackagePlatform,
                  },
                  'system'
                )
              : current
          );
        }
      } catch {
        toast.error('暂时无法确认发布去向，请重试或直接选择平台。');
      } finally {
        destinationMapPendingRef.current = false;
        setDestinationMapPending(false);
      }
      return;
    }
    if (destinationDecision.kind === 'block') {
      document
        .querySelector<HTMLElement>(
          '[data-testid="composer-destination-clarification"]'
        )
        ?.focus();
      return;
    }
    if (quotaBlocked) {
      setSubmissionQuotaBlocked(true);
      return;
    }
    // `currentQuoteView`, not `quoteView`: a run must never be admitted against
    // a price the merchant's current input no longer produces (#240 P1).
    if (!quoteQuery.data || !currentQuoteView || !submissionRecipe) {
      if (quoteSettling) {
        // Pressing send *is* the merchant saying the sentence is final. End the
        // window, ask for the price now, and remember that they asked: the run
        // starts as soon as that price lands. Flushing without arming would
        // make the first press change a status line and nothing else — a dead
        // press, which is the defect this ticket exists to remove.
        armedQuoteIdRef.current = quoteId;
        flushQuoteSettle();
        return;
      }
      setShowRequiredHint(true);
      return;
    }
    const groundingBlocker =
      product.state && !product.loading && !product.error
        ? groundingBlockerFromMissing(missingGrounding)
        : null;
    if (groundingBlocker) {
      setSubmissionGroundingBlocked(groundingBlocker);
      return;
    }

    // The merchant's sentence opens the conversation before any backend round
    // trip, so the container reads as a reply rather than a blank wait.
    setSession((current) =>
      openComposerTurn(current, lensState.draft.userText)
    );

    setBriefPending(true);
    let projection: BriefTriggerProjection | undefined;
    try {
      const briefContextId = `composer:${sessionIdRef.current}`;
      const briefContext = await syncComposerBriefContext({
        briefContextId,
        draft: {
          delivery: submissionDelivery,
          imageOperation: explicitImageOperation ?? null,
          settings: submissionSettings,
          sources: briefSourcesFromDraft(lensState.draft.sources),
          userText: lensState.draft.userText,
        },
        expectedRevision: briefContextRevisionRef.current,
        lensId: lensState.lensId,
        quoteId: quoteQuery.data.quoteId,
        recipeRevisionId: submissionRecipe.revisionId,
        sourceIds: sourceReferences.map((source) => source.id),
        surfaceRevisionId:
          surfaceQuery.data?.revisionId ?? initialSurfaceRevisionId ?? null,
      });
      briefContextRevisionRef.current = briefContext.revision;
      const briefInput = buildLiveBriefInput({
        briefContextId,
        lensId: lensState.lensId,
        quote: quoteQuery.data,
        currentRevisions: briefContext.currentRevisions,
        delivery: submissionDelivery,
        imageCount: lensState.lensId === 'image_text' ? submissionQuantity : 0,
        sources: briefSourcesFromDraft(lensState.draft.sources),
        highRiskFacts:
          /价格|价目|团购|优惠|\d+\s*元/u.test(lensState.draft.userText) &&
          !lensState.draft.sources.some(
            (source) =>
              source &&
              typeof source === 'object' &&
              !Array.isArray(source) &&
              (source as Record<string, unknown>).category === 'price_list'
          )
            ? [{ kind: 'price', status: 'missing' }]
            : [],
      });
      briefInputRef.current = briefInput;
      projection = await requestComposerBrief(briefInput);
    } catch {
      // The merchant turn is already in the transcript; mark the attempt failed
      // so the container does not sit in `submitting` forever.
      setSession((current) => failComposerSession(current));
      toast.error(workbench_operation_failed());
      return;
    } finally {
      setBriefPending(false);
    }

    // Video paths always require explicit Brief accept — never runCreate
    // while the lens gate reports video_confirm_required or lens is video.
    const videoConfirmRequired =
      lensState.lensId === 'video' ||
      (!gate.allowed && gate.reason === 'video_confirm_required');

    if (videoConfirmRequired && !projection) {
      setShowRequiredHint(true);
      return;
    }

    const path = decideSubmitPath({
      projection,
      videoConfirmRequired,
    });
    if (path.path === 'open_brief') {
      setBriefState(
        openBriefSurface(briefState, {
          projection: path.projection,
          composerSnapshot: {
            userText: lensState.draft.userText,
            sources: [...lensState.draft.sources],
            lensId: lensState.lensId,
            draftRevisionId: path.projection.bindRevisions.draftRevisionId,
          },
        })
      );
      return;
    }

    // Safety net: video must never submit without Brief accept.
    if (videoConfirmRequired) {
      setShowRequiredHint(true);
      return;
    }

    runCreate(lensState.lensId);
  };

  useEffect(() => {
    const pendingIntent = destinationAutoSubmitIntentRef.current;
    const mapped =
      destinationPreflight?.result.status === 'mapped'
        ? destinationPreflight.result
        : null;
    if (
      !pendingIntent ||
      destinationPreflight?.intent !== pendingIntent ||
      userText.trim() !== pendingIntent ||
      !mapped ||
      lensState.draft.delivery.platform !== mapped.contentPackagePlatform ||
      lensState.draft.delivery.distributionTarget !==
        mapped.distributionTarget ||
      destinationMapPending ||
      !quoteQuery.data ||
      !currentQuoteView ||
      !submissionRecipe
    ) {
      return;
    }
    destinationAutoSubmitIntentRef.current = null;
    void attemptSubmit();
  }, [
    currentQuoteView,
    destinationMapPending,
    destinationPreflight,
    lensState.draft.delivery.distributionTarget,
    lensState.draft.delivery.platform,
    quoteQuery.data,
    submissionRecipe,
    userText,
  ]);

  /**
   * 「再生成一次」second half: once the thaw has landed *and* the run is
   * submittable again, the same path a merchant would drive by hand runs. The
   * readiness check is not optional — a reopened lens re-quotes, and firing
   * before the price is back would be blocked by the submit gate and look
   * exactly like a button that does nothing.
   *
   * `currentQuoteView`, like every other gate (#240 P1): the recovery mints a
   * new session and therefore a new quote identity, so the bound view is the
   * *failed* run's price until the re-quote lands. Firing against it would hit
   * the submit gate, clear the retry flag and leave the merchant with a button
   * that did nothing.
   */
  useEffect(() => {
    if (!retryAfterReport) return;
    if (lensState.phase !== 'selected') return;
    if (!quoteQuery.data || !currentQuoteView || !submissionRecipe) return;
    setRetryAfterReport(false);
    void attemptSubmit();
  }, [
    currentQuoteView,
    lensState,
    quoteQuery.data,
    retryAfterReport,
    submissionRecipe,
  ]);

  /**
   * The armed press, second half: the merchant pressed send while the quote was
   * still held, and this is where that press finally reaches Core — against the
   * price of the exact sentence they pressed on, never a later one.
   */
  useEffect(() => {
    const armed = armedQuoteIdRef.current;
    if (armed === null) return;
    if (quoteId !== armed) {
      // They kept writing after pressing. The sentence they sent is not the one
      // on screen any more, so the press expires with it rather than submitting
      // something they never asked for.
      if (quoteId !== null) armedQuoteIdRef.current = null;
      return;
    }
    if (quoteQuery.isError) {
      // The price never came back. The failure line owns the recovery from
      // here; a press held across it would submit long after they gave up.
      armedQuoteIdRef.current = null;
      return;
    }
    if (!quoteQuery.data || !currentQuoteView || !submissionRecipe) return;
    armedQuoteIdRef.current = null;
    void attemptSubmit();
  }, [
    currentQuoteView,
    quoteId,
    quoteQuery.data,
    quoteQuery.isError,
    submissionRecipe,
  ]);

  const handleBriefConfirm = async () => {
    if (lensState.phase !== 'selected' || !submissionRecipe) return;
    // The card is already un-confirmable when the identities diverge; this is
    // the same rule on the handler, so a stale confirm cannot arrive by any
    // other route (a queued click, a restored card). Narrowing here also
    // retires the non-null assertions this path used to carry: after an edit
    // the new query key has no data yet, and reading a field off it would
    // throw (#240 P1).
    const confirmedQuote = quoteQuery.data;
    if (!currentQuoteView || !confirmedQuote) {
      toast.error(BRIEF_STALE_QUOTE_NOTICE);
      return;
    }
    const result = confirmBriefSurface(briefState);
    if (!result.ok) {
      setBriefState(result.state);
      return;
    }
    const briefInput = briefInputRef.current;
    if (!briefInput?.briefContextId) {
      toast.error(workbench_operation_failed());
      return;
    }
    const refreshedContext = await syncComposerBriefContext({
      briefContextId: briefInput.briefContextId,
      draft: {
        delivery: submissionDelivery,
        imageOperation: explicitImageOperation ?? null,
        settings: submissionSettings,
        sources: briefSourcesFromDraft(lensState.draft.sources),
        userText: lensState.draft.userText,
      },
      expectedRevision: briefContextRevisionRef.current,
      lensId: lensState.lensId,
      quoteId: confirmedQuote.quoteId,
      recipeRevisionId: submissionRecipe.revisionId,
      sourceIds: sourceReferences.map((source) => source.id),
      surfaceRevisionId:
        surfaceQuery.data?.revisionId ?? initialSurfaceRevisionId ?? null,
    }).catch(() => null);
    if (!refreshedContext) {
      toast.error(workbench_operation_failed());
      return;
    }
    briefContextRevisionRef.current = refreshedContext.revision;
    if (
      !briefState.projection ||
      !sameBriefRevisions(
        briefState.projection.bindRevisions,
        refreshedContext.currentRevisions
      )
    ) {
      const refreshedInput = buildLiveBriefInput({
        briefContextId: briefInput.briefContextId,
        lensId: lensState.lensId,
        quote: confirmedQuote,
        currentRevisions: refreshedContext.currentRevisions,
        delivery: submissionDelivery,
        imageCount: lensState.lensId === 'image_text' ? submissionQuantity : 0,
        sources: briefSourcesFromDraft(lensState.draft.sources),
        highRiskFacts:
          /价格|价目|团购|优惠|\d+\s*元/u.test(lensState.draft.userText) &&
          !lensState.draft.sources.some(
            (source) =>
              source &&
              typeof source === 'object' &&
              !Array.isArray(source) &&
              (source as Record<string, unknown>).category === 'price_list'
          )
            ? [{ kind: 'price', status: 'missing' }]
            : [],
      });
      briefInputRef.current = refreshedInput;
      const refreshedProjection = await requestComposerBrief(refreshedInput);
      setBriefState(
        openBriefSurface(briefState, {
          projection: refreshedProjection,
          composerSnapshot: {
            userText: lensState.draft.userText,
            sources: [...lensState.draft.sources],
            lensId: lensState.lensId,
            draftRevisionId: refreshedProjection.bindRevisions.draftRevisionId,
          },
        })
      );
      return;
    }
    const confirmationId = `brief-confirm:${sessionIdRef.current}:${briefContextRevisionRef.current ?? 0}`;
    setBriefPending(true);
    try {
      await confirmComposerBrief({
        ...briefInput,
        confirmationId,
      });
      const current = await requestComposerBrief({
        ...briefInput,
        confirmationId,
      });
      if (current.requiresBrief || !current.confirmationValid) {
        throw new Error('Brief confirmation was invalidated before submit.');
      }
      setBriefState(result.state);
      runCreate(
        lensState.lensId,
        result.state.videoConfirmAccepted,
        confirmationId
      );
    } catch {
      toast.error(workbench_operation_failed());
    } finally {
      setBriefPending(false);
    }
  };

  const briefView =
    briefState.phase === 'open'
      ? projectBriefSurfaceView(briefState, {
          lensId,
          // Same judgement as the four Composer gates. Editing the intent while
          // the Brief is open used to leave it showing the old price with an
          // enabled confirm button — a second door onto a stale quote (#240 P1).
          quote: currentQuoteView,
          quoteStale: currentQuoteView == null,
        })
      : null;

  const missingStoreFacts =
    storeFacts.isSuccess &&
    hasMissingProgressiveStoreFacts(product.state?.store, storeFacts.data);
  const storeFactHeads = [
    ...(storeFacts.data ?? []),
    ...(serviceFactHistory.data ?? []),
    ...(priceFactHistory.data ?? []),
  ];
  const storeFactHeadRevisionKey = storeFactHeads
    .map((fact) => `${fact.factId}:${fact.revision}`)
    .sort()
    .join('|');
  const groundingRequested =
    submissionGroundingBlocked === 'store' ||
    missingGrounding.includes('confirmed_store') ||
    missingGrounding.includes('confirmed_project');
  const storeFactLedgerReady =
    storeFacts.isSuccess &&
    (!needsServiceHistory || serviceFactHistory.isSuccess) &&
    (!needsPriceHistory || priceFactHistory.isSuccess);
  const storeFactLedgerFailed =
    Boolean(product.state?.store) &&
    (storeFacts.isError ||
      (needsServiceHistory && serviceFactHistory.isError) ||
      (needsPriceHistory && priceFactHistory.isError));
  const showProgressiveFact = shouldShowProgressiveFactCard({
    groundingRequested,
    hasProductState: Boolean(product.state),
    hasStore: Boolean(product.state?.store),
    ledgerReady: storeFactLedgerReady,
    missingStoreFacts,
    productLoading: product.loading,
  });

  return (
    <div
      // `meiye-heroui-glass` is the shell class the DESIGN.md → HeroUI token
      // bridge keys on. The bridge's selector subject stays `html`, so portalled
      // overlays inherit the same tokens (C-02 regression guard).
      className="meiye-heroui-glass mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6"
      data-testid="composer-home"
      data-viewport={viewportKind}
    >
      <LandingHandoffRestore
        onConfirm={({ intent, lens }) => {
          // Restore into the same Composer draft — never auto-submit.
          if (lens) {
            setLensState((current) =>
              updateUserText(selectLens(current, lens), intent)
            );
          } else {
            setLensState((current) => updateUserText(current, intent));
          }
          focusComposerIntentInput();
        }}
      />

      {/* D-126 hot/cold home. Both CTAs prefill this same draft — never submit. */}
      <DashboardHomeSurface
        loading={product.loading}
        onPrefill={(intent) => {
          // Same idiom as the landing handoff restore above: pick the lens the
          // recommendation/sample is written for, then seed the draft. Leaving
          // the lens unselected would make the merchant re-pick it before the
          // draft can be submitted.
          setLensState((current) =>
            updateUserText(selectLens(current, 'copy'), intent)
          );
          // Not intentRef: PromptInput.TextArea spreads incoming props after
          // its own ref, so handing it one silently replaces the ref its
          // autosize depends on. Focus by testid instead.
          focusComposerIntentInput();
        }}
        onRefresh={product.refresh}
        onStart={() => focusComposerIntentInput()}
        state={product.state}
      />

      {storeFactLedgerFailed ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3"
          data-testid="progressive-fact-ledger-error"
          role="alert"
        >
          <p className="text-sm text-destructive">
            {workbench_operation_failed()}
          </p>
          <Button
            data-testid="progressive-fact-ledger-retry"
            onClick={() => {
              void storeFacts.refetch();
              if (needsServiceHistory) void serviceFactHistory.refetch();
              if (needsPriceHistory) void priceFactHistory.refetch();
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            {account_usage_retry()}
          </Button>
        </div>
      ) : null}

      {showProgressiveFact ? (
        <ProgressiveFactCard
          activeFacts={product.state?.store ? (storeFacts.data ?? []) : []}
          factHeads={product.state?.store ? storeFactHeads : []}
          key={`progressive-fact:${product.state?.workspaceId}:${product.state?.store?.revision ?? 0}:${storeFactHeadRevisionKey}`}
          onConfirm={async (request, idempotencyKey) => {
            await commandP1('asset-memory', request, idempotencyKey);
            setSubmissionGroundingBlocked(null);
            await Promise.all([product.refresh(), storeFacts.refetch()]);
          }}
          pending={product.pending}
          regulatedDefault={
            complianceDefaults.data?.['compliance.regulated_mode.default']
          }
          store={product.state?.store}
          workspaceId={product.state?.workspaceId ?? ''}
        />
      ) : null}

      {/* Layer ① — the conversation. Stage announcements, the 引导补问卡 and the
          streaming candidate all land here; nothing navigates away. */}
      <ComposerConversation
        identitySlot={
          <ComposerIdentityCard
            defaultPending={defaultIdentityDecision.isPending}
            onRemember={(identityId) =>
              defaultIdentityDecision.mutate(identityId)
            }
            onRetry={() => void identitiesQuery.refetch()}
            onSelect={(identityId) => {
              setSessionIdentityId(identityId);
              sessionIdentityDecision.mutate(identityId);
            }}
            selection={identitySelection}
          />
        }
        onOpenDelivery={openDelivery}
        onRecover={recoverFromReport}
        questionSlot={
          pendingQuestion ? (
            <ComposerQuestionCard
              disabled={createWork.isPending}
              // D-116 safety edge ②: quota or an external effect means D-112
              // wants an explicit confirmation, so the card stops releasing
              // itself. v1's composer only signs export / assisted_handoff, so
              // the external branch is not reachable from here yet.
              hold={composerQuestionHold({
                externalEffect: Boolean(
                  destination?.distributionTarget.startsWith('publish:')
                ),
                quotaBlocked,
              })}
              // Returned, not voided: the card awaits this and rolls its
              // settlement back if the post never reaches the ledger.
              onDecide={answerQuestion}
              pending={questionPending}
              question={pendingQuestion}
              resolutionSource={questionResolutionSource}
              timeoutSeconds={questionTimeoutSeconds}
            />
          ) : null
        }
        session={session}
        stream={tokenStream}
      />

      {preferencesQuery.isError ? (
        <div
          className="rounded-2xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm"
          data-testid="composer-model-preferences-error"
          role="alert"
        >
          <p>暂时没能读取你的模型偏好，当前不会提交创作任务。</p>
          <button
            className="mt-2 font-medium underline underline-offset-4"
            onClick={() => void preferencesQuery.refetch()}
            type="button"
          >
            重新读取
          </button>
        </div>
      ) : null}

      <ComposerPromptBar
        ariaLabel={creation_entry_intent_aria()}
        // DESIGN.md 白瓷 Composer 大卡 — pinned by the product shell contract.
        className="meiye-composer meiye-entry-card rounded-3xl p-4 sm:p-5"
        attachmentSlot={
          <div data-testid="composer-source-picker">
            {explicitImageOperation ? (
              <ComposerImageOperationPicker
                disabled={createWork.isPending || lensState.phase === 'frozen'}
                onChange={setImageOperation}
                value={explicitImageOperation}
              />
            ) : null}
            <ComposerImageInput
              focusRef={sourcePickerRef}
              onAssetAdded={addSource}
              onAssetRemoved={removeSource}
              onAuthorize={authorizeComposerImage}
              onQueueChange={(uploads) =>
                setUploadsReady(
                  uploads.every((upload) => upload.status === 'ready')
                )
              }
              onUpload={uploadComposerImage}
            >
              <p className="text-muted text-xs">
                {explicitImageOperation
                  ? imageOperationAttachmentHint(explicitImageOperation)
                  : '可选：上传门店图片、顾客案例或价目素材'}
              </p>
            </ComposerImageInput>
            {imageCardinality.message ? (
              <p
                className="mt-2 text-destructive text-xs"
                data-testid="composer-image-cardinality"
                role="alert"
              >
                {imageCardinality.message}
              </p>
            ) : null}
          </div>
        }
        creationMode={creationMode}
        destination={lensState.draft.delivery.platform ?? null}
        destinationCapability={
          destination
            ? composerDestinationCapability(destination.distributionTarget)
            : null
        }
        disabled={createWork.isPending || lensState.phase === 'frozen'}
        submitDisabled={
          createWork.isPending ||
          briefPending ||
          destinationMapPending ||
          !uploadsReady ||
          !imageCardinality.valid ||
          lensState.phase === 'frozen' ||
          quotaBlocked ||
          // Every state without a current price disables the button, except the
          // one that means 「we have not asked yet」: pressing send there ends
          // the settle window and asks now. Disabling it would make the click
          // that resolves the wait the one click the merchant cannot make.
          (lensId != null && !currentQuoteView && !quoteSettling)
        }
        lensSlot={
          <>
            <LensRadiogroup
              value={lensId}
              onChange={handleLensChange}
              showRequiredHint={showRequiredHint}
              disabled={createWork.isPending || lensState.phase === 'frozen'}
            />
            <LensSwitchPreviewPanel state={lensState} onChange={setLensState} />
          </>
        }
        onCreationModeChange={setCreationMode}
        onDestinationChange={(platform) => {
          const next = composerDestinationContract(platform);
          setDestinationPreflight(null);
          if (!next) return;
          setLensState((current) =>
            updateDeliverySuggestion(current, {
              distributionTarget: next.distributionTarget,
              platform: next.contentPackagePlatform,
            })
          );
        }}
        onReuseChip={(chip) => {
          const next = composerDestinationContract(chip.id);
          setDestinationPreflight(null);
          // 旧内容换平台 becomes one sentence in the merchant's own draft.
          setLensState((current) =>
            updateDeliverySuggestion(
              updateUserText(
                current,
                current.draft.userText.trim()
                  ? `${current.draft.userText.trim()}\n${chip.intent}`
                  : chip.intent
              ),
              {
                distributionTarget: next?.distributionTarget ?? null,
                platform: next?.contentPackagePlatform ?? chip.id,
              }
            )
          );
          focusComposerIntentInput();
        }}
        modelChannelReadiness={selectedModel?.channelReadiness ?? null}
        onSubmit={() => void attemptSubmit()}
        onValueChange={handleIntentChange}
        placeholder={creation_entry_intent_placeholder()}
        reuseChips={COMPOSER_REUSE_CHIPS}
        running={session.phase === 'running'}
        signedPreview={signedPreview}
        submitLabel={creation_entry_submit()}
        value={userText}
      />

      {destinationPreflight?.intent === userText.trim() &&
      destinationPreflight.result.status === 'needs_clarification' ? (
        <div
          className="rounded-2xl border border-default-200 bg-content1/80 p-3"
          data-testid="composer-destination-clarification"
          role="alert"
          tabIndex={-1}
        >
          <p className="text-sm">{destinationPreflight.result.question}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {destinationPreflight.result.options.map((option) => (
              <button
                className="rounded-full border border-default-300 px-3 py-1.5 text-sm"
                key={`${option.contentPackagePlatform}:${option.distributionTarget}`}
                onClick={() => {
                  setDestinationPreflight(null);
                  setLensState((current) =>
                    updateDeliverySuggestion(current, {
                      distributionTarget: option.distributionTarget,
                      platform: option.contentPackagePlatform,
                    })
                  );
                }}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {currentQuoteView ? (
        <p
          className="text-muted text-xs"
          data-quote-revision={quoteQuery.data?.revision}
          data-submission-contract-hash={
            quoteQuery.data?.submissionContractHash
          }
          data-testid="composer-quote-line"
        >
          {currentQuoteView.billingNote ??
            `预计消耗 ${currentQuoteView.amount}`}
        </p>
      ) : (
        <ComposerQuoteStatusLine
          onRetry={retryQuoteReadiness}
          readiness={quoteReadiness}
        />
      )}

      {submissionGroundingBlocked === 'store' ? (
        <p
          className="text-destructive text-sm"
          data-testid="composer-grounding-blocker"
          role="alert"
        >
          {workbench_grounding_store_required()}{' '}
          <Link
            className="font-medium underline underline-offset-4"
            to="/dashboard/store"
          >
            {workbench_grounding_go_to_store()}
          </Link>
        </p>
      ) : submissionGroundingBlocked === 'qualification' ? (
        <p
          className="text-destructive text-sm"
          data-testid="composer-grounding-blocker"
          role="alert"
        >
          {workbench_grounding_qualification_required()}{' '}
          <Link
            className="font-medium underline underline-offset-4"
            hash="store-qualification"
            to="/dashboard/store"
          >
            {workbench_grounding_qualification_action()}
          </Link>
        </p>
      ) : submissionGroundingBlocked === 'source' ? (
        <p
          className="text-destructive text-sm"
          data-testid="composer-grounding-blocker"
          role="alert"
        >
          {workbench_grounding_source_required()}
        </p>
      ) : createWork.isError ? (
        <p className="text-destructive text-sm" role="alert">
          {workbench_operation_failed()}
        </p>
      ) : null}

      {/* 额度：被动展示，不足才阻塞 (D-043 决定②). Always mounted — the passive
          line is not a card and gates nothing; only a shortfall raises the
          blocking card. */}
      <QuotaBlockingCard
        blocked={quotaBlocked}
        passive={quotaPassive}
        onRedeem={async ({ command, idempotencyKey }) => {
          try {
            await commandP1('redemptions', command, idempotencyKey);
            // Both entitlement reads on this page: the projection behind the
            // pre-check and the three-bucket balance card above it. Refreshing
            // one and not the other leaves 创作余额 quoting the old numbers
            // next to a card that just said it unlocked.
            await Promise.all([
              queryClient.invalidateQueries({
                queryKey: p1QueryKeys.request('entitlements', 'projection'),
              }),
              queryClient.invalidateQueries({
                queryKey: p1QueryKeys.request('entitlements', 'balance'),
              }),
            ]);
            return { ok: true };
          } catch (error) {
            return {
              ok: false,
              message:
                error instanceof Error ? error.message : '兑换失败，请重试',
            };
          }
        }}
        onUnlocked={() => setSubmissionQuotaBlocked(false)}
      />

      {surfaceQuery.data ? (
        <RecipeCardsPanel
          lensId={lensId}
          lensState={lensState}
          onLensStateChange={setLensState}
          surface={surfaceQuery.data}
          requestServerPreview={({ lensState: state, recipe }) =>
            requestRecipePatchPreview({
              recipeRevisionId: recipe.revisionId,
              currentLens: state.lensId,
              surfaceRevisionId: surfaceQuery.data.revisionId,
              draft: composerDraftToRecipeFields(state),
            })
          }
          onReuseRequested={() => {
            // 旧内容换平台 is answered in the conversation, not in a panel.
            setLensState((current) =>
              updateUserText(
                current,
                current.draft.userText.trim() || COMPOSER_REUSE_CHIPS[0]!.intent
              )
            );
            focusComposerIntentInput();
          }}
          singleColumn={singleColumn}
          useBottomSheet={viewportKind === 'mobile'}
        />
      ) : (
        <output
          className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground"
          data-testid="composer-surface-status"
        >
          {surfaceQuery.isError
            ? '创作模板暂时不可用，请稍后重试'
            : '正在读取创作模板…'}
        </output>
      )}

      <ComposerToolsStrip
        viewport={viewportKind}
        proStudioStatus={proStudioEntitlement.projection.state}
        {...(proStudioEntitlement.reason
          ? { proStudioLockReason: proStudioEntitlement.reason }
          : {})}
        surfaceRevisionId={surfaceQuery.data?.revisionId}
        onOpenTool={(href) => {
          if (typeof window !== 'undefined') {
            window.location.assign(href);
          }
        }}
        onViewAll={(href) => {
          void navigate({ to: href as '/dashboard/catalog' });
        }}
      />

      {briefView ? (
        <BriefSurface
          view={briefView}
          onConfirm={handleBriefConfirm}
          onCancel={() => {
            setBriefState(cancelBriefSurface(briefState).state);
            // Cancelling abandons this attempt, so the transcript goes back to
            // empty rather than keeping a turn that never ran.
            setSession(createComposerSession(sessionIdRef.current));
          }}
          disabled={createWork.isPending}
        />
      ) : null}
    </div>
  );
}
