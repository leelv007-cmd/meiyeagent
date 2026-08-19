import { createHash, randomUUID } from 'node:crypto';
import type {
  IdempotentProductOutcome,
  PendingCopyExecution,
  ProductRepository,
} from './repository.js';
import { DomainError } from './domain-error.js';
import {
  decideAcceptedProductWrite,
  decideLegacyContentWrite,
  writeOwnershipMissingError,
} from '../p1/foundation/write-ownership.js';
import { LegacyBillingLedger } from './legacy-billing-ledger.js';
import { noOpProductNotifier, type ProductNotifier } from './notifier.js';
import {
  noOpProductQualitySink,
  type ProductQualityEvent,
  type ProductQualitySink,
} from './quality-sink.js';
import {
  hydrateExampleStores,
  initialExampleStores,
  withoutPlatformSamples,
} from './example-stores.js';
import { defaultProductPlanConfig, type ProductPlanConfig } from './plans.js';
import {
  defaultCopyProviderRegistry,
  type CopyCandidateDraft,
  type CopyGenerationEvidence,
  type CopyProvider,
  type CopyProviderRequest,
  type CopyProviderRegistry,
} from './copy-provider.js';
import {
  noOpLegacyInFlightDecisionPort,
  type LegacyInFlightDecisionPort,
} from './legacy-inflight-decision.js';
import type { OperationsProductPackageRightsAdapter } from '../p1/operations/product-package-rights-adapter.js';
import type { OperationsProductSearchProjection } from '../p1/operations/product-search-projection.js';
import type { CreditSubscriptionEntitlementPolicy } from '../p1/credit-billing/credit-entitlement-policy.js';
import {
  hasCurrentRestrictedAssetAuthorization,
  isRestrictedProductAsset,
  type Asset,
  type AgentRun,
  type AuditEvent,
  type ComplianceResult,
  type CommandResult,
  type ContentItem,
  type ContentVariant,
  type ContentVersion,
  type HandoffPackage,
  type ProductCommand,
  type ProductContext,
  type ProductState,
  type StoreAccount,
  type StoreProfile,
  type StoreProfilePatch,
  type StoreProject,
  type Storyboard,
  type ToolCall,
  type UsageEvent,
  type VideoJob,
} from '@meiye/contracts';
import { serializeCanonicalDeepLink } from '../canonical-deep-link.js';

export { DomainError };

function now() {
  return new Date().toISOString();
}

function nextUpdatedAt(previous: string) {
  const previousTime = Date.parse(previous);
  return new Date(
    Math.max(Date.now(), Number.isNaN(previousTime) ? 0 : previousTime + 1)
  ).toISOString();
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)])
    );
  }
  return value;
}

function payloadHash(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalValue(value)))
    .digest('hex');
}

function commandPayloadHash(command: ProductCommand) {
  return payloadHash(command);
}

function storeProfilePatchPayloadHash(patch: StoreProfilePatch) {
  return payloadHash({
    action: 'merge_store_profile',
    patch,
  });
}

function applyRegisteredAssetFacts(
  asset: Asset,
  incoming: Extract<ProductCommand, { type: 'add_asset' }>['asset']
) {
  if (incoming.category !== undefined) asset.category = incoming.category;
  asset.tags = [...incoming.tags];
  asset.rightsOwner = incoming.rightsOwner;
  asset.containsPerson = incoming.containsPerson;
  asset.containsSensitiveData = incoming.containsSensitiveData;
  asset.minorStatus = incoming.minorStatus;
  if (incoming.minorStatus === 'minor') {
    asset.consentScope = 'internal_only';
    asset.authorizationStatus = 'blocked';
    return;
  }
  if (
    asset.authorizationStatus === 'authorized' &&
    (!asset.rightsEvidence?.trim() ||
      !hasCurrentRestrictedAssetAuthorization(asset, new Date()))
  ) {
    asset.authorizationStatus = 'pending';
    return;
  }
  if (asset.authorizationStatus === 'blocked') {
    asset.authorizationStatus = 'pending';
  }
}

function normalizedEditDistance(left: string, right: string) {
  if (left === right) return 0;
  if (left.length === 0 || right.length === 0) return 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return (previous[right.length] ?? 0) / Math.max(left.length, right.length);
}

function initialState(
  workspaceId: string,
  planConfig: ProductPlanConfig
): ProductState {
  const starter = planConfig.starter;
  return {
    workspaceId,
    exampleStores: initialExampleStores(),
    // V31-51: Day-0 "no store" is explicit null, not an omitted key.
    store: null,
    assets: [],
    contents: [],
    storyboards: [],
    videoJobs: [],
    videoArtifactShells: [],
    videoRenderEvidence: [],
    videoArtifacts: [],
    complianceResults: [],
    agentRuns: [],
    toolCalls: [],
    handoffPackages: [],
    preflightEvents: [],
    responsibilityConfirmations: [],
    operationalEvidence: {
      activatedAt: now(),
      generatedCandidateCount: 0,
      adoptedContentCount: 0,
      weeklyCardCount: 0,
      handoffCount: 0,
      videoOutputCount: 0,
      videoProviderCostCents: 0,
      labeledVideoCount: 0,
      videoRetryCount: 0,
      videoRefundCount: 0,
      videoAttemptCount: 0,
      videoTechnicalSuccessCount: 0,
      videoUsableQualityCount: 0,
      videoLatencyTotalMs: 0,
      videoProviderFailureCount: 0,
    },
    entitlement: {
      plan: 'starter',
      content: { allowance: starter.content, remaining: starter.content },
      image: { allowance: starter.image, remaining: starter.image },
      video: { allowance: starter.video, remaining: starter.video },
      package: { allowance: starter.package, remaining: starter.package },
      storageMb: { allowance: starter.storageMb, remaining: starter.storageMb },
      concurrencyLimit: starter.concurrencyLimit,
      queuePriority: starter.queuePriority,
      supportLabel: starter.supportLabel,
    },
    usageEvents: [],
    auditEvents: [],
    enforcement: {
      day: new Date().toISOString().slice(0, 10),
      consecutiveAbuse: 0,
      dailyAbuse: 0,
      suspended: false,
    },
    updatedAt: now(),
  };
}

function normalizeState(
  state: ProductState,
  planConfig: ProductPlanConfig
): ProductState {
  const defaults = initialState(state.workspaceId, planConfig);
  const {
    exampleStore: _legacyExampleStore,
    ['insights']: _legacyInsights,
    ['leads']: _legacyLedger,
    ...stored
  } = state as ProductState & {
    exampleStore?: unknown;
    insights?: unknown;
    leads?: unknown;
  };
  return {
    ...defaults,
    ...stored,
    // V31-51: always project store — confirmed profile or explicit null absence.
    store: state.store
      ? {
          ...state.store,
          revision: state.store.revision ?? 1,
        }
      : null,
    exampleStores: hydrateExampleStores(state),
    enforcement: { ...defaults.enforcement, ...state.enforcement },
    operationalEvidence: {
      ...defaults.operationalEvidence,
      ...state.operationalEvidence,
    },
    handoffPackages: state.handoffPackages.map((handoff) => ({
      ...handoff,
      manualReports: handoff.manualReports ?? [],
    })),
    entitlement: {
      ...defaults.entitlement,
      ...state.entitlement,
      content: {
        ...defaults.entitlement.content,
        ...state.entitlement?.content,
      },
      image: {
        ...defaults.entitlement.image,
        ...state.entitlement?.image,
      },
      video: {
        ...defaults.entitlement.video,
        ...state.entitlement?.video,
      },
      package: {
        ...defaults.entitlement.package,
        ...state.entitlement?.package,
      },
      storageMb: {
        ...defaults.entitlement.storageMb,
        ...state.entitlement?.storageMb,
      },
    },
  };
}

function storeProfileScalars(patch: StoreProfilePatch) {
  const scalars: Partial<
    Pick<
      StoreProfile,
      | 'name'
      | 'city'
      | 'district'
      | 'address'
      | 'booking'
      | 'industry'
      | 'brandVoice'
      | 'prohibitions'
      | 'regulated'
    >
  > = {};
  for (const key of [
    'name',
    'city',
    'district',
    'address',
    'booking',
    // D-174: optional, so it is merged like any other scalar but never
    // required — a store that skipped it simply has no industry.
    'industry',
    'brandVoice',
    'prohibitions',
    'regulated',
  ] as const) {
    const value = patch[key];
    if (value !== undefined) {
      (scalars as Record<string, unknown>)[key] = structuredClone(value);
    }
  }
  return scalars;
}

function mergeStoreAccounts(
  current: readonly StoreAccount[],
  patch: StoreProfilePatch
) {
  const accounts = new Map(
    current.map((account) => [
      account.platform,
      structuredClone(account),
    ])
  );
  for (const platform of patch.accounts?.clear ?? []) {
    accounts.delete(platform);
  }
  for (const account of patch.accounts?.upsert ?? []) {
    accounts.set(account.platform, structuredClone(account));
  }
  return [...accounts.values()];
}

function mergeStoreProjects(
  current: readonly StoreProject[],
  patch: StoreProfilePatch
) {
  const projects = new Map(
    current.map((project) => [
      project.id,
      structuredClone(project),
    ])
  );
  for (const projectId of patch.projects?.clear ?? []) {
    projects.delete(projectId);
  }
  for (const project of patch.projects?.upsert ?? []) {
    projects.set(project.id, structuredClone(project));
  }
  return [...projects.values()];
}

function createStoreProfileFromPatch(patch: StoreProfilePatch): StoreProfile {
  const required = [
    'name',
    'city',
    'district',
    'address',
    'booking',
    'brandVoice',
    'regulated',
  ] as const;
  const missing = required.filter((key) => patch[key] === undefined);
  if (missing.length > 0) {
    throw new DomainError(
      'STORE_PROFILE_INCOMPLETE',
      `A first store profile patch is missing: ${missing.join(', ')}.`,
      409,
      { missing }
    );
  }
  return {
    name: patch.name!,
    city: patch.city!,
    district: patch.district!,
    address: patch.address!,
    booking: patch.booking!,
    ...(patch.industry === undefined ? {} : { industry: patch.industry }),
    brandVoice: patch.brandVoice!,
    prohibitions: structuredClone(patch.prohibitions ?? []),
    accounts: mergeStoreAccounts([], patch),
    projects: mergeStoreProjects([], patch),
    regulated: patch.regulated!,
    confirmedAt: now(),
    revision: 1,
  };
}

function currentVersion(content: ContentItem, platform = 'xiaohongshu') {
  const variant = content.variants.find((item) => item.platform === platform);
  if (!variant)
    throw new DomainError(
      'VARIANT_NOT_FOUND',
      'Content variant was not found.',
      404
    );
  const version = variant.versions.find(
    (item) => item.id === variant.currentVersionId
  );
  if (!version)
    throw new DomainError(
      'VERSION_NOT_FOUND',
      'Content version was not found.',
      404
    );
  return { variant, version };
}

function audit(
  state: ProductState,
  context: ProductContext,
  action: string,
  entityType: string,
  entityId: string,
  details?: Record<string, unknown>
) {
  const event: AuditEvent = {
    id: randomUUID(),
    correlationId: context.correlationId,
    userId: context.userId,
    action,
    entityType,
    entityId,
    details,
    createdAt: now(),
  };
  state.auditEvents.push(event);
}

function recordCompliance(
  state: ProductState,
  context: ProductContext,
  result: Omit<ComplianceResult, 'id' | 'correlationId' | 'createdAt'>
) {
  const complianceResult: ComplianceResult = {
    ...result,
    id: randomUUID(),
    correlationId: context.correlationId,
    createdAt: now(),
  };
  state.complianceResults.push(complianceResult);
  return complianceResult;
}

function findContent(state: ProductState, id: string) {
  const content = state.contents.find((item) => item.id === id);
  if (!content)
    throw new DomainError('NOT_FOUND', 'Content was not found.', 404);
  return content;
}

function findJob(state: ProductState, id: string) {
  const job = state.videoJobs.find((item) => item.id === id);
  if (!job)
    throw new DomainError('NOT_FOUND', 'Video task was not found.', 404);
  return job;
}

function syncVideoTracking(state: ProductState, job: VideoJob) {
  const shell = state.videoArtifactShells.find(
    (item) => item.id === job.artifactShellId
  );
  if (shell) {
    shell.status = job.status;
    shell.updatedAt = job.updatedAt;
  }
  const run = state.agentRuns.find((item) => item.id === job.agentRunId);
  if (!run) return;
  run.status = job.status === 'needs_action' ? 'running' : job.status;
  if (
    job.status === 'completed' ||
    job.status === 'cancelled' ||
    job.status === 'failed'
  ) {
    run.completedAt = job.updatedAt;
  }
}

function hasActiveLease(job: VideoJob) {
  return Boolean(
    job.leaseExpiresAt && new Date(job.leaseExpiresAt).getTime() > Date.now()
  );
}

function copyVersion(
  draft: CopyCandidateDraft,
  generationEvidence?: CopyGenerationEvidence
): ContentVersion {
  return {
    id: randomUUID(),
    source: 'ai',
    ...draft,
    generationEvidence,
    createdAt: now(),
  };
}

