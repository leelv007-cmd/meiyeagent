/**
 * Result Center product surface (WT-D1 / #99 + WT-D2 / #100 + WT-D3 / #101).
 *
 * Pure models + thin page shell + copy/image worksurfaces + delivery panel.
 * Does not own Result entities or history.
 */

export {
  createRecordingResultCommandPort,
  createResultCommandAdapter,
  isResultActionId,
  validateResultCommandInput,
  type ResultCommandPort,
  type ResultCommandAdapterOptions,
} from './result-command-adapter';

export {
  RESULT_CENTER_PATH_PATTERN,
  RESULT_CENTER_ROUTE_ID,
  buildResultCenterNavigation,
  navigateAfterSubmitSuccess,
  resultCenterLocationFromNavigation,
  resultTargetFromRoute,
  type ResultCenterLocation,
} from './result-center-navigation';

export {
  ResultCenterPage,
  anyCandidateHasToken,
  applyPageDriftChoice,
  factsForResolvedTarget,
  projectResultCenterPageView,
  projectShellOnly,
  type ResultCenterPageProps,
} from './result-center-page';

export {
  applyRevisionDriftChoice,
  buildReturnRestoreSnapshot,
  clearUncommittedDraft,
  detectRevisionDrift,
  emptyReturnRestoreStore,
  loadReturnRestoreSnapshot,
  loadUncommittedDraft,
  parseUncommittedEditKey,
  projectBrowserReturn,
  saveReturnRestoreSnapshot,
  saveUncommittedDraft,
  serializeUncommittedEditKey,
  type ApplyDriftResult,
  type ResultReturnRestoreStore,
} from './result-return-restore';

export {
  formatMerchantSupportReference,
  looksLikeInternalUuid,
} from './merchant-support-reference';

export {
  projectRevisionTimeline,
  revisionOperatorLabel,
  revisionSourceLabel,
  type RevisionTimelineEntry,
  type RevisionTimelineFacts,
  type RevisionTimelinePanelView,
  type RevisionTimelineRecoverAction,
  type RevisionTimelineVersionFact,
  type RevisionTimelineVersionSource,
} from './result-revision-timeline-model';

export {
  RevisionTimelinePanel,
  type RevisionTimelinePanelProps,
} from './result-revision-timeline-panel';

export {
  projectResultRunDetail,
  type ResultRunDetailFacts,
  type ResultRunDetailJobStatus,
  type ResultRunDetailPanelView,
  type ResultRunDetailStage,
  type ResultRunDetailStageState,
} from './result-run-detail-model';

export {
  ResultRunDetailPanel,
  type ResultRunDetailPanelProps,
} from './result-run-detail-panel';

export {
  RESULT_SHELL_PROJECTION_ONLY,
  desktopVisibleActions,
  mobileVisibleActions,
  projectResultShellActions,
  projectResultShellModel,
  projectResultShellPhase,
  projectResultShellView,
  shellViewFromResolveOutcome,
  type ResultShellDeliveryAttemptState,
  type ResultShellDeliveryCapability,
  type ResultShellFacts,
  type ResultShellHarnessPackage,
  type ResultShellProgressState,
  type ResultShellView,
} from './result-shell-model';

export {
  factSourcesFromGroundingSnapshot,
  revisionTimelineFactsFromContentPackage,
  runDetailFactsFromLiveSelection,
} from './result-live-projection';

export {
  parseResultCenterSearch,
  resolveResultTargetClient,
  resolveRouteResultTarget,
  isResultTargetForbidden,
  isResultTargetMissing,
  isResultTargetRecoverableMismatch,
  assertNoLatestResultFallback,
  type ClientResolveResultTargetInput,
  type ClientResolverLegacyPackage,
  type ClientResolverWorkRecord,
} from './result-target-wiring';

