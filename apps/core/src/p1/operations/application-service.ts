import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import {
  type ContentPackage,
  type ContentPackageChildRun,
  type ContentPackageKind,
  type ContentPackageSource,
  type CreationMode,
  type ImageTextNoteVersion,
  type QuickEditIntent,
  type ResultAdoptCommand,
  type ReviseContentPackageVisualsCommand,
  contentPackageVisibleStatus,
  generatedPlatformVariantsSchema,
  DEFAULT_CANVAS_TEMPLATE_NAME,
  DEFAULT_CANVAS_WORK_NAME,
  OFFICIAL_CANVAS_TEMPLATE_NAME_PREFIX,
  OFFICIAL_CANVAS_WORK_NAME_PREFIX,
  officialCanvasTemplateName,
  officialCanvasWorkName,
  promotionalMaterialReceiptSchema,
  creativeGenerationApprovalReceiptSchema,
} from '@meiye/contracts';
import {
  reviseContentPackageVisualsPure,
  type VisualAssetRecord,
} from '../result-delivery/visual-adoption.js';
import { VisualAdoptionError } from '../result-delivery/errors.js';
import {
  decideContentPackageCanonicalWrite,
  writeOwnershipMissingError,
} from '../foundation/write-ownership.js';
import type { BillingLifecyclePort } from '../product-billing/lifecycle-port.js';
import type { ContentPackageDestinationProjectionPort } from '../execution-spine/content-package-destination-projection.js';
import { appendPendingApprovalRequest } from './content-package-approval.js';
import {
  approvalReceiptExpiresAt,
  isApprovalReceiptActiveAt,
} from './approval-receipt-validity.js';
import type { ContentPackageApprovalPolicyPort } from './content-package-delivery.js';
import { validateContentPackageVisibleCopyPolicy } from './content-package-visible-copy-policy.js';
import { ContentPackageRightsBasisError } from './content-package-rights-basis.js';
import {
  buildContentPackage,
  assertContentPackageExportAllowed,
  contentPackageReferencesAsset,
  contentPackageRightsAssetIds,
  ContentPackageTransitionError,
  transitionContentPackage,
} from './content-package.js';
import {
  ContentPackageLifecycleError,
  editContentPackageLifecycleVersion,
  rollbackContentPackageLifecycleVersion,
} from './content-package-lifecycle.js';
import {
  type ResolvedTemplateInheritanceSource,
  resolveCreativeInheritanceContext,
} from './creative-inheritance.js';
import {
  MediaCustodyError,
  type MediaCustodyStoragePort,
  repairMediaCustody as executeMediaCustodyRepair,
} from './media-custody.js';
import {
  ContentPackageRevisionConflictError,
  TaskBlockingNodeConflictError,
  type OperationsRepository,
} from './repository.js';
import { rankSearchDocuments } from './search.js';
import type {
  AssetDataClassResolverPort,
  BuiltInTriggerKind,
  CanvasDocument,
  CanvasExportPort,
  CanvasImageJob,
  CanvasWork,
  ComposerConversationDeletedFact,
  ComposerConversationDeletionNotificationPort,
  ContentTask,
  ContentTaskStatus,
  ContentPackageExportPort,
  ContentPackageRightsBasisResolverPort,
  ContentPackageRightsResolverPort,
  CreateTaskInput,
  CreationActivationEventType,
  CreationExecutionResult,
  CreativeAssetProjection,
  CreativeBrief,
  CreativeBriefFieldId,
  CreativeBriefUpdate,
  CreativeContentModuleId,
  CreativeExecutionContract,
  CreativeGroundingResolverPort,
  CreativeGroundingSnapshot,
  CreativeInheritanceContext,
  CreativeInheritanceFieldId,
  CreativeJob,
  CreativeOperation,
  CreativeRerollKind,
  CreativeSourceReference,
  CreativeWork,
  ExportReceipt,
  ExportRequest,
  ImageGenerationPort,
  ImageModelId,
  InboxProjection,
  NotificationPort,
  OperationContext,
  OperationsAuditEvent,
  OperationsWorkspaceState,
  RetrievalEvaluation,
  RetrievalEvaluationCase,
  SearchDocument,
  SearchQuery,
  SearchResult,
  TaskEvent,
  TaskFilter,
  TemplateCatalogHistory,
  TemplateCatalogState,
  TemplateFamily,
  TemplateShortcut,
  TemplateVersion,
  TriggerSchedulePort,
  UserTemplate,
  WeeklyFact,
  WeeklyFactKind,
  WeeklyReview,
} from './types.js';
import {
  isExportableOwnedAssetObjectKey,
  UnverifiedVideoComplianceError,
} from './content-package-export-adapter.js';
import type { CanvasExportAssetAccessPort } from './canvas-export-asset-access.js';
import { ownedAssetRegistrationLifecycle } from '../model-supply/owned-asset-registration-lifecycle.js';

export class OperationsError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
  }
}

/**
 * Result adoption seeds three export shells from the accepted base version.
 * They are not formal copy.adapt output and must stay replaceable once the
 * real platform rewrite is requested.
 */
export function hasOnlySeededPlatformVariantShells(
  contentPackage: Pick<ContentPackage, 'variants'>,
  currentVersion: Pick<ContentPackage['versions'][number], 'id'>
): boolean {
  return (
    contentPackage.variants.length === 3 &&
    contentPackage.variants.every((variant) =>
      variant.versions.length === 1 &&
      variant.versions[0]?.id === variant.currentVersionId &&
      variant.currentVersionId === `${currentVersion.id}:${variant.platform}`
    )
  );
}

const exportPromotionalMaterialReceiptSchema =
  promotionalMaterialReceiptSchema
    .pick({
      capabilityStatus: true,
      missingMaterialFallback: true,
      outputSha256: true,
      provenanceRef: true,
    })
    .strict();

function validatedPromotionalMaterialReceipt(request: ExportRequest) {
  if (!request.promotionalMaterialReceipt) return undefined;
  const parsed = exportPromotionalMaterialReceiptSchema.safeParse(
    request.promotionalMaterialReceipt
  );
  if (!parsed.success) {
    throw new OperationsError(
      'INVALID_PROMOTIONAL_MATERIAL_RECEIPT',
      `Invalid promotional material receipt: ${parsed.error.message}`,
      400
    );
  }
  if (!request.promotionalMaterialSpec) {
    throw new OperationsError(
      'INVALID_PROMOTIONAL_MATERIAL_RECEIPT',
      'A promotional material receipt requires its frozen material spec.',
      400
    );
  }
  if (parsed.data.provenanceRef !== request.workRevisionId) {
    throw new OperationsError(
      'INVALID_PROMOTIONAL_MATERIAL_RECEIPT',
      'Promotional material provenanceRef must match workRevisionId.',
      409
    );
  }
  if (parsed.data.outputSha256 !== request.renderEvidenceMarker.rasterSha256) {
    throw new OperationsError(
      'INVALID_PROMOTIONAL_MATERIAL_RECEIPT',
      'Promotional material outputSha256 must match the rendered raster evidence.',
      409
    );
  }
  return parsed.data;
}

function executeContentPackageLifecycle<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof ContentPackageLifecycleError) {
      throw new OperationsError(error.code, error.message, error.status);
    }
    throw error;
  }
}

function canvasWorkName(name?: string) {
  if (!name || name === DEFAULT_CANVAS_TEMPLATE_NAME) {
    return DEFAULT_CANVAS_WORK_NAME;
  }
  if (name.startsWith(OFFICIAL_CANVAS_TEMPLATE_NAME_PREFIX)) {
    return officialCanvasWorkName(
      name.slice(OFFICIAL_CANVAS_TEMPLATE_NAME_PREFIX.length)
    );
  }
  return name;
}

function canvasTemplateName(name: string | undefined, workName: string) {
  if (name) return name;
  if (workName === DEFAULT_CANVAS_WORK_NAME) {
    return DEFAULT_CANVAS_TEMPLATE_NAME;
  }
  if (workName.startsWith(OFFICIAL_CANVAS_WORK_NAME_PREFIX)) {
    return officialCanvasTemplateName(
      workName.slice(OFFICIAL_CANVAS_WORK_NAME_PREFIX.length)
    );
  }
  return workName;
}

function assertUserCanvasName(name?: string) {
  if (
    name?.startsWith('canvas-work:') ||
    name?.startsWith('canvas-template:')
  ) {
    throw new OperationsError(
      'CANVAS_NAME_RESERVED',
      'Canvas names cannot use a reserved system prefix.'
    );
  }
}

function optionalUserCanvasName(name?: string) {
  const normalized = name?.trim();
  if (!normalized) return undefined;
  assertUserCanvasName(normalized);
  return normalized;
}

function requiredUserCanvasName(name: string) {
  const normalized = optionalUserCanvasName(name);
  if (!normalized) {
    throw new OperationsError(
      'CANVAS_NAME_REQUIRED',
      'Canvas name is required.'
    );
  }
  return normalized;
}

function canonicalTemplateDefaultName(
  template: TemplateCatalogState['templates'][number]
) {
  const isCanonicalSeed = TEMPLATE_FAMILIES.some(
    (definition) =>
      definition.family === template.family &&
      template.id === `official-${definition.family}`
  );
  return isCanonicalSeed
    ? officialCanvasWorkName(template.family)
    : template.name;
}

interface OperationsDependencies {
  assetDataClassResolver?: AssetDataClassResolverPort;
  billingLifecycle?: BillingLifecyclePort;
  briefSubmissionGate?: import('../creation-experience/brief-submission-gate.js').BriefSubmissionGate;
  canvasExportAssetAccess?: CanvasExportAssetAccessPort;
  canvasExporter: CanvasExportPort;
  creationExecutor?: import('./types.js').CreationExecutorPort;
  contentPackageExporter?: ContentPackageExportPort;
  contentPackageDestinationProjection?: ContentPackageDestinationProjectionPort;
  contentPackageApprovalPolicy?: ContentPackageApprovalPolicyPort;
  contentPackageRightsBasisResolver?: ContentPackageRightsBasisResolverPort;
  contentPackageRightsResolver?: ContentPackageRightsResolverPort;
  groundingResolver?: CreativeGroundingResolverPort;
  imageGenerator: ImageGenerationPort;
  mediaCustodyStorage?: MediaCustodyStoragePort;
  notifier: NotificationPort;
  triggerScheduler?: TriggerSchedulePort;
  clock?: () => Date;
  createId?: () => string;
  contentWriteOwnership?: {
    get(
      workspaceId: string
    ): Promise<'legacy' | 'frozen' | 'contentpackage' | null>;
  };
}

interface CreativeJobPreparationOptions {
  approvalReceiptId?: string;
  billingQuoteId?: string;
  briefConfirmationId?: string;
  briefContextId?: string;
  retryOf?: string;
  reroll?: {
    kind: CreativeRerollKind;
    sourceJobId: string;
  };
}

const TEMPLATE_FAMILIES: Array<{
  family: TemplateFamily;
  name: string;
  tags: string[];
}> = [
  {
    family: 'social_cover',
    name: '小红书 / 抖音封面',
    tags: ['封面', '社交媒体'],
  },
  {
    family: 'before_after',
    name: 'Before / After',
    tags: ['案例', '前后对比'],
  },
  { family: 'price_card', name: '价格卡', tags: ['价格', '项目'] },
  { family: 'package_explainer', name: '套餐说明', tags: ['套餐', '说明'] },
  { family: 'review_card', name: '好评卡', tags: ['口碑', '好评'] },
  { family: 'store_intro', name: '门店介绍', tags: ['门店', '品牌'] },
  { family: 'shooting_checklist', name: '拍摄清单', tags: ['拍摄', '清单'] },
];

const CONTENT_MODULE_IDS = new Set<CreativeContentModuleId>([
  'social_cover',
  'before_after',
  'price_card',
  'package_explainer',
  'review_card',
  'store_intro',
  'shooting_checklist',
]);
const DEFAULT_CONTENT_MODULES: CreativeContentModuleId[] = ['social_cover'];

function creativeBillingResource(
  operation: CreativeExecutionContract['operation']
): 'copy' | 'image' | 'video' | 'audio' {
  if (operation.startsWith('copy.')) return 'copy';
  if (operation.startsWith('audio.')) return 'audio';
  if (operation === 'video.generate') return 'video';
  return 'image';
}
const INHERITANCE_FIELD_IDS = new Set<CreativeInheritanceFieldId>([
  'content_structure',
  'layout_slots',
  'copy_skeleton',
  'output_specification',
  'visual_style',
]);

const IMAGE_MODELS = new Set<ImageModelId>([
  'gpt-image-2',
  'nano-banana-2',
  'nano-banana-pro',
  'seedream-4-5',
  'seedream-5-pro',
]);

const TERMINAL_IMAGE_JOB_STATUSES = new Set<CanvasImageJob['status']>([
  'completed',
  'failed',
  'cancelled',
]);
const IMAGE_CANCEL_LEASE_MS = 60_000;

function canvasImageCancelEffectKey(workspaceId: string, jobId: string) {
  return `canvas-image-cancel-${createHash('sha256')
    .update(`${workspaceId}:${jobId}`)
    .digest('hex')}`;
}

function ownerCanUseOfficialTemplate(
  template: TemplateCatalogState['templates'][number]
) {
  return (
    template.publicationStatus === 'published' ||
    (template.publicationStatus === 'enabled' &&
      Boolean(template.publishedVersionId))
  );
}

function selectTemplateVersionIdForWorkspace(
  template: TemplateCatalogState['templates'][number],
  workspaceId: string
) {
  const canarySelected =
    template.publicationStatus === 'enabled' &&
    Boolean(template.enabledVersionId) &&
    templateRolloutBucket(workspaceId, template.id) <
      (template.rolloutPercent ?? 0);
  return canarySelected
    ? template.enabledVersionId
    : template.publishedVersionId;
}

function isCurrentPublishedTemplateVersion(
  template: TemplateCatalogState['templates'][number],
  versionId: string
) {
  return (
    template.publicationStatus !== 'retired' &&
    template.publishedVersionId === versionId
  );
}

function workRetainsTemplateVersion(
  work: CanvasWork,
  templateId: string,
  versionId: string
) {
  return (
    work.templateId === templateId &&
    work.revisions.some((revision) => revision.templateVersionId === versionId)
  );
}

function mergeSearchResults(
  workspaceResults: SearchResult[],
  templateResults: SearchResult[],
  limit: number
) {
  return [...workspaceResults, ...templateResults]
    .filter(
      (result, index, values) =>
        values.findIndex(
          (candidate) =>
            candidate.id === result.id && candidate.kind === result.kind
        ) === index
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.updatedAt.localeCompare(left.updatedAt)
    )
    .slice(0, limit);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)])
    );
  }
  return value;
}

function creativeContractFingerprint(contract: CreativeExecutionContract) {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(contract)))
    .digest('hex');
}

function isWorkspaceSafeVideoObjectKey(
  workspaceId: string,
  objectKey: string | undefined,
) {
  return Boolean(
    objectKey &&
      isExportableOwnedAssetObjectKey(workspaceId, objectKey, 'video/mp4')
  );
}

function hasCanonicalVideoDeliveryEvidence(
  asset: Pick<
    CreativeAssetProjection,
    'compositionEvidence' | 'sha256' | 'sizeBytes'
  >,
  expected: {
    compositionRevision?: string;
    durationSeconds: number;
    storyboardRevision?: string;
    workflowId: string;
    workspaceId: string;
  },
) {
  const evidence = asset.compositionEvidence;
  const delivery = evidence?.delivery;
  return Boolean(
    evidence &&
      delivery &&
      evidence.outputSha256 === asset.sha256 &&
      evidence.outputSizeBytes === asset.sizeBytes &&
      typeof asset.sha256 === 'string' &&
      /^[a-f0-9]{64}$/u.test(asset.sha256) &&
      delivery.outputVideoSha256 === asset.sha256 &&
      delivery.workflowId === expected.workflowId &&
      delivery.workflowId.trim().length > 0 &&
      delivery.storyboardRevision.trim().length > 0 &&
      (!expected.storyboardRevision ||
        delivery.storyboardRevision === expected.storyboardRevision) &&
      delivery.compositionRevision.trim().length > 0 &&
      (!expected.compositionRevision ||
        delivery.compositionRevision === expected.compositionRevision) &&
      Number.isFinite(evidence.durationSeconds) &&
      evidence.durationSeconds === expected.durationSeconds
      // V31-37 path A / V31-61: subtitles and cover are not deliverables —
      // canonical delivery evidence carries no subtitle/cover track.
  );
}

function isVerifiedFirstVideoResult(
  asset: CreativeAssetProjection | undefined,
  job: CreativeJob | undefined,
  context: { workId: string; workspaceId: string },
) {
  const evidence = asset?.compositionEvidence;
  const aigcEnabled = job?.contract.aigcLabelEnabled;
  const watermarkEnabled = job?.contract.watermarkEnabled;
  const durationSeconds = job?.contract.durationSeconds;
  return Boolean(
    asset &&
      job &&
      asset.kind === 'video' &&
      asset.contentType === 'video/mp4' &&
      asset.workspaceId === context.workspaceId &&
      asset.workId === context.workId &&
      asset.ownedAssetId &&
      isWorkspaceSafeVideoObjectKey(context.workspaceId, asset.objectKey) &&
      typeof asset.sha256 === 'string' &&
      /^[a-f0-9]{64}$/u.test(asset.sha256) &&
      Number.isSafeInteger(asset.sizeBytes) &&
      (asset.sizeBytes ?? 0) > 0 &&
      job.workspaceId === context.workspaceId &&
      job.workId === context.workId &&
      job.status === 'completed' &&
      job.outputAssetIds.includes(asset.id) &&
      evidence &&
      evidence.outputSha256 === asset.sha256 &&
      evidence.outputSizeBytes === asset.sizeBytes &&
      evidence.aigc.requested === aigcEnabled &&
      evidence.aigc.visibleLabel.actual === aigcEnabled &&
      evidence.aigc.visibleLabel.validated &&
      evidence.aigc.implicitMetadata.actual === aigcEnabled &&
      evidence.aigc.implicitMetadata.validated &&
      evidence.brandWatermark.requested === watermarkEnabled &&
      evidence.brandWatermark.actual === watermarkEnabled &&
      evidence.brandWatermark.validated &&
      (!watermarkEnabled || Boolean(evidence.brandWatermark.text?.trim())) &&
      job.providerJobId &&
      typeof durationSeconds === 'number' &&
      hasCanonicalVideoDeliveryEvidence(asset, {
        durationSeconds,
        workflowId: job.providerJobId,
        workspaceId: context.workspaceId,
      })
  );
}

function templateRolloutBucket(workspaceId: string, templateId: string) {
  const digest = createHash('sha256')
    .update(`${workspaceId}:${templateId}`)
    .digest();
  return digest.readUInt32BE(0) % 100;
}

const TRANSITIONS: Record<ContentTaskStatus, ContentTaskStatus[]> = {
  todo: [
    'in_progress',
    'needs_review',
    'needs_asset',
    'blocked',
    'ready',
    'done',
    'archived',
  ],
  in_progress: [
    'needs_review',
    'needs_asset',
    'blocked',
    'ready',
    'done',
    'archived',
  ],
  needs_review: ['in_progress', 'blocked', 'ready', 'done', 'archived'],
  needs_asset: ['todo', 'in_progress', 'blocked', 'ready', 'done', 'archived'],
  blocked: ['todo', 'in_progress', 'needs_asset', 'ready', 'done', 'archived'],
  ready: ['in_progress', 'needs_review', 'blocked', 'done', 'archived'],
  done: ['archived'],
  archived: [],
};

function seededTemplateDocument(
  versionId: string,
  definition: (typeof TEMPLATE_FAMILIES)[number]
): CanvasDocument {
  const subtitleByFamily: Record<string, string> = {
    before_after: '前后对比｜真实素材',
    package_explainer: '项目内容｜适合人群｜到店须知',
    price_card: '项目名称｜到店价格',
    review_card: '顾客真实评价',
    shooting_checklist: '环境｜过程｜细节｜完成效果',
    social_cover: '门店项目主标题',
    store_intro: '门店环境｜服务特色｜预约方式',
  };
  return {
    height: 1350,
    pages: [
      {
        elements: [
          {
            fill: '#4B3130',
            fontFamily: 'Noto Sans SC',
            fontSize: 64,
            height: 180,
            id: `${versionId}-headline`,
            kind: 'text',
            rotation: 0,
            text: definition.name,
            width: 840,
            x: 120,
            y: 160,
          },
          {
            fill: '#7A5D58',
            fontFamily: 'Noto Sans SC',
            fontSize: 36,
            height: 240,
            id: `${versionId}-subtitle`,
            kind: 'text',
            rotation: 0,
            text:
              subtitleByFamily[definition.family] ??
              `${definition.name}｜编辑文字与素材`,
            width: 840,
            x: 120,
            y: 380,
          },
        ],
        id: `${versionId}-page`,
      },
    ],
    width: 1080,
  };
}

function initialWorkspace(workspaceId: string): OperationsWorkspaceState {
  return {
    workspaceId,
    commandReceipts: [],
    tasks: [],
    taskEvents: [],
    taskSourceLinks: [],
    triggerConfigs: [],
    triggerRuns: [],
    weeklyFacts: [],
    weeklyReviews: [],
    weeklyBatchExecutions: [],
    works: [],
    userTemplates: [],
    templateShortcuts: [],
    exportReceipts: [],
    imageJobs: [],
    composerConversations: [],
    creativeWorks: [],
    creativeGenerationApprovalReceipts: [],
    creativeJobs: [],
    creativeAssets: [],
    creativeContents: [],
    contentPackages: [],
    creationEvents: [],
    auditEvents: [],
  };
}

function dateOnly(value: string) {
  return value.slice(0, 10);
}