function createCandidate(
  draft: CopyCandidateDraft,
  brief: Extract<ProductCommand, { type: 'generate_copy' }>['brief'],
  generationEvidence?: CopyGenerationEvidence
): ContentItem {
  const version = copyVersion(draft, generationEvidence);
  const variant: ContentVariant = {
    id: randomUUID(),
    platform: brief.platform,
    versions: [version],
    currentVersionId: version.id,
    aiDefaultVersionId: version.id,
  };
  return {
    id: randomUUID(),
    scenario: brief.scenario,
    projectId: brief.projectId,
    assetIds: [...brief.assetIds],
    status: 'candidate',
    complianceStatus: 'clear',
    variants: [variant],
    selected: false,
    createdAt: now(),
  };
}

const hardStopTerms = [
  '伪造资质',
  '永久治愈',
  '保证效果',
  '承诺安全性',
  '未批准药品',
  '未批药械',
  '绕过审核',
  '未授权案例',
];
const warningRules = [
  { term: '最便宜', pattern: /最便宜/u },
  { term: '第一', pattern: /第一(?!次|阶段|步|版|人称|天|周|月|年)/u },
  { term: '绝对', pattern: /绝对(?!值|路径|引用|定位|坐标)/u },
] as const;

function findWarningTerm(text: string) {
  return warningRules.find(({ pattern }) => pattern.test(text))?.term;
}
const workerCommands = new Set<ProductCommand['type']>([
  'claim_video',
  'heartbeat_video',
  'transition_video',
  'record_video_render',
  'complete_video',
]);
const recoveryWorkerCommands = new Set<ProductCommand['type']>([
  'claim_video',
  'heartbeat_video',
  'record_video_render',
  'complete_video',
]);

const phoneNumberPattern = /(?:\+?86[-\s]?)?1[3-9]\d{9}/;

function needsDomesticProvider(
  command: Extract<ProductCommand, { type: 'generate_copy' }>,
  assets: Asset[]
) {
  const text = [
    command.brief.hook,
    command.brief.tone,
    command.brief.conversionGoal,
  ].join(' ');
  return (
    phoneNumberPattern.test(text) ||
    assets.some((asset) => asset.containsPerson || asset.containsSensitiveData)
  );
}

function copyDataClasses(
  command: Extract<ProductCommand, { type: 'generate_copy' }>,
  assets: Asset[],
  regulated: boolean
): CopyProviderRequest['dataClasses'] {
  const values = new Set<CopyProviderRequest['dataClasses'][number]>();
  if (assets.some((asset) => asset.containsPerson)) values.add('contains_face');
  if (
    assets.some((asset) => asset.containsSensitiveData) ||
    phoneNumberPattern.test(
      [
        command.brief.hook,
        command.brief.tone,
        command.brief.conversionGoal,
      ].join(' ')
    )
  ) {
    values.add('pii');
  }
  if (regulated) values.add('medical');
  return [...values];
}

interface PreparedCopyExecution {
  claimToken: string;
  provider: CopyProvider;
  providerSlot: PendingCopyExecution['providerSlot'];
  request: CopyProviderRequest;
  reservationId?: string;
  agentRunId: string;
  toolCallId: string;
}

export interface ProductServiceConfig {
  repository: ProductRepository;
  notifier?: ProductNotifier;
  planConfig?: ProductPlanConfig;
  copyProviders?: CopyProviderRegistry;
  qualitySink?: ProductQualitySink;
  inFlightDecisions?: LegacyInFlightDecisionPort;
  acceptedWriteOwner?: 'legacy' | 'p1';
  copyExecutionClock?: () => Date;
  copyExecutionLeaseMs?: number;
  copyUsageAuthority?: 'legacy_state' | 'foundation_ledger';
  /** Keep P0 entitlement buckets as a historical projection only. */
  legacyBillingReadOnly?: boolean;
  legacyVideoPath?: 'enabled' | 'disabled';
  searchProjection?: Pick<OperationsProductSearchProjection, 'sync'>;
  packageRightsPropagation?: Pick<
    OperationsProductPackageRightsAdapter,
    'revokePackagesUsingAsset'
  >;
  storageEntitlements?: {
    resolve(
      ...args: Parameters<CreditSubscriptionEntitlementPolicy['resolve']>
    ): Promise<{ storageMb?: number } | null>;
  };
  contentWriteOwnership?: {
    get(
      workspaceId: string
    ): Promise<'legacy' | 'frozen' | 'contentpackage' | null>;
  };
}

// 交付台账链（create_handoff/record_handoff_export/report_handoff_result/
// mark_published）是票 17 的显式例外，切换后必须继续可用（交付不断供），
// 不得纳入本冻结集。mark_published 还是 ContentItem.status='published' 的唯一合法回写来源。
const LEGACY_CONTENT_WRITE_COMMANDS = new Set<ProductCommand['type']>([
  'generate_copy',
  'select_content',
  'create_douyin_variant',
  'quick_edit',
  'undo_edit',
  'revert_to_ai',
  'create_weekly_set',
  'remix_content',
  'abandon_content',
  'create_storyboard',
  'replace_storyboard_shot',
  'confirm_storyboard',
  'start_video',
]);

type ActiveProductCommand = Exclude<
  ProductCommand,
  { type: 'apply_plan' | 'retry_video' | 'start_video' }
>;

function rejectRetiredProductCommand(
  command: ProductCommand,
  phase: 'apply'
): asserts command is ActiveProductCommand;
function rejectRetiredProductCommand(
  command: ProductCommand,
  phase: 'authorize'
): void;
function rejectRetiredProductCommand(
  command: ProductCommand,
  phase: 'apply' | 'authorize'
) {
  if (command.type === 'apply_plan') {
    throw new DomainError(
      'COMMAND_ACTOR_FORBIDDEN',
      'Legacy apply_plan is disabled; use entitlements.payment_grant.',
      403
    );
  }
  if (
    phase === 'apply' &&
    (command.type === 'start_video' || command.type === 'retry_video')
  ) {
    throw new DomainError(
      'LEGACY_BILLING_RETIRED',
      'Legacy billable generation is retired; use the credit-priced creation path.',
      409
    );
  }
}

type CopyPreparation =
  | { kind: 'stored'; outcome: IdempotentProductOutcome }
  | { kind: 'prepared'; execution: PreparedCopyExecution };

export interface PreparedProductVideoRender {
  job: VideoJob;
  sourceAsset: Asset;
  storyboard: Storyboard;
}

export interface ProductApplicationService {
  bootstrap(context: ProductContext): Promise<ProductState>;
  completedStoreProfileMergeRevision(
    context: ProductContext,
    patch: StoreProfilePatch,
    idempotencyKey: string
  ): Promise<number | null>;
  mergeStoreProfile(
    context: ProductContext,
    patch: StoreProfilePatch,
    idempotencyKey: string
  ): Promise<StoreProfile>;
  execute(
    context: ProductContext,
    command: ProductCommand,
    idempotencyKey: string
  ): Promise<CommandResult>;
  prepareVideoRender(
    context: ProductContext,
    jobId: string
  ): Promise<PreparedProductVideoRender>;
}

export class ProductService implements ProductApplicationService {
  private readonly repository: ProductRepository;
  private readonly notifier: ProductNotifier;
  private readonly planConfig: ProductPlanConfig;
  private readonly copyProviders: CopyProviderRegistry;
  private readonly qualitySink: ProductQualitySink;
  private readonly inFlightDecisions: LegacyInFlightDecisionPort;
  private readonly acceptedWriteOwner: 'legacy' | 'p1';
  /**
   * Holds `legacyBillingReadOnly` so the call sites below no longer have to.
   * See legacy-billing-ledger.ts for why the flag moved inside the verbs.
   */
  private readonly ledger: LegacyBillingLedger;

  constructor(private readonly options: ProductServiceConfig) {
    this.repository = options.repository;
    this.notifier = options.notifier ?? noOpProductNotifier;
    this.planConfig = options.planConfig ?? defaultProductPlanConfig;
    this.copyProviders = options.copyProviders ?? defaultCopyProviderRegistry;
    this.qualitySink = options.qualitySink ?? noOpProductQualitySink;
    this.inFlightDecisions =
      options.inFlightDecisions ?? noOpLegacyInFlightDecisionPort;
    this.acceptedWriteOwner = options.acceptedWriteOwner ?? 'legacy';
    this.ledger = new LegacyBillingLedger(!options.legacyBillingReadOnly);
  }

  async bootstrap(context: ProductContext) {
    await this.authorize(context);
    const stored = await this.repository.load(context.workspaceId);
    const state = withoutPlatformSamples(
      stored
        ? normalizeState(stored, this.planConfig)
        : initialState(context.workspaceId, this.planConfig)
    );
    await this.options.searchProjection?.sync(state);
    return state;
  }