export {
  acceptWorkflowTokenDelta,
  calibrateTerminalRevision,
  candidateHasToken,
  copyCandidateSlots,
  projectResultTokenStream,
  projectTokenStreamA11y,
  projectTokenStreamReconnect,
  reduceExclusiveWorkflowTokens,
  tokenStreamFixtureSteps,
  type PartialCopyCandidate,
  type ResultTokenStreamCursor,
  type ResultTokenStreamInput,
  type ResultTokenStreamProjection,
  type ResultTokenStreamSlot,
  type ResultTokenStreamWorkspace,
  type WorkflowTokenDelta,
} from './result-token-stream';

// ---------------------------------------------------------------------------
// WT-D2 / #100 — copy/image_text + image worksurfaces
// ---------------------------------------------------------------------------

export { AdjustPrompt, type AdjustPromptProps } from './adjust-prompt';

export {
  ADJUST_PROMPT_PLACEHOLDER,
  ADJUST_PROMPT_SUBMIT_LABEL,
  COPY_MOBILE_P0_ACTIONS,
  COPY_PREVIEW_CARRIER_LABELS,
  applyCopyFieldEdit,
  SELECTION_AI_PRIMARY_ACTIONS,
  captureStableSelectionAnchor,
  createCopyDocumentDraft,
  hashSelectionAnchorParts,
  isClientConcatPlatformBody,
  previewSelectionRewrite,
  projectCopyImageTextWorksurface,
  projectCopyMobileP0Actions,
  projectDocumentWorksurface,
  projectFactSources,
  projectPlatformPreview,
  resolveSelectionAnchor,
  resolveSelectionRewrite,
  routeAdjustExecution,
  type AdjustExecutionPath,
  type CopyDocumentDraft,
  type CopyDocumentFields,
  type CopyImageTextWorksurfaceFacts,
  type CopyImageTextWorksurfaceView,
  type CopyPreviewCarrier,
  type DocumentCandidate,
  type DocumentWorksurfaceProjection,
  type FactSourceItem,
  type PlatformPreviewVariant,
  type SelectionRewriteAction,
  type SelectionRewriteCommand,
  type SelectionRewriteResolveResult,
  type StableSelectionAnchor,
} from './copy-image-text-worksurface-model';

export {
  CopyImageTextWorksurface,
  type CopyImageTextWorksurfaceProps,
} from './copy-image-text-worksurface';

export {
  IMAGE_ROLE_FEEDBACK,
  IMAGE_SET_MODE_THRESHOLD,
  defaultImageSetMode,
  imageA11yName,
  imageRoleFeedback,
  projectImageLibraryActions,
  projectImageRolePrimaryAction,
  toVisualAdoptionRoleAction,
  type ImageAdoptionLifecycle,
  type ImageAdoptionSlot,
  type ImageOutputType,
  type ImageRoleAction,
  type ImageRoleContext,
} from './image-role-action-matrix';

export {
  FORBIDDEN_DESKTOP_GATE_MESSAGES,
  IMAGE_MOBILE_P0_ACTIONS,
  buildCreateFromThisCommand,
  projectImageMobileP0Actions,
  projectImageWorksurface,
  type CreateFromThisCommand,
  type ImageCandidate,
  type ImageWorksurfaceFacts,
  type ImageWorksurfaceView,
} from './image-worksurface-model';

export {
  ImageWorksurface,
  type ImageWorksurfaceProps,
} from './image-worksurface';

export {
  WORKING_SELECTION_SURFACE_VERSION,
  WORKING_SELECTION_TTL_MS,
  applyWorkingSelectionDriftChoice,
  buildSaveWorkingSelectionDraftCommand,
  createEmptyWorkingSelection,
  isWorkingSelectionExpired,
  parseWorkingSelection,
  projectWorkingSelectionSlots,
  reduceWorkingSelection,
  serializeWorkingSelection,
  workingSelectionAdoptPayload,
  workingSelectionStorageKey,
  type SaveWorkingSelectionDraftCommand,
  type WorkingSelectionIntent,
  type WorkingSelectionState,
} from './working-selection-reducer';

export {
  assertNoPartialAdopt,
  buildWholeSetAdoptWriteCommand,
  validateWholeSetAdopt,
  type WholeSetAdoptValidation,
  type WholeSetAdoptWriteCommand,
} from './whole-set-adopt';

