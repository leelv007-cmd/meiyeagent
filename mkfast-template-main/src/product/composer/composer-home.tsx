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
import {
  commandP1,
  operationsQuery,
  P1RequestError,
  p1ErrorCode,
  queryP1,
} from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import {
  normalizeCatalog,
  normalizePreferences,
} from '@/p1/settings-view-model';
import { resolveCreationModelSelection } from '@/p1/model-current-selection';
import { useComplianceDefaults } from '@/p1/use-compliance-defaults';
import type {
  AskMerchantAnswer,
  BriefBoundRevisions,
  BriefSourceSignal,
  BriefTriggerInput,
  BriefTriggerProjection,
  BrowserRecipeProjection,
  CreationLensId,
  ExecutionConfirmationAnswer,
  HarnessInteractionRequest,
  MarketingIdentityAsset,
  MemoryEntriesPage,
  ProductQuoteSnapshot,
  QuestionCard,
  ResultPanel,
  StoreFact,
} from '@meiye/contracts';
import {
  composerSubmissionSignedFieldsSchema,
  memoryTaskSourceConversationId,
} from '@meiye/contracts';
import type { AccountUsageProjection } from '@/product/account-usage';
import { uploadProductAsset } from '@/api/product-assets';
import { assetAuthorizationIdempotencyKey } from '@/product/asset-authorization-model';
import {
  ComposerImageInput,
  type ComposerImageIdentity,
} from '@/product/composer-image-input';
import { executeProductCommand, useProductState } from '@/product/client';
import { DashboardContinueSection } from '@/product/dashboard-continue-section';
import {
  createExecutionConfirmState,
  confirmExecution,
  openExecutionConfirm,
  projectExecutionConfirmCard,
  projectExecutionCost,
  projectExecutionParams,
  rejectExecution,
  shouldOpenExecutionConfirm,
} from './execution-confirm-card';
import { ExecutionConfirmCard } from './execution-confirm-card-panel';
import {
  projectExecutionCostFeedback,
  type ExecutionCostFeedback,
} from './execution-cost-feedback';
import { ExecutionCostFeedbackLine } from './execution-cost-feedback-line';
import type { ComposerQuotaResource } from './quota-blocking';
import { appendObservabilityEvent } from '@/p1/observability-event-client';
import {
  DashboardHomeGreeting,
  DashboardHomeSurface,
} from '@/product/dashboard-home-surface';
import { applyRecommendationHandoffWithRecipe } from '@/product/recommendation-handoff';
import type { RecommendationHandoff } from '@/product/recommendation-handoff';
import type { ConfirmedAssetFacts } from '@/product/creation-entry-model';
import { ViralAdaptPanel } from '@/product/viral-adapt/viral-adapt-panel';
import {
  advanceViralSourcingToConfirm,
  beginViralOpenCliRead,
  cancelViralAdaptJourney,
  completeViralOpenCliRead,
  confirmViralAdaptJourney,
  createViralAdaptJourneyState,
  failViralOpenCliRead,
  selectViralAdaptSourceTrack,
  setViralOpenCliBridgeReady,
  startViralAdaptJourney,
  updateViralOpenCliLink,
  updateViralPasteDraft,
  type ViralAdaptJourneyState,
} from '@/product/viral-adapt/viral-adapt-journey';
import {
  bindViralAdaptSource,
  viralAdaptSourceForSession,
  type ViralAdaptRunBinding,
} from '@/product/composer/viral-adapt-binding';
import {
  LatestViralOpenCliReadCoordinator,
  VIRAL_OPENCLI_LIVE_GATE_EVIDENCE,
  ViralOpenCliBridgeError,
  injectedViralOpenCliBridge,
  mergeViralOpenCliAuthorizedSources,
  readViralOpenCliSource,
  type ViralOpenCliBridge,
} from '@/product/viral-adapt/viral-adapt-opencli-bridge';
import {
  missingCreativeGrounding,
  type CreativeGroundingRequirement,
} from '@/product/creative-brief-editor';
import {
  acknowledgeHarnessInteractionRenderer,
  readActiveHarnessTasks,
  readPendingHarnessInteraction,
  readPendingHarnessInteractionMessage,
  readPendingHarnessDecision,
  setHarnessInteractionEditing,
  submitHarnessInteraction,
  submitHarnessInteractionMerchantMessage,
  submitHarnessDecision,
} from '@/product/harness-client';
import { AskMerchantInteractionSlot } from '@/product/composer/ask-merchant-interaction-slot';
import { ExecutionConfirmationInteractionCard } from '@/product/composer/execution-confirmation-interaction-card';
import { ExecutionConfirmationWaitingMessageCard } from '@/product/composer/execution-confirmation-waiting-message-card';
import { navigateAfterSubmitSuccess } from '@/product/results/result-center-navigation';
import { projectResultTokenStream } from '@/product/results/result-token-stream';
import { useWorkflowEventStream } from '@/product/use-workflow-event-stream';
import {
  invalidateMarketingIdentity,
  marketingIdentityProjectionQuery,
} from '@/product/marketing-identity-queries';

import { BriefSurface } from './brief-surface-panel';
import {
  canActOnExperienceSediment,
  projectExperienceBasis,
  projectExperienceCorrection,
  projectExperienceSediment,
} from './task-experience';
import { applyCatalogRecipeSelection } from './catalog-selection';
import {
  buildAiCoverActionSeed,
  resolveSignedAiCover,
  shouldShowAiCoverSignatureMismatchNotice,
  type AiCoverActionSeed,
  type AiCoverAspectRatio,
  type AiCoverBeautyPreset,
} from './ai-cover-action';
import { ComposerAiCoverMismatchNotice } from './composer-ai-cover-mismatch-notice';
import {
  buildStyleAnalysisStageFromAssets,
  ComposerStyleAnalysisStageNotice,
  ComposerStyleReferenceControl,
} from './composer-style-reference-control';
import {
  submissionRoleForStyleReference,
  toggleStyleReferenceAsset,
} from './style-analysis-entry';
import { ProgressiveFactCard } from './progressive-fact-card';
import {
  hasMissingProgressiveStoreFacts,
  shouldShowProgressiveFactCard,
} from './progressive-fact';
import {
  briefStaleQuoteNotice,
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
import { isWorkbenchShelfCollapsed } from './workbench-mode';
import {
  isWorkbenchComposerSticky,
  isWorkbenchDualColumnEligible,
  resolveWorkbenchWidthMode,
} from './workbench-shell';
import {
  WorkbenchCreateLayout,
  WorkbenchInspectorPanel,
  WorkbenchInspectorSheet,
  WorkbenchShellRoot,
  WorkbenchStickyComposerClearance,
  WorkbenchStickyComposerHost,
} from './workbench-shell-layout';
import { useWorkbenchViewportWidth } from './use-workbench-viewport-width';
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
import { ComposerCreditRecoveryHost } from './quota-blocking-card';
import {
  type ComposerCreditRedemptionReceipt,
  composerQuotaAvailability,
  composerQuotaRequirements,
  projectQuotaPassiveView,
} from './quota-blocking';
import {
  buildLiveBriefInput,
  buildLiveQuoteInput,
  COMPOSER_OPERATION_BY_LENS,
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
  COMPOSER_DESTINATION_OPTIONS,
  ComposerConversation,
  ComposerCreationModeSegment,
  ComposerPromptBar,
  focusComposerIntentInput,
  type ComposerCreationMode,
  type ComposerReuseChip,
} from './composer-conversation';
import { COMPOSER_LENS_LABELS } from './lens-labels';
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
  imageOperationSourceCount,
  type ComposerImageOperation,
} from './image-operation-picker';
import {
  buildSubmissionGenerationParams,
  initialGenerationParamsState,
  isComposerGenerationParamsSupported,
  type ComposerGenerationParamsState,
} from './composer-generation-params';
import { ComposerGenerationParamsPanel } from './composer-generation-params-panel';
import {
  applyComposerNotePlan,
  applyComposerPendingInterrupts,
  applyComposerProgress,
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
  updateComposerNotePlan,
  type ComposerSession,
} from './composer-session';
import type { ComposerRecoveryInput } from './composer-report-card';
import {
  confirmComposerNotePlanPageRegeneration,
  prepareComposerNotePlanPageRegeneration,
  saveComposerNotePlanOutline,
  type PendingComposerNotePlanPageRegeneration,
} from './composer-note-plan-live';
import {
  editNotePlanPageOutline,
  prepareNotePlanPageRegenerate,
  preserveUnsavedNotePlanOutlines,
  projectNotePlanTimelineFromVersion,
  requestNotePlanPageRegenerate,
  resetNotePlanPageRegenerate,
  type NotePlanTimeline,
} from './note-plan-timeline';
import type {
  CreativeWorkbenchProjection,
  ImageTextNoteVersion,
  PublicContentPackage,
} from '@meiye/contracts';

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

/**
 * What a blocked send press says, when the gate it hit has nothing of its own.
 *
 * Both name the problem *and* the way out; 「操作未完成，请检查当前状态后重试」
 * is what this replaces.
 */
const COMPOSER_LENS_REQUIRED_MESSAGE =
  '还没定下要做哪种内容。先在上面选文案、图文或视频，再点发送。';
const COMPOSER_QUOTE_PENDING_MESSAGE =
  '这次的用量还没算好，所以没能开始。稍等一下，等发送键下方出现用量说明再点；一直没出来的话，改一句描述会重新算。';

/**
 * What the send button will actually do on the next press.
 *
 * The control carries two meanings — 「开始创作」 and 「先把还缺的信息补上」 —
 * and it used to look identical in both, so a merchant pressed what they read
 * as 开始创作 and got a question instead. This says which one is armed before
 * the press, and the same sentence becomes the button's accessible name.
 */
function composerSubmitIntent(input: {
  groundingBlocker: ComposerGroundingBlocker | null;
  storeFactsPending: boolean;
}): { label: string; hint: string | null } {
  if (input.groundingBlocker === 'source') {
    return {
      label: '先确认素材来源',
      hint: '这次用到的素材还没确认来源和授权，点发送会先带你确认，不会开始生成。',
    };
  }
  if (input.groundingBlocker === 'qualification') {
    return {
      label: '先补资质信息',
      hint: '这家门店标记了受监管经营，点发送会先带你补资质，不会开始生成。',
    };
  }
  if (input.storeFactsPending) {
    return {
      label: '先补门店信息',
      hint: '门店信息还没补齐，点发送会先问你几个问题，补完才开始生成。',
    };
  }
  return { label: creation_entry_submit(), hint: null };
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
  /** Result/workspace AI-cover handoff; current surface supplies the recipe. */
  initialAiCover?: {
    aspectRatio: AiCoverAspectRatio;
    style: AiCoverBeautyPreset;
    topicHint?: string;
  };
  /** Injectable for tests; browser sessionStorage is used by default. */
  sessionStore?: Storage;
  /** Host-owned local bridge; undefined discovers the injected browser seam. */
  viralOpenCliBridge?: ViralOpenCliBridge | null;
};

