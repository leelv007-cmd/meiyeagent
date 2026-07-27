import type { ProductRole } from './uiux.js';

export type Platform = 'xiaohongshu' | 'douyin';
export type ComplianceStatus = 'clear' | 'warning' | 'blocked';
export const AIGC_VISIBLE_LABEL = '内容由 AI 生成';

export interface ProductContext {
  actor?: 'user' | 'payment' | 'worker';
  role?: ProductRole;
  correlationId: string;
  userId: string;
  workspaceId: string;
}

export interface StoreProject {
  id: string;
  name: string;
  price: number;
  durationMinutes: number;
  confirmed: boolean;
}

export interface StoreAccount {
  platform: Platform;
  nickname: string;
  homepageUrl?: string;
  verificationStatus?: 'unverified' | 'verified' | 'restricted';
  notes?: string;
}

export interface StoreProfile {
  name: string;
  city: string;
  district: string;
  address: string;
  booking: string;
  brandVoice: string;
  prohibitions: string[];
  accounts: StoreAccount[];
  projects: StoreProject[];
  regulated: boolean;
  revision?: number;
  confirmedAt?: string;
}

export interface StoreProfilePatch {
  expectedRevision: number;
  name?: string;
  city?: string;
  district?: string;
  address?: string;
  booking?: string;
  brandVoice?: string;
  prohibitions?: string[];
  regulated?: boolean;
  accounts?: {
    upsert?: StoreAccount[];
    clear?: Platform[];
  };
  projects?: {
    upsert?: StoreProject[];
    clear?: string[];
  };
}

export interface StoreDraft {
  sourceText: string;
  extracted: {
    name?: string;
    projectName?: string;
    projectPrice?: number;
  };
  confirmed: false;
  createdAt: string;
}

export interface QualificationProfile {
  admitted: boolean;
  institutionLicense?: string;
  treatmentScope?: string;
  platformCertification?: string;
  advertisingCertificate?: string;
  validUntil?: string;
  intakeAt?: string;
  confirmed: boolean;
}

export const productAssetMediaTypes = ['image', 'video', 'audio'] as const;
export type ProductAssetMediaType = (typeof productAssetMediaTypes)[number];

export interface Asset {
  id: string;
  objectKey: string;
  mediaType: ProductAssetMediaType;
  sourceType: 'real' | 'ai_generated';
  category?: 'store' | 'before_after' | 'customer_case' | 'price_list' | 'other';
  tags: string[];
  rightsOwner: string;
  rightsEvidence?: string;
  rightsPlatforms?: Platform[];
  rightsValidUntil?: string;
  rightsNoFixedExpiry?: boolean;
  rightsAuthorizedAt?: string;
  consentScope: 'internal_only' | 'public_marketing' | 'paid_advertising';
  containsPerson: boolean;
  containsSensitiveData: boolean;
  minorStatus: 'none' | 'minor';
  aigcStatus: 'not_ai' | 'ai_generated';
  authorizationStatus: 'pending' | 'authorized' | 'withdrawn' | 'blocked';
  replacementRequired: boolean;
  createdAt: string;
}

export function isRestrictedProductAsset(
  asset: Pick<Asset, 'category' | 'containsPerson'>
) {
  return (
    asset.containsPerson ||
    asset.category === 'before_after' ||
    asset.category === 'customer_case'
  );
}

export function hasCurrentRestrictedAssetAuthorization(
  asset: Pick<
    Asset,
    | 'category'
    | 'containsPerson'
    | 'rightsNoFixedExpiry'
    | 'rightsPlatforms'
    | 'rightsValidUntil'
  >,
  at: Date
) {
  if (!isRestrictedProductAsset(asset)) return true;
  if (!asset.rightsPlatforms?.length) return false;
  if (asset.rightsNoFixedExpiry === true) {
    return !asset.rightsValidUntil;
  }
  if (!asset.rightsValidUntil) return false;
  const validUntil = Date.parse(asset.rightsValidUntil);
  return Number.isFinite(validUntil) && validUntil > at.getTime();
}

export interface ContentVersion {
  id: string;
  source: 'ai' | 'merchant';
  title: string;
  body: string;
  topics: string[];
  conversionHook: string;
  assetOrder: string[];
  generationEvidence?: {
    requestedModel: string;
    actualModel: string;
    routeSnapshotId: string;
    promptRevision: string;
    templateRevision: string;
    exampleSetRevision: string;
    providerCost: {
      amount: number;
      currency: string;
      status: string;
    };
  };
  createdAt: string;
}

export interface ContentVariant {
  id: string;
  platform: Platform;
  durationSeconds?: 15 | 30 | 60;
  versions: ContentVersion[];
  currentVersionId: string;
  aiDefaultVersionId: string;
}