// ---------------------------------------------------------------------------
// Delivery panel (WT-D3 / #101) — consume B3 manifest + assisted receipt
// ---------------------------------------------------------------------------

export {
  ASSISTED_RECEIPT_STATUS_LABEL,
  ASSISTED_RECEIPT_STATUSES,
  ASSISTED_RESPONSIBILITY_ROLE_LABEL,
  ASSISTED_RESPONSIBILITY_ROLES,
  BEAUTY_DELIVERY_MANIFEST_SCHEMA,
  DELIVERY_MANIFEST_FILE_ROLES,
  DELIVERY_PANEL_TARGETS,
  DELIVERY_ZIP_PLATFORMS,
  ONE_SHOT_HANDOFF_LINK_TTL_MS,
  PENDING_CONFIRM_AFTER_MS,
  assertAssistedBindingComplete,
  isAssistedHandedOver,
  isAssistedPublished,
  type AssistedHandoffLink,
  type AssistedPublishResult,
  type AssistedReceipt,
  type AssistedReceiptBinding,
  type AssistedReceiptEvent,
  type AssistedReceiptStatus,
  type AssistedResponsibilityRole,
  type BeautyDeliveryManifestV1,
  type DeliveryManifestFileEntry,
  type DeliveryManifestFileRole,
  type DeliveryPackageKind,
  type DeliveryPanelTarget,
  type DeliveryZipPlatform,
} from './delivery-b3-types';

export {
  DELIVERY_ACTION_IDS,
  DELIVERY_ACTION_LABEL,
  DELIVERY_GROUP_IDS,
  DELIVERY_GROUP_LABEL,
  floorCapabilitiesEnabled,
  launchAutomaticVerifiedCount,
  projectDeliveryCapabilityGroups,
  visibleDeliveryGroups,
  type DeliveryActionId,
  type DeliveryActionProjection,
  type DeliveryCapabilityFacts,
  type DeliveryGroupId,
  type DeliveryGroupProjection,
} from './delivery-capability-groups';

export {
  buildCaptionText,
  buildDeliveryZipFileName,
  buildDouyinVideoPackage,
  buildWechatMomentsSegmentsPackage,
  buildXiaohongshuImageTextPackage,
  douyinVideoPackageFixture,
  formatDeliveryDateToken,
  recordFullPackageDownload,
  sanitizeDeliveryZipSegment,
  shortRevisionToken,
  wechatMomentsSegmentsFixture,
  xiaohongshuPackageFixture,
  type DeliveryPackageCaption,
  type DeliveryPackageModality,
  type FullPackageDownloadOutcome,
  type FullPackagePlan,
  type MomentsSegment,
} from './delivery-full-package';

export {
  recordShareAttempt,
  resolveShareDegrade,
  shareDegradeMatrixFixture,
  type ShareAttemptResult,
  type ShareDegradePlan,
  type ShareDeliveryRecord,
  type ShareDeviceCapability,
  type SharePayload,
  type ShareStrategy,
} from './delivery-share-degrade';

export {
  assistedResponsibilityRoleOptions,
  handedOverReceiptFixture,
  materialsReadyReceiptFixture,
  projectAssistedHandoffUi,
  projectPendingConfirm,
  type AssistedHandoffUiProjection,
  type AssistedRoleOption,
  type PendingConfirmProjection,
} from './delivery-assisted-model';

export {
  assertFourSectionParity,
  assertNotLegacyHandoffSource,
  canonicalHandoffFixture,
  projectCanonicalHandoffPage,
  resolveCanonicalHandoffByToken,
  type CanonicalDeliveryHandoff,
  type CanonicalHandoffCopyField,
  type CanonicalHandoffMedia,
  type CanonicalHandoffPageView,
  type CanonicalHandoffResolveResult,
  type CanonicalHandoffSectionId,
} from './delivery-handoff-canonical';

