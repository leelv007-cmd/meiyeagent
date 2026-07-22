import type {
  ContentPackage,
  CreativeGenerationApprovalReceipt,
  PromotionalMaterialReceipt,
  PromotionalMaterialSpec,
  VideoCompositionEvidence,
} from '@meiye/contracts';

export type OperationActor =
  | 'owner'
  | 'operator'
  | 'reviewer'
  | 'admin'
  | 'worker';

export interface OperationContext {
  actor: OperationActor;
  correlationId: string;
  userId: string;
  workspaceId: string;
}

export type ContentTaskStatus =
  | 'todo'
  | 'in_progress'
  | 'needs_review'
  | 'needs_asset'
  | 'blocked'
  | 'ready'
  | 'done'
  | 'archived';

export type ContentTaskSource =
  | 'weekly_batch'
  | 'asset_gap'
  | 'stale_draft'
  | 'weekly_review'
  | 'publish_ready'
  | 'manual';

export type TaskRisk = 'normal' | 'attention' | 'external_permission';

export interface RelatedObject {
  id: string;
  kind:
    | 'asset'
    | 'content'
    | 'integration'
    | 'publication'
    | 'review'
    | 'template'
    | 'work';
}

export interface ContentTask {
  id: string;
  workspaceId: string;
  title: string;
  source: ContentTaskSource;
  risk: TaskRisk;
  status: ContentTaskStatus;
  dueAt: string;
  relatedObject?: RelatedObject;
  executable: boolean;
  blockedReason?: string;
  nextStep?: string;
  dedupeKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskEvent {
  id: string;
  workspaceId: string;
  taskId: string;
  actorId: string;
  correlationId: string;
  event:
    | 'created'
    | 'status_changed'
    | 'notification_sent'
    | 'notification_failed'
    | 'execution_claimed'
    | 'execution_completed'
    | 'execution_failed'
    | 'confirmation_requested'
    | 'confirmation_confirmed';
  fromStatus?: ContentTaskStatus;
  toStatus?: ContentTaskStatus;
  reason?: string;
  createdAt: string;
}

export interface TaskSourceLink {
  id: string;
  workspaceId: string;
  taskId: string;
  sourceId: string;
  sourceKind: RelatedObject['kind'] | 'trigger';
  createdAt: string;
}

export interface CreateTaskInput {
  title: string;
  source: ContentTaskSource;
  risk: TaskRisk;
  dueAt: string;
  relatedObject?: RelatedObject;
  executable: boolean;
  blockedReason?: string;
  nextStep?: string;
  dedupeKey?: string;
}

export interface TaskFilter {
  statuses?: ContentTaskStatus[];
  sources?: ContentTaskSource[];
  risks?: TaskRisk[];
  relatedObject?: RelatedObject;
  relatedKinds?: RelatedObject['kind'][];
  from?: string;
  to?: string;
}

export interface WeekStripDay {
  date: string;
  taskCount: number;
  contentGapCount: number;
  statuses: ContentTaskStatus[];
}

export interface InboxProjection {
  tasks: ContentTask[];
  weekStrip: WeekStripDay[];
  counts: Partial<Record<ContentTaskStatus, number>>;
  renderSeam: 'inline-task-components';
}

export type BuiltInTriggerKind =
  | 'weekly_batch_ready'
  | 'asset_gap_detected'
  | 'stale_draft_detected'
  | 'weekly_review_ready';

export interface TriggerConfig {
  kind: BuiltInTriggerKind;
  enabled: boolean;
  updatedAt: string;
  updatedBy: string;
  scheduleId?: string;
  scheduleStatus?: 'scheduled' | 'unscheduled' | 'not_configured' | 'failed';
  scheduleError?: string;
}

export interface TriggerRun {
  id: string;
  workspaceId: string;
  kind: BuiltInTriggerKind;
  timeWindow: string;
  taskId?: string;
  status: 'created' | 'deduplicated' | 'disabled' | 'failed';
  notificationStatus?: 'sent' | 'failed';
  error?: string;
  jobId?: string;
  createdAt: string;
}

export interface TriggerMetrics {
  totalRuns: number;
  created: number;
  deduplicated: number;
  disabled: number;
  failed: number;
  notificationsSent: number;
  notificationsFailed: number;
  lastRunAt?: string;
  byKind: Partial<Record<BuiltInTriggerKind, number>>;
}

export interface TriggerSchedulePort {
  /** Implementations must upsert idempotently by scheduleId. */
  scheduleRecurring(input: {
    scheduleId: string;
    workspaceId: string;
    kind: 'operations.trigger';
    cron: string;
    timezone: string;
    payload: {
      triggerKind: BuiltInTriggerKind;
    };
  }): Promise<void>;
  unscheduleRecurring(workspaceId: string, scheduleId: string): Promise<void>;
}

export interface TriggerInput {
  kind: BuiltInTriggerKind;
  timeWindow: string;
  sourceId: string;
}

export interface TaskNotification {
  /** Implementations must make delivery idempotent by this key. */
  idempotencyKey: string;
  workspaceId: string;
  taskId: string;
  title: string;
  nextStep?: string;
}

export interface NotificationPort {
  send(notification: TaskNotification): Promise<void>;
}

export interface WeeklyBatch {
  from: string;
  to: string;
  included: ContentTask[];
  excluded: Array<ContentTask & { reason: string }>;
}

export type WeeklyBatchAction =
  | 'create'
  | 'revise'
  | 'apply_template'
  | 'prepare_draft';

export interface BatchExecutionRequest {
  action: WeeklyBatchAction;
  actorId: string;
  attempt: number;
  correlationId: string;
  executionId: string;
  task: ContentTask;
  workspaceId: string;
}

export interface BatchExecutionOutput {
  artifactId: string;
  artifactKind: 'content' | 'draft' | 'work';
  metadata?: Record<string, string>;
}

export type BatchExecutionResult =
  | { status: 'completed'; output: BatchExecutionOutput }
  | {
      status: 'failed';
      errorCode: string;
      errorMessage: string;
      retryable: boolean;
    };

export interface BatchExecutionPort {
  /**
   * Implementations must make the external effect idempotent by executionId.
   * A recovered lease may call execute again with the same executionId.
   */
  execute(request: BatchExecutionRequest): Promise<BatchExecutionResult>;
}

export interface WeeklyBatchExecution {
  id: string;
  workspaceId: string;
  taskId: string;
  action: WeeklyBatchAction;
  attempt: number;
  status: 'claimed' | 'completed' | 'failed';
  actorId: string;
  correlationId: string;
  claimedAt: string;
  leaseToken: string;
  leaseExpiresAt?: string;
  recoveredAt?: string;
  completedAt?: string;
  output?: BatchExecutionOutput;
  errorCode?: string;
  errorMessage?: string;
  retryable?: boolean;
}

export type WeeklyFactKind =
  | 'planned'
  | 'drafted'
  | 'confirmed'
  | 'published_mark'
  | 'asset_gap'
  | 'human_lead';

export interface WeeklyFact {
  id: string;
  workspaceId: string;
  kind: WeeklyFactKind;
  sourceId: string;
  occurredAt: string;
  createdAt: string;
  origin: 'automatic' | 'trusted';
  correlationId: string;
}

export type KnownMetric =
  | { status: 'known'; value: number }
  | { status: 'unknown' };

export interface WeeklyCandidate {
  id: string;
  title: string;
  sourceReviewId: string;
  status: 'pending_confirmation' | 'confirmed' | 'dismissed';
}

export interface WeeklyReview {
  id: string;
  workspaceId: string;
  from: string;
  to: string;
  metrics: {
    planned: KnownMetric;
    drafted: KnownMetric;
    confirmed: KnownMetric;
    published: KnownMetric;
    assetGaps: KnownMetric;
    humanLeads: KnownMetric;
  };
  nextWeekCandidates: WeeklyCandidate[];
  createdAt: string;
}

/** Seven families are seeded at launch; admins may add later families. */
export type TemplateFamily = string;

export type RevisionStatus = 'draft' | 'enabled' | 'published' | 'retired';

export interface CanvasTextElement {
  id: string;
  kind: 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  text: string;
  fill?: string;
  fontFamily?: string;
  fontSize?: number;
  opacity?: number;
}

export interface CanvasImageElement {
  id: string;
  kind: 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  assetId: string;
  src?: string;
  opacity?: number;
  sourceJobId?: string;
}

export type CanvasElement = CanvasTextElement | CanvasImageElement;

export interface CanvasPage {
  id: string;
  elements: CanvasElement[];
}

export interface CanvasDocument {
  width: number;
  height: number;
  pages: CanvasPage[];
}

export interface OfficialTemplate {
  id: string;
  family: TemplateFamily;
  name: string;
  tags: string[];
  publicationStatus: RevisionStatus;
  enabledVersionId?: string;
  enabledAt?: string;
  publishedVersionId?: string;
  publishedAt?: string;
  rolloutPercent?: number;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateVersion {
  id: string;
  templateId: string;
  revision: number;
  status: RevisionStatus;
  document: CanvasDocument;
  rolloutPercent: number;
  createdAt: string;
  createdBy: string;
  publishedAt?: string;
}

export interface TemplateVersionLifecycleEvent {
  id: string;
  templateId: string;
  versionId: string;
  action: 'enabled' | 'published' | 'retired';
  rolloutPercent: number;
  sequence: number;
  occurredAt: string;
  actorId: string;
  correlationId: string;
  reason?: string;
}

export interface TemplateCatalogState {
  templates: OfficialTemplate[];
  versions: TemplateVersion[];
  versionLifecycle: TemplateVersionLifecycleEvent[];
  commandReceipts: OperationsCommandReceipt[];
}

export interface TemplateVersionHistory
  extends Omit<TemplateVersion, 'document'> {
  lifecycle: TemplateVersionLifecycleEvent[];
  publishedBy?: string;
  publishCorrelationId?: string;
  retiredAt?: string;
  retiredBy?: string;
  retireCorrelationId?: string;
  documentSummary: {
    elementCount: number;
    height: number;
    pageCount: number;
    width: number;
  };
}

export interface TemplateCatalogHistory {
  workspaceId: string;
  templates: OfficialTemplate[];
  versions: TemplateVersionHistory[];
}

export interface CanvasRevision {
  id: string;
  workId: string;
  revision: number;
  document: CanvasDocument;
  templateVersionId?: string;
  createdAt: string;
  createdBy: string;
}

export interface CanvasWork {
  id: string;
  workspaceId: string;
  name: string;
  templateId?: string;
  templateVersionId?: string;
  userTemplateId?: string;
  sourceContentPackageId?: string;
  sourceContentPackageVersionId?: string;
  sourceWorkId?: string;
  currentRevisionId: string;
  revisions: CanvasRevision[];
  brandWatermarkEnabled: boolean;
  aigcLabelEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CreativeOperation = import('@meiye/contracts').CreativeOperation;

export type CreativeContentModuleId =
  | 'social_cover'
  | 'before_after'
  | 'price_card'
  | 'package_explainer'
  | 'review_card'
  | 'store_intro'
  | 'shooting_checklist';

export type CreativeInheritanceFieldId =
  | 'content_structure'
  | 'layout_slots'
  | 'copy_skeleton'
  | 'output_specification'
  | 'visual_style';

export interface CreativeSourceReference {
  id: string;
  kind: 'task' | 'asset' | 'content' | 'template' | 'work';
  inheritanceFields?: CreativeInheritanceFieldId[];
}

export type CreativeInheritanceFact =
  | {
      field: 'content_structure';
      assetKind?: CreativeAssetProjection['kind'];
      contentModules?: CreativeContentModuleId[];
      pageCount?: number;
    }
  | {
      field: 'layout_slots';
      mediaSlotCount?: number;
      moduleSlotCount?: number;
      pageCount?: number;
      textSlotCount?: number;
    }
  | {
      field: 'copy_skeleton';
      contentModuleOrder?: CreativeContentModuleId[];
      emphasisLevelCount?: number;
      hasConversionHook?: boolean;
      textSlotCount?: number;
    }
  | {
      field: 'output_specification';
      aspectRatio?: CreativeExecutionContract['aspectRatio'];
      assetKind?: CreativeAssetProjection['kind'];
      durationSeconds?: number;
      height?: number;
      operation?: CreativeOperation;
      outputCount?: number;
      pageCount?: number;
      width?: number;
    }
  | {
      field: 'visual_style';
      colors: string[];
      fontFamilies: string[];
    };

export interface CreativeInheritanceSourceProjection {
  facts: CreativeInheritanceFact[];
  kind: Extract<CreativeSourceReference['kind'], 'asset' | 'template' | 'work'>;
}

/**
 * Server-derived structural facts only. Source IDs, copy, media locations and
 * business metadata must never cross this execution boundary.
 */
export interface CreativeInheritanceContext {
  sources: CreativeInheritanceSourceProjection[];
}

export interface CreativeExecutionContract {
  operation: CreativeOperation;
  catalogModelId: string;
  catalogRevision: string;
  quoteRevision: string;
  quoteAcceptedAt: string;
  outputLabel: string;
  estimatedAmount: number;
  currency: string;
  outputCount: number;
  aspectRatio?: '1:1' | '3:4' | '9:16';
  durationSeconds?: number;
  dataClass: Array<'contains_face' | 'pii' | 'medical'>;
  watermarkEnabled: boolean;
  aigcLabelEnabled: boolean;
  /** Missing only on historical jobs created before content suites shipped. */
  contentModules?: CreativeContentModuleId[];
}

export type CreativeJobStatus =
  | 'submitting'
  | 'running'
  | 'recoverable'
  | 'unknown'
  | 'completed'
  | 'failed';

export type CreativeRerollKind = 'paid' | 'quality';

export type CreativeBriefFieldId = 'intent' | 'scene' | 'tone' | 'audience';

export interface CreativeBriefField {
  aiDraft?: string;
  current: string;
  owner: 'ai' | 'merchant';
}

export interface CreativeBrief {
  fields: Partial<Record<CreativeBriefFieldId, CreativeBriefField>>;
  confirmedAt?: string;
  updatedAt: string;
}

export type CreativeBriefUpdate =
  | {
      action: 'adopt';
      aiDraft: string;
      field: CreativeBriefFieldId;
    }
  | {
      action: 'edit';
      current: string;
      field: CreativeBriefFieldId;
    }
  | {
      action: 'revert';
      field: CreativeBriefFieldId;
    };

export interface CreativeGroundingSnapshot {
  capturedAt: string;
  store: {
    name: string;
    city: string;
    district: string;
    address: string;
    booking: string;
    brandVoice: string;
    prohibitions: string[];
    regulated: boolean;
    confirmedAt: string;
    projects: Array<{
      id: string;
      name: string;
      price: number;
      durationMinutes: number;
    }>;
  };
  qualification?: {
    admitted: boolean;
    institutionLicense?: string;
    treatmentScope?: string;
    platformCertification?: string;
    advertisingCertificate?: string;
    validUntil?: string;
    intakeAt?: string;
    confirmed: true;
  };
  assets: Array<{
    id: string;
    sourceType: 'real';
    category?: 'store' | 'before_after' | 'customer_case' | 'price_list' | 'other';
    tags: string[];
    consentScope: 'internal_only' | 'public_marketing' | 'paid_advertising';
    containsPerson: boolean;
    containsSensitiveData: boolean;
    minorStatus: 'none' | 'minor';
    authorizationStatus: 'authorized';
    rightsEvidenceRecorded: boolean;
  }>;
}

export type CreativeGroundingMissingFact =
  | 'confirmed_store'
  | 'confirmed_project'
  | 'confirmed_qualification'
  | 'real_authorized_asset';

export type CreativeGroundingResolution =
  | { status: 'ready'; snapshot: CreativeGroundingSnapshot }
  | { status: 'missing'; missing: CreativeGroundingMissingFact[] };

export interface CreativeWork {
  id: string;
  workspaceId: string;
  sessionId: string;
  intent: string;
  mode: 'agent' | 'direct';
  /** Missing only on historical rows created before composer mode persistence. */
  operation?: CreativeOperation;
  sourceReferences: CreativeSourceReference[];
  /** Missing only on historical rows created before content suites shipped. */
  contentModules?: CreativeContentModuleId[];
  /** Missing only on historical rows and drafts not yet compiled by AI. */
  brief?: CreativeBrief;
  /** Conditional Brief gate binding for server-side submit validation. */
  briefContextId?: string;
  /** Exact server Brief context revision atomically checked with Work creation. */
  briefContextRevision?: number;
  briefConfirmationId?: string;
  status: 'draft' | 'running' | 'completed' | 'accepted' | 'failed';
  currentJobId?: string;
  derivedFrom?: string;
  workingSelectionDraft?: {
    baseRevisionId: string;
    orderedAssetIds: string[];
    coverAssetId: string | null;
    surfaceVersion: string;
    revision: number;
    savedAt: string;
    savedBy: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CreativeJob {
  id: string;
  workspaceId: string;
  workId: string;
  status: CreativeJobStatus;
  contract: CreativeExecutionContract;
  /** ProductBilling task; paid rerolls use their new Job id, never the Work id. */
  billingTaskId?: string;
  /** Fresh ProductQuote required by a paid reroll. */
  billingQuoteId?: string;
  submissionKey: string;
  providerJobId?: string;
  routeSnapshotId?: string;
  /** Frozen execution facts copied from the RouteSnapshot that produced this Job. */
  executionProvenance?: CreativeExecutionProvenance;
  outputAssetIds: string[];
  outputContentIds: string[];
  /** Missing only on historical jobs created before candidate batches shipped. */
  batchRootJobId?: string;
  /** Missing only on historical jobs created before candidate batches shipped. */
  batchNumber?: number;
  retryOf?: string;
  rerollOf?: string;
  rerollKind?: CreativeRerollKind;
  /** Missing only on historical jobs created before quality retry accounting shipped. */
  qualityRetryNumber?: number;
  /** Missing only on historical jobs; new jobs always persist the billed Product usage. */
  productUsageQuantity?: 0 | 1;
  /** Missing only on historical jobs created before safe inheritance snapshots shipped. */
  inheritanceContext?: CreativeInheritanceContext;
  /** Frozen at first submission and reused by technical retries and rerolls. */
  briefSnapshot?: CreativeBrief;
  /** Exact server Brief context revision atomically checked with Job creation. */
  briefContextRevision?: number;
  /** Confirmed Product facts and authorized source Assets frozen at submission. */
  groundingSnapshot?: CreativeGroundingSnapshot;
  failureCode?: string;
  recoveredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreativeExecutionProvenance {
  actualCatalogModelId: string;
  modelDisplayName?: string;
  providerModel?: string;
  apiCounterparty?: string;
  activationStatus?: 'documented' | 'recorded' | 'live_verified';
}

export interface CreativeAssetProjection {
  id: string;
  workspaceId: string;
  workId: string;
  jobId: string;
  kind: 'text' | 'image' | 'video' | 'audio';
  title: string;
  body?: string;
  /** Stable zero-based order for copy candidates; absent on historical and media Assets. */
  candidateIndex?: number;
  conversionHook?: string;
  ownedAssetId?: string;
  objectKey?: string;
  contentType?:
    | 'image/png'
    | 'video/mp4'
    | 'audio/mpeg'
    | 'audio/wav'
    | 'audio/ogg'
    | 'audio/mp4';
  sha256?: string;
  sizeBytes?: number;
  compositionEvidence?: VideoCompositionEvidence;
  savedToLibraryAt?: string;
  savedToLibraryBy?: string;
  libraryRevisionId?: string;
  createdAt: string;
}

export interface CreativeContent {
  id: string;
  workspaceId: string;
  workId: string;
  jobId: string;
  title: string;
  body: string;
  assetIds: string[];
  status: 'accepted';
  createdAt: string;
  acceptedAt?: string;
}

export type CreationActivationEventType =
  | 'first_work_created'
  | 'first_job_submitted'
  | 'first_assets_visible'
  | 'first_content_accepted'
  | 'first_content_package_created'
  | 'cold_start_skipped';

export interface CreationActivationEvent {
  id: string;
  workspaceId: string;
  correlationId: string;
  schemaVersion: 'uiux-activation-v1';
  type: CreationActivationEventType;
  workId?: string;
  jobId?: string;
  assetId?: string;
  contentId?: string;
  contentPackageId?: string;
  createdAt: string;
}

export interface CreationExecutionResult {
  status: 'running' | 'completed' | 'recoverable' | 'unknown' | 'failed';
  providerJobId: string;
  routeSnapshotId: string;
  executionProvenance?: CreativeExecutionProvenance;
  retryable?: boolean;
  failureCode?: string;
  asset?: {
    id: string;
    objectKey: string;
    contentType:
      | 'image/png'
      | 'video/mp4'
      | 'audio/mpeg'
      | 'audio/wav'
      | 'audio/ogg'
      | 'audio/mp4';
    sha256: string;
    sizeBytes?: number;
    compositionEvidence?: VideoCompositionEvidence;
  };
  copyCandidates?: Array<{
    title: string;
    body: string;
    conversionHook?: string;
  }>;
  platformVariants?: import('@meiye/contracts').GeneratedPlatformVariants;
  productUsage?: {
    quantity: number;
    status: 'reserved' | 'committed' | 'refunded';
  };
  providerCost?: {
    amount: number;
    currency: 'CNY' | 'USD';
    status: 'estimated' | 'observed';
  };
}

export interface CreationExecutorPort {
  inspect(
    workspaceId: string,
    contract: CreativeExecutionContract,
    authority?: AcceptedProductQuoteInspectionAuthority,
  ): Promise<void>;
  submit(input: {
    context: OperationContext;
    contract: CreativeExecutionContract;
    briefSnapshot?: CreativeBrief;
    groundingSnapshot?: CreativeGroundingSnapshot;
    inheritanceContext?: CreativeInheritanceContext;
    intent: string;
    workId?: string;
    idempotencyKey: string;
    billingTaskId?: string;
    billingQuoteRevision?: string;
    productUsageQuantity: 0 | 1;
  }): Promise<CreationExecutionResult>;
  startCopyStream?(input: {
    context: OperationContext;
    contract: CreativeExecutionContract;
    briefSnapshot?: CreativeBrief;
    groundingSnapshot?: CreativeGroundingSnapshot;
    inheritanceContext?: CreativeInheritanceContext;
    intent: string;
    idempotencyKey: string;
    billingTaskId?: string;
    billingQuoteRevision?: string;
    productUsageQuantity: 0 | 1;
    abortSignal?: AbortSignal;
  }): Promise<{
    response: Response;
    completion: Promise<CreationExecutionResult>;
  }>;
  verify(input: {
    context: OperationContext;
    contract: CreativeExecutionContract;
    providerJobId: string;
    routeSnapshotId: string;
  }): Promise<CreationExecutionResult>;
  cancel?(input: {
    context: OperationContext;
    contract: CreativeExecutionContract;
    providerJobId: string;
  }): Promise<CreationExecutionResult>;
  recordReroll?(input: {
    context: OperationContext;
    contract: CreativeExecutionContract;
    rerollKind: CreativeRerollKind;
    targetJobId: string;
  }): Promise<void>;
}

/**
 * Internal-only proof that Operations validated the accepted quote binding and
 * copied its frozen execution facts through ProductBillingLifecycle.
 */
export interface AcceptedProductQuoteInspectionAuthority {
  kind: 'accepted_product_quote';
  quoteId: string;
  quoteRevision: string;
  catalogModelId: string;
  catalogModelRevision: string;
  confirmedAmount: number;
  currency: string;
  outputCount: number;
  outputLabel: string;
}

export interface ContentPackageExportArtifact {
  artifactAssetId: string;
  artifactObjectKey: string;
  contentType: 'application/zip' | 'video/mp4';
  sha256: string;
  sizeBytes: number;
  /** Durable receipt version for the shared object cleanup claim protocol. */
  storageRevision?: string;
}

export interface ContentPackageExportPort {
  export(input: {
    compliance: ContentPackage['compliance'];
    /** Frozen ContentPackage revision written into the delivery manifest. */
    contentPackageRevision?: number;
    kind: ContentPackage['kind'];
    packageId: string;
    platform: ContentPackage['variants'][number]['platform'];
    version: ContentPackage['versions'][number];
    videoDeliveryCompositionRevision?: string;
    videoDeliveryWorkflowId?: string;
    videoDeliveryRevision?: string;
    videoDeliveryDurationSeconds?: number;
    workspaceId: string;
  }): Promise<ContentPackageExportArtifact>;
}

export interface ContentPackageRightsResolverPort {
  resolve(input: {
    assetIds: string[];
    workspaceId: string;
  }): Promise<{
    knownAssetIds?: string[];
    unauthorizedAssetIds: string[];
  }>;
}

export interface UserTemplate {
  id: string;
  workspaceId: string;
  name: string;
  sourceWorkId: string;
  canvasRevisionId: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateShortcut {
  templateId?: string;
  userTemplateId?: string;
  rank: number;
  hidden: boolean;
}

export interface ExportRequest {
  format: 'png' | 'jpeg';
  width: number;
  height: number;
  /** Persisted CanvasRevision represented by renderedDataUrl. */
  workRevisionId: string;
  renderedDataUrl: string;
  renderEvidenceMarker: {
    version: 'canvas-raster-v1';
    rasterSha256: string;
    imageElementIds: string[];
    fontFamilies: string[];
    cjkLineBreakElementIds: string[];
  };
  /** Exact client-side export snapshot; omitted legacy calls use CanvasWork. */
  brandWatermarkEnabled?: boolean;
  /** Exact text burned by the client-side renderer when the watermark is on. */
  brandWatermarkText?: string;
  /** Exact client-side export snapshot; omitted legacy calls use CanvasWork. */
  aigcLabelEnabled?: boolean;
  promotionalMaterialReceipt?: Pick<
    PromotionalMaterialReceipt,
    | 'capabilityStatus'
    | 'missingMaterialFallback'
    | 'outputSha256'
    | 'provenanceRef'
  >;
  promotionalMaterialSpec?: PromotionalMaterialSpec;
}

export interface ExportArtifact {
  assetId?: string;
  objectKey: string;
  sha256: string;
  bytes: number;
  contentType: 'image/png' | 'image/jpeg';
  validation: CanvasExportValidationEvidence;
}

export interface CanvasExportValidationEvidence {
  markerVersion: 'canvas-raster-v1';
  raster: {
    format: ExportRequest['format'];
    width: number;
    height: number;
    hasAlphaChannel: boolean;
    hasTransparentPixels: boolean;
  };
  /** Source-document facts; raster formats do not retain font or element IDs. */
  document: {
    imageElementIds: string[];
    imageAssetIds: string[];
    fontFamilies: string[];
    cjkTextElementIds: string[];
    cjkLineBreakElementIds: string[];
  };
}

export interface ExportReceipt
  extends ExportArtifact,
    Omit<
      ExportRequest,
      | 'renderedDataUrl'
      | 'renderEvidenceMarker'
      | 'brandWatermarkEnabled'
      | 'aigcLabelEnabled'
      | 'promotionalMaterialReceipt'
      | 'workRevisionId'
    > {
  id: string;
  workspaceId: string;
  workId: string;
  workRevisionId: string;
  brandWatermarkEnabled: boolean;
  aigcLabelEnabled: boolean;
  promotionalMaterialReceipt?: ExportRequest['promotionalMaterialReceipt'];
  createdAt: string;
}

export interface CanvasExportPort {
  export(
    document: CanvasDocument,
    request: ExportRequest,
    context: { workspaceId: string }
  ): Promise<ExportArtifact>;
  inspectOwnedAsset?(input: {
    assetId: string;
    bytes: number;
    contentType: ExportArtifact['contentType'];
    objectKey: string;
    sha256: string;
    workspaceId: string;
  }): Promise<boolean>;
}

export type ImageModelId =
  | 'gpt-image-2'
  | 'nano-banana-2'
  | 'nano-banana-pro'
  | 'seedream-4-5'
  | 'seedream-5-pro';

export type CanvasImageJobOrigin =
  | { kind: 'layout_work'; id: string; revisionId: string }
  | { kind: 'advanced_canvas'; id: string; revisionId: string };

export interface CanvasImageJob {
  id: string;
  workspaceId: string;
  origin: CanvasImageJobOrigin;
  requestedModelId: ImageModelId;
  actualModelId: ImageModelId;
  operation: 'generate' | 'edit';
  prompt: string;
  dataClass?: Array<'contains_face' | 'pii' | 'medical'>;
  submissionKey?: string;
  cancelEffectKey?: string;
  cancelAcknowledgedAt?: string;
  cancelLeaseToken?: string;
  cancelLeaseExpiresAt?: string;
  inputAssetId?: string;
  outputAssetId?: string;
  outputAssetUrl?: string;
  status:
    | 'queued'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancel_requested'
    | 'cancelled'
    | 'unknown';
  createdAt: string;
  updatedAt: string;
}

export interface ImageGenerationRequest {
  actorId: string;
  idempotencyKey?: string;
  dataClass: Array<'contains_face' | 'pii' | 'medical'>;
  workspaceId: string;
  origin: CanvasImageJobOrigin;
  requestedModelId: ImageModelId;
  operation: 'generate' | 'edit';
  prompt: string;
  inputAssetId?: string;
}

export interface ImageGenerationPort {
  jobId?(request: ImageGenerationRequest): string;
  submit(request: ImageGenerationRequest): Promise<
    Pick<CanvasImageJob, 'id' | 'actualModelId' | 'status'> & {
      outputAssetId?: string;
      outputAssetUrl?: string;
    }
  >;
  get?(request: {
    actorId: string;
    workspaceId: string;
    jobId: string;
  }): Promise<
    Pick<CanvasImageJob, 'id' | 'actualModelId' | 'status'> & {
      outputAssetId?: string;
      outputAssetUrl?: string;
    }
  >;
  cancel?(request: {
    actorId: string;
    workspaceId: string;
    jobId: string;
    idempotencyKey: string;
  }): Promise<
    Pick<CanvasImageJob, 'id' | 'actualModelId' | 'status'> & {
      outputAssetId?: string;
      outputAssetUrl?: string;
    }
  >;
}

export interface AssetDataClassResolverPort {
  resolve(
    workspaceId: string,
    assetId: string
  ): Promise<Array<'contains_face' | 'pii' | 'medical'> | null>;
}

export interface CreativeGroundingResolverPort {
  resolve(
    workspaceId: string,
    sourceAssetIds: string[]
  ): Promise<CreativeGroundingResolution>;
}

export type SearchDocumentKind = 'task' | 'asset' | 'content' | 'template';

export interface SearchDocument {
  id: string;
  workspaceId: string;
  kind: SearchDocumentKind;
  title: string;
  text: string;
  tags: string[];
  metadata: Record<string, string>;
  updatedAt: string;
}

export interface SearchQuery {
  query?: string;
  kinds?: SearchDocumentKind[];
  tags?: string[];
  metadata?: Record<string, string>;
  limit?: number;
}

export interface SearchResult extends SearchDocument {
  score: number;
  matchMode: 'exact' | 'fts' | 'bigram' | 'trigram' | 'structured';
}

export interface RetrievalEvaluationCase {
  query: string;
  expectedIds: string[];
  revised: boolean;
  category?: 'alias' | 'synonym' | 'typo' | 'tag' | 'negative' | 'other';
  kinds?: SearchDocumentKind[];
  tags?: string[];
}

export interface RetrievalEvaluationCaseEvidence
  extends RetrievalEvaluationCase {
  resultIds: string[];
}

export interface RetrievalEvaluation {
  id: string;
  workspaceId: string;
  revision: string;
  k: number;
  recallAtK: number;
  zeroResultRate: number;
  reformulationRate: number;
  reformulationSource: 'fixed-query-set-annotation';
  indexMode:
    | 'memory-bigram-trigram'
    | 'postgres-fts-bigram'
    | 'postgres-fts-trigram-bigram';
  caseCount: number;
  cases: RetrievalEvaluationCaseEvidence[];
  querySetHash: string;
  indexDocumentCount: number;
  indexSizeBytes: number;
  indexSizeKind: 'logical-corpus-bytes' | 'postgres-index-relation-bytes';
  indexSizeScope:
    | 'workspace-logical-corpus'
    | 'shared-p1-search-documents-relation';
  templateDocumentCount: number;
  templateSearchMode: 'memory-bigram-trigram';
  negativeControlPassRate: number | null;
  createdAt: string;
}

export interface OperationsAuditEvent {
  id: string;
  workspaceId: string;
  actorId: string;
  correlationId: string;
  action: string;
  entityType: string;
  entityId: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

export interface OperationsCommandReceipt {
  id: string;
  workspaceId: string;
  idempotencyKey: string;
  payloadHash: string;
  status: 'pending' | 'completed';
  result: unknown;
  actorId: string;
  correlationId: string;
  createdAt: string;
}

export interface OperationsWorkspaceState {
  workspaceId: string;
  commandReceipts: OperationsCommandReceipt[];
  tasks: ContentTask[];
  taskEvents: TaskEvent[];
  taskSourceLinks: TaskSourceLink[];
  triggerConfigs: TriggerConfig[];
  triggerRuns: TriggerRun[];
  weeklyFacts: WeeklyFact[];
  weeklyReviews: WeeklyReview[];
  weeklyBatchExecutions: WeeklyBatchExecution[];
  works: CanvasWork[];
  userTemplates: UserTemplate[];
  templateShortcuts: TemplateShortcut[];
  exportReceipts: ExportReceipt[];
  imageJobs: CanvasImageJob[];
  creativeWorks: CreativeWork[];
  creativeGenerationApprovalReceipts?: CreativeGenerationApprovalReceipt[];
  creativeJobs: CreativeJob[];
  creativeAssets: CreativeAssetProjection[];
  creativeContents: CreativeContent[];
  contentPackages: ContentPackage[];
  creationEvents: CreationActivationEvent[];
  auditEvents: OperationsAuditEvent[];
}
