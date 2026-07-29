/**
 * Composer product surface (WT-C / #95 + #96 + #97 + #98 + Z1 / #105 host).
 *
 * Pure models + thin components + ComposerHome host (cutover mount point).
 *
 * #96: six-card grid, RecipePatchPreview surface, apply tip,
 * T1 brief chips re-hang (no expand-four-card path).
 * #97: mobile two-col layout, fullscreen dual-tab catalog, single bottom sheet,
 * home tools strip + Pro Studio gate, typed ToolHandoff.
 * #98: conditional Brief surface + GL-23 quota blocking card with inline redeem.
 * #105: ComposerHome is the dashboard primary creation entry; legacy
 * T6 scene chips / ?workId= bridge retired.
 */

export { ComposerHome, type ComposerHomeProps } from './composer-home';

export {
  FORBIDDEN_BROWSER_COMPOSER_KEYS,
  findForbiddenBrowserComposerKey,
  projectBrowserComposerPayload,
  serializeBrowserComposerPayload,
} from './browser-contract';

export {
  COMPOSER_LENS_LABELS,
  COMPOSER_LENS_OPTIONS,
  LENS_GROUP_LABEL,
  LENS_REQUIRED_SUBMIT_HINT,
  lensLabel,
} from './lens-labels';

export {
  PROTECTED_FIELD_KEYS,
  bindQuoteSnapshotRevision,
  bindQuoteView,
  buildLensSwitchPreview,
  canSubmit,
  cancelSwitch,
  confirmSwitch,
  createComposerLensState,
  defaultSettingsForLens,
  emptyComposerDraft,
  emptyComposerSettings,
  lensStateView,
  requestSwitchLens,
  selectLens,
  submitComposer,
  switchRequiresConfirmation,
  undoChange,
  updateAssetRights,
  updateDeliverySuggestion,
  updateSelectedTools,
  updateSettings,
  updateSources,
  updateUserText,
  videoConfirmForState,
  type ComposerDraft,
  type ComposerLensPhase,
  type ComposerLensState,
  type ComposerSettings,
  type ConflictAction,
  type ConflictDiff,
  type DeliverySuggestion,
  type FieldMeta,
  type FieldOwnership,
  type FrozenRevisions,
  type LensSelectionSource,
  type ProtectedFieldKey,
  type SelectedState,
  type SettingsPatch,
  type SwitchPreview,
  type SwitchPreviewState,
  type UndoEntry,
  type UnselectedState,
  type FrozenState,
} from './lens-state-machine';

export { LensRadiogroup, type LensRadiogroupProps } from './lens-radiogroup';

export {
  assertSettingsRowContract,
  buildDynamicSettingsRow,
  type CatalogModelOption,
  type DynamicSettingsFieldValue,
  type DynamicSettingsRowInput,
  type SettingsFieldDef,
  type SettingsFieldKey,
  type SettingsFieldKind,
} from './settings-row';

export {
  buildComposerQuote,
  composerRequestFromBuildInput,
  composeQuoteRevision,
  confirmQuotePrice,
  projectComposerQuoteView,
  requoteOnParamChange,
  serializeComposerQuoteForBrowser,
  type ComposerQuoteRequest,
  type ComposerQuoteView,
} from './quote-wiring';

export {
  buildVideoConfirmZone,
  evaluateSubmitGate,
  type SubmitGateResult,
  type VideoConfirmZone,
} from './video-confirm-zone';

// —— #96 six cards + RecipePatchPreview ——
export {
  CTA_APPLY_AND_UPDATE_SETTINGS,
  CTA_CANCEL,
  COLD_CARD_TITLES,
  LAUNCH_CARD_SEEDS,
  P0_CARD_CAP,
  REUSE_CONTENT_ACTION_LABEL,
  REUSE_CONTENT_FAMILY_ID,
  REUSE_INCOMPLETE_CTA,
  UNDO_LABEL,
  actionLabelForLens,
  appliedTipLabel,
  browserRecipeToTarget,
  ctaSwitchToLensAndApply,
  seedToRecipeTarget,
  switchedTipLabel,
  type LaunchCardSeedSpec,
  type RecipeCardTarget,
} from './launch-card-seeds';

export {
  listColdCardsFromRecipes,
  listColdCardsFromSeeds,
  listColdCardsFromSurface,
  listP0CardsForLens,
  listVisibleRecipeCards,
  type RecipeCardKind,
  type RecipeCardView,
} from './recipe-cards';