export {
  DELIVERY_OUTCOMES,
  DELIVERY_OUTCOME_ANNOUNCEMENT,
  DELIVERY_OUTCOME_FOCUS_ID,
  DELIVERY_OUTCOME_TESTID,
  allDeliveryOutcomeProjections,
  assertDistinctOutcomeAnnouncements,
  outcomeFromDeliveryEvent,
  projectDeliveryOutcome,
  type DeliveryOutcome,
  type DeliveryOutcomeProjection,
} from './delivery-outcomes-a11y';

export {
  launchDeliveryCapabilityDefaults,
  projectDeliveryPanel,
  type DeliveryPanelFacts,
  type DeliveryPanelView,
} from './delivery-panel-model';

export { DeliveryPanel, type DeliveryPanelProps } from './delivery-panel';

export {
  CanonicalHandoffPage,
  type CanonicalHandoffPageProps,
} from './canonical-handoff-page';

// P1-D/E close-loop pure models + UI shells (#156–#159)
export {
  DELIVERY_ACTION_RECEIPT_KINDS,
  DELIVERY_ACTION_RECEIPT_LABEL,
  dedupeDeliveryActionReceipts,
  deliveryActionReceiptIdempotencyKey,
  projectDeliveryActionReceiptPanel,
  projectShareAttemptReceipt,
  projectShareDegradeExplanations,
  receiptKindFromDeliveryEvent,
  type DeliveryActionReceiptBinding,
  type DeliveryActionReceiptFact,
  type DeliveryActionReceiptKind,
  type DeliveryActionReceiptPanelView,
  type DeliveryDegradeStep,
  type DeliveryShareAttemptInput,
  type DeliveryShareAttemptProjection,
} from './delivery-action-receipt-model';

export {
  PUBLICATION_LIFECYCLE_LABEL,
  PUBLICATION_LIFECYCLE_STATES,
  PUBLICATION_SOURCE_TIER_LABEL,
  PUBLICATION_SOURCE_TIERS,
  projectPublicationRecordPanel,
  publicationLifecycleFromDelivery,
  publicationRecordsFromDeliveryEvents,
  validateManualPublicationForm,
  type ManualPublicationFormInput,
  type ManualPublicationFormValidation,
  type PublicationLifecycleState,
  type PublicationRecordFact,
  type PublicationRecordPanelView,
  type PublicationSourceTier,
} from './publication-record-model';

export {
  PublicationRecordPanel,
  type PublicationRecordPanelProps,
} from './publication-record-panel';

export {
  OUTCOME_LADDER_STEP_LABEL,
  OUTCOME_LADDER_STEPS,
  OUTCOME_OBSERVATION_KIND_LABEL,
  OUTCOME_OBSERVATION_KINDS,
  OUTCOME_SOURCE_TIER_LABEL,
  OUTCOME_SOURCE_TIERS,
  activeOutcomeObservations,
  isUnsafeOutcomeNote,
  mapLegacyResultSignalKind,
  mapLegacyResultSignalSource,
  observationsFromResultSignals,
  projectOutcomeLadder,
  projectOutcomeObservationPanel,
  type OutcomeChipAction,
  type OutcomeLadderStepId,
  type OutcomeObservationFact,
  type OutcomeObservationKind,
  type OutcomeObservationPanelView,
  type OutcomeSourceTier,
} from './outcome-observation-model';

export {
  OutcomeChipsPanel,
  type OutcomeChipsPanelProps,
} from './outcome-chips-panel';

export {
  WEEKLY_NEXT_ACTIONS,
  WEEKLY_NEXT_ACTION_LABEL,
  confirmWeeklyRecommendation,
  projectWeeklyRecommendations,
  projectWeeklyReviewPanel,
  type WeeklyNextAction,
  type WeeklyNextRecommendation,
  type WeeklyReviewDecisionRecord,
  type WeeklyReviewFacts,
  type WeeklyReviewPackageFact,
  type WeeklyReviewPanelView,
  type WeeklySnapshotIntent,
} from './weekly-review-model';

export {
  WeeklyReviewPanel,
  type WeeklyReviewPanelProps,
} from './weekly-review-panel';