function isoWeekStart(value: string | Date) {
  const date = new Date(value);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function taskSearchMetadata(task: ContentTask) {
  return {
    dueDate: dateOnly(task.dueAt),
    relatedKind: task.relatedObject?.kind ?? 'none',
    risk: task.risk,
    source: task.source,
    status: task.status,
  };
}

function triggerDueAt(timeWindow: string, fallback: string) {
  const match = /^(\d{4})-W(\d{2})$/.exec(timeWindow);
  if (!match) return fallback;
  const year = Number(match[1]);
  const week = Number(match[2]);
  const januaryFourth = new Date(Date.UTC(year, 0, 4, 9));
  const mondayOffset = (januaryFourth.getUTCDay() + 6) % 7;
  januaryFourth.setUTCDate(
    januaryFourth.getUTCDate() - mondayOffset + (week - 1) * 7
  );
  return januaryFourth.toISOString();
}

function within(value: string, from?: string, to?: string) {
  return (!from || value >= from) && (!to || value <= to);
}

function taskMatches(task: ContentTask, filter: TaskFilter) {
  if (filter.statuses && !filter.statuses.includes(task.status)) return false;
  if (filter.sources && !filter.sources.includes(task.source)) return false;
  if (filter.risks && !filter.risks.includes(task.risk)) return false;
  if (!within(task.dueAt, filter.from, filter.to)) return false;
  if (
    filter.relatedObject &&
    (task.relatedObject?.id !== filter.relatedObject.id ||
      task.relatedObject.kind !== filter.relatedObject.kind)
  ) {
    return false;
  }
  if (
    filter.relatedKinds?.length &&
    (!task.relatedObject ||
      !filter.relatedKinds.includes(task.relatedObject.kind))
  ) {
    return false;
  }
  return true;
}

function validateDocument(document: CanvasDocument) {
  if (
    document.width <= 0 ||
    document.height <= 0 ||
    document.pages.length === 0
  ) {
    throw new OperationsError(
      'INVALID_CANVAS_DOCUMENT',
      'Canvas width, height, and at least one page are required.'
    );
  }
}

function metric(facts: WeeklyFact[], kind: WeeklyFactKind) {
  const count = facts.filter((fact) => fact.kind === kind).length;
  return count > 0
    ? ({ status: 'known', value: count } as const)
    : ({ status: 'unknown' } as const);
}

const WEEKLY_FACT_KINDS = new Set<WeeklyFactKind>([
  'planned',
  'drafted',
  'confirmed',
  'published_mark',
  'asset_gap',
]);

function omitUnknownWeeklyFacts(state: OperationsWorkspaceState) {
  // Fail closed at the read boundary: retired or future persisted kinds do not
  // regain a write or review surface merely because an old JSONB row remains.
  state.weeklyFacts = state.weeklyFacts.filter((fact) =>
    WEEKLY_FACT_KINDS.has(fact.kind)
  );
  return state;
}

function triggerTask(kind: BuiltInTriggerKind, dueAt: string): CreateTaskInput {
  switch (kind) {
    case 'weekly_batch_ready':
      return {
        dueAt,
        executable: true,
        risk: 'normal',
        source: 'weekly_batch',
        title: '本周内容批次已就绪',
      };
    case 'asset_gap_detected':
      return {
        blockedReason: '缺少完成本周内容所需的素材',
        dueAt,
        executable: false,
        nextStep: '打开素材库补充素材',
        risk: 'attention',
        source: 'asset_gap',
        title: '补齐本周素材缺口',
      };
    case 'stale_draft_detected':
      return {
        dueAt,
        executable: true,
        risk: 'normal',
        source: 'stale_draft',
        title: '确认久未处理的内容草稿',
      };
    case 'weekly_review_ready':
      return {
        dueAt,
        executable: true,
        risk: 'normal',
        source: 'weekly_review',
        title: '查看本周运营回顾',
      };
  }
}

const TRIGGER_CRON: Record<BuiltInTriggerKind, string> = {
  asset_gap_detected: '0 10 * * *',
  stale_draft_detected: '0 11 * * *',
  weekly_batch_ready: '0 9 * * 1',
  weekly_review_ready: '0 18 * * 5',
};

export class OperationsApplicationService {
  private readonly now: () => Date;
  private readonly id: () => string;
  private readonly moduleCommand = new AsyncLocalStorage<{
    consumed: boolean;
    context: OperationContext;
    idempotencyKey: string;
    payloadHash: string;
    replayed: boolean;
  }>();
  private composerConversationDeletionNotifier?: ComposerConversationDeletionNotificationPort;

  constructor(
    private readonly repository: OperationsRepository,
    private readonly dependencies: OperationsDependencies
  ) {
    this.now = dependencies.clock ?? (() => new Date());
    this.id = dependencies.createId ?? randomUUID;
  }

  attachBriefSubmissionGate(
    gate: import('../creation-experience/brief-submission-gate.js').BriefSubmissionGate,
  ) {
    this.dependencies.briefSubmissionGate = gate;
  }

  attachComposerConversationDeletionNotifier(
    notifier: ComposerConversationDeletionNotificationPort,
  ) {
    this.composerConversationDeletionNotifier = notifier;
  }

  private timestamp() {
    return this.now().toISOString();
  }

  private async projectContentPackageDestinations(
    workspaceId: string,
    contentPackages: readonly ContentPackage[]
  ): Promise<ContentPackage[]> {
    const projection = this.dependencies.contentPackageDestinationProjection;
    const references = contentPackages.flatMap((contentPackage) => {
      const snapshotId = contentPackage.source.creationExecutionSnapshot?.id;
      return snapshotId
        ? [{ packageId: contentPackage.id, snapshotId }]
        : [];
    });
    const destinations =
      projection && references.length > 0
        ? await projection.resolve({ references, workspaceId })
        : [];
    const byReference = new Map(
      destinations.map((destination) => [
        JSON.stringify([destination.packageId, destination.snapshotId]),
        destination,
      ])
    );
    return contentPackages.map((contentPackage) => {
      const snapshot = contentPackage.source.creationExecutionSnapshot;
      if (!snapshot) return contentPackage;
      const sanitizedSnapshot = { ...snapshot };
      delete sanitizedSnapshot.contentPackagePlatform;
      delete sanitizedSnapshot.distributionTarget;
      const destination = byReference.get(
        JSON.stringify([contentPackage.id, snapshot.id])
      );
      const sanitizedContentPackage = {
        ...contentPackage,
        source: {
          ...contentPackage.source,
          creationExecutionSnapshot: sanitizedSnapshot,
        },
      };
      if (!destination) return sanitizedContentPackage;
      return {
        ...sanitizedContentPackage,
        source: {
          ...sanitizedContentPackage.source,
          creationExecutionSnapshot: {
            ...sanitizedSnapshot,
            contentPackagePlatform: destination.contentPackagePlatform,
            distributionTarget: destination.distributionTarget,
          },
        },
      };
    });
  }

  private appendTemplateLifecycle(
    catalog: TemplateCatalogState,
    context: OperationContext,
    versionId: string,
    action: 'enabled' | 'published' | 'retired',
    rolloutPercent: number,
    occurredAt: string,
    reason?: string
  ) {
    const version = catalog.versions.find((item) => item.id === versionId);
    if (!version) {
      throw new OperationsError(
        'TEMPLATE_VERSION_NOT_FOUND',
        'Template version was not found.',
        404
      );
    }
    const event = {
      action,
      actorId: context.userId,
      correlationId: context.correlationId,
      id: this.id(),
      occurredAt,
      rolloutPercent,
      ...(reason ? { reason } : {}),
      sequence:
        catalog.versionLifecycle.filter(
          (candidate) => candidate.versionId === versionId
        ).length + 1,
      templateId: version.templateId,
      versionId,
    } as const;
    catalog.versionLifecycle.push(event);
    return event;
  }

  async executeIdempotentModuleCommand<T>(
    context: OperationContext,
    idempotencyKey: string,
    input: Record<string, unknown>,
    action: () => Promise<T>
  ): Promise<T> {
    const payloadHash = createHash('sha256')
      .update(JSON.stringify(stableValue(input)))
      .digest('hex');
    const existing = await this.findModuleCommandReceipt(
      context.workspaceId,
      idempotencyKey
    );
    if (existing && existing.payloadHash !== payloadHash) {
      throw new OperationsError(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency key was reused with a different Operations payload.',
        409
      );
    }
    if (existing?.status === 'completed') {
      return structuredClone(existing.result) as T;
    }
    const result = await this.moduleCommand.run(
      {
        consumed: false,
        context,
        idempotencyKey,
        payloadHash,
        replayed: Boolean(existing),
      },
      action
    );
    await this.completeModuleCommandReceipt(
      context.workspaceId,
      idempotencyKey,
      payloadHash,
      result
    );
    return result;
  }

  private async findModuleCommandReceipt(
    workspaceId: string,
    idempotencyKey: string
  ) {
    const state = await this.repository.loadWorkspace(workspaceId);
    const workspaceReceipt = state?.commandReceipts.find(
      (receipt) => receipt.idempotencyKey === idempotencyKey
    );
    if (workspaceReceipt) return workspaceReceipt;
    const catalog = await this.repository.loadTemplateCatalog();
    return catalog.commandReceipts.find(
      (receipt) =>
        receipt.workspaceId === workspaceId &&
        receipt.idempotencyKey === idempotencyKey
    );
  }

  private async completeModuleCommandReceipt<T>(
    workspaceId: string,
    idempotencyKey: string,
    payloadHash: string,
    result: T
  ) {
    const state = await this.repository.loadWorkspace(workspaceId);
    if (
      state?.commandReceipts.some(
        (receipt) => receipt.idempotencyKey === idempotencyKey
      )
    ) {
      await this.repository.withWorkspaceLock(
        workspaceId,
        async (repository) => {
          const current = await repository.loadWorkspace(workspaceId);
          const receipt = current?.commandReceipts.find(
            (candidate) => candidate.idempotencyKey === idempotencyKey
          );
          if (!current || !receipt || receipt.payloadHash !== payloadHash) {
            throw new OperationsError(
              'IDEMPOTENCY_CONFLICT',
              'Operations command receipt changed before completion.',
              409
            );
          }
          receipt.result = structuredClone(result);
          receipt.status = 'completed';
          await repository.saveWorkspace(current);
        }
      );
      return;
    }
    const catalog = await this.repository.loadTemplateCatalog();
    if (
      !catalog.commandReceipts.some(
        (receipt) =>
          receipt.workspaceId === workspaceId &&
          receipt.idempotencyKey === idempotencyKey
      )
    ) {
      return;
    }
    await this.repository.withWorkspaceLock(
      '__template_catalog__',
      async (repository) => {
        const current = await repository.loadTemplateCatalog();
        const receipt = current.commandReceipts.find(
          (candidate) =>
            candidate.workspaceId === workspaceId &&
            candidate.idempotencyKey === idempotencyKey
        );
        if (!receipt || receipt.payloadHash !== payloadHash) {
          throw new OperationsError(
            'IDEMPOTENCY_CONFLICT',
            'Template command receipt changed before completion.',
            409
          );
        }
        receipt.result = structuredClone(result);
        receipt.status = 'completed';
        await repository.saveTemplateCatalog(current);
      }
    );
  }

  private async mutateCatalog<T>(
    context: OperationContext,
    action: (catalog: TemplateCatalogState) => Promise<T> | T
  ): Promise<T> {
    return this.repository.withWorkspaceLock(
      '__template_catalog__',
      async (repository) => {
        const catalog = await repository.loadTemplateCatalog();
        catalog.commandReceipts ??= [];
        catalog.versionLifecycle ??= [];
        const command = this.moduleCommand.getStore();
        const receipt =
          command && !command.consumed
            ? catalog.commandReceipts.find(
                (candidate) =>
                  candidate.workspaceId === context.workspaceId &&
                  candidate.idempotencyKey === command.idempotencyKey
              )
            : undefined;
        if (receipt && receipt.payloadHash !== command?.payloadHash) {
          throw new OperationsError(
            'IDEMPOTENCY_CONFLICT',
            'Idempotency key was reused with a different template payload.',
            409
          );
        }
        const result = receipt
          ? (structuredClone(receipt.result) as T)
          : await action(catalog);
        if (receipt && command) command.replayed = true;
        if (command && !command.consumed && !receipt) {
          catalog.commandReceipts.push({
            actorId: context.userId,
            correlationId: context.correlationId,
            createdAt: this.timestamp(),
            id: `${context.workspaceId}:${command.idempotencyKey}`,
            idempotencyKey: command.idempotencyKey,
            payloadHash: command.payloadHash,
            status: 'pending',
            result: structuredClone(result),
            workspaceId: context.workspaceId,
          });
        }
        await repository.saveTemplateCatalog(catalog);
        if (command && !command.consumed) command.consumed = true;
        return result;
      }
    );
  }

  private async authorize(context: OperationContext) {
    if (context.actor === 'admin' || context.actor === 'worker') return;
    if (
      !(await this.repository.hasMembership(
        context.userId,
        context.workspaceId
      ))
    ) {
      throw new OperationsError(
        'WORKSPACE_FORBIDDEN',
        'Workspace access denied.',
        403
      );
    }
  }

  private audit(
    state: OperationsWorkspaceState,
    context: OperationContext,
    action: string,
    entityType: string,
    entityId: string,
    details?: Record<string, unknown>
  ) {
    const event: OperationsAuditEvent = {
      action,
      actorId: context.userId,
      correlationId: context.correlationId,
      createdAt: this.timestamp(),
      details,
      entityId,
      entityType,
      id: this.id(),
      workspaceId: context.workspaceId,
    };
    state.auditEvents.push(event);
  }

  private async assertContentPackageVisibleCopyPolicy(input: {
    contentPackage: ContentPackage;
    phase: 'delivery' | 'export';
    target: string;
    versionId: string;
  }) {
    const result = await validateContentPackageVisibleCopyPolicy({
      approvalPolicy: this.dependencies.contentPackageApprovalPolicy,
      contentPackage: input.contentPackage,
      intendedUse: 'public_content',
      phase: input.phase,
      target: input.target,
      versionId: input.versionId,
    });
    const failure = result.failures[0];
    if (failure) {
      throw new OperationsError(
        'CONTENT_PACKAGE_POLICY_REJECTED',
        failure.reason,
        409,
        {
          gateId: failure.gateId,
          triggeredClaims: failure.triggeredClaims ?? [],
        }
      );
    }
    return result.claimExtraction!;
  }

  private async requireContentPackageRevision(
    context: OperationContext,
    contentPackage: ContentPackage,
    expectedRevision: number
  ) {
    if (contentPackage.revision === expectedRevision) return;
    const occurredAt = this.timestamp();
    await this.repository.recordContentPackageRevisionConflict({
      actorId: context.userId,
      correlationId: context.correlationId,
      currentRevision: contentPackage.revision,
      expectedRevision,
      occurredAt,
      packageId: contentPackage.id,
      workspaceId: context.workspaceId,
    });
    throw new OperationsError(
      'CONTENT_PACKAGE_REVISION_CONFLICT',
      `ContentPackage revision changed from ${expectedRevision} to ${contentPackage.revision}. Refresh and retry.`,
      409,
      {
        correlationId: context.correlationId,
        currentRevision: contentPackage.revision,
        expectedRevision,
        packageId: contentPackage.id,
      }
    );
  }

  private incrementContentPackageRevision(
    current: ContentPackage,
    updated: ContentPackage
  ): ContentPackage {
    return { ...updated, revision: current.revision + 1 };
  }

  private appendWeeklyFact(
    state: OperationsWorkspaceState,
    context: OperationContext,
    input: Pick<WeeklyFact, 'kind' | 'occurredAt' | 'sourceId'>,
    origin: WeeklyFact['origin']
  ) {
    const existing = state.weeklyFacts.find(
      (fact) => fact.kind === input.kind && fact.sourceId === input.sourceId
    );
    if (existing) return existing;
    const fact: WeeklyFact = {
      ...input,
      correlationId: context.correlationId,
      createdAt: this.timestamp(),
      id: this.id(),
      origin,
      workspaceId: context.workspaceId,
    };
    state.weeklyFacts.push(fact);
    this.audit(state, context, 'weekly_fact.recorded', 'weekly_fact', fact.id, {
      kind: fact.kind,
      origin,
      sourceId: fact.sourceId,
    });
    return fact;
  }

  private appendTaskStatusFact(
    state: OperationsWorkspaceState,
    context: OperationContext,
    task: ContentTask,
    status: ContentTaskStatus,
    occurredAt: string
  ) {
    if (status === 'needs_asset') {
      this.appendWeeklyFact(
        state,
        context,
        { kind: 'asset_gap', occurredAt, sourceId: task.id },
        'automatic'
      );
      return;
    }
    if (status !== 'done') return;
    this.appendWeeklyFact(
      state,
      context,
      {
        kind: task.source === 'publish_ready' ? 'published_mark' : 'confirmed',
        occurredAt,
        sourceId: task.id,
      },
      'automatic'
    );
  }

  private async read(context: OperationContext) {
    await this.authorize(context);
    const state =
      (await this.repository.loadWorkspace(context.workspaceId)) ??
      initialWorkspace(context.workspaceId);
    return omitUnknownWeeklyFacts(state);
  }

  private async assertBriefCurrentForWrite(
    repository: OperationsRepository,
    input: Parameters<
      import('../creation-experience/brief-submission-gate.js').BriefSubmissionGate['assertCurrent']
    >[0],
  ) {
    const gate = this.dependencies.briefSubmissionGate;
    if (!gate) {
      throw new OperationsError(
        'BRIEF_GATE_UNAVAILABLE',
        'The server Brief submission gate is unavailable.',
        503,
      );
    }
    const lockedRevision = await repository.lockBriefRevisionContext(
      input.workspaceId,
      input.briefContextId,
    );
    const expectedContextRevision =
      input.expectedContextRevision ?? lockedRevision ?? undefined;
    const validated = await gate.assertCurrent({
      ...input,
      ...(expectedContextRevision === undefined
        ? {}
        : { expectedContextRevision }),
    });
    return validated?.contextRevision ?? expectedContextRevision;
  }

  private async mutate<T>(
    context: OperationContext,
    action: (
      state: OperationsWorkspaceState,
      repository: OperationsRepository
    ) => Promise<T> | T
  ) {
    await this.authorize(context);
    return this.repository.withWorkspaceLock(
      context.workspaceId,
      async (repository) => {
        const loaded =
          (await repository.loadWorkspace(context.workspaceId)) ??
          initialWorkspace(context.workspaceId);
        const state = omitUnknownWeeklyFacts(loaded);
        const command = this.moduleCommand.getStore();
        const receipt =
          command && !command.consumed
            ? state.commandReceipts.find(
                (candidate) =>
                  candidate.idempotencyKey === command.idempotencyKey
              )
            : undefined;
        if (receipt && receipt.payloadHash !== command?.payloadHash) {
          throw new OperationsError(
            'IDEMPOTENCY_CONFLICT',
            'Idempotency key was reused with a different Operations payload.',
            409
          );
        }
        const result = receipt
          ? (structuredClone(receipt.result) as T)
          : await action(state, repository);
        if (receipt && command) command.replayed = true;
        if (command && !command.consumed && !receipt) {
          state.commandReceipts.push({
            actorId: command.context.userId,
            correlationId: command.context.correlationId,
            createdAt: this.timestamp(),
            id: `${command.context.workspaceId}:${command.idempotencyKey}`,
            idempotencyKey: command.idempotencyKey,
            payloadHash: command.payloadHash,
            status: 'pending',
            result: structuredClone(result),
            workspaceId: command.context.workspaceId,
          });
        }
        try {
          await repository.saveWorkspace(state);
        } catch (error) {
          if (!(error instanceof ContentPackageRevisionConflictError)) {
            throw error;
          }
          const occurredAt = this.timestamp();
          await this.repository.recordContentPackageRevisionConflict({
            actorId: context.userId,
            correlationId: context.correlationId,
            currentRevision: error.currentRevision,
            expectedRevision: error.expectedRevision,
            occurredAt,
            packageId: error.packageId,
            workspaceId: context.workspaceId,
          });
          throw new OperationsError(
            error.code,
            `ContentPackage revision changed from ${error.expectedRevision} to ${error.currentRevision}. Refresh and retry.`,
            error.status,
            {
              correlationId: context.correlationId,
              currentRevision: error.currentRevision,
              expectedRevision: error.expectedRevision,
              packageId: error.packageId,
            }
          );
        }
        if (command && !command.consumed) command.consumed = true;
        return result;
      }
    );
  }

  private createdEvent(
    context: OperationContext,
    task: ContentTask
  ): TaskEvent {
    return {
      actorId: context.userId,
      correlationId: context.correlationId,
      createdAt: this.timestamp(),
      event: 'created',
      id: this.id(),
      taskId: task.id,
      toStatus: task.status,
      workspaceId: context.workspaceId,
    };
  }

  private async createTaskInState(
    context: OperationContext,
    state: OperationsWorkspaceState,
    input: CreateTaskInput
  ) {
    const timestamp = this.timestamp();
    const status: ContentTaskStatus = input.executable
      ? 'todo'
      : input.source === 'asset_gap'
        ? 'needs_asset'
        : 'blocked';
    const task: ContentTask = {
      ...input,
      createdAt: timestamp,
      id: this.id(),
      status,
      updatedAt: timestamp,
      workspaceId: context.workspaceId,
    };
    state.tasks.push(task);
    state.taskEvents.push(this.createdEvent(context, task));
    this.appendWeeklyFact(
      state,
      context,
      { kind: 'planned', occurredAt: timestamp, sourceId: task.id },
      'automatic'
    );
    this.appendTaskStatusFact(state, context, task, task.status, timestamp);
    if (input.relatedObject) {
      state.taskSourceLinks.push({
        createdAt: timestamp,
        id: this.id(),
        sourceId: input.relatedObject.id,
        sourceKind: input.relatedObject.kind,
        taskId: task.id,
        workspaceId: context.workspaceId,
      });
    }
    this.audit(state, context, 'task.created', 'content_task', task.id, {
      source: task.source,
    });
    return task;
  }

  async createTask(context: OperationContext, input: CreateTaskInput) {
    const task = await this.mutate(context, (state) => {
      const existing = input.dedupeKey
        ? state.tasks.find(
            (candidate) =>
              candidate.dedupeKey === input.dedupeKey &&
              candidate.status !== 'archived'
          )
        : undefined;
      return existing ?? this.createTaskInState(context, state, input);
    });
    await this.repository.upsertSearchDocument({
      id: task.id,
      kind: 'task',
      metadata: taskSearchMetadata(task),
      tags: [task.source, task.risk],
      text: [task.blockedReason, task.nextStep].filter(Boolean).join(' '),
      title: task.title,
      updatedAt: task.updatedAt,
      workspaceId: context.workspaceId,
    });
    return task;
  }

  async transitionTask(
    context: OperationContext,
    taskId: string,
    nextStatus: ContentTaskStatus,
    reason?: string
  ) {
    const task = await this.mutate(context, (state) => {
      const current = state.tasks.find((item) => item.id === taskId);
      if (!current)
        throw new OperationsError('TASK_NOT_FOUND', 'Task was not found.', 404);
      if (current.status === nextStatus) return current;
      if (!TRANSITIONS[current.status].includes(nextStatus)) {
        throw new OperationsError(
          'INVALID_TASK_TRANSITION',
          `Cannot transition task from ${current.status} to ${nextStatus}.`,
          409
        );
      }
      const previous = current.status;
      current.status = nextStatus;
      current.updatedAt = this.timestamp();
      state.taskEvents.push({
        actorId: context.userId,
        correlationId: context.correlationId,
        createdAt: current.updatedAt,
        event: 'status_changed',
        fromStatus: previous,
        id: this.id(),
        reason,
        taskId,
        toStatus: nextStatus,
        workspaceId: context.workspaceId,
      });
      this.appendTaskStatusFact(
        state,
        context,
        current,
        nextStatus,
        current.updatedAt
      );
      this.audit(
        state,
        context,
        'task.status_changed',
        'content_task',
        taskId,
        {
          from: previous,
          reason,
          to: nextStatus,
        }
      );
      return current;
    });
    await this.repository.upsertSearchDocument({
      id: task.id,
      kind: 'task',
      metadata: taskSearchMetadata(task),
      tags: [task.source, task.risk],
      text: [task.blockedReason, task.nextStep].filter(Boolean).join(' '),
      title: task.title,
      updatedAt: task.updatedAt,
      workspaceId: context.workspaceId,
    });
    return task;
  }

  async listInbox(
    context: OperationContext,
    filter: TaskFilter = {}
  ): Promise<InboxProjection> {
    const state = await this.read(context);
    const tasks = state.tasks
      .filter((task) => taskMatches(task, filter))
      .sort((left, right) => left.dueAt.localeCompare(right.dueAt));
    const from = isoWeekStart(filter.from ?? this.now());
    const weekStrip = Array.from({ length: 5 }, (_, index) => {
      const day = new Date(from);
      day.setUTCDate(day.getUTCDate() + index);
      const date = dateOnly(day.toISOString());
      const dayTasks = state.tasks.filter(
        (task) => dateOnly(task.dueAt) === date
      );
      return {
        contentGapCount: dayTasks.filter(
          (task) => task.status === 'needs_asset'
        ).length,
        date,
        statuses: [...new Set(dayTasks.map((task) => task.status))],
        taskCount: dayTasks.length,
      };
    });
    return {
      counts: state.tasks.reduce<InboxProjection['counts']>((counts, task) => {
        counts[task.status] = (counts[task.status] ?? 0) + 1;
        return counts;
      }, {}),
      renderSeam: 'inline-task-components',
      tasks,
      weekStrip,
    };
  }


  async runTrigger(
    context: OperationContext,
    input: Parameters<typeof triggerTask>[0] extends never
      ? never
      : {
          kind: BuiltInTriggerKind;
          timeWindow: string;
          sourceId: string;
        }
  ) {
    const outcome = await this.mutate(context, async (state) => {
      const config = state.triggerConfigs.find(
        (item) => item.kind === input.kind
      );
      const previousRun = state.triggerRuns.find(
        (run) => run.kind === input.kind && run.timeWindow === input.timeWindow
      );
      if (previousRun) {
        if (previousRun.status === 'disabled') {
          return {
            disabled: true as const,
            notify: false,
            run: previousRun,
          };
        }
        const task = previousRun.taskId
          ? state.tasks.find((candidate) => candidate.id === previousRun.taskId)
          : undefined;
        if (task) {
          const notificationReceiptMissing =
            previousRun.status === 'created' &&
            previousRun.notificationStatus === undefined;
          return {
            deduplicated: true as const,
            disabled: false as const,
            notify: notificationReceiptMissing,
            run: { ...previousRun, status: 'deduplicated' as const },
            task,
          };
        }
        throw new OperationsError(
          'TRIGGER_RUN_TERMINAL',
          'This trigger window already has a terminal run.',
          409
        );
      }
      if (!config?.enabled) {
        const run = {
          createdAt: this.timestamp(),
          id: this.id(),
          kind: input.kind,
          status: 'disabled' as const,
          timeWindow: input.timeWindow,
          workspaceId: context.workspaceId,
        };
        state.triggerRuns.push(run);
        this.audit(
          state,
          context,
          'trigger.run_disabled',
          'trigger_run',
          run.id,
          {
            kind: input.kind,
            timeWindow: input.timeWindow,
          }
        );
        return { disabled: true as const, notify: false, run };
      }
      const dedupeKey = `${context.workspaceId}:${input.kind}:${input.timeWindow}`;
      const existing = state.tasks.find((task) => task.dedupeKey === dedupeKey);
      if (existing) {
        const run = {
          createdAt: this.timestamp(),
          id: this.id(),
          kind: input.kind,
          status: 'deduplicated' as const,
          taskId: existing.id,
          timeWindow: input.timeWindow,
          workspaceId: context.workspaceId,
        };
        state.triggerRuns.push(run);
        this.audit(
          state,
          context,
          'trigger.run_deduplicated',
          'trigger_run',
          run.id,
          {
            kind: input.kind,
            taskId: existing.id,
            timeWindow: input.timeWindow,
          }
        );
        return {
          deduplicated: true as const,
          disabled: false as const,
          notify: false,
          run,
          task: existing,
        };
      }
      const task = await this.createTaskInState(context, state, {
        ...triggerTask(
          input.kind,
          triggerDueAt(input.timeWindow, this.timestamp())
        ),
        dedupeKey,
        relatedObject: { id: input.sourceId, kind: 'review' },
      });
      state.taskSourceLinks.push({
        createdAt: this.timestamp(),
        id: this.id(),
        sourceId: input.sourceId,
        sourceKind: 'trigger',
        taskId: task.id,
        workspaceId: context.workspaceId,
      });
      const run = {
        createdAt: this.timestamp(),
        id: this.id(),
        kind: input.kind,
        status: 'created' as const,
        taskId: task.id,
        timeWindow: input.timeWindow,
        workspaceId: context.workspaceId,
      };
      state.triggerRuns.push(run);
      this.audit(state, context, 'trigger.run_created', 'trigger_run', run.id, {
        kind: input.kind,
        taskId: task.id,
        timeWindow: input.timeWindow,
      });
      return {
        deduplicated: false as const,
        disabled: false as const,
        notify: true,
        run,
        task,
      };
    });

    if (outcome.disabled) {
      throw new OperationsError(
        'TRIGGER_DISABLED',
        'The built-in trigger is disabled.',
        409
      );
    }
    if (!outcome.notify) return outcome;
    try {
      await this.dependencies.notifier.send({
        idempotencyKey: `trigger-notification:${context.workspaceId}:${outcome.run.id}`,
        nextStep: outcome.task.nextStep,
        taskId: outcome.task.id,
        title: outcome.task.title,
        workspaceId: context.workspaceId,
      });
    } catch (error) {
      await this.recordNotificationResult(
        context,
        outcome.task.id,
        'failed',
        error instanceof Error ? error.message : 'notification failed'
      );
      return outcome;
    }
    await this.recordNotificationResult(context, outcome.task.id, 'sent');
    return outcome;
  }


  private async recordNotificationResult(
    context: OperationContext,
    taskId: string,
    status: 'sent' | 'failed',
    reason?: string
  ) {
    await this.mutate(context, (state) => {
      const run = [...state.triggerRuns]
        .reverse()
        .find((item) => item.taskId === taskId && item.status === 'created');
      if (run?.notificationStatus === status) return;
      if (run?.notificationStatus === 'sent' && status === 'failed') return;
      if (run) {
        run.notificationStatus = status;
        run.error = reason;
      }
      state.taskEvents.push({
        actorId: context.userId,
        correlationId: context.correlationId,
        createdAt: this.timestamp(),
        event: status === 'sent' ? 'notification_sent' : 'notification_failed',
        id: this.id(),
        reason,
        taskId,
        workspaceId: context.workspaceId,
      });
      this.audit(
        state,
        context,
        `task.notification_${status}`,
        'content_task',
        taskId,
        {
          reason,
        }
      );
    });
  }


  async seedOfficialTemplateFamilies(context: OperationContext) {
    await this.authorize(context);
    if (context.actor !== 'admin') {
      throw new OperationsError(
        'ADMIN_REQUIRED',
        'Admin identity is required.',
        403
      );
    }
    return this.mutateCatalog(context, async (catalog) => {
      for (const definition of TEMPLATE_FAMILIES) {
        const existingTemplate = catalog.templates.find(
          (template) => template.family === definition.family
        );
        if (existingTemplate) {
          if (existingTemplate.publicationStatus !== 'published') continue;
          const publishedVersion = catalog.versions.find(
            (version) => version.id === existingTemplate.publishedVersionId
          );
          if (
            publishedVersion?.document.pages.some(
              (page) => page.elements.length > 0
            )
          ) {
            continue;
          }
          const timestamp = this.timestamp();
          const nextRevision =
            Math.max(
              0,
              ...catalog.versions
                .filter((version) => version.templateId === existingTemplate.id)
                .map((version) => version.revision)
            ) + 1;
          const versionId = `${existingTemplate.id}-v${nextRevision}-seeded-preview`;
          catalog.versions.push({
            createdAt: timestamp,
            createdBy: context.userId,
            document: seededTemplateDocument(versionId, definition),
            id: versionId,
            publishedAt: timestamp,
            revision: nextRevision,
            rolloutPercent: 100,
            status: 'published',
            templateId: existingTemplate.id,
          });
          existingTemplate.publishedAt = timestamp;
          existingTemplate.publishedVersionId = versionId;
          existingTemplate.rolloutPercent = 100;
          existingTemplate.updatedAt = timestamp;
          this.appendTemplateLifecycle(
            catalog,
            context,
            versionId,
            'published',
            100,
            timestamp
          );
          continue;
        }
        const timestamp = this.timestamp();
        const templateId = `official-${definition.family}`;
        const versionId = `${templateId}-v1`;
        catalog.templates.push({
          createdAt: timestamp,
          family: definition.family,
          id: templateId,
          name: definition.name,
          publicationStatus: 'published',
          publishedAt: timestamp,
          publishedVersionId: versionId,
          rolloutPercent: 100,
          tags: definition.tags,
          updatedAt: timestamp,
        });
        catalog.versions.push({
          createdAt: timestamp,
          createdBy: context.userId,
          document: seededTemplateDocument(versionId, definition),
          id: versionId,
          publishedAt: timestamp,
          revision: 1,
          rolloutPercent: 100,
          status: 'published',
          templateId,
        });
        this.appendTemplateLifecycle(
          catalog,
          context,
          versionId,
          'published',
          100,
          timestamp
        );
      }
      return catalog;
    });
  }

  async createOfficialTemplate(
    context: OperationContext,
    input: {
      family: TemplateFamily;
      name: string;
      tags: string[];
      document?: CanvasDocument;
    }
  ) {
    await this.authorize(context);
    if (context.actor !== 'admin') {
      throw new OperationsError(
        'ADMIN_REQUIRED',
        'Admin identity is required.',
        403
      );
    }
    const family = input.family.trim();
    const name = input.name.trim();
    if (!family || !name) {
      throw new OperationsError(
        'INVALID_TEMPLATE',
        'Template family and name are required.'
      );
    }
    assertUserCanvasName(name);
    if (input.document) validateDocument(input.document);
    const created = await this.mutateCatalog(context, async (catalog) => {
      const timestamp = this.timestamp();
      const familySlug =
        family
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || 'custom';
      const templateId = `official-${familySlug}-${this.id()}`;
      const template = {
        createdAt: timestamp,
        family,
        id: templateId,
        name,
        publicationStatus: 'draft' as const,
        tags: [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))],
        updatedAt: timestamp,
      };
      catalog.templates.push(template);
      let version: TemplateVersion | undefined;
      if (input.document) {
        version = {
          createdAt: timestamp,
          createdBy: context.userId,
          document: structuredClone(input.document),
          id: `${templateId}-v1-${this.id()}`,
          revision: 1,
          rolloutPercent: 0,
          status: 'draft',
          templateId,
        };
        catalog.versions.push(version);
      }
      return { template, version };
    });
    if (!this.moduleCommand.getStore()?.replayed) {
      await this.mutate(context, (state) => {
        this.audit(
          state,
          context,
          'template.created',
          'official_template',
          created.template.id,
          {
            family: created.template.family,
            versionId: created.version?.id,
          }
        );
      });
    }
    return created;
  }

  async listTemplates(
    context: OperationContext,
    filter: {
      families?: TemplateFamily[];
      official?: boolean;
      publicationStatuses?: Array<
        'draft' | 'enabled' | 'published' | 'retired'
      >;
      tags?: string[];
    } = {}
  ) {
    await this.authorize(context);
    const catalog = await this.repository.loadTemplateCatalog();
    if (filter.official === false) return [];
    return catalog.templates.filter((template) => {
      if (context.actor !== 'admin' && !ownerCanUseOfficialTemplate(template)) {
        return false;
      }
      if (filter.families && !filter.families.includes(template.family))
        return false;
      if (
        filter.publicationStatuses &&
        !filter.publicationStatuses.includes(template.publicationStatus)
      ) {
        return false;
      }
      if (
        filter.tags &&
        !filter.tags.every((tag) => template.tags.includes(tag))
      ) {
        return false;
      }
      return true;
    });
  }

  async getTemplateCatalogHistory(
    context: OperationContext,
    templateId?: string
  ): Promise<TemplateCatalogHistory> {
    await this.authorize(context);
    if (context.actor !== 'admin') {
      throw new OperationsError(
        'ADMIN_REQUIRED',
        'Admin identity is required.',
        403
      );
    }
    const catalog =
      await this.repository.loadTemplateCatalogHistory(templateId);
    return {
      workspaceId: context.workspaceId,
      templates: catalog.templates,
      versions: catalog.versions.map(({ document, ...version }) => {
        const lifecycle = (catalog.versionLifecycle ?? []).filter(
          (event) => event.versionId === version.id
        );
        const enabled = [...lifecycle]
          .reverse()
          .find((event) => event.action === 'enabled');
        const published = [...lifecycle]
          .reverse()
          .find((event) => event.action === 'published');
        const retired = [...lifecycle]
          .reverse()
          .find((event) => event.action === 'retired');
        const latest = lifecycle.at(-1);
        return {
          ...version,
          lifecycle,
          ...(published
            ? {
                publishedAt: published.occurredAt,
                publishedBy: published.actorId,
                publishCorrelationId: published.correlationId,
              }
            : {}),
          ...(retired
            ? {
                retiredAt: retired.occurredAt,
                retiredBy: retired.actorId,
                retireCorrelationId: retired.correlationId,
              }
            : {}),
          rolloutPercent:
            latest?.rolloutPercent ??
            enabled?.rolloutPercent ??
            published?.rolloutPercent ??
            version.rolloutPercent,
          status:
            latest?.action === 'retired'
              ? ('retired' as const)
              : latest?.action === 'published'
                ? ('published' as const)
                : latest?.action === 'enabled'
                  ? ('enabled' as const)
                  : version.status,
          documentSummary: {
            elementCount: document.pages.reduce(
              (count, page) => count + page.elements.length,
              0
            ),
            height: document.height,
            pageCount: document.pages.length,
            width: document.width,
          },
        };
      }),
    };
  }

  async createTemplateVersion(
    context: OperationContext,
    input: {
      templateId: string;
      document: CanvasDocument;
      rolloutPercent?: number;
    }
  ) {
    await this.authorize(context);
    if (context.actor !== 'admin') {
      throw new OperationsError(
        'ADMIN_REQUIRED',
        'Admin identity is required.',
        403
      );
    }
    validateDocument(input.document);
    return this.mutateCatalog(context, async (catalog) => {
      const template = catalog.templates.find(
        (item) => item.id === input.templateId
      );
      if (!template) {
        throw new OperationsError(
          'TEMPLATE_NOT_FOUND',
          'Template was not found.',
          404
        );
      }
      const revision =
        Math.max(
          0,
          ...catalog.versions
            .filter((version) => version.templateId === input.templateId)
            .map((version) => version.revision)
        ) + 1;
      const version: TemplateVersion = {
        createdAt: this.timestamp(),
        createdBy: context.userId,
        document: structuredClone(input.document),
        id: `${input.templateId}-v${revision}-${this.id()}`,
        revision,
        rolloutPercent: input.rolloutPercent ?? 0,
        status: 'draft',
        templateId: input.templateId,
      };
      catalog.versions.push(version);
      template.updatedAt = this.timestamp();
      return version;
    });
  }

  async publishTemplateVersion(
    context: OperationContext,
    templateId: string,
    versionId: string,
    rolloutPercent = 100,
    reason = 'legacy-admin-action'
  ) {
    await this.authorize(context);
    if (context.actor !== 'admin') {
      throw new OperationsError(
        'ADMIN_REQUIRED',
        'Admin identity is required.',
        403
      );
    }
    if (rolloutPercent !== 100) {
      throw new OperationsError(
        'PARTIAL_PUBLISH_FORBIDDEN',
        'Publishing is a full rollout. Use enableTemplateVersion for a canary rollout.',
        409
      );
    }
    const published = await this.mutateCatalog(context, async (catalog) => {
      const template = catalog.templates.find((item) => item.id === templateId);
      const version = catalog.versions.find(
        (item) => item.id === versionId && item.templateId === templateId
      );
      if (!template || !version) {
        throw new OperationsError(
          'TEMPLATE_VERSION_NOT_FOUND',
          'Template version was not found.',
          404
        );
      }
      const publishedAt = this.timestamp();
      template.publicationStatus = 'published';
      delete template.enabledAt;
      delete template.enabledVersionId;
      template.publishedVersionId = version.id;
      template.publishedAt = publishedAt;
      template.rolloutPercent = rolloutPercent;
      template.updatedAt = publishedAt;
      this.appendTemplateLifecycle(
        catalog,
        context,
        version.id,
        'published',
        rolloutPercent,
        publishedAt,
        reason
      );
      return {
        ...structuredClone(version),
        publishedAt,
        rolloutPercent,
        status: 'published' as const,
      };
    });
    if (!this.moduleCommand.getStore()?.replayed) {
      await this.mutate(context, (state) => {
        this.audit(
          state,
          context,
          'template.version_published',
          'official_template',
          templateId,
          { reason, rolloutPercent, versionId }
        );
      });
    }
    return published;
  }

  async enableTemplateVersion(
    context: OperationContext,
    templateId: string,
    versionId: string,
    rolloutPercent = 0
  ) {
    await this.authorize(context);
    if (context.actor !== 'admin') {
      throw new OperationsError(
        'ADMIN_REQUIRED',
        'Admin identity is required.',
        403
      );
    }
    const enabled = await this.mutateCatalog(context, async (catalog) => {
      const template = catalog.templates.find((item) => item.id === templateId);
      const version = catalog.versions.find(
        (item) => item.id === versionId && item.templateId === templateId
      );
      if (!template || !version) {
        throw new OperationsError(
          'TEMPLATE_VERSION_NOT_FOUND',
          'Template version was not found.',
          404
        );
      }
      const enabledAt = this.timestamp();
      template.enabledAt = enabledAt;
      template.enabledVersionId = version.id;
      template.publicationStatus = 'enabled';
      template.rolloutPercent = rolloutPercent;
      template.updatedAt = enabledAt;
      this.appendTemplateLifecycle(
        catalog,
        context,
        version.id,
        'enabled',
        rolloutPercent,
        enabledAt
      );
      return {
        ...structuredClone(version),
        enabledAt,
        rolloutPercent,
        status: 'enabled' as const,
      };
    });
    if (!this.moduleCommand.getStore()?.replayed) {
      await this.mutate(context, (state) => {
        this.audit(
          state,
          context,
          'template.version_enabled',
          'official_template',
          templateId,
          { rolloutPercent, versionId }
        );
      });
    }
    return enabled;
  }

  async previewTemplateVersion(
    context: OperationContext,
    templateId: string,
    versionId: string
  ) {
    await this.authorize(context);
    const catalog =
      await this.repository.loadTemplateCatalogHistory(templateId);
    const template = catalog.templates.find(
      (candidate) => candidate.id === templateId
    );
    const version = catalog.versions.find(
      (candidate) =>
        candidate.id === versionId && candidate.templateId === templateId
    );
    if (!template || !version) {
      throw new OperationsError(
        'TEMPLATE_VERSION_NOT_FOUND',
        'Template version was not found.',
        404
      );
    }
    if (context.actor !== 'admin') {
      const state = await this.read(context);
      const isCurrentPublishedVersion = isCurrentPublishedTemplateVersion(
        template,
        version.id
      );
      const isRetainedByWorkspace = state.works.some((work) =>
        workRetainsTemplateVersion(work, template.id, version.id)
      );
      if (!isCurrentPublishedVersion && !isRetainedByWorkspace) {
        throw new OperationsError(
          'TEMPLATE_VERSION_UNAVAILABLE',
          'Template version is not published or retained by this workspace.',
          409
        );
      }
    }
    await this.mutate(context, (state) => {
      this.audit(
        state,
        context,
        'template.version_previewed',
        'official_template',
        templateId,
        { versionId }
      );
    });
    return {
      document: structuredClone(version.document),
      templateId,
      versionId,
    };
  }

  async retireTemplate(
    context: OperationContext,
    templateId: string,
    reason = 'legacy-admin-action'
  ) {
    await this.authorize(context);
    if (context.actor !== 'admin') {
      throw new OperationsError(
        'ADMIN_REQUIRED',
        'Admin identity is required.',
        403
      );
    }
    const retired = await this.mutateCatalog(context, async (catalog) => {
      const template = catalog.templates.find((item) => item.id === templateId);
      if (!template)
        throw new OperationsError(
          'TEMPLATE_NOT_FOUND',
          'Template was not found.',
          404
        );
      template.publicationStatus = 'retired';
      const retiredAt = this.timestamp();
      template.updatedAt = retiredAt;
      for (const versionId of [
        ...new Set(
          [template.publishedVersionId, template.enabledVersionId].filter(
            (value): value is string => Boolean(value)
          )
        ),
      ]) {
        this.appendTemplateLifecycle(
          catalog,
          context,
          versionId,
          'retired',
          template.rolloutPercent ?? 100,
          retiredAt,
          reason
        );
      }
      return template;
    });
    if (!this.moduleCommand.getStore()?.replayed) {
      await this.mutate(context, (state) => {
        this.audit(
          state,
          context,
          'template.retired',
          'official_template',
          templateId,
          { reason }
        );
      });
    }
    return retired;
  }

  private newWork(
    context: OperationContext,
    name: string,
    document: CanvasDocument,
    template?: { id: string; versionId: string }
  ): CanvasWork {
    const timestamp = this.timestamp();
    const workId = this.id();
    const revisionId = this.id();
    return {
      aigcLabelEnabled: false,
      brandWatermarkEnabled: false,
      createdAt: timestamp,
      currentRevisionId: revisionId,
      id: workId,
      name,
      revisions: [
        {
          createdAt: timestamp,
          createdBy: context.userId,
          document: structuredClone(document),
          id: revisionId,
          revision: 1,
          templateVersionId: template?.versionId,
          workId,
        },
      ],
      templateId: template?.id,
      templateVersionId: template?.versionId,
      updatedAt: timestamp,
      workspaceId: context.workspaceId,
    };
  }

  private contentPackageCanvasDocument(
    contentPackage: ContentPackage,
    version: ContentPackage['versions'][number],
    state: OperationsWorkspaceState,
    width: number,
    height: number
  ): { document: CanvasDocument; visualAssetIds: string[] } {
    const ownedAssets = new Map(
      (contentPackage.generated.ownedAssets ?? []).map((asset) => [
        asset.id,
        asset,
      ])
    );
    const creativeAssets = new Map(
      state.creativeAssets.map((asset) => [asset.id, asset])
    );
    const sourceAssetIds = new Set(contentPackage.source.assetIds);
    const visualAssets = version.orderedAssetIds.flatMap((assetId) => {
      const owned = ownedAssets.get(assetId);
      if (owned?.contentType.startsWith('image/')) {
        return [
          {
            assetId,
            src: `/api/core/p1/assets?objectKey=${encodeURIComponent(owned.objectKey)}`,
          },
        ];
      }
      const creative = creativeAssets.get(assetId);
      if (creative?.kind === 'image') {
        return [
          {
            assetId,
            ...(creative.objectKey
              ? {
                  src: `/api/core/p1/assets?objectKey=${encodeURIComponent(creative.objectKey)}`,
                }
              : {}),
          },
        ];
      }
      return sourceAssetIds.has(assetId) ? [{ assetId }] : [];
    });
    const margin = Math.max(32, Math.round(width * 0.07));
    const contentWidth = width - margin * 2;
    const imageGap = Math.max(16, Math.round(width * 0.02));
    const imageHeight = visualAssets.length
      ? Math.max(160, Math.round(height * 0.4))
      : 0;
    const imageWidth = visualAssets.length
      ? Math.floor(
          (contentWidth - imageGap * (visualAssets.length - 1)) /
            visualAssets.length
        )
      : 0;
    const textStart = margin + imageHeight + (visualAssets.length ? margin : 0);
    const titleHeight = Math.max(96, Math.round(height * 0.1));
    const bodyHeight = Math.max(180, Math.round(height * 0.2));
    const ctaHeight = Math.max(72, Math.round(height * 0.07));
    const pageId = this.id();
    const document: CanvasDocument = {
      height,
      pages: [
        {
          elements: [
            ...visualAssets.map((asset, index) => ({
              ...asset,
              height: imageHeight,
              id: this.id(),
              kind: 'image' as const,
              opacity: 1,
              rotation: 0,
              width: imageWidth,
              x: margin + index * (imageWidth + imageGap),
              y: margin,
            })),
            {
              fill: '#18181B',
              fontSize: Math.max(32, Math.round(width * 0.055)),
              height: titleHeight,
              id: this.id(),
              kind: 'text' as const,
              opacity: 1,
              rotation: 0,
              text: version.title,
              width: contentWidth,
              x: margin,
              y: textStart,
            },
            {
              fill: '#52525B',
              fontSize: Math.max(22, Math.round(width * 0.028)),
              height: bodyHeight,
              id: this.id(),
              kind: 'text' as const,
              opacity: 1,
              rotation: 0,
              text: version.body,
              width: contentWidth,
              x: margin,
              y: textStart + titleHeight + Math.round(margin / 2),
            },
            ...(version.conversionHook
              ? [
                  {
                    fill: '#A21CAF',
                    fontSize: Math.max(24, Math.round(width * 0.032)),
                    height: ctaHeight,
                    id: this.id(),
                    kind: 'text' as const,
                    opacity: 1,
                    rotation: 0,
                    text: version.conversionHook,
                    width: contentWidth,
                    x: margin,
                    y:
                      textStart +
                      titleHeight +
                      bodyHeight +
                      Math.round(margin / 1.5),
                  },
                ]
              : []),
          ],
          id: pageId,
        },
      ],
      width,
    };
    validateDocument(document);
    return {
      document,
      visualAssetIds: visualAssets.map((asset) => asset.assetId),
    };
  }

  async createWork(
    context: OperationContext,
    input: { name?: string; templateId: string }
  ) {
    await this.authorize(context);
    const name = optionalUserCanvasName(input.name);
    const catalog = await this.repository.loadTemplateCatalog();
    const template = catalog.templates.find(
      (item) => item.id === input.templateId
    );
    if (!template || template.publicationStatus === 'retired') {
      throw new OperationsError(
        'TEMPLATE_UNAVAILABLE',
        'Template is not available for new work.',
        409
      );
    }
    const selectedVersionId = selectTemplateVersionIdForWorkspace(
      template,
      context.workspaceId
    );
    if (!selectedVersionId) {
      throw new OperationsError(
        'TEMPLATE_UNAVAILABLE',
        'Template is not available for this workspace rollout bucket.',
        409
      );
    }
    const version = catalog.versions.find(
      (item) => item.id === selectedVersionId
    );
    if (!version) {
      throw new OperationsError(
        'TEMPLATE_VERSION_NOT_FOUND',
        'Published template version was not found.',
        404
      );
    }
    return this.mutate(context, (state) => {
      const work = this.newWork(
        context,
        canvasWorkName(name ?? canonicalTemplateDefaultName(template)),
        version.document,
        {
          id: template.id,
          versionId: version.id,
        }
      );
      state.works.push(work);
      this.audit(
        state,
        context,
        'canvas_work.created',
        'canvas_work',
        work.id,
        {
          templateVersionId: version.id,
        }
      );
      return work;
    });
  }

  async copyTemplateVersionToWork(
    context: OperationContext,
    input: {
      name?: string;
      templateId: string;
      templateVersionId: string;
      sourceWorkId?: string;
    }
  ) {
    await this.authorize(context);
    const name = optionalUserCanvasName(input.name);
    const catalog = await this.repository.loadTemplateCatalog();
    const template = catalog.templates.find(
      (item) => item.id === input.templateId
    );
    const version = catalog.versions.find(
      (item) =>
        item.id === input.templateVersionId &&
        item.templateId === input.templateId
    );
    if (!template || !version) {
      throw new OperationsError(
        'TEMPLATE_VERSION_NOT_FOUND',
        'Template version was not found.',
        404
      );
    }
    const isCurrentPublishedVersion = isCurrentPublishedTemplateVersion(
      template,
      version.id
    );
    return this.mutate(context, (state) => {
      const sourceWork = input.sourceWorkId
        ? state.works.find(
            (work) =>
              work.id === input.sourceWorkId &&
              workRetainsTemplateVersion(work, template.id, version.id)
          )
        : undefined;
      if (!isCurrentPublishedVersion && !sourceWork) {
        throw new OperationsError(
          'TEMPLATE_VERSION_UNAVAILABLE',
          'Historical template versions can only be copied from a retaining work.',
          409
        );
      }
      const work = this.newWork(
        context,
        canvasWorkName(
          name ?? sourceWork?.name ?? canonicalTemplateDefaultName(template)
        ),
        version.document,
        {
          id: template.id,
          versionId: version.id,
        }
      );
      state.works.push(work);
      this.audit(
        state,
        context,
        'canvas_work.copied_from_template_version',
        'canvas_work',
        work.id,
        {
          ...(sourceWork ? { sourceWorkId: sourceWork.id } : {}),
          templateId: template.id,
          templateVersionId: version.id,
        }
      );
      return work;
    });
  }


  async createWorkFromContentPackage(
    context: OperationContext,
    input: {
      height: number;
      sourcePackageId: string;
      sourceVersionId: string;
      width: number;
    }
  ) {
    return this.mutate(context, (state) => {
      const contentPackage = state.contentPackages.find(
        (candidate) => candidate.id === input.sourcePackageId
      );
      if (!contentPackage) {
        throw new OperationsError(
          'CONTENT_PACKAGE_NOT_FOUND',
          'ContentPackage was not found.',
          404
        );
      }
      if (contentPackage.rights.state !== 'authorized') {
        throw new OperationsError(
          'CONTENT_PACKAGE_RIGHTS_REVOKED',
          'ContentPackage rights are no longer authorized.',
          409
        );
      }
      if (contentPackage.status === 'needs_replacement') {
        throw new OperationsError(
          'CONTENT_PACKAGE_ASSETS_NOT_AUTHORIZED',
          'ContentPackage assets must be replaced before Canvas use.',
          409
        );
      }
      const versions = [
        ...contentPackage.versions,
        ...contentPackage.variants.flatMap((variant) => variant.versions),
      ].filter((version) => version.id === input.sourceVersionId);
      if (versions.length !== 1) {
        throw new OperationsError(
          'CONTENT_PACKAGE_VERSION_NOT_FOUND',
          'The exact ContentPackage version was not found.',
          404
        );
      }
      const version = versions[0]!;
      const seeded = this.contentPackageCanvasDocument(
        contentPackage,
        version,
        state,
        input.width,
        input.height
      );
      const work = this.newWork(
        context,
        canvasWorkName(version.title),
        seeded.document
      );
      work.aigcLabelEnabled = contentPackage.compliance.aigcLabelEnabled;
      work.brandWatermarkEnabled = contentPackage.compliance.watermarkEnabled;
      work.sourceContentPackageId = contentPackage.id;
      work.sourceContentPackageVersionId = version.id;
      if (contentPackage.source.workId) {
        work.sourceWorkId = contentPackage.source.workId;
      }
      state.works.push(work);
      this.audit(
        state,
        context,
        'canvas_work.created_from_content_package',
        'canvas_work',
        work.id,
        {
          sourcePackageId: contentPackage.id,
          sourceVersionId: version.id,
          ...(contentPackage.source.workId
            ? { sourceWorkId: contentPackage.source.workId }
            : {}),
          visualAssetIds: seeded.visualAssetIds,
        }
      );
      return work;
    });
  }


  async getWork(context: OperationContext, workId: string) {
    const state = await this.read(context);
    const work = state.works.find((item) => item.id === workId);
    if (!work)
      throw new OperationsError(
        'WORK_NOT_FOUND',
        'Canvas work was not found.',
        404
      );
    return work;
  }

  async saveCanvasRevision(
    context: OperationContext,
    workId: string,
    document: CanvasDocument,
    sourceRevisionId?: string
  ) {
    validateDocument(document);
    return this.mutate(context, (state) => {
      const work = state.works.find((item) => item.id === workId);
      if (!work)
        throw new OperationsError(
          'WORK_NOT_FOUND',
          'Canvas work was not found.',
          404
        );
      if (sourceRevisionId && work.currentRevisionId !== sourceRevisionId) {
        throw new OperationsError(
          'WORK_REVISION_CONFLICT',
          'Canvas changed after this editor snapshot was opened.',
          409
        );
      }
      const revision = {
        createdAt: this.timestamp(),
        createdBy: context.userId,
        document: structuredClone(document),
        id: this.id(),
        revision: Math.max(...work.revisions.map((item) => item.revision)) + 1,
        templateVersionId: work.templateVersionId,
        workId,
      };
      work.revisions.push(revision);
      work.currentRevisionId = revision.id;
      work.updatedAt = revision.createdAt;
      this.audit(state, context, 'canvas_work.saved', 'canvas_work', workId, {
        revision: revision.revision,
      });
      return revision;
    });
  }

  async upgradeWorkTemplate(
    context: OperationContext,
    workId: string,
    templateVersionId: string
  ) {
    await this.authorize(context);
    const catalog = await this.repository.loadTemplateCatalog();
    const version = catalog.versions.find(
      (item) => item.id === templateVersionId
    );
    const template = catalog.templates.find(
      (item) => item.id === version?.templateId
    );
    if (
      !version ||
      (version.status === 'draft' &&
        template?.publishedVersionId !== version.id)
    ) {
      throw new OperationsError(
        'TEMPLATE_VERSION_UNAVAILABLE',
        'Template version is unavailable.',
        409
      );
    }
    return this.mutate(context, (state) => {
      const work = state.works.find((item) => item.id === workId);
      if (!work)
        throw new OperationsError(
          'WORK_NOT_FOUND',
          'Canvas work was not found.',
          404
        );
      if (work.templateId && version.templateId !== work.templateId) {
        throw new OperationsError(
          'TEMPLATE_MISMATCH',
          'Version belongs to another template.',
          409
        );
      }
      const revision = {
        createdAt: this.timestamp(),
        createdBy: context.userId,
        document: structuredClone(version.document),
        id: this.id(),
        revision: Math.max(...work.revisions.map((item) => item.revision)) + 1,
        templateVersionId: version.id,
        workId,
      };
      work.templateId = version.templateId;
      work.templateVersionId = version.id;
      work.currentRevisionId = revision.id;
      work.updatedAt = revision.createdAt;
      work.revisions.push(revision);
      this.audit(
        state,
        context,
        'canvas_work.template_upgraded',
        'canvas_work',
        workId,
        {
          templateVersionId: version.id,
        }
      );
      return work;
    });
  }

  async setCreationLabels(
    context: OperationContext,
    workId: string,
    labels: { brandWatermarkEnabled: boolean; aigcLabelEnabled: boolean }
  ) {
    return this.mutate(context, (state) => {
      const work = state.works.find((item) => item.id === workId);
      if (!work)
        throw new OperationsError(
          'WORK_NOT_FOUND',
          'Canvas work was not found.',
          404
        );
      work.brandWatermarkEnabled = labels.brandWatermarkEnabled;
      work.aigcLabelEnabled = labels.aigcLabelEnabled;
      work.updatedAt = this.timestamp();
      this.audit(
        state,
        context,
        'canvas_work.creation_labels_changed',
        'canvas_work',
        workId,
        labels
      );
      return work;
    });
  }

  async saveUserTemplate(
    context: OperationContext,
    input: {
      workId: string;
      name?: string;
      document?: CanvasDocument;
      sourceRevisionId?: string;
    }
  ) {
    const name = optionalUserCanvasName(input.name);
    if (input.document) validateDocument(input.document);
    const userTemplate = await this.mutate(context, (state) => {
      const work = state.works.find((item) => item.id === input.workId);
      if (!work)
        throw new OperationsError(
          'WORK_NOT_FOUND',
          'Canvas work was not found.',
          404
        );
      if (input.document) {
        if (
          !input.sourceRevisionId ||
          work.currentRevisionId !== input.sourceRevisionId
        ) {
          throw new OperationsError(
            'WORK_REVISION_CONFLICT',
            'Canvas changed after this template snapshot was opened.',
            409
          );
        }
        const revision = {
          createdAt: this.timestamp(),
          createdBy: context.userId,
          document: structuredClone(input.document),
          id: this.id(),
          revision:
            Math.max(...work.revisions.map((item) => item.revision)) + 1,
          templateVersionId: work.templateVersionId,
          workId: work.id,
        };
        work.revisions.push(revision);
        work.currentRevisionId = revision.id;
        work.updatedAt = revision.createdAt;
      }
      const template: UserTemplate = {
        canvasRevisionId: work.currentRevisionId,
        createdAt: this.timestamp(),
        id: this.id(),
        name: canvasTemplateName(name, work.name),
        sourceWorkId: work.id,
        updatedAt: this.timestamp(),
        workspaceId: context.workspaceId,
      };
      state.userTemplates.push(template);
      this.audit(
        state,
        context,
        'user_template.created',
        'user_template',
        template.id
      );
      return template;
    });
    await this.repository.upsertSearchDocument({
      id: userTemplate.id,
      kind: 'template',
      metadata: {
        family: 'user',
        official: 'false',
        publicationStatus: 'published',
      },
      tags: ['自建模板'],
      text: userTemplate.name,
      title: userTemplate.name,
      updatedAt: userTemplate.updatedAt,
      workspaceId: context.workspaceId,
    });
    return userTemplate;
  }




  private async indexUserTemplate(
    context: OperationContext,
    userTemplate: UserTemplate
  ) {
    await this.repository.upsertSearchDocument({
      id: userTemplate.id,
      kind: 'template',
      metadata: {
        family: 'user',
        official: 'false',
        publicationStatus: 'published',
      },
      tags: ['自建模板'],
      text: userTemplate.name,
      title: userTemplate.name,
      updatedAt: userTemplate.updatedAt,
      workspaceId: context.workspaceId,
    });
  }




  async listUserTemplates(context: OperationContext) {
    const state = await this.read(context);
    return state.userTemplates.filter((item) => !item.deletedAt);
  }

  async listTemplateShortcuts(context: OperationContext) {
    const state = await this.read(context);
    return state.templateShortcuts
      .filter((shortcut) => !shortcut.hidden)
      .sort((left, right) => left.rank - right.rank);
  }

  async getCreationCatalog(context: OperationContext) {
    await this.authorize(context);
    const [catalog, userTemplates, shortcuts] = await Promise.all([
      this.repository.loadTemplateCatalog(),
      this.listUserTemplates(context),
      this.listTemplateShortcuts(context),
    ]);
    const templates = catalog.templates
      .filter(ownerCanUseOfficialTemplate)
      .flatMap((template) => {
        const previewVersionId = selectTemplateVersionIdForWorkspace(
          template,
          context.workspaceId
        );
        const version = catalog.versions.find(
          (candidate) => candidate.id === previewVersionId
        );
        return version
          ? [
              {
                ...template,
                previewDocument: structuredClone(version.document),
                previewVersionId: version.id,
              },
            ]
          : [];
      });
    return { shortcuts, templates, userTemplates };
  }

  async exportWork(
    context: OperationContext,
    workId: string,
    request: ExportRequest
  ) {
    const work = await this.getWork(context, workId);
    if (
      typeof request.workRevisionId !== 'string' ||
      request.workRevisionId.length === 0
    ) {
      throw new OperationsError(
        'WORK_REVISION_REQUIRED',
        'workRevisionId is required for a traceable export.',
        400
      );
    }
    const promotionalMaterialReceipt =
      validatedPromotionalMaterialReceipt(request);
    const revision = work.revisions.find(
      (item) => item.id === request.workRevisionId
    );
    if (!revision) {
      throw new OperationsError(
        'WORK_REVISION_NOT_FOUND',
        'Requested work revision was not found.',
        409
      );
    }
    if (
      request.width !== revision.document.width ||
      request.height !== revision.document.height
    ) {
      throw new OperationsError(
        'EXPORT_DIMENSION_MISMATCH',
        'Export dimensions do not match the persisted Canvas revision.',
        409
      );
    }
    if (
      request.promotionalMaterialSpec &&
      (request.promotionalMaterialSpec.width !== request.width ||
        request.promotionalMaterialSpec.height !== request.height ||
        request.promotionalMaterialSpec.renderer !== 'light-composer')
    ) {
      throw new OperationsError(
        'EXPORT_DIMENSION_MISMATCH',
        'Promotional material spec does not match the persisted Light Composer revision.',
        409
      );
    }
    const artifact = await this.dependencies.canvasExporter.export(
      revision.document,
      request,
      { workspaceId: context.workspaceId }
    );
    if (
      promotionalMaterialReceipt &&
      promotionalMaterialReceipt.outputSha256 !== artifact.sha256
    ) {
      throw new OperationsError(
        'INVALID_PROMOTIONAL_MATERIAL_RECEIPT',
        'Promotional material outputSha256 must match the persisted export artifact.',
        409
      );
    }
    const {
      renderedDataUrl: _renderedDataUrl,
      renderEvidenceMarker: _renderEvidenceMarker,
      brandWatermarkEnabled: requestedBrandWatermark,
      aigcLabelEnabled: requestedAigcLabel,
      promotionalMaterialReceipt: _requestedPromotionalMaterialReceipt,
      workRevisionId: _requestedWorkRevisionId,
      ...receiptRequest
    } = request;
    const appliedLabels = {
      aigcLabelEnabled: requestedAigcLabel ?? work.aigcLabelEnabled,
      brandWatermarkEnabled:
        requestedBrandWatermark ?? work.brandWatermarkEnabled,
    };
    return this.mutate(context, (state) => {
      const receipt: ExportReceipt = {
        ...artifact,
        ...receiptRequest,
        ...appliedLabels,
        ...(promotionalMaterialReceipt
          ? { promotionalMaterialReceipt }
          : {}),
        createdAt: this.timestamp(),
        id: this.id(),
        workId,
        workRevisionId: request.workRevisionId,
        workspaceId: context.workspaceId,
      };
      state.exportReceipts.push(receipt);
      this.audit(
        state,
        context,
        'canvas_work.exported',
        'canvas_work',
        workId,
        {
          ...appliedLabels,
          format: request.format,
          ...(request.promotionalMaterialSpec
            ? { materialPurpose: request.promotionalMaterialSpec.purpose }
            : {}),
          workRevisionId: revision.id,
        }
      );
      return receipt;
    });
  }

  async listExportReceipts(context: OperationContext, workId?: string) {
    const state = await this.read(context);
    return state.exportReceipts
      .filter((receipt) => !workId || receipt.workId === workId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async adoptCanvasWorkExport(
    context: OperationContext,
    input: {
      exportReceiptId: string;
      workId: string;
      workRevisionId: string;
    }
  ) {
    return this.mutate(context, async (state) => {
      await this.requireContentPackageWrite(context);
      state.contentPackages ??= [];
      const work = state.works.find((candidate) => candidate.id === input.workId);
      const revision = work?.revisions.find(
        (candidate) => candidate.id === input.workRevisionId
      );
      if (!work || work.workspaceId !== context.workspaceId || !revision) {
        throw new OperationsError(
          'CANVAS_WORK_REVISION_NOT_FOUND',
          'The requested Canvas work revision was not found.',
          404
        );
      }
      const receipt = state.exportReceipts.find(
        (candidate) => candidate.id === input.exportReceiptId
      );
      if (
        !receipt ||
        receipt.workspaceId !== context.workspaceId ||
        receipt.workId !== work.id ||
        receipt.workRevisionId !== revision.id
      ) {
        throw new OperationsError(
          'CANVAS_EXPORT_LINEAGE_MISMATCH',
          'The export receipt does not belong to the requested Canvas work revision.',
          409
        );
      }
      if (
        !receipt.assetId ||
        !receipt.objectKey.startsWith(`${context.workspaceId}/owned/`) ||
        !(await this.dependencies.canvasExporter.inspectOwnedAsset?.({
          assetId: receipt.assetId,
          bytes: receipt.bytes,
          contentType: receipt.contentType,
          objectKey: receipt.objectKey,
          sha256: receipt.sha256,
          workspaceId: context.workspaceId,
        }))
      ) {
        throw new OperationsError(
          'CANVAS_EXPORT_ASSET_INVALID',
          'The exported Canvas asset is not available in workspace-owned storage.',
          409
        );
      }

      const packageId = `content-package-${createHash('sha256')
        .update(
          `${context.workspaceId}:${work.id}:${revision.id}:${receipt.id}:layout-canvas`
        )
        .digest('hex')
        .slice(0, 24)}`;
      const existing = state.contentPackages.find(
        (candidate) => candidate.id === packageId
      );
      if (existing) {
        if (
          existing.source.layoutCanvas?.workId !== work.id ||
          existing.source.layoutCanvas.workRevisionId !== revision.id ||
          existing.source.layoutCanvas.exportReceiptId !== receipt.id
        ) {
          throw new OperationsError(
            'CANVAS_EXPORT_ADOPTION_CONFLICT',
            'The Canvas export adoption identity is already in use.',
            409
          );
        }
        return {
          ...existing,
          ...contentPackageVisibleStatus(existing.status),
        };
      }

      const timestamp = this.timestamp();
      const draft = {
        ...buildContentPackage({
          id: packageId,
          kind: 'image_text',
          source: {
            assetIds: [receipt.assetId],
            layoutCanvas: {
              exportReceiptId: receipt.id,
              schemaVersion: 1 as const,
              workId: work.id,
              workRevisionId: revision.id,
            },
            workId: work.id,
          },
          timestamp,
          workspaceId: context.workspaceId,
        }),
        compliance: {
          aigcLabelEnabled: receipt.aigcLabelEnabled,
          watermarkEnabled: receipt.brandWatermarkEnabled,
          ...(receipt.brandWatermarkEnabled
            ? {
                watermarkText:
                  receipt.brandWatermarkText?.trim() || work.name,
              }
            : {}),
        },
        generated: {
          assetIds: [receipt.assetId],
          childRuns: [],
          ownedAssets: [
            {
              contentType: receipt.contentType,
              id: receipt.assetId,
              objectKey: receipt.objectKey,
              sha256: receipt.sha256,
              sizeBytes: receipt.bytes,
            },
          ],
        },
      };
      let contentPackage: ContentPackage;
      try {
        contentPackage = transitionContentPackage(
          draft,
          {
            type: 'adopted',
            version: {
              body: '',
              createdAt: timestamp,
              id: `${packageId}-v1`,
              orderedAssetIds: [receipt.assetId],
              title: work.name,
              topics: [],
            },
          },
          timestamp
        );
      } catch (error) {
        if (error instanceof ContentPackageTransitionError) {
          throw new OperationsError(
            'CONTENT_PACKAGE_TRANSITION_CONFLICT',
            error.message,
            409
          );
        }
        throw error;
      }
      state.contentPackages.push(contentPackage);
      this.audit(
        state,
        context,
        'canvas_work.export_adopted',
        'content_package',
        contentPackage.id,
        {
          assetId: receipt.assetId,
          exportReceiptId: receipt.id,
          workId: work.id,
          workRevisionId: revision.id,
        }
      );
      return {
        ...contentPackage,
        ...contentPackageVisibleStatus(contentPackage.status),
      };
    });
  }


  async getCanvasImageJob(context: OperationContext, jobId: string) {
    const state = await this.read(context);
    const job = state.imageJobs.find((item) => item.id === jobId);
    if (!job) {
      throw new OperationsError(
        'IMAGE_JOB_NOT_FOUND',
        'Canvas image job was not found.',
        404
      );
    }
    if (TERMINAL_IMAGE_JOB_STATUSES.has(job.status)) return job;
    const canResumeSubmission =
      job.status === 'queued' && typeof job.submissionKey === 'string';
    if (!canResumeSubmission && !this.dependencies.imageGenerator.get)
      return job;
    let durable = canResumeSubmission
      ? await this.dependencies.imageGenerator.submit({
          actorId: context.userId,
          dataClass: [...(job.dataClass ?? [])],
          idempotencyKey: job.submissionKey,
          inputAssetId: job.inputAssetId,
          operation: job.operation,
          origin: job.origin,
          prompt: job.prompt,
          requestedModelId: job.requestedModelId,
          workspaceId: context.workspaceId,
        })
      : await this.dependencies.imageGenerator.get?.({
          actorId: context.userId,
          jobId,
          workspaceId: context.workspaceId,
        });
    if (
      durable &&
      !TERMINAL_IMAGE_JOB_STATUSES.has(durable.status) &&
      this.dependencies.imageGenerator.get
    ) {
      durable = await this.dependencies.imageGenerator.get({
        actorId: context.userId,
        jobId,
        workspaceId: context.workspaceId,
      });
    }
    if (!durable) return job;
    if (durable.id !== jobId || durable.actualModelId !== job.actualModelId) {
      throw new OperationsError(
        'IMAGE_JOB_RECEIPT_MISMATCH',
        'The durable image receipt does not match the requested job.',
        409
      );
    }
    return this.mutate(context, (current) => {
      const projection = current.imageJobs.find((item) => item.id === jobId);
      if (!projection) {
        throw new OperationsError(
          'IMAGE_JOB_NOT_FOUND',
          'Canvas image job was not found.',
          404
        );
      }
      if (TERMINAL_IMAGE_JOB_STATUSES.has(projection.status)) {
        return projection;
      }
      if (
        projection.status === 'cancel_requested' &&
        !TERMINAL_IMAGE_JOB_STATUSES.has(durable.status) &&
        durable.status !== 'cancel_requested'
      ) {
        return projection;
      }
      projection.status = durable.status;
      projection.outputAssetId = durable.outputAssetId;
      projection.outputAssetUrl = durable.outputAssetUrl;
      projection.updatedAt = this.timestamp();
      return projection;
    });
  }




  async search(
    context: OperationContext,
    query: SearchQuery
  ): Promise<SearchResult[]> {
    await this.authorize(context);
    const [workspaceResults, catalog] = await Promise.all([
      this.repository.searchDocuments(context.workspaceId, query),
      this.repository.loadTemplateCatalog(),
    ]);
    const visibleCatalog =
      context.actor === 'admin'
        ? catalog
        : {
            ...catalog,
            templates: catalog.templates.filter(ownerCanUseOfficialTemplate),
          };
    const templateResults =
      !query.kinds || query.kinds.includes('template')
        ? searchTemplateCatalog(visibleCatalog, context.workspaceId, query)
        : [];
    return mergeSearchResults(
      workspaceResults,
      templateResults,
      query.limit ?? 20
    );
  }


  private creationEvent(
    state: OperationsWorkspaceState,
    context: OperationContext,
    type: CreationActivationEventType,
    references: {
      workId?: string;
      jobId?: string;
      assetId?: string;
      contentId?: string;
      contentPackageId?: string;
    } = {}
  ) {
    if (state.creationEvents.some((event) => event.type === type)) return;
    state.creationEvents.push({
      ...references,
      correlationId: context.correlationId,
      createdAt: this.timestamp(),
      id: this.id(),
      schemaVersion: 'uiux-activation-v1',
      type,
      workspaceId: state.workspaceId,
    });
  }

  private validateCreativeContract(contract: CreativeExecutionContract) {
    this.normalizedContentModules(contract.contentModules);
    if (
      !contract.catalogModelId.trim() ||
      !contract.catalogRevision.trim() ||
      !contract.quoteRevision.trim() ||
      !Number.isFinite(Date.parse(contract.quoteAcceptedAt)) ||
      !Number.isFinite(contract.estimatedAmount) ||
      contract.estimatedAmount < 0 ||
      !Number.isInteger(contract.outputCount) ||
      contract.outputCount < 1
    ) {
      throw new OperationsError(
        'INVALID_CREATIVE_CONTRACT',
        'A model, catalog, accepted quote, and output count are required.'
      );
    }
  }

  private creativeResult(
    state: OperationsWorkspaceState,
    workId: string,
    jobId: string
  ) {
    const work = state.creativeWorks.find((item) => item.id === workId);
    const job = state.creativeJobs.find((item) => item.id === jobId);
    if (!work || !job) {
      throw new OperationsError(
        'CREATIVE_OBJECT_NOT_FOUND',
        'Creative Work or Job was not found.',
        404
      );
    }
    return {
      assets: state.creativeAssets.filter((asset) => asset.jobId === jobId),
      contents: state.creativeContents.filter(
        (content) => content.jobId === jobId
      ),
      job,
      work,
    };
  }

  private completeCopyCandidateBatch(
    state: OperationsWorkspaceState,
    job: CreativeJob
  ): CreativeAssetProjection[] | undefined {
    if (
      job.status !== 'completed' ||
      job.contract.operation !== 'copy.generate'
    ) {
      return undefined;
    }
    const candidates = state.creativeAssets
      .filter((asset) => asset.jobId === job.id && asset.kind === 'text')
      .sort(
        (left, right) =>
          (left.candidateIndex ?? Number.MAX_SAFE_INTEGER) -
          (right.candidateIndex ?? Number.MAX_SAFE_INTEGER)
      );
    if (
      candidates.length !== 3 ||
      job.outputAssetIds.length !== 3 ||
      candidates.some(
        (candidate, index) =>
          candidate.candidateIndex !== index ||
          !job.outputAssetIds.includes(candidate.id)
      )
    ) {
      return undefined;
    }
    return candidates;
  }

  private creativeJobId(workId: string, submissionKey: string) {
    return `creative-job-${createHash('sha256')
      .update(`${workId}:${submissionKey}`)
      .digest('hex')
      .slice(0, 24)}`;
  }

  private assertCreativeJobReplay(
    existing: CreativeJob,
    contract: CreativeExecutionContract,
    options: CreativeJobPreparationOptions
  ) {
    if (
      existing.retryOf !== options.retryOf ||
      existing.rerollOf !== options.reroll?.sourceJobId ||
      existing.rerollKind !== options.reroll?.kind ||
      existing.billingQuoteId !== options.billingQuoteId ||
      JSON.stringify(stableValue(existing.contract)) !==
        JSON.stringify(stableValue(contract))
    ) {
      throw new OperationsError(
        'IDEMPOTENCY_CONFLICT',
        'Submission key was reused with different creative request semantics.',
        409
      );
    }
  }

  private normalizedSourceReferences(
    value: CreativeSourceReference[]
  ): CreativeSourceReference[] {
    const seen = new Set<string>();
    return value.map((reference) => {
      if (
        !reference.id ||
        !/^[A-Za-z0-9._:-]{1,160}$/.test(reference.id) ||
        !['task', 'asset', 'content', 'template', 'work'].includes(
          reference.kind
        )
      ) {
        throw new OperationsError(
          'INVALID_SOURCE_REFERENCE',
          'Creative source references must name a trusted object.'
        );
      }
      const key = `${reference.kind}:${reference.id}`;
      if (seen.has(key)) {
        throw new OperationsError(
          'DUPLICATE_SOURCE_REFERENCE',
          'Creative source references must be unique.'
        );
      }
      seen.add(key);
      const inheritanceFields = reference.inheritanceFields;
      if (inheritanceFields !== undefined) {
        if (
          inheritanceFields.length === 0 ||
          new Set(inheritanceFields).size !== inheritanceFields.length ||
          inheritanceFields.some((field) => !INHERITANCE_FIELD_IDS.has(field))
        ) {
          throw new OperationsError(
            'INVALID_INHERITANCE_FIELDS',
            'Inherited source fields must be unique supported structure fields.'
          );
        }
      }
      return {
        id: reference.id,
        ...(inheritanceFields
          ? { inheritanceFields: [...inheritanceFields] }
          : {}),
        kind: reference.kind,
      };
    });
  }

  private normalizedContentModules(
    value: CreativeContentModuleId[] | undefined
  ): CreativeContentModuleId[] {
    const modules = value ?? DEFAULT_CONTENT_MODULES;
    if (
      modules.length === 0 ||
      new Set(modules).size !== modules.length ||
      modules.some((moduleId) => !CONTENT_MODULE_IDS.has(moduleId))
    ) {
      throw new OperationsError(
        'INVALID_CONTENT_MODULES',
        'At least one unique supported content module is required.'
      );
    }
    return [...modules];
  }

  async getCreativeWorkbench(context: OperationContext) {
    const state = await this.read(context);
    return {
      assets: state.creativeAssets,
      contents: state.creativeContents,
      events: state.creationEvents,
      jobs: state.creativeJobs,
      works: state.creativeWorks,
    };
  }

  async getCanonicalHistory(
    context: OperationContext,
    options: { limit?: number; offset?: number } = {}
  ) {
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 200 ||
      !Number.isInteger(offset) ||
      offset < 0
    ) {
      throw new OperationsError(
        'INVALID_HISTORY_PAGE',
        'History limit must be 1 through 200 and offset must be non-negative.'
      );
    }
    const state = await this.read(context);
    const recent = <T>(items: T[], timestamp: (item: T) => string) =>
      [...items]
        .sort((left, right) => timestamp(right).localeCompare(timestamp(left)))
        .slice(offset, offset + limit);
    const canvasWorks = state.works.map((work) => ({
      ...work,
      revisions: work.revisions.map(({ document: _document, ...revision }) =>
        structuredClone(revision)
      ),
    }));
    const sessionList = state.composerConversations
      .filter(({ deletedAt }) => !deletedAt)
      .map((conversation) => ({
        createdAt: conversation.createdAt,
        id: conversation.id,
        updatedAt: conversation.updatedAt,
        workIds: state.creativeWorks
          .filter(({ sessionId }) => sessionId === conversation.id)
          .map(({ id }) => id),
      }));
    const totals = {
      assets: state.creativeAssets.length,
      canvasWorks: canvasWorks.length,
      contents: state.creativeContents.length,
      creativeWorks: state.creativeWorks.length,
      exportReceipts: state.exportReceipts.length,
      imageJobs: state.imageJobs.length,
      jobs: state.creativeJobs.length,
      sessions: sessionList.length,
      tasks: state.tasks.length,
    };
    return {
      assets: recent(state.creativeAssets, (item) => item.createdAt),
      canvasWorks: recent(canvasWorks, (item) => item.updatedAt),
      contents: recent(
        state.creativeContents,
        (item) => item.acceptedAt ?? item.createdAt
      ),
      creativeWorks: recent(state.creativeWorks, (item) => item.updatedAt),
      exportReceipts: recent(state.exportReceipts, (item) => item.createdAt),
      imageJobs: recent(state.imageJobs, (item) => item.updatedAt),
      jobs: recent(state.creativeJobs, (item) => item.updatedAt),
      pageInfo: { limit, offset, totals },
      sessions: recent(sessionList, (item) => item.updatedAt),
      tasks: recent(state.tasks, (item) => item.createdAt),
    };
  }



  async createCreativeWork(
    context: OperationContext,
    input: {
      contentModules?: CreativeContentModuleId[];
      /** Absent reads as `customized`, keeping full grounding (D-175). */
      creationMode?: CreationMode;
      intent: string;
      mode: 'agent' | 'direct';
      operation?: CreativeOperation;
      sessionId: string;
      sourceReferences: CreativeSourceReference[];
      derivedFrom?: string;
      /**
       * Day-0 seam (T1): when true, adopt AI draft values into Brief fields and
       * set confirmedAt at creation so the main path needs 0 brief clicks.
       * Opt-in to preserve existing create→update→confirm flows.
       */
      autoConfirmBrief?: boolean;
      briefConfirmationId?: string;
      briefContextId?: string;
      /** Optional AI draft values for scene/tone/audience (intent uses input.intent). */
      briefDrafts?: Partial<
        Record<Exclude<CreativeBriefFieldId, 'intent'>, string>
      >;
    }
  ) {
    const intent = input.intent.trim();
    if (intent.length < 2 || intent.length > 2_000) {
      throw new OperationsError(
        'INVALID_CREATIVE_INTENT',
        'Creative intent must contain 2 to 2000 characters.'
      );
    }
    if (!/^[A-Za-z0-9._:-]{1,160}$/.test(input.sessionId)) {
      throw new OperationsError(
        'INVALID_CREATIVE_SESSION',
        'A stable creative session identifier is required.'
      );
    }
    const sourceReferences = this.normalizedSourceReferences(
      input.sourceReferences
    );
    const contentModules = this.normalizedContentModules(input.contentModules);
    const autoConfirmBrief = input.autoConfirmBrief === true;
    const operation = input.operation ?? 'copy.generate';
    if (this.dependencies.briefSubmissionGate && !input.operation) {
      throw new OperationsError(
        'INVALID_CREATIVE_CONTRACT',
        'Creative operation is required when the server Brief gate is enabled.',
      );
    }
    // Primary creates still require a server Brief context when the gate is on.
    // D-046 / result_adjust derived Works may auto-confirm a local Brief without
    // minting a new creation-experience context (intent already changed on revise).
    if (
      this.dependencies.briefSubmissionGate &&
      !input.briefContextId &&
      !(autoConfirmBrief && Boolean(input.derivedFrom))
    ) {
      throw new OperationsError(
        'BRIEF_CONTEXT_REQUIRED',
        'Creative submissions require a server Brief context.',
      );
    }
    return this.mutate(context, async (state, repository) => {
      const briefContextRevision = input.briefContextId
        ? await this.assertBriefCurrentForWrite(repository, {
            ...(input.briefConfirmationId
              ? { briefConfirmationId: input.briefConfirmationId }
              : {}),
            briefContextId: input.briefContextId,
            intent,
            operation,
            sourceReferenceIds: sourceReferences.map((source) => source.id),
            workspaceId: context.workspaceId,
          })
        : undefined;
      if (
        input.derivedFrom &&
        !state.creativeWorks.some((work) => work.id === input.derivedFrom)
      ) {
        throw new OperationsError(
          'SOURCE_WORK_NOT_FOUND',
          'The source Work was not found.',
          404
        );
      }
      const timestamp = this.timestamp();
      const conversation = state.composerConversations.find(
        ({ id }) => id === input.sessionId,
      );
      if (conversation?.deletedAt) {
        throw new OperationsError(
          'COMPOSER_CONVERSATION_DELETED',
          'A deleted Composer conversation cannot accept new Works.',
          409,
        );
      }
      if (conversation) {
        conversation.updatedAt = timestamp;
      } else {
        state.composerConversations.push({
          createdAt: timestamp,
          createdBy: context.userId,
          id: input.sessionId,
          updatedAt: timestamp,
          workspaceId: context.workspaceId,
        });
      }
      const work: CreativeWork = {
        contentModules,
        createdAt: timestamp,
        ...(input.creationMode ? { creationMode: input.creationMode } : {}),
        ...(input.derivedFrom ? { derivedFrom: input.derivedFrom } : {}),
        id: this.id(),
        ...(input.briefConfirmationId
          ? { briefConfirmationId: input.briefConfirmationId }
          : {}),
        ...(input.briefContextId
          ? { briefContextId: input.briefContextId }
          : {}),
        ...(briefContextRevision === undefined
          ? {}
          : { briefContextRevision }),
        intent,
        mode: input.mode,
        operation,
        sessionId: input.sessionId,
        sourceReferences,
        status: 'draft',
        updatedAt: timestamp,
        workspaceId: context.workspaceId,
      };

      if (autoConfirmBrief) {
        const normalizeDraft = (value: string, field: CreativeBriefFieldId) => {
          const normalized = value.trim();
          const minimum = field === 'intent' ? 2 : 1;
          const maximum = field === 'intent' ? 2_000 : 500;
          if (normalized.length < minimum || normalized.length > maximum) {
            throw new OperationsError(
              'INVALID_CREATIVE_BRIEF_FIELD',
              `Creative Brief ${field} must contain ${minimum} to ${maximum} characters.`
            );
          }
          return normalized;
        };
        const fields: CreativeBrief['fields'] = {
          intent: {
            aiDraft: normalizeDraft(intent, 'intent'),
            current: normalizeDraft(intent, 'intent'),
            owner: 'ai',
          },
        };
        for (const field of ['scene', 'tone', 'audience'] as const) {
          const draft = input.briefDrafts?.[field]?.trim();
          if (!draft) continue;
          const normalized = normalizeDraft(draft, field);
          fields[field] = {
            aiDraft: normalized,
            current: normalized,
            owner: 'ai',
          };
        }
        work.brief = {
          fields,
          confirmedAt: timestamp,
          updatedAt: timestamp,
        };
        // Preserve brief_updated audit semantics for each adopted field.
        for (const field of Object.keys(fields).sort() as CreativeBriefFieldId[]) {
          this.audit(
            state,
            context,
            'creative_work.brief_updated',
            'creative_work',
            work.id,
            {
              action: 'adopt',
              field,
              owner: 'ai',
              autoConfirmedAtCreate: true,
            }
          );
        }
        this.audit(
          state,
          context,
          'creative_work.brief_confirmed',
          'creative_work',
          work.id,
          {
            fields: Object.keys(fields).sort(),
            autoConfirmedAtCreate: true,
          }
        );
      }

      state.creativeWorks.push(work);
      this.creationEvent(state, context, 'first_work_created', {
        workId: work.id,
      });
      this.audit(
        state,
        context,
        'creative_work.created',
        'creative_work',
        work.id,
        {
          mode: work.mode,
          sourceReferenceCount: work.sourceReferences.length,
          autoConfirmBrief,
        }
      );
      return work;
    });
  }

  async deleteComposerConversation(
    context: OperationContext,
    conversationId: string,
  ): Promise<ComposerConversationDeletedFact> {
    if (!/^[A-Za-z0-9._:-]{1,160}$/.test(conversationId)) {
      throw new OperationsError(
        'INVALID_CREATIVE_SESSION',
        'A stable creative session identifier is required.',
      );
    }
    const notifier = this.composerConversationDeletionNotifier;
    if (!notifier) {
      throw new OperationsError(
        'COMPOSER_DELETION_NOTIFIER_UNAVAILABLE',
        'Composer conversation deletion is unavailable.',
        503,
      );
    }
    const fact: ComposerConversationDeletedFact = await this.mutate(
      context,
      (state) => {
        const conversation = state.composerConversations.find(
          ({ id }) => id === conversationId,
        );
        if (!conversation) {
          throw new OperationsError(
            'COMPOSER_CONVERSATION_NOT_FOUND',
            'The Composer conversation was not found.',
            404,
          );
        }
        if (conversation.deletedAt && conversation.deletionAuditEventId) {
          const event = state.auditEvents.find(
            ({ id }) => id === conversation.deletionAuditEventId,
          );
          if (!event) {
            throw new OperationsError(
              'COMPOSER_CONVERSATION_AUDIT_MISSING',
              'The Composer conversation deletion audit fact is missing.',
              409,
            );
          }
          return {
            action: 'composer_conversation.deleted',
            actorId: event.actorId,
            auditId: event.id,
            conversationId,
            correlationId: event.correlationId,
            deletedAt: event.createdAt,
            workspaceId: context.workspaceId,
          };
        }

        const deletedAt = this.timestamp();
        const auditId = this.id();
        const retainedWorkIds = state.creativeWorks
          .filter(({ sessionId }) => sessionId === conversationId)
          .map(({ id }) => id);
        conversation.deletedAt = deletedAt;
        conversation.deletedBy = context.userId;
        conversation.deletionAuditEventId = auditId;
        conversation.updatedAt = deletedAt;
        state.auditEvents.push({
          action: 'composer_conversation.deleted',
          actorId: context.userId,
          correlationId: context.correlationId,
          createdAt: deletedAt,
          details: { retainedWorkIds },
          entityId: conversationId,
          entityType: 'composer_conversation',
          id: auditId,
          workspaceId: context.workspaceId,
        });
        return {
          action: 'composer_conversation.deleted',
          actorId: context.userId,
          auditId,
          conversationId,
          correlationId: context.correlationId,
          deletedAt,
          workspaceId: context.workspaceId,
        };
      },
    );
    await notifier.notify(fact);
    return fact;
  }




  async deriveCreativeWork(
    context: OperationContext,
    sourceWorkId: string,
    input: {
      contentModules?: CreativeContentModuleId[];
      intent: string;
      sessionId: string;
      sourceReferences?: CreativeSourceReference[];
      /** Revise turn (D-046): confirm the derived Brief at creation. */
      autoConfirmBrief?: boolean;
      briefDrafts?: Partial<
        Record<Exclude<CreativeBriefFieldId, 'intent'>, string>
      >;
    }
  ) {
    const state = await this.read(context);
    const source = state.creativeWorks.find((work) => work.id === sourceWorkId);
    if (!source) {
      throw new OperationsError(
        'SOURCE_WORK_NOT_FOUND',
        'The source Work was not found.',
        404
      );
    }
    return this.createCreativeWork(context, {
      derivedFrom: source.id,
      contentModules: input.contentModules ?? source.contentModules,
      ...(source.creationMode ? { creationMode: source.creationMode } : {}),
      intent: input.intent,
      mode: source.mode,
      operation: source.operation,
      sessionId: input.sessionId,
      sourceReferences: this.normalizedSourceReferences([
        ...source.sourceReferences,
        ...(input.sourceReferences ?? []),
      ]),
      ...(input.autoConfirmBrief === undefined
        ? {}
        : { autoConfirmBrief: input.autoConfirmBrief === true }),
      ...(input.briefDrafts ? { briefDrafts: input.briefDrafts } : {}),
    });
  }

  async saveCreativeWorkSelectionDraft(
    context: OperationContext,
    input: {
      workId: string;
      baseRevisionId: string;
      orderedAssetIds: string[];
      coverAssetId: string | null;
      surfaceVersion: string;
    },
  ) {
    return this.mutate(context, (state) => {
      const work = state.creativeWorks.find((item) => item.id === input.workId);
      if (!work) {
        throw new OperationsError(
          'CREATIVE_WORK_NOT_FOUND',
          'The creative Work was not found.',
          404,
        );
      }
      const validBaseRevisionIds = new Set([
        work.id,
        ...(work.currentJobId ? [work.currentJobId] : []),
        ...state.creativeContents
          .filter((content) => content.workId === work.id)
          .map((content) => content.id),
      ]);
      if (!validBaseRevisionIds.has(input.baseRevisionId)) {
        throw new OperationsError(
          'WORKING_SELECTION_BASE_STALE',
          'The image selection base revision is stale.',
          409,
        );
      }
      const orderedAssetIds = [...new Set(input.orderedAssetIds)];
      if (orderedAssetIds.length !== input.orderedAssetIds.length) {
        throw new OperationsError(
          'INVALID_WORKING_SELECTION',
          'The image selection cannot contain duplicate Assets.',
        );
      }
      const ownedImages = new Set(
        state.creativeAssets
          .filter((asset) => asset.workId === work.id && asset.kind === 'image')
          .map((asset) => asset.id),
      );
      if (orderedAssetIds.some((assetId) => !ownedImages.has(assetId))) {
        throw new OperationsError(
          'INVALID_WORKING_SELECTION',
          'The image selection can contain only this Work\'s owned image Assets.',
        );
      }
      if (input.coverAssetId && !orderedAssetIds.includes(input.coverAssetId)) {
        throw new OperationsError(
          'INVALID_WORKING_SELECTION',
          'The cover must belong to the ordered image selection.',
        );
      }
      const savedAt = this.timestamp();
      work.workingSelectionDraft = {
        baseRevisionId: input.baseRevisionId,
        orderedAssetIds,
        coverAssetId: input.coverAssetId,
        surfaceVersion: input.surfaceVersion,
        revision: (work.workingSelectionDraft?.revision ?? 0) + 1,
        savedAt,
        savedBy: context.userId,
      };
      work.updatedAt = savedAt;
      this.audit(
        state,
        context,
        'creative_work.selection_draft_saved',
        'creative_work',
        work.id,
        {
          baseRevisionId: input.baseRevisionId,
          orderedAssetIds,
          coverAssetId: input.coverAssetId,
          revision: work.workingSelectionDraft.revision,
        },
      );
      return structuredClone(work.workingSelectionDraft);
    });
  }

  async saveCreativeAssetsToLibrary(
    context: OperationContext,
    input: { workId: string; assetIds: string[] },
  ) {
    return this.mutate(context, (state) => {
      const assetIds = [...new Set(input.assetIds)];
      if (assetIds.length === 0 || assetIds.length !== input.assetIds.length) {
        throw new OperationsError(
          'INVALID_LIBRARY_SELECTION',
          'Select one or more unique image Assets to save.',
        );
      }
      const assets = assetIds.map((assetId) =>
        state.creativeAssets.find(
          (asset) => asset.id === assetId && asset.workId === input.workId,
        ),
      );
      if (
        assets.some(
          (asset) =>
            !asset ||
            asset.kind !== 'image' ||
            !asset.sha256 ||
            (!asset.ownedAssetId && !asset.objectKey),
        )
      ) {
        throw new OperationsError(
          'ASSET_NOT_LIBRARY_READY',
          'Only durable owned image versions with lineage can be saved to the library.',
          409,
        );
      }
      const savedAt = this.timestamp();
      for (const asset of assets) {
        if (!asset) continue;
        asset.savedToLibraryAt ??= savedAt;
        asset.savedToLibraryBy ??= context.userId;
        asset.libraryRevisionId ??= `media-revision-${createHash('sha256')
          .update(`${asset.workspaceId}:${asset.workId}:${asset.jobId}:${asset.id}:${asset.sha256}`)
          .digest('hex')
          .slice(0, 24)}`;
      }
      this.audit(
        state,
        context,
        'creative_asset.saved_to_library',
        'creative_work',
        input.workId,
        { assetIds },
      );
      return assets.map((asset) => structuredClone(asset!));
    });
  }

  private async applyCreativeOutcome(
    context: OperationContext,
    jobId: string,
    outcome: CreationExecutionResult
  ) {
    return this.mutate(context, (state) => {
      const currentJob = state.creativeJobs.find((item) => item.id === jobId);
      const currentWork = currentJob
        ? state.creativeWorks.find((item) => item.id === currentJob.workId)
        : undefined;
      if (!currentJob || !currentWork) {
        throw new OperationsError(
          'CREATIVE_JOB_NOT_FOUND',
          'The creative Job was not found.',
          404
        );
      }
      if (currentJob.status === 'completed' || currentJob.status === 'failed') {
        return this.creativeResult(state, currentWork.id, currentJob.id);
      }
      const mediaAssets =
        outcome.assets ?? (outcome.asset ? [outcome.asset] : []);
      const appliedOutcome: CreationExecutionResult =
        currentJob.contract.operation === 'copy.generate' &&
        outcome.status === 'completed' &&
        (outcome.copyCandidates?.length ?? 0) !== 3
          ? {
              executionProvenance: outcome.executionProvenance,
              failureCode: 'INVALID_COPY_CANDIDATE_COUNT',
              providerJobId: outcome.providerJobId,
              routeSnapshotId: outcome.routeSnapshotId,
              status: 'failed',
            }
          : currentJob.contract.operation !== 'copy.generate' &&
              outcome.status === 'completed' &&
              !mediaAssets.length
            ? {
                executionProvenance: outcome.executionProvenance,
                failureCode: 'MISSING_MEDIA_ASSET',
                providerJobId: outcome.providerJobId,
                routeSnapshotId: outcome.routeSnapshotId,
                status: 'failed',
              }
            : currentJob.contract.operation !== 'copy.generate' &&
                outcome.status === 'completed' &&
                mediaAssets.length !== currentJob.contract.outputCount
              ? {
                  executionProvenance: outcome.executionProvenance,
                  failureCode: 'INVALID_MEDIA_ASSET_COUNT',
                  providerJobId: outcome.providerJobId,
                  routeSnapshotId: outcome.routeSnapshotId,
                  status: 'failed',
                }
            : outcome;
      const previousStatus = currentJob.status;
      const timestamp = this.timestamp();
      currentJob.providerJobId = appliedOutcome.providerJobId;
      currentJob.routeSnapshotId = appliedOutcome.routeSnapshotId;
      currentJob.executionProvenance = appliedOutcome.executionProvenance;
      currentJob.failureCode = appliedOutcome.failureCode;
      currentJob.status = appliedOutcome.status;
      currentJob.updatedAt = timestamp;
      if (
        appliedOutcome.status === 'completed' &&
        previousStatus !== 'submitting'
      ) {
        currentJob.recoveredAt = timestamp;
      }
      currentWork.status =
        appliedOutcome.status === 'completed'
          ? 'completed'
          : appliedOutcome.status === 'failed'
            ? 'failed'
            : 'running';
      currentWork.updatedAt = timestamp;

      if (
        appliedOutcome.status === 'completed' &&
        currentJob.contract.operation !== 'copy.generate'
      ) {
        for (const [ordinal, output] of mediaAssets.entries()) {
          const assetId = `creative-asset-${createHash('sha256')
            .update(`${currentJob.id}:output:${ordinal}:${output.id}`)
            .digest('hex')
            .slice(0, 24)}`;
          if (!state.creativeAssets.some((asset) => asset.id === assetId)) {
            state.creativeAssets.push({
              contentType: output.contentType,
              createdAt: timestamp,
              id: assetId,
              jobId: currentJob.id,
              kind:
                output.contentType === 'video/mp4'
                  ? 'video'
                  : output.contentType.startsWith('audio/')
                    ? 'audio'
                    : 'image',
              objectKey: output.objectKey,
              ownedAssetId: output.id,
              sha256: output.sha256,
              ...(output.compositionEvidence
                ? {
                    compositionEvidence: structuredClone(
                      output.compositionEvidence,
                    ),
                  }
                : {}),
              ...(typeof output.sizeBytes === 'number'
                ? { sizeBytes: output.sizeBytes }
                : {}),
              title: currentWork.intent.slice(0, 80),
              workId: currentWork.id,
              workspaceId: context.workspaceId,
            });
            currentJob.outputAssetIds.push(assetId);
            this.creationEvent(state, context, 'first_assets_visible', {
              assetId,
              jobId: currentJob.id,
              workId: currentWork.id,
            });
          }
        }
      }

      for (const [index, candidate] of (appliedOutcome.status === 'completed'
        ? (appliedOutcome.copyCandidates ?? [])
        : []
      ).entries()) {
        const assetId = `creative-asset-${createHash('sha256')
          .update(`${currentJob.id}:text:${index}`)
          .digest('hex')
          .slice(0, 24)}`;
        if (state.creativeAssets.some((asset) => asset.id === assetId)) {
          continue;
        }
        state.creativeAssets.push({
          body: candidate.body,
          candidateIndex: index,
          ...(candidate.conversionHook
            ? { conversionHook: candidate.conversionHook }
            : {}),
          createdAt: timestamp,
          id: assetId,
          jobId: currentJob.id,
          kind: 'text',
          title: candidate.title,
          workId: currentWork.id,
          workspaceId: context.workspaceId,
        });
        currentJob.outputAssetIds.push(assetId);
        this.creationEvent(state, context, 'first_assets_visible', {
          assetId,
          jobId: currentJob.id,
          workId: currentWork.id,
        });
      }
      this.audit(
        state,
        context,
        `creative_job.${appliedOutcome.status}`,
        'creative_job',
        currentJob.id,
        {
          assetCount: currentJob.outputAssetIds.length,
          contentCount: currentJob.outputContentIds.length,
          failureCode: appliedOutcome.failureCode,
        }
      );
      return this.creativeResult(state, currentWork.id, currentJob.id);
    });
  }

  private async creativeInheritanceContext(
    context: OperationContext,
    workId: string
  ): Promise<CreativeInheritanceContext> {
    const state = await this.read(context);
    const work = state.creativeWorks.find((item) => item.id === workId);
    if (!work) {
      throw new OperationsError(
        'CREATIVE_WORK_NOT_FOUND',
        'The creative Work was not found.',
        404
      );
    }
    if (
      !work.sourceReferences.some((reference) => reference.inheritanceFields)
    ) {
      return { sources: [] };
    }

    const catalog = await this.repository.loadTemplateCatalog();
    const templateSources = new Map<
      string,
      ResolvedTemplateInheritanceSource
    >();
    for (const template of catalog.templates.filter(
      ownerCanUseOfficialTemplate
    )) {
      const versionId = selectTemplateVersionIdForWorkspace(
        template,
        context.workspaceId
      );
      const version = catalog.versions.find(
        (candidate) => candidate.id === versionId
      );
      if (!version) continue;
      templateSources.set(template.id, {
        ...(CONTENT_MODULE_IDS.has(template.family as CreativeContentModuleId)
          ? {
              contentModules: [template.family as CreativeContentModuleId],
            }
          : {}),
        document: version.document,
      });
    }
    for (const template of state.userTemplates.filter(
      (candidate) => !candidate.deletedAt
    )) {
      const sourceWork = state.works.find(
        (candidate) => candidate.id === template.sourceWorkId
      );
      const sourceRevision = sourceWork?.revisions.find(
        (candidate) => candidate.id === template.canvasRevisionId
      );
      if (sourceRevision) {
        templateSources.set(template.id, {
          document: sourceRevision.document,
        });
      }
    }

    const resolution = resolveCreativeInheritanceContext({
      state,
      templateSources,
      work,
    });
    if (!resolution.ok) {
      throw new OperationsError(
        resolution.reason === 'unsupported_source_kind'
          ? 'CREATIVE_INHERITANCE_SOURCE_UNSUPPORTED'
          : 'CREATIVE_INHERITANCE_SOURCE_NOT_FOUND',
        resolution.reason === 'unsupported_source_kind'
          ? 'This source kind does not expose inheritable structural facts.'
          : 'An inherited source was not found in this workspace.',
        resolution.reason === 'unsupported_source_kind' ? 409 : 404
      );
    }
    return resolution.context;
  }

  private async executeCreativeJob(context: OperationContext, jobId: string) {
    const executor = this.dependencies.creationExecutor;
    if (!executor) {
      throw new OperationsError(
        'CREATION_EXECUTOR_UNAVAILABLE',
        'The creation executor is not configured.',
        503
      );
    }
    const before = await this.read(context);
    const job = before.creativeJobs.find((item) => item.id === jobId);
    const work = job
      ? before.creativeWorks.find((item) => item.id === job.workId)
      : undefined;
    if (!job || !work) {
      throw new OperationsError(
        'CREATIVE_JOB_NOT_FOUND',
        'The creative Job was not found.',
        404
      );
    }
    if (job.status === 'unknown' || job.status === 'completed') {
      return this.creativeResult(before, work.id, job.id);
    }
    if (job.status === 'failed') {
      throw new OperationsError(
        'TERMINAL_JOB_REQUIRES_RETRY',
        'A terminal failed Job requires a new retry Job.',
        409
      );
    }

    const inheritanceContext =
      job.inheritanceContext ??
      (await this.creativeInheritanceContext(context, work.id));

    if ((job.productUsageQuantity ?? 1) > 0) {
      await this.dependencies.billingLifecycle?.beforeSubmit({
        ...(job.billingQuoteId ? { quoteId: job.billingQuoteId } : {}),
        quoteRevision: job.contract.quoteRevision,
        resource: creativeBillingResource(job.contract.operation),
        taskId: job.billingTaskId ?? work.id,
        workspaceId: context.workspaceId,
      });
    }

    const outcome = await executor.submit({
      ...((job.productUsageQuantity ?? 1) > 0
        ? {
            billingQuoteRevision: job.contract.quoteRevision,
            billingTaskId: job.billingTaskId ?? work.id,
          }
        : {}),
      briefSnapshot: structuredClone(job.briefSnapshot),
      context,
      contract: structuredClone(job.contract),
      groundingSnapshot: structuredClone(job.groundingSnapshot),
      idempotencyKey: job.submissionKey,
      inheritanceContext: structuredClone(inheritanceContext),
      intent: job.briefSnapshot?.fields.intent?.current ?? work.intent,
      productUsageQuantity: job.productUsageQuantity ?? 1,
      workId: work.id,
    });
    return this.applyCreativeOutcome(context, job.id, outcome);
  }

  private async prepareCreativeJob(
    context: OperationContext,
    workId: string,
    contract: CreativeExecutionContract,
    submissionKey: string,
    options: CreativeJobPreparationOptions = {}
  ) {
    const resolvedContract = await this.resolveCreativeContract(
      context,
      workId,
      contract
    );
    this.validateCreativeContract(resolvedContract);
    if (!submissionKey.trim()) {
      throw new OperationsError(
        'SUBMISSION_KEY_REQUIRED',
        'A stable submission key is required.'
      );
    }
    const executor = this.dependencies.creationExecutor;
    if (!executor) {
      throw new OperationsError(
        'CREATION_EXECUTOR_UNAVAILABLE',
        'The creation executor is not configured.',
        503
      );
    }
    const jobId = this.creativeJobId(workId, submissionKey);
    const billingTaskId =
      options.reroll?.kind === 'paid' ? jobId : workId;
    const snapshotState = await this.read(context);
    const existingJob = snapshotState.creativeJobs.find(
      (job) => job.id === jobId
    );
    if (existingJob) {
      this.assertCreativeJobReplay(existingJob, resolvedContract, options);
    }
    if (
      !existingJob &&
      resolvedContract.operation === 'video.generate' &&
      !options.retryOf &&
      !options.reroll
    ) {
      const receipt = snapshotState.creativeGenerationApprovalReceipts?.find(
        ({ id }) => id === options.approvalReceiptId,
      );
      if (
        !receipt ||
        !isApprovalReceiptActiveAt(receipt, this.timestamp()) ||
        receipt.binding.workId !== workId ||
        receipt.binding.workspaceId !== context.workspaceId ||
        receipt.binding.contractFingerprint !==
          creativeContractFingerprint(resolvedContract)
      ) {
        throw new OperationsError(
          'CREATIVE_GENERATION_APPROVAL_REQUIRED',
          'Video generation requires an active ApprovalReceipt for this exact contract.',
          409,
        );
      }
    }
    const existingSnapshot = existingJob?.inheritanceContext;
    const sourceSnapshotId = options.retryOf ?? options.reroll?.sourceJobId;
    const sourceJob = sourceSnapshotId
      ? snapshotState.creativeJobs.find((job) => job.id === sourceSnapshotId)
      : undefined;
    const sourceSnapshot = sourceJob?.inheritanceContext;
    const inheritanceContext =
      existingSnapshot ??
      sourceSnapshot ??
      (await this.creativeInheritanceContext(context, workId));
    const snapshotWork = snapshotState.creativeWorks.find(
      (item) => item.id === workId
    );
    if (!snapshotWork) {
      throw new OperationsError(
        'CREATIVE_WORK_NOT_FOUND',
        'The creative Work was not found.',
        404
      );
    }
    const briefSnapshot =
      existingJob?.briefSnapshot ??
      sourceJob?.briefSnapshot ??
      snapshotWork.brief;
    if (
      !existingJob &&
      !sourceJob?.briefSnapshot &&
      briefSnapshot &&
      !briefSnapshot.confirmedAt
    ) {
      throw new OperationsError(
        'CREATIVE_BRIEF_NOT_CONFIRMED',
        'Confirm the creative Brief before submitting this Work.',
        409
      );
    }
    let groundingSnapshot: CreativeGroundingSnapshot | undefined =
      existingJob?.groundingSnapshot ?? sourceJob?.groundingSnapshot;
    if (
      !existingJob &&
      !groundingSnapshot &&
      this.dependencies.groundingResolver
    ) {
      const sourceAssetIds = snapshotWork.sourceReferences
        .filter((reference) => reference.kind === 'asset')
        .map((reference) => reference.id);
      const resolution = await this.dependencies.groundingResolver.resolve(
        context.workspaceId,
        sourceAssetIds,
        snapshotWork.creationMode
      );
      if (resolution.status === 'missing') {
        throw new OperationsError(
          'CREATIVE_GROUNDING_INCOMPLETE',
          `Confirmed Product grounding is incomplete: ${resolution.missing.join(', ')}.`,
          409,
          { missing: resolution.missing }
        );
      }
      groundingSnapshot = resolution.snapshot;
    }
    let acceptedQuoteAuthority:
      | import('./types.js').AcceptedProductQuoteInspectionAuthority
      | undefined;
    if (options.billingQuoteId) {
      const assertAcceptedQuote =
        this.dependencies.billingLifecycle?.assertAcceptedQuote;
      if (!assertAcceptedQuote) {
        throw new OperationsError(
          'BILLING_QUOTE_VALIDATOR_UNAVAILABLE',
          'Confirmed Product quote validation is unavailable.',
          503,
        );
      }
      const acceptedQuote = await assertAcceptedQuote.call(
        this.dependencies.billingLifecycle,
        {
          quoteId: options.billingQuoteId,
          quoteRevision: resolvedContract.quoteRevision,
          taskId: billingTaskId,
          workspaceId: context.workspaceId,
        },
      );
      if (
        acceptedQuote.quoteId !== options.billingQuoteId ||
        acceptedQuote.revision !== resolvedContract.quoteRevision ||
        acceptedQuote.catalogModelId !== resolvedContract.catalogModelId ||
        acceptedQuote.catalogModelRevision !== resolvedContract.catalogRevision ||
        acceptedQuote.confirmedAmount !== resolvedContract.estimatedAmount ||
        acceptedQuote.formula.currency !== resolvedContract.currency ||
        acceptedQuote.outputCount !== resolvedContract.outputCount ||
        acceptedQuote.outputLabel !== resolvedContract.outputLabel
      ) {
        throw new OperationsError(
          'CREATIVE_QUOTE_CHANGED',
          'The accepted Product quote no longer matches the execution contract.',
          409,
        );
      }
      acceptedQuoteAuthority = {
        kind: 'accepted_product_quote',
        quoteId: acceptedQuote.quoteId,
        quoteRevision: acceptedQuote.revision,
        catalogModelId: acceptedQuote.catalogModelId,
        catalogModelRevision: acceptedQuote.catalogModelRevision,
        confirmedAmount: acceptedQuote.confirmedAmount,
        currency: acceptedQuote.formula.currency,
        outputCount: acceptedQuote.outputCount,
        outputLabel: acceptedQuote.outputLabel,
      };
    }
    if (!existingJob) {
      if (acceptedQuoteAuthority) {
        await executor.inspect(
          context.workspaceId,
          resolvedContract,
          acceptedQuoteAuthority,
        );
      } else {
        await executor.inspect(context.workspaceId, resolvedContract);
      }
    }
    const prepared = await this.mutate(context, async (state, repository) => {
      const briefContextId =
        options.briefContextId ?? snapshotWork.briefContextId;
      const briefConfirmationId =
        options.briefConfirmationId ?? snapshotWork.briefConfirmationId;
      let briefContextRevision: number | undefined;
      const derivedAutoConfirmedBrief =
        Boolean(snapshotWork.derivedFrom) &&
        Boolean(snapshotWork.brief?.confirmedAt);
      if (this.dependencies.briefSubmissionGate) {
        if (!briefContextId && !derivedAutoConfirmedBrief) {
          throw new OperationsError(
            'BRIEF_CONTEXT_REQUIRED',
            'Creative submissions require a server Brief context.',
          );
        }
        if (briefContextId) {
          briefContextRevision = await this.assertBriefCurrentForWrite(
            repository,
            {
              ...(briefConfirmationId ? { briefConfirmationId } : {}),
              briefContextId,
              ...(resolvedContract.aspectRatio
                ? { aspectRatio: resolvedContract.aspectRatio }
                : {}),
              catalogModelId: resolvedContract.catalogModelId,
              catalogRevision: resolvedContract.catalogRevision,
              ...(resolvedContract.durationSeconds !== undefined
                ? { durationSeconds: resolvedContract.durationSeconds }
                : {}),
              ...(snapshotWork.briefContextRevision === undefined
                ? {}
                : {
                    expectedContextRevision:
                      snapshotWork.briefContextRevision,
                  }),
              intent: snapshotWork.intent,
              operation: resolvedContract.operation,
              outputCount: resolvedContract.outputCount,
              quoteRevision: resolvedContract.quoteRevision,
              sourceReferenceIds: snapshotWork.sourceReferences.map(
                (source) => source.id,
              ),
              workspaceId: context.workspaceId,
            },
          );
        }
      }
      const existing = state.creativeJobs.find((job) => job.id === jobId);
      if (existing) {
        this.assertCreativeJobReplay(existing, resolvedContract, options);
        return { job: existing, replayed: true };
      }
      if (options.retryOf && options.reroll) {
        throw new OperationsError(
          'INVALID_CREATIVE_RETRY_KIND',
          'A Job cannot be both a technical retry and a successful reroll.',
          409
        );
      }
      const work = state.creativeWorks.find((item) => item.id === workId);
      if (!work) {
        throw new OperationsError(
          'CREATIVE_WORK_NOT_FOUND',
          'The creative Work was not found.',
          404
        );
      }
      const workJobs = state.creativeJobs.filter(
        (candidate) => candidate.workId === work.id
      );
      const retrySource = options.retryOf
        ? state.creativeJobs.find((job) => job.id === options.retryOf)
        : undefined;
      if (options.retryOf) {
        if (
          !retrySource ||
          retrySource.workId !== work.id ||
          retrySource.status !== 'failed'
        ) {
          throw new OperationsError(
            'INVALID_RETRY_SOURCE',
            'Only a terminal failed Job can create a retry.',
            409
          );
        }
      }
      const rerollSource = options.reroll
        ? state.creativeJobs.find(
            (job) => job.id === options.reroll?.sourceJobId
          )
        : undefined;
      if (options.reroll) {
        if (
          !rerollSource ||
          rerollSource.workId !== work.id ||
          !this.completeCopyCandidateBatch(state, rerollSource)
        ) {
          throw new OperationsError(
            'INVALID_REROLL_SOURCE',
            'Only a completed three-candidate copy Job can be rerolled.',
            409
          );
        }
        if (
          JSON.stringify(stableValue(rerollSource.contract)) !==
          JSON.stringify(stableValue(resolvedContract))
        ) {
          throw new OperationsError(
            'REROLL_CONTRACT_CHANGED',
            'A reroll must keep the original model and execution contract.',
            409
          );
        }
        if (
          rerollSource.outputContentIds.length > 0 ||
          state.creativeContents.some(
            (content) => content.jobId === rerollSource.id
          )
        ) {
          throw new OperationsError(
            'CREATIVE_BATCH_ALREADY_ACCEPTED',
            'An accepted candidate batch cannot be rerolled.',
            409
          );
        }
      }
      const nextBatchNumber =
        Math.max(0, ...workJobs.map((job) => job.batchNumber ?? 0)) + 1;
      let batchRootJobId = jobId;
      let batchNumber = nextBatchNumber;
      let qualityRetryNumber = 0;
      let productUsageQuantity: 0 | 1 = 1;
      if (retrySource) {
        batchRootJobId = retrySource.batchRootJobId ?? retrySource.id;
        batchNumber = retrySource.batchNumber ?? nextBatchNumber;
        qualityRetryNumber = retrySource.qualityRetryNumber ?? 0;
      } else if (rerollSource && options.reroll) {
        if (options.reroll.kind === 'quality') {
          batchRootJobId = rerollSource.batchRootJobId ?? rerollSource.id;
          const rootHasAcceptedContent = state.creativeContents.some(
            (content) => {
              const contentJob = state.creativeJobs.find(
                (candidate) => candidate.id === content.jobId
              );
              return (
                contentJob &&
                (contentJob.batchRootJobId ?? contentJob.id) === batchRootJobId
              );
            }
          );
          if (rootHasAcceptedContent) {
            throw new OperationsError(
              'CREATIVE_BATCH_ALREADY_ACCEPTED',
              'An accepted candidate batch cannot use a quality retry.',
              409
            );
          }
          const usedQualityRetries = state.creativeJobs.filter(
            (candidate) =>
              (candidate.batchRootJobId ?? candidate.id) === batchRootJobId &&
              candidate.rerollKind === 'quality'
          ).length;
          if (usedQualityRetries >= 2) {
            throw new OperationsError(
              'QUALITY_RETRY_LIMIT_REACHED',
              'This paid candidate batch already used both quality retries.',
              409
            );
          }
          qualityRetryNumber = usedQualityRetries + 1;
          productUsageQuantity = 0;
        }
      }
      const timestamp = this.timestamp();
      if (
        resolvedContract.operation === 'video.generate' &&
        !options.retryOf &&
        !options.reroll
      ) {
        state.creativeGenerationApprovalReceipts ??= [];
        const receiptIndex = state.creativeGenerationApprovalReceipts.findIndex(
          ({ id }) => id === options.approvalReceiptId,
        );
        const receipt = state.creativeGenerationApprovalReceipts[receiptIndex];
        if (
          !receipt ||
          !isApprovalReceiptActiveAt(receipt, timestamp) ||
          receipt.binding.workId !== workId ||
          receipt.binding.workUpdatedAt !== work.updatedAt ||
          receipt.binding.contractFingerprint !==
            creativeContractFingerprint(resolvedContract)
        ) {
          throw new OperationsError(
            'CREATIVE_GENERATION_APPROVAL_REQUIRED',
            'Video generation approval is missing, stale, or already consumed.',
            409,
          );
        }
        state.creativeGenerationApprovalReceipts[receiptIndex] =
          creativeGenerationApprovalReceiptSchema.parse({
            ...receipt,
            events: [
              ...receipt.events,
              {
                actorId: context.userId,
                eventId: this.id(),
                externalEffectId: jobId,
                occurredAt: timestamp,
                type: 'consumed',
              },
            ],
            status: 'consumed',
          });
        this.audit(
          state,
          context,
          'creative_generation.approval_consumed',
          'creative_work',
          work.id,
          { approvalReceiptId: receipt.id, jobId },
        );
      }
      const job: CreativeJob = {
        batchNumber,
        batchRootJobId,
        ...(briefSnapshot
          ? { briefSnapshot: structuredClone(briefSnapshot) }
          : {}),
        ...(briefContextRevision === undefined
          ? {}
          : { briefContextRevision }),
        contract: structuredClone(resolvedContract),
        billingTaskId,
        ...(options.billingQuoteId
          ? { billingQuoteId: options.billingQuoteId }
          : {}),
        createdAt: timestamp,
        ...(groundingSnapshot
          ? { groundingSnapshot: structuredClone(groundingSnapshot) }
          : {}),
        id: jobId,
        inheritanceContext: structuredClone(inheritanceContext),
        outputAssetIds: [],
        outputContentIds: [],
        productUsageQuantity,
        qualityRetryNumber,
        ...(options.retryOf ? { retryOf: options.retryOf } : {}),
        ...(options.reroll
          ? {
              rerollKind: options.reroll.kind,
              rerollOf: options.reroll.sourceJobId,
            }
          : {}),
        status: 'submitting',
        submissionKey,
        updatedAt: timestamp,
        workId,
        workspaceId: context.workspaceId,
      };
      state.creativeJobs.push(job);
      work.currentJobId = job.id;
      work.status = 'running';
      work.updatedAt = timestamp;
      this.creationEvent(state, context, 'first_job_submitted', {
        jobId: job.id,
        workId,
      });
      return { job, replayed: false };
    });
    const state = await this.read(context);
    const work = state.creativeWorks.find((item) => item.id === workId);
    if (!work) {
      throw new OperationsError(
        'CREATIVE_WORK_NOT_FOUND',
        'The creative Work was not found.',
        404
      );
    }
    return {
      briefSnapshot: structuredClone(prepared.job.briefSnapshot),
      contract: resolvedContract,
      groundingSnapshot: structuredClone(prepared.job.groundingSnapshot),
      inheritanceContext: structuredClone(
        prepared.job.inheritanceContext ?? inheritanceContext
      ),
      intent: work.intent,
      billingQuoteId: prepared.job.billingQuoteId,
      billingTaskId: prepared.job.billingTaskId ?? work.id,
      jobId: prepared.job.id,
      productUsageQuantity: prepared.job.productUsageQuantity ?? 1,
      replayed: prepared.replayed,
    };
  }

  async submitCreativeWork(
    context: OperationContext,
    workId: string,
    contract: CreativeExecutionContract,
    submissionKey: string,
    retryOf?: string,
    approvalReceiptId?: string,
    briefContextId?: string,
    briefConfirmationId?: string,
    billingQuoteId?: string,
  ) {
    const state = await this.read(context);
    const work = state.creativeWorks.find((item) => item.id === workId);
    if (
      briefContextId &&
      work?.briefContextId &&
      briefContextId !== work.briefContextId
    ) {
      throw new OperationsError(
        'INVALID_CREATIVE_CONTRACT',
        'The Work Brief context cannot be replaced at submission.',
      );
    }
    if (
      briefConfirmationId &&
      work?.briefConfirmationId &&
      briefConfirmationId !== work.briefConfirmationId
    ) {
      throw new OperationsError(
        'INVALID_CREATIVE_CONTRACT',
        'The Work Brief confirmation cannot be replaced at submission.',
      );
    }
    if (
      this.dependencies.briefSubmissionGate &&
      work &&
      contract.operation !== work.operation
    ) {
      throw new OperationsError(
        'INVALID_CREATIVE_CONTRACT',
        'The execution operation must match the Work operation.',
      );
    }
    const effectiveBriefContextId = work?.briefContextId ?? briefContextId;
    const effectiveBriefConfirmationId =
      work?.briefConfirmationId ?? briefConfirmationId;
    // Derived revise Works created with autoConfirmBrief may lack a server
    // briefContextId; local confirmed Brief + derivedFrom is the D-046 path.
    const derivedAutoConfirmedBrief =
      Boolean(work?.derivedFrom) && Boolean(work?.brief?.confirmedAt);
    if (
      this.dependencies.briefSubmissionGate &&
      !effectiveBriefContextId &&
      !derivedAutoConfirmedBrief
    ) {
      throw new OperationsError(
        'BRIEF_CONTEXT_REQUIRED',
        'Creative submissions require a server Brief context.',
      );
    }
    const prepared = await this.prepareCreativeJob(
      context,
      workId,
      contract,
      submissionKey,
      retryOf || approvalReceiptId || effectiveBriefContextId || billingQuoteId
        ? {
            ...(billingQuoteId ? { billingQuoteId } : {}),
            ...(effectiveBriefConfirmationId
              ? { briefConfirmationId: effectiveBriefConfirmationId }
              : {}),
            ...(effectiveBriefContextId
              ? { briefContextId: effectiveBriefContextId }
              : {}),
            ...(retryOf ? { retryOf } : {}),
            ...(approvalReceiptId ? { approvalReceiptId } : {}),
          }
        : undefined
    );
    return this.executeCreativeJob(context, prepared.jobId);
  }


  async resumeCreativeJob(context: OperationContext, jobId: string) {
    const state = await this.read(context);
    const job = state.creativeJobs.find((item) => item.id === jobId);
    if (!job) {
      throw new OperationsError(
        'CREATIVE_JOB_NOT_FOUND',
        'The creative Job was not found.',
        404
      );
    }
    if (job.status === 'unknown' || job.status === 'running') {
      const executor = this.dependencies.creationExecutor;
      if (!executor || !job.providerJobId || !job.routeSnapshotId) {
        throw new OperationsError(
          'CREATIVE_JOB_NOT_VERIFIABLE',
          'The original Job does not have enough provider evidence to verify.',
          409
        );
      }
      const outcome = await executor.verify({
        context,
        contract: structuredClone(job.contract),
        providerJobId: job.providerJobId,
        routeSnapshotId: job.routeSnapshotId,
      });
      return this.applyCreativeOutcome(context, job.id, outcome);
    }
    if (job.status !== 'recoverable' && job.status !== 'submitting') {
      throw new OperationsError(
        'CREATIVE_JOB_NOT_RECOVERABLE',
        'Only a recoverable Job can resume in place.',
        409
      );
    }
    return this.executeCreativeJob(context, job.id);
  }

  async cancelCreativeJob(context: OperationContext, jobId: string) {
    const state = await this.read(context);
    const job = state.creativeJobs.find((item) => item.id === jobId);
    if (!job) {
      throw new OperationsError(
        'CREATIVE_JOB_NOT_FOUND',
        'The creative Job was not found.',
        404,
      );
    }
    if (!['submitting', 'running', 'recoverable', 'unknown'].includes(job.status)) {
      throw new OperationsError(
        'CREATIVE_JOB_NOT_CANCELLABLE',
        'Only an active creative Job can be cancelled.',
        409,
      );
    }
    const executor = this.dependencies.creationExecutor;
    if (!executor?.cancel || !job.providerJobId) {
      throw new OperationsError(
        'CREATIVE_JOB_NOT_CANCELLABLE',
        'The active creative Job does not expose a cancellation handle.',
        409,
      );
    }
    const outcome = await executor.cancel({
      context,
      contract: structuredClone(job.contract),
      providerJobId: job.providerJobId,
    });
    return this.applyCreativeOutcome(context, job.id, outcome);
  }

  private async resolveCreativeContract(
    context: OperationContext,
    workId: string,
    contract: CreativeExecutionContract
  ) {
    const state = await this.read(context);
    const work = state.creativeWorks.find((item) => item.id === workId);
    if (!work) {
      throw new OperationsError(
        'CREATIVE_WORK_NOT_FOUND',
        'The creative Work was not found.',
        404
      );
    }
    const contentModules = this.normalizedContentModules(work.contentModules);
    if (
      contract.contentModules &&
      (contract.contentModules.length !== contentModules.length ||
        contract.contentModules.some(
          (moduleId, index) => moduleId !== contentModules[index]
        ))
    ) {
      throw new OperationsError(
        'CONTENT_MODULE_SNAPSHOT_MISMATCH',
        'The submitted content suite no longer matches the current Work.',
        409
      );
    }
    const assetReferences = work.sourceReferences.filter(
      (reference) => reference.kind === 'asset'
    );
    if (assetReferences.length === 0) {
      return {
        ...structuredClone(contract),
        contentModules,
        dataClass: [],
      };
    }
    const resolver = this.dependencies.assetDataClassResolver;
    if (!resolver) {
      throw new OperationsError(
        'CREATIVE_SOURCE_CLASSIFICATION_UNAVAILABLE',
        'Source Asset classification is unavailable.',
        503
      );
    }
    const dataClass = new Set<'contains_face' | 'pii' | 'medical'>();
    for (const reference of assetReferences) {
      const resolved = await resolver.resolve(
        context.workspaceId,
        reference.id
      );
      if (!resolved) {
        throw new OperationsError(
          'CREATIVE_SOURCE_ASSET_NOT_FOUND',
          'A source Asset was not found in this workspace.',
          404
        );
      }
      for (const value of resolved) dataClass.add(value);
    }
    return {
      ...structuredClone(contract),
      contentModules,
      dataClass: [...dataClass].sort(),
    };
  }

  async retryCreativeJob(
    context: OperationContext,
    failedJobId: string,
    submissionKey: string
  ) {
    const state = await this.read(context);
    const failed = state.creativeJobs.find((job) => job.id === failedJobId);
    if (!failed || failed.status !== 'failed') {
      throw new OperationsError(
        'INVALID_RETRY_SOURCE',
        'Only a terminal failed Job can create a retry.',
        409
      );
    }
    return this.submitCreativeWork(
      context,
      failed.workId,
      failed.contract,
      submissionKey,
      failed.retryOf ?? failed.id
    );
  }

  private async rerollCompletedCreativeJob(
    context: OperationContext,
    sourceJobId: string,
    submissionKey: string,
    kind: CreativeRerollKind,
    billingQuoteId?: string,
  ) {
    const state = await this.read(context);
    const source = state.creativeJobs.find((job) => job.id === sourceJobId);
    if (!source) {
      throw new OperationsError(
        'CREATIVE_JOB_NOT_FOUND',
        'The creative Job was not found.',
        404
      );
    }
    const prepared = await this.prepareCreativeJob(
      context,
      source.workId,
      source.contract,
      submissionKey,
      {
        ...(billingQuoteId ? { billingQuoteId } : {}),
        reroll: { kind, sourceJobId },
      },
    );
    const result = await this.executeCreativeJob(context, prepared.jobId);
    if (result.job.status === 'completed') {
      try {
        await this.dependencies.creationExecutor?.recordReroll?.({
          context,
          contract: structuredClone(result.job.contract),
          rerollKind: kind,
          targetJobId: result.job.id,
        });
      } catch {
        // Quality telemetry must never cause a successful provider execution to repeat.
      }
    }
    return result;
  }



  private async requireContentPackageWrite(context: OperationContext) {
    if (!this.dependencies.contentWriteOwnership) return;
    const owner = await this.dependencies.contentWriteOwnership.get(
      context.workspaceId
    );
    const decision = decideContentPackageCanonicalWrite(owner);
    if (decision.decision === 'allow') return;
    if (decision.code === 'WRITE_OWNERSHIP_MISSING') {
      const error = writeOwnershipMissingError('contentpackage');
      throw new OperationsError(error.code, error.message, error.status);
    }
    throw new OperationsError(
      'CONTENT_COMMANDS_FROZEN',
      'Content changes are frozen for migration.',
      409
    );
  }

  async adoptIntoContentPackage(
    context: OperationContext,
    input: {
      copyCandidateAssetId: string;
      visualAssetIds: string[];
      workId: string;
    }
  ) {
    return this.mutate(context, async (state) => {
      await this.requireContentPackageWrite(context);
      state.contentPackages ??= [];
      const work = state.creativeWorks.find((item) => item.id === input.workId);
      if (!work) {
        throw new OperationsError(
          'CREATIVE_WORK_NOT_FOUND',
          'The creative Work was not found.',
          404
        );
      }
      const copyAsset = state.creativeAssets.find(
        (asset) => asset.id === input.copyCandidateAssetId
      );
      const copyJob = copyAsset
        ? state.creativeJobs.find((job) => job.id === copyAsset.jobId)
        : undefined;
      const candidates = copyJob
        ? this.completeCopyCandidateBatch(state, copyJob)
        : undefined;
      if (
        !copyAsset ||
        !copyJob ||
        copyAsset.kind !== 'text' ||
        copyAsset.workId !== work.id ||
        copyJob.workId !== work.id ||
        !candidates?.some((candidate) => candidate.id === copyAsset.id)
      ) {
        throw new OperationsError(
          'INVALID_COPY_CANDIDATE_BATCH',
          'Only one candidate from a completed three-candidate copy batch can be adopted.',
          409
        );
      }
      const alreadyAdopted = state.contentPackages.some(
        (contentPackage) =>
          contentPackage.kind === 'image_text' &&
          contentPackage.source.workId === work.id
      );
      const acceptedLegacyContent = state.creativeContents.some(
        (content) => content.workId === work.id
      );
      const acceptedLegacyJob = state.creativeJobs.some(
        (job) => job.workId === work.id && job.outputContentIds.length > 0
      );
      if (alreadyAdopted || acceptedLegacyContent || acceptedLegacyJob) {
        throw new OperationsError(
          'COPY_CANDIDATE_ALREADY_ACCEPTED',
          'This copy Work already has an accepted candidate.',
          409
        );
      }
      if (input.visualAssetIds.length === 0) {
        throw new OperationsError(
          'VISUAL_ASSET_REQUIRED',
          'An image-text ContentPackage requires at least one visual Asset.',
          400
        );
      }
      if (new Set(input.visualAssetIds).size !== input.visualAssetIds.length) {
        throw new OperationsError(
          'DUPLICATE_VISUAL_ASSET',
          'Visual Assets must be unique and ordered.',
          400
        );
      }
      const visualAssets = input.visualAssetIds.map((assetId) =>
        state.creativeAssets.find((asset) => asset.id === assetId)
      );
      const referencedProductAssetIds = new Set(
        work.sourceReferences.flatMap((source) =>
          source.kind === 'asset' ? [source.id] : []
        )
      );
      const productVisualAssetIds = input.visualAssetIds.filter(
        (assetId, index) =>
          !visualAssets[index] && referencedProductAssetIds.has(assetId)
      );
      const sessionWorkIds = new Set(
        state.creativeWorks
          .filter(
            (candidate) =>
              candidate.workspaceId === context.workspaceId &&
              candidate.sessionId === work.sessionId
          )
          .map((candidate) => candidate.id)
      );
      if (
        visualAssets.some(
          (asset, index) =>
            asset
              ? asset.workspaceId !== context.workspaceId ||
                !sessionWorkIds.has(asset.workId) ||
                asset.kind !== 'image' ||
                !asset.ownedAssetId
              : !productVisualAssetIds.includes(input.visualAssetIds[index]!)
        )
      ) {
        throw new OperationsError(
          'INVALID_VISUAL_ASSET',
          'Every visual Asset must be a delivered image from the same creation Session.',
          409
        );
      }
      if (productVisualAssetIds.length > 0) {
        const rights = await this.dependencies.contentPackageRightsResolver?.resolve(
          {
            assetIds: productVisualAssetIds,
            workspaceId: context.workspaceId,
          }
        );
        if (
          !rights ||
          rights.unauthorizedAssetIds.length > 0 ||
          (rights.knownAssetIds !== undefined &&
            productVisualAssetIds.some(
              (assetId) => !rights.knownAssetIds?.includes(assetId)
            ))
        ) {
          throw new OperationsError(
            'INVALID_VISUAL_ASSET',
            'Every Product visual Asset must exist and remain authorized.',
            409
          );
        }
      }
      const deliveredVisualAssets = visualAssets.filter(
        (asset): asset is CreativeAssetProjection => Boolean(asset)
      );
      const timestamp = this.timestamp();
      const packageId = `content-package-${createHash('sha256')
        .update(`${context.workspaceId}:${work.id}:image-text`)
        .digest('hex')
        .slice(0, 24)}`;
      const versionId = `${packageId}-v1`;
      const childRunIds = [
        copyJob.id,
        ...deliveredVisualAssets.map((asset) => asset.jobId),
      ].filter((runId, index, runIds) => runIds.indexOf(runId) === index);
      const groundingAssetIds = childRunIds.flatMap(
        (runId) =>
          state.creativeJobs
            .find((job) => job.id === runId)
            ?.groundingSnapshot?.assets.map((asset) => asset.id) ?? []
      );
      const draft = {
        ...buildContentPackage({
          id: packageId,
          kind: 'image_text',
          source: {
            assetIds: [
              ...new Set([
                copyAsset.id,
                ...input.visualAssetIds,
                ...groundingAssetIds,
              ]),
            ],
            workId: work.id,
          },
          timestamp,
          workspaceId: context.workspaceId,
        }),
        compliance: {
          aigcLabelEnabled: copyJob.contract.aigcLabelEnabled,
          watermarkEnabled: copyJob.contract.watermarkEnabled,
          ...(copyJob.contract.watermarkEnabled
            ? {
                watermarkText:
                  copyJob.groundingSnapshot?.store?.name.trim() || '品牌内容',
              }
            : {}),
        },
        generated: {
          assetIds: deliveredVisualAssets.map((asset) => asset.id),
          childRuns: childRunIds.map((runId) => ({
            runId,
            runType: 'creative_job' as const,
            status: 'succeeded' as const,
          })),
          ownedAssets: deliveredVisualAssets.flatMap((asset) =>
            asset.objectKey && asset.sha256 && asset.contentType
              ? [
                  {
                    contentType: asset.contentType,
                    id: asset.id,
                    objectKey: asset.objectKey,
                    sha256: asset.sha256,
                    ...(typeof asset.sizeBytes === 'number'
                      ? { sizeBytes: asset.sizeBytes }
                      : {}),
                  },
                ]
              : []
          ),
        },
      };
      let contentPackage: ContentPackage;
      try {
        contentPackage = transitionContentPackage(
          draft,
          {
            type: 'adopted',
            version: {
              body: copyAsset.body ?? '',
              ...(copyAsset.conversionHook
                ? { conversionHook: copyAsset.conversionHook }
                : {}),
              createdAt: timestamp,
              id: versionId,
              orderedAssetIds: [...input.visualAssetIds],
              title: copyAsset.title,
              topics: [],
            },
          },
          timestamp
        );
      } catch (error) {
        if (error instanceof ContentPackageTransitionError) {
          throw new OperationsError(
            'CONTENT_PACKAGE_TRANSITION_CONFLICT',
            error.message,
            409
          );
        }
        throw error;
      }
      state.contentPackages.push(contentPackage);
      work.status = 'accepted';
      work.updatedAt = timestamp;
      this.audit(
        state,
        context,
        'content_package.adopted',
        'content_package',
        contentPackage.id,
        {
          copyCandidateAssetId: copyAsset.id,
          visualAssetIds: [...input.visualAssetIds],
          workId: work.id,
        }
      );
      this.creationEvent(state, context, 'first_content_accepted', {
        contentPackageId: contentPackage.id,
        jobId: copyJob.id,
        workId: work.id,
      });
      return {
        ...contentPackage,
        ...contentPackageVisibleStatus(contentPackage.status),
      };
    });
  }

  async reviseContentPackageVisuals(
    context: OperationContext,
    input: ReviseContentPackageVisualsCommand,
  ) {
    return this.mutate(context, async (state) => {
      await this.requireContentPackageWrite(context);
      state.contentPackages ??= [];
      const packageIndex = state.contentPackages.findIndex(
        (candidate) => candidate.id === input.packageId,
      );
      if (packageIndex < 0) {
        throw new OperationsError(
          'CONTENT_PACKAGE_NOT_FOUND',
          'The ContentPackage was not found.',
          404,
        );
      }
      const current = state.contentPackages[packageIndex]!;
      await this.requireContentPackageRevision(
        context,
        current,
        input.expectedRevision,
      );

      const sourceWork = current.source.workId
        ? state.creativeWorks.find((work) => work.id === current.source.workId)
        : undefined;
      const sessionWorkIds = new Set(
        sourceWork
          ? state.creativeWorks
              .filter((work) => work.sessionId === sourceWork.sessionId)
              .map((work) => work.id)
          : [],
      );
      const visualAssets = input.orderedVisualAssetIds.map((assetId) => {
        const creativeAsset = state.creativeAssets.find(
          (asset) => asset.id === assetId,
        );
        if (creativeAsset) {
          if (
            creativeAsset.workspaceId !== context.workspaceId ||
            creativeAsset.kind !== 'image' ||
            !creativeAsset.ownedAssetId ||
            !creativeAsset.objectKey ||
            !creativeAsset.sha256 ||
            !creativeAsset.contentType?.startsWith('image/') ||
            !sessionWorkIds.has(creativeAsset.workId)
          ) {
            throw new OperationsError(
              'INVALID_VISUAL_ASSET',
              'Every revised visual must be an owned image from the same creation Session.',
              409,
            );
          }
          return {
            contentType: creativeAsset.contentType,
            id: creativeAsset.id,
            kind: creativeAsset.kind,
            objectKey: creativeAsset.objectKey,
            sha256: creativeAsset.sha256,
            ...(typeof creativeAsset.sizeBytes === 'number'
              ? { sizeBytes: creativeAsset.sizeBytes }
              : {}),
            workspaceId: creativeAsset.workspaceId,
          } satisfies VisualAssetRecord;
        }

        const owned = current.generated.ownedAssets?.find(
          (asset) => asset.id === assetId,
        );
        if (!owned?.contentType.startsWith('image/')) {
          throw new OperationsError(
            'INVALID_VISUAL_ASSET',
            'Every revised visual must resolve to an owned image.',
            409,
          );
        }
        return {
          contentType: owned.contentType,
          id: owned.id,
          kind: 'image',
          objectKey: owned.objectKey,
          sha256: owned.sha256,
          ...(typeof owned.sizeBytes === 'number'
            ? { sizeBytes: owned.sizeBytes }
            : {}),
          workspaceId: context.workspaceId,
        } satisfies VisualAssetRecord;
      });

      let revised: ContentPackage;
      try {
        revised = reviseContentPackageVisualsPure({
          baseVersionId: input.baseVersionId,
          contentPackage: current,
          expectedRevision: input.expectedRevision,
          orderedVisualAssetIds: input.orderedVisualAssetIds,
          timestamp: this.timestamp(),
          userId: context.userId,
          visualAssets,
        });
      } catch (error) {
        if (error instanceof VisualAdoptionError) {
          throw new OperationsError(error.code, error.message, error.status);
        }
        throw error;
      }

      state.contentPackages[packageIndex] = revised;
      this.audit(
        state,
        context,
        'content_package.visuals_revised',
        'content_package',
        revised.id,
        {
          baseVersionId: input.baseVersionId,
          orderedVisualAssetIds: [...input.orderedVisualAssetIds],
          ...(input.roleAction ? { roleAction: input.roleAction } : {}),
        },
      );
      return {
        ...revised,
        ...contentPackageVisibleStatus(revised.status),
      };
    });
  }

  async adoptResult(
    context: OperationContext,
    input: ResultAdoptCommand,
  ) {
    return this.mutate(context, async (state) => {
      await this.requireContentPackageWrite(context);
      state.contentPackages ??= [];
      const work = state.creativeWorks.find(({ id }) => id === input.workId);
      if (!work) {
        throw new OperationsError(
          'CREATIVE_WORK_NOT_FOUND',
          'The creative Work was not found.',
          404,
        );
      }
      const selection = input.selection;
      const packageKind =
        selection.kind === 'video' ? 'video' : 'image_text';
      const matchingPackageIndexes = state.contentPackages
        .map((candidate, index) => ({ candidate, index }))
        .filter(
          ({ candidate }) =>
            candidate.kind === packageKind &&
            candidate.source.workId === work.id,
        )
        .map(({ index }) => index);
      let matchingVideoPackageIndex: number | undefined;
      if (selection.kind === 'video') {
        for (
          let position = matchingPackageIndexes.length - 1;
          position >= 0;
          position -= 1
        ) {
          const index = matchingPackageIndexes[position]!;
          const candidate = state.contentPackages[index];
          if (
            candidate?.generated.assetIds.includes(selection.videoAssetId) ||
            candidate?.generated.ownedAssets?.some(
              ({ id }) => id === selection.videoAssetId,
            )
          ) {
            matchingVideoPackageIndex = index;
            break;
          }
        }
      }
      // A full-compose regeneration appends a second package for the same
      // Work. Resolve the package that actually owns the selected video so
      // OCC and idempotent re-adoption stay scoped to that exact package.
      const packageIndex =
        selection.kind === 'video'
          ? (matchingVideoPackageIndex ?? -1)
          : (matchingPackageIndexes[0] ?? -1);
      const current = state.contentPackages[packageIndex];
      if (current) {
        await this.requireContentPackageRevision(
          context,
          current,
          input.expectedRevision,
        );
      } else if (input.expectedRevision !== 0) {
        throw new OperationsError(
          'CONTENT_PACKAGE_REVISION_CONFLICT',
          'The first Result adoption must use revision 0.',
          409,
        );
      }

      const copyAssetId =
        selection.kind === 'copy' || selection.kind === 'image_text'
          ? selection.copyAssetId
          : undefined;
      const copyAsset = copyAssetId
        ? state.creativeAssets.find(({ id }) => id === copyAssetId)
        : undefined;
      const copyJob = copyAsset
        ? state.creativeJobs.find(({ id }) => id === copyAsset.jobId)
        : undefined;
      if (
        copyAssetId &&
        (!copyAsset ||
          !copyJob ||
          copyAsset.kind !== 'text' ||
          copyAsset.workId !== work.id ||
          copyJob.workId !== work.id ||
          copyJob.status !== 'completed' ||
          !copyJob.outputAssetIds.includes(copyAsset.id) ||
          (copyJob.contract.operation === 'copy.generate' &&
            !this.completeCopyCandidateBatch(state, copyJob)?.some(
              ({ id }) => id === copyAsset.id,
            )))
      ) {
        throw new OperationsError(
          'INVALID_COPY_CANDIDATE_BATCH',
          'The selected copy must belong to the completed Result batch.',
          409,
        );
      }

      const orderedAssetIds =
        selection.kind === 'image' || selection.kind === 'image_text'
          ? selection.orderedAssetIds
          : selection.kind === 'video'
            ? [selection.videoAssetId]
            : [];
      if (new Set(orderedAssetIds).size !== orderedAssetIds.length) {
        throw new OperationsError(
          'DUPLICATE_RESULT_ASSET',
          'Adopted Result Assets must be unique and ordered.',
          400,
        );
      }
      const sessionWorkIds = new Set(
        state.creativeWorks
          .filter(
            (candidate) =>
              candidate.workspaceId === context.workspaceId &&
              candidate.sessionId === work.sessionId,
          )
          .map(({ id }) => id),
      );
      const mediaAssets = orderedAssetIds.map((assetId) =>
        state.creativeAssets.find(({ id }) => id === assetId),
      );
      if (selection.kind === 'image' || selection.kind === 'image_text') {
        if (
          mediaAssets.some(
            (asset) =>
              !asset ||
              asset.kind !== 'image' ||
              asset.workspaceId !== context.workspaceId ||
              !sessionWorkIds.has(asset.workId) ||
              !asset.ownedAssetId ||
              !asset.objectKey ||
              !asset.sha256 ||
              !asset.contentType?.startsWith('image/'),
          )
        ) {
          throw new OperationsError(
            'INVALID_VISUAL_ASSET',
            'Every adopted image must be an owned Result from this creation Session.',
            409,
          );
        }
      }
      if (selection.kind === 'video') {
        const creativeVideo = mediaAssets[0];
        const creativeVideoJob = creativeVideo
          ? state.creativeJobs.find(({ id }) => id === creativeVideo.jobId)
          : undefined;
        const existingOwnedVideo = current?.generated.ownedAssets?.find(
          ({ id }) => id === selection.videoAssetId,
        );
        const validExistingSelection = Boolean(
          current &&
            existingOwnedVideo?.contentType === 'video/mp4' &&
            current.generated.assetIds.includes(selection.videoAssetId),
        );
        const validFirstSelection =
          !current &&
          matchingPackageIndexes.length === 0 &&
          creativeVideo?.id === selection.videoAssetId &&
          isVerifiedFirstVideoResult(creativeVideo, creativeVideoJob, {
            workId: work.id,
            workspaceId: context.workspaceId,
          });
        if (!validExistingSelection && !validFirstSelection) {
          throw new OperationsError(
            'INVALID_VIDEO_RESULT_ASSET',
            'The selected video must be the owned completed Result.',
            409,
          );
        }
      }

      const timestamp = this.timestamp();
      const title =
        copyAsset?.title ??
        (selection.kind === 'video'
          ? `视频成片 · V${current?.source.storyboardVersion ?? 1}`
          : work.intent);
      const body =
        copyAsset?.body ??
        (selection.kind === 'video'
          ? (current?.source.shots ?? [])
              .map((shot) => `${shot.id}: ${shot.prompt}`)
              .join('\n')
          : '');
      const activeVersion = current?.versions.find(
        ({ id }) => id === current.currentVersionId,
      );
      if (
        current?.status === 'accepted' &&
        activeVersion?.title === title &&
        activeVersion.body === body &&
        JSON.stringify(activeVersion.orderedAssetIds) ===
          JSON.stringify(orderedAssetIds)
      ) {
        return {
          ...current,
          ...contentPackageVisibleStatus(current.status),
        };
      }

      const packageId =
        current?.id ??
        `content-package-${createHash('sha256')
          .update(`${context.workspaceId}:${work.id}:${packageKind}`)
          .digest('hex')
          .slice(0, 24)}`;
      const version = {
        body,
        ...(copyAsset?.conversionHook
          ? { conversionHook: copyAsset.conversionHook }
          : {}),
        createdAt: timestamp,
        ...(current?.currentVersionId
          ? { derivedFromVersionId: current.currentVersionId }
          : {}),
        id: `${packageId}-result-${this.id()}`,
        orderedAssetIds: [...orderedAssetIds],
        title,
        topics: [] as string[],
      };
      const deliveredAssets = mediaAssets.filter(
        (asset): asset is CreativeAssetProjection => Boolean(asset),
      );
      const primaryMediaJob = deliveredAssets[0]
        ? state.creativeJobs.find(
            ({ id }) => id === deliveredAssets[0]?.jobId,
          )
        : undefined;
      const deliveredOwnedAssets = deliveredAssets.flatMap((asset) => [
        {
          ...(asset.compositionEvidence
            ? { compositionEvidence: structuredClone(asset.compositionEvidence) }
            : {}),
          contentType: asset.contentType!,
          id: asset.id,
          objectKey: asset.objectKey!,
          sha256: asset.sha256!,
          ...(typeof asset.sizeBytes === 'number'
            ? { sizeBytes: asset.sizeBytes }
            : {}),
        },
      ]);
      const deliveredRunIds = [
        ...new Set(
          [copyJob?.id, ...deliveredAssets.map(({ jobId }) => jobId)].filter(
            (id): id is string => Boolean(id),
          ),
        ),
      ];
      const draft =
        current
          ? {
              ...current,
              generated: {
                ...current.generated,
                assetIds: [
                  ...new Set([
                    ...current.generated.assetIds,
                    ...deliveredAssets.map(({ id }) => id),
                  ]),
                ],
                childRuns: [
                  ...current.generated.childRuns,
                  ...deliveredRunIds
                    .filter(
                      (runId) =>
                        !current.generated.childRuns.some(
                          (run) => run.runId === runId,
                        ),
                    )
                    .map((runId) => ({
                      runId,
                      runType: 'creative_job' as const,
                      status: 'succeeded' as const,
                    })),
                ],
                ownedAssets: [
                  ...(current.generated.ownedAssets ?? []),
                  ...deliveredOwnedAssets.filter(
                    (asset) =>
                      !current.generated.ownedAssets?.some(
                        (owned) => owned.id === asset.id,
                      ),
                  ),
                ],
              },
              source: {
                ...current.source,
                assetIds: [
                  ...new Set([
                    ...current.source.assetIds,
                    ...(copyAsset ? [copyAsset.id] : []),
                    ...orderedAssetIds,
                  ]),
                ],
              },
            }
          :
        ({
          ...buildContentPackage({
            id: packageId,
            kind: packageKind,
            source: {
              assetIds: [
                ...(copyAsset ? [copyAsset.id] : []),
                ...orderedAssetIds,
              ],
              ...(selection.kind === 'video' && primaryMediaJob
                ? {
                    executionContract: structuredClone(primaryMediaJob.contract),
                    ...(deliveredAssets[0]?.compositionEvidence?.delivery
                      ? {
                          compositionRevision:
                            deliveredAssets[0].compositionEvidence.delivery
                              .compositionRevision,
                          storyboardRevision:
                            deliveredAssets[0].compositionEvidence.delivery
                              .storyboardRevision,
                          workflowId:
                            deliveredAssets[0].compositionEvidence.delivery
                              .workflowId,
                        }
                      : {}),
                  }
                : {}),
              workId: work.id,
            },
            timestamp,
            workspaceId: context.workspaceId,
          }),
          compliance: {
            aigcLabelEnabled:
              copyJob?.contract.aigcLabelEnabled ??
              primaryMediaJob?.contract.aigcLabelEnabled ??
              false,
            watermarkEnabled:
              copyJob?.contract.watermarkEnabled ??
              primaryMediaJob?.contract.watermarkEnabled ??
              false,
            ...(primaryMediaJob?.contract.watermarkEnabled &&
            deliveredAssets[0]?.compositionEvidence?.brandWatermark.text
              ? {
                  watermarkText:
                    deliveredAssets[0].compositionEvidence.brandWatermark.text,
                }
              : {}),
          },
          generated: {
            assetIds: deliveredAssets.map(({ id }) => id),
            childRuns: deliveredRunIds.map((runId) => ({
              runId,
              runType: 'creative_job' as const,
              status: 'succeeded' as const,
            })),
            ownedAssets: deliveredOwnedAssets,
          },
        } satisfies ContentPackage);
      let adopted: ContentPackage;
      if (draft.status === 'draft' || draft.status === 'review_ready') {
        adopted = transitionContentPackage(
          draft,
          { type: 'adopted', version },
          timestamp,
        );
      } else if (draft.status === 'accepted') {
        adopted = {
          ...draft,
          currentVersionId: version.id,
          updatedAt: timestamp,
          versions: [...draft.versions, version],
        };
      } else {
        throw new OperationsError(
          'RESULT_NOT_ADOPTABLE',
          'Only a review-ready or accepted Result can be adopted.',
          409,
        );
      }
      let persisted = current
        ? this.incrementContentPackageRevision(current, adopted)
        : adopted;
      // Day-0 / Result Center: first accept seeds platform variant shells so
      // full-package export unlocks without a separate variants generation hop.
      // Real platform rewrite still goes through generate_content_package_variants.
      if (
        persisted.status === 'accepted' &&
        persisted.variants.length === 0 &&
        persisted.currentVersionId
      ) {
        const baseVersion =
          persisted.versions.find(
            (candidate) => candidate.id === persisted.currentVersionId,
          ) ?? version;
        const platforms = [
          'xiaohongshu',
          'douyin',
          'video_account',
        ] as const;
        persisted = {
          ...persisted,
          variants: platforms.map((platform) => {
            const variantVersionId = `${baseVersion.id}:${platform}`;
            return {
              currentVersionId: variantVersionId,
              id: `${persisted.id}:${platform}`,
              platform,
              versions: [
                {
                  ...structuredClone(baseVersion),
                  id: variantVersionId,
                },
              ],
            };
          }),
        };
      }
      if (current) state.contentPackages[packageIndex] = persisted;
      else state.contentPackages.push(persisted);
      work.status = 'accepted';
      work.updatedAt = timestamp;
      this.audit(
        state,
        context,
        'content_package.result_adopted',
        'content_package',
        persisted.id,
        {
          selection: structuredClone(selection),
          versionId: version.id,
          workId: work.id,
        },
      );
      this.creationEvent(state, context, 'first_content_accepted', {
        contentPackageId: persisted.id,
        workId: work.id,
      });
      return {
        ...persisted,
        ...contentPackageVisibleStatus(persisted.status),
      };
    });
  }


  async repairMediaCustody(
    context: OperationContext,
    input: { packageId: string; versionId: string }
  ) {
    const storage = this.dependencies.mediaCustodyStorage;
    if (!storage) {
      throw new OperationsError(
        'MEDIA_CUSTODY_STORAGE_UNAVAILABLE',
        'Media custody storage is unavailable.',
        503
      );
    }
    return this.mutate(context, async (state) => {
      await this.requireContentPackageWrite(context);
      state.contentPackages ??= [];
      try {
        const repaired = await executeMediaCustodyRepair({
          contentPackages: state.contentPackages,
          packageId: input.packageId,
          sourceAssets: [],
          storage,
          versionId: input.versionId,
          workspaceId: context.workspaceId,
        });
        const previous = state.contentPackages.find(
          (contentPackage) => contentPackage.id === repaired.packageId
        );
        state.contentPackages = (
          repaired.contentPackages as ContentPackage[]
        ).map((contentPackage) =>
          previous &&
          contentPackage.id === previous.id &&
          JSON.stringify(contentPackage) !== JSON.stringify(previous)
            ? this.incrementContentPackageRevision(previous, contentPackage)
            : contentPackage
        );
        this.audit(
          state,
          context,
          'media_custody.repaired',
          'content_package',
          repaired.packageId,
          {
            copiedAssetIds: repaired.copiedAssetIds,
            sourceAssetIds: repaired.sourceAssetIds,
            versionId: repaired.versionId,
          }
        );
        const { contentPackages: _contentPackages, ...result } = repaired;
        return result;
      } catch (error) {
        if (error instanceof MediaCustodyError) {
          throw new OperationsError(
            error.code,
            error.message,
            error.code.endsWith('NOT_FOUND') ? 404 : 409
          );
        }
        throw error;
      }
    });
  }


  async adoptHarnessCandidate(
    context: OperationContext,
    input: {
      candidateId: string;
      expectedRevision: number;
      packageId: string;
    },
  ) {
    return this.mutate(context, async (state) => {
      await this.requireContentPackageWrite(context);
      state.contentPackages ??= [];
      const index = state.contentPackages.findIndex(
        ({ id }) => id === input.packageId,
      );
      const current = state.contentPackages[index];
      if (!current) {
        throw new OperationsError(
          'CONTENT_PACKAGE_NOT_FOUND',
          'The ContentPackage was not found.',
          404,
        );
      }
      await this.requireContentPackageRevision(
        context,
        current,
        input.expectedRevision,
      );
      const acceptedHarnessPackage =
        current.status === 'accepted' &&
        Boolean(current.harnessSelection?.adoptedCandidateId);
      if (
        (current.status !== 'review_ready' && !acceptedHarnessPackage) ||
        !current.harnessSelection
      ) {
        throw new OperationsError(
          'HARNESS_CANDIDATE_NOT_ADOPTABLE',
          'Only a review-ready or already accepted Harness candidate can be adopted.',
          409,
        );
      }
      const selectedVersion = current.versions.find(
        ({ harnessCandidateId }) => harnessCandidateId === input.candidateId,
      );
      if (!selectedVersion) {
        throw new OperationsError(
          'HARNESS_CANDIDATE_NOT_FOUND',
          'The Harness candidate was not found in this ContentPackage.',
          404,
        );
      }
      if (
        acceptedHarnessPackage &&
        current.harnessSelection.adoptedCandidateId === input.candidateId
      ) {
        return {
          ...current,
          ...contentPackageVisibleStatus(current.status),
        };
      }
      const timestamp = this.timestamp();
      const selectedAdoptionVersion = acceptedHarnessPackage
        ? (() => {
            const {
              harnessCandidateId: _harnessCandidateId,
              ...candidateSnapshot
            } = structuredClone(selectedVersion);
            return {
              ...candidateSnapshot,
              createdAt: timestamp,
              createdBy: context.userId,
              derivedFromVersionId: selectedVersion.id,
              id: this.id(),
            };
          })()
        : selectedVersion;
      const updated: ContentPackage = {
        ...current,
        currentVersionId: selectedAdoptionVersion.id,
        harnessSelection: {
          ...current.harnessSelection,
          adoptedCandidateId: input.candidateId,
        },
        status: 'accepted',
        updatedAt: timestamp,
        versions: acceptedHarnessPackage
          ? [...current.versions, selectedAdoptionVersion]
          : current.versions,
      };
      const revised = this.incrementContentPackageRevision(current, updated);
      state.contentPackages[index] = revised;
      if (current.source.workId) {
        const work = state.creativeWorks.find(
          ({ id }) => id === current.source.workId,
        );
        if (work) {
          work.status = 'accepted';
          work.updatedAt = timestamp;
        }
      }
      this.audit(
        state,
        context,
        'content_package.harness_candidate_adopted',
        'content_package',
        current.id,
        {
          candidateId: input.candidateId,
          ...(acceptedHarnessPackage
            ? {
                previousCandidateId:
                  current.harnessSelection.adoptedCandidateId,
                versionId: selectedAdoptionVersion.id,
              }
            : {}),
          recommendedCandidateId:
            current.harnessSelection.recommendedCandidateId,
        },
      );
      this.creationEvent(state, context, 'first_content_accepted', {
        contentPackageId: current.id,
        ...(current.source.workId ? { workId: current.source.workId } : {}),
      });
      return {
        ...revised,
        ...contentPackageVisibleStatus(revised.status),
      };
    });
  }

  async editContentPackageVersion(
    context: OperationContext,
    input: {
      baseVersionId: string;
      changes: {
        body: string;
        conversionHook?: string;
        note?: ImageTextNoteVersion;
        orderedAssetIds: string[];
        title: string;
        topics: string[];
      };
      expectedRevision: number;
      intent?: QuickEditIntent;
      packageId: string;
    }
  ) {
    return this.mutate(context, async (state) => {
      await this.requireContentPackageWrite(context);
      state.contentPackages ??= [];
      const index = state.contentPackages.findIndex(
        (candidate) => candidate.id === input.packageId
      );
      const current = state.contentPackages[index];
      if (!current) {
        throw new OperationsError(
          'CONTENT_PACKAGE_NOT_FOUND',
          'The ContentPackage was not found.',
          404
        );
      }
      await this.requireContentPackageRevision(
        context,
        current,
        input.expectedRevision
      );
      const timestamp = this.timestamp();
      const { contentPackage: updated, versionId } =
        executeContentPackageLifecycle(() =>
          editContentPackageLifecycleVersion({
            baseVersionId: input.baseVersionId,
            changes: input.changes,
            contentPackage: current,
            ...(input.intent ? { intent: input.intent } : {}),
            target: { kind: 'package' },
            timestamp,
            userId: context.userId,
          })
        );
      const claimExtraction =
        await this.assertContentPackageVisibleCopyPolicy({
          contentPackage: updated,
          phase: 'delivery',
          target: 'package_edit',
          versionId,
        });
      const revised = this.incrementContentPackageRevision(current, updated);
      state.contentPackages[index] = revised;
      this.audit(
        state,
        context,
        'content_package.version_edited',
        'content_package',
        current.id,
        {
          baseVersionId: input.baseVersionId,
          versionId,
          ...(input.intent
            ? { quickEditAction: input.intent.action, scope: input.intent.scope }
            : {}),
          claimExtraction,
        }
      );
      return {
        ...revised,
        ...contentPackageVisibleStatus(revised.status),
      };
    });
  }

  async getContentPackage(context: OperationContext, packageId: string) {
    const state = await this.read(context);
    const contentPackage = state.contentPackages?.find(
      (candidate) => candidate.id === packageId
    );
    if (!contentPackage) {
      throw new OperationsError(
        'CONTENT_PACKAGE_NOT_FOUND',
        'The ContentPackage was not found.',
        404
      );
    }
    const projected = (
      await this.projectContentPackageDestinations(
        context.workspaceId,
        [contentPackage]
      )
    )[0] ?? contentPackage;
    return {
      ...projected,
      ...contentPackageVisibleStatus(projected.status),
    };
  }

  /**
   * Canvas ZIP reads through this server-owned boundary. The caller may supply
   * only an asset ID; membership, ContentPackage export policy, live Product
   * rights, receipt validation, and private retrieval stay below this seam.
   */
  async resolveCanvasExportAsset(context: OperationContext, assetId: string) {
    const state = await this.read(context);
    const access = this.dependencies.canvasExportAssetAccess;
    if (!access) {
      throw new OperationsError(
        'CANVAS_EXPORT_ASSET_UNAVAILABLE',
        'Canvas export asset access is unavailable.',
        503
      );
    }
    return access.resolve({
      assetId,
      contentPackages: structuredClone(state.contentPackages ?? []),
      workspaceId: context.workspaceId,
    });
  }

  async generateContentPackageVariants(
    context: OperationContext,
    input: {
      billingQuoteId?: string;
      billingTaskId?: string;
      contract: CreativeExecutionContract & {
        operation: 'copy.adapt';
        outputCount: 3;
      };
      expectedRevision: number;
      packageId: string;
      submissionKey: string;
    }
  ) {
    await this.requireContentPackageWrite(context);
    const state = await this.read(context);
    const contentPackage = state.contentPackages?.find(
      (candidate) => candidate.id === input.packageId
    );
    if (!contentPackage) {
      throw new OperationsError(
        'CONTENT_PACKAGE_NOT_FOUND',
        'The ContentPackage was not found.',
        404
      );
    }
    await this.requireContentPackageRevision(
      context,
      contentPackage,
      input.expectedRevision
    );
    if (!['accepted', 'review_ready'].includes(contentPackage.status)) {
      throw new OperationsError(
        'CONTENT_PACKAGE_NOT_ACCEPTED',
        'Only a review-ready or accepted ContentPackage can generate platform variants.',
        409
      );
    }
    const currentVersion = contentPackage.versions.find(
      (version) => version.id === contentPackage.currentVersionId
    );
    if (!currentVersion) {
      throw new OperationsError(
        'CONTENT_PACKAGE_VERSION_NOT_FOUND',
        'The current ContentPackage version was not found.',
        409
      );
    }
    if (
      contentPackage.variants.length > 0 &&
      !hasOnlySeededPlatformVariantShells(contentPackage, currentVersion)
    ) {
      throw new OperationsError(
        'CONTENT_PACKAGE_VARIANTS_EXIST',
        'Platform variants already exist for this ContentPackage.',
        409
      );
    }
    const executor = this.dependencies.creationExecutor;
    if (!executor) {
      throw new OperationsError(
        'CREATION_EXECUTOR_UNAVAILABLE',
        'Platform variant generation is unavailable.',
        503
      );
    }
    // 与导出同一口径的 live rights 复核：素材撤权即使尚未传播到包状态，
    // 也不得再为该成品生成平台变体并产生真实计费。
    const liveRights =
      await this.dependencies.contentPackageRightsResolver?.resolve({
        assetIds: contentPackageRightsAssetIds(
          contentPackage,
          currentVersion
        ),
        workspaceId: context.workspaceId,
      });
    if (liveRights && liveRights.unauthorizedAssetIds.length > 0) {
      throw new OperationsError(
        'RIGHTS_REVOKED',
        'Live Product rights block variant generation for this ContentPackage.',
        409
      );
    }
    let acceptedQuoteAuthority:
      | import('./types.js').AcceptedProductQuoteInspectionAuthority
      | undefined;
    if (input.billingQuoteId || input.billingTaskId) {
      if (!input.billingQuoteId || !input.billingTaskId) {
        throw new OperationsError(
          'INVALID_CONTENT_PACKAGE',
          'A ContentPackage variant quote requires both quote and task identifiers.',
          400,
        );
      }
      const assertAcceptedQuote =
        this.dependencies.billingLifecycle?.assertAcceptedQuote;
      if (!assertAcceptedQuote) {
        throw new OperationsError(
          'BILLING_QUOTE_VALIDATOR_UNAVAILABLE',
          'Confirmed Product quote validation is unavailable.',
          503,
        );
      }
      const acceptedQuote = await assertAcceptedQuote.call(
        this.dependencies.billingLifecycle,
        {
          quoteId: input.billingQuoteId,
          quoteRevision: input.contract.quoteRevision,
          taskId: input.billingTaskId,
          workspaceId: context.workspaceId,
        },
      );
      if (
        acceptedQuote.quoteId !== input.billingQuoteId ||
        acceptedQuote.revision !== input.contract.quoteRevision ||
        acceptedQuote.catalogModelId !== input.contract.catalogModelId ||
        acceptedQuote.catalogModelRevision !== input.contract.catalogRevision ||
        acceptedQuote.confirmedAmount !== input.contract.estimatedAmount ||
        acceptedQuote.formula.currency !== input.contract.currency ||
        acceptedQuote.outputCount !== input.contract.outputCount ||
        acceptedQuote.outputLabel !== input.contract.outputLabel
      ) {
        throw new OperationsError(
          'CREATIVE_QUOTE_CHANGED',
          'The accepted Product quote no longer matches the execution contract.',
          409,
        );
      }
      acceptedQuoteAuthority = {
        kind: 'accepted_product_quote',
        quoteId: acceptedQuote.quoteId,
        quoteRevision: acceptedQuote.revision,
        catalogModelId: acceptedQuote.catalogModelId,
        catalogModelRevision: acceptedQuote.catalogModelRevision,
        confirmedAmount: acceptedQuote.confirmedAmount,
        currency: acceptedQuote.formula.currency,
        outputCount: acceptedQuote.outputCount,
        outputLabel: acceptedQuote.outputLabel,
      };
    }
    await executor.inspect(
      context.workspaceId,
      input.contract,
      acceptedQuoteAuthority,
    );
    if (input.billingQuoteId && input.billingTaskId) {
      await this.dependencies.billingLifecycle?.beforeSubmit({
        quoteId: input.billingQuoteId,
        quoteRevision: input.contract.quoteRevision,
        resource: 'copy',
        taskId: input.billingTaskId,
        workspaceId: context.workspaceId,
      });
    }
    const outcome = await executor.submit({
      ...(input.billingTaskId
        ? {
            billingQuoteRevision: input.contract.quoteRevision,
            billingTaskId: input.billingTaskId,
          }
        : {}),
      context,
      contract: input.contract,
      intent: JSON.stringify({
        body: currentVersion.body,
        conversionHook: currentVersion.conversionHook,
        title: currentVersion.title,
        topics: currentVersion.topics,
      }),
      idempotencyKey: input.submissionKey,
      productUsageQuantity: 1,
    });
    if (outcome.status !== 'completed' || !outcome.platformVariants) {
      throw new OperationsError(
        outcome.failureCode ?? 'CONTENT_PACKAGE_VARIANT_GENERATION_FAILED',
        'Platform variant generation did not return a complete result.',
        outcome.status === 'recoverable' ? 409 : 502
      );
    }
    const platformVariants = generatedPlatformVariantsSchema.parse(
      outcome.platformVariants
    );
    return this.mutate(context, async (current) => {
      await this.requireContentPackageWrite(context);
      current.contentPackages ??= [];
      const index = current.contentPackages.findIndex(
        (candidate) => candidate.id === input.packageId
      );
      const stored = current.contentPackages[index];
      if (!stored) {
        throw new OperationsError(
          'CONTENT_PACKAGE_NOT_FOUND',
          'The ContentPackage was not found.',
          404
        );
      }
      await this.requireContentPackageRevision(
        context,
        stored,
        input.expectedRevision
      );
      if (stored.currentVersionId !== currentVersion.id) {
        throw new OperationsError(
          'CONTENT_PACKAGE_VERSION_CONFLICT',
          'The ContentPackage version changed during platform variant generation.',
          409
        );
      }
      if (
        stored.variants.length > 0 &&
        !hasOnlySeededPlatformVariantShells(stored, currentVersion)
      ) {
        throw new OperationsError(
          'CONTENT_PACKAGE_VARIANTS_EXIST',
          'Platform variants already exist for this ContentPackage.',
          409
        );
      }
      const timestamp = this.timestamp();
      const platforms = ['xiaohongshu', 'douyin', 'video_account'] as const;
      const variants = platforms.map((platform) => {
        const variantId = `${stored.id}-${platform}`;
        const versionId = `${variantId}-${this.id()}`;
        return {
          currentVersionId: versionId,
          id: variantId,
          platform,
          versions: [
            {
              ...platformVariants[platform],
              createdAt: timestamp,
              createdBy: context.userId,
              derivedFromVersionId: currentVersion.id,
              id: versionId,
              orderedAssetIds: [...currentVersion.orderedAssetIds],
              source: 'ai_generated' as const,
            },
          ],
        };
      });
      const updated = {
        ...stored,
        generated: {
          ...stored.generated,
          childRuns: [
            ...stored.generated.childRuns,
            {
              actualCatalogModelId:
                outcome.executionProvenance?.actualCatalogModelId,
              apiCounterparty:
                outcome.executionProvenance?.apiCounterparty,
              productUsage: outcome.productUsage,
              providerCost: outcome.providerCost,
              providerModel: outcome.executionProvenance?.providerModel,
              routeSnapshotId: outcome.routeSnapshotId,
              runId: outcome.providerJobId,
              runType: 'model_job' as const,
              status: 'succeeded' as const,
            },
          ],
        },
        status:
          stored.status === 'review_ready'
            ? ('accepted' as const)
            : stored.status,
        updatedAt: timestamp,
        variants,
      };
      const revised = this.incrementContentPackageRevision(stored, updated);
      current.contentPackages[index] = revised;
      this.audit(
        current,
        context,
        'content_package.variants_generated',
        'content_package',
        stored.id,
        {
          providerJobId: outcome.providerJobId,
          routeSnapshotId: outcome.routeSnapshotId,
        }
      );
      return {
        ...revised,
        ...contentPackageVisibleStatus(revised.status),
      };
    });
  }

  async editContentPackageVariant(
    context: OperationContext,
    input: {
      baseVersionId: string;
      changes: {
        body: string;
        conversionHook?: string;
        orderedAssetIds: string[];
        title: string;
        topics: string[];
      };
      expectedRevision: number;
      intent?: QuickEditIntent;
      packageId: string;
      platform: ContentPackage['variants'][number]['platform'];
    }
  ) {
    return this.mutate(context, async (state) => {
      await this.requireContentPackageWrite(context);
      state.contentPackages ??= [];
      const packageIndex = state.contentPackages.findIndex(
        (candidate) => candidate.id === input.packageId
      );
      const current = state.contentPackages[packageIndex];
      if (!current) {
        throw new OperationsError(
          'CONTENT_PACKAGE_NOT_FOUND',
          'The ContentPackage was not found.',
          404
        );
      }
      await this.requireContentPackageRevision(
        context,
        current,
        input.expectedRevision
      );
      const timestamp = this.timestamp();
      const { contentPackage: updated, versionId } =
        executeContentPackageLifecycle(() =>
          editContentPackageLifecycleVersion({
            baseVersionId: input.baseVersionId,
            changes: input.changes,
            contentPackage: current,
            ...(input.intent ? { intent: input.intent } : {}),
            target: { kind: 'variant', platform: input.platform },
            timestamp,
            userId: context.userId,
          })
        );
      const claimExtraction =
        await this.assertContentPackageVisibleCopyPolicy({
          contentPackage: updated,
          phase: 'delivery',
          target: `variant_edit:${input.platform}`,
          versionId,
        });
      const revised = this.incrementContentPackageRevision(current, updated);
      state.contentPackages[packageIndex] = revised;
      this.audit(
        state,
        context,
        'content_package.variant_edited',
        'content_package',
        current.id,
        {
          baseVersionId: input.baseVersionId,
          platform: input.platform,
          versionId,
          ...(input.intent
            ? { quickEditAction: input.intent.action, scope: input.intent.scope }
            : {}),
          claimExtraction,
        }
      );
      return {
        ...revised,
        ...contentPackageVisibleStatus(revised.status),
      };
    });
  }

  async exportContentPackage(
    context: OperationContext,
    input: {
      expectedRevision: number;
      packageId: string;
      platform: ContentPackage['variants'][number]['platform'];
    }
  ) {
    await this.requireContentPackageWrite(context);
    const state = await this.read(context);
    const contentPackage = state.contentPackages?.find(
      (candidate) => candidate.id === input.packageId
    );
    if (!contentPackage) {
      throw new OperationsError(
        'CONTENT_PACKAGE_NOT_FOUND',
        'The ContentPackage was not found.',
        404
      );
    }
    await this.requireContentPackageRevision(
      context,
      contentPackage,
      input.expectedRevision
    );
    try {
      assertContentPackageExportAllowed(contentPackage);
    } catch (error) {
      if (error instanceof ContentPackageTransitionError) {
        throw new OperationsError(
          contentPackage.rights.state === 'revoked'
            ? 'RIGHTS_REVOKED'
            : 'CONTENT_PACKAGE_EXPORT_CONFLICT',
          error.message,
          409
        );
      }
      throw error;
    }
    const variant = contentPackage.variants.find(
      (candidate) => candidate.platform === input.platform
    );
    const version = variant?.versions.find(
      (candidate) => candidate.id === variant.currentVersionId
    );
    if (!variant || !version) {
      throw new OperationsError(
        'CONTENT_PACKAGE_VARIANT_NOT_FOUND',
        'The selected platform variant is not available for export.',
        409
      );
    }
    const claimExtraction =
      await this.assertContentPackageVisibleCopyPolicy({
        contentPackage,
        phase: 'export',
        target: input.platform,
        versionId: version.id,
      });
    const approvalTaskId = contentPackage.source.workflowId;
    const createsApprovalRequest =
      approvalTaskId !== undefined &&
      contentPackage.source.workflowRevision !== undefined;
    if (createsApprovalRequest) {
      assertNoPendingApprovalForTask(state, approvalTaskId);
      await this.repository.assertTaskHasNoPendingQuestion(
        context.workspaceId,
        approvalTaskId
      );
    }
    const liveRights =
      await this.dependencies.contentPackageRightsResolver?.resolve({
        assetIds:
          contentPackage.kind === 'video'
            ? contentPackage.source.assetIds
            : contentPackageRightsAssetIds(contentPackage, version),
        workspaceId: context.workspaceId,
      });
    if (liveRights && liveRights.unauthorizedAssetIds.length > 0) {
      throw new OperationsError(
        'RIGHTS_REVOKED',
        'Live Product rights block this ContentPackage export.',
        409
      );
    }
    const exporter = this.dependencies.contentPackageExporter;
    if (!exporter) {
      throw new OperationsError(
        'CONTENT_PACKAGE_EXPORT_UNAVAILABLE',
        'ContentPackage export is unavailable.',
        503
      );
    }
    let rightsBasis;
    if (
      contentPackage.kind === 'video' &&
      !this.dependencies.contentPackageRightsBasisResolver
    ) {
      throw new OperationsError(
        'CONTENT_PACKAGE_EXPORT_CONFLICT',
        'The ContentPackage rights basis consumer is unavailable.',
        409,
      );
    }
    if (
      contentPackage.kind === 'video' &&
      this.dependencies.contentPackageRightsBasisResolver
    ) {
      try {
        rightsBasis =
          await this.dependencies.contentPackageRightsBasisResolver.resolve({
            contentPackage,
            platform: input.platform,
            version,
            workspaceId: context.workspaceId,
          });
      } catch (error) {
        if (!(error instanceof ContentPackageRightsBasisError)) {
          throw error;
        }
        throw new OperationsError(
          'CONTENT_PACKAGE_EXPORT_CONFLICT',
          'The ContentPackage rights basis is unavailable.',
          409,
        );
      }
    }
    const timestamp = this.timestamp();
    let artifact: Awaited<ReturnType<ContentPackageExportPort['export']>> | undefined;
    try {
      artifact = await exporter.export({
        compliance: contentPackage.compliance,
        contentPackageRevision: contentPackage.revision,
        kind: contentPackage.kind,
        packageId: contentPackage.id,
        platform: input.platform,
        ...(rightsBasis ? { rightsBasis } : {}),
        version,
        ...(contentPackage.kind === 'video' && contentPackage.source.storyboardRevision
          ? { videoDeliveryRevision: contentPackage.source.storyboardRevision }
          : {}),
        ...(contentPackage.kind === 'video' && contentPackage.source.compositionRevision
          ? {
              videoDeliveryCompositionRevision:
                contentPackage.source.compositionRevision,
            }
          : {}),
        ...(contentPackage.kind === 'video' && contentPackage.source.workflowId
          ? { videoDeliveryWorkflowId: contentPackage.source.workflowId }
          : {}),
        ...(contentPackage.kind === 'video' &&
        contentPackage.source.executionContract?.durationSeconds
          ? {
              videoDeliveryDurationSeconds:
                contentPackage.source.executionContract.durationSeconds,
            }
          : {}),
        workspaceId: context.workspaceId,
      });
      const exportedArtifact = artifact;
      return await this.mutate(context, async (current, repository) => {
        await this.requireContentPackageWrite(context);
        current.contentPackages ??= [];
        const index = current.contentPackages.findIndex(
          (candidate) => candidate.id === input.packageId
        );
        const stored = current.contentPackages[index];
        if (!stored) {
          throw new OperationsError(
            'CONTENT_PACKAGE_NOT_FOUND',
            'The ContentPackage was not found.',
            404
          );
        }
        await this.requireContentPackageRevision(
          context,
          stored,
          input.expectedRevision
        );
        const currentVariant = stored.variants.find(
          (candidate) => candidate.platform === input.platform
        );
        if (currentVariant?.currentVersionId !== version.id) {
          throw new OperationsError(
            'CONTENT_PACKAGE_VERSION_CONFLICT',
            'The selected platform version changed during export.',
            409
          );
        }
        const receipt = {
          appliedCompliance: { ...stored.compliance },
          ...exportedArtifact,
          correlationId: context.correlationId,
          createdAt: timestamp,
          id: this.id(),
          platform: input.platform,
          status: 'succeeded' as const,
          variantVersionId: version.id,
        };
        const updated = transitionContentPackage(
          stored,
          { receipt, type: 'export_succeeded' },
          timestamp
        );
        const revisedBase = this.incrementContentPackageRevision(stored, updated);
        let revised = revisedBase;
        const taskId = stored.source.workflowId;
        const workflowRevision = stored.source.workflowRevision;
        if (
          taskId &&
          workflowRevision !== undefined
        ) {
          assertNoPendingApprovalForTask(current, taskId);
          await repository.assertTaskHasNoPendingQuestion(
            context.workspaceId,
            taskId
          );
          revised = appendPendingApprovalRequest(revisedBase, {
            actionKind: 'publish',
            contentPackageRevision: revisedBase.revision,
            createdAt: timestamp,
            packageId: revisedBase.id,
            platform: input.platform,
            purpose: 'publish_current_variant',
            taskId,
            variantVersionId: version.id,
            workflowId: taskId,
            workflowRevision,
            workspaceId: context.workspaceId,
          });
        }
        current.contentPackages[index] = revised;
        this.audit(
          current,
          context,
          'content_package.exported',
          'content_package',
          stored.id,
          {
            artifactAssetId: exportedArtifact.artifactAssetId,
            claimExtraction,
            platform: input.platform,
          }
        );
        return {
          ...revised,
          ...contentPackageVisibleStatus(revised.status),
        };
      });
    } catch (error) {
      const lifecycle = ownedAssetRegistrationLifecycle(exporter);
      if (artifact && lifecycle) {
        try {
          await lifecycle.recordOwnedAssetRegistrationFailure({
            asset: {
              contentType: artifact.contentType,
              id: artifact.artifactAssetId,
              objectKey: artifact.artifactObjectKey,
              sha256: artifact.sha256,
              sizeBytes: artifact.sizeBytes,
              ...(artifact.storageRevision
                ? { storageRevision: artifact.storageRevision }
                : {}),
            },
            error,
            failureStage: 'content_package_persistence',
            workspaceId: context.workspaceId,
          });
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            'ContentPackage export failed and its cleanup record could not be persisted.',
          );
        }
      }
      if (
        error instanceof OperationsError ||
        error instanceof TaskBlockingNodeConflictError
      ) {
        throw error;
      }
      if (error instanceof UnverifiedVideoComplianceError) {
        return this.mutate(context, async (current) => {
          await this.requireContentPackageWrite(context);
          current.contentPackages ??= [];
          const index = current.contentPackages.findIndex(
            (candidate) => candidate.id === input.packageId
          );
          const stored = current.contentPackages[index];
          if (!stored) {
            throw new OperationsError(
              'CONTENT_PACKAGE_NOT_FOUND',
              'The ContentPackage was not found.',
              404
            );
          }
          await this.requireContentPackageRevision(
            context,
            stored,
            input.expectedRevision
          );
          const updated = {
            ...stored,
            status: 'needs_replacement' as const,
            updatedAt: timestamp,
          };
          const revised = this.incrementContentPackageRevision(stored, updated);
          current.contentPackages[index] = revised;
          this.audit(
            current,
            context,
            'content_package.compliance_unverified',
            'content_package',
            stored.id,
            { platform: input.platform }
          );
          return {
            ...revised,
            ...contentPackageVisibleStatus(revised.status),
          };
        });
      }
      return this.mutate(context, async (current) => {
        await this.requireContentPackageWrite(context);
        current.contentPackages ??= [];
        const index = current.contentPackages.findIndex(
          (candidate) => candidate.id === input.packageId
        );
        const stored = current.contentPackages[index];
        if (!stored) {
          throw new OperationsError(
            'CONTENT_PACKAGE_NOT_FOUND',
            'The ContentPackage was not found.',
            404
          );
        }
        await this.requireContentPackageRevision(
          context,
          stored,
          input.expectedRevision
        );
        const receipt = {
          correlationId: context.correlationId,
          createdAt: timestamp,
          failureCategory: 'export_adapter_failed',
          id: this.id(),
          platform: input.platform,
          status: 'failed' as const,
          variantVersionId: version.id,
        };
        const updated = transitionContentPackage(
          stored,
          { receipt, type: 'export_failed' },
          timestamp
        );
        const revised = this.incrementContentPackageRevision(stored, updated);
        current.contentPackages[index] = revised;
        this.audit(
          current,
          context,
          'content_package.export_failed',
          'content_package',
          stored.id,
          { failureCategory: receipt.failureCategory, platform: input.platform }
        );
        return {
          ...revised,
          ...contentPackageVisibleStatus(revised.status),
        };
      });
    }
  }

  async rollbackContentPackageVersion(
    context: OperationContext,
    input: {
      expectedRevision: number;
      packageId: string;
      targetVersionId: string;
    }
  ) {
    return this.mutate(context, async (state) => {
      await this.requireContentPackageWrite(context);
      state.contentPackages ??= [];
      const packageIndex = state.contentPackages.findIndex(
        (candidate) => candidate.id === input.packageId
      );
      const current = state.contentPackages[packageIndex];
      if (!current) {
        throw new OperationsError(
          'CONTENT_PACKAGE_NOT_FOUND',
          'The ContentPackage was not found.',
          404
        );
      }
      await this.requireContentPackageRevision(
        context,
        current,
        input.expectedRevision
      );
      const timestamp = this.timestamp();
      const { contentPackage: updated, versionId } =
        executeContentPackageLifecycle(() =>
          rollbackContentPackageLifecycleVersion({
            contentPackage: current,
            targetVersionId: input.targetVersionId,
            timestamp,
            userId: context.userId,
          })
        );
      if (updated === current) {
        return {
          ...current,
          ...contentPackageVisibleStatus(current.status),
        };
      }
      const revised = this.incrementContentPackageRevision(current, updated);
      state.contentPackages[packageIndex] = revised;
      this.audit(
        state,
        context,
        'content_package.version_rolled_back',
        'content_package',
        current.id,
        { targetVersionId: input.targetVersionId, versionId }
      );
      return {
        ...revised,
        ...contentPackageVisibleStatus(revised.status),
      };
    });
  }




  async revokeContentPackagesUsingAsset(
    context: OperationContext,
    assetId: string
  ) {
    return this.mutate(context, (state) => {
      state.contentPackages ??= [];
      const timestamp = this.timestamp();
      const revokedPackageIds: string[] = [];
      state.contentPackages = state.contentPackages.map((contentPackage) => {
        if (
          !contentPackageReferencesAsset(contentPackage, assetId) ||
          contentPackage.rights.state === 'revoked'
        ) {
          return contentPackage;
        }
        try {
          const revoked = transitionContentPackage(
            contentPackage,
            {
              at: timestamp,
              reason: `asset_withdrawn:${assetId}`,
              type: 'rights_revoked',
            },
            timestamp
          );
          const revised = this.incrementContentPackageRevision(
            contentPackage,
            revoked
          );
          revokedPackageIds.push(revised.id);
          this.audit(
            state,
            context,
            'content_package.rights_revoked',
            'content_package',
            revised.id,
            { assetId, reason: 'asset_withdrawn' }
          );
          return revised;
        } catch (error) {
          if (error instanceof ContentPackageTransitionError) {
            return contentPackage;
          }
          throw error;
        }
      });
      return { revokedPackageIds };
    });
  }

  async listContentPackages(context: OperationContext) {
    const state = await this.read(context);
    const sorted = [...(state.contentPackages ?? [])].sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        right.id.localeCompare(left.id)
    );
    return (
      await this.projectContentPackageDestinations(context.workspaceId, sorted)
    )
      .map((contentPackage) => ({
        ...contentPackage,
        ...contentPackageVisibleStatus(contentPackage.status),
      }));
  }

}

function assertNoPendingApprovalForTask(
  state: OperationsWorkspaceState,
  taskId: string
) {
  const exists = state.contentPackages.some((contentPackage) =>
    (contentPackage.approvalRequests ?? []).some(
      (request) => request.taskId === taskId && request.status === 'pending'
    )
  );
  if (exists) throw new TaskBlockingNodeConflictError(taskId);
}

export function searchTemplateCatalog(
  catalog: TemplateCatalogState,
  workspaceId: string,
  query: SearchQuery
) {
  return rankSearchDocuments(
    catalog.templates.map((template) => ({
      id: template.id,
      kind: 'template' as const,
      metadata: {
        family: template.family,
        official: 'true',
        publicationStatus: template.publicationStatus,
      },
      tags: template.tags,
      text: `${template.name} ${template.family}`,
      title: template.name,
      updatedAt: template.updatedAt,
      workspaceId,
    })),
    query
  );
}