export {
  buildClientRecipePatchPreview,
  composerDraftToRecipeFields,
  type BuildClientPatchPreviewInput,
} from './recipe-patch-preview-client';

export {
  FORBIDDEN_APPLY_SIDE_EFFECTS,
  applyRecipeToLensState,
  assertZeroBusinessWrites,
  bindLensState,
  cancelApply,
  clearAnnouncement,
  confirmApply,
  createRecipeApplySession,
  firstMissingInput,
  listMissingRequiredInputs,
  requestApplyRecipe,
  undoApply,
  type ForbiddenApplySideEffect,
  type MissingInputFocus,
  type RecipeApplyPhase,
  type RecipeApplySession,
  type RequestApplyResult,
} from './recipe-apply';

export { RecipePillRow, type RecipePillRowProps } from './recipe-pill-row';

export {
  MARKETING_TASK_ORDER,
  groupRecipeCardsByMarketingTask,
  marketingTaskForCard,
  type MarketingTaskGroup,
  type MarketingTaskId,
} from './recipe-marketing-groups';

export {
  RecipePatchPreviewSurface,
  type RecipePatchPreviewSurfaceProps,
} from './recipe-patch-preview-surface';

export {
  RecipeApplyTip,
  type RecipeApplyTipProps,
} from './recipe-apply-tip';

/*
 * `ComposerBriefChips` is gone (U04 裁决). It was hung on this panel with no
 * producer behind it — the production mount never passed a `brief`, so it
 * rendered null on every run since the day it landed — and the question it
 * answered（「本次将使用」）is answered on the same surface by the conditional
 * Brief surface (D-094), which composer-home actually drives. Two answers to
 * one question, one of them永远沉默, is the case D-150 calls 未完成.
 */

export {
  RecipeCardsPanel,
  type RecipeCardsPanelProps,
} from './recipe-cards-panel';

// —— #98 conditional Brief + GL-23 ——
export {
  BRIEF_TRIGGER_CODES,
  briefStaleQuoteNotice,
  buildBriefSummaryRows,
  cancelBriefSurface,
  confirmBriefSurface,
  createBriefSurfaceState,
  decideSubmitPath,
  openBriefSurface,
  projectBriefSurfaceView,
  projectEvidenceForBrowser,
  serializeBriefSurfaceForBrowser,
  setBriefVideoConfirmAccepted,
  shouldShowEvidenceDrawer,
  type BriefSurfacePhase,
  type BriefSurfaceState,
  type BriefSurfaceView,
  type BriefSummaryFieldKey,
  type BriefSummaryRow,
  type ComposerInputSnapshot,
  type SubmitPathDecision,
} from './brief-surface';

export {
  BriefSurface,
  type BriefSurfaceProps,
} from './brief-surface-panel';

export {
  QUOTA_BLOCK_CODE_LABEL,
  QUOTA_BLOCK_CODE_PLACEHOLDER,
  QUOTA_BLOCK_CONTACT_LABEL,
  QUOTA_BLOCK_DESCRIPTION,
  QUOTA_BLOCK_FAILED_LABEL,
  QUOTA_BLOCK_SUBMIT_LABEL,
  QUOTA_BLOCK_SUCCESS_LABEL,
  QUOTA_BLOCK_TITLE,
  beginQuotaRedeem,
  buildQuotaRedeemCommand,
  completeQuotaRedeem,
  composerQuotaRequirements,
  createQuotaBlockingState,
  dismissQuotaUnlock,
  isQuotaRedeemCodeValid,
  projectQuotaBlockingView,
  projectQuotaPassiveView,
  quotaShortNotice,
  setQuotaRedeemCode,
  showQuotaBlocking,
  type ComposerQuotaResource,
  type QuotaBlockingState,
  type QuotaBlockingView,
  type QuotaPassiveView,
  type QuotaRedeemStatus,
  type QuotaRequirement,
} from './quota-blocking';

export {
  QuotaBlockingCard,
  type QuotaBlockingCardProps,
} from './quota-blocking-card';

