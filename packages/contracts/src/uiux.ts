import { z } from 'zod';
export const creativeOperationSchema = z.enum([
  'copy.generate',
  'copy.adapt',
  'image.generate',
  'image.edit',
  'image.reference_transform',
  'video.generate',
  'audio.speech',
  'audio.sfx',
]);
export type CreativeOperation = z.infer<typeof creativeOperationSchema>;

export const creativeContentModuleIds = [
  'social_cover',
  'before_after',
  'price_card',
  'package_explainer',
  'review_card',
  'store_intro',
  'shooting_checklist',
] as const;
export type CreativeContentModuleId = (typeof creativeContentModuleIds)[number];

export const creativeInheritanceFieldIds = [
  'content_structure',
  'layout_slots',
  'copy_skeleton',
  'output_specification',
  'visual_style',
] as const;
export type CreativeInheritanceFieldId =
  (typeof creativeInheritanceFieldIds)[number];

export interface CreativeSourceReference {
  id: string;
  kind: 'task' | 'asset' | 'content' | 'template' | 'work';
  inheritanceFields?: CreativeInheritanceFieldId[];
}

export const creativeExecutionContractSchema = z.object({
  operation: creativeOperationSchema,
  catalogModelId: z.string().trim().min(1),
  /**
   * Catalog revision pinned by the accepted execution contract. This is not
   * the observability event-attribution field with the same key.
   */
  catalogRevision: z.string().trim().min(1),
  quoteRevision: z.string().trim().min(1),
  quoteAcceptedAt: z.iso.datetime(),
  outputLabel: z.string().trim().min(1),
  estimatedAmount: z.number().nonnegative(),
  currency: z.string().trim().min(1),
  outputCount: z.number().int().positive(),
  aspectRatio: z.enum(['1:1', '3:4', '9:16']).optional(),
  durationSeconds: z.number().int().positive().optional(),
  dataClass: z.array(z.enum(['contains_face', 'pii', 'medical'])),
  watermarkEnabled: z.boolean(),
  aigcLabelEnabled: z.boolean(),
  contentModules: z
    .array(z.enum(creativeContentModuleIds))
    .min(1)
    .max(creativeContentModuleIds.length)
    .optional(),
});

export type CreativeExecutionContract = z.infer<
  typeof creativeExecutionContractSchema
>;

export type CreativeJobStatus =
  | 'submitting'
  | 'running'
  | 'recoverable'
  | 'unknown'
  | 'completed'
  | 'failed';

export type CreativeRerollKind = 'paid' | 'quality';

export interface CreativeRecommendationDecisionTrace {
  whyPost: string;
  expressionIdentity: string;
  factReferences: string[];
  platforms: string[];
  customerAction: string;
  complianceStatus: string;
  deliverables: string[];
}

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
    category?:
      | 'store'
      | 'before_after'
      | 'customer_case'
      | 'price_list'
      | 'other';
    tags: string[];
    consentScope: 'internal_only' | 'public_marketing' | 'paid_advertising';
    containsPerson: boolean;
    containsSensitiveData: boolean;
    minorStatus: 'none' | 'minor';
    authorizationStatus: 'authorized';
    rightsEvidenceRecorded: boolean;
  }>;
}

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
  submissionKey: string;
  providerJobId?: string;
  routeSnapshotId?: string;
  /** Frozen execution facts copied from the RouteSnapshot that produced this Job. */
  executionProvenance?: CreativeExecutionProvenance;
  outputAssetIds: string[];
  outputContentIds: string[];
  /** Server-selected candidate. Missing on legacy jobs without a persisted recommendation. */
  recommendedAssetId?: string;
  /** Complete explanation persisted with recommendedAssetId; never synthesized by clients. */
  decisionTrace?: CreativeRecommendationDecisionTrace;
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
  /** Frozen at first submission and reused by technical retries and rerolls. */
  briefSnapshot?: CreativeBrief;
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

export interface CreationActivationEvent {
  id: string;
  workspaceId: string;
  correlationId: string;
  schemaVersion: 'uiux-activation-v1';
  type:
    | 'first_work_created'
    | 'first_job_submitted'
    | 'first_assets_visible'
    | 'first_content_accepted'
    | 'cold_start_skipped';
  workId?: string;
  jobId?: string;
  assetId?: string;
  contentId?: string;
  createdAt: string;
}

export interface CreativeWorkbenchProjection {
  assets: CreativeAssetProjection[];
  contents: CreativeContent[];
  events: CreationActivationEvent[];
  jobs: CreativeJob[];
  works: CreativeWork[];
}

// S2a: permission keys live in capability-permission.ts (S1 freeze: compatible re-export only).
export {
  productRoles,
  type ProductRole,
  productCapabilities,
  type ProductCapability,
  PRODUCT_ROLE_CAPABILITIES,
  hasProductCapability,
  normalizeProductRole,
  type P1Module,
  requiredP1Capability,
  requiredProductCommandCapability,
} from './capability-permission.js';