  async completedStoreProfileMergeRevision(
    context: ProductContext,
    patch: StoreProfilePatch,
    idempotencyKey: string
  ) {
    await this.authorize(context);
    const existing = await this.repository.loadIdempotent(
      context.workspaceId,
      idempotencyKey,
      storeProfilePatchPayloadHash(patch)
    );
    if (!existing) return null;
    if (!existing.matches) {
      throw new DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency key was reused with another store profile patch.',
        409
      );
    }
    return existing.outcome.kind === 'success'
      ? (existing.outcome.result.output.storeRevision ?? null)
      : null;
  }

  async mergeStoreProfile(
    context: ProductContext,
    patch: StoreProfilePatch,
    idempotencyKey: string
  ) {
    await this.authorize(context);
    if (!idempotencyKey) {
      throw new DomainError(
        'IDEMPOTENCY_KEY_REQUIRED',
        'Idempotency key is required.'
      );
    }
    const fingerprint = storeProfilePatchPayloadHash(patch);
    const result = await this.repository.withWorkspaceLock(
      context.workspaceId,
      async (repository) => {
        const existing = await repository.loadIdempotent(
          context.workspaceId,
          idempotencyKey,
          fingerprint
        );
        if (existing && !existing.matches) {
          throw new DomainError(
            'IDEMPOTENCY_CONFLICT',
            'Idempotency key was reused with another store profile patch.',
            409
          );
        }
        if (existing) {
          if (existing.outcome.kind === 'error') {
            throw new DomainError(
              existing.outcome.error.code,
              existing.outcome.error.message,
              existing.outcome.error.status,
              existing.outcome.error.details
            );
          }
          if (existing.outcome.kind !== 'success') {
            throw new DomainError(
              'COMMAND_IN_PROGRESS',
              'The store profile patch is still running.',
              409
            );
          }
          const replay = await repository.load(context.workspaceId);
          if (!replay?.store) {
            throw new DomainError(
              'STORE_PROFILE_MISSING',
              'The completed store profile projection is missing.',
              500
            );
          }
          return {
            ...normalizeState(replay, this.planConfig).store!,
            revision:
              existing.outcome.result.output.storeRevision ??
              normalizeState(replay, this.planConfig).store!.revision,
          };
        }

        const futureWriteOwner = await repository.getFutureWriteOwner(
          context.workspaceId
        );
        const decision = decideAcceptedProductWrite(
          futureWriteOwner,
          this.acceptedWriteOwner
        );
        if (decision.decision !== 'allow') {
          if (decision.code === 'WRITE_OWNERSHIP_MISSING') {
            const error = writeOwnershipMissingError('p1');
            throw new DomainError(error.code, error.message, error.status);
          }
          throw new DomainError(
            this.acceptedWriteOwner === 'legacy'
              ? 'LEGACY_WRITE_DISABLED'
              : 'P1_WRITE_DISABLED',
            'Store profile writes moved to another product owner.',
            409
          );
        }
        const stored = await repository.load(context.workspaceId);
        const state = stored
          ? normalizeState(stored, this.planConfig)
          : initialState(context.workspaceId, this.planConfig);
        const currentRevision = state.store?.revision ?? 0;
        if (currentRevision !== patch.expectedRevision) {
          throw new DomainError(
            'STORE_PROFILE_REVISION_CONFLICT',
            `Store profile expected revision ${patch.expectedRevision}, current revision is ${currentRevision}.`,
            409,
            {
              currentRevision,
              expectedRevision: patch.expectedRevision,
            }
          );
        }
        if (
          patch.projects?.upsert?.some((project) => !project.confirmed)
        ) {
          throw new DomainError(
            'UNCONFIRMED_FACT',
            'Prices and projects must be confirmed before use.'
          );
        }
        state.store = state.store
          ? {
              ...state.store,
              ...storeProfileScalars(patch),
              accounts: mergeStoreAccounts(state.store.accounts, patch),
              projects: mergeStoreProjects(state.store.projects, patch),
              confirmedAt: now(),
              revision: currentRevision + 1,
            }
          : createStoreProfileFromPatch(patch);
        audit(
          state,
          context,
          'store.profile_merged',
          'store',
          context.workspaceId,
          {
            fromRevision: currentRevision,
            toRevision: state.store.revision,
          }
        );
        state.updatedAt = nextUpdatedAt(state.updatedAt);
        const commandResult: CommandResult = {
          state: withoutPlatformSamples(state),
          output: { storeRevision: state.store.revision },
        };
        await repository.save(state, context);
        await repository.saveIdempotent(
          context.workspaceId,
          idempotencyKey,
          fingerprint,
          { kind: 'success', result: commandResult }
        );
        return state.store;
      }
    );
    await this.options.searchProjection?.sync(
      normalizeState(
        (await this.repository.load(context.workspaceId)) ??
          initialState(context.workspaceId, this.planConfig),
        this.planConfig
      )
    );
    return structuredClone(result);
  }

  async prepareVideoRender(context: ProductContext, jobId: string) {
    if (this.options.legacyVideoPath === 'disabled') {
      throw new DomainError(
        'LEGACY_VIDEO_PATH_RETIRED',
        'P1 workspaces use the native video workflow.',
        409
      );
    }
    if ((context.actor ?? 'user') !== 'worker') {
      throw new DomainError(
        'COMMAND_ACTOR_FORBIDDEN',
        'Only the authenticated video worker can read render inputs.',
        403
      );
    }
    await this.authorize(context);
    return this.repository.withWorkspaceLock(
      context.workspaceId,
      async (repository) => {
        await this.requireLegacyRenderAccess(repository, context, jobId);
        const stored = await repository.load(context.workspaceId);
        const state = stored
          ? normalizeState(stored, this.planConfig)
          : initialState(context.workspaceId, this.planConfig);
        const job = findJob(state, jobId);
        if (job.status !== 'queued' && job.status !== 'running') {
          throw new DomainError(
            'VIDEO_NOT_RENDERABLE',
            'Only a queued or running video task can be rendered.',
            409
          );
        }
        const storyboard = state.storyboards.find(
          (item) => item.id === job.storyboardId
        );
        if (!storyboard || storyboard.status !== 'confirmed') {
          throw new DomainError(
            'STORYBOARD_NOT_CONFIRMED',
            'A confirmed storyboard is required for rendering.',
            409
          );
        }
        const sourceAssetId = storyboard.shots[0]?.sourceAssetId;
        const sourceAsset = state.assets.find(
          (asset) => asset.id === sourceAssetId
        );
        if (!sourceAsset) {
          throw new DomainError(
            'NOT_FOUND',
            'The source asset was not found.',
            404
          );
        }
        return {
          job: structuredClone(job),
          sourceAsset: structuredClone(sourceAsset),
          storyboard: structuredClone(storyboard),
        };
      }
    );
  }

  /**
   * D-126 single exit. Every merchant-facing CommandResult leaves the service
   * here, so an early return added inside executeCommand cannot forget the
   * projection filter — including replays served from the idempotency store.
   * The persisted state stays authoritative and unfiltered.
   */
  async execute(
    context: ProductContext,
    command: ProductCommand,
    idempotencyKey: string
  ): Promise<CommandResult> {
    const result = await this.executeCommand(context, command, idempotencyKey);
    const projected = withoutPlatformSamples(result.state);
    return projected === result.state ? result : { ...result, state: projected };
  }

  protected async executeCommand(
    context: ProductContext,
    command: ProductCommand,
    idempotencyKey: string
  ): Promise<CommandResult> {
    await this.authorize(context);
    if (!idempotencyKey)
      throw new DomainError(
        'IDEMPOTENCY_KEY_REQUIRED',
        'Idempotency key is required.'
      );
    this.authorizeCommandActor(context, command);
    if (
      this.acceptedWriteOwner === 'p1' &&
      command.type === 'generate_copy' &&
      (await this.repository.getMembershipRole(
        context.userId,
        context.workspaceId
      )) !== 'owner'
    ) {
      throw new DomainError(
        'GENERATION_OWNER_REQUIRED',
        'Only a workspace Owner can start billable generation.',
        403
      );
    }
    if (
      this.options.legacyVideoPath === 'disabled' &&
      [
        'start_video',
        'claim_video',
        'heartbeat_video',
        'transition_video',
        'resume_video',
        'record_video_render',
        'complete_video',
        'cancel_video',
        'retry_video',
      ].includes(command.type)
    ) {
      throw new DomainError(
        'LEGACY_VIDEO_PATH_RETIRED',
        'P1 workspaces use the native video workflow and its single Foundation ledger.',
        409
      );
    }
    const payloadHash = commandPayloadHash(command);
    if (command.type === 'generate_copy') {
      await this.requireLegacyContentWrite(context, command);
      return this.executeGenerateCopy(
        context,
        command,
        idempotencyKey,
        payloadHash
      );
    }
    const outcome = await this.repository.withWorkspaceLock(
      context.workspaceId,
      async (repository) => {
        const existing = await repository.loadIdempotent(
          context.workspaceId,
          idempotencyKey,
          payloadHash
        );
        if (existing && !existing.matches) {
          throw new DomainError(
            'IDEMPOTENCY_CONFLICT',
            'Idempotency key was reused with a different command payload.',
            409
          );
        }
        if (existing) return existing.outcome;
        await this.requireLegacyWriteOwner(repository, context, command);
        await this.requireLegacyContentWrite(context, command);

        const stored = await repository.load(context.workspaceId);
        const state = stored
          ? normalizeState(stored, this.planConfig)
          : initialState(context.workspaceId, this.planConfig);
        let output: CommandResult['output'] = {};
        try {
          output = await this.apply(state, context, command);
        } catch (error) {
          const domainError =
            error instanceof DomainError
              ? error
              : new DomainError(
                  'INTERNAL_ERROR',
                  'The product command could not be processed.',
                  500
                );
          state.updatedAt = nextUpdatedAt(state.updatedAt);
          await repository.save(state, context);
          const failure = {
            kind: 'error' as const,
            error: {
              code: domainError.code,
              message: domainError.message,
              status: domainError.status,
              details: domainError.details,
            },
          };
          await repository.saveIdempotent(
            context.workspaceId,
            idempotencyKey,
            payloadHash,
            failure
          );
          return failure;
        }

        state.updatedAt = nextUpdatedAt(state.updatedAt);
        // D-126: the persisted state is authoritative; the merchant-facing
        // projection never carries platform-sample material.
        const result: CommandResult = {
          state: withoutPlatformSamples(state),
          output,
        };
        await repository.save(state, context);
        const success = { kind: 'success' as const, result };
        await repository.saveIdempotent(
          context.workspaceId,
          idempotencyKey,
          payloadHash,
          success
        );
        return success;
      }
    );
    if (outcome.kind === 'pending') {
      throw new DomainError(
        'COMMAND_IN_PROGRESS',
        'The same content generation command is still running.',
        409
      );
    }
    if (outcome.kind === 'error') {
      throw new DomainError(
        outcome.error.code,
        outcome.error.message,
        outcome.error.status,
        outcome.error.details
      );
    }
    if (
      command.type === 'withdraw_asset' ||
      command.type === 'update_asset_metadata' ||
      command.type === 'authorize_asset' ||
      command.type === 'add_asset'
    ) {
      // 撤权传播必须覆盖所有失去授权的路径，而不只是 withdraw：
      // update_asset_metadata 可把素材置 blocked（未成年）或 pending（丢证据），
      // authorize_asset 降为 internal_only 时回到 pending——这些都要让引用该
      // 素材的 ContentPackage 变「需处理」。传播端是幂等的，重复触发无害。
      // V31-87：同内容重传走 add_asset 的复用分支，改过的事实同样能把素材打回
      // pending/blocked，所以这条路径与 update_asset_metadata 同权。
      const current = await this.repository.load(context.workspaceId);
      const assetId =
        command.type === 'add_asset' ? command.asset.id : command.assetId;
      const asset = current?.assets.find((item) => item.id === assetId);
      // A brand-new asset starts pending and nothing quotes it yet, so only the
      // re-registration branch — which edits an asset that was already there —
      // has anything to propagate.
      const registeredExistingAsset =
        command.type !== 'add_asset' ||
        outcome.result.state.auditEvents.some(
          (event) =>
            event.action === 'asset.metadata_updated' &&
            event.entityId === assetId
        );
      if (
        registeredExistingAsset &&
        asset &&
        asset.authorizationStatus !== 'authorized'
      ) {
        await this.options.packageRightsPropagation?.revokePackagesUsingAsset(
          context,
          assetId
        );
      }
    }
    await this.options.searchProjection?.sync(outcome.result.state);
    await this.notifyTerminalTask(context, command, outcome.result.state);
    await this.recordQualityFeedback(context, command, outcome.result.state);
    return outcome.result;
  }

  private async executeGenerateCopy(
    context: ProductContext,
    command: Extract<ProductCommand, { type: 'generate_copy' }>,
    idempotencyKey: string,
    payloadHash: string
  ) {
    const preparation = await this.repository.withWorkspaceLock(
      context.workspaceId,
      async (repository): Promise<CopyPreparation> => {
        const existing = await repository.loadIdempotent(
          context.workspaceId,
          idempotencyKey,
          payloadHash
        );
        if (existing && !existing.matches) {
          throw new DomainError(
            'IDEMPOTENCY_CONFLICT',
            'Idempotency key was reused with a different command payload.',
            409
          );
        }
        if (existing) {
          if (
            existing.outcome.kind === 'pending' &&
            !this.copyExecutionLeaseActive(existing.outcome)
          ) {
            return this.reclaimCopyExecution(
              repository,
              context,
              idempotencyKey,
              payloadHash,
              existing.outcome
            );
          }
          return { kind: 'stored', outcome: existing.outcome };
        }
        if (this.options.legacyBillingReadOnly) {
          throw new DomainError(
            'LEGACY_BILLING_RETIRED',
            'Legacy product generation is retired; use the credit-priced creation path.',
            409
          );
        }
        await this.requireLegacyWriteOwner(repository, context, command);
        await this.requireLegacyContentWrite(context, command);

        const stored = await repository.load(context.workspaceId);
        const state = stored
          ? normalizeState(stored, this.planConfig)
          : initialState(context.workspaceId, this.planConfig);
        try {
          const execution = this.prepareCopyExecution(
            state,
            context,
            command,
            idempotencyKey
          );
          state.updatedAt = nextUpdatedAt(state.updatedAt);
          await repository.save(state, context);
          await repository.saveIdempotent(
            context.workspaceId,
            idempotencyKey,
            payloadHash,
            {
              claimToken: execution.claimToken,
              correlationId: context.correlationId,
              execution: this.copyExecutionSnapshot(execution),
              kind: 'pending',
              leaseExpiresAt: this.copyExecutionLeaseExpiresAt(),
              startedAt: this.copyExecutionNow().toISOString(),
            }
          );
          return { execution, kind: 'prepared' };
        } catch (error) {
          const domainError =
            error instanceof DomainError
              ? error
              : new DomainError(
                  'INTERNAL_ERROR',
                  'The product command could not be processed.',
                  500
                );
          state.updatedAt = nextUpdatedAt(state.updatedAt);
          await repository.save(state, context);
          const failure = {
            error: {
              code: domainError.code,
              details: domainError.details,
              message: domainError.message,
              status: domainError.status,
            },
            kind: 'error' as const,
          };
          await repository.saveIdempotent(
            context.workspaceId,
            idempotencyKey,
            payloadHash,
            failure
          );
          return { kind: 'stored', outcome: failure };
        }
      }
    );

    if (preparation.kind === 'stored') {
      const result = this.unwrapProductOutcome(preparation.outcome);
      await this.options.searchProjection?.sync(result.state);
      return result;
    }

    let drafts: CopyCandidateDraft[] | undefined;
    let generationEvidence: CopyGenerationEvidence | undefined;
    let providerError: unknown;
    try {
      const generated = await preparation.execution.provider.generate(
        preparation.execution.request
      );
      drafts = Array.isArray(generated) ? generated : generated.candidates;
      generationEvidence = Array.isArray(generated)
        ? undefined
        : generated.evidence;
    } catch (error) {
      providerError = error;
    }

    const outcome = await this.repository.withWorkspaceLock(
      context.workspaceId,
      async (repository): Promise<IdempotentProductOutcome> => {
        const pending = await repository.loadIdempotent(
          context.workspaceId,
          idempotencyKey,
          payloadHash
        );
        if (!pending?.matches) {
          throw new DomainError(
            'COPY_EXECUTION_NOT_FOUND',
            'The reserved copy execution could not be recovered.',
            500
          );
        }
        if (pending.outcome.kind !== 'pending') {
          return pending.outcome;
        }
        if (pending.outcome.claimToken !== preparation.execution.claimToken) {
          return pending.outcome;
        }
        const state = normalizeState(
          (await repository.load(context.workspaceId)) ??
            initialState(context.workspaceId, this.planConfig),
          this.planConfig
        );
        const agentRun = state.agentRuns.find(
          (item) => item.id === preparation.execution.agentRunId
        );
        const toolCall = state.toolCalls.find(
          (item) => item.id === preparation.execution.toolCallId
        );
        if (!agentRun || !toolCall) {
          throw new DomainError(
            'COPY_EXECUTION_NOT_FOUND',
            'The reserved copy execution could not be recovered.',
            500
          );
        }
        try {
          await this.requireLegacyContentWrite(context, command);
          if (providerError) throw providerError;
          if (!drafts || drafts.length !== 3) {
            throw new Error(
              'Copy provider must return exactly three candidates.'
            );
          }
          const candidates = drafts.map((draft) =>
            createCandidate(draft, command.brief, generationEvidence)
          );
          if (generationEvidence) {
            toolCall.model = generationEvidence.actualModel;
            toolCall.costCents = Math.max(
              0,
              Math.round(generationEvidence.providerCost.amount * 100)
            );
          }
          state.contents.push(...candidates);
          this.ledger.commit(
            state,
            context,
            'content',
            preparation.execution.reservationId
          );
          agentRun.status = 'completed';
          agentRun.completedAt = now();
          toolCall.status = 'completed';
          toolCall.latencyMs = Math.max(
            0,
            Date.now() - new Date(agentRun.startedAt).getTime()
          );
          state.operationalEvidence.firstContentAt ??= now();
          state.operationalEvidence.generatedCandidateCount +=
            candidates.length;
          audit(
            state,
            context,
            'content.generated',
            'content_batch',
            candidates[0]?.id ?? randomUUID(),
            {
              agentRunId: agentRun.id,
              candidateIds: candidates.map((item) => item.id),
              requestedPlatform: command.brief.platform,
              providerModel: toolCall.model,
              providerRegion: preparation.execution.provider.region,
              providerRoute: preparation.execution.provider.name,
              requestedModel: generationEvidence?.requestedModel,
              actualModel: generationEvidence?.actualModel,
              routeSnapshotId: generationEvidence?.routeSnapshotId,
              promptRevision: generationEvidence?.promptRevision,
              templateRevision: generationEvidence?.templateRevision,
              exampleSetRevision: generationEvidence?.exampleSetRevision,
              providerCost: generationEvidence?.providerCost,
              toolCallId: toolCall.id,
            }
          );
          state.updatedAt = nextUpdatedAt(state.updatedAt);
          const result: CommandResult = {
            output: { candidateIds: candidates.map((item) => item.id) },
            state,
          };
          await repository.save(state, context);
          const success = { kind: 'success' as const, result };
          await repository.saveIdempotent(
            context.workspaceId,
            idempotencyKey,
            payloadHash,
            success
          );
          return success;
        } catch (error) {
          agentRun.status = 'failed';
          agentRun.completedAt = now();
          toolCall.status = 'failed';
          toolCall.latencyMs = Math.max(
            0,
            Date.now() - new Date(agentRun.startedAt).getTime()
          );
          this.ledger.refund(
            state,
            context,
            'content',
            preparation.execution.reservationId
          );
          state.updatedAt = nextUpdatedAt(state.updatedAt);
          const domainError =
            error instanceof DomainError
              ? error
              : new DomainError(
                  'COPY_PROVIDER_FAILED',
                  'Content generation failed for a technical reason. The quota was refunded.',
                  502
                );
          const failure = {
            error: {
              code: domainError.code,
              details: domainError.details,
              message: domainError.message,
              status: domainError.status,
            },
            kind: 'error' as const,
          };
          await repository.save(state, context);
          await repository.saveIdempotent(
            context.workspaceId,
            idempotencyKey,
            payloadHash,
            failure
          );
          return failure;
        }
      }
    );
    const result = this.unwrapProductOutcome(outcome);
    await this.options.searchProjection?.sync(result.state);
    return result;
  }

  private async requireLegacyWriteOwner(
    repository: ProductRepository,
    context: ProductContext,
    command: ProductCommand
  ) {
    const futureWriteOwner = await repository.getFutureWriteOwner(
      context.workspaceId
    );
    if (futureWriteOwner == null) {
      const error = writeOwnershipMissingError('p1');
      throw new DomainError(error.code, error.message, error.status);
    }
    if (futureWriteOwner === this.acceptedWriteOwner) {
      if (
        this.acceptedWriteOwner === 'p1' &&
        (context.actor ?? 'user') === 'worker' &&
        'jobId' in command
      ) {
        const decision = await this.inFlightDecisions.get(
          context.workspaceId,
          command.jobId
        );
        if (!decision) return;
        if (decision.decision === 'manual') {
          throw new DomainError(
            'LEGACY_INFLIGHT_MANUAL',
            'This legacy task is reserved for an operator decision.',
            409
          );
        }
        if (decision.decision === 'legacy_drain') {
          throw new DomainError(
            'LEGACY_INFLIGHT_OWNER_MISMATCH',
            'This legacy task remains owned by the legacy drain worker.',
            409
          );
        }
        if (!recoveryWorkerCommands.has(command.type)) {
          throw new DomainError(
            'LEGACY_REGENERATION_FORBIDDEN',
            'Recovery may inspect the original provider task and store its result, but may not regenerate it.',
            409
          );
        }
      }
      return;
    }
    if (
      this.acceptedWriteOwner === 'legacy' &&
      (context.actor ?? 'user') === 'worker' &&
      'jobId' in command
    ) {
      const decision = await this.requireInFlightDecision(
        context.workspaceId,
        command.jobId
      );
      if (decision.decision === 'legacy_drain') return;
      if (
        decision.decision === 'new_owner_recovery' &&
        recoveryWorkerCommands.has(command.type)
      ) {
        return;
      }
      if (decision.decision === 'new_owner_recovery') {
        throw new DomainError(
          'LEGACY_REGENERATION_FORBIDDEN',
          'Recovery may inspect the original provider task and store its result, but may not regenerate it.',
          409
        );
      }
    }
    if (futureWriteOwner === 'frozen') {
      throw new DomainError(
        'COMMANDS_FROZEN',
        'New commands are frozen for the P1 cutover window.',
        409
      );
    }
    throw new DomainError(
      this.acceptedWriteOwner === 'legacy'
        ? 'LEGACY_WRITE_DISABLED'
        : 'P1_WRITE_DISABLED',
      this.acceptedWriteOwner === 'legacy'
        ? 'New commands are owned by the P1 relational application service.'
        : 'New commands are owned by the legacy product application service.',
      409
    );
  }

  private async requireLegacyContentWrite(
    context: ProductContext,
    command: ProductCommand
  ) {
    if (
      !this.options.contentWriteOwnership ||
      !LEGACY_CONTENT_WRITE_COMMANDS.has(command.type)
    ) {
      return;
    }
    const owner = await this.options.contentWriteOwnership.get(
      context.workspaceId
    );
    const decision = decideLegacyContentWrite(owner);
    if (decision.decision === 'allow') return;
    if (decision.code === 'WRITE_OWNERSHIP_MISSING') {
      const error = writeOwnershipMissingError('contentpackage');
      throw new DomainError(error.code, error.message, error.status);
    }
    if (owner === 'frozen') {
      throw new DomainError(
        'CONTENT_COMMANDS_FROZEN',
        'Legacy content changes are frozen for the ContentPackage migration window.',
        409
      );
    }
    throw new DomainError(
      'LEGACY_CONTENT_READ_ONLY',
      '旧内容已迁移为只读历史，请到内容库的新成品上操作。',
      409,
      { nextPath: '/dashboard/content' }
    );
  }

  private async requireLegacyRenderAccess(
    repository: ProductRepository,
    context: ProductContext,
    jobId: string
  ) {
    const futureWriteOwner = await repository.getFutureWriteOwner(
      context.workspaceId
    );
    if (futureWriteOwner == null) {
      const error = writeOwnershipMissingError('p1');
      throw new DomainError(error.code, error.message, error.status);
    }
    if (futureWriteOwner === this.acceptedWriteOwner) {
      if (this.acceptedWriteOwner === 'legacy') return;
      const decision = await this.inFlightDecisions.get(
        context.workspaceId,
        jobId
      );
      if (!decision) return;
      if (decision.decision === 'manual') {
        throw new DomainError(
          'LEGACY_INFLIGHT_MANUAL',
          'This legacy task is reserved for an operator decision.',
          409
        );
      }
      if (decision.decision === 'new_owner_recovery') {
        throw new DomainError(
          'LEGACY_REGENERATION_FORBIDDEN',
          'The recovery owner must reuse the original provider task instead of rendering again.',
          409
        );
      }
      throw new DomainError(
        'LEGACY_INFLIGHT_OWNER_MISMATCH',
        'This legacy task remains owned by the legacy drain worker.',
        409
      );
    }
    if (this.acceptedWriteOwner === 'p1') {
      throw new DomainError(
        futureWriteOwner === 'frozen' ? 'COMMANDS_FROZEN' : 'P1_WRITE_DISABLED',
        futureWriteOwner === 'frozen'
          ? 'New commands are frozen for the P1 cutover window.'
          : 'New commands are owned by the legacy product application service.',
        409
      );
    }
    const decision = await this.requireInFlightDecision(
      context.workspaceId,
      jobId
    );
    if (decision.decision === 'legacy_drain') return;
    throw new DomainError(
      'LEGACY_REGENERATION_FORBIDDEN',
      'The recovery owner must reuse the original provider task instead of rendering again.',
      409
    );
  }

  private async requireInFlightDecision(workspaceId: string, jobId: string) {
    const decision = await this.inFlightDecisions.get(workspaceId, jobId);
    if (!decision) {
      throw new DomainError(
        'LEGACY_INFLIGHT_DECISION_REQUIRED',
        'This legacy task has no cutover owner decision.',
        409
      );
    }
    if (decision.decision === 'manual') {
      throw new DomainError(
        'LEGACY_INFLIGHT_MANUAL',
        'This legacy task is reserved for an operator decision.',
        409
      );
    }
    return decision;
  }

  private async recordQualityFeedback(
    context: ProductContext,
    command: ProductCommand,
    state: ProductState
  ) {
    let content: ContentItem | undefined;
    let outcome: ProductQualityEvent['outcome'] | undefined;
    let platform: ContentVariant['platform'] | undefined;
    if (command.type === 'select_content') {
      content = state.contents.find((item) => item.id === command.contentId);
      platform = content?.variants[0]?.platform;
      if (content && platform) {
        outcome =
          currentVersion(content, platform).version.source === 'merchant'
            ? 'adopted_with_small_edit'
            : 'adopted_directly';
      }
    } else if (command.type === 'quick_edit') {
      content = state.contents.find((item) => item.id === command.contentId);
      outcome = 'adopted_with_small_edit';
      platform = content?.variants[0]?.platform;
    } else if (command.type === 'mark_published') {
      const handoff = state.handoffPackages.find(
        (item) => item.id === command.packageId
      );
      content = state.contents.find((item) => item.id === handoff?.contentId);
      outcome = 'published';
      platform = handoff?.platform;
    } else if (command.type === 'remix_content') {
      content = state.contents.find((item) => item.id === command.contentId);
      outcome = 'rerolled';
      platform = content?.variants[0]?.platform;
    } else if (command.type === 'abandon_content') {
      content = state.contents.find((item) => item.id === command.contentId);
      outcome = 'abandoned';
      platform = content?.variants[0]?.platform;
    }
    if (!content || !outcome || !platform) return;
    const { variant, version } = currentVersion(content, platform);
    const evidence = version.generationEvidence;
    if (!evidence) return;
    const aiVersion = variant.versions.find(
      (item) => item.id === variant.aiDefaultVersionId
    );
    const edited = outcome === 'adopted_with_small_edit';
    await this.qualitySink.record(context.workspaceId, {
      catalogModelId: evidence.actualModel,
      contentId: content.id,
      createdAt: now(),
      ...(edited && aiVersion
        ? { editDistance: normalizedEditDistance(aiVersion.body, version.body) }
        : {}),
      exampleSetRevision: evidence.exampleSetRevision,
      id: `content-quality:${content.id}:${version.id}:${outcome}`,
      outcome,
      promptRevision: evidence.promptRevision,
      scenario: content.scenario,
      templateRevision:
        evidence.templateRevision ??
        `legacy-unknown:${evidence.promptRevision}`,
    });
  }

  private prepareCopyExecution(
    state: ProductState,
    context: ProductContext,
    command: Extract<ProductCommand, { type: 'generate_copy' }>,
    idempotencyKey: string
  ): PreparedCopyExecution {
    if (!state.store) {
      throw new DomainError(
        'STORE_REQUIRED',
        'Confirm the store profile before generating content.'
      );
    }
    const project = state.store.projects.find(
      (item) => item.id === command.brief.projectId
    );
    if (!project) {
      throw new DomainError(
        'PROJECT_NOT_FOUND',
        'The selected project was not found.'
      );
    }
    const assets = command.brief.assetIds.map((id) =>
      state.assets.find((item) => item.id === id)
    );
    if (assets.some((asset) => !asset)) {
      throw new DomainError(
        'ASSET_NOT_FOUND',
        'The selected creation asset was not found.'
      );
    }
    const selectedAssets = assets as Asset[];
    const domesticRoute = needsDomesticProvider(command, selectedAssets);
    const providerSlot = domesticRoute ? 'domestic' : 'standard';
    const provider = domesticRoute
      ? this.copyProviders.domestic
      : this.copyProviders.standard;
    if (domesticRoute && provider.region === 'overseas') {
      throw new DomainError(
        'DOMESTIC_PROVIDER_REQUIRED',
        'Personal or sensitive data must stay on a domestic provider route.',
        500
      );
    }
    const agentRun: AgentRun = {
      correlationId: context.correlationId,
      id: randomUUID(),
      startedAt: now(),
      status: 'running',
      workflow: 'content.generate_copy',
    };
    const toolCall: ToolCall = {
      agentRunId: agentRun.id,
      correlationId: context.correlationId,
      costCents: 0,
      createdAt: now(),
      id: randomUUID(),
      latencyMs: 0,
      model: provider.model,
      name: 'content.generate_candidates',
      provider: provider.name,
      status: 'failed',
    };
    state.agentRuns.push(agentRun);
    state.toolCalls.push(toolCall);
    const reservationId =
      this.options.copyUsageAuthority === 'foundation_ledger'
        ? undefined
        : this.ledger.reserve(state, context, 'content', 1);
    return {
      agentRunId: agentRun.id,
      claimToken: randomUUID(),
      provider,
      providerSlot,
      request: {
        assets: selectedAssets.map((asset) => ({
          aigcStatus: asset.aigcStatus,
          id: asset.id,
          tags: [...asset.tags],
        })),
        brief: structuredClone(command.brief),
        correlationId: context.correlationId,
        dataClasses: copyDataClasses(
          command,
          selectedAssets,
          state.store.regulated
        ),
        idempotencyKey,
        store: {
          brandVoice: state.store.brandVoice,
          city: state.store.city,
          name: state.store.name,
          project: {
            id: project.id,
            name: project.name,
            price: project.price,
          },
        },
        userId: context.userId,
        workspaceId: context.workspaceId,
      },
      ...(reservationId ? { reservationId } : {}),
      toolCallId: toolCall.id,
    };
  }

  private copyExecutionNow() {
    return this.options.copyExecutionClock?.() ?? new Date();
  }

  private copyExecutionLeaseMs() {
    return Math.max(1, this.options.copyExecutionLeaseMs ?? 5 * 60_000);
  }

  private copyExecutionLeaseExpiresAt() {
    return new Date(
      this.copyExecutionNow().getTime() + this.copyExecutionLeaseMs()
    ).toISOString();
  }

  private copyExecutionLeaseActive(
    pending: Extract<IdempotentProductOutcome, { kind: 'pending' }>
  ) {
    const explicitExpiry = pending.leaseExpiresAt
      ? Date.parse(pending.leaseExpiresAt)
      : Number.NaN;
    const startedAt = Date.parse(pending.startedAt);
    const expiresAt = Number.isFinite(explicitExpiry)
      ? explicitExpiry
      : startedAt + this.copyExecutionLeaseMs();
    return (
      Number.isFinite(expiresAt) &&
      expiresAt > this.copyExecutionNow().getTime()
    );
  }

  private copyExecutionSnapshot(
    execution: PreparedCopyExecution
  ): PendingCopyExecution {
    return {
      agentRunId: execution.agentRunId,
      providerModel: execution.provider.model,
      providerName: execution.provider.name,
      providerRegion: execution.provider.region,
      providerSlot: execution.providerSlot,
      request: structuredClone(execution.request),
      ...(execution.reservationId
        ? { reservationId: execution.reservationId }
        : {}),
      toolCallId: execution.toolCallId,
    };
  }

  private async reclaimCopyExecution(
    repository: ProductRepository,
    context: ProductContext,
    idempotencyKey: string,
    payloadHash: string,
    pending: Extract<IdempotentProductOutcome, { kind: 'pending' }>
  ): Promise<CopyPreparation> {
    const snapshot = pending.execution;
    if (!snapshot) {
      return this.failUnrecoverableCopyExecution(
        repository,
        context,
        idempotencyKey,
        payloadHash,
        pending,
        'COPY_EXECUTION_RECOVERY_UNAVAILABLE',
        'The original copy execution predates recoverable provider references and was closed without starting another provider job.'
      );
    }
    const provider = this.copyProviders[snapshot.providerSlot];
    if (
      provider.name !== snapshot.providerName ||
      provider.model !== snapshot.providerModel ||
      provider.region !== snapshot.providerRegion
    ) {
      return this.failUnrecoverableCopyExecution(
        repository,
        context,
        idempotencyKey,
        payloadHash,
        pending,
        'COPY_PROVIDER_ROUTE_CHANGED',
        'The original copy provider route is no longer available, so the execution was closed without switching providers.'
      );
    }
    const claimToken = randomUUID();
    await repository.saveIdempotent(
      context.workspaceId,
      idempotencyKey,
      payloadHash,
      {
        ...pending,
        claimToken,
        leaseExpiresAt: this.copyExecutionLeaseExpiresAt(),
      }
    );
    return {
      kind: 'prepared',
      execution: {
        agentRunId: snapshot.agentRunId,
        claimToken,
        provider,
        providerSlot: snapshot.providerSlot,
        request: structuredClone(snapshot.request),
        ...(snapshot.reservationId
          ? { reservationId: snapshot.reservationId }
          : {}),
        toolCallId: snapshot.toolCallId,
      },
    };
  }

  private async failUnrecoverableCopyExecution(
    repository: ProductRepository,
    context: ProductContext,
    idempotencyKey: string,
    payloadHash: string,
    pending: Extract<IdempotentProductOutcome, { kind: 'pending' }>,
    code: string,
    message: string
  ): Promise<CopyPreparation> {
    const state = normalizeState(
      (await repository.load(context.workspaceId)) ??
        initialState(context.workspaceId, this.planConfig),
      this.planConfig
    );
    const execution = pending.execution;
    const agentRun = execution
      ? state.agentRuns.find((item) => item.id === execution.agentRunId)
      : [...state.agentRuns]
          .reverse()
          .find(
            (item) =>
              item.correlationId === pending.correlationId &&
              item.workflow === 'content.generate_copy' &&
              item.status === 'running'
          );
    const toolCall = execution
      ? state.toolCalls.find((item) => item.id === execution.toolCallId)
      : [...state.toolCalls]
          .reverse()
          .find(
            (item) =>
              item.correlationId === pending.correlationId &&
              item.name === 'content.generate_candidates'
          );
    if (agentRun) {
      agentRun.status = 'failed';
      agentRun.completedAt = now();
    }
    if (toolCall) {
      toolCall.status = 'failed';
      toolCall.latencyMs = agentRun
        ? Math.max(0, Date.now() - new Date(agentRun.startedAt).getTime())
        : toolCall.latencyMs;
    }
    const reservationId =
      execution?.reservationId ??
      [...state.usageEvents]
        .reverse()
        .find(
          (event) =>
            event.correlationId === pending.correlationId &&
            event.resource === 'content' &&
            event.status === 'reserved' &&
            event.reservationId &&
            !state.usageEvents.some(
              (terminal) =>
                terminal.reservationId === event.reservationId &&
                ['committed', 'refunded', 'expired'].includes(terminal.status)
            )
        )?.reservationId;
    this.ledger.refund(state, context, 'content', reservationId);
    state.updatedAt = nextUpdatedAt(state.updatedAt);
    const failure = {
      error: { code, message, status: 409 },
      kind: 'error' as const,
    };
    await repository.save(state, context);
    await repository.saveIdempotent(
      context.workspaceId,
      idempotencyKey,
      payloadHash,
      failure
    );
    return { kind: 'stored', outcome: failure };
  }

  private unwrapProductOutcome(outcome: IdempotentProductOutcome) {
    if (outcome.kind === 'pending') {
      throw new DomainError(
        'COMMAND_IN_PROGRESS',
        'The same content generation command is still running.',
        409
      );
    }
    if (outcome.kind === 'error') {
      throw new DomainError(
        outcome.error.code,
        outcome.error.message,
        outcome.error.status,
        outcome.error.details
      );
    }
    return outcome.result;
  }

  private authorizeCommandActor(
    context: ProductContext,
    command: ProductCommand
  ) {
    const actor = context.actor ?? 'user';
    rejectRetiredProductCommand(command, 'authorize');
    const isWorkerCommand = workerCommands.has(command.type);
    if (
      (isWorkerCommand && actor !== 'worker') ||
      actor === 'payment' ||
      (actor === 'worker' && !isWorkerCommand)
    ) {
      throw new DomainError(
        'COMMAND_ACTOR_FORBIDDEN',
        'The authenticated actor cannot execute this command.',
        403
      );
    }
  }

  private async notifyTerminalTask(
    context: ProductContext,
    command: ProductCommand,
    state: ProductState
  ) {
    const jobId =
      command.type === 'complete_video' || command.type === 'transition_video'
        ? command.jobId
        : undefined;
    if (!jobId) return;
    const job = state.videoJobs.find((item) => item.id === jobId);
    if (!job || (job.status !== 'completed' && job.status !== 'needs_action'))
      return;
    await this.notifier.notify({
      workspaceId: context.workspaceId,
      jobId: job.id,
      status: job.status,
      message:
        job.status === 'completed'
          ? '视频已完成，可返回工作台预览。'
          : '视频任务需要你补充约束。',
      deepLink: serializeCanonicalDeepLink({
        producer: 'notification',
        objectClass: 'jobId',
        id: job.id,
      }),
      correlationId: context.correlationId,
      idempotencyKey: `${context.workspaceId}:video-terminal:${job.id}:${job.status}`,
    });
  }

  private async authorize(context: ProductContext) {
    const role = await this.repository.getMembershipRole(
      context.userId,
      context.workspaceId
    );
    if (!role) {
      throw new DomainError(
        'NOT_FOUND',
        'Workspace resource was not found.',
        404
      );
    }
    return role;
  }

  private async apply(
    state: ProductState,
    context: ProductContext,
    command: ProductCommand
  ) {
    rejectRetiredProductCommand(command, 'apply');
    switch (command.type) {
      case 'hide_example': {
        for (const example of state.exampleStores) {
          example.hidden = command.hidden;
          audit(
            state,
            context,
            'example.visibility_changed',
            'example_store',
            example.id
          );
        }
        return {};
      }
      case 'save_store_draft': {
        state.storeDraft = {
          sourceText: command.sourceText,
          extracted: structuredClone(command.extracted),
          confirmed: false,
          createdAt: now(),
        };
        audit(
          state,
          context,
          'store.draft_extracted',
          'store_draft',
          context.workspaceId,
          { source: 'merchant_pasted_text', confirmed: false }
        );
        return {};
      }
      case 'confirm_store': {
        if (command.store.projects.some((project) => !project.confirmed)) {
          throw new DomainError(
            'UNCONFIRMED_FACT',
            'Prices and projects must be confirmed before use.'
          );
        }
        state.store = {
          ...command.store,
          confirmedAt: now(),
          revision: (state.store?.revision ?? 0) + 1,
        };
        audit(state, context, 'store.confirmed', 'store', context.workspaceId);
        return {};
      }
      case 'confirm_qualification': {
        state.qualification = { ...command.qualification, confirmed: true };
        audit(
          state,
          context,
          'qualification.confirmed',
          'qualification',
          context.workspaceId
        );
        return {};
      }
      case 'add_asset': {
        if (!command.asset.objectKey.startsWith(`${context.workspaceId}/`)) {
          throw new DomainError(
            'NOT_FOUND',
            'Asset object was not found.',
            404
          );
        }
        const existing = state.assets.find(
          (item) => item.objectKey === command.asset.objectKey
        );
        if (existing) {
          applyRegisteredAssetFacts(existing, command.asset);
          audit(state, context, 'asset.metadata_updated', 'asset', existing.id);
          return {};
        }
        const isMinor = command.asset.minorStatus === 'minor';
        const asset: Asset = {
          ...command.asset,
          aigcStatus:
            command.asset.sourceType === 'ai_generated'
              ? 'ai_generated'
              : 'not_ai',
          authorizationStatus: isMinor ? 'blocked' : 'pending',
          replacementRequired: false,
          createdAt: now(),
        };
        state.assets.push(asset);
        audit(state, context, 'asset.created', 'asset', asset.id);
        return {};
      }
      case 'authorize_asset': {
        const asset = state.assets.find((item) => item.id === command.assetId);
        if (!asset)
          throw new DomainError('NOT_FOUND', 'Asset was not found.', 404);
        if (
          asset.minorStatus === 'minor' &&
          command.consentScope !== 'internal_only'
        ) {
          throw new DomainError(
            'MINOR_PUBLIC_USE_BLOCKED',
            'Minor-involved assets cannot be used in public marketing.'
          );
        }
        const evidenceRequired =
          asset.sourceType === 'real' &&
          command.consentScope !== 'internal_only';
        const rightsEvidence =
          command.rightsEvidence?.trim() || asset.rightsEvidence?.trim();
        if (evidenceRequired && !rightsEvidence) {
          throw new DomainError(
            'RIGHTS_EVIDENCE_REQUIRED',
            'Public use of real assets requires authorization evidence.',
            422
          );
        }
        const restrictedPublicUse =
          command.consentScope !== 'internal_only' &&
          isRestrictedProductAsset(asset);
        const rightsDetails = {
          ...asset,
          rightsNoFixedExpiry: command.rightsNoFixedExpiry,
          rightsPlatforms: command.rightsPlatforms,
          rightsValidUntil: command.rightsValidUntil,
        };
        if (
          restrictedPublicUse &&
          (!command.rightsPlatforms?.length ||
            (command.rightsNoFixedExpiry !== true &&
              !command.rightsValidUntil) ||
            (command.rightsNoFixedExpiry === true &&
              Boolean(command.rightsValidUntil)))
        ) {
          throw new DomainError(
            'RIGHTS_AUTHORIZATION_DETAILS_REQUIRED',
            'Restricted public assets require platforms and either an expiry or an explicit no-expiry grant.',
            422
          );
        }
        if (
          restrictedPublicUse &&
          !hasCurrentRestrictedAssetAuthorization(rightsDetails, new Date())
        ) {
          throw new DomainError(
            'RIGHTS_AUTHORIZATION_EXPIRED',
            'The restricted asset authorization has expired or is invalid.',
            422
          );
        }
        asset.consentScope = command.consentScope;
        asset.rightsEvidence = rightsEvidence;
        asset.rightsPlatforms = command.rightsPlatforms
          ? [...command.rightsPlatforms]
          : undefined;
        asset.rightsValidUntil = command.rightsValidUntil;
        asset.rightsNoFixedExpiry = command.rightsNoFixedExpiry;
        asset.rightsAuthorizedAt =
          command.consentScope === 'internal_only' ? undefined : now();
        asset.authorizationStatus =
          command.consentScope === 'internal_only' ? 'pending' : 'authorized';
        audit(state, context, 'asset.authorized', 'asset', asset.id, {
          scope: command.consentScope,
          evidenceRecorded: Boolean(rightsEvidence),
          platforms: asset.rightsPlatforms,
          validUntil: asset.rightsValidUntil,
          noFixedExpiry: asset.rightsNoFixedExpiry,
        });
        return {};
      }
      case 'update_asset_metadata': {
        const asset = state.assets.find((item) => item.id === command.assetId);
        if (!asset)
          throw new DomainError('NOT_FOUND', 'Asset was not found.', 404);
        asset.category = command.category;
        asset.tags = [...command.tags];
        asset.rightsOwner = command.rightsOwner;
        asset.containsPerson = command.containsPerson;
        asset.containsSensitiveData = command.containsSensitiveData;
        asset.minorStatus = command.minorStatus;
        if (command.minorStatus === 'minor') {
          asset.consentScope = 'internal_only';
          asset.authorizationStatus = 'blocked';
        } else if (
          asset.authorizationStatus === 'authorized' &&
          (!asset.rightsEvidence?.trim() ||
            !hasCurrentRestrictedAssetAuthorization(asset, new Date()))
        ) {
          asset.authorizationStatus = 'pending';
        } else if (asset.authorizationStatus === 'blocked') {
          asset.authorizationStatus = 'pending';
        }
        audit(state, context, 'asset.metadata_updated', 'asset', asset.id);
        return {};
      }
      case 'withdraw_asset': {
        const asset = state.assets.find((item) => item.id === command.assetId);
        if (!asset)
          throw new DomainError('NOT_FOUND', 'Asset was not found.', 404);
        if (asset.authorizationStatus === 'withdrawn') return {};
        asset.authorizationStatus = 'withdrawn';
        asset.replacementRequired = state.contents.some((content) =>
          content.assetIds.includes(asset.id)
        );
        audit(state, context, 'asset.consent_withdrawn', 'asset', asset.id);
        return {};
      }
      case 'check_content': {
        audit(
          state,
          context,
          'content.creation_check_skipped',
          'workspace',
          context.workspaceId,
          { policy: 'publication_only' }
        );
        return {};
      }
      case 'generate_copy': {
        throw new DomainError(
          'INTERNAL_ERROR',
          'Copy generation must use the short-transaction execution path.',
          500
        );
      }
      case 'select_content': {
        const content = findContent(state, command.contentId);
        if (content.selected) return { contentId: content.id };
        content.selected = true;
        content.status = 'draft';
        state.operationalEvidence.adoptedContentCount += 1;
        audit(state, context, 'content.selected', 'content', content.id);
        return { contentId: content.id };
      }
      case 'create_douyin_variant': {
        const content = findContent(state, command.contentId);
        if (content.variants.some((item) => item.platform === 'douyin')) {
          throw new DomainError(
            'VARIANT_ALREADY_EXISTS',
            'This content already has a Douyin variant.',
            409
          );
        }
        const source = currentVersion(content).version;
        const version: ContentVersion = {
          ...source,
          id: randomUUID(),
          title: `${source.title}｜${command.durationSeconds} 秒口播`,
          body: `${source.title}。${source.body} ${source.conversionHook}。`,
          createdAt: now(),
        };
        content.variants.push({
          id: randomUUID(),
          platform: 'douyin',
          durationSeconds: command.durationSeconds,
          versions: [version],
          currentVersionId: version.id,
          aiDefaultVersionId: version.id,
        });
        audit(
          state,
          context,
          'content.variant_created',
          'content',
          content.id,
          { platform: 'douyin' }
        );
        return { contentId: content.id };
      }
      case 'quick_edit': {
        const content = findContent(state, command.contentId);
        const { variant, version } = currentVersion(content);
        const labels = {
          conversational: '语气更像熟客交流',
          professional: '补充专业项目说明',
          weaker_advertising: '弱化广告表达',
          local_positioning: `加入${state.store?.city ?? '同城'}到店信息`,
        };
        const edited: ContentVersion = {
          ...version,
          id: randomUUID(),
          source: 'merchant',
          body: `${version.body}\n${labels[command.instruction]}。`,
          createdAt: now(),
        };
        variant.versions.push(edited);
        variant.currentVersionId = edited.id;
        audit(
          state,
          context,
          'content.version_created',
          'content',
          content.id,
          { instruction: command.instruction }
        );
        return { contentId: content.id };
      }
      case 'undo_edit': {
        const content = findContent(state, command.contentId);
        const { variant } = currentVersion(content, command.platform);
        const index = variant.versions.findIndex(
          (item) => item.id === variant.currentVersionId
        );
        const previous = variant.versions[index - 1];
        if (previous) variant.currentVersionId = previous.id;
        audit(state, context, 'content.version_undone', 'content', content.id);
        return { contentId: content.id };
      }
      case 'revert_to_ai': {
        const content = findContent(state, command.contentId);
        const { variant } = currentVersion(content, command.platform);
        variant.currentVersionId = variant.aiDefaultVersionId;
        audit(
          state,
          context,
          'content.version_reverted',
          'content',
          content.id
        );
        return { contentId: content.id };
      }
      case 'create_weekly_set': {
        const source = findContent(state, command.contentId);
        const existing = state.auditEvents.find(
          (event) =>
            event.action === 'content.weekly_set_created' &&
            event.entityId === source.id
        );
        const existingIds = existing?.details?.candidateIds;
        if (
          Array.isArray(existingIds) &&
          existingIds.every((id) => typeof id === 'string')
        ) {
          return { candidateIds: existingIds as string[] };
        }
        const { version } = currentVersion(source);
        const weeklyAngles = ['项目细节', '到店准备', '日常护理'];
        const cards = Array.from({ length: 3 }, (_, index) => {
          const cardVersion = {
            ...version,
            id: randomUUID(),
            title: `${weeklyAngles[index]}｜${version.title}`,
            body: `${version.body}\n本周主题：${weeklyAngles[index]}。`,
            createdAt: now(),
          };
          return {
            ...source,
            id: randomUUID(),
            status: 'draft' as const,
            variants: [
              {
                ...source.variants[0]!,
                id: randomUUID(),
                versions: [cardVersion],
                currentVersionId: cardVersion.id,
                aiDefaultVersionId: cardVersion.id,
              },
            ],
            complianceStatus: 'clear' as const,
            warning: undefined,
            createdAt: now(),
          };
        });
        this.ledger.chargeImmediate(state, context, 'content', 1);
        state.contents.push(...cards);
        state.operationalEvidence.weeklyCardCount += cards.length;
        audit(
          state,
          context,
          'content.weekly_set_created',
          'content_batch',
          source.id,
          {
            count: cards.length,
            candidateIds: cards.map((item) => item.id),
          }
        );
        return { candidateIds: cards.map((item) => item.id) };
      }
      case 'remix_content': {
        const source = findContent(state, command.contentId);
        const clone = structuredClone(source);
        clone.id = randomUUID();
        clone.status = 'draft';
        clone.selected = true;
        clone.createdAt = now();
        clone.variants = clone.variants.map((variant) => {
          const versions = variant.versions.map((version) => ({
            ...version,
            id: randomUUID(),
            createdAt: now(),
          }));
          const currentIndex = variant.versions.findIndex(
            (item) => item.id === variant.currentVersionId
          );
          const aiIndex = variant.versions.findIndex(
            (item) => item.id === variant.aiDefaultVersionId
          );
          return {
            ...variant,
            id: randomUUID(),
            versions,
            currentVersionId: versions[currentIndex]?.id ?? versions[0]!.id,
            aiDefaultVersionId: versions[aiIndex]?.id ?? versions[0]!.id,
          };
        });
        clone.complianceStatus = 'clear';
        clone.warning = undefined;
        state.contents.push(clone);
        audit(state, context, 'content.remixed', 'content', clone.id, {
          sourceId: source.id,
        });
        return { contentId: clone.id };
      }
      case 'abandon_content': {
        const content = findContent(state, command.contentId);
        if (content.status === 'published') {
          throw new DomainError(
            'PUBLISHED_CONTENT_IMMUTABLE',
            'Published content cannot be abandoned.',
            409
          );
        }
        if (content.status === 'abandoned') {
          return { contentId: content.id };
        }
        content.status = 'abandoned';
        content.selected = false;
        content.abandonedAt = now();
        audit(state, context, 'content.abandoned', 'content', content.id);
        return { contentId: content.id };
      }
      case 'create_storyboard': {
        const content = findContent(state, command.contentId);
        const assetId = content.assetIds[0];
        if (!assetId)
          throw new DomainError(
            'ASSET_REQUIRED',
            'A source asset is required.'
          );
        const asset = state.assets.find((item) => item.id === assetId);
        if (!asset)
          throw new DomainError(
            'NOT_FOUND',
            'Source asset was not found.',
            404
          );
        const shots: Storyboard['shots'] = [
          [
            'attention',
            '探店钩子',
            '近景展示光泽变化',
            '先看阴天里的透亮感',
            3,
          ],
          [
            'interest',
            '痛点共鸣',
            '自然光下展示手部日常状态',
            '不靠夸张滤镜也能显白',
            4,
          ],
          [
            'desire',
            '项目细节',
            '技师操作与猫眼纹理特写',
            '根据手型调整光带方向',
            5,
          ],
          [
            'action',
            '到店引导',
            '门店环境与预约信息',
            '提前沟通风格后再预约',
            3,
          ],
        ].map(
          ([stage, purpose, visualDirection, narration, durationSeconds]) => {
            return {
              id: randomUUID(),
              stage: stage as Storyboard['shots'][number]['stage'],
              purpose: String(purpose),
              visualDirection: String(visualDirection),
              sourceAssetId: assetId,
              narration: String(narration),
              durationSeconds: Number(durationSeconds),
              complianceStatus: 'clear',
            };
          }
        );
        const storyboard: Storyboard = {
          id: randomUUID(),
          contentId: content.id,
          version: 1,
          status: 'draft',
          shots,
        };
        state.storyboards.push(storyboard);
        audit(
          state,
          context,
          'storyboard.created',
          'storyboard',
          storyboard.id
        );
        return { storyboardId: storyboard.id };
      }
      case 'replace_storyboard_shot': {
        const storyboard = state.storyboards.find(
          (item) => item.id === command.storyboardId
        );
        const shot = storyboard?.shots.find(
          (item) => item.id === command.shotId
        );
        if (!storyboard || !shot)
          throw new DomainError(
            'NOT_FOUND',
            'Storyboard shot was not found.',
            404
          );
        if (storyboard.status === 'confirmed') {
          throw new DomainError(
            'STORYBOARD_ALREADY_CONFIRMED',
            'Confirmed storyboards cannot be edited.',
            409
          );
        }
        shot.visualDirection = command.visualDirection;
        shot.complianceStatus = 'clear';
        storyboard.version += 1;
        audit(
          state,
          context,
          'storyboard.shot_replaced',
          'storyboard',
          storyboard.id,
          { shotId: shot.id }
        );
        return { storyboardId: storyboard.id };
      }
      case 'confirm_storyboard': {
        const storyboard = state.storyboards.find(
          (item) => item.id === command.storyboardId
        );
        if (!storyboard)
          throw new DomainError('NOT_FOUND', 'Storyboard was not found.', 404);
        if (storyboard.status === 'confirmed') {
          return { storyboardId: storyboard.id };
        }
        storyboard.status = 'confirmed';
        storyboard.confirmedAt = now();
        audit(
          state,
          context,
          'storyboard.confirmed',
          'storyboard',
          storyboard.id
        );
        return { storyboardId: storyboard.id };
      }
      case 'claim_video': {
        const job = findJob(state, command.jobId);
        if (job.status !== 'queued' && job.status !== 'running') {
          throw new DomainError(
            'VIDEO_NOT_CLAIMABLE',
            'Only queued or running video tasks can be claimed.',
            409
          );
        }
        if (hasActiveLease(job) && job.leaseOwner !== command.workerId) {
          throw new DomainError(
            'VIDEO_LEASE_HELD',
            'Another worker still owns this task lease.',
            409
          );
        }
        job.leaseOwner = command.workerId;
        job.leaseExpiresAt = new Date(
          Date.now() + command.leaseSeconds * 1000
        ).toISOString();
        job.updatedAt = now();
        audit(state, context, 'video.lease_claimed', 'video_job', job.id, {
          workerId: command.workerId,
        });
        return { jobId: job.id };
      }
      case 'heartbeat_video': {
        const job = findJob(state, command.jobId);
        if (job.leaseOwner !== command.workerId || !hasActiveLease(job)) {
          throw new DomainError(
            'VIDEO_LEASE_NOT_OWNED',
            'This worker does not own the task lease.',
            409
          );
        }
        job.leaseExpiresAt = new Date(
          Date.now() + command.leaseSeconds * 1000
        ).toISOString();
        job.updatedAt = now();
        audit(state, context, 'video.lease_renewed', 'video_job', job.id, {
          workerId: command.workerId,
        });
        return { jobId: job.id };
      }
      case 'transition_video': {
        const job = findJob(state, command.jobId);
        const terminalStatuses = new Set<VideoJob['status']>([
          'completed',
          'cancelled',
          'failed',
        ]);
        if (terminalStatuses.has(job.status)) {
          if (job.status === command.nextStatus) return { jobId: job.id };
          throw new DomainError(
            'VIDEO_ALREADY_TERMINAL',
            'A terminal video task cannot change status.',
            409
          );
        }
        if (
          job.status !== 'queued' &&
          job.status !== 'running' &&
          job.status !== 'needs_action'
        ) {
          throw new DomainError(
            'VIDEO_ALREADY_TERMINAL',
            'A terminal video task cannot change status.',
            409
          );
        }
        if (job.status === command.nextStatus) return { jobId: job.id };
        const allowedTransitions: Record<
          'queued' | 'running' | 'needs_action',
          VideoJob['status'][]
        > = {
          queued: ['running', 'cancelled', 'failed'],
          running: ['needs_action', 'cancelled', 'failed'],
          needs_action: ['running', 'cancelled', 'failed'],
        };
        if (!allowedTransitions[job.status].includes(command.nextStatus)) {
          throw new DomainError(
            'VIDEO_STATE_TRANSITION_INVALID',
            `Video task cannot transition from ${job.status} to ${command.nextStatus}.`,
            409
          );
        }
        if (job.leaseOwner !== command.workerId || !hasActiveLease(job)) {
          throw new DomainError(
            'VIDEO_LEASE_NOT_OWNED',
            'This worker does not own the task lease.',
            409
          );
        }
        if (command.nextStatus === 'completed') {
          throw new DomainError(
            'ARTIFACT_REQUIRED',
            'A video task can complete only through verified render and storage evidence.',
            409
          );
        }
        job.status = command.nextStatus;
        job.failureReason = command.reason;
        job.step = {
          queued: '等待处理',
          running: '正在生成并筛选视频片段',
          needs_action: '需要你确认新的生成约束',
          completed: '视频已完成',
          cancelled: '任务已取消',
          failed: '技术处理失败',
        }[command.nextStatus];
        job.updatedAt = now();
        if (
          command.nextStatus === 'running' &&
          !job.committedSteps.includes('rendering_started')
        ) {
          job.committedSteps.push('rendering_started');
        }
        if (
          command.nextStatus === 'failed' ||
          command.nextStatus === 'cancelled'
        ) {
          const released =
            command.reason === 'reservation_expired'
              ? this.ledger.release(
                  state,
                  context,
                  'video',
                  job.reservationId,
                  'expired'
                )
              : this.ledger.refund(state, context, 'video', job.reservationId);
          if (released) {
            state.operationalEvidence.videoRefundCount += 1;
          }
          if (command.nextStatus === 'failed') {
            state.operationalEvidence.videoProviderFailureCount += 1;
          }
        }
        syncVideoTracking(state, job);
        audit(
          state,
          context,
          `video.${command.nextStatus}`,
          'video_job',
          job.id,
          { reason: command.reason }
        );
        return { jobId: job.id };
      }
      case 'resume_video': {
        const job = findJob(state, command.jobId);
        if (job.status !== 'needs_action')
          throw new DomainError(
            'VIDEO_NOT_WAITING',
            'This task is not waiting for input.'
          );
        job.status = 'running';
        job.constraint = command.constraint;
        job.step = '已按新约束恢复，不重复已完成步骤';
        job.updatedAt = now();
        syncVideoTracking(state, job);
        audit(state, context, 'video.resumed', 'video_job', job.id);
        return { jobId: job.id };
      }
      case 'record_video_render': {
        const job = findJob(state, command.jobId);
        if (
          job.status !== 'running' ||
          job.leaseOwner !== command.workerId ||
          !hasActiveLease(job)
        ) {
          throw new DomainError(
            'VIDEO_LEASE_NOT_OWNED',
            'The render evidence must come from the active task worker.',
            409
          );
        }
        const storyboard = state.storyboards.find(
          (item) => item.id === job.storyboardId
        );
        const sourceAsset = state.assets.find(
          (asset) => asset.id === command.evidence.sourceAssetId
        );
        if (
          !storyboard ||
          !sourceAsset ||
          !storyboard.shots.some(
            (shot) => shot.sourceAssetId === sourceAsset.id
          )
        ) {
          throw new DomainError(
            'NOT_FOUND',
            'Render evidence must reference an existing storyboard asset.',
            404
          );
        }
        const metadataInvalid =
          command.evidence.implicitMetadata &&
          (command.evidence.implicitMetadata.contentType !== 'ai_generated' ||
            command.evidence.implicitMetadata.contentId !== job.id);
        if (
          command.evidence.fileSizeBytes <= 0 ||
          !/^[a-f0-9]{64}$/i.test(command.evidence.fileSha256) ||
          command.evidence.aspectRatio !== '9:16' ||
          command.evidence.durationSeconds <= 0 ||
          metadataInvalid
        ) {
          throw new DomainError(
            'RENDER_EVIDENCE_INVALID',
            'The worker render evidence did not pass technical file validation.',
            422
          );
        }
        const evidence = {
          ...command.evidence,
          id: randomUUID(),
          jobId: job.id,
          correlationId: context.correlationId,
          workerId: command.workerId,
          createdAt: now(),
        };
        state.videoRenderEvidence.push(evidence);
        if (!job.committedSteps.includes('render_validated')) {
          job.committedSteps.push('render_validated');
        }
        job.updatedAt = now();
        state.operationalEvidence.videoAttemptCount += 1;
        state.operationalEvidence.videoTechnicalSuccessCount += 1;
        state.operationalEvidence.videoLatencyTotalMs += evidence.latencyMs;
        state.operationalEvidence.videoProviderCostCents +=
          evidence.providerCostCents;
        if (evidence.usableQuality.usable) {
          state.operationalEvidence.videoUsableQualityCount += 1;
        }
        audit(
          state,
          context,
          'video.render_validated',
          'video_render_evidence',
          evidence.id,
          {
            jobId: job.id,
            provider: evidence.provider,
            model: evidence.model,
            latencyMs: evidence.latencyMs,
            providerCostCents: evidence.providerCostCents,
            fileSha256: evidence.fileSha256,
          }
        );
        return { jobId: job.id, renderEvidenceId: evidence.id };
      }
      case 'complete_video': {
        const job = findJob(state, command.jobId);
        if (job.status !== 'running') {
          throw new DomainError(
            'VIDEO_NOT_RUNNING',
            'Only a running task can accept a stored artifact.',
            409
          );
        }
        const evidence = state.videoRenderEvidence.find(
          (item) => item.id === command.renderEvidenceId
        );
        const evidenceAlreadyUsed = state.videoArtifacts.some(
          (item) => item.renderEvidenceId === command.renderEvidenceId
        );
        if (!evidence || evidence.jobId !== job.id || evidenceAlreadyUsed) {
          throw new DomainError(
            'RENDER_EVIDENCE_INVALID',
            'A completed artifact requires unused technical render evidence.',
            422
          );
        }
        if (
          !command.storage.objectKey.startsWith(
            `${context.workspaceId}/videos/`
          ) ||
          command.storage.contentType !== 'video/mp4' ||
          !command.storage.storageEtag ||
          command.storage.fileSizeBytes !== evidence.fileSizeBytes ||
          command.storage.fileSha256 !== evidence.fileSha256 ||
          !command.storage.storageVerifiedAt
        ) {
          throw new DomainError(
            'STORAGE_EVIDENCE_INVALID',
            'The stored file receipt does not match the validated render.',
            422
          );
        }
        const storageMb = Math.ceil(command.storage.fileSizeBytes / 1_048_576);
        const governedStorageMb = this.options.legacyBillingReadOnly
          ? (await this.options.storageEntitlements?.resolve(
              context.workspaceId
            ))?.storageMb ?? this.planConfig.trial.storageMb
          : null;
        const storedStorageMb = state.videoArtifacts.reduce(
          (total, item) =>
            total + Math.ceil(item.fileSizeBytes / 1_048_576),
          0
        );
        if (
          (this.options.legacyBillingReadOnly
            ? storedStorageMb + storageMb > governedStorageMb!
            : state.entitlement.storageMb.remaining < storageMb)
        ) {
          throw new DomainError(
            'STORAGE_QUOTA_EXHAUSTED',
            'Storage allowance is exhausted. Remove files or change plan.',
            402,
            { resource: 'storage', requiredMb: storageMb }
          );
        }
        const artifact = {
          ...command.storage,
          id: randomUUID(),
          jobId: job.id,
          renderEvidenceId: evidence.id,
          correlationId: context.correlationId,
          reservationId: job.reservationId,
          storyboardVersion:
            state.storyboards.find((item) => item.id === job.storyboardId)
              ?.version ?? 1,
          provider: evidence.provider,
          model: evidence.model,
          durationSeconds: evidence.durationSeconds,
          aspectRatio: evidence.aspectRatio,
          visibleLabel: evidence.visibleLabel === '内容由 AI 生成',
          implicitMetadata: Boolean(evidence.implicitMetadata),
          compliancePassed: evidence.compliancePassed === true,
          complianceResultId: evidence.complianceResultId,
          providerCostCents: evidence.providerCostCents,
          status: 'completed' as const,
          createdAt: now(),
        };
        state.videoArtifacts.push(artifact);
        this.ledger.consumeStorage(
          state,
          context,
          storageMb,
          'Verified video artifact storage'
        );
        this.ledger.commit(state, context, 'video', job.reservationId);
        state.operationalEvidence.videoOutputCount += 1;
        if (artifact.visibleLabel && artifact.implicitMetadata) {
          state.operationalEvidence.labeledVideoCount += 1;
        }
        job.status = 'completed';
        job.step = '视频已完成，可预览或加入发布包';
        job.updatedAt = now();
        if (!job.committedSteps.includes('artifact_stored')) {
          job.committedSteps.push('artifact_stored');
        }
        syncVideoTracking(state, job);
        const storyboard = state.storyboards.find(
          (item) => item.id === job.storyboardId
        );
        const content = storyboard
          ? findContent(state, storyboard.contentId)
          : undefined;
        if (content) content.artifactId = artifact.id;
        audit(
          state,
          context,
          'video.completed',
          'video_artifact',
          artifact.id,
          {
            jobId: job.id,
            providerCostCents: artifact.providerCostCents,
            notification: 'connection_bridge',
          }
        );
        return { artifactId: artifact.id, jobId: job.id };
      }
      case 'cancel_video': {
        const job = findJob(state, command.jobId);
        if (
          job.status === 'completed' ||
          job.status === 'cancelled' ||
          job.status === 'failed'
        ) {
          return { jobId: job.id };
        }
        job.status = 'cancelled';
        job.step = '任务已取消';
        job.updatedAt = now();
        if (this.ledger.refund(state, context, 'video', job.reservationId)) {
          state.operationalEvidence.videoRefundCount += 1;
        }
        syncVideoTracking(state, job);
        audit(state, context, 'video.cancelled', 'video_job', job.id);
        return { jobId: job.id };
      }
      case 'display_preflight': {
        const content = findContent(state, command.contentId);
        const { version } = currentVersion(content);
        // D-C3: medical qualification is a regulated-category requirement, and
        // `state.store.regulated` is the flag that carries it — the same gate
        // `request_handoff` below already uses. Telling a 美甲 store it is
        // 缺少机构执业许可证 named a document it must never hold.
        const regulated = Boolean(state.store?.regulated);
        const warnings = [
          regulated && !state.qualification?.institutionLicense
            ? '缺少机构执业许可证'
            : '',
          regulated && !state.qualification?.treatmentScope
            ? '缺少诊疗范围'
            : '',
          regulated && !state.qualification?.advertisingCertificate
            ? '缺少医疗广告审查证明'
            : '',
          '发布前核对平台类目规则',
          content.assetIds.some(
            (id) =>
              state.assets.find((asset) => asset.id === id)
                ?.authorizationStatus !== 'authorized'
          )
            ? '素材授权需要复核'
            : '',
        ].filter(Boolean);
        const event = {
          id: randomUUID(),
          contentId: content.id,
          contentVersionId: version.id,
          trigger: command.trigger,
          qualificationSnapshot: state.qualification
            ? structuredClone(state.qualification)
            : null,
          warnings,
          createdAt: now(),
        };
        state.preflightEvents.push(event);
        audit(
          state,
          context,
          'regulated.preflight_displayed',
          'content',
          content.id,
          { eventId: event.id, trigger: command.trigger }
        );
        return { contentId: content.id };
      }
      case 'confirm_responsibility': {
        const content = findContent(state, command.contentId);
        const { version } = currentVersion(content);
        const existing = state.responsibilityConfirmations.some(
          (item) =>
            item.contentVersionId === version.id &&
            item.userId === context.userId
        );
        if (!existing) {
          state.responsibilityConfirmations.push({
            id: randomUUID(),
            contentId: content.id,
            contentVersionId: version.id,
            userId: context.userId,
            statement:
              '我已审阅本版本，内容由本店负责，并将在发布前完成资质与平台规则核对。',
            createdAt: now(),
          });
        }
        audit(
          state,
          context,
          'regulated.responsibility_confirmed',
          'content',
          content.id,
          { contentVersionId: version.id }
        );
        return { contentId: content.id };
      }
      case 'create_handoff': {
        const content = findContent(state, command.contentId);
        if (!content.selected) {
          throw new DomainError(
            'CONTENT_NOT_ACCEPTED',
            'Only an accepted Content version can enter publication handoff.',
            409
          );
        }
        const { version } = currentVersion(content, command.platform);
        const compliance = this.checkSafety(
          state,
          context,
          `${version.title} ${version.body} ${version.topics.join(' ')} ${version.conversionHook}`,
          'publication',
          'content',
          content.id
        );
        content.complianceStatus =
          compliance.status === 'warning' ? 'warning' : 'clear';
        content.warning = compliance.guidance?.replacement;
        const artifact = command.artifactId
          ? state.videoArtifacts.find((item) => item.id === command.artifactId)
          : undefined;
        if (command.artifactId && !artifact) {
          throw new DomainError(
            'NOT_FOUND',
            'Publishing artifact was not found.',
            404
          );
        }
        const assetsAuthorized = content.assetIds.every(
          (id) =>
            state.assets.find((asset) => asset.id === id)
              ?.authorizationStatus === 'authorized'
        );
        const projectConfirmed = state.store?.projects.some(
          (project) => project.id === content.projectId && project.confirmed
        );
        if (
          !compliance ||
          compliance.status === 'blocked' ||
          !assetsAuthorized ||
          !projectConfirmed
        ) {
          throw new DomainError(
            'HANDOFF_PREFLIGHT_FAILED',
            'The package requires current content, asset, price, and publication review evidence.',
            409
          );
        }
        if (state.store?.regulated) {
          const displayed = state.preflightEvents.some(
            (event) =>
              event.contentVersionId === version.id &&
              event.trigger === 'handoff'
          );
          const confirmed = state.responsibilityConfirmations.some(
            (item) => item.contentVersionId === version.id
          );
          if (!displayed || !confirmed) {
            throw new DomainError(
              'REGULATED_CONFIRMATION_REQUIRED',
              'Display the current Preflight and record store responsibility before handoff.'
            );
          }
        }
        const existing = state.handoffPackages.find(
          (item) =>
            item.contentId === content.id &&
            item.contentVersionId === version.id &&
            item.platform === command.platform &&
            item.artifactId === artifact?.id
        );
        if (existing) {
          if (
            existing.status === 'ready' &&
            new Date(existing.expiresAt).getTime() <= Date.now()
          ) {
            existing.token = randomUUID().replaceAll('-', '');
            existing.expiresAt = new Date(
              Date.now() + 15 * 60_000
            ).toISOString();
            existing.exportEvents.push({
              id: randomUUID(),
              type: 'package_created',
              userId: context.userId,
              createdAt: now(),
            });
            audit(
              state,
              context,
              'handoff.reissued',
              'handoff_package',
              existing.id,
              { contentVersionId: version.id }
            );
          }
          return {
            packageId: existing.id,
            handoffToken: existing.token,
          };
        }
        this.ledger.chargeImmediate(state, context, 'package', 1);
        const handoff: HandoffPackage = {
          id: randomUUID(),
          contentId: content.id,
          artifactId: artifact?.id,
          assetIds: [...content.assetIds],
          platform: command.platform,
          version: 1,
          contentVersionId: version.id,
          operatorUserId: context.userId,
          accountNickname:
            state.store?.accounts.find(
              (account) => account.platform === command.platform
            )?.nickname ?? '未配置账号',
          route: 'L3_HANDOFF_PACKAGE',
          complianceResultId: artifact?.complianceResultId ?? compliance.id,
          status: 'ready',
          title: version.title,
          body: version.body,
          topics: version.topics,
          conversionText: version.conversionHook,
          checklist: [
            '核对价格与门店事实',
            '添加地点与平台话题',
            '人工预览全部媒体',
          ],
          token: randomUUID().replaceAll('-', ''),
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
          createdAt: now(),
          exportEvents: [
            {
              id: randomUUID(),
              type: 'package_created',
              userId: context.userId,
              createdAt: now(),
            },
          ],
          manualReports: [],
        };
        state.handoffPackages.push(handoff);
        state.operationalEvidence.handoffCount += 1;
        audit(
          state,
          context,
          'handoff.created',
          'handoff_package',
          handoff.id,
          { contentVersionId: version.id }
        );
        return { packageId: handoff.id, handoffToken: handoff.token };
      }
      case 'record_handoff_export': {
        const handoff = state.handoffPackages.find(
          (item) => item.id === command.packageId
        );
        if (!handoff) {
          throw new DomainError(
            'NOT_FOUND',
            'Publishing package was not found.',
            404
          );
        }
        if (new Date(handoff.expiresAt).getTime() <= Date.now()) {
          throw new DomainError(
            'HANDOFF_EXPIRED',
            'The publishing handoff has expired.',
            410
          );
        }
        handoff.exportEvents.push({
          id: randomUUID(),
          type: command.event,
          userId: context.userId,
          createdAt: now(),
        });
        audit(
          state,
          context,
          `handoff.${command.event}`,
          'handoff_package',
          handoff.id,
          { contentVersionId: handoff.contentVersionId }
        );
        return { packageId: handoff.id };
      }
      case 'report_handoff_result': {
        const handoff = state.handoffPackages.find(
          (item) => item.id === command.packageId
        );
        if (!handoff) {
          throw new DomainError(
            'NOT_FOUND',
            'Publishing package was not found.',
            404
          );
        }
        if (handoff.status === 'published') {
          if (command.outcome === 'published') {
            return { packageId: handoff.id, contentId: handoff.contentId };
          }
          throw new DomainError(
            'HANDOFF_ALREADY_PUBLISHED',
            'A published handoff cannot be changed to another manual result.',
            409
          );
        }
        if (new Date(handoff.expiresAt).getTime() <= Date.now()) {
          throw new DomainError(
            'HANDOFF_EXPIRED',
            'The publishing handoff has expired.',
            410
          );
        }
        const reportedAt = now();
        handoff.manualReports.push({
          id: randomUUID(),
          outcome: command.outcome,
          ...(command.note?.trim() ? { note: command.note.trim() } : {}),
          ...(command.platformUrl ? { platformUrl: command.platformUrl } : {}),
          userId: context.userId,
          createdAt: reportedAt,
        });
        audit(
          state,
          context,
          `handoff.result_${command.outcome}`,
          'handoff_package',
          handoff.id,
          {
            contentVersionId: handoff.contentVersionId,
            hasPlatformUrl: Boolean(command.platformUrl),
          }
        );
        if (command.outcome !== 'published') {
          return { packageId: handoff.id, contentId: handoff.contentId };
        }
        handoff.status = 'published';
        handoff.platformUrl = command.platformUrl;
        handoff.publishedAt = reportedAt;
        handoff.exportEvents.push({
          id: randomUUID(),
          type: 'published',
          userId: context.userId,
          createdAt: reportedAt,
        });
        findContent(state, handoff.contentId).status = 'published';
        audit(
          state,
          context,
          'content.published',
          'handoff_package',
          handoff.id,
          {
            platformUrl: command.platformUrl,
            platform: handoff.platform,
            accountNickname: handoff.accountNickname,
            contentVersionId: handoff.contentVersionId,
            route: handoff.route,
            complianceResultId: handoff.complianceResultId,
            operatorUserId: context.userId,
            source: 'explicit_manual_report',
          }
        );
        return { packageId: handoff.id, contentId: handoff.contentId };
      }
      case 'mark_published': {
        const handoff = state.handoffPackages.find(
          (item) => item.id === command.packageId
        );
        if (!handoff)
          throw new DomainError(
            'NOT_FOUND',
            'Publishing package was not found.',
            404
          );
        if (handoff.status === 'published') {
          return { packageId: handoff.id, contentId: handoff.contentId };
        }
        if (new Date(handoff.expiresAt).getTime() <= Date.now()) {
          throw new DomainError(
            'HANDOFF_EXPIRED',
            'The publishing handoff has expired.',
            410
          );
        }
        handoff.status = 'published';
        handoff.platformUrl = command.platformUrl;
        handoff.publishedAt = now();
        handoff.manualReports.push({
          id: randomUUID(),
          outcome: 'published',
          ...(command.platformUrl ? { platformUrl: command.platformUrl } : {}),
          userId: context.userId,
          createdAt: handoff.publishedAt,
        });
        handoff.exportEvents.push({
          id: randomUUID(),
          type: 'published',
          userId: context.userId,
          createdAt: handoff.publishedAt,
        });
        findContent(state, handoff.contentId).status = 'published';
        audit(
          state,
          context,
          'content.published',
          'handoff_package',
          handoff.id,
          {
            platformUrl: command.platformUrl,
            platform: handoff.platform,
            accountNickname: handoff.accountNickname,
            contentVersionId: handoff.contentVersionId,
            route: handoff.route,
            complianceResultId: handoff.complianceResultId,
            operatorUserId: context.userId,
          }
        );
        return { packageId: handoff.id, contentId: handoff.contentId };
      }
    }
  }

  private checkSafety(
    state: ProductState,
    context: ProductContext,
    text: string,
    stage: ComplianceResult['stage'],
    subjectType: ComplianceResult['subjectType'],
    subjectId: string
  ) {
    const today = new Date().toISOString().slice(0, 10);
    if (state.enforcement.day !== today) {
      state.enforcement.day = today;
      state.enforcement.dailyAbuse = 0;
      state.enforcement.consecutiveAbuse = 0;
      state.enforcement.suspended = false;
    }
    const hardStop = hardStopTerms.find((term) => text.includes(term));
    if (hardStop) {
      state.enforcement.consecutiveAbuse += 1;
      state.enforcement.dailyAbuse += 1;
      state.enforcement.suspended =
        state.enforcement.consecutiveAbuse >= 3 ||
        state.enforcement.dailyAbuse >= 5;
      const guidance = {
        restriction: '这项请求不能生成或进入发布链路。',
        reason: `内容包含不可绕过的高风险行为：${hardStop}。`,
        replacement: '可以改为基于已确认资质和真实体验的中性项目介绍。',
        action: '返回编辑并采用合规替代表述。',
      };
      const result = recordCompliance(state, context, {
        subjectType,
        subjectId,
        stage,
        status: 'blocked',
        rules: [hardStop],
        guidance,
        provider: 'rules-engine',
        model: 'p0-compliance-v1',
      });
      audit(
        state,
        context,
        'compliance.hard_stopped',
        'compliance_result',
        result.id,
        { term: hardStop, subjectId }
      );
      this.ledger.record(
        state,
        context,
        'content',
        0,
        'failed_no_charge',
        `Safety hard stop: ${hardStop}`
      );
      throw new DomainError(
        'CONTENT_HARD_STOP',
        'This request cannot be generated.',
        422,
        guidance
      );
    }
    state.enforcement.consecutiveAbuse = 0;
    const warning = findWarningTerm(text);
    if (warning) {
      const guidance = {
        restriction: '当前表述需要修改后再进入发布链路。',
        reason: `表述包含无法直接核验的用语：${warning}。`,
        replacement: '改为描述可核验的项目特点和适用场景。',
        action: '审阅替代表述并确认门店事实。',
      };
      const result = recordCompliance(state, context, {
        subjectType,
        subjectId,
        stage,
        status: 'warning',
        rules: [warning],
        guidance,
        provider: 'rules-engine',
        model: 'p0-compliance-v1',
      });
      audit(
        state,
        context,
        'compliance.warning',
        'compliance_result',
        result.id,
        {
          term: warning,
          replacement: '改为描述可核验的项目特点和适用场景',
        }
      );
      return result;
    }
    const result = recordCompliance(state, context, {
      subjectType,
      subjectId,
      stage,
      status: 'pass',
      rules: [],
      provider: 'rules-engine',
      model: 'p0-compliance-v1',
    });
    audit(
      state,
      context,
      'compliance.cleared',
      'compliance_result',
      result.id,
      { subjectId }
    );
    return result;
  }
}