// —— #97 mobile + fullscreen catalog + tool entry ——
export {
  COMPOSER_CARD_TEXT_CLASS,
  COMPOSER_SINGLE_COLUMN_MAX_WIDTH,
  COMPOSER_VIEWPORT_FIXTURES,
  isTwoColumnMobileViewport,
  resolveComposerCardGridLayout,
  type ComposerCardGridLayout,
  type ComposerViewport,
} from './mobile-layout';

export {
  COMPOSER_CATALOG_PATH,
  COMPOSER_HOME_PATH,
  PRO_STUDIO_CANONICAL_PATH,
  buildComposerCatalogHref,
  parseComposerCatalogSearch,
  type ComposerCatalogSearchParams,
} from './composer-nav';

export {
  FORBIDDEN_TOOL_HANDOFF_KEYS,
  STANDALONE_TOOL_ENTRY_IDS,
  TOOL_HANDOFF_ALLOWED_KEYS,
  TOOL_HANDOFF_FORBIDDEN_WRITES,
  TOOL_SOURCE_KINDS,
  assertToolHandoffUrlSafe,
  buildToolOpenHref,
  findForbiddenToolHandoffKey,
  openToolWithHandoff,
  parseToolHandoffFromSearchParams,
  projectToolHandoff,
  returnFromToolHandoff,
  serializeToolHandoffToSearchParams,
  type StandaloneToolEntryId,
  type ToolHandoff,
  type ToolHandoffAllowedKey,
  type ToolHandoffOpenResult,
  type ToolHandoffValidation,
  type ToolHandoffWriteKind,
  type ToolSourceKind,
} from './tool-handoff';

export {
  COMPOSER_TOOL_ENTRY_SEEDS,
  TOOL_CATALOG_CATEGORIES,
  TOOL_CATALOG_CATEGORY_LABELS,
  getComposerToolEntrySeed,
  listComposerToolEntrySeeds,
  type ComposerToolEntrySeed,
  type ToolCatalogCategory,
} from './tool-entry-seeds';

export {
  ORDINARY_TOOL_CAP,
  assertProStudioCanonicalHref,
  listOrdinaryHomeTools,
  openComposerTool,
  projectComposerToolsStrip,
  projectProStudioBanner,
  type ComposerToolChipView,
  type ComposerToolsStripInput,
  type ComposerToolsStripView,
  type ComposerViewportKind,
  type ProStudioBannerView,
} from './composer-tools';

export {
  ComposerToolsStrip,
  type ComposerToolsStripProps,
} from './composer-tools-strip';

export {
  CATALOG_SEARCH_GATE,
  CATALOG_TABS,
  CATALOG_TAB_LABELS,
  TEMPLATE_CATALOG_CATEGORIES,
  TEMPLATE_CATALOG_CATEGORY_LABELS,
  VIEW_ALL_TEMPLATES_LABEL,
  VIEW_ALL_TOOLS_LABEL,
  buildViewAllTemplatesHref,
  buildViewAllToolsHref,
  captureCatalogReturnSnapshot,
  catalogStateFromSearch,
  catalogStateToHref,
  countPublishedVisible,
  createCatalogUiState,
  filterCatalogItems,
  listCatalogItems,
  listCategoriesForTab,
  projectFullscreenCatalogView,
  restoreCatalogUiState,
  setCatalogCategory,
  setCatalogFocus,
  setCatalogQuery,
  setCatalogScroll,
  setCatalogTab,
  shouldShowCatalogSearch,
  type CatalogItemKind,
  type CatalogItemSource,
  type CatalogItemView,
  type CatalogReturnRestoreSnapshot,
  type CatalogTab,
  type CatalogUiState,
  type FullscreenCatalogView,
  type TemplateCatalogCategory,
} from './fullscreen-catalog';

export {
  FullscreenCatalogPanel,
  type FullscreenCatalogPanelProps,
} from './fullscreen-catalog-panel';

export {
  COMPOSER_SHEET_KINDS,
  assertSingleSheetMutex,
  createComposerBottomSheetState,
  dismissComposerSheet,
  isComposerSheetOpen,
  openComposerSheet,
  sheetKindForApplyPhase,
  syncSheetWithApplyPhase,
  type ComposerBottomSheetState,
  type ComposerSheetKind,
  type ComposerSheetRestoreSnapshot,
  type OpenSheetInput,
} from './composer-bottom-sheet';

export {
  ComposerBottomSheet,
  type ComposerBottomSheetProps,
} from './composer-bottom-sheet-ui';