export interface ContentItem {
  id: string;
  scenario: string;
  projectId: string;
  assetIds: string[];
  status: 'candidate' | 'draft' | 'abandoned' | 'published';
  complianceStatus: ComplianceStatus;
  warning?: string;
  variants: ContentVariant[];
  selected: boolean;
  artifactId?: string;
  abandonedAt?: string;
  createdAt: string;
}

export interface StoryboardShot {
  id: string;
  stage: 'attention' | 'interest' | 'desire' | 'action';
  purpose: string;
  visualDirection: string;
  sourceAssetId: string;
  narration: string;
  durationSeconds: number;
  complianceStatus: ComplianceStatus;
}

export interface Storyboard {
  id: string;
  contentId: string;
  version: number;
  shots: StoryboardShot[];
  status: 'draft' | 'confirmed';
  confirmedAt?: string;
}

export interface VideoJob {
  id: string;
  agentRunId: string;
  artifactShellId: string;
  correlationId: string;
  storyboardId: string;
  status: 'queued' | 'running' | 'needs_action' | 'completed' | 'cancelled' | 'failed';
  step: string;
  reservationId: string;
  retryOf?: string;
  qualityRetryCount: number;
  constraint?: string;
  failureReason?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  committedSteps: string[];
  createdAt: string;
  updatedAt: string;
}

export interface VideoArtifactShell {
  id: string;
  jobId: string;
  storyboardId: string;
  reservationId: string;
  correlationId: string;
  status: 'queued' | 'running' | 'needs_action' | 'completed' | 'cancelled' | 'failed';
  createdAt: string;
  updatedAt: string;
}

export interface VideoRenderEvidence {
  id: string;
  jobId: string;
  correlationId: string;
  workerId: string;
  sourceAssetId: string;
  fileSha256: string;
  fileSizeBytes: number;
  provider: string;
  model: string;
  durationSeconds: number;
  aspectRatio: '9:16';
  visibleLabel?: typeof AIGC_VISIBLE_LABEL;
  implicitMetadata?: {
    contentType: 'ai_generated';
    serviceProvider: string;
    serviceCode: string;
    contentId: string;
  };
  compliancePassed?: boolean;
  complianceResultId?: string;
  providerCostCents: number;
  latencyMs: number;
  usableQuality: {
    usable: boolean;
    reason: string;
    aestheticScore?: number;
    imageQualityScore?: number;
    assessmentMethod?: string;
  };
  firstFrameManifest: Record<string, unknown>;
  clipManifest: Array<Record<string, unknown>>;
  composeManifest: Record<string, unknown>;
  createdAt: string;
}

export interface VideoArtifact {
  id: string;
  jobId: string;
  renderEvidenceId: string;
  correlationId: string;
  reservationId: string;
  storyboardVersion: number;
  objectKey: string;
  storageEtag: string;
  fileSha256: string;
  fileSizeBytes: number;
  contentType: 'video/mp4';
  storageVerifiedAt: string;
  complianceResultId?: string;
  provider: string;
  model: string;
  durationSeconds: number;
  aspectRatio: string;
  visibleLabel: boolean;
  implicitMetadata: boolean;
  compliancePassed: boolean;
  providerCostCents: number;
  status: 'completed';
  createdAt: string;
}

export interface HandoffPackage {
  id: string;
  contentId: string;
  artifactId?: string;
  assetIds?: string[];
  platform: Platform;
  version: number;
  contentVersionId: string;
  operatorUserId: string;
  accountNickname: string;
  route: 'L3_HANDOFF_PACKAGE';
  complianceResultId: string;
  status: 'ready' | 'published';
  title: string;
  body: string;
  topics: string[];
  conversionText: string;
  checklist: string[];
  token: string;
  expiresAt: string;
  platformUrl?: string;
  publishedAt?: string;
  createdAt: string;
  exportEvents: Array<{
    id: string;
    type:
      | 'package_created'
      | 'opened'
      | 'downloaded'
      | 'shared'
      | 'copied'
      | 'published';
    userId: string;
    createdAt: string;
  }>;
  manualReports: Array<{
    id: string;
    outcome: 'published' | 'not_published' | 'failed';
    note?: string;
    platformUrl?: string;
    userId: string;
    createdAt: string;
  }>;
}

export interface ComplianceResult {
  id: string;
  correlationId: string;
  subjectType: 'request' | 'content' | 'video';
  subjectId: string;
  stage: 'pre_generation' | 'post_generation' | 'publication' | 'video_output';
  status: 'pass' | 'warning' | 'blocked';
  rules: string[];
  guidance?: {
    restriction: string;
    reason: string;
    replacement: string;
    action: string;
  };
  provider: string;
  model: string;
  createdAt: string;
}

export interface AgentRun {
  id: string;
  correlationId: string;
  workflow: 'content.generate_copy' | 'video.generate';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  completedAt?: string;
}

