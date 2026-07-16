import { z } from 'zod';
import type { ProductCommand } from './product.js';

export const productRoles = ['admin', 'owner', 'operator', 'reviewer'] as const;
export type ProductRole = (typeof productRoles)[number];

export const creativeOperationSchema = z.enum([
  'copy.generate',
  'copy.adapt',
  'image.generate',
  'image.edit',
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
  sourceReferences: CreativeSourceReference[];
  /** Missing only on historical rows created before content suites shipped. */
  contentModules?: CreativeContentModuleId[];
  /** Missing only on historical rows and drafts not yet compiled by AI. */
  brief?: CreativeBrief;
  status: 'draft' | 'running' | 'completed' | 'accepted' | 'failed';
  currentJobId?: string;
  derivedFrom?: string;
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

export const productCapabilities = [
  'content.create',
  'content.review',
  'lead.manage',
  'models.select',
  'personal.preferences.manage',
  'platform.manage',
  'publication.handoff',
  'workspace.billing.manage',
  'workspace.connections.manage',
  'workspace.members.manage',
  'workspace.models.manage',
  'workspace.profile.manage',
  'workspace.read',
] as const;
export type ProductCapability = (typeof productCapabilities)[number];

const sharedWorkspaceCapabilities: ProductCapability[] = ['workspace.read'];
const operatorCapabilities: ProductCapability[] = [
  ...sharedWorkspaceCapabilities,
  'content.create',
  'content.review',
  'lead.manage',
  'models.select',
  'personal.preferences.manage',
  'publication.handoff',
];
const ownerCapabilities: ProductCapability[] = [
  ...operatorCapabilities,
  'workspace.billing.manage',
  'workspace.connections.manage',
  'workspace.members.manage',
  'workspace.models.manage',
  'workspace.profile.manage',
];

export const PRODUCT_ROLE_CAPABILITIES: Readonly<
  Record<ProductRole, readonly ProductCapability[]>
> = {
  admin: [...ownerCapabilities, 'platform.manage'],
  owner: ownerCapabilities,
  operator: operatorCapabilities,
  reviewer: [...sharedWorkspaceCapabilities, 'content.review'],
};

export function hasProductCapability(
  role: ProductRole,
  capability: ProductCapability
) {
  return PRODUCT_ROLE_CAPABILITIES[role].includes(capability);
}

export function normalizeProductRole(input: {
  platformRole?: string | null;
  workspaceRole?: string | null;
}): ProductRole | undefined {
  if (input.platformRole === 'admin') return 'admin';
  if (
    input.workspaceRole === 'owner' ||
    input.workspaceRole === 'operator' ||
    input.workspaceRole === 'reviewer'
  ) {
    return input.workspaceRole;
  }
  return undefined;
}

type P1Module =
  | 'advanced-canvas'
  | 'admin-config'
  | 'entitlements'
  | 'integrations'
  | 'job-runtime'
  | 'model-supply'
  | 'operations';

const personalModelActions = new Set([
  'record_recent',
  'set_favorite',
  'set_user_default',
]);
const modelExecutionActions = new Set([
  'cancel_generation',
  'record_quality',
  'submit_generation',
  'video_workflow_cancel',
  'video_workflow_confirm',
  'video_workflow_create_draft',
]);
const integrationUseActions = new Set([
  'confirm_douyin_publish',
  'confirm_feishu_intent',
  'execute_feishu_intent',
  'reconcile_feishu_intent',
  'refresh_douyin_publish',
  'submit_douyin_publish',
]);
const platformIntegrationActions = new Set([
  'publish_feishu_tool',
  'sync_feishu_tools',
  'sync_publish_feishu_tools',
]);

export function requiredP1Capability(
  kind: 'command' | 'query',
  module: P1Module,
  action: string
): ProductCapability {
  if (module === 'advanced-canvas') {
    return kind === 'query' ? 'workspace.read' : 'content.review';
  }
  if (module === 'admin-config') {
    return kind === 'query' && action === 'config_defaults'
      ? 'workspace.read'
      : 'platform.manage';
  }
  if (module === 'operations') {
    if (action.startsWith('admin_')) return 'platform.manage';
    if (kind === 'query') return 'workspace.read';
    return action === 'transition_task' ||
      action === 'accept_creative_asset' ||
      action === 'adopt_canvas_work_export' ||
      action === 'adopt_into_content_package' ||
      action === 'revoke_content_package_rights'
      ? 'content.review'
      : 'content.create';
  }
  if (module === 'entitlements') {
    return kind === 'query' ? 'workspace.read' : 'workspace.billing.manage';
  }
  if (module === 'integrations') {
    if (action.startsWith('admin_') || platformIntegrationActions.has(action)) {
      return 'platform.manage';
    }
    if (kind === 'query') return 'workspace.read';
    if (action === 'set_feishu_shortcuts') {
      return 'personal.preferences.manage';
    }
    if (integrationUseActions.has(action)) return 'publication.handoff';
    if (action === 'submit_strict_byok') return 'workspace.models.manage';
    return 'workspace.connections.manage';
  }
  if (module === 'model-supply') {
    if (kind === 'query') {
      return action === 'admin_catalog_control' ||
        action === 'route_simulation' ||
        action === 'quality_dashboard' ||
        action === 'quality_evaluations' ||
        action === 'quality_evaluation' ||
        action === 'prompt_revisions' ||
        action === 'catalog_revisions' ||
        action === 'revision_rollback_audits'
        ? 'platform.manage'
        : 'workspace.read';
    }
    if (personalModelActions.has(action)) {
      return 'personal.preferences.manage';
    }
    if (action === 'set_workspace_default') return 'workspace.models.manage';
    if (action === 'video_workflow_select_candidate') return 'content.review';
    if (modelExecutionActions.has(action)) return 'content.create';
    return 'platform.manage';
  }
  if (kind === 'query') {
    return action === 'metrics' || action === 'observability'
      ? 'platform.manage'
      : 'workspace.read';
  }
  return action === 'submit' || action === 'cancel'
    ? 'content.create'
    : 'platform.manage';
}

const internalProductCommands = new Set<ProductCommand['type']>([
  'apply_plan',
  'claim_video',
  'complete_video',
  'heartbeat_video',
  'record_video_render',
  'transition_video',
]);
const workspaceProfileCommands = new Set<ProductCommand['type']>([
  'authorize_asset',
  'confirm_qualification',
  'confirm_store',
  'save_store_draft',
]);
const contentReviewCommands = new Set<ProductCommand['type']>([
  'display_preflight',
  'select_content',
]);
const publicationCommands = new Set<ProductCommand['type']>([
  'confirm_responsibility',
  'create_handoff',
  'mark_published',
  'record_handoff_export',
  'report_handoff_result',
]);
const leadCommands = new Set<ProductCommand['type']>([
  'create_lead',
  'record_insight',
  'update_lead',
]);

export function requiredProductCommandCapability(
  type: ProductCommand['type']
): ProductCapability | undefined {
  if (internalProductCommands.has(type)) return undefined;
  if (workspaceProfileCommands.has(type)) return 'workspace.profile.manage';
  if (contentReviewCommands.has(type)) return 'content.review';
  if (publicationCommands.has(type)) return 'publication.handoff';
  if (leadCommands.has(type)) return 'lead.manage';
  return 'content.create';
}