export function ComposerHome({
  viewportWidth,
  fixtureSubmit = false,
  initialRecipeRevisionId,
  initialAiCover,
  initialSessionIdentityId,
  initialSurfaceRevisionId,
  initialTaskId,
  sessionStore,
  viralOpenCliBridge,
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
  const initialAiCoverAppliedRef = useRef(false);
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
  /** #324/#328 爆款复刻 dual-track journey. */
  const viralOpenCliBridgeRef = useRef<ViralOpenCliBridge | null>(null);
  const viralOpenCliReadCoordinatorRef =
    useRef<LatestViralOpenCliReadCoordinator | null>(null);
  if (!viralOpenCliReadCoordinatorRef.current) {
    viralOpenCliReadCoordinatorRef.current =
      new LatestViralOpenCliReadCoordinator();
  }
  const [viralAdaptJourney, setViralAdaptJourney] =
    useState<ViralAdaptJourneyState>(() =>
      createViralAdaptJourneyState({
        evidencePresent: VIRAL_OPENCLI_LIVE_GATE_EVIDENCE.verified,
      })
    );
  const lensStateRef = useRef(lensState);
  lensStateRef.current = lensState;
  const viralAdaptJourneyRef = useRef(viralAdaptJourney);
  viralAdaptJourneyRef.current = viralAdaptJourney;
  const cancelViralOpenCliRead = useCallback(() => {
    viralOpenCliReadCoordinatorRef.current?.cancel();
  }, []);
  const [viralAdaptBinding, setViralAdaptBinding] =
    useState<ViralAdaptRunBinding | null>(null);
  const [showRequiredHint, setShowRequiredHint] = useState(false);
  /**
   * Why the last send press did not start a run (WCAG 3.3.1).
   *
   * A blocked press used to paint a red edge and say nothing: `aria-invalid`
   * and `aria-describedby` were absent on the intent box and every `role=alert`
   * region on the page was empty, so a screen-reader user got no signal at all
   * and a sighted merchant got a red box with no reason. This string is the
   * reason, and it is wired to the textarea rather than floating next to it.
   */
  const [submitBlockedMessage, setSubmitBlockedMessage] = useState<
    string | null
  >(null);
  const [briefState, setBriefState] = useState<BriefSurfaceState>(() =>
    createBriefSurfaceState()
  );
  const [briefPending, setBriefPending] = useState(false);
  // D-164③: the confirm card stands between Brief accept and the run. Its
  // state is its own — sharing BriefSurfacePhase would be changing one of the
  // seven HITL classes D-164③ leaves untouched.
  const [executionConfirm, setExecutionConfirm] = useState(
    createExecutionConfirmState
  );
  const pendingRunRef = useRef<{
    lensId: CreationLensId;
    videoConfirmAccepted?: boolean;
    briefConfirmationId?: string;
  } | null>(null);
  // Deliberately outside `session`: declining clears the transcript, and a
  // feedback line that lived there would be wiped by the very action it
  // reports on (D-164⑥ 决定 B).
  const [costFeedback, setCostFeedback] =
    useState<ExecutionCostFeedback | null>(null);
  const [submissionQuotaBlocked, setSubmissionQuotaBlocked] = useState(false);
  const [submissionGroundingBlocked, setSubmissionGroundingBlocked] =
    useState<ComposerGroundingBlocker | null>(null);
  const [uploadsReady, setUploadsReady] = useState(true);
  // D-111 双入口: the entry declares itself, the server decides the route.
  const [creationMode, setCreationMode] =
    useState<ComposerCreationMode>('customized');
  const [imageOperation, setImageOperation] =
    useState<ComposerImageOperation>('image.generate');
  /** P2-09: free-mode beauty voice + thinking level; customized injects defaults. */
  const [generationParams, setGenerationParams] =
    useState<ComposerGenerationParamsState>(initialGenerationParamsState);
  const [activeAiCover, setActiveAiCover] = useState<AiCoverActionSeed | null>(
    null
  );
  const [styleReferenceAssetIds, setStyleReferenceAssetIds] = useState<
    string[]
  >([]);
  const [session, setSession] = useState<ComposerSession>(() =>
    createComposerSession(sessionIdRef.current)
  );
  const notePlanCanonicalPackageRef = useRef<PublicContentPackage | null>(null);
  const notePlanHydratedPackageRef = useRef<string | null>(null);
  const notePlanOutlineIntentKeysRef = useRef(new Map<string, string>());
  const [
    notePlanOutlineSavePendingPageId,
    setNotePlanOutlineSavePendingPageId,
  ] = useState<string | null>(null);
  const [notePlanOutlineSaveError, setNotePlanOutlineSaveError] = useState<{
    message: string;
    pageId: string;
  } | null>(null);
  const [notePlanRegenerationBusy, setNotePlanRegenerationBusy] =
    useState(false);
  const [notePlanRegenerationError, setNotePlanRegenerationError] = useState<{
    message: string;
    pageId: string;
  } | null>(null);
  const [pendingNotePlanRegeneration, setPendingNotePlanRegeneration] =
    useState<PendingComposerNotePlanPageRegeneration | null>(null);
  const [questionPending, setQuestionPending] = useState(false);
  const [destinationMapPending, setDestinationMapPending] = useState(false);
  const destinationMapPendingRef = useRef(false);
  const destinationAutoSubmitIntentRef = useRef<string | null>(null);
  // A controlled input can emit more than one change before React commits the
  // completed-attempt handoff. Guard that burst so it still mints exactly one
  // session identity.
  const reopeningCompletedAttemptRef = useRef(false);
  const focusIntentAfterPrefillRef = useRef(false);
  // 「再生成一次」thaws the lens first, so the actual submit has to wait for the
  // reopened state to land (attemptSubmit reads lensState from the closure).
  const [retryAfterReport, setRetryAfterReport] = useState(false);
  const [destinationPreflight, setDestinationPreflight] =
    useState<ComposerDestinationPreflightState | null>(null);
  const [sessionIdentityId, setSessionIdentityId] = useState<
    string | null | undefined
  >(undefined);
  const [
    sessionIdentityDecisionReference,
    setSessionIdentityDecisionReference,
  ] = useState<{ id: string; revision: number } | null>(null);
  /** Mobile Result Inspector sheet (dual-column right rail equivalent). */
  const [inspectorSheetOpen, setInspectorSheetOpen] = useState(false);

  // P1-1: live resize/matchMedia so dual column flips when crossing 1240 without
  // waiting for an unrelated re-render. `viewportWidth` remains the test override.
  const width = useWorkbenchViewportWidth(viewportWidth);
  const singleColumn = !isTwoColumnMobileViewport({ width });
  const viewportKind = isMobile || singleColumn ? 'mobile' : 'desktop';

  const lensId = lensState.phase === 'unselected' ? null : lensState.lensId;
  const userText = lensState.draft.userText;
  const quoteView = lensState.draft.quoteView;
  const sourceReferences = useMemo(
    () => sourceReferencesFromDraft(lensState.draft.sources),
    [lensState.draft.sources]
  );
  useEffect(() => {
    const refreshBridge = () => {
      const bridge =
        viralOpenCliBridge === undefined
          ? injectedViralOpenCliBridge()
          : viralOpenCliBridge;
      viralOpenCliBridgeRef.current = bridge;
      if (bridge?.ready !== true) {
        cancelViralOpenCliRead();
      }
      setViralAdaptJourney((current) =>
        setViralOpenCliBridgeReady(current, bridge?.ready === true)
      );
    };
    refreshBridge();
    window.addEventListener('meiye:opencli-bridge-ready', refreshBridge);
    return () => {
      window.removeEventListener('meiye:opencli-bridge-ready', refreshBridge);
      cancelViralOpenCliRead();
      viralOpenCliBridgeRef.current = null;
    };
  }, [cancelViralOpenCliRead, viralOpenCliBridge]);
  const readViralOpenCliNote = useCallback(async () => {
    const reading = beginViralOpenCliRead(viralAdaptJourney);
    if ('error' in reading) return;
    const noteUrl = reading.opencli.noteUrl;
    const coordinator = viralOpenCliReadCoordinatorRef.current;
    if (!coordinator) return;
    viralAdaptJourneyRef.current = reading;
    setViralAdaptJourney(reading);
    await coordinator.run({
      read: (signal) =>
        readViralOpenCliSource(viralOpenCliBridgeRef.current, noteUrl, signal),
      refresh: product.refresh,
      commit: (result) => {
        const currentJourney = viralAdaptJourneyRef.current;
        if (
          currentJourney.phase !== 'sourcing' ||
          currentJourney.sourceTrack !== 'opencli_link' ||
          currentJourney.opencli.status !== 'reading' ||
          currentJourney.opencli.noteUrl !== noteUrl
        ) {
          return;
        }
        const completed = completeViralOpenCliRead(currentJourney, result);
        if ('error' in completed) {
          throw new ViralOpenCliBridgeError('invalid_result');
        }
        const currentLens = lensStateRef.current;
        const mergedSources = mergeViralOpenCliAuthorizedSources(
          currentLens.draft.sources,
          result.authorizedAssets
        );
        if ('error' in mergedSources) {
          throw new ViralOpenCliBridgeError('invalid_result');
        }
        const nextLens = updateSources(currentLens, mergedSources.sources);
        lensStateRef.current = nextLens;
        viralAdaptJourneyRef.current = completed;
        setLensState(nextLens);
        setViralAdaptJourney(completed);
      },
      fail: (error) => {
        const current = viralAdaptJourneyRef.current;
        if (
          current.phase !== 'sourcing' ||
          current.sourceTrack !== 'opencli_link' ||
          current.opencli.status !== 'reading' ||
          current.opencli.noteUrl !== noteUrl
        ) {
          return;
        }
        const bridgeAbsent =
          error instanceof ViralOpenCliBridgeError &&
          error.code === 'bridge_absent';
        const invalidResult =
          error instanceof ViralOpenCliBridgeError &&
          error.code === 'invalid_result';
        const failed = failViralOpenCliRead(
          current,
          bridgeAbsent
            ? 'bridge_absent'
            : invalidResult
              ? 'invalid_result'
              : 'read_failed'
        );
        viralAdaptJourneyRef.current = failed;
        setViralAdaptJourney(failed);
      },
    });
  }, [product, viralAdaptJourney]);
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
  useEffect(() => {
    if (viralAdaptJourney.phase !== 'sourcing') return;
    const attachedAssetIds = sourceReferences
      .map(({ id }) => id)
      .filter((assetId) => sourceFactsRef.current.has(assetId));
    setViralAdaptJourney((current) => {
      if (
        current.phase !== 'sourcing' ||
        (current.draft.imageAssetIds.length === attachedAssetIds.length &&
          current.draft.imageAssetIds.every(
            (assetId, index) => assetId === attachedAssetIds[index]
          ))
      ) {
        return current;
      }
      return updateViralPasteDraft(current, {
        imageAssetIds: attachedAssetIds,
      });
    });
  }, [sourceReferences, viralAdaptJourney.phase]);
  useEffect(() => {
    if (
      !surfaceQuery.data ||
      viralAdaptJourney.phase !== 'ready' ||
      !viralAdaptJourney.merchantIntent ||
      userText !== viralAdaptJourney.merchantIntent ||
      surfaceQuery.data.recipeRefs.some(
        (reference) =>
          reference.visible &&
          reference.recipeRevisionId === lensState.draft.recipeRevisionId &&
          surfaceQuery.data?.recipes.some(
            (recipe) =>
              recipe.recipeId === 'recipe.viral_adapt' &&
              recipe.status === 'published' &&
              recipe.revisionId === reference.recipeRevisionId
          )
      )
    ) {
      return;
    }
    setLensState(
      (current) =>
        applyRecommendationHandoffWithRecipe({
          state: current,
          handoff: {
            intent: current.draft.userText,
            outputHint: 'image_text',
            recipeChipId: 'viral_adapt',
          },
          surface: surfaceQuery.data,
        }).state
    );
  }, [
    lensState.draft.recipeRevisionId,
    surfaceQuery.data,
    userText,
    viralAdaptJourney.merchantIntent,
    viralAdaptJourney.phase,
  ]);
  const identitiesQuery = useQuery(marketingIdentityProjectionQuery);
  /** P2-13: shared experience producer for task-in basis / sediment surfaces. */
  const experienceEntriesQueryKey = useMemo(
    () =>
      p1QueryKeys.request('memory', 'entries_page', {
        limit: 20,
        surface: 'composer-task-experience',
      }),
    []
  );
  const experienceEntriesQuery = useQuery({
    queryKey: experienceEntriesQueryKey,
    queryFn: ({ signal }) =>
      queryP1<MemoryEntriesPage>(
        'memory',
        {
          action: 'entries_page',
          payload: { limit: 20 },
        },
        signal
      ),
  });
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
  const experienceTaskSourceConversationId = session.task
    ? memoryTaskSourceConversationId(session.task.workId, session.task.taskId)
    : null;
  const experienceSediment = useMemo(
    () =>
      projectExperienceSediment({
        querySettled:
          experienceEntriesQuery.isSuccess || experienceEntriesQuery.isError,
        taskSourceConversationId: experienceTaskSourceConversationId,
        pendingEntries: (experienceEntriesQuery.data?.items ?? [])
          .filter((entry) => entry.status === 'pending')
          .map((entry) => ({
            entryId: entry.entryId,
            sourceConversationId: entry.source?.conversationId ?? null,
            value: entry.value,
          })),
      }),
    [
      experienceEntriesQuery.data?.items,
      experienceEntriesQuery.isError,
      experienceEntriesQuery.isSuccess,
      experienceTaskSourceConversationId,
    ]
  );
  // Correction classifier producer is not ready in production — honest empty.
  const experienceCorrection = useMemo(
    () =>
      projectExperienceCorrection({
        producerReady: false,
        classification: null,
      }),
    []
  );
  const sessionIdentityDecision = useMutation({
    mutationFn: (identityId: string | null) => {
      const identity = identitySelection.identities.find(
        (candidate) => candidate.id === identityId
      );
      return commandP1<{
        decisionId: string;
        decisionRevision: number;
      }>(
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
    onSuccess: async (decision, identityId) => {
      setSessionIdentityId(identityId);
      setSessionIdentityDecisionReference({
        id: decision.decisionId,
        revision: decision.decisionRevision,
      });
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
  const viralSubmissionRecipeReady =
    submissionRecipe?.recipeId === 'recipe.viral_adapt' &&
    surfaceQuery.data?.recipeRefs.some(
      (reference) =>
        reference.visible &&
        reference.recipeRevisionId === submissionRecipe.revisionId
    ) === true;
  const boundViralAdaptSource = viralAdaptSourceForSession(
    viralAdaptBinding,
    sessionIdRef.current
  );
  const activeViralAdaptSource =
    boundViralAdaptSource &&
    viralAdaptJourney.phase === 'ready' &&
    viralAdaptJourney.merchantIntent === userText &&
    viralAdaptJourney.sourcePayload === boundViralAdaptSource &&
    bindViralAdaptSource({
      sessionId: sessionIdRef.current,
      payload: boundViralAdaptSource,
      sources: lensState.draft.sources,
    }).ok
      ? boundViralAdaptSource
      : undefined;
  /**
   * Which model runs, and *why* that one (#240①).
   *
   * The platform default arrives with the preferences — the browser keeps no
   * table of its own, so a model the platform never configured can never be
   * substituted here. The resolution also answers where the choice came from,
   * and that answer is kept rather than dropped: falling all the way through to
   * `platform_default` means nobody in this shop ever picked this model, and a
   * run that reuses the platform fallback has to be readable as such afterwards
   * instead of looking like the merchant's own selection.
   */
  const modelSelection = useMemo(() => {
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
      platformDefault: preferences.platformDefault,
      userDefault: preferences.userDefault,
      workspaceDefault: preferences.workspaceDefault,
    });
  }, [
    catalog,
    lensId,
    lensState.draft.fieldMeta.catalogModelId?.dirty,
    lensState.draft.settings.catalogModelId,
    preferencesQuery.data,
    preferencesQuery.isSuccess,
    submissionRecipe?.modelPolicy,
  ]);
  const selectedModel = modelSelection?.model;
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
  const generationParamsEnabled = isComposerGenerationParamsSupported({
    deliverableKind: submissionDelivery.deliverableKind,
    lensId,
    platform: submissionDelivery.platform,
  });
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
  const signedAiCover = resolveSignedAiCover({
    activeAiCover,
    creationMode,
    imageOperation: explicitImageOperation,
    recipeId: submissionRecipe?.recipeId,
    deliverableKind: submissionDelivery.deliverableKind,
    platform: submissionDelivery.platform,
    aspectRatio: submissionAspectRatio,
  });
  const showAiCoverSignatureMismatch = shouldShowAiCoverSignatureMismatchNotice(
    {
      activeAiCover,
      signedAiCover,
    }
  );
  useEffect(() => {
    if (viralAdaptJourney.phase !== 'ready') return;
    const bindingStillCurrent =
      viralAdaptJourney.merchantIntent === userText &&
      lensId === 'image_text' &&
      (submissionRecipe === undefined ||
        submissionRecipe.recipeId === 'recipe.viral_adapt');
    if (bindingStillCurrent) return;
    cancelViralOpenCliRead();
    setViralAdaptBinding(null);
    setViralAdaptJourney((current) => cancelViralAdaptJourney(current));
  }, [
    lensId,
    submissionRecipe,
    userText,
    viralAdaptJourney.merchantIntent,
    viralAdaptJourney.phase,
    cancelViralOpenCliRead,
  ]);
  const imageCardinality = explicitImageOperation
    ? imageOperationCardinality(
        explicitImageOperation,
        imageOperationSourceCount({
          sourceAssetIds: sourceReferences.map(({ id }) => id),
          styleReferenceAssetIds,
        })
      )
    : { message: null, valid: true };
  const signedGeneration = generationParamsEnabled
    ? buildSubmissionGenerationParams({
        creationMode,
        state: generationParams,
      })
    : undefined;
  const signedSubmissionParse =
    selectedModel && submissionRecipe && destination
      ? composerSubmissionSignedFieldsSchema.safeParse({
          creationMode,
          intent: userText,
          ...(explicitImageOperation
            ? { imageOperation: explicitImageOperation }
            : {}),
          ...(signedAiCover ? { aiCover: signedAiCover } : {}),
          ...(viralSubmissionRecipeReady && activeViralAdaptSource
            ? { viralAdaptSource: activeViralAdaptSource }
            : {}),
          ...(signedGeneration?.beautyVoiceRole
            ? { beautyVoiceRole: signedGeneration.beautyVoiceRole }
            : {}),
          ...(signedGeneration
            ? { thinkingLevel: signedGeneration.thinkingLevel }
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
        ? projectComposerSignedPreview({ signed: signedSubmission })
        : null,
    [signedSubmission]
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
        available: composerQuotaAvailability(usageQuery.data),
      }),
    [quotaRequirements, usageQuery.data]
  );
  const quotaBlocked = quotaPassive.short || submissionQuotaBlocked;

  /**
   * D-164③ / D-164⑥: what this run will do and what it will cost, at the
   * moment of committing to it. Every value is already on screen somewhere —
   * the card's job is to put them in one place at the one moment they matter,
   * and it reads the same quota sentence the passive row uses so one run is
   * never described two ways.
   */
  const openExecutionConfirmFor = (run: {
    lensId: CreationLensId;
    existingGateSatisfied?: boolean;
    videoConfirmAccepted?: boolean;
    briefConfirmationId?: string;
  }) => {
    // Single decision point (D2). Call sites must not write their own `if`,
    // so switching the trigger 口径 stays one edit.
    if (
      !shouldOpenExecutionConfirm({
        existingGate: true,
        existingGateSatisfied: run.existingGateSatisfied,
        generative: true,
      })
    ) {
      runCreate(run.lensId, run.videoConfirmAccepted, run.briefConfirmationId);
      return;
    }
    const rowValue = (key: 'destination' | 'deliverable') =>
      signedPreview?.rows.find((row) => row.key === key)?.value ?? null;
    pendingRunRef.current = run;
    setCostFeedback(null);
    setExecutionConfirm((current) =>
      openExecutionConfirm(current, {
        composerSnapshot: {
          draftRevisionId:
            briefState.projection?.bindRevisions.draftRevisionId ?? '',
          lensId: lensState.lensId,
          sources: [...lensState.draft.sources],
          userText: lensState.draft.userText,
        },
        cost: projectExecutionCost({
          available: {
            ...composerQuotaAvailability(usageQuery.data),
          },
          billingNote: currentQuoteView?.billingNote ?? null,
          requirements: quotaRequirements,
        }),
        params: projectExecutionParams({
          aspectRatio: submissionAspectRatio,
          deliverable: rowValue('deliverable'),
          destination: rowValue('destination'),
          durationSeconds: submissionDurationSeconds,
          lensId: run.lensId,
          modelName: selectedModel?.displayName ?? null,
          // Server-owned label bound to the output count — it is the
          // authority on what this run produces, so it wins over local wording.
          outputLabel: quoteQuery.data?.outputLabel ?? null,
          quantity: submissionQuantity,
        }),
      })
    );
  };

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
    if (!modelSelection || lensState.phase === 'frozen') return;
    const { model } = modelSelection;
    if (
      lensState.draft.settings.catalogModelId === model.id &&
      lensState.draft.settings.catalogModelRevision === catalogRevision
    ) {
      return;
    }
    setLensState((current) =>
      updateSettings(
        current,
        {
          catalogModelId: model.id,
          catalogModelName: model.displayName,
          catalogModelRevision: catalogRevision,
        },
        'system'
      )
    );
  }, [catalogRevision, lensState, modelSelection]);

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
    setViralAdaptBinding(null);
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
    if (!persisted) {
      // Nothing to persist means the tab holds no run — after 改一下要求, say.
      // Leaving the old handle in storage would let the next reload restore the
      // run the merchant just walked away from, remount its stream and poll,
      // and put its 申报 back on screen (#236 轮 5 P1-①). The handle is the
      // tab's memory of a run it holds; when it holds none, it remembers none.
      store.removeItem(COMPOSER_SESSION_STORAGE_KEY);
      return;
    }
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
  const interactionQueryKey = useMemo(
    () => ['harness', 'interaction', taskId] as const,
    [taskId]
  );
  const workflowStream = useWorkflowEventStream({
    enabled: Boolean(taskId),
    workflowId: taskId,
    workflowQueryKey,
  });
  const experienceBasis = useMemo(
    () =>
      projectExperienceBasis({
        producerSettled:
          Boolean(workflowStream.harnessExperienceBasis) ||
          workflowStream.workflowState === 'success' ||
          workflowStream.workflowState === 'failed',
        confirmedPreferences:
          workflowStream.harnessExperienceBasis?.confirmedPreferences ?? [],
      }),
    [workflowStream.harnessExperienceBasis, workflowStream.workflowState]
  );

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
    if (
      workflowStream.workflowState !== 'success' &&
      workflowStream.workflowState !== 'failed'
    ) {
      return;
    }
    setViralAdaptBinding(null);
    cancelViralOpenCliRead();
    setViralAdaptJourney((current) =>
      current.phase === 'idle' ? current : cancelViralAdaptJourney(current)
    );
    if (workflowStream.workflowState === 'success') {
      void queryClient.invalidateQueries({
        queryKey: experienceEntriesQueryKey,
      });
    }
  }, [
    cancelViralOpenCliRead,
    experienceEntriesQueryKey,
    queryClient,
    workflowStream.workflowState,
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

  // P1-07 / #319: after note delivery, hydrate multi-page outline onto the
  // timeline from the ContentPackage version.note field (carrier note path).
  useEffect(() => {
    if (session.phase !== 'delivered') return;
    const packageId = session.task?.packageId;
    if (!packageId) return;
    if (notePlanHydratedPackageRef.current === packageId) return;
    if (lensState.lensId !== 'image_text') return;
    let cancelled = false;
    void operationsQuery<PublicContentPackage[]>('content_packages', {})
      .then((packages) => {
        if (cancelled) return;
        const matched = packages.find((item) => item.id === packageId);
        const version =
          matched?.versions.find(
            (entry) => entry.id === matched.currentVersionId
          ) ??
          matched?.versions.find(
            (entry) => entry.id === workflowStream.harnessDelivery?.versionId
          ) ??
          matched?.versions.find((entry) => entry.note) ??
          matched?.versions[0];
        const note = version?.note as ImageTextNoteVersion | undefined;
        if (!note?.plan?.pages?.length) return;
        notePlanCanonicalPackageRef.current = matched ?? null;
        notePlanHydratedPackageRef.current = packageId;
        const timeline = projectNotePlanTimelineFromVersion(note, {
          styleId: version?.harnessCandidateId ?? note.plan.style.id,
          styleName: note.plan.style.name,
        });
        setSession((current) => applyComposerNotePlan(current, timeline));
      })
      .catch(() => {
        // Hydration is best-effort; delivery card still opens the object workspace.
      });
    return () => {
      cancelled = true;
    };
  }, [
    session.phase,
    session.task?.packageId,
    lensState.lensId,
    workflowStream.harnessDelivery?.versionId,
  ]);

  // 需要用户的一个问题 — the third inbound seam message. Polled while the run is
  // live so a suspended workflow surfaces its card without a page action.
  const decisionQuery = useQuery({
    enabled: Boolean(taskId) && session.phase !== 'delivered',
    queryKey: decisionQueryKey,
    queryFn: ({ signal }) => readPendingHarnessDecision(taskId, signal),
    refetchInterval: session.phase === 'delivered' ? false : 2_000,
  });
  const interactionQuery = useQuery({
    enabled: Boolean(taskId) && session.phase !== 'delivered',
    queryKey: interactionQueryKey,
    queryFn: ({ signal }) => readPendingHarnessInteraction(taskId, signal),
    refetchInterval: session.phase === 'delivered' ? false : 2_000,
  });
  const interactionMessageQuery = useQuery({
    enabled: Boolean(taskId) && session.phase !== 'delivered',
    queryKey: ['harness', 'interaction-message', taskId],
    queryFn: ({ signal }) =>
      readPendingHarnessInteractionMessage(taskId, signal),
    refetchInterval: session.phase === 'delivered' ? false : 2_000,
  });
  const pendingAskRequest =
    interactionQuery.data?.kind === 'ask_merchant'
      ? interactionQuery.data
      : null;
  const pendingExecutionConfirmation =
    interactionQuery.data?.kind === 'execution_confirmation'
      ? interactionQuery.data
      : null;
  const pendingExecutionWaitingMessage =
    interactionMessageQuery.data?.kind === 'execution_confirmation'
      ? interactionMessageQuery.data
      : null;
  const pendingQuestion: QuestionCard | null =
    decisionQuery.data?.question ?? null;
  const questionReservationReleased =
    decisionQuery.data?.reservationReleased === true;
  const questionResolutionSource =
    decisionQuery.data?.resolutionSource === 'core_timeout' ||
    decisionQuery.data?.resolutionSource === 'core_hold_expired'
      ? decisionQuery.data.resolutionSource
      : null;
  const questionTimeoutSeconds = decisionQuery.data?.timeoutSeconds ?? null;
  // P1-05: execution_confirm is its own timeline turn (DecisionFrame interrupt),
  // not a generic question. Server interrupt wins over client pre-submit card.
  // Apply both pending IDs in one atomic session update so clearing a settled
  // question cannot demote phase while execution_confirm is still the live hold.
  const clientExecutionConfirmOpen = executionConfirm.phase === 'open';
  const pendingExecutionConfirmTurnId =
    pendingExecutionConfirmation?.requestId ??
    pendingExecutionWaitingMessage?.requestId ??
    (clientExecutionConfirmOpen ? 'client-execution-confirm' : null);
  const pendingQuestionTurnId =
    pendingAskRequest?.requestId ?? pendingQuestion?.questionId ?? null;
  const hasExecutionConfirmBody =
    Boolean(pendingExecutionConfirmation) ||
    Boolean(pendingExecutionWaitingMessage) ||
    clientExecutionConfirmOpen ||
    Boolean(costFeedback);

  useEffect(() => {
    setSession((current) =>
      applyComposerPendingInterrupts(current, {
        questionId: pendingQuestionTurnId,
        executionConfirmId: pendingExecutionConfirmTurnId,
      })
    );
  }, [
    pendingExecutionConfirmTurnId,
    pendingQuestionTurnId,
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
  const answerAskMerchant = useCallback(
    async (response: AskMerchantAnswer['response']) => {
      if (!pendingAskRequest || !taskId) return;
      setQuestionPending(true);
      try {
        await submitHarnessInteraction(taskId, {
          requestId: pendingAskRequest.requestId,
          revision: pendingAskRequest.revision,
          idempotencyKey:
            `composer-interaction:${pendingAskRequest.requestId}:` +
            `r${pendingAskRequest.revision}:merchant`,
          resume: {
            runId: pendingAskRequest.runId,
            step: pendingAskRequest.step,
          },
          response,
        });
        await Promise.all([
          interactionQuery.refetch(),
          decisionQuery.refetch(),
        ]);
      } catch {
        toast.error(workbench_operation_failed());
        throw new Error('The merchant interaction could not be submitted.');
      } finally {
        setQuestionPending(false);
      }
    },
    [decisionQuery, interactionQuery, pendingAskRequest, taskId]
  );
  const answerExecutionConfirmation = useCallback(
    async (response: ExecutionConfirmationAnswer['response']) => {
      if (!pendingExecutionConfirmation || !taskId) return;
      setQuestionPending(true);
      try {
        await submitHarnessInteraction(taskId, {
          requestId: pendingExecutionConfirmation.requestId,
          revision: pendingExecutionConfirmation.revision,
          idempotencyKey:
            `composer-interaction:${pendingExecutionConfirmation.requestId}:` +
            `r${pendingExecutionConfirmation.revision}:merchant`,
          resume: {
            runId: pendingExecutionConfirmation.runId,
            step: pendingExecutionConfirmation.step,
          },
          response,
        });
        await interactionQuery.refetch();
      } catch {
        toast.error(workbench_operation_failed());
        throw new Error('The execution confirmation could not be submitted.');
      } finally {
        setQuestionPending(false);
      }
    },
    [interactionQuery, pendingExecutionConfirmation, taskId]
  );
  const answerExecutionWaitingMessage = useCallback(
    async (
      request: Extract<
        HarnessInteractionRequest,
        { kind: 'execution_confirmation' }
      >,
      message: string
    ) => {
      if (!taskId || request.runId !== taskId) return;
      setQuestionPending(true);
      try {
        await submitHarnessInteractionMerchantMessage(taskId, {
          requestId: request.requestId,
          revision: request.revision,
          step: request.step,
          carrier: 'conversation',
          idempotencyKey:
            `composer-interaction:${request.requestId}:` +
            `r${request.revision}:merchant-message`,
          message,
        });
        await Promise.all([
          interactionMessageQuery.refetch(),
          interactionQuery.refetch(),
          decisionQuery.refetch(),
        ]);
      } catch {
        toast.error(workbench_operation_failed());
        throw new Error('The merchant continuation could not be submitted.');
      } finally {
        setQuestionPending(false);
      }
    },
    [decisionQuery, interactionMessageQuery, interactionQuery, taskId]
  );
  const acknowledgeAskMerchantRenderer = useCallback(
    async (request: HarnessInteractionRequest) =>
      acknowledgeHarnessInteractionRenderer(taskId, {
        requestId: request.requestId,
        revision: request.revision,
        step: request.step,
        carrier: 'conversation',
      }),
    [taskId]
  );
  const refreshInteractionAfterRendererRejection = useCallback(async () => {
    await Promise.all([
      interactionQuery.refetch(),
      interactionMessageQuery.refetch(),
    ]);
  }, [interactionMessageQuery.refetch, interactionQuery.refetch]);

  const addSource = useCallback((assetId: string) => {
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
  }, []);

  const removeSource = useCallback((assetId: string) => {
    sourceFactsRef.current.delete(assetId);
    sourceRevisionRef.current.delete(assetId);
    setStyleReferenceAssetIds((current) =>
      current.filter((candidate) => candidate !== assetId)
    );
    setViralAdaptBinding(null);
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
  }, []);

  /**
   * The submission gate reads `product.state`, and `useProductState` only
   * fetches on mount — so an asset written straight through
   * `executeProductCommand` never enters the state the gate consults, and
   * `missingCreativeGrounding` keeps reporting `real_authorized_asset` missing
   * for a source the server has already authorized. Every inline asset write
   * ends here, the same way the ProgressiveFactCard confirm below does.
   */
  const refreshAfterAssetWrite = useCallback(async () => {
    setSubmissionGroundingBlocked(null);
    await product.refresh();
  }, [product]);

  const uploadComposerImage = useCallback(
    async (
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
    },
    [product.state?.store?.name, refreshAfterAssetWrite]
  );

  const authorizeComposerImage = useCallback(
    async (assetId: string, facts: ConfirmedAssetFacts) => {
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
    },
    [refreshAfterAssetWrite]
  );

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
      if (signedSubmission.viralAdaptSource) {
        const rebound = bindViralAdaptSource({
          sessionId: sessionIdRef.current,
          payload: signedSubmission.viralAdaptSource,
          sources: lensState.draft.sources,
        });
        if (
          !activeViralAdaptSource ||
          !rebound.ok ||
          rebound.binding.sessionId !== sessionIdRef.current
        ) {
          throw new Error(
            'Viral adapt source is no longer ready for this run.'
          );
        }
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
                role: submissionRoleForStyleReference(
                  candidate.id,
                  styleReferenceAssetIds
                ),
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

  useEffect(() => {
    if (!focusIntentAfterPrefillRef.current || createWork.isPending) return;
    const intentInput = document.querySelector(
      '[data-testid="composer-intent-input"]'
    );
    if (!(intentInput instanceof HTMLTextAreaElement) || intentInput.disabled) {
      return;
    }
    focusIntentAfterPrefillRef.current = false;
    focusComposerIntentInput();
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
      ...(sessionIdentityDecisionReference
        ? { identityDecision: sessionIdentityDecisionReference }
        : identitySelection.source === 'default' &&
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
    // A press was for one form of content at one price. Choosing another form
    // is a different ask, so the held press does not travel with it.
    armedQuoteIdRef.current = null;
    setActiveAiCover(null);
    setViralAdaptBinding(null);
    cancelViralOpenCliRead();
    setViralAdaptJourney((current) =>
      current.phase === 'idle' ? current : cancelViralAdaptJourney(current)
    );
    setLensState(selectLens(lensState, next));
  };

  const applyAiCoverSeed = useCallback(
    (seed: AiCoverActionSeed) => {
      const surface = surfaceQuery.data;
      const visiblePosterRevisions = new Set(
        surface?.recipeRefs
          .filter(
            (reference) =>
              reference.visible && reference.lensId === 'image_text'
          )
          .map((reference) => reference.recipeRevisionId) ?? []
      );
      const posterRecipe = surface?.recipes.find(
        (recipe) =>
          recipe.recipeId === 'recipe.promotion_poster' &&
          recipe.lensId === 'image_text' &&
          recipe.status === 'published' &&
          visiblePosterRevisions.has(recipe.revisionId)
      );
      if (!surface || !posterRecipe) {
        toast.error('封面配方暂时不可用，请刷新后重试。');
        return false;
      }
      setSubmissionGroundingBlocked(null);
      setSubmitBlockedMessage(null);
      destinationAutoSubmitIntentRef.current = null;
      setDestinationPreflight(null);
      armedQuoteIdRef.current = null;
      setViralAdaptBinding(null);
      cancelViralOpenCliRead();
      setViralAdaptJourney((current) =>
        current.phase === 'idle' ? current : cancelViralAdaptJourney(current)
      );
      if (lensState.phase === 'frozen' || session.phase === 'delivered') {
        sessionIdRef.current = newComposerSessionId();
        setSessionEpoch((current) => current + 1);
        briefContextRevisionRef.current = null;
        briefInputRef.current = null;
        restoredFromServerRef.current = true;
        setSession((current) =>
          rebindComposerSession(current, sessionIdRef.current)
        );
      }
      setCreationMode('free');
      setImageOperation('image.generate');
      setActiveAiCover(seed);
      setLensState((current) => {
        const editable = reopenComposer(current);
        const selected = applyCatalogRecipeSelection({
          state: editable,
          surface,
          recipeRevisionId: posterRecipe.revisionId,
          surfaceRevisionId: surface.revisionId,
        }).state;
        const withCoverSettings = updateSettings(
          selected,
          { aspectRatio: seed.aspectRatio, quantity: 1 },
          'user'
        );
        const withDestination = updateDeliverySuggestion(
          withCoverSettings,
          {
            deliverableKind: 'poster',
            distributionTarget: 'export',
            platform: 'xiaohongshu',
          },
          'user'
        );
        return updateUserText(withDestination, seed.intent);
      });
      focusComposerIntentInput();
      return true;
    },
    [cancelViralOpenCliRead, lensState.phase, session.phase, surfaceQuery.data]
  );

  useEffect(() => {
    if (
      initialAiCoverAppliedRef.current ||
      !initialAiCover ||
      !surfaceQuery.data
    ) {
      return;
    }
    const applied = applyAiCoverSeed(buildAiCoverActionSeed(initialAiCover));
    if (applied) initialAiCoverAppliedRef.current = true;
  }, [applyAiCoverSeed, initialAiCover, surfaceQuery.data]);

  const handleIntentChange = (value: string) => {
    setSubmissionGroundingBlocked(null);
    setSubmitBlockedMessage(null);
    destinationAutoSubmitIntentRef.current = null;
    setDestinationPreflight(null);
    setViralAdaptBinding(null);
    cancelViralOpenCliRead();
    setViralAdaptJourney((current) =>
      current.phase === 'idle' ? current : cancelViralAdaptJourney(current)
    );
    if (
      (lensState.phase === 'frozen' || session.phase === 'delivered') &&
      !reopeningCompletedAttemptRef.current
    ) {
      reopeningCompletedAttemptRef.current = true;
      sessionIdRef.current = newComposerSessionId();
      setSessionEpoch((current) => current + 1);
      briefContextRevisionRef.current = null;
      briefInputRef.current = null;
      restoredFromServerRef.current = true;
      setSession((current) =>
        rebindComposerSession(current, sessionIdRef.current)
      );
    }
    setLensState((current) => {
      const editable = reopenComposer(current);
      const withoutSystemDestination =
        editable.draft.fieldMeta.deliveryPlatform?.ownership === 'system'
          ? updateDeliverySuggestion(
              editable,
              { distributionTarget: null, platform: null },
              'system'
            )
          : editable;
      return updateUserText(withoutSystemDestination, value);
    });
  };

  useEffect(() => {
    if (lensState.phase !== 'frozen' && session.phase !== 'delivered') {
      reopeningCompletedAttemptRef.current = false;
    }
  }, [lensState.phase, session.phase]);

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
      setViralAdaptBinding(null);
      cancelViralOpenCliRead();
      setViralAdaptJourney((current) =>
        current.phase === 'idle' ? current : cancelViralAdaptJourney(current)
      );
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
        // The rebind above already handed this conversation to the new attempt.
        // Replacing it with a fresh session would also throw away the 交付卡 a
        // partial delivery left standing — the one part that did land, which
        // 再生成一次 is offered *from* (#236 轮 5 P1-③).
        //
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
    setSubmitBlockedMessage(null);
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
      setSubmitBlockedMessage(gate.message);
      if (gate.focusTarget === 'lens_group') {
        document
          .querySelector<HTMLElement>(
            '[data-testid="composer-lens-radiogroup"]'
          )
          ?.focus();
      }
      return;
    }

    if (lensState.phase !== 'selected') {
      setSubmitBlockedMessage(COMPOSER_LENS_REQUIRED_MESSAGE);
      return;
    }
    if (
      (viralAdaptJourney.phase !== 'idle' ||
        submissionRecipe?.recipeId === 'recipe.viral_adapt') &&
      (!viralSubmissionRecipeReady || !activeViralAdaptSource)
    ) {
      setSubmitBlockedMessage(
        '爆款复刻的模板或参考素材尚未确认，当前不会按默认图文提交。'
      );
      return;
    }
    const destinationDecision = decideComposerDestinationPreflight({
      appliedRecipeDestination:
        submissionRecipe?.revisionId === lensState.draft.recipeRevisionId
          ? submissionRecipe.delivery
          : undefined,
      currentDestination: {
        contentPackagePlatform: lensState.draft.delivery.platform,
        distributionTarget: lensState.draft.delivery.distributionTarget,
      },
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
      setSubmitBlockedMessage(COMPOSER_QUOTE_PENDING_MESSAGE);
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
      // They kept writing, or the quote context went away entirely (a lens
      // switch, a submission that stopped signing). Either way the sentence
      // they pressed on is gone, and the press goes with it — held across a
      // gap it would fire later on a quote id that came back around, which is
      // a submission the merchant never asked for (#236 轮 5 P1-②).
      armedQuoteIdRef.current = null;
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
      toast.error(briefStaleQuoteNotice());
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
      openExecutionConfirmFor({
        briefConfirmationId: confirmationId,
        existingGateSatisfied: true,
        lensId: lensState.lensId,
        videoConfirmAccepted: result.state.videoConfirmAccepted,
      });
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

  const updateMountedNotePlan = (
    update: (timeline: NotePlanTimeline) => NotePlanTimeline
  ) => {
    setSession((current) => {
      const existing = current.turns.find((turn) => turn.kind === 'note_plan');
      if (!existing || existing.kind !== 'note_plan') return current;
      return updateComposerNotePlan(current, update(existing.timeline));
    });
  };

  const refreshNotePlanCanonicalPackage = async (packageId: string) => {
    const packages = await operationsQuery<PublicContentPackage[]>(
      'content_packages',
      {}
    );
    const refreshed = packages.find((item) => item.id === packageId) ?? null;
    if (refreshed) notePlanCanonicalPackageRef.current = refreshed;
    return refreshed;
  };

  const saveNotePlanOutline = async (pageId: string) => {
    if (notePlanOutlineSavePendingPageId) return;
    const noteTurn = session.turns.find((turn) => turn.kind === 'note_plan');
    const page =
      noteTurn?.kind === 'note_plan'
        ? noteTurn.timeline.pages.find(
            (candidate) => candidate.pageId === pageId
          )
        : null;
    const contentPackage = notePlanCanonicalPackageRef.current;
    if (!page || !contentPackage) {
      setNotePlanOutlineSaveError({
        message: '暂时无法读取当前内容版本，请刷新后重试。',
        pageId,
      });
      return;
    }
    const fingerprint = JSON.stringify({
      body: page.body,
      packageId: contentPackage.id,
      pageId,
      revision: contentPackage.revision,
      title: page.title,
    });
    const idempotencyKey =
      notePlanOutlineIntentKeysRef.current.get(fingerprint) ??
      crypto.randomUUID();
    notePlanOutlineIntentKeysRef.current.set(fingerprint, idempotencyKey);
    setNotePlanOutlineSavePendingPageId(pageId);
    setNotePlanOutlineSaveError(null);
    try {
      const saved = await saveComposerNotePlanOutline({
        contentPackage,
        edit: { body: page.body, pageId, title: page.title },
        idempotencyKey,
      });
      notePlanOutlineIntentKeysRef.current.delete(fingerprint);
      notePlanCanonicalPackageRef.current = saved.contentPackage;
      setSession((current) => {
        const existing = current.turns.find(
          (turn) => turn.kind === 'note_plan'
        );
        const timeline =
          existing?.kind === 'note_plan'
            ? preserveUnsavedNotePlanOutlines(
                saved.timeline,
                existing.timeline,
                pageId
              )
            : saved.timeline;
        return updateComposerNotePlan(current, timeline);
      });
    } catch (error) {
      // A stale OCC base must be refreshed without replacing the merchant's
      // dirty local page. Retry then reapplies that page to the newest note.
      const code = p1ErrorCode(error);
      if (
        code === 'CONTENT_PACKAGE_REVISION_CONFLICT' ||
        code === 'CONTENT_PACKAGE_VERSION_CONFLICT'
      ) {
        notePlanOutlineIntentKeysRef.current.delete(fingerprint);
        await refreshNotePlanCanonicalPackage(contentPackage.id).catch(
          () => null
        );
      }
      setNotePlanOutlineSaveError({
        message: '大纲尚未保存，改动仍在本页。请重试。',
        pageId,
      });
    } finally {
      setNotePlanOutlineSavePendingPageId(null);
    }
  };

  const prepareNotePlanRegeneration = async (pageId: string) => {
    if (
      notePlanRegenerationBusy ||
      pendingNotePlanRegeneration ||
      executionConfirm.phase === 'open'
    ) {
      return;
    }
    const contentPackage = notePlanCanonicalPackageRef.current;
    const workId = session.task?.workId;
    if (!contentPackage || !workId) {
      setNotePlanRegenerationError({
        message: '暂时无法读取当前图文版本，请刷新后重试。',
        pageId,
      });
      return;
    }
    updateMountedNotePlan((timeline) =>
      prepareNotePlanPageRegenerate(timeline, pageId)
    );
    setNotePlanRegenerationBusy(true);
    setNotePlanRegenerationError(null);
    setCostFeedback(null);
    try {
      const workbench = await operationsQuery<CreativeWorkbenchProjection>(
        'creative_workbench',
        {}
      );
      const work = workbench.works.find((candidate) => candidate.id === workId);
      if (!work) throw new Error('The source Work was not found.');
      const pending = await prepareComposerNotePlanPageRegeneration({
        contentPackage,
        pageId,
        workId,
        workUpdatedAt: work.updatedAt,
      });
      setPendingNotePlanRegeneration(pending);
      setExecutionConfirm(
        openExecutionConfirm(createExecutionConfirmState(), {
          composerSnapshot: {
            draftRevisionId: pending.derivedWorkId,
            lensId: 'image_text',
            sources: [],
            userText: pending.instruction,
          },
          cost: projectExecutionCost({
            available: {},
            requirements: (pending.quote.debitUnits ?? []).map((unit) => ({
              cost: unit.quantity,
              resource: unit.resource as ComposerQuotaResource,
            })),
          }),
          params: projectExecutionParams({
            aspectRatio: pending.aspectRatio ?? null,
            lensId: 'image_text',
            outputLabel: pending.quote.outputLabel ?? null,
            quantity: pending.quantity,
          }),
        })
      );
    } catch {
      updateMountedNotePlan((timeline) =>
        resetNotePlanPageRegenerate(timeline, pageId)
      );
      setNotePlanRegenerationError({
        message: '暂时无法准备本页重生成，尚未使用图片额度。请重试。',
        pageId,
      });
    } finally {
      setNotePlanRegenerationBusy(false);
    }
  };

  const rejectNotePlanRegeneration = () => {
    const pending = pendingNotePlanRegeneration;
    if (!pending) return;
    updateMountedNotePlan((timeline) =>
      resetNotePlanPageRegenerate(timeline, pending.pageId)
    );
    setPendingNotePlanRegeneration(null);
    setNotePlanRegenerationError(null);
    setExecutionConfirm((current) => rejectExecution(current).state);
    setCostFeedback(projectExecutionCostFeedback({ outcome: 'rejected' }));
  };

  const confirmNotePlanRegeneration = async () => {
    const pending = pendingNotePlanRegeneration;
    if (!pending || notePlanRegenerationBusy) return;
    setNotePlanRegenerationBusy(true);
    setNotePlanRegenerationError(null);
    try {
      const result = await confirmComposerNotePlanPageRegeneration({ pending });
      setPendingNotePlanRegeneration(null);
      setExecutionConfirm(confirmExecution);
      notePlanCanonicalPackageRef.current = null;
      notePlanHydratedPackageRef.current = null;
      setSession((current) => {
        const noteTurn = current.turns.find(
          (turn) => turn.kind === 'note_plan'
        );
        const withExecution =
          noteTurn?.kind === 'note_plan'
            ? updateComposerNotePlan(
                current,
                requestNotePlanPageRegenerate(noteTurn.timeline, pending.pageId)
              )
            : current;
        return bindComposerTask(withExecution, {
          packageId: result.contentPackage.id,
          taskId: result.task.id,
          workId: result.work.id,
        });
      });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['harness', 'active-tasks'],
        }),
        queryClient.invalidateQueries({
          queryKey: p1QueryKeys.request('operations', 'content_packages'),
        }),
      ]);
    } catch {
      // Keep the idempotent confirmation visible for retry. No local image is
      // marked generating until Core returns the derived Task/Work receipt.
      setNotePlanRegenerationError({
        message: '本页重生成尚未确认，请重试或取消；当前图片保持不变。',
        pageId: pending.pageId,
      });
    } finally {
      setNotePlanRegenerationBusy(false);
    }
  };

  // Same两个 conditions `attemptSubmit` checks before it starts anything —
  // read here so the button can say which of its two jobs is armed *before*
  // the press rather than only after it (see `composerSubmitIntent`).
  const submitIntent = composerSubmitIntent({
    groundingBlocker:
      product.state && !product.loading && !product.error
        ? groundingBlockerFromMissing(missingGrounding)
        : null,
    storeFactsPending: showProgressiveFact,
  });

  // P0-1 / F6: once a run is Active, collapse 段①/段③ so the transcript owns
  // the first screen. Idle and terminal phases keep the shelf.
  const shelfCollapsed = isWorkbenchShelfCollapsed(session.phase);
  // P1-01 / §8.2: dual column at ≥1240 Active/Delivered; sticky Composer; 800/1240.
  const dualColumn = isWorkbenchDualColumnEligible(session.phase, width);
  const stickyComposer = isWorkbenchComposerSticky(session.phase);
  // P1-01: media width (1240) ≡ dual-column shell. mediaExpanded is reserved for
  // a later object-workspace expand and is intentionally not passed here.
  const widthMode = resolveWorkbenchWidthMode({ dualColumn });
  const inspectorWorkId = session.task?.workId ?? null;
  const inspectorSummary = session.deliveryStatement ?? null;
  const inspectorPhase =
    session.phase === 'delivered'
      ? 'delivered'
      : session.phase === 'running' ||
          session.phase === 'submitting' ||
          session.phase === 'awaiting_answer'
        ? 'running'
        : 'idle';
  const latestStageTurn = [...session.turns]
    .reverse()
    .find((turn) => turn.kind === 'stage');
  const inspectorStageLabel =
    latestStageTurn && latestStageTurn.kind === 'stage'
      ? latestStageTurn.message
      : null;
  const inspectorProgressLabel =
    inspectorPhase === 'running'
      ? session.phase === 'submitting'
        ? '正在提交'
        : session.phase === 'awaiting_answer'
          ? '等待你的确认'
          : '创作进行中'
      : null;
  const inspectorPlatformLabel =
    lensState.draft.delivery.platform != null
      ? (COMPOSER_DESTINATION_OPTIONS.find(
          (option) => option.id === lensState.draft.delivery.platform
        )?.label ?? lensState.draft.delivery.platform)
      : null;

  // Mobile inspector sheet is the dual-column equivalent — dismiss when desktop
  // dual column takes over so the two surfaces never stack.
  useEffect(() => {
    if (dualColumn) setInspectorSheetOpen(false);
  }, [dualColumn]);

  // Keep the attach capsule slot referentially stable across quote/usage
  // re-renders. An inline JSX tree remounts free-mode generation-params
  // buttons on every parent render and breaks pointer clicks mid-popover.
  const composerAttachmentSlot = useMemo(
    () => (
      <div data-testid="composer-source-picker">
        {explicitImageOperation ? (
          <ComposerImageOperationPicker
            disabled={createWork.isPending || lensState.phase === 'frozen'}
            onChange={setImageOperation}
            value={explicitImageOperation}
          />
        ) : null}
        {generationParamsEnabled ? (
          <ComposerGenerationParamsPanel
            creationMode={creationMode}
            disabled={createWork.isPending || lensState.phase === 'frozen'}
            onChange={setGenerationParams}
            state={generationParams}
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
        {sourceReferences.length > 0 ? (
          <div
            className="mt-2 flex flex-wrap items-center gap-2"
            data-testid="composer-style-reference-controls"
          >
            {sourceReferences.map((source) => (
              <ComposerStyleReferenceControl
                assetId={source.id}
                key={source.id}
                onToggle={(assetId) =>
                  setStyleReferenceAssetIds((current) =>
                    toggleStyleReferenceAsset(current, assetId)
                  )
                }
                selected={styleReferenceAssetIds.includes(source.id)}
              />
            ))}
            <ComposerStyleAnalysisStageNotice
              state={buildStyleAnalysisStageFromAssets({
                attachedAssetIds: sourceReferences.map(({ id }) => id),
                styleReferenceAssetIds,
              })}
            />
          </div>
        ) : null}
        {imageCardinality.message ? (
          <p
            className="mt-2 text-destructive text-xs"
            data-testid="composer-image-cardinality"
            role="alert"
          >
            {imageCardinality.message}
          </p>
        ) : null}
        <ComposerAiCoverMismatchNotice visible={showAiCoverSignatureMismatch} />
      </div>
    ),
    [
      addSource,
      authorizeComposerImage,
      createWork.isPending,
      creationMode,
      explicitImageOperation,
      generationParams,
      generationParamsEnabled,
      imageCardinality.message,
      lensState.phase,
      removeSource,
      showAiCoverSignatureMismatch,
      sourcePickerRef,
      sourceReferences,
      styleReferenceAssetIds,
      uploadComposerImage,
    ]
  );

  return (
    <WorkbenchShellRoot
      // `meiye-heroui-glass` lives on the app shell root (sidebar-layout), not
      // here — T33「一个 Glass 壳根」. This root only owns the P1 width contract.
      dualColumn={dualColumn}
      stickyComposer={stickyComposer}
      widthMode={widthMode}
      data-shelf-collapsed={shelfCollapsed ? 'true' : 'false'}
      data-viewport={viewportKind}
    >
      {/*
       * The greeting is the one personified moment the design system reserves a
       * whole type role for (DESIGN.md §3 问候语法则), so it opens the workbench.
       * R-1 (gap-remediation-plan 2026-08-02) supersedes D-164① ordering:
       * 问候 → 分段器 → Composer → 建议行 → Shelf (spec §2.4).
       */}
      <DashboardHomeGreeting state={product.state} />

      <ComposerCreationModeSegment
        creationMode={creationMode}
        onCreationModeChange={setCreationMode}
      />

      {/* 创作面 — Composer + document timeline (D-139 lens axis inside capsule). */}
      <section
        className="flex flex-col gap-6"
        data-testid="dashboard-section-create"
      >
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

        {viralAdaptJourney.phase === 'sourcing' ||
        viralAdaptJourney.phase === 'confirm' ? (
          <ViralAdaptPanel
            onOpenCliLinkChange={(noteUrl) =>
              setViralAdaptJourney((current) =>
                updateViralOpenCliLink(current, noteUrl)
              )
            }
            onOpenCliRead={() => void readViralOpenCliNote()}
            onConfirm={() => {
              const next = confirmViralAdaptJourney(viralAdaptJourney);
              if ('error' in next || !next.sourcePayload) return;
              const bound = bindViralAdaptSource({
                sessionId: sessionIdRef.current,
                payload: next.sourcePayload,
                sources: lensState.draft.sources,
              });
              if (!bound.ok) {
                setViralAdaptBinding(null);
                setSubmitBlockedMessage(
                  '参考图片尚未完成授权或版本登记，请重新上传并确认后再继续。'
                );
                return;
              }
              setViralAdaptBinding(bound.binding);
              setViralAdaptJourney(next);
              if (next.merchantIntent) {
                setLensState(
                  (lens) =>
                    applyRecommendationHandoffWithRecipe({
                      state: lens,
                      handoff: {
                        intent: next.merchantIntent!,
                        outputHint: 'image_text',
                        recipeChipId: 'viral_adapt',
                      },
                      surface: surfaceQuery.data,
                    }).state
                );
                focusIntentAfterPrefillRef.current = true;
              }
            }}
            onConfirmBack={() => {
              setViralAdaptBinding(null);
              setViralAdaptJourney((current) => ({
                ...current,
                phase: 'sourcing',
                confirm: null,
                merchantIntent: null,
                sourcePayload: null,
              }));
            }}
            onDraftChange={(patch) =>
              setViralAdaptJourney((current) =>
                updateViralPasteDraft(current, patch)
              )
            }
            onRequestImageUpload={() => {
              sourcePickerRef.current?.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
              });
              sourcePickerRef.current?.focus();
            }}
            onSourcingCancel={() => {
              setViralAdaptBinding(null);
              cancelViralOpenCliRead();
              setViralAdaptJourney((current) => {
                return cancelViralAdaptJourney(current);
              });
            }}
            onSourcingContinue={() =>
              setViralAdaptJourney((current) => {
                const next = advanceViralSourcingToConfirm(current);
                return 'error' in next ? current : next;
              })
            }
            onTrackChange={(track) =>
              setViralAdaptJourney((current) => {
                setViralAdaptBinding(null);
                if (track === 'paste') {
                  cancelViralOpenCliRead();
                }
                return selectViralAdaptSourceTrack(current, track);
              })
            }
            state={viralAdaptJourney}
          />
        ) : null}

        <WorkbenchCreateLayout
          dualColumn={dualColumn}
          inspector={
            <WorkbenchInspectorPanel
              onOpenFullWorkspace={
                inspectorWorkId
                  ? () =>
                      openDelivery({
                        action: 'open',
                        revision: null,
                        taskId: session.task?.taskId ?? '',
                        workId: inspectorWorkId,
                      })
                  : undefined
              }
              phase={inspectorPhase}
              platformLabel={inspectorPlatformLabel}
              progressLabel={inspectorProgressLabel}
              stageLabel={inspectorStageLabel}
              summary={inspectorSummary}
              workId={inspectorWorkId}
            />
          }
          stream={
            <>
              {/* Layer ① — the conversation. Stage announcements, the 引导补问卡 and the
            streaming candidate all land here; nothing navigates away.
            Identity lives in the Composer @ capsule (L3-2), not the stream. */}
              <ComposerConversation
                experienceBasis={experienceBasis}
                experienceCorrection={experienceCorrection}
                experienceSediment={experienceSediment}
                onSedimentKeepLater={(entryId) => {
                  if (
                    !canActOnExperienceSediment(experienceSediment, entryId)
                  ) {
                    return;
                  }
                  void commandP1(
                    'memory',
                    {
                      action: 'confirm_candidate',
                      payload: {
                        entryId,
                        positiveExamples: [],
                        negativeExamples: [],
                      },
                    },
                    `experience-sediment-confirm:${entryId}`
                  )
                    .then(() =>
                      queryClient.invalidateQueries({
                        queryKey: p1QueryKeys.module('memory'),
                      })
                    )
                    .catch(() => {
                      toast.error('确认经验未能记入，请到经验页重试。');
                    });
                }}
                onSedimentThisTimeOnly={(entryId) => {
                  if (
                    !canActOnExperienceSediment(experienceSediment, entryId)
                  ) {
                    return;
                  }
                  void commandP1(
                    'memory',
                    {
                      action: 'reject_candidate',
                      payload: {
                        entryId,
                        reason: '仅本次任务，不作为长期经验',
                      },
                    },
                    `experience-sediment-once:${entryId}`
                  )
                    .then(() =>
                      queryClient.invalidateQueries({
                        queryKey: p1QueryKeys.module('memory'),
                      })
                    )
                    .catch(() => {
                      toast.error('本次选择未能记入，请到经验页重试。');
                    });
                }}
                deliveryAspectRatio={submissionAspectRatio ?? undefined}
                deliveryLensId={lensState.lensId ?? undefined}
                onDeliveryFollowUp={(seed) => {
                  // D-164⑤: a chip prefills, never submits. The merchant reads the
                  // sentence in her own box and decides — the same contract the
                  // recommendation card's CTA already keeps.
                  setViralAdaptBinding(null);
                  cancelViralOpenCliRead();
                  setViralAdaptJourney((current) =>
                    current.phase === 'idle'
                      ? current
                      : cancelViralAdaptJourney(current)
                  );
                  setLensState((current) =>
                    updateUserText(current, seed.intent)
                  );
                  focusComposerIntentInput();
                }}
                onDeliveryAiCover={(seed) => {
                  // P2-11 / #323: freeze the chosen ratio+preset into the same
                  // quote-signed contract the paid-media confirmation reads.
                  applyAiCoverSeed(seed);
                }}
                onNotePlanOutlineEdit={({ pageId, title, body }) => {
                  setNotePlanOutlineSaveError((current) =>
                    current?.pageId === pageId ? null : current
                  );
                  setSession((current) => {
                    const existing = current.turns.find(
                      (turn) => turn.kind === 'note_plan'
                    );
                    if (!existing || existing.kind !== 'note_plan') {
                      return current;
                    }
                    return updateComposerNotePlan(
                      current,
                      editNotePlanPageOutline(existing.timeline, {
                        pageId,
                        title,
                        body,
                      })
                    );
                  });
                }}
                notePlanOutlineSaveError={notePlanOutlineSaveError}
                notePlanOutlineSavePendingPageId={
                  notePlanOutlineSavePendingPageId
                }
                notePlanRegenerationError={notePlanRegenerationError}
                onNotePlanOutlineSave={(pageId) => {
                  void saveNotePlanOutline(pageId);
                }}
                onNotePlanRegeneratePage={(pageId) => {
                  void prepareNotePlanRegeneration(pageId);
                }}
                onOpenDelivery={openDelivery}
                onRateDelivery={async ({
                  transition,
                  revision,
                  taskId: deliveryTaskId,
                }) => {
                  if (transition.action === 'copy') {
                    void navigator.clipboard?.writeText(
                      session.deliveryStatement ?? ''
                    );
                    return;
                  }
                  const identity = {
                    packageId: revision.packageId,
                    versionId: revision.versionId,
                    revision: revision.revision,
                  };
                  const event = (() => {
                    if (transition.nextVerdict) {
                      return {
                        eventType: 'delivery_rating.recorded' as const,
                        taskId: deliveryTaskId,
                        payload: {
                          ...identity,
                          verdict: transition.nextVerdict,
                        },
                      };
                    }
                    const previousVerdict = transition.previousVerdict;
                    if (!previousVerdict) {
                      throw new Error(
                        'Rating withdrawal requires a prior verdict.'
                      );
                    }
                    return {
                      eventType: 'delivery_rating.withdrawn' as const,
                      taskId: deliveryTaskId,
                      payload: {
                        ...identity,
                        previousVerdict,
                      },
                    };
                  })();
                  await appendObservabilityEvent(
                    event,
                    `delivery-rating:${deliveryTaskId}:${transition.idempotencyKey}`
                  );
                }}
                onRecover={recoverFromReport}
                executionConfirmSlot={
                  // P1-05: in-stream DecisionFrame interrupt body (not sticky slot).
                  // Pass null when idle so no empty DecisionFrame host remains.
                  hasExecutionConfirmBody ? (
                    <div data-testid="execution-confirm-slot">
                      {pendingExecutionConfirmation ? (
                        <ExecutionConfirmationInteractionCard
                          onRendererReady={acknowledgeAskMerchantRenderer}
                          onRendererRejected={
                            refreshInteractionAfterRendererRejection
                          }
                          onSubmit={answerExecutionConfirmation}
                          pending={questionPending}
                          request={pendingExecutionConfirmation}
                        />
                      ) : pendingExecutionWaitingMessage ? (
                        <ExecutionConfirmationWaitingMessageCard
                          onSubmit={answerExecutionWaitingMessage}
                          pending={questionPending}
                          request={pendingExecutionWaitingMessage}
                        />
                      ) : clientExecutionConfirmOpen ? (
                        <ExecutionConfirmCard
                          {...projectExecutionConfirmCard(executionConfirm, {
                            busy: pendingNotePlanRegeneration
                              ? notePlanRegenerationBusy
                              : createWork.isPending || briefPending,
                            onConfirm: () => {
                              if (pendingNotePlanRegeneration) {
                                void confirmNotePlanRegeneration();
                                return;
                              }
                              const run = pendingRunRef.current;
                              setExecutionConfirm(confirmExecution);
                              if (!run) return;
                              pendingRunRef.current = null;
                              runCreate(
                                run.lensId,
                                run.videoConfirmAccepted,
                                run.briefConfirmationId
                              );
                            },
                            onReject: () => {
                              if (pendingNotePlanRegeneration) {
                                rejectNotePlanRegeneration();
                                return;
                              }
                              pendingRunRef.current = null;
                              setExecutionConfirm(
                                (current) => rejectExecution(current).state
                              );
                              setCostFeedback(
                                projectExecutionCostFeedback({
                                  outcome: 'rejected',
                                })
                              );
                            },
                            staleNotice: pendingNotePlanRegeneration
                              ? (notePlanRegenerationError?.message ?? null)
                              : currentQuoteView
                                ? null
                                : briefStaleQuoteNotice(),
                          })}
                        />
                      ) : null}
                      <ExecutionCostFeedbackLine feedback={costFeedback} />
                    </div>
                  ) : null
                }
                questionSlot={
                  <AskMerchantInteractionSlot
                    delivered={session.phase === 'delivered'}
                    fallback={
                      pendingQuestion ? (
                        <ComposerQuestionCard
                          disabled={createWork.isPending}
                          // D-116 safety edge ②: quota or an external effect means D-112
                          // wants an explicit confirmation, so the card stops releasing
                          // itself. v1's composer only signs export / assisted_handoff, so
                          // the external branch is not reachable from here yet.
                          hold={composerQuestionHold({
                            externalEffect: Boolean(
                              destination?.distributionTarget.startsWith(
                                'publish:'
                              )
                            ),
                            quotaBlocked,
                          })}
                          // Returned, not voided: the card awaits this and rolls its
                          // settlement back if the post never reaches the ledger.
                          onDecide={answerQuestion}
                          pending={questionPending}
                          question={pendingQuestion}
                          reservationReleased={questionReservationReleased}
                          resolutionSource={questionResolutionSource}
                          timeoutSeconds={questionTimeoutSeconds}
                        />
                      ) : null
                    }
                    onEditingChange={(request, editing, editingSessionId) =>
                      setHarnessInteractionEditing(taskId, {
                        requestId: request.requestId,
                        revision: request.revision,
                        step: request.step,
                        carrier: 'conversation',
                        editing,
                        editingSessionId,
                      })
                    }
                    onRendererReady={acknowledgeAskMerchantRenderer}
                    onRendererRejected={
                      refreshInteractionAfterRendererRejection
                    }
                    onSubmit={answerAskMerchant}
                    pending={questionPending}
                    pendingRequest={pendingAskRequest}
                    taskId={taskId}
                  />
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

              {/* P1-2: scroll room so delivery cards clear the stuck Composer scrim. */}
              <WorkbenchStickyComposerClearance sticky={stickyComposer} />
              {/* P1-2: Active morph Composer to sticky bottom; clear mobile-nav. */}
              <WorkbenchStickyComposerHost sticky={stickyComposer}>
                <ComposerPromptBar
                  ariaLabel={creation_entry_intent_aria()}
                  // DESIGN.md 白瓷 Composer 大卡 — pinned by the product shell contract.
                  className="meiye-composer meiye-entry-card rounded-3xl p-4 sm:p-5"
                  attachmentSlot={composerAttachmentSlot}
                  creditShort={quotaBlocked || quotaPassive.short}
                  creditSlot={
                    <ComposerCreditRecoveryHost
                      blocked={quotaBlocked}
                      passive={quotaPassive}
                      quote={currentQuoteView}
                      redeem={({ command, idempotencyKey }) =>
                        commandP1<ComposerCreditRedemptionReceipt>(
                          'redemptions',
                          command,
                          idempotencyKey
                        )
                      }
                      refreshCredits={async () =>
                        (await usageQuery.refetch()).data
                      }
                      onRecoverySettled={() =>
                        queryClient.invalidateQueries({
                          queryKey: p1QueryKeys.request(
                            'entitlements',
                            'balance'
                          ),
                        })
                      }
                      onUnlocked={() => setSubmissionQuotaBlocked(false)}
                    />
                  }
                  creditSummary={
                    quotaPassive.visible
                      ? quotaPassive.notice
                      : quotaBlocked
                        ? '额度不足'
                        : null
                  }
                  destination={lensState.draft.delivery.platform ?? null}
                  destinationCapability={
                    destination
                      ? composerDestinationCapability(
                          destination.distributionTarget
                        )
                      : null
                  }
                  disabled={
                    createWork.isPending || lensState.phase === 'frozen'
                  }
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
                  lensRequired={showRequiredHint}
                  lensSlot={
                    <>
                      <LensRadiogroup
                        value={lensId}
                        onChange={handleLensChange}
                        showRequiredHint={showRequiredHint}
                        disabled={
                          createWork.isPending || lensState.phase === 'frozen'
                        }
                      />
                      <LensSwitchPreviewPanel
                        state={lensState}
                        onChange={(next) => {
                          setViralAdaptBinding(null);
                          cancelViralOpenCliRead();
                          setViralAdaptJourney((current) =>
                            current.phase === 'idle'
                              ? current
                              : cancelViralAdaptJourney(current)
                          );
                          setLensState(next);
                        }}
                      />
                    </>
                  }
                  lensSummary={lensId ? COMPOSER_LENS_LABELS[lensId] : null}
                  mentionSlot={
                    <div className="flex flex-col gap-4">
                      <ComposerIdentityCard
                        defaultPending={defaultIdentityDecision.isPending}
                        onRemember={(identityId) =>
                          defaultIdentityDecision.mutate(identityId)
                        }
                        onRetry={() => void identitiesQuery.refetch()}
                        onSelect={(identityId) =>
                          sessionIdentityDecision.mutate(identityId)
                        }
                        selectionPending={sessionIdentityDecision.isPending}
                        selection={identitySelection}
                      />
                      <ComposerToolsStrip
                        viewport={viewportKind}
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
                    </div>
                  }
                  recipePillSlot={
                    surfaceQuery.data ? (
                      <RecipeCardsPanel
                        lensId={lensId}
                        lensState={lensState}
                        onLensStateChange={(next) => {
                          setViralAdaptBinding(null);
                          cancelViralOpenCliRead();
                          setViralAdaptJourney((current) =>
                            current.phase === 'idle'
                              ? current
                              : cancelViralAdaptJourney(current)
                          );
                          setLensState(next);
                        }}
                        surface={surfaceQuery.data}
                        requestServerPreview={({ lensState: state, recipe }) =>
                          requestRecipePatchPreview({
                            recipeRevisionId: recipe.revisionId,
                            currentLens: state.lensId,
                            surfaceRevisionId: surfaceQuery.data.revisionId,
                            draft: composerDraftToRecipeFields(state),
                          })
                        }
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
                    )
                  }
                  recipeSummary={
                    lensState.draft.recipeRevisionId
                      ? (submissionRecipe?.presentation.title ?? null)
                      : null
                  }
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
                  modelChannelReadiness={
                    selectedModel?.channelReadiness ?? null
                  }
                  onSubmit={() => void attemptSubmit()}
                  onValueChange={handleIntentChange}
                  placeholder={creation_entry_intent_placeholder()}
                  reuseChips={COMPOSER_REUSE_CHIPS}
                  running={
                    // Lock/glow only while generating — keep intent editable
                    // while Brief is open so the merchant can invalidate it
                    // (stale-Brief path / M-04 English brief gate).
                    session.phase === 'running' ||
                    (session.phase === 'submitting' &&
                      briefState.phase !== 'open')
                  }
                  signedPreview={signedPreview}
                  submitHint={submitIntent.hint}
                  submitLabel={submitIntent.label}
                  intentError={submitBlockedMessage}
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
                    <p className="text-sm">
                      {destinationPreflight.result.question}
                    </p>
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
                    {/*
              `预计消耗 0.06` used to print here: a bare float in an invisible
              unit, one line above 「本次用 1 条文案额度和 3 张图片额度 · 文案还剩
              5 条」 — two pricing systems on one screen, and the merchant unit is
              条数, never money (D-109 / D-123). The counted sentence next to the
              send button owns the numbers; this line now only carries what that
              sentence cannot say (video is billed by finished seconds) and
              otherwise just states that the price is settled.
            */}
                    {currentQuoteView.billingNote ?? '本次用量已确认'}
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

                {/* Quota blocking alert stays visible outside the capsule when short. */}
                {quotaBlocked ? (
                  <ComposerCreditRecoveryHost
                    blocked={quotaBlocked}
                    passive={quotaPassive}
                    quote={currentQuoteView}
                    redeem={({ command, idempotencyKey }) =>
                      commandP1<ComposerCreditRedemptionReceipt>(
                        'redemptions',
                        command,
                        idempotencyKey
                      )
                    }
                    refreshCredits={async () =>
                      (await usageQuery.refetch()).data
                    }
                    onRecoverySettled={() =>
                      queryClient.invalidateQueries({
                        queryKey: p1QueryKeys.request(
                          'entitlements',
                          'balance'
                        ),
                      })
                    }
                    onUnlocked={() => setSubmissionQuotaBlocked(false)}
                  />
                ) : null}
              </WorkbenchStickyComposerHost>

              {briefView ? (
                <BriefSurface
                  view={briefView}
                  onConfirm={handleBriefConfirm}
                  onCancel={() => {
                    setBriefState(cancelBriefSurface(briefState).state);
                    // D-164⑥ 决定 B: backing out is still an outcome, and the
                    // merchant is owed a straight answer about what it cost. Set
                    // before the line below, which clears the transcript — the
                    // feedback lives outside the session for exactly this reason.
                    setCostFeedback(
                      projectExecutionCostFeedback({ outcome: 'rejected' })
                    );
                    // Cancelling abandons this attempt, so the transcript goes back to
                    // empty rather than keeping a turn that never ran.
                    setSession(createComposerSession(sessionIdRef.current));
                  }}
                  disabled={createWork.isPending}
                />
              ) : null}

              {/*
               * P1-05: execution_confirm lives in the document timeline
               * (executionConfirmSlot / DecisionFrame). Residual cost-only
               * feedback when Brief cancel wiped the transcript but still owes
               * an in-place "未消耗额度" answer (D-164⑥). Distinct testid so it
               * is not mistaken for the paid-media confirm slot.
               */}
              {costFeedback &&
              !pendingExecutionConfirmTurnId &&
              !clientExecutionConfirmOpen ? (
                <div data-testid="execution-cost-feedback-slot">
                  <ExecutionCostFeedbackLine feedback={costFeedback} />
                </div>
              ) : null}
            </>
          }
        />

        {/* Mobile dual-column equivalent: Inspector bottom sheet (P1-1). */}
        {!dualColumn && stickyComposer && inspectorWorkId ? (
          <div className="flex justify-end">
            <button
              className="text-muted hover:text-foreground text-xs font-medium underline-offset-4 hover:underline"
              data-testid="workbench-open-inspector-sheet"
              onClick={() => setInspectorSheetOpen(true)}
              type="button"
            >
              查看上下文
            </button>
          </div>
        ) : null}
        <WorkbenchInspectorSheet
          onOpenChange={setInspectorSheetOpen}
          open={inspectorSheetOpen}
        >
          <WorkbenchInspectorPanel
            onOpenFullWorkspace={
              inspectorWorkId
                ? () => {
                    setInspectorSheetOpen(false);
                    openDelivery({
                      action: 'open',
                      revision: null,
                      taskId: session.task?.taskId ?? '',
                      workId: inspectorWorkId,
                    });
                  }
                : undefined
            }
            phase={inspectorPhase}
            platformLabel={inspectorPlatformLabel}
            progressLabel={inspectorProgressLabel}
            stageLabel={inspectorStageLabel}
            summary={inspectorSummary}
            workId={inspectorWorkId}
          />
        </WorkbenchInspectorSheet>
      </section>

      {/*
       * 建议行 — R-1: below Composer on Idle (spec §2.4). Prefill only, never
       * submit. Stays mounted under Active collapse so disclosure state survives.
       */}
      <section data-testid="dashboard-section-proposal" hidden={shelfCollapsed}>
        <DashboardHomeSurface
          loading={product.loading}
          onPrefill={(handoff: RecommendationHandoff) => {
            // P0-4 / F1: typed handoff. Respect outputHint when present;
            // never hard-code copy lens when the recommendation has no hint.
            focusIntentAfterPrefillRef.current = true;
            setViralAdaptBinding(null);
            if (lensState.phase === 'frozen' || session.phase === 'delivered') {
              sessionIdRef.current = newComposerSessionId();
              setSessionEpoch((current) => current + 1);
              briefContextRevisionRef.current = null;
              briefInputRef.current = null;
              restoredFromServerRef.current = true;
              setSession((current) =>
                rebindComposerSession(current, sessionIdRef.current)
              );
            }
            setLensState(
              (current) =>
                applyRecommendationHandoffWithRecipe({
                  state: reopenComposer(current),
                  handoff,
                  surface: surfaceQuery.data,
                }).state
            );
            // #324: 爆款复刻 chip opens paste-track sourcing journey (no scrape).
            cancelViralOpenCliRead();
            if (handoff.recipeChipId === 'viral_adapt') {
              setViralAdaptJourney((current) =>
                startViralAdaptJourney(current)
              );
            } else {
              setViralAdaptJourney((current) =>
                current.phase === 'idle'
                  ? current
                  : cancelViralAdaptJourney(current)
              );
            }
          }}
          onRefresh={product.refresh}
          onStart={() => {
            // A completed run can still be leaving its mutation state while the
            // next-action card is already visible. Try now, then retry when that
            // pending state clears so the merchant never lands on an enabled but
            // unfocused prompt.
            focusIntentAfterPrefillRef.current = true;
            focusComposerIntentInput();
          }}
          state={product.state}
        />
      </section>

      {/* Activity Shelf — D-126. Collapsed with 建议行 in Active (P0-1). */}
      {!shelfCollapsed ? <DashboardContinueSection /> : null}
    </WorkbenchShellRoot>
  );
}