export interface ToolCall {
  id: string;
  agentRunId: string;
  correlationId: string;
  name: 'content.generate_candidates';
  status: 'completed' | 'failed';
  provider: string;
  model: string;
  latencyMs: number;
  costCents: number;
  createdAt: string;
}

export interface QuotaBucket {
  allowance: number;
  remaining: number;
}

export interface Entitlement {
  plan: 'trial' | 'starter' | 'growth' | 'pro';
  sourceEventId?: string;
  sourceUpdatedAt?: string;
  content: QuotaBucket;
  image: QuotaBucket;
  video: QuotaBucket;
  package: QuotaBucket;
  storageMb: QuotaBucket;
  concurrencyLimit: number;
  queuePriority: number;
  supportLabel: 'standard' | 'priority';
}

export interface UsageEvent {
  id: string;
  correlationId: string;
  resource: 'content' | 'image' | 'video' | 'package' | 'storage';
  amount: number;
  status: 'reserved' | 'committed' | 'refunded' | 'failed_no_charge' | 'expired' | 'quality_retry';
  reservationId?: string;
  reason: string;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  correlationId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

/** D-126 cold-start sample industries (C-5). */
export type ExampleStoreIndustry =
  | 'hair_care'
  | 'skin_management'
  | 'hair_growth';

export const EXAMPLE_STORE_INDUSTRIES: readonly ExampleStoreIndustry[] = [
  'hair_care',
  'skin_management',
  'hair_growth',
];

/**
 * D-126: platform-maintained sample material. Never enters a tenant's real
 * ContextBundle and never shows up in tenant workspace projections.
 */
export const PLATFORM_SAMPLE_PROVENANCE = 'platform_sample';

/** Every platform-sample entity id lives in this reserved namespace. */
export const PLATFORM_SAMPLE_ID_PREFIX = 'platform-sample:';

export function isPlatformSampleId(id: string) {
  return id.startsWith(PLATFORM_SAMPLE_ID_PREFIX);
}

export interface ExampleStore {
  id: string;
  industry: ExampleStoreIndustry;
  provenance: typeof PLATFORM_SAMPLE_PROVENANCE;
  name: string;
  readOnly: true;
  hidden: boolean;
  assets: number;
  contentCards: number;
  packages: number;
  profile: { city: string; project: string; confirmedPrice: number };
  /** Confirmed store facts the sample content is grounded in (D-119 look-alike). */
  facts: Array<{ id: string; label: string; value: string }>;
  assetPreviews: Array<{
    id: string;
    label: string;
    authorizationStatus: 'authorized';
    previewUrl?: string;
  }>;
  contentPreviews: Array<{
    id: string;
    title: string;
    platform: Platform;
    summary: string;
    previewUrl?: string;
  }>;
  handoffPreview: { id: string; title: string; platform: Platform };
}

export interface ProductState {
  workspaceId: string;
  exampleStores: ExampleStore[];
  storeDraft?: StoreDraft;
  store?: StoreProfile;
  qualification?: QualificationProfile;
  assets: Asset[];
  contents: ContentItem[];
  storyboards: Storyboard[];
  videoJobs: VideoJob[];
  videoArtifactShells: VideoArtifactShell[];
  videoRenderEvidence: VideoRenderEvidence[];
  videoArtifacts: VideoArtifact[];
  complianceResults: ComplianceResult[];
  agentRuns: AgentRun[];
  toolCalls: ToolCall[];
  handoffPackages: HandoffPackage[];
  preflightEvents: Array<{
    id: string;
    contentId: string;
    contentVersionId: string;
    trigger: 'adopt' | 'handoff' | 'publish';
    qualificationSnapshot: QualificationProfile | null;
    warnings: string[];
    createdAt: string;
  }>;
  responsibilityConfirmations: Array<{
    id: string;
    contentId: string;
    contentVersionId: string;
    userId: string;
    statement: string;
    createdAt: string;
  }>;
  operationalEvidence: {
    activatedAt: string;
    firstContentAt?: string;
    generatedCandidateCount: number;
    adoptedContentCount: number;
    weeklyCardCount: number;
    handoffCount: number;
    videoOutputCount: number;
    videoProviderCostCents: number;
    labeledVideoCount: number;
    videoRetryCount: number;
    videoRefundCount: number;
    videoAttemptCount: number;
    videoTechnicalSuccessCount: number;
    videoUsableQualityCount: number;
    videoLatencyTotalMs: number;
    videoProviderFailureCount: number;
  };
  entitlement: Entitlement;
  usageEvents: UsageEvent[];
  auditEvents: AuditEvent[];
  enforcement: {
    day: string;
    consecutiveAbuse: number;
    dailyAbuse: number;
    suspended: boolean;
  };
  updatedAt: string;
}

export interface CommandResult {
  state: ProductState;
  output: {
    artifactId?: string;
    candidateIds?: string[];
    contentId?: string;
    handoffToken?: string;
    jobId?: string;
    packageId?: string;
    renderEvidenceId?: string;
    storeRevision?: number;
    storyboardId?: string;
  };
}

export type ProductCommand =
  | { type: 'hide_example'; hidden: boolean }
  | {
      type: 'save_store_draft';
      sourceText: string;
      extracted: StoreDraft['extracted'];
    }
  | {
      type: 'confirm_store';
      store: Omit<StoreProfile, 'confirmedAt' | 'revision'>;
    }
  | { type: 'confirm_qualification'; qualification: Omit<QualificationProfile, 'confirmed'> }
  | {
      type: 'add_asset';
      asset: Omit<
        Asset,
        | 'aigcStatus'
        | 'authorizationStatus'
        | 'createdAt'
        | 'replacementRequired'
        | 'rightsAuthorizedAt'
      >;
    }
  | {
      type: 'authorize_asset';
      assetId: string;
      consentScope: Asset['consentScope'];
      rightsEvidence?: string;
      rightsPlatforms?: Platform[];
      rightsValidUntil?: string;
      rightsNoFixedExpiry?: boolean;
    }
  | {
      type: 'update_asset_metadata';
      assetId: string;
      category: NonNullable<Asset['category']>;
      tags: string[];
      rightsOwner: string;
      containsPerson: boolean;
      containsSensitiveData: boolean;
      minorStatus: Asset['minorStatus'];
    }
  | { type: 'withdraw_asset'; assetId: string }
  | { type: 'check_content'; text: string }
  | {
      type: 'generate_copy';
      brief: {
        assetIds: string[];
        conversionGoal: string;
        hook: string;
        platform: Platform;
        projectId: string;
        scenario: string;
        tone: string;
        requestedSelection?:
          | { mode: 'auto' }
          | { mode: 'fixed'; catalogModelId: string };
      };
    }
  | { type: 'select_content'; contentId: string }
  | { type: 'create_douyin_variant'; contentId: string; durationSeconds: 15 | 30 | 60 }
  | {
      type: 'quick_edit';
      contentId: string;
      instruction: 'conversational' | 'professional' | 'weaker_advertising' | 'local_positioning';
    }
  | { type: 'undo_edit'; contentId: string; platform: Platform }
  | { type: 'revert_to_ai'; contentId: string; platform: Platform }
  | { type: 'create_weekly_set'; contentId: string }
  | { type: 'remix_content'; contentId: string }
  | { type: 'abandon_content'; contentId: string }
  | { type: 'create_storyboard'; contentId: string }
  | { type: 'replace_storyboard_shot'; storyboardId: string; shotId: string; visualDirection: string }
  | { type: 'confirm_storyboard'; storyboardId: string }
  | { type: 'start_video'; storyboardId: string }
  | { type: 'claim_video'; jobId: string; workerId: string; leaseSeconds: number }
  | { type: 'heartbeat_video'; jobId: string; workerId: string; leaseSeconds: number }
  | {
      type: 'transition_video';
      jobId: string;
      workerId: string;
      nextStatus: VideoJob['status'];
      reason?: string;
    }
  | { type: 'resume_video'; jobId: string; constraint: string }
  | {
      type: 'record_video_render';
      jobId: string;
      workerId: string;
      evidence: Omit<
        VideoRenderEvidence,
        | 'id'
        | 'jobId'
        | 'correlationId'
        | 'workerId'
        | 'complianceResultId'
        | 'createdAt'
      >;
    }
  | {
      type: 'complete_video';
      jobId: string;
      renderEvidenceId: string;
      storage: Pick<
        VideoArtifact,
        | 'objectKey'
        | 'storageEtag'
        | 'fileSha256'
        | 'fileSizeBytes'
        | 'contentType'
        | 'storageVerifiedAt'
      >;
    }
  | { type: 'cancel_video'; jobId: string }
  | { type: 'retry_video'; jobId: string }
  | { type: 'display_preflight'; contentId: string; trigger: 'adopt' | 'handoff' | 'publish' }
  | { type: 'confirm_responsibility'; contentId: string }
  | { type: 'create_handoff'; contentId: string; artifactId?: string; platform: Platform }
  | {
      type: 'record_handoff_export';
      packageId: string;
      event: 'opened' | 'downloaded' | 'shared' | 'copied';
    }
  | {
      type: 'report_handoff_result';
      packageId: string;
      outcome: 'published' | 'not_published' | 'failed';
      note?: string;
      platformUrl?: string;
    }
  | { type: 'mark_published'; packageId: string; platformUrl?: string }
  | {
      type: 'apply_plan';
      plan: Entitlement['plan'];
      eventId: string;
      effectiveAt: string;
    };
