import { createHash, randomUUID } from 'node:crypto';
import { type DurationEstimate } from '@meiye/contracts';
import { P1DomainError, type P1Context } from '../foundation/domain.js';
import type { P1OperationModule } from '../foundation/ports.js';
import {
  platformDefaultModelConfigKeyForOperation,
  type PlatformDefaultModelSourcePort,
} from '../foundation/workspace-provision.js';
import {
  CatalogRevisionRegistry,
  ModelPreferenceRegistry,
  PRICE_REVISION_PRICING_TIERS,
  createDefaultCatalogModels,
  createDefaultCapabilityRevisions,
  createDefaultDeployments,
  createDefaultExecutionChannels,
  createDefaultPriceRevisions,
  createDefaultProviderProfiles,
  createDefaultRouteRevisions,
  forwardMigratePublishedCatalogPayload,
  type ActivationEvidence,
  type CatalogRevision,
  type CatalogRevisionPayload,
  type PreferenceView,
  type PublishedDeployment,
  type WorkspaceDefaultOrigin,
} from './catalog.js';
import {
  CANVAS_GENERATION_INPUT_ASSET_ROLES,
  CANVAS_GENERATION_PARAMETER_NAMES,
  MODEL_OPERATIONS,
  QUALITY_NORTH_STAR_MIN_SAMPLE_SIZE,
  type CatalogModel,
  type CreditPricing,
  CREDIT_PRICING_OPERATIONS,
  type CreditPricingOperation,
  type DataClass,
  type ModelOperation,
  type ModelDeployment,
  type ModelSupplyApplicationService,
  type ModelSupplyPlanningControlPlanePort,
  type ModelSupplyRouteSimulationInput,
  type ModelSupplyResult,
  type RouteSnapshot,
  type QualityEvent,
  type RequestedSelection,
  type RouteCandidateCostEstimate,
  type RouteSimulationFailureScenario,
  type DurableVideoWorkflow,
  type EditVideoWorkflowInput,
  projectVideoWorkflowPublic,
} from './index.js';
import {
  DURATION_ESTIMATE_WINDOW_DAYS,
  durationEstimateFromSamples,
} from './duration-estimate.js';
import {
  BEAUTY_COPY_EVALUATION_SET_V2,
  BEAUTY_COPY_PROMPT_REVISIONS,
  DEFAULT_BEAUTY_COPY_PROMPT_REVISION,
  buildBeautyEvaluationPrompt,
  evaluateBeautyQualityFixture,
  evaluateBeautyQualityRejectionFixture,
  getBeautyCopyPromptRevision,
  type BeautyQualityEvaluationRun,
  type RevisionRollbackAudit,
} from './quality-evaluation.js';
import {
  collectHealthExcludedDeploymentIds,
  explainPlanDecision,
  planModelSupplyCandidatesWithDataPolicy,
} from '../supply-registry/supply-control-plane.js';
import {
  expandCatalogRevisionPayload,
  LOCAL_FIXTURE_COMMERCIAL_USE_TERMS_SUFFIX,
  type ExpandedSupplyRegistrySnapshot,
} from '../supply-registry/expand.js';
import {
  normalizeSupplyRunQuery,
  type AdminSupplyControlPlane,
  type AdminSupplyGovernedActionDispatchRequest,
  type AdminSupplyGovernedActionRequest,
} from '../supply-registry/admin-control-plane.js';
import type { MerchantExecutionBillingPort } from '../product-billing/durable-service.js';
import type {
  GenerationRuntimePort,
  ModelCatalogAdminPort,
  ModelPreferencePort,
  QualityEvaluationPort,
} from './control-plane-ports.js';

const recordedModels = createDefaultCatalogModels();
const recordedDeploymentIds = createDefaultDeployments().map((deployment) => deployment.id);
const recordedDeployments = createDefaultDeployments({
  activatedDeploymentIds: recordedDeploymentIds,
  activationEvidenceStatus: 'recorded',
});

export const RECORDED_CATALOG_REVISION_ID = 'recorded-default-v1';
const LOCAL_FIXTURE_REGISTRY_REVISION_SUFFIX = ':fixture-live-verified-v1';
export type ModelSupplyJobListStatus =
  | 'succeeded'
  | 'failed'
  | 'accepted'
  | 'acceptance_unknown'
  | 'rejected_before_accept';

export type ModelSupplyJobListModality = 'llm' | 'image' | 'video' | 'audio';

export type ModelSupplyJobListSort =
  | 'startedAt'
  | 'latencyMs'
  | 'status'
  | 'operation'
  | 'costMicros';

export interface ModelSupplyJobListQuery {
  page: number;
  pageSize: number;
  sort: ModelSupplyJobListSort;
  dir: 'asc' | 'desc';
  operation?: ModelOperation;
  status?: ModelSupplyJobListStatus;
  modality?: ModelSupplyJobListModality;
  catalogModelId?: string;
  deploymentId?: string;
  deploymentIds?: string[];
  dataClass?: DataClass | 'public';
  q?: string;
  taskId?: string;
}

export interface ModelSupplyJobListPage {
  items: ModelSupplyResult[];
  total: number;
  page: number;
  pageSize: number;
  facets: {
    operations: ModelOperation[];
    statuses: ModelSupplyJobListStatus[];
    modalities: ModelSupplyJobListModality[];
    dataClasses: Array<DataClass | 'public'>;
  };
}

export interface ModelSupplyControlPlaneRepository {
  saveCatalogRevision(workspaceId: string, revision: CatalogRevision): Promise<void>;
  listCatalogRevisions(workspaceId: string): Promise<CatalogRevision[]>;
  getCurrentPublishedCatalogRevision(workspaceId: string): Promise<CatalogRevision | null>;
  setCurrentPublishedCatalogRevision(
    workspaceId: string,
    revision: CatalogRevision,
    expectedHeadRevisionId: string | null,
  ): Promise<void>;
  clearCurrentPublishedCatalogRevision(
    workspaceId: string,
    expectedRevisionId: string,
  ): Promise<void>;
  applyCatalogRollback(
    workspaceId: string,
    expectedHeadRevisionId: string | null,
    targetRevision: CatalogRevision | null,
    audit: RevisionRollbackAudit,
  ): Promise<void>;
  getCurrentPromptRevision(workspaceId: string): Promise<string | null>;
  applyPromptRollback(
    workspaceId: string,
    expectedHeadRevisionId: string | null,
    targetRevisionId: string,
    audit: RevisionRollbackAudit,
  ): Promise<void>;
  setWorkspaceDefault(
    workspaceId: string,
    operation: ModelOperation,
    modelId: string,
    metadata?: {
      origin: WorkspaceDefaultOrigin;
      platformConfigRevision?: string | null;
    },
  ): Promise<void>;
  setUserDefault(
    workspaceId: string,
    userId: string,
    operation: ModelOperation,
    modelId: string,
  ): Promise<void>;
  setFavorite(
    workspaceId: string,
    userId: string,
    operation: ModelOperation,
    modelId: string,
    favorite: boolean,
  ): Promise<void>;
  recordRecent(
    workspaceId: string,
    userId: string,
    operation: ModelOperation,
    modelId: string,
  ): Promise<void>;
  getPreferences(
    workspaceId: string,
    userId: string,
    operation: ModelOperation,
  ): Promise<PreferenceView>;
  saveResult(workspaceId: string, result: ModelSupplyResult): Promise<void>;
  getJob(workspaceId: string, jobId: string): Promise<ModelSupplyResult | null>;
  listJobs(workspaceId: string): Promise<ModelSupplyResult[]>;
  listJobs(
    workspaceId: string,
    query: ModelSupplyJobListQuery,
  ): Promise<ModelSupplyJobListPage>;
  saveQualityEvent(workspaceId: string, event: QualityEvent): Promise<QualityEvent>;
  listQualityEvents(workspaceId: string): Promise<QualityEvent[]>;
  saveQualityEvaluationRun(
    workspaceId: string,
    run: BeautyQualityEvaluationRun,
  ): Promise<void>;
  getQualityEvaluationRun(
    workspaceId: string,
    runId: string,
  ): Promise<BeautyQualityEvaluationRun | null>;
  listQualityEvaluationRuns(workspaceId: string): Promise<BeautyQualityEvaluationRun[]>;
  listRevisionRollbackAudits(workspaceId: string): Promise<RevisionRollbackAudit[]>;
  saveActivationProbeRun(
    workspaceId: string,
    run: ActivationProbeRun,
  ): Promise<void>;
  getActivationProbeRun(
    workspaceId: string,
    runId: string,
  ): Promise<ActivationProbeRun | null>;
  listActivationProbeRuns(workspaceId: string): Promise<ActivationProbeRun[]>;
}

export interface ActivationProbeRun {
  actorId: string;
  catalogModelId: string;
  configurationRevision: string;
  correlationId: string;
  createdAt: string;
  deploymentId: string;
  failureCategory?: string;
  id: string;
  latencyMs: number;
  operation: ModelOperation;
  outcome: 'passed' | 'failed';
  outputDigest?: string;
  providerCost?: {
    amount: number;
    currency: 'CNY' | 'USD';
    status: 'estimated' | 'observed';
    usage: { inputTokens?: number; outputTokens?: number; mediaUnits?: number };
  };
}

export interface ActivationProbeExecutionPort {
  execute(input: {
    actorId: string;
    catalogModelId: string;
    correlationId: string;
    deploymentId: string;
    idempotencyKey: string;
    operation: ModelOperation;
    workspaceId: string;
  }): Promise<{
    outputDigestSource: unknown;
    providerCost: NonNullable<ActivationProbeRun['providerCost']> & {
      status: 'observed';
    };
  }>;
}

export type {
  ModelSupplyPlanningControlPlanePort,
  ModelSupplyPlanningControlPlaneState,
} from './index.js';

export interface ModelSupplyRegistryPersistencePort {
  getCurrentRegistryRevision(
    workspaceId: string,
  ): Promise<ExpandedSupplyRegistrySnapshot | null>;
  setCurrentRegistryRevision(
    workspaceId: string,
    snapshot: ExpandedSupplyRegistrySnapshot,
    expectedHeadRevisionId: string | null,
  ): Promise<void>;
}

function jobListStatus(result: ModelSupplyResult): ModelSupplyJobListStatus {
  if (result.status === 'completed') return 'succeeded';
  if (result.status === 'failed') return 'failed';
  if (result.attempt.acceptance === 'accepted') return 'accepted';
  if (result.attempt.acceptance === 'acceptance_unknown') {
    return 'acceptance_unknown';
  }
  return 'rejected_before_accept';
}

function jobListModality(
  operation: ModelOperation,
): ModelSupplyJobListModality {
  if (operation.startsWith('image.')) return 'image';
  if (operation.startsWith('video.')) return 'video';
  if (operation.startsWith('audio.')) return 'audio';
  return 'llm';
}

function jobOperation(result: ModelSupplyResult): ModelOperation {
  return result.operation ?? 'copy.generate';
}

function jobMatchesQuery(
  result: ModelSupplyResult,
  query: ModelSupplyJobListQuery,
): boolean {
  const operation = jobOperation(result);
  if (query.operation && operation !== query.operation) return false;
  if (query.status && jobListStatus(result) !== query.status) return false;
  if (query.modality && jobListModality(operation) !== query.modality) {
    return false;
  }
  if (
    query.catalogModelId &&
    result.attempt.catalogModelId !== query.catalogModelId
  ) {
    return false;
  }
  if (query.deploymentId && result.attempt.deploymentId !== query.deploymentId) {
    return false;
  }
  if (
    query.deploymentIds &&
    !query.deploymentIds.includes(result.attempt.deploymentId)
  ) {
    return false;
  }
  if (query.dataClass) {
    if (query.dataClass === 'public' && result.snapshot.dataClass.length > 0) {
      return false;
    }
    if (
      query.dataClass !== 'public' &&
      !result.snapshot.dataClass.includes(query.dataClass)
    ) {
      return false;
    }
  }
  if (query.taskId && result.jobId !== query.taskId) return false;
  if (query.q) {
    const haystack = [
      result.jobId,
      result.attempt.id,
      result.attempt.catalogModelId,
      result.attempt.deploymentId,
      result.failureCode,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(query.q.toLowerCase())) return false;
  }
  return true;
}

function compareJobListResults(
  left: ModelSupplyResult,
  right: ModelSupplyResult,
  query: Pick<ModelSupplyJobListQuery, 'sort' | 'dir'>,
): number {
  const value = (result: ModelSupplyResult): string | number | undefined => {
    switch (query.sort) {
      case 'startedAt':
        return result.attempt.createdAt;
      case 'status':
        return jobListStatus(result);
      case 'operation':
        return jobOperation(result);
      case 'costMicros':
        return result.providerCost.amount * 1_000_000;
      case 'latencyMs':
        return result.latencyMs;
    }
  };
  const leftValue = value(left);
  const rightValue = value(right);
  if (leftValue === undefined && rightValue === undefined) {
    return left.jobId.localeCompare(right.jobId);
  }
  if (leftValue === undefined) return 1;
  if (rightValue === undefined) return -1;
  const compared =
    typeof leftValue === 'number' && typeof rightValue === 'number'
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue));
  if (compared !== 0) return query.dir === 'asc' ? compared : -compared;
  return left.jobId.localeCompare(right.jobId);
}

function jobListPage(
  source: ModelSupplyResult[],
  query: ModelSupplyJobListQuery,
): ModelSupplyJobListPage {
  const filtered = source.filter((result) => jobMatchesQuery(result, query));
  filtered.sort((left, right) => compareJobListResults(left, right, query));
  const start = (query.page - 1) * query.pageSize;
  const uniqueSorted = <T extends string>(values: T[]) =>
    [...new Set(values)].sort((left, right) => left.localeCompare(right));
  return {
    items: filtered
      .slice(start, start + query.pageSize)
      .map((result) => structuredClone(result)),
    total: filtered.length,
    page: query.page,
    pageSize: query.pageSize,
    facets: {
      operations: uniqueSorted(source.map(jobOperation)),
      statuses: uniqueSorted(source.map(jobListStatus)),
      modalities: uniqueSorted(
        source.map((result) => jobListModality(jobOperation(result))),
      ),
      dataClasses: uniqueSorted(
        source.flatMap((result) =>
          result.snapshot.dataClass.length > 0
            ? result.snapshot.dataClass
            : (['public'] as const),
        ),
      ),
    },
  };
}

interface ActivationEvidenceConfigPort {
  apply(input: {
    actorId: string;
    correlationId: string;
    expectedRevision: number | null;
    key: string;
    reason: string;
    scope: 'global';
    value: ActivationEvidence;
    workspaceId: '__global__';
  }): Promise<{ revision: number; value: unknown }>;
  get(
    scope: 'global',
    workspaceId: '__global__',
    key: string,
  ): Promise<{ revision: number; value: unknown } | null>;
}

export class MemoryModelSupplyControlPlaneRepository
  implements ModelSupplyControlPlaneRepository
{
  private readonly revisions = new Map<string, CatalogRevision[]>();
  private readonly publishedHeads = new Map<string, string>();
  private readonly preferences = new ModelPreferenceRegistry();
  private readonly jobs = new Map<string, Map<string, ModelSupplyResult>>();
  private readonly quality = new Map<string, QualityEvent[]>();
  private readonly qualityEvaluations = new Map<string, BeautyQualityEvaluationRun[]>();
  private readonly promptHeads = new Map<string, string>();
  private readonly rollbackAudits = new Map<string, RevisionRollbackAudit[]>();
  private readonly activationProbeRuns = new Map<string, ActivationProbeRun[]>();

  async saveCatalogRevision(workspaceId: string, revision: CatalogRevision) {
    this.saveCatalogRevisionSync(workspaceId, revision);
  }

  private saveCatalogRevisionSync(
    workspaceId: string,
    revision: CatalogRevision,
  ) {
    const existing = this.revisions.get(workspaceId) ?? [];
    if (!existing.some((candidate) => candidate.id === revision.id)) {
      existing.push(structuredClone(revision));
      existing.sort((left, right) => left.number - right.number);
      this.revisions.set(workspaceId, existing);
    }
  }

  async listCatalogRevisions(workspaceId: string) {
    return structuredClone(this.revisions.get(workspaceId) ?? []);
  }

  async getCurrentPublishedCatalogRevision(workspaceId: string) {
    const revisionId = this.publishedHeads.get(workspaceId);
    if (!revisionId) return null;
    const revision = (this.revisions.get(workspaceId) ?? []).find(
      (candidate) => candidate.id === revisionId && candidate.stage === 'published',
    );
    return revision ? structuredClone(revision) : null;
  }

  async setCurrentPublishedCatalogRevision(
    workspaceId: string,
    revision: CatalogRevision,
    expectedHeadRevisionId: string | null,
  ) {
    if (revision.stage !== 'published') {
      throw new Error('Only a published catalog revision can become current.');
    }
    if ((this.publishedHeads.get(workspaceId) ?? null) !== expectedHeadRevisionId) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Catalog head changed before publication could be applied.',
      );
    }
    this.saveCatalogRevisionSync(workspaceId, revision);
    this.publishedHeads.set(workspaceId, revision.id);
  }

  async clearCurrentPublishedCatalogRevision(
    workspaceId: string,
    expectedRevisionId: string,
  ) {
    if (this.publishedHeads.get(workspaceId) === expectedRevisionId) {
      this.publishedHeads.delete(workspaceId);
    }
  }

  async applyCatalogRollback(
    workspaceId: string,
    expectedHeadRevisionId: string | null,
    targetRevision: CatalogRevision | null,
    audit: RevisionRollbackAudit,
  ) {
    const current = this.publishedHeads.get(workspaceId) ?? null;
    if (current !== expectedHeadRevisionId) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Catalog head changed before rollback could be applied.',
      );
    }
    if (targetRevision) {
      this.saveCatalogRevisionSync(workspaceId, targetRevision);
      this.publishedHeads.set(workspaceId, targetRevision.id);
    } else {
      this.publishedHeads.delete(workspaceId);
    }
    this.appendRollbackAudit(workspaceId, audit);
  }

  async getCurrentPromptRevision(workspaceId: string) {
    return this.promptHeads.get(workspaceId) ?? null;
  }

  async applyPromptRollback(
    workspaceId: string,
    expectedHeadRevisionId: string | null,
    targetRevisionId: string,
    audit: RevisionRollbackAudit,
  ) {
    const current = this.promptHeads.get(workspaceId) ?? null;
    if (current !== expectedHeadRevisionId) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Prompt head changed before rollback could be applied.',
      );
    }
    this.promptHeads.set(workspaceId, targetRevisionId);
    this.appendRollbackAudit(workspaceId, audit);
  }

  async setWorkspaceDefault(
    workspaceId: string,
    operation: ModelOperation,
    modelId: string,
    metadata: {
      origin: WorkspaceDefaultOrigin;
      platformConfigRevision?: string | null;
    } = { origin: 'workspace_default' },
  ) {
    this.preferences.setWorkspaceDefault(
      workspaceId,
      operation,
      modelId,
      metadata,
    );
  }

  async setUserDefault(
    workspaceId: string,
    userId: string,
    operation: ModelOperation,
    modelId: string,
  ) {
    this.preferences.setUserDefault(workspaceId, userId, operation, modelId);
  }

  async setFavorite(
    workspaceId: string,
    userId: string,
    operation: ModelOperation,
    modelId: string,
    favorite: boolean,
  ) {
    this.preferences.setFavorite(workspaceId, userId, operation, modelId, favorite);
  }

  async recordRecent(
    workspaceId: string,
    userId: string,
    operation: ModelOperation,
    modelId: string,
  ) {
    this.preferences.recordRecent(workspaceId, userId, operation, modelId);
  }

  async getPreferences(
    workspaceId: string,
    userId: string,
    operation: ModelOperation,
  ) {
    return this.preferences.view(workspaceId, userId, operation);
  }

  async saveResult(workspaceId: string, result: ModelSupplyResult) {
    const jobs = this.jobs.get(workspaceId) ?? new Map<string, ModelSupplyResult>();
    jobs.set(result.jobId, structuredClone(result));
    this.jobs.set(workspaceId, jobs);
  }

  async getJob(workspaceId: string, jobId: string) {
    const result = this.jobs.get(workspaceId)?.get(jobId);
    return result ? structuredClone(result) : null;
  }

  async listJobs(workspaceId: string): Promise<ModelSupplyResult[]>;
  async listJobs(
    workspaceId: string,
    query: ModelSupplyJobListQuery,
  ): Promise<ModelSupplyJobListPage>;
  async listJobs(
    workspaceId: string,
    query?: ModelSupplyJobListQuery,
  ): Promise<ModelSupplyResult[] | ModelSupplyJobListPage> {
    const source = [...(this.jobs.get(workspaceId)?.values() ?? [])];
    if (query) return jobListPage(source, query);
    return source.map((result) => structuredClone(result));
  }

  async saveQualityEvent(workspaceId: string, event: QualityEvent) {
    const stored = {
      ...structuredClone(event),
      id: event.id ?? randomUUID(),
      createdAt: event.createdAt ?? new Date().toISOString(),
    };
    const events = this.quality.get(workspaceId) ?? [];
    if (!events.some((candidate) => candidate.id === stored.id)) {
      events.push(stored);
      this.quality.set(workspaceId, events);
    }
    return structuredClone(stored);
  }

  async listQualityEvents(workspaceId: string) {
    return structuredClone(this.quality.get(workspaceId) ?? []);
  }

  async saveQualityEvaluationRun(
    workspaceId: string,
    run: BeautyQualityEvaluationRun,
  ) {
    const runs = this.qualityEvaluations.get(workspaceId) ?? [];
    if (!runs.some((candidate) => candidate.id === run.id)) {
      runs.push(structuredClone(run));
      this.qualityEvaluations.set(workspaceId, runs);
    }
  }

  async getQualityEvaluationRun(workspaceId: string, runId: string) {
    const run = (this.qualityEvaluations.get(workspaceId) ?? []).find(
      (candidate) => candidate.id === runId,
    );
    return run ? structuredClone(run) : null;
  }

  async listQualityEvaluationRuns(workspaceId: string) {
    return structuredClone(this.qualityEvaluations.get(workspaceId) ?? [])
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async saveActivationProbeRun(workspaceId: string, run: ActivationProbeRun) {
    const runs = this.activationProbeRuns.get(workspaceId) ?? [];
    if (!runs.some((candidate) => candidate.id === run.id)) {
      runs.push(structuredClone(run));
      this.activationProbeRuns.set(workspaceId, runs);
    }
  }

  async getActivationProbeRun(workspaceId: string, runId: string) {
    const run = (this.activationProbeRuns.get(workspaceId) ?? []).find(
      (candidate) => candidate.id === runId,
    );
    return run ? structuredClone(run) : null;
  }

  async listActivationProbeRuns(workspaceId: string) {
    return structuredClone(this.activationProbeRuns.get(workspaceId) ?? []).sort(
      (left, right) => {
        const byCreated = right.createdAt.localeCompare(left.createdAt);
        return byCreated !== 0 ? byCreated : right.id.localeCompare(left.id);
      },
    );
  }

  async listRevisionRollbackAudits(workspaceId: string) {
    return structuredClone(this.rollbackAudits.get(workspaceId) ?? [])
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  private appendRollbackAudit(workspaceId: string, audit: RevisionRollbackAudit) {
    const audits = this.rollbackAudits.get(workspaceId) ?? [];
    if (!audits.some((candidate) => candidate.id === audit.id)) {
      audits.push(structuredClone(audit));
      this.rollbackAudits.set(workspaceId, audits);
    }
  }
}

export interface CatalogModelView {
  id: string;
  displayName: string;
  modality: CatalogModel['modality'];
  manufacturer: string;
  stableModelName: string;
  version: string;
  operations: ModelOperation[];
  capabilities: ModelOperation[];
  qualityRank: number;
  creditPricing?: CreditPricing;
  available?: boolean;
  availability: 'available' | 'recorded' | 'unavailable';
  unavailableReason?: string;
  unitPrice?: {
    amountMicros: number;
    currency: 'CNY' | 'USD';
    unit: string;
    revision: string;
  };
  activationEvidence: ActivationEvidence;
  channelReadiness:
    | 'multi_channel_ready'
    | 'single_channel'
    | 'not_verified';
  dataClasses: {
    allowed: Array<'public' | 'contains_face' | 'pii' | 'medical'>;
    denied: Array<'public' | 'contains_face' | 'pii' | 'medical'>;
  };
  durationEstimate: DurationEstimate;
}

export interface GenerationDurationSamplePort {
  listGenerationDurationSamples(
    workspaceId: string,
    operation: 'copy' | 'image' | 'video' | 'audio',
    catalogModelId: string,
    since: string
  ): Promise<number[]>;
}

export interface CatalogView {
  revisionId: string;
  stage: 'published' | 'recorded';
  operation: ModelOperation;
  models: CatalogModelView[];
}

export interface SafeCatalogModelEdit {
  id: string;
  lifecycle: 'available' | 'recorded' | 'unavailable';
  activationEvidence: ActivationEvidence;
  allowedDataClasses: Array<(typeof allDataClasses)[number]>;
  deniedDataClasses: Array<(typeof allDataClasses)[number]>;
}

interface CatalogFallback {
  revisionId: string;
  payload: CatalogRevisionPayload;
}

function catalogSource(
  revision: CatalogRevision | null,
  fallback?: CatalogFallback,
): {
  revisionId: string;
  stage: CatalogView['stage'];
  payload: CatalogRevisionPayload;
} {
  if (revision) {
    return {
      revisionId: revision.id,
      stage: 'published',
      payload: fallback
        ? forwardMigratePublishedCatalogPayload(
            revision.payload,
            fallback.payload,
          )
        : revision.payload,
    };
  }
  if (fallback) {
    return {
      revisionId: fallback.revisionId,
      stage: 'recorded',
      payload: structuredClone(fallback.payload),
    };
  }
  return {
    revisionId: RECORDED_CATALOG_REVISION_ID,
    stage: 'recorded',
    payload: {
      models: structuredClone(recordedModels),
      deployments: structuredClone(recordedDeployments),
      capabilities: createDefaultCapabilityRevisions(),
      prices: createDefaultPriceRevisions(),
      routes: createDefaultRouteRevisions(),
      providerProfiles: createDefaultProviderProfiles(),
      executionChannels: createDefaultExecutionChannels(),
    },
  };
}

const allDataClasses = [
  'public',
  'contains_face',
  'pii',
  'medical',
] as const;

function durationOperation(
  operation: ModelOperation
): 'copy' | 'image' | 'video' | 'audio' {
  if (operation.startsWith('copy.') || operation === 'text.respond') {
    return 'copy';
  }
  if (operation.startsWith('audio.')) return 'audio';
  if (operation === 'video.generate') return 'video';
  return 'image';
}

function deploymentRank(deployment: PublishedDeployment) {
  if (deployment.status !== 'active') return 0;
  if (deployment.activationEvidence.status === 'live_verified') return 3;
  if (deployment.activationEvidence.status === 'recorded') return 2;
  return 1;
}

function toCatalogModelView(
  model: CatalogModel,
  deployments: PublishedDeployment[],
  allowRecordedExecution = false,
): Omit<CatalogModelView, 'durationEstimate'> {
  const candidates = deployments
    .filter((deployment) => deployment.catalogModelId === model.id)
    .sort((left, right) => deploymentRank(right) - deploymentRank(left));
  const deployment = candidates[0];
  const rank = deployment ? deploymentRank(deployment) : 0;
  const liveCandidates = candidates.filter(
    (candidate) =>
      candidate.status === 'active' &&
      candidate.activationEvidence.status === 'live_verified',
  );
  const identityVerified = liveCandidates.filter(
    (candidate) =>
      Boolean(candidate.accountIdentity?.trim()) &&
      Boolean(candidate.endpointFingerprint?.trim()),
  );
  const accountIdentities = new Set(
    identityVerified.map((candidate) => candidate.accountIdentity!.trim()),
  );
  const endpointFingerprints = new Set(
    identityVerified.map((candidate) => candidate.endpointFingerprint!.trim()),
  );
  const hasOfficialDirect = identityVerified.some(
    (candidate) => candidate.channel === 'direct',
  );
  const hasUpstreamReseller = identityVerified.some(
    (candidate) => candidate.channel === 'managed',
  );
  const multiChannelReady =
    accountIdentities.size >= 2 &&
    endpointFingerprints.size >= 2 &&
    hasOfficialDirect &&
    hasUpstreamReseller;
  const channelReadiness =
    multiChannelReady
      ? ('multi_channel_ready' as const)
      : liveCandidates.length > 0
        ? ('single_channel' as const)
        : ('not_verified' as const);
  const allowed = new Set(deployment?.allowedDataClasses ?? ['public']);
  return {
    id: model.id,
    displayName: model.displayName,
    modality: model.modality,
    manufacturer: model.manufacturer ?? 'Unknown manufacturer',
    stableModelName:
      deployment?.providerModel ?? model.stableModelName ?? model.id,
    version:
      deployment?.endpointRevision ?? model.version ?? 'unspecified',
    operations: [...model.operations],
    capabilities: [...(model.capabilities ?? model.operations)],
    qualityRank: model.qualityRank,
    ...(model.creditPricing
      ? { creditPricing: structuredClone(model.creditPricing) }
      : {}),
    ...(allowRecordedExecution && rank >= 2 ? { available: true } : {}),
    availability: rank === 3 ? 'available' : rank === 2 ? 'recorded' : 'unavailable',
    ...(deployment?.unitPrice && deployment.priceRevision
      ? {
          unitPrice: {
            ...structuredClone(deployment.unitPrice),
            revision: deployment.priceRevision,
          },
        }
      : {}),
    ...(rank < 2
      ? {
          unavailableReason:
            deployment?.unavailableReason ?? 'activation_evidence_missing',
        }
      : {}),
    activationEvidence: structuredClone(
      deployment?.activationEvidence ?? { status: 'documented' },
    ),
    channelReadiness,
    dataClasses: {
      allowed: allDataClasses.filter((value) => allowed.has(value)),
      denied: allDataClasses.filter((value) => !allowed.has(value)),
    },
  };
}

function adminCatalogPayload(payload: CatalogRevisionPayload) {
  return {
    models: payload.models.map((model) => ({
      id: model.id,
      displayName: model.displayName,
      modality: model.modality,
      operations: [...model.operations],
      qualityRank: model.qualityRank,
      ...(model.manufacturer ? { manufacturer: model.manufacturer } : {}),
      ...(model.stableModelName
        ? { stableModelName: model.stableModelName }
        : {}),
      ...(model.version ? { version: model.version } : {}),
      ...(model.capabilities
        ? { capabilities: [...model.capabilities] }
        : {}),
      ...(model.creditPricing
        ? { creditPricing: structuredClone(model.creditPricing) }
        : {}),
    })),
    deployments: payload.deployments.map((deployment) => ({
      id: deployment.id,
      catalogModelId: deployment.catalogModelId,
      apiFamily: deployment.apiFamily,
      channel: deployment.channel,
      region: deployment.region,
      status: deployment.status,
      activationEvidence: structuredClone(deployment.activationEvidence),
      ...(deployment.providerProfileId
        ? { providerProfileId: deployment.providerProfileId }
        : {}),
      ...(deployment.executionChannelId
        ? { executionChannelId: deployment.executionChannelId }
        : {}),
      ...(deployment.providerModel
        ? { providerModel: deployment.providerModel }
        : {}),
      ...(deployment.endpointRevision
        ? { endpointRevision: deployment.endpointRevision }
        : {}),
      ...(deployment.apiCounterparty
        ? { apiCounterparty: deployment.apiCounterparty }
        : {}),
      ...(deployment.credentialOwner
        ? { credentialOwner: deployment.credentialOwner }
        : {}),
      ...(deployment.lifecycleRevision
        ? { lifecycleRevision: deployment.lifecycleRevision }
        : {}),
      ...(deployment.allowedDataClasses
        ? { allowedDataClasses: [...deployment.allowedDataClasses] }
        : {}),
      ...(deployment.policyRevision
        ? { policyRevision: deployment.policyRevision }
        : {}),
      ...(deployment.priceRevision
        ? { priceRevision: deployment.priceRevision }
        : {}),
      ...(deployment.pricingTier
        ? { pricingTier: deployment.pricingTier }
        : {}),
      ...(deployment.credentialMode
        ? { credentialMode: deployment.credentialMode }
        : {}),
      ...(deployment.credentialVersion
        ? { credentialVersion: deployment.credentialVersion }
        : {}),
      ...(deployment.unitPrice
        ? { unitPrice: structuredClone(deployment.unitPrice) }
        : {}),
      ...(deployment.canvasGenerationCapabilities
        ? {
            canvasGenerationCapabilities: structuredClone(
              deployment.canvasGenerationCapabilities,
            ),
          }
        : {}),
      ...(deployment.unavailableReason
        ? { unavailableReason: deployment.unavailableReason }
        : {}),
    })),
    capabilities: payload.capabilities.map((revision) => ({
      id: revision.id,
      operation: revision.operation,
      revision: revision.revision,
      ...(revision.catalogModelId
        ? { catalogModelId: revision.catalogModelId }
        : {}),
    })),
    prices: payload.prices.map((revision) => ({
      id: revision.id,
      currency: revision.currency,
      amount: revision.amount,
      revision: revision.revision,
      ...(revision.catalogModelId
        ? { catalogModelId: revision.catalogModelId }
        : {}),
      ...(revision.unit ? { unit: revision.unit } : {}),
      ...(revision.executionChannelId
        ? { executionChannelId: revision.executionChannelId }
        : {}),
      ...(revision.pricingTier
        ? { pricingTier: revision.pricingTier }
        : {}),
    })),
    routes: payload.routes.map((revision) => ({
      id: revision.id,
      operation: revision.operation,
      revision: revision.revision,
      ...(revision.catalogModelId
        ? { catalogModelId: revision.catalogModelId }
        : {}),
    })),
    providerProfiles: (
      payload.providerProfiles ?? createDefaultProviderProfiles()
    ).map((profile) => ({
      id: profile.id,
      manufacturer: profile.manufacturer,
      apiCounterparty: profile.apiCounterparty,
      lifecycle: profile.lifecycle,
      revision: profile.revision,
    })),
    executionChannels: (
      payload.executionChannels ?? createDefaultExecutionChannels()
    ).map((channel) => ({
      id: channel.id,
      providerProfileId: channel.providerProfileId,
      apiCounterparty: channel.apiCounterparty,
      apiFamily: channel.apiFamily,
      channel: channel.channel,
      region: channel.region,
      credentialOwner: channel.credentialOwner,
      revision: channel.revision,
    })),
  } satisfies CatalogRevisionPayload;
}

function qualityGroup(events: QualityEvent[], key: (event: QualityEvent) => string) {
  const groups = new Map<string, QualityEvent[]>();
  for (const event of events) {
    const value = key(event);
    const group = groups.get(value) ?? [];
    group.push(event);
    groups.set(value, group);
  }
  return [...groups]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([value, group]) => {
      const accepted = group.filter(
        (event) =>
          event.outcome === 'adopted_directly' ||
          event.outcome === 'adopted_with_small_edit',
      ).length;
      return {
        key: value,
        sampleSize: group.length,
        accepted,
        rate: accepted / group.length,
      };
    });
}

function stableId(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 28);
}

function retiredCanvasGenerationCommand(): never {
  throw new P1DomainError(
    'COMMANDS_FROZEN',
    'Pro Studio canvas generation is retired; no new commands or live reads are accepted.',
  );
}

function languageActivationProbePrompt(operation: ModelOperation) {
  if (operation === 'copy.generate') {
    return 'Return three short, distinct beauty-store captions for an activation smoke test.';
  }
  if (operation === 'copy.adapt') {
    return 'Adapt this sanitized beauty-store caption into three short variants: Welcome to our skincare service.';
  }
  if (operation === 'text.respond') {
    return 'Reply with one short sentence confirming this sanitized activation smoke test.';
  }
  throw new P1DomainError(
    'INVALID_STATE',
    'Language activation probe operation is unsupported.',
  );
}

function activationProbeErrorProviderCost(
  error: unknown,
): ActivationProbeRun['providerCost'] | undefined {
  if (
    !(error instanceof Error) ||
    !('providerCost' in error) ||
    !error.providerCost ||
    typeof error.providerCost !== 'object'
  ) {
    return undefined;
  }
  const providerCost = error.providerCost as Record<string, unknown>;
  if (
    typeof providerCost.amount !== 'number' ||
    !Number.isFinite(providerCost.amount) ||
    providerCost.amount < 0 ||
    (providerCost.currency !== 'CNY' && providerCost.currency !== 'USD') ||
    (providerCost.status !== 'estimated' &&
      providerCost.status !== 'observed') ||
    !providerCost.usage ||
    typeof providerCost.usage !== 'object'
  ) {
    return undefined;
  }
  const sourceUsage = providerCost.usage as Record<string, unknown>;
  const usage: NonNullable<ActivationProbeRun['providerCost']>['usage'] = {};
  for (const key of ['inputTokens', 'outputTokens', 'mediaUnits'] as const) {
    const value = sourceUsage[key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return undefined;
    }
    usage[key] = value;
  }
  return {
    amount: providerCost.amount,
    currency: providerCost.currency,
    status: providerCost.status,
    usage,
  };
}

function sumSimulationRouteCosts(
  costs: RouteCandidateCostEstimate[],
): RouteCandidateCostEstimate | null {
  const first = costs[0];
  if (!first) return null;
  if (
    costs.some(
      (cost) => cost.currency !== first.currency || cost.unit !== first.unit,
    )
  ) {
    return null;
  }
  return {
    amountMicros: costs.reduce((total, cost) => total + cost.amountMicros, 0),
    currency: first.currency,
    source: costs.some((cost) => cost.source === 'recorded_estimate')
      ? 'recorded_estimate'
      : 'catalog',
    unit: first.unit,
  };
}

export class ModelSupplyControlPlaneService {
  private readonly application: ModelSupplyApplicationService;
  private readonly repository: ModelSupplyControlPlaneRepository;
  private readonly fallbackCatalog?: CatalogFallback;
  private readonly allowRecordedExecution: boolean;
  private readonly durationSamples?: GenerationDurationSamplePort;
  private readonly activationEvidenceConfig?: ActivationEvidenceConfigPort;
  private readonly activationProbeExecutor?: ActivationProbeExecutionPort;
  private readonly activationProbeLiveDeploymentIds: ReadonlySet<string>;
  private readonly configurationRevisions: Readonly<Record<string, string>>;
  private readonly clock: () => Date;
  private readonly planningControlPlane?: ModelSupplyPlanningControlPlanePort;
  private readonly supplyRegistry?: ModelSupplyRegistryPersistencePort;
  private readonly platformDefaultModels?: PlatformDefaultModelSourcePort;
  private readonly modelCatalogTenantAllowlist: ReadonlySet<string>;
  private readonly warn?: (message: string) => void;
  private readonly warnedDisallowedCatalogWorkspaces = new Set<string>();

  constructor(options: {
    application: ModelSupplyApplicationService;
    repository: ModelSupplyControlPlaneRepository;
    fallbackCatalog?: CatalogFallback;
    allowRecordedExecution?: boolean;
    durationSamples?: GenerationDurationSamplePort;
    activationEvidenceConfig?: ActivationEvidenceConfigPort;
    activationProbeExecutor?: ActivationProbeExecutionPort;
    activationProbeLiveDeploymentIds?: readonly string[];
    configurationRevisions?: Readonly<Record<string, string>>;
    planningControlPlane?: ModelSupplyPlanningControlPlanePort;
    supplyRegistry?: ModelSupplyRegistryPersistencePort;
    /**
     * The one platform-default-model source (#240①). Wired from admin config in
     * boot; when it is absent the preferences projection reports no platform
     * default at all rather than substituting a built-in guess.
     */
    platformDefaultModels?: PlatformDefaultModelSourcePort;
    modelCatalogTenantAllowlist?: readonly string[];
    warn?: (message: string) => void;
    clock?: () => Date;
  }) {
    this.application = options.application;
    this.repository = options.repository;
    this.fallbackCatalog = options.fallbackCatalog
      ? structuredClone(options.fallbackCatalog)
      : undefined;
    this.allowRecordedExecution = options.allowRecordedExecution ?? false;
    this.durationSamples = options.durationSamples;
    this.activationEvidenceConfig = options.activationEvidenceConfig;
    this.activationProbeExecutor = options.activationProbeExecutor;
    this.activationProbeLiveDeploymentIds = new Set(
      options.activationProbeLiveDeploymentIds ?? [],
    );
    this.configurationRevisions = options.configurationRevisions ?? {};
    this.planningControlPlane = options.planningControlPlane;
    this.supplyRegistry = options.supplyRegistry;
    this.platformDefaultModels = options.platformDefaultModels;
    this.modelCatalogTenantAllowlist = new Set(
      (options.modelCatalogTenantAllowlist ?? [])
        .map((workspaceId) => workspaceId.trim())
        .filter(Boolean),
    );
    this.warn = options.warn;
    this.clock = options.clock ?? (() => new Date());
  }

  bindMerchantExecutionBilling(port: MerchantExecutionBillingPort) {
    this.application.bindMerchantExecutionBilling(port);
  }

  private catalogSourceForWorkspace(
    workspaceId: string,
    published: CatalogRevision | null,
  ) {
    const source = catalogSource(published, this.fallbackCatalog);
    if (this.modelCatalogAllows(workspaceId)) {
      return source;
    }
    this.warnCatalogTenantViolation(workspaceId);
    return {
      ...source,
      payload: {
        ...source.payload,
        models: [],
        deployments: [],
        capabilities: [],
        prices: [],
        routes: [],
        providerProfiles: [],
        executionChannels: [],
      },
    };
  }

  private modelCatalogAllows(workspaceId: string) {
    return (
      this.modelCatalogTenantAllowlist.size === 0 ||
      this.modelCatalogTenantAllowlist.has(workspaceId)
    );
  }

  private warnCatalogTenantViolation(workspaceId: string) {
    if (this.warnedDisallowedCatalogWorkspaces.has(workspaceId)) return;
    this.warnedDisallowedCatalogWorkspaces.add(workspaceId);
    this.warn?.(
      `Model catalog defaults were discarded because workspace ${workspaceId} is outside modelCatalogTenantAllowlist.`,
    );
  }

  async runActivationProbe(
    context: P1Context,
    deploymentId: string,
    operation: ModelOperation,
    idempotencyKey: string,
  ) {
    const runId = `activation-probe-${stableId(
      `${context.workspaceId}:${deploymentId}:${operation}:${idempotencyKey}`,
    )}`;
    const source = this.catalogSourceForWorkspace(
      context.workspaceId,
      await this.repository.getCurrentPublishedCatalogRevision(
        context.workspaceId,
      ),
    );
    const deployment = source.payload.deployments.find(
      (candidate) => candidate.id === deploymentId,
    );
    const model = deployment
      ? source.payload.models.find(
          (candidate) => candidate.id === deployment.catalogModelId,
        )
      : undefined;
    const configurationRevision = this.configurationRevisions[deploymentId];
    if (!deployment || !model || !configurationRevision) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Activation probe requires one configured runtime deployment.',
      );
    }
    if (!model.operations.includes(operation)) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Activation probe operation is not declared by this deployment model.',
      );
    }
    const existing = await this.repository.getActivationProbeRun(
      context.workspaceId,
      runId,
    );
    if (existing) {
      await this.persistActivationEvidenceIfComplete(
        context,
        existing,
        model.operations,
      );
      return existing;
    }
    const startedAt = this.clock();
    let run: ActivationProbeRun;
    try {
      if (!this.activationProbeLiveDeploymentIds.has(deploymentId)) {
        throw new Error('Activation probes require a live provider adapter.');
      }
      const languageOperation =
        operation === 'copy.generate' ||
        operation === 'copy.adapt' ||
        operation === 'text.respond';
      const result =
        languageOperation
          ? await this.application.executeLanguageQualityProbe({
              actorId: context.userId,
              correlationId: context.correlationId,
              dataClass: [],
              idempotencyKey: runId,
              operation,
              prompt: languageActivationProbePrompt(operation),
              selection: { catalogModelId: model.id, mode: 'fixed' },
              workspaceId: context.workspaceId,
            })
          : await this.activationProbeExecutor?.execute({
              actorId: context.userId,
              catalogModelId: model.id,
              correlationId: context.correlationId,
              deploymentId,
              idempotencyKey: runId,
              operation,
              workspaceId: context.workspaceId,
            });
      if (!result) {
        throw new Error('Media activation probe executor is not configured.');
      }
      const providerCost =
        'copyCandidates' in result ||
        'platformVariants' in result ||
        'text' in result
          ? {
              amount: result.providerCost.amount,
              currency: result.providerCost.currency,
              status: 'observed' as const,
              usage: structuredClone(result.providerCost.usage),
            }
          : result.providerCost;
      const output =
        'copyCandidates' in result
          ? result.copyCandidates
          : 'platformVariants' in result
            ? result.platformVariants
          : 'text' in result
            ? result.text
            : result.outputDigestSource;
      run = {
        actorId: context.userId,
        catalogModelId: model.id,
        configurationRevision,
        correlationId: context.correlationId,
        createdAt: this.clock().toISOString(),
        deploymentId,
        id: runId,
        latencyMs: Math.max(0, this.clock().getTime() - startedAt.getTime()),
        operation,
        outcome: 'passed',
        outputDigest: createHash('sha256')
          .update(JSON.stringify(output))
          .digest('hex'),
        providerCost,
      };
    } catch (error) {
      const failureCategory =
        error instanceof Error &&
        'failureCategory' in error &&
        typeof error.failureCategory === 'string'
          ? error.failureCategory
          : 'provider_probe_failed';
      const providerCost = activationProbeErrorProviderCost(error);
      run = {
        actorId: context.userId,
        catalogModelId: model.id,
        configurationRevision,
        correlationId: context.correlationId,
        createdAt: this.clock().toISOString(),
        deploymentId,
        failureCategory,
        id: runId,
        latencyMs: Math.max(0, this.clock().getTime() - startedAt.getTime()),
        operation,
        outcome: 'failed',
        ...(providerCost ? { providerCost } : {}),
      };
    }
    await this.repository.saveActivationProbeRun(context.workspaceId, run);
    await this.persistActivationEvidenceIfComplete(
      context,
      run,
      model.operations,
    );
    return structuredClone(run);
  }

  private async persistActivationEvidenceIfComplete(
    context: P1Context,
    run: ActivationProbeRun,
    requiredOperations: readonly ModelOperation[],
  ) {
    const verifiedOperations = await this.verifiedActivationProbeOperations(
      context.workspaceId,
      run.deploymentId,
      run.configurationRevision,
    );
    const operationCoverageComplete = requiredOperations.every((candidate) =>
      verifiedOperations.has(candidate),
    );
    if (
      run.outcome === 'passed' &&
      operationCoverageComplete &&
      this.activationEvidenceConfig
    ) {
      const key = `model.activation.evidence.${run.deploymentId}`;
      const current = await this.activationEvidenceConfig.get(
        'global',
        '__global__',
        key,
      );
      const value = {
        configurationRevision: run.configurationRevision,
        evidenceRef: run.id,
        status: 'live_verified' as const,
        verifiedAt: run.createdAt,
      };
      const currentEvidence = current?.value as
        | Partial<ActivationEvidence>
        | undefined;
      if (
        currentEvidence?.status === 'live_verified' &&
        currentEvidence.configurationRevision === run.configurationRevision &&
        currentEvidence.evidenceRef === run.id
      ) {
        return;
      }
      await this.activationEvidenceConfig.apply({
        actorId: context.userId,
        correlationId: context.correlationId,
        expectedRevision: current?.revision ?? null,
        key,
        reason: `Activation probe ${run.id} passed.`,
        scope: 'global',
        value,
        workspaceId: '__global__',
      });
    }
  }

  async activationStatus(workspaceId: string) {
    const source = this.catalogSourceForWorkspace(
      workspaceId,
      await this.repository.getCurrentPublishedCatalogRevision(workspaceId),
    );
    const runs = await this.repository.listActivationProbeRuns(workspaceId);
    return Promise.all(
      source.payload.deployments.map(async (deployment) => {
        const model = source.payload.models.find(
          (candidate) => candidate.id === deployment.catalogModelId,
        );
        const configurationRevision =
          this.configurationRevisions[deployment.id] ?? null;
        const evidenceRevision = this.activationEvidenceConfig
          ? await this.activationEvidenceConfig.get(
              'global',
              '__global__',
              `model.activation.evidence.${deployment.id}`,
            )
          : null;
        const evidence = evidenceRevision?.value as
          | ActivationEvidence
          | undefined;
        const verifiedOperations = runs
          .filter(
            (run) =>
              run.deploymentId === deployment.id &&
              run.configurationRevision === configurationRevision &&
              run.outcome === 'passed',
          )
          .map((run) => run.operation);
        return {
          catalogModelId: deployment.catalogModelId,
          configurationRevision,
          deploymentId: deployment.id,
          evidence: evidence ?? null,
          estimatedUnitPrice: deployment.unitPrice ?? null,
          operations: structuredClone(model?.operations ?? []),
          latestProbe:
            runs.find((run) => run.deploymentId === deployment.id) ?? null,
          stale:
            Boolean(evidence) &&
            evidence?.configurationRevision !== configurationRevision,
          verifiedOperations,
        };
      }),
    );
  }

  listActivationProbeRuns(workspaceId: string) {
    return this.repository.listActivationProbeRuns(workspaceId);
  }

  async initialize(workspaceId: string) {
    const published =
      await this.repository.getCurrentPublishedCatalogRevision(workspaceId);
    const source = this.catalogSourceForWorkspace(workspaceId, published);
    await this.syncSupplyRegistry(
      workspaceId,
      this.modelCatalogAllows(workspaceId)
        ? source
        : {
            ...source,
            revisionId: `${source.revisionId}:tenant-blocked`,
          },
      published?.number ?? 0,
    );
    this.application.applyCatalogRevision(
      workspaceId,
      source.revisionId,
      source.payload.models,
      source.payload.deployments,
      source.payload.prices,
    );
    return source.revisionId;
  }

  private async syncSupplyRegistry(
    workspaceId: string,
    source: {
      revisionId: string;
      payload: CatalogRevisionPayload;
    },
    catalogRevisionNumber: number,
  ): Promise<void> {
    if (!this.supplyRegistry) return;
    const current =
      await this.supplyRegistry.getCurrentRegistryRevision(workspaceId);
    const registryRevisionId = this.allowRecordedExecution
      ? `${source.revisionId}${LOCAL_FIXTURE_REGISTRY_REVISION_SUFFIX}`
      : source.revisionId;
    if (current?.catalogRevisionId === registryRevisionId) return;
    const registryPayload = this.allowRecordedExecution
      ? {
          ...source.payload,
          deployments: source.payload.deployments.map((deployment) =>
            deployment.status === 'active'
              ? {
                  ...deployment,
                  activationEvidence: {
                    configurationRevision: `fixture:${
                      deployment.lifecycleRevision ?? deployment.id
                    }`,
                    evidenceRef: `fixture://activation/${deployment.id}`,
                    status: 'live_verified' as const,
                    verifiedAt: '2026-07-16T00:00:00.000Z',
                  },
                }
              : deployment,
          ),
        }
      : source.payload;
    const snapshot = expandCatalogRevisionPayload(registryPayload, {
      catalogRevisionId: registryRevisionId,
      catalogRevisionNumber,
    });
    if (this.allowRecordedExecution) {
      snapshot.contracts = snapshot.contracts.map((contract) => ({
        ...contract,
        commercialUse: 'allowed',
        termsRevisionId: `${contract.termsRevisionId}${LOCAL_FIXTURE_COMMERCIAL_USE_TERMS_SUFFIX}`,
      }));
    }
    await this.supplyRegistry.setCurrentRegistryRevision(
      workspaceId,
      snapshot,
      current?.catalogRevisionId ?? null,
    );
  }

  async getCatalog(workspaceId: string, operation: ModelOperation): Promise<CatalogView> {
    const source = this.catalogSourceForWorkspace(
      workspaceId,
      await this.repository.getCurrentPublishedCatalogRevision(workspaceId),
    );
    const deployments =
      await this.application.constrainRuntimeDeploymentsForRequest(
        source.payload.deployments,
      );
    const asOf = new Date().toISOString();
    const since = new Date(
      Date.parse(asOf) - DURATION_ESTIMATE_WINDOW_DAYS * 24 * 60 * 60 * 1_000
    ).toISOString();
    return {
      revisionId: source.revisionId,
      stage: source.stage,
      operation,
      models: await Promise.all(
        source.payload.models
          .filter((model) => model.operations.includes(operation))
          .map(async (model) => {
            const view = toCatalogModelView(
              model,
              deployments,
              this.allowRecordedExecution
            );
            let samples: number[] = [];
            if (
              view.activationEvidence.status === 'live_verified' &&
              this.durationSamples
            ) {
              try {
                samples =
                  await this.durationSamples.listGenerationDurationSamples(
                    workspaceId,
                    durationOperation(operation),
                    model.id,
                    since
                  );
              } catch {
                samples = [];
              }
            }
            return {
              ...view,
              durationEstimate: durationEstimateFromSamples(samples, asOf),
            };
          })
      ),
    };
  }

  async getAdminCatalogControl(workspaceId: string) {
    const source = this.catalogSourceForWorkspace(
      workspaceId,
      await this.repository.getCurrentPublishedCatalogRevision(workspaceId),
    );
    const catalog = adminCatalogPayload(source.payload);
    const activationStatuses = new Map(
      (await this.activationStatus(workspaceId)).map((status) => [
        status.deploymentId,
        status,
      ] as const),
    );
    return {
      workspaceId,
      revisionId: source.revisionId,
      stage: source.stage,
      catalog: {
        ...catalog,
        deployments: catalog.deployments.map((deployment) => {
          const activationStatus = activationStatuses.get(deployment.id);
          if (activationStatus?.evidence && !activationStatus.stale) {
            return {
              ...deployment,
              activationEvidence: structuredClone(activationStatus.evidence),
            };
          }
          return deployment.activationEvidence.status === 'live_verified'
            ? {
                ...deployment,
                activationEvidence: { status: 'recorded' as const },
              }
            : deployment;
        }),
      },
    };
  }

  /**
   * Preference projection for one operation, including the platform default
   * (#240①).
   *
   * The platform default used to have no wire at all, so the browser kept a
   * hardcoded lens→model table of its own — a second production opinion that
   * no operator could edit and no activation evidence ever validated. It is
   * projected here instead, from the same admin-config source provisioning
   * reads, and it is simply absent when the platform has not configured one.
   */
  async getPreferences(
    workspaceId: string,
    userId: string,
    operation: ModelOperation,
  ) {
    const view = await this.repository.getPreferences(
      workspaceId,
      userId,
      operation,
    );
    if (!this.modelCatalogAllows(workspaceId)) {
      this.warnCatalogTenantViolation(workspaceId);
      return view;
    }
    const configKey = platformDefaultModelConfigKeyForOperation(operation);
    if (!this.platformDefaultModels || !configKey) return view;
    const binding = (
      await this.platformDefaultModels.getSnapshot()
    )[configKey];
    const platformDefault = binding?.catalogModelId.trim();
    const platformDefaultRevision = binding?.configRevision.trim();
    return platformDefault && platformDefaultRevision
      ? { ...view, platformDefault, platformDefaultRevision }
      : view;
  }

  async simulateRoute(
    context: P1Context,
    input: Omit<ModelSupplyRouteSimulationInput, 'workspaceId'>,
  ) {
    await this.initialize(context.workspaceId);
    const legacy = this.application.simulateRoute({
      ...structuredClone(input),
      workspaceId: context.workspaceId,
    });
    const source = this.catalogSourceForWorkspace(
      context.workspaceId,
      await this.repository.getCurrentPublishedCatalogRevision(
        context.workspaceId,
      ),
    );
    const deployments =
      await this.application.constrainRuntimeDeploymentsForRequest(
        source.payload.deployments,
      );
    const qualityTier =
      input.selection.mode === 'auto'
        ? (input.selection.profile ?? 'quality')
        : ('quality' as const);
    const planningState =
      (await this.planningControlPlane?.readPlanningState({
        workspaceId: context.workspaceId,
        catalogRevisionId: source.revisionId,
        operation: input.operation,
        qualityTier,
        deploymentIds: deployments.map((deployment) => deployment.id),
        ...(input.routePolicyRevisionId
          ? { routePolicyRevisionId: input.routePolicyRevisionId }
          : {}),
      })) ?? {};
    if (
      input.routePolicyRevisionId &&
      planningState.routePolicyRevisionId !== input.routePolicyRevisionId
    ) {
      throw new P1DomainError(
        'NOT_FOUND',
        `RoutePolicy revision ${input.routePolicyRevisionId} was not found for ${input.operation}/${qualityTier}.`,
      );
    }
    const healthExcludedDeploymentIds = planningState.healthOverlay
      ? await collectHealthExcludedDeploymentIds({
          overlay: planningState.healthOverlay,
          deploymentIds: deployments.map((deployment) => deployment.id),
        })
      : [];
    const planResult = planModelSupplyCandidatesWithDataPolicy({
      catalog: {
        modelById: new Map(
          source.payload.models.map((model) => [model.id, model] as const),
        ),
        deployments,
      },
      operation: input.operation,
      selection: input.selection,
      dataClass: input.dataClass,
      unavailableDeploymentIds: input.unavailableDeploymentIds,
      healthExcludedDeploymentIds,
      routePolicy: planningState.routePolicy,
      dataPolicyByDeploymentId: planningState.dataPolicyByDeploymentId,
      rankingInputsByDeploymentId:
        planningState.rankingInputsByDeploymentId,
    });
    const evaluationByDeploymentId = new Map(
      planResult.plan.candidateEvaluations.map((evaluation) => [
        evaluation.deploymentId,
        evaluation,
      ]),
    );
    const rankedCandidates = planResult.plan.candidates.map(
      ({ deployment }, index) => ({
        ...structuredClone(evaluationByDeploymentId.get(deployment.id)!),
        rank: index + 1,
      }),
    );
    const primary = rankedCandidates[0];
    const fallback = rankedCandidates[1];
    const routePolicyMaxAttempts =
      planningState.routePolicy?.maxAttempts ?? legacy.expectedOutcome.attemptLimit;
    const fallbackAuthorized =
      input.selection.mode === 'auto' &&
      (input.selection.fallbackConsent ?? true) &&
      (planningState.routePolicy?.fallbackAuthorized ?? true) &&
      routePolicyMaxAttempts > 1;
    let expectedOutcome = legacy.expectedOutcome;
    let estimatedCosts = primary ? [primary.costEstimate] : [];
    if (!primary) {
      expectedOutcome = {
        action: 'awaiting_selection',
        attemptLimit: 2,
        expectedAttempts: 0,
        reason: 'no_eligible_candidate',
      };
      estimatedCosts = [];
    } else if (input.failureScenario === 'success') {
      expectedOutcome = {
        action: 'complete',
        attemptLimit: 2,
        expectedAttempts: 1,
        primaryDeploymentId: primary.deploymentId,
        reason: 'provider_completed',
      };
    } else if (input.failureScenario === 'accepted_failure') {
      expectedOutcome = {
        action: 'recover_without_resubmit',
        attemptLimit: 2,
        expectedAttempts: 1,
        primaryDeploymentId: primary.deploymentId,
        reason: 'provider_already_accepted',
      };
    } else if (input.failureScenario === 'acceptance_unknown') {
      expectedOutcome = {
        action: 'recover_without_resubmit',
        attemptLimit: 2,
        expectedAttempts: 1,
        primaryDeploymentId: primary.deploymentId,
        reason: 'provider_acceptance_unknown',
      };
    } else if (fallbackAuthorized && fallback) {
      estimatedCosts = [primary.costEstimate, fallback.costEstimate];
      expectedOutcome = {
        action: 'fallback',
        attemptLimit: 2,
        expectedAttempts: 2,
        primaryDeploymentId: primary.deploymentId,
        fallbackDeploymentId: fallback.deploymentId,
        reason: 'safe_auto_fallback',
      };
    } else {
      expectedOutcome = {
        action: 'stop',
        attemptLimit: 2,
        expectedAttempts: 1,
        primaryDeploymentId: primary.deploymentId,
        reason: fallbackAuthorized
          ? 'no_safe_fallback_candidate'
          : 'fallback_not_authorized',
      };
    }
    const acceptanceBranch = {
      acceptance:
        input.failureScenario === 'rejected_before_accept'
          ? ('rejected_before_accept' as const)
          : input.failureScenario === 'accepted_failure'
            ? ('accepted' as const)
            : input.failureScenario === 'acceptance_unknown'
              ? ('acceptance_unknown' as const)
              : ('not_attempted' as const),
      decision:
        expectedOutcome.action === 'fallback'
          ? ('safe_auto_fallback' as const)
          : expectedOutcome.action === 'recover_without_resubmit'
            ? ('query_reconcile_manual' as const)
            : expectedOutcome.action,
      reason: expectedOutcome.reason,
      ...(expectedOutcome.primaryDeploymentId
        ? { primaryDeploymentId: expectedOutcome.primaryDeploymentId }
        : {}),
      ...(expectedOutcome.fallbackDeploymentId
        ? { fallbackDeploymentId: expectedOutcome.fallbackDeploymentId }
        : {}),
    };
    const decisionExplanation = explainPlanDecision({
      surface: 'simulator',
      planResult,
      requestedDataClasses: input.dataClass,
      liveExclusions: healthExcludedDeploymentIds.map((deploymentId) => ({
        deploymentId,
        reasons: ['health_overlay_blocking'],
      })),
      acceptanceBranch,
      costEvidenceSourceByDeploymentId: new Map(
        [...(planningState.rankingInputsByDeploymentId?.entries() ?? [])].map(
          ([deploymentId, ranking]) => [
            deploymentId,
            ranking.cost.source === 'recorded_placeholder'
              ? 'recorded_estimate'
              : ranking.cost.source,
          ],
        ),
      ),
    });
    return {
      ...legacy,
      candidateEvaluations: structuredClone(
        planResult.plan.candidateEvaluations,
      ),
      rankedCandidates,
      expectedOutcome,
      estimatedMaximumCost: sumSimulationRouteCosts(estimatedCosts),
      routePolicyRevisionId:
        planningState.routePolicyRevisionId ?? null,
      routePolicyMaxAttempts,
      decisionExplanation,
    };
  }

  async setWorkspaceDefault(
    context: P1Context,
    operation: ModelOperation,
    modelId: string,
  ) {
    await this.requireCatalogModel(context.workspaceId, operation, modelId);
    await this.repository.setWorkspaceDefault(context.workspaceId, operation, modelId);
    return this.getPreferences(context.workspaceId, context.userId, operation);
  }

  async submitGeneration(
    context: P1Context,
    input: Omit<
      Parameters<ModelSupplyApplicationService['submit']>[0],
      'workspaceId' | 'actorId' | 'idempotencyKey'
    >,
    idempotencyKey: string,
  ): Promise<ModelSupplyResult> {
    await this.initialize(context.workspaceId);
    return this.application.submit({
      ...structuredClone(input),
      actorId: context.userId,
      idempotencyKey,
      workspaceId: context.workspaceId,
    });
  }

  async setUserDefault(
    context: P1Context,
    operation: ModelOperation,
    modelId: string,
  ) {
    await this.requireCatalogModel(context.workspaceId, operation, modelId);
    await this.repository.setUserDefault(
      context.workspaceId,
      context.userId,
      operation,
      modelId,
    );
    return this.getPreferences(context.workspaceId, context.userId, operation);
  }

  async setFavorite(
    context: P1Context,
    operation: ModelOperation,
    modelId: string,
    favorite: boolean,
  ) {
    await this.requireCatalogModel(context.workspaceId, operation, modelId);
    await this.repository.setFavorite(
      context.workspaceId,
      context.userId,
      operation,
      modelId,
      favorite,
    );
    return this.getPreferences(context.workspaceId, context.userId, operation);
  }

  async recordRecent(
    context: P1Context,
    operation: ModelOperation,
    modelId: string,
  ) {
    await this.requireCatalogModel(context.workspaceId, operation, modelId);
    await this.repository.recordRecent(
      context.workspaceId,
      context.userId,
      operation,
      modelId,
    );
    return this.getPreferences(context.workspaceId, context.userId, operation);
  }

  async createCatalogDraft(
    workspaceId: string,
    payload: CatalogRevisionPayload,
    audit?: { actorId: string; correlationId: string },
  ) {
    validateCatalogPayload(payload);
    await this.assertProbeBackedActivationEvidence(
      workspaceId,
      payload.models,
      payload.deployments,
    );
    const registry = await this.registry(workspaceId);
    const revision = registry.createDraft(payload, audit);
    await this.repository.saveCatalogRevision(workspaceId, revision);
    return revision;
  }

  async createCatalogDiscoveryDraft(
    workspaceId: string,
    payload: CatalogRevisionPayload,
    audit?: { actorId: string; correlationId: string },
  ) {
    validateCatalogPayload(payload);
    await this.assertProbeBackedActivationEvidence(
      workspaceId,
      payload.models,
      payload.deployments,
    );
    const registry = await this.registry(workspaceId);
    const revision = registry.createDiscoveryDraft(payload, audit);
    await this.repository.saveCatalogRevision(workspaceId, revision);
    return revision;
  }

  private async assertProbeBackedActivationEvidence(
    workspaceId: string,
    models: CatalogModel[],
    deployments: PublishedDeployment[],
  ) {
    for (const deployment of deployments) {
      if (deployment.activationEvidence.status !== 'live_verified') continue;
      const evidenceRef = deployment.activationEvidence.evidenceRef;
      const run = evidenceRef
        ? await this.repository.getActivationProbeRun(workspaceId, evidenceRef)
        : null;
      const currentConfigurationRevision =
        this.configurationRevisions[deployment.id];
      const model = models.find(
        (candidate) => candidate.id === deployment.catalogModelId,
      );
      const verifiedOperations = currentConfigurationRevision
        ? await this.verifiedActivationProbeOperations(
            workspaceId,
            deployment.id,
            currentConfigurationRevision,
          )
        : new Set<ModelOperation>();
      if (
        !run ||
        run.outcome !== 'passed' ||
        run.deploymentId !== deployment.id ||
        !currentConfigurationRevision ||
        run.configurationRevision !== currentConfigurationRevision ||
        deployment.activationEvidence.configurationRevision !==
          currentConfigurationRevision ||
        !model ||
        !model.operations.every((operation) =>
          verifiedOperations.has(operation),
        )
      ) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Live activation evidence must reference passed, current activation probe runs covering every declared operation.',
        );
      }
    }
  }

  private async verifiedActivationProbeOperations(
    workspaceId: string,
    deploymentId: string,
    configurationRevision: string,
  ) {
    return new Set(
      (await this.repository.listActivationProbeRuns(workspaceId))
        .filter(
          (candidate) =>
            candidate.deploymentId === deploymentId &&
            candidate.configurationRevision === configurationRevision &&
            candidate.outcome === 'passed',
        )
        .map((candidate) => candidate.operation),
    );
  }

  async createSafeCatalogDraft(
    workspaceId: string,
    edits: SafeCatalogModelEdit[],
    audit?: { actorId: string; correlationId: string },
  ) {
    const source = this.catalogSourceForWorkspace(
      workspaceId,
      await this.repository.getCurrentPublishedCatalogRevision(workspaceId),
    );
    const editByModel = new Map<string, SafeCatalogModelEdit>();
    const modelIds = new Set(source.payload.models.map((model) => model.id));
    for (const edit of edits) {
      if (!modelIds.has(edit.id) || editByModel.has(edit.id)) {
        throw new P1DomainError(
          'INVALID_STATE',
          `Safe catalog edits must reference each existing model at most once: ${edit.id}.`,
        );
      }
      validateSafeCatalogEdit(edit);
      editByModel.set(edit.id, structuredClone(edit));
    }
    const deployments = source.payload.deployments.map((deployment) => {
      const edit = editByModel.get(deployment.catalogModelId);
      if (!edit) return structuredClone(deployment);
      const unavailable = edit.lifecycle === 'unavailable';
      return {
        ...structuredClone(deployment),
        activationEvidence: structuredClone(edit.activationEvidence),
        allowedDataClasses: [...edit.allowedDataClasses],
        status: unavailable ? ('inactive' as const) : ('active' as const),
        unavailableReason: unavailable
          ? ('deployment_unavailable' as const)
          : undefined,
      };
    });
    for (const modelId of editByModel.keys()) {
      if (!deployments.some((deployment) => deployment.catalogModelId === modelId)) {
        throw new P1DomainError(
          'INVALID_STATE',
          `CatalogModel ${modelId} has no deployment to update.`,
        );
      }
    }
    return this.createCatalogDraft(
      workspaceId,
      {
        ...structuredClone(source.payload),
        deployments,
      },
      audit,
    );
  }

  async enableCatalog(
    workspaceId: string,
    revisionId: string,
    audit?: { actorId: string; correlationId: string },
  ) {
    const registry = await this.registry(workspaceId);
    const revision = registry.enable(revisionId, undefined, audit);
    await this.repository.saveCatalogRevision(workspaceId, revision);
    return revision;
  }

  async publishCatalog(
    workspaceId: string,
    revisionId: string,
    expectedHeadRevisionId: string | null,
    reason = 'legacy-admin-action',
    audit?: { actorId: string; correlationId: string },
  ) {
    const registry = await this.registry(workspaceId);
    const revision = registry.publish(revisionId, reason, audit);
    await this.application.assertRuntimeCatalogCompatibleForRequest(
      revision.payload.deployments,
    );
    await this.repository.setCurrentPublishedCatalogRevision(
      workspaceId,
      revision,
      expectedHeadRevisionId,
    );
    await this.syncSupplyRegistry(
      workspaceId,
      { revisionId: revision.id, payload: revision.payload },
      revision.number,
    );
    this.application.applyCatalogRevision(
      workspaceId,
      revision.id,
      revision.payload.models,
      revision.payload.deployments,
      revision.payload.prices,
    );
    return revision;
  }

  async retireCatalog(
    workspaceId: string,
    revisionId: string,
    reason = 'legacy-admin-action',
    audit?: { actorId: string; correlationId: string },
  ) {
    const registry = await this.registry(workspaceId);
    const revision = registry.retire(revisionId, reason, audit);
    await this.repository.saveCatalogRevision(workspaceId, revision);
    await this.repository.clearCurrentPublishedCatalogRevision(workspaceId, revisionId);
    await this.initialize(workspaceId);
    return revision;
  }

  async getJob(workspaceId: string, jobId: string) {
    try {
      return await this.application.getDurableMediaJob(workspaceId, jobId);
    } catch (error) {
      const notFound =
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'NOT_FOUND';
      const runtimeNotConfigured =
        error instanceof Error &&
        error.message === 'Durable media runtime is not configured.';
      if (!notFound && !runtimeNotConfigured) throw error;
    }
    const job = await this.repository.getJob(workspaceId, jobId);
    if (job) return job;
    throw new P1DomainError('NOT_FOUND', 'Model generation job was not found.');
  }

  cancelGeneration(context: P1Context, jobId: string) {
    return this.application.cancelDurableMediaJob({
      actorId: context.userId,
      jobId,
      workspaceId: context.workspaceId,
    });
  }

  reconcileCancelledProviderTerminal(
    context: P1Context,
    input: { jobId: string; providerTaskRef: string },
  ) {
    return this.application.reconcileCancelledProviderTerminal({
      workspaceId: context.workspaceId,
      jobId: input.jobId,
      providerTaskRef: input.providerTaskRef,
    });
  }

  async recordQuality(workspaceId: string, input: QualityEvent) {
    const event = this.application.recordQuality(input);
    return this.repository.saveQualityEvent(workspaceId, event);
  }

  async qualityDashboard(workspaceId: string) {
    const events = await this.repository.listQualityEvents(workspaceId);
    const adoptionEvents = events.filter(
      (event) => event.outcome !== 'published',
    );
    const accepted = adoptionEvents.filter(
      (event) =>
        event.outcome === 'adopted_directly' ||
        event.outcome === 'adopted_with_small_edit',
    ).length;
    return {
      northStar:
        adoptionEvents.length < QUALITY_NORTH_STAR_MIN_SAMPLE_SIZE
          ? {
              status: 'unknown' as const,
              target: 0.6,
              sampleSize: adoptionEvents.length,
              minimumSampleSize: QUALITY_NORTH_STAR_MIN_SAMPLE_SIZE,
            }
          : {
              status: 'known' as const,
              target: 0.6,
              sampleSize: adoptionEvents.length,
              minimumSampleSize: QUALITY_NORTH_STAR_MIN_SAMPLE_SIZE,
              accepted,
              rate: accepted / adoptionEvents.length,
              met: accepted / adoptionEvents.length >= 0.6,
            },
      byModel: qualityGroup(adoptionEvents, (event) => event.catalogModelId),
      byPromptRevision: qualityGroup(adoptionEvents, (event) => event.promptRevision),
      byTemplateRevision: qualityGroup(
        adoptionEvents.filter((event) => event.templateRevision),
        (event) => event.templateRevision as string,
      ),
      byScenario: qualityGroup(adoptionEvents, (event) => event.scenario),
      funnel: {
        adoptedDirectly: events.filter(
          (event) => event.outcome === 'adopted_directly',
        ).length,
        adoptedWithSmallEdit: events.filter(
          (event) => event.outcome === 'adopted_with_small_edit',
        ).length,
        rerolled: events.filter((event) => event.outcome === 'rerolled').length,
        abandoned: events.filter((event) => event.outcome === 'abandoned').length,
        published: events.filter((event) => event.outcome === 'published').length,
      },
    };
  }

  async getPromptRevision(workspaceId: string) {
    const stored = await this.repository.getCurrentPromptRevision(workspaceId);
    return getBeautyCopyPromptRevision(
      stored ?? DEFAULT_BEAUTY_COPY_PROMPT_REVISION,
    );
  }

  async promptRevisionView(workspaceId: string) {
    const current = await this.getPromptRevision(workspaceId);
    return {
      currentPromptRevision: current.promptRevision,
      currentExampleSetRevision: current.exampleSetRevision,
      revisions: BEAUTY_COPY_PROMPT_REVISIONS.map((revision) => ({
        promptRevision: revision.promptRevision,
        exampleSetRevision: revision.exampleSetRevision,
        label: revision.label,
        current: revision.promptRevision === current.promptRevision,
      })),
    };
  }

  async listCatalogRevisionActivity(workspaceId: string) {
    const current = await this.repository.getCurrentPublishedCatalogRevision(workspaceId);
    const fallbackRevisionId =
      this.fallbackCatalog?.revisionId ?? RECORDED_CATALOG_REVISION_ID;
    return {
      currentRevisionId: current?.id ?? fallbackRevisionId,
      expectedHeadRevisionId: current?.id ?? null,
      revisions: [
        {
          id: fallbackRevisionId,
          number: 0,
          stage: 'recorded' as const,
          createdAt: null,
          current: !current,
        },
        ...(await this.repository.listCatalogRevisions(workspaceId)).map(
          ({ payload: _payload, ...revision }) => ({
            ...revision,
            current: revision.id === current?.id,
          }),
        ),
      ],
    };
  }

  async rollbackPromptRevision(
    context: P1Context,
    targetRevisionId: string,
    reason: string,
  ) {
    getBeautyCopyPromptRevision(targetRevisionId);
    const stored = await this.repository.getCurrentPromptRevision(context.workspaceId);
    const currentRevisionId = stored ?? DEFAULT_BEAUTY_COPY_PROMPT_REVISION;
    if (currentRevisionId === targetRevisionId) {
      throw new P1DomainError('INVALID_STATE', 'Prompt revision is already current.');
    }
    const audit: RevisionRollbackAudit = {
      id: randomUUID(),
      kind: 'prompt',
      actorId: context.userId,
      correlationId: context.correlationId,
      fromRevisionId: currentRevisionId,
      toRevisionId: targetRevisionId,
      reason,
      createdAt: new Date().toISOString(),
    };
    await this.repository.applyPromptRollback(
      context.workspaceId,
      stored,
      targetRevisionId,
      audit,
    );
    return {
      audit: structuredClone(audit),
      current: getBeautyCopyPromptRevision(targetRevisionId),
    };
  }

  async rollbackCatalogRevision(
    context: P1Context,
    targetRevisionId: string,
    reason: string,
  ) {
    const current = await this.repository.getCurrentPublishedCatalogRevision(
      context.workspaceId,
    );
    const fallbackRevisionId =
      this.fallbackCatalog?.revisionId ?? RECORDED_CATALOG_REVISION_ID;
    const currentRevisionId = current?.id ?? fallbackRevisionId;
    if (currentRevisionId === targetRevisionId) {
      throw new P1DomainError('INVALID_STATE', 'Catalog revision is already current.');
    }
    const target =
      targetRevisionId === fallbackRevisionId
        ? null
        : (await this.repository.listCatalogRevisions(context.workspaceId)).find(
            (revision) =>
              revision.id === targetRevisionId && revision.stage === 'published',
          ) ?? null;
    if (!target && targetRevisionId !== fallbackRevisionId) {
      throw new P1DomainError(
        'NOT_FOUND',
        'Catalog rollback target must be a retained published revision.',
      );
    }
    if (target) {
      await this.application.assertRuntimeCatalogCompatibleForRequest(
        target.payload.deployments,
      );
    }
    const audit: RevisionRollbackAudit = {
      id: randomUUID(),
      kind: 'catalog',
      actorId: context.userId,
      correlationId: context.correlationId,
      fromRevisionId: currentRevisionId,
      toRevisionId: targetRevisionId,
      reason,
      createdAt: new Date().toISOString(),
    };
    await this.repository.applyCatalogRollback(
      context.workspaceId,
      current?.id ?? null,
      target,
      audit,
    );
    await this.initialize(context.workspaceId);
    return { audit: structuredClone(audit), currentRevisionId: targetRevisionId };
  }

  listRevisionRollbackAudits(workspaceId: string) {
    return this.repository.listRevisionRollbackAudits(workspaceId);
  }

  listQualityEvaluations(workspaceId: string) {
    return this.repository.listQualityEvaluationRuns(workspaceId);
  }

  async getQualityEvaluation(workspaceId: string, runId: string) {
    const run = await this.repository.getQualityEvaluationRun(workspaceId, runId);
    if (!run) {
      throw new P1DomainError('NOT_FOUND', 'Quality evaluation run was not found.');
    }
    return run;
  }

  async runQualityEvaluation(
    context: P1Context,
    input: { catalogModelId?: string },
    idempotencyKey: string,
  ) {
    const runId = `quality-eval-${stableId(
      `${context.workspaceId}:${idempotencyKey}`,
    )}`;
    const existing = await this.repository.getQualityEvaluationRun(
      context.workspaceId,
      runId,
    );
    if (existing) return existing;

    await this.initialize(context.workspaceId);
    const promptRevision = await this.getPromptRevision(context.workspaceId);
    const catalog = await this.getCatalog(context.workspaceId, 'copy.generate');
    const selected = input.catalogModelId
      ? catalog.models.find((model) => model.id === input.catalogModelId)
      : catalog.models.find(
          (model) => model.activationEvidence.status !== 'documented',
        );
    if (!selected || selected.activationEvidence.status === 'documented') {
      throw new P1DomainError(
        'INVALID_STATE',
        'Quality evaluation requires an available or recorded copy model.',
      );
    }
    const evidenceKind =
      selected.availability === 'available' &&
      selected.activationEvidence.status === 'live_verified'
        ? ('live_provider' as const)
        : ('recorded_contract' as const);

    const createdAt = new Date().toISOString();
    const cases: BeautyQualityEvaluationRun['cases'] = [];
    const actualCatalogModelIds = new Set<string>();
    let failure: string | undefined;
    for (const [ordinal, fixture] of BEAUTY_COPY_EVALUATION_SET_V2.cases.entries()) {
      try {
        const result = await this.application.executeCopyQualityProbe({
          workspaceId: context.workspaceId,
          actorId: context.userId,
          correlationId: context.correlationId,
          idempotencyKey: `${runId}:${fixture.id}`,
          operation: 'copy.generate',
          selection: { mode: 'fixed', catalogModelId: selected.id },
          dataClass: [],
          prompt: buildBeautyEvaluationPrompt(fixture, promptRevision),
          copyCandidateCount: 3,
          promptRevision: promptRevision.promptRevision,
          exampleSetRevision: promptRevision.exampleSetRevision,
        });
        actualCatalogModelIds.add(result.snapshot.actualCatalogModelId);
        const evaluated = evaluateBeautyQualityFixture(
          fixture,
          result.copyCandidates,
        );
        const executionCandidate = result.snapshot.allowedCandidates?.find(
          (candidate) =>
            candidate.deploymentId === result.snapshot.deploymentId,
        );
        cases.push({
          id: `${runId}:${fixture.id}`,
          ordinal,
          fixtureId: fixture.id,
          scenario: fixture.scenario,
          platform: fixture.platform,
          catalogModelId: result.snapshot.actualCatalogModelId,
          routeSnapshotId: result.snapshot.id,
          evidenceKind,
          activationEvidence: structuredClone(selected.activationEvidence),
          deploymentId: result.snapshot.deploymentId,
          ...(result.snapshot.deploymentLifecycleRevision
            ? {
                deploymentLifecycleRevision:
                  result.snapshot.deploymentLifecycleRevision,
              }
            : {}),
          ...(result.snapshot.providerModel
            ? { providerModel: result.snapshot.providerModel }
            : {}),
          ...(result.snapshot.endpointRevision
            ? { endpointRevision: result.snapshot.endpointRevision }
            : {}),
          credentialVersion:
            executionCandidate?.credentialVersion ??
            result.snapshot.credentialVersion,
          providerCost: structuredClone(result.providerCost),
          passed: evaluated.passed,
          evaluation: evaluated.evaluation,
          candidates: structuredClone(result.copyCandidates),
        });
      } catch (error) {
        failure = error instanceof Error ? error.message : 'Unknown evaluation failure.';
        break;
      }
    }
    const rejectionCases = BEAUTY_COPY_EVALUATION_SET_V2.rejectionCases.map(
      (fixture, ordinal) => {
        const result = evaluateBeautyQualityRejectionFixture(fixture);
        return {
          id: `${runId}:rejection:${fixture.id}`,
          ordinal,
          fixtureId: fixture.id,
          caught: result.caught,
          expectedWarnings: [...fixture.expectedWarnings],
          evaluation: result.evaluation,
        };
      },
    );
    const passed = cases.filter((candidate) => candidate.passed).length;
    const rejectionsCaught = rejectionCases.filter(
      (candidate) => candidate.caught,
    ).length;
    const completedAt = new Date().toISOString();
    const run: BeautyQualityEvaluationRun = {
      id: runId,
      status: failure ? 'failed' : 'completed',
      datasetRevision: BEAUTY_COPY_EVALUATION_SET_V2.revision,
      promptRevision: promptRevision.promptRevision,
      exampleSetRevision: promptRevision.exampleSetRevision,
      catalogRevisionId: catalog.revisionId,
      requestedCatalogModelId: selected.id,
      actualCatalogModelIds: [...actualCatalogModelIds].sort(),
      evidenceKind,
      createdAt,
      completedAt,
      summary: {
        caseCount: BEAUTY_COPY_EVALUATION_SET_V2.cases.length,
        passed,
        passRate: passed / BEAUTY_COPY_EVALUATION_SET_V2.cases.length,
        rejectionCaseCount:
          BEAUTY_COPY_EVALUATION_SET_V2.rejectionCases.length,
        rejectionsCaught,
      },
      cases,
      rejectionCases,
      ...(failure ? { failure } : {}),
    };
    await this.repository.saveQualityEvaluationRun(context.workspaceId, run);
    return structuredClone(run);
  }

  private async registry(workspaceId: string) {
    return new CatalogRevisionRegistry(
      await this.repository.listCatalogRevisions(workspaceId),
    );
  }

  private async requireCatalogModel(
    workspaceId: string,
    operation: ModelOperation,
    modelId: string,
  ) {
    const catalog = await this.getCatalog(workspaceId, operation);
    if (!catalog.models.some((model) => model.id === modelId)) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Catalog model ${modelId} is not part of ${operation}.`,
      );
    }
  }
}


function object(value: unknown): Record<string, unknown> {
	if (!plainRecord(value)) {
		throw new P1DomainError('INVALID_STATE', 'Model supply input must be an object.');
	}
	return value;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new P1DomainError('INVALID_STATE', `${key} is required.`);
  }
  return value;
}

function optionalString(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length === 0) {
    throw new P1DomainError('INVALID_STATE', `${key} must be a non-empty string.`);
  }
  return value;
}

function expectedCatalogHeadRevisionId(input: Record<string, unknown>) {
  if (!Object.hasOwn(input, 'expectedHeadRevisionId')) {
    throw new P1DomainError(
      'INVALID_STATE',
      'expectedHeadRevisionId is required for catalog publication.',
    );
  }
  const value = input.expectedHeadRevisionId;
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      'expectedHeadRevisionId must be a revision ID or null.',
    );
  }
  return value;
}

function operation(input: Record<string, unknown>) {
  const value = requiredString(input, 'operation') as ModelOperation;
  if (!(MODEL_OPERATIONS as readonly string[]).includes(value)) {
    throw new P1DomainError('INVALID_STATE', `Unknown model operation ${value}.`);
  }
  return value;
}

function validateCatalogPayload(payload: CatalogRevisionPayload) {
  const providerProfilesDeclared = payload.providerProfiles !== undefined;
  const executionChannelsDeclared = payload.executionChannels !== undefined;
  const providerProfileIds = new Set(
    (payload.providerProfiles ?? []).map((profile) => profile.id)
  );
  if (providerProfileIds.size !== (payload.providerProfiles ?? []).length) {
    throw new P1DomainError(
      'INVALID_STATE',
      'ProviderProfile ids must be unique.'
    );
  }
  const executionChannelIds = new Set<string>();
  const executionChannelById = new Map<
    string,
    NonNullable<CatalogRevisionPayload['executionChannels']>[number]
  >();
  for (const channel of payload.executionChannels ?? []) {
    if (!channel.id || executionChannelIds.has(channel.id)) {
      throw new P1DomainError(
        'INVALID_STATE',
        'ExecutionChannel ids must be unique.'
      );
    }
    if (
      providerProfilesDeclared &&
      !providerProfileIds.has(channel.providerProfileId)
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        `ExecutionChannel ${channel.id} references an unknown ProviderProfile.`
      );
    }
    executionChannelIds.add(channel.id);
    executionChannelById.set(channel.id, channel);
  }
  const modelIds = new Set<string>();
  for (const model of payload.models) {
    if (!model.id || modelIds.has(model.id)) {
      throw new P1DomainError('INVALID_STATE', 'CatalogModel ids must be unique.');
    }
    if (
      model.operations.some(
        (candidate) =>
          !(MODEL_OPERATIONS as readonly string[]).includes(candidate),
      )
    ) {
      throw new P1DomainError('INVALID_STATE', `CatalogModel ${model.id} has an unknown capability.`);
    }
    const requiredCreditPricing: CreditPricingOperation[] = [];
    for (const operation of model.operations) {
      if (CREDIT_PRICING_OPERATIONS.includes(operation as never)) {
        requiredCreditPricing.push(operation as CreditPricingOperation);
      }
    }
    if (model.operations.includes('image.edit')) {
      requiredCreditPricing.push('image.reference_transform');
    }
    const missingCreditPricing = requiredCreditPricing.find(
      (operation) => !model.creditPricing?.[operation],
    );
    if (missingCreditPricing) {
      throw new P1DomainError(
        'INVALID_STATE',
        `CatalogModel ${model.id} is missing credit pricing for ${missingCreditPricing}.`,
      );
    }
    for (const [operation, pricing] of Object.entries(
      model.creditPricing ?? {},
    )) {
      if (!CREDIT_PRICING_OPERATIONS.includes(operation as never)) {
        throw new P1DomainError(
          'INVALID_STATE',
          `CatalogModel ${model.id} has an unknown credit pricing operation.`,
        );
      }
      const supported =
        model.operations.includes(operation as ModelOperation) ||
        (operation === 'image.reference_transform' &&
          model.operations.includes('image.edit'));
      if (!supported) {
        throw new P1DomainError(
          'INVALID_STATE',
          `CatalogModel ${model.id} prices an unsupported operation.`,
        );
      }
      if (
        !pricing ||
        !Number.isSafeInteger(pricing.creditCost) ||
        pricing.creditCost < 1 ||
        typeof pricing.failureRefundsCredits !== 'boolean'
      ) {
        throw new P1DomainError(
          'INVALID_STATE',
          `CatalogModel ${model.id} has invalid credit pricing.`,
        );
      }
      if (operation === 'video.generate') {
        const durations = pricing.videoCreditCosts;
        if (
          !durations ||
          ![15, 30, 60].every(
            (duration) =>
              Number.isSafeInteger(durations[duration as 15 | 30 | 60]) &&
              durations[duration as 15 | 30 | 60]! > 0,
          ) ||
          Object.keys(durations).some(
            (duration) => !['15', '30', '60'].includes(duration),
          )
        ) {
          throw new P1DomainError(
            'INVALID_STATE',
            `CatalogModel ${model.id} requires 15/30/60 second video credit pricing.`,
          );
        }
      } else if (pricing.videoCreditCosts !== undefined) {
        throw new P1DomainError(
          'INVALID_STATE',
          `CatalogModel ${model.id} has video durations on a non-video price.`,
        );
      }
    }
    modelIds.add(model.id);
  }
  const deploymentIds = new Set<string>();
  for (const deployment of payload.deployments) {
    if (!deployment.id || deploymentIds.has(deployment.id)) {
      throw new P1DomainError('INVALID_STATE', 'Deployment ids must be unique.');
    }
    if (!modelIds.has(deployment.catalogModelId)) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Deployment ${deployment.id} references an unknown CatalogModel.`,
      );
    }
    const model = payload.models.find(
      (candidate) => candidate.id === deployment.catalogModelId,
    );
    const capabilityOperations = new Set<ModelOperation>();
    for (const capability of deployment.canvasGenerationCapabilities ?? []) {
      if (
        capabilityOperations.has(capability.operation) ||
        !model?.operations.includes(capability.operation) ||
        capability.parameters.some(
          (parameter) => !CANVAS_GENERATION_PARAMETER_NAMES.includes(parameter),
        ) ||
        new Set(capability.parameters).size !== capability.parameters.length ||
        capability.inputAssetRoles.some(
          (role) => !CANVAS_GENERATION_INPUT_ASSET_ROLES.includes(role),
        ) ||
        new Set(capability.inputAssetRoles).size !==
          capability.inputAssetRoles.length
      ) {
        throw new P1DomainError(
          'INVALID_STATE',
          `Deployment ${deployment.id} has an invalid Canvas generation capability.`,
        );
      }
      capabilityOperations.add(capability.operation);
    }
    if (
      deployment.providerProfileId &&
      providerProfilesDeclared &&
      !providerProfileIds.has(deployment.providerProfileId)
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Deployment ${deployment.id} references an unknown ProviderProfile.`
      );
    }
    if (
      deployment.executionChannelId &&
      executionChannelsDeclared &&
      !executionChannelIds.has(deployment.executionChannelId)
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Deployment ${deployment.id} references an unknown ExecutionChannel.`
      );
    }
    if (providerProfilesDeclared && executionChannelsDeclared) {
      if (
        !deployment.providerProfileId ||
        !deployment.executionChannelId ||
        !deployment.apiCounterparty ||
        !deployment.credentialOwner ||
        !deployment.lifecycleRevision
      ) {
        throw new P1DomainError(
          'INVALID_STATE',
          `Deployment ${deployment.id} is missing provider/channel lifecycle facts.`
        );
      }
      const channel = executionChannelById.get(deployment.executionChannelId);
      if (
        !channel ||
        channel.providerProfileId !== deployment.providerProfileId ||
        channel.apiCounterparty !== deployment.apiCounterparty ||
        channel.apiFamily !== deployment.apiFamily ||
        channel.channel !== deployment.channel ||
        channel.region !== deployment.region ||
        channel.credentialOwner !== deployment.credentialOwner
      ) {
        throw new P1DomainError(
          'INVALID_STATE',
          `Deployment ${deployment.id} conflicts with its immutable ExecutionChannel facts.`
        );
      }
    }
    deploymentIds.add(deployment.id);
  }
  const priceIds = new Set<string>();
  const priceKeys = new Set<string>();
  for (const price of payload.prices) {
    const pricingTier = price.pricingTier;
    const executionChannelId = price.executionChannelId?.trim();
    const catalogModelId = price.catalogModelId?.trim();
    const priceKey =
      catalogModelId && executionChannelId && pricingTier
        ? `${catalogModelId}:${executionChannelId}:${pricingTier}`
        : null;
    if (
      !price.id.trim() ||
      priceIds.has(price.id) ||
      !PRICE_REVISION_PRICING_TIERS.includes(
        pricingTier as (typeof PRICE_REVISION_PRICING_TIERS)[number],
      ) ||
      !priceKey ||
      priceKeys.has(priceKey) ||
      !payload.deployments.some(
        (deployment) =>
          deployment.catalogModelId === catalogModelId &&
          deployment.executionChannelId === executionChannelId,
      )
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'PriceRevision requires a unique CatalogModel, ExecutionChannel, and pricing tier key.',
      );
    }
    priceIds.add(price.id);
    priceKeys.add(priceKey);
  }
}

function catalogPayload(value: unknown): CatalogRevisionPayload {
  const input = object(value);
  for (const key of [
    'models',
    'deployments',
    'capabilities',
    'prices',
    'routes',
  ]) {
    if (!Array.isArray(input[key])) {
      throw new P1DomainError('INVALID_STATE', `catalog.${key} must be an array.`);
    }
  }
  const payload = {
    ...(structuredClone(input) as unknown as CatalogRevisionPayload),
    providerProfiles: Array.isArray(input.providerProfiles)
      ? structuredClone(input.providerProfiles)
      : createDefaultProviderProfiles(),
    executionChannels: Array.isArray(input.executionChannels)
      ? structuredClone(input.executionChannels)
      : createDefaultExecutionChannels(),
  } as CatalogRevisionPayload;
  validateCatalogPayload(payload);
  return payload;
}

function safeCatalogModelEdits(value: unknown): SafeCatalogModelEdit[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new P1DomainError('INVALID_STATE', 'models must be a non-empty array.');
  }
  return value.map((candidate) => {
    const input = object(candidate);
    const evidence = object(input.activationEvidence);
    const status = requiredString(evidence, 'status');
    if (!['documented', 'recorded', 'live_verified'].includes(status)) {
      throw new P1DomainError('INVALID_STATE', `Unknown activation status ${status}.`);
    }
    const edit = {
      id: requiredString(input, 'id'),
      lifecycle: requiredString(input, 'lifecycle'),
      activationEvidence: {
        status,
        verifiedAt:
          typeof evidence.verifiedAt === 'string' ? evidence.verifiedAt : undefined,
        evidenceRef:
          typeof evidence.evidenceRef === 'string' ? evidence.evidenceRef : undefined,
        configurationRevision:
          typeof evidence.configurationRevision === 'string'
            ? evidence.configurationRevision
            : undefined,
      },
      allowedDataClasses: Array.isArray(input.allowedDataClasses)
        ? input.allowedDataClasses
        : [],
      deniedDataClasses: Array.isArray(input.deniedDataClasses)
        ? input.deniedDataClasses
        : [],
    } as SafeCatalogModelEdit;
    validateSafeCatalogEdit(edit);
    return edit;
  });
}

function validateSafeCatalogEdit(edit: SafeCatalogModelEdit) {
  if (!['available', 'recorded', 'unavailable'].includes(edit.lifecycle)) {
    throw new P1DomainError('INVALID_STATE', `Unknown model lifecycle ${edit.lifecycle}.`);
  }
  if (
    (edit.lifecycle === 'available' &&
      edit.activationEvidence.status !== 'live_verified') ||
    (edit.lifecycle === 'recorded' &&
      edit.activationEvidence.status !== 'recorded')
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Model lifecycle must match its activation evidence.',
    );
  }
  if (
    edit.activationEvidence.status === 'live_verified' &&
    (!edit.activationEvidence.evidenceRef?.trim() ||
      !edit.activationEvidence.configurationRevision?.trim() ||
      !edit.activationEvidence.verifiedAt ||
      !Number.isFinite(Date.parse(edit.activationEvidence.verifiedAt)) ||
      new Date(Date.parse(edit.activationEvidence.verifiedAt)).toISOString() !==
        edit.activationEvidence.verifiedAt)
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Live activation evidence requires a reference, canonical UTC timestamp, and configuration revision.',
    );
  }
  const allowed = new Set(edit.allowedDataClasses);
  const denied = new Set(edit.deniedDataClasses);
  if (
    allowed.size !== edit.allowedDataClasses.length ||
    denied.size !== edit.deniedDataClasses.length ||
    [...allowed, ...denied].some(
      (dataClass) => !allDataClasses.includes(dataClass),
    ) ||
    [...allowed].some((dataClass) => denied.has(dataClass)) ||
    allDataClasses.some(
      (dataClass) => !allowed.has(dataClass) && !denied.has(dataClass),
    )
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Allowed and denied data classes must form a complete non-overlapping policy.',
    );
  }
}

function publicCatalogRevision(revision: CatalogRevision) {
  const { payload: _payload, ...view } = revision;
  return view;
}

const adminActions = new Set([
  'admin_supply_action',
  'admin_supply_reconcile_pending',
  'activation_probe_run',
  'catalog_create_draft',
  'catalog_discover_draft',
  'catalog_create_safe_draft',
  'catalog_enable',
  'catalog_publish',
  'catalog_retire',
  'catalog_rollback',
  'prompt_revision_rollback',
  'quality_evaluation_run',
  'record_quality',
  'reconcile_cancelled_provider_terminal',
]);

const adminQueries = new Set([
  'admin_supply_action_preview',
  'admin_supply_control',
  'admin_supply_pending_actions',
  'activation_probe_runs',
  'activation_status',
  'admin_catalog_control',
  'route_simulation',
]);

function routeSelection(value: unknown): RequestedSelection {
  const input = object(value);
  const mode = requiredString(input, 'mode');
  if (mode === 'fixed') {
    return {
      mode,
      catalogModelId: requiredString(input, 'catalogModelId'),
      fallbackConsent: input.fallbackConsent === true,
    };
  }
  if (mode !== 'auto') {
    throw new P1DomainError(
      'INVALID_STATE',
      `Unknown route selection mode ${mode}.`,
    );
  }
  const profile = input.profile ?? 'quality';
  if (profile !== 'quality' && profile !== 'balanced') {
    throw new P1DomainError(
      'INVALID_STATE',
      `Unknown route profile ${String(profile)}.`,
    );
  }
  return {
    mode,
    profile,
    fallbackConsent: input.fallbackConsent !== false,
  };
}

function routeFailureScenario(value: unknown): RouteSimulationFailureScenario {
  if (
    value === 'success' ||
    value === 'rejected_before_accept' ||
    value === 'accepted_failure' ||
    value === 'acceptance_unknown'
  ) {
    return value;
  }
  throw new P1DomainError(
    'INVALID_STATE',
    'failureScenario is not supported.',
  );
}

function unavailableDeploymentIds(value: unknown) {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.some((candidate) => typeof candidate !== 'string' || !candidate)
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'unavailableDeploymentIds must be an array of deployment ids.',
    );
  }
  return [...new Set(value as string[])].sort();
}

const QUALITY_EVENT_KEYS = new Set([
  'id',
  'createdAt',
  'contentId',
  'outcome',
  'catalogModelId',
  'promptRevision',
  'exampleSetRevision',
  'scenario',
  'templateRevision',
  'editDistance',
]);
const QUALITY_OUTCOMES = new Set<QualityEvent['outcome']>([
  'adopted_directly',
  'adopted_with_small_edit',
  'rerolled',
  'abandoned',
  'published',
]);

function qualityEvent(input: Record<string, unknown>): QualityEvent {
  const unknownKey = Object.keys(input).find(
    (key) => !QUALITY_EVENT_KEYS.has(key)
  );
  if (unknownKey) {
    throw new P1DomainError(
      'INVALID_STATE',
      `Unknown quality event field ${unknownKey}.`
    );
  }
  const outcome = qualityString(input, 'outcome') as QualityEvent['outcome'];
  if (!QUALITY_OUTCOMES.has(outcome)) {
    throw new P1DomainError(
      'INVALID_STATE',
      `Unknown quality outcome ${outcome}.`
    );
  }
  const id = optionalQualityString(input, 'id');
  const createdAt = optionalQualityString(input, 'createdAt');
  if (createdAt && !Number.isFinite(Date.parse(createdAt))) {
    throw new P1DomainError(
      'INVALID_STATE',
      'createdAt must be a valid timestamp.'
    );
  }
  const contentId = optionalQualityString(input, 'contentId');
  const templateRevision = optionalQualityString(input, 'templateRevision');
  const editDistance = input.editDistance;
  if (
    editDistance !== undefined &&
    (typeof editDistance !== 'number' ||
      !Number.isFinite(editDistance) ||
      editDistance < 0 ||
      editDistance > 1)
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'editDistance must be a finite number from 0 through 1.'
    );
  }
  return {
    ...(id ? { id } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(contentId ? { contentId } : {}),
    outcome,
    catalogModelId: qualityString(input, 'catalogModelId'),
    promptRevision: qualityString(input, 'promptRevision'),
    exampleSetRevision: qualityString(input, 'exampleSetRevision'),
    scenario: qualityString(input, 'scenario'),
    ...(templateRevision ? { templateRevision } : {}),
    ...(typeof editDistance === 'number' ? { editDistance } : {}),
  };
}

function qualityString(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new P1DomainError('INVALID_STATE', `${key} is required.`);
  }
  return value;
}

function optionalQualityString(
  input: Record<string, unknown>,
  key: string
) {
  return input[key] === undefined ? undefined : qualityString(input, key);
}

function videoDataClass(value: unknown): DataClass[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new P1DomainError('INVALID_STATE', 'dataClass must be an array.');
  }
  const supported = new Set<DataClass>(['contains_face', 'pii', 'medical']);
  const normalized = [...new Set(value)];
  if (
    normalized.some(
      (item) => typeof item !== 'string' || !supported.has(item as DataClass),
    )
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'dataClass contains an unsupported value.',
    );
  }
  return (normalized as DataClass[]).sort();
}

function productUsageQuantity(
  value: unknown,
  actor: P1Context['actor']
): 0 | 1 | undefined {
  if (value === undefined) return undefined;
  if (value !== 0 && value !== 1) {
    throw new P1DomainError(
      'INVALID_STATE',
      'productUsageQuantity must be either zero or one.',
    );
  }
  if (value === 0 && actor !== 'worker') {
    throw new P1DomainError(
      'FORBIDDEN',
      'Only a trusted worker may delegate product usage settlement.',
    );
  }
  return value;
}

export class ModelSupplyFoundationModule implements P1OperationModule {
  readonly name = 'model-supply';
  private readonly adminActorIds: Set<string>;
  private readonly adminSupply?: Pick<
    AdminSupplyControlPlane,
    | 'getSnapshot'
    | 'previewAction'
    | 'dispatchAction'
    | 'listPendingActions'
    | 'reconcilePendingAction'
  >;
  private readonly videoWorkflow?: VideoWorkflowReadEditPort;
  private readonly requireReservedBilling: boolean;
  private readonly reservedBilling?: MerchantExecutionBillingPort;

  constructor(
    private readonly controlPlane: GenerationRuntimePort &
      ModelCatalogAdminPort &
      ModelPreferencePort &
      QualityEvaluationPort,
    options: {
      adminActorIds?: readonly string[];
      adminSupply?: Pick<
        AdminSupplyControlPlane,
        | 'getSnapshot'
        | 'previewAction'
        | 'dispatchAction'
        | 'listPendingActions'
        | 'reconcilePendingAction'
      >;
      videoWorkflow?: VideoWorkflowReadEditPort;
      requireReservedBilling?: boolean;
      reservedBilling?: MerchantExecutionBillingPort;
    } = {},
  ) {
    this.adminActorIds = new Set(options.adminActorIds ?? []);
    this.adminSupply = options.adminSupply;
    this.videoWorkflow = options.videoWorkflow;
    this.requireReservedBilling = options.requireReservedBilling === true;
    this.reservedBilling = options.reservedBilling;
    if (this.reservedBilling) {
      this.controlPlane.bindMerchantExecutionBilling(this.reservedBilling);
    }
  }

  async execute(args: {
    context: P1Context;
    idempotencyKey: string;
    input: Record<string, unknown>;
  }): Promise<unknown> {
    const action = requiredString(args.input, 'action');
    const payload = object(args.input.payload ?? {});
    if (
      adminActions.has(action) &&
      args.context.actor !== 'admin' &&
      !this.adminActorIds.has(args.context.userId)
    ) {
      throw new P1DomainError('FORBIDDEN', 'This command requires a trusted admin actor.');
    }

    switch (action) {
      case 'admin_supply_action':
        await this.controlPlane.initialize(args.context.workspaceId);
        return this.requireAdminSupply().dispatchAction({
          ...(structuredClone(payload) as unknown as AdminSupplyGovernedActionDispatchRequest),
          context: structuredClone(args.context),
          idempotencyKey: args.idempotencyKey,
        });
      case 'admin_supply_reconcile_pending':
        await this.controlPlane.initialize(args.context.workspaceId);
        return this.requireAdminSupply().reconcilePendingAction(args.context, {
          idempotencyKey: requiredString(payload, 'idempotencyKey'),
          payloadHash: requiredString(payload, 'payloadHash'),
        });
      case 'activation_probe_run':
        return this.controlPlane.runActivationProbe(
          args.context,
          requiredString(payload, 'deploymentId'),
          operation(payload),
          args.idempotencyKey,
        );
      case 'set_workspace_default':
        return this.controlPlane.setWorkspaceDefault(
          args.context,
          operation(payload),
          requiredString(payload, 'modelId'),
        );
      case 'set_user_default':
        return this.controlPlane.setUserDefault(
          args.context,
          operation(payload),
          requiredString(payload, 'modelId'),
        );
      case 'set_favorite':
        return this.controlPlane.setFavorite(
          args.context,
          operation(payload),
          requiredString(payload, 'modelId'),
          payload.favorite === true,
        );
      case 'record_recent':
        return this.controlPlane.recordRecent(
          args.context,
          operation(payload),
          requiredString(payload, 'modelId'),
        );
      case 'submit_generation': {
        const usageQuantity = productUsageQuantity(
          payload.productUsageQuantity,
          args.context.actor,
        );
        const requestedOperation = operation(payload);
        const billingTaskId = optionalString(payload, 'billingTaskId');
        const billingQuoteRevision = optionalString(
          payload,
          'billingQuoteRevision',
        );
        if (
          this.requireReservedBilling &&
          (!billingTaskId || !billingQuoteRevision)
        ) {
          throw new P1DomainError(
            'INVALID_STATE',
            'Merchant generation requires a reserved credit billing task and quote revision.',
          );
        }
        if (Boolean(billingTaskId) !== Boolean(billingQuoteRevision)) {
          throw new P1DomainError(
            'INVALID_STATE',
            'billingTaskId and billingQuoteRevision must be provided together.',
          );
        }
        if (this.requireReservedBilling) {
          if (!this.reservedBilling) {
            throw new P1DomainError(
              'INVALID_STATE',
              'Reserved credit billing verification is unavailable.',
            );
          }
        }
        const requestedInput =
          payload.input && typeof payload.input === 'object'
            ? (payload.input as Parameters<
                ModelSupplyApplicationService['submit']
              >[0]['input'])
            : undefined;
        const selection = object(payload.selection) as unknown as Parameters<
          ModelSupplyApplicationService['submit']
        >[0]['selection'];
        if (
          this.requireReservedBilling &&
          (payload.billingOperation !== undefined ||
            payload.billingOutputCount !== undefined)
        ) {
          throw new P1DomainError(
            'INVALID_STATE',
            'billingOperation and billingOutputCount are derived from the reserved credit quote.',
          );
        }
        return this.controlPlane.submitGeneration(
          args.context,
          {
            dataClass: Array.isArray(payload.dataClass)
              ? (payload.dataClass as Parameters<
                  ModelSupplyApplicationService['submit']
                >[0]['dataClass'])
              : [],
            input: requestedInput,
            operation: requestedOperation,
            ...(billingTaskId && billingQuoteRevision
              ? { billingTaskId, billingQuoteRevision }
              : {}),
            ...(usageQuantity === undefined
              ? {}
              : { productUsageQuantity: usageQuantity }),
            prompt: requiredString(payload, 'prompt'),
            selection,
          },
          args.idempotencyKey,
        );
      }
      case 'canvas_generation_quote':
      case 'canvas_generation_submit':
      case 'canvas_generation_retry':
      case 'canvas_generation_cancel':
        throw retiredCanvasGenerationCommand();
      case 'cancel_generation':
        return this.controlPlane.cancelGeneration(
          args.context,
          requiredString(payload, 'jobId'),
        );
      case 'reconcile_cancelled_provider_terminal':
        return this.controlPlane.reconcileCancelledProviderTerminal(
          args.context,
          {
            jobId: requiredString(payload, 'jobId'),
            providerTaskRef: requiredString(payload, 'providerTaskRef'),
          },
        );
      case 'record_quality':
        return this.controlPlane.recordQuality(
          args.context.workspaceId,
          qualityEvent(payload),
        );
      case 'video_workflow_edit': {
        const result = await this.requireVideoWorkflow().edit({
          actorId: args.context.userId,
          correlationId: args.context.correlationId,
          edit: videoWorkflowEdit(payload),
          expectedRevision: videoWorkflowExpectedRevision(
            payload.expectedRevision,
          ),
          workflowId: requiredString(payload, 'workflowId'),
          workspaceId: args.context.workspaceId,
        });
        return projectVideoWorkflowPublic(result.workflow);
      }
      case 'quality_evaluation_run':
        return this.controlPlane.runQualityEvaluation(
          args.context,
          {
            ...(typeof payload.catalogModelId === 'string'
              ? { catalogModelId: payload.catalogModelId }
              : {}),
          },
          args.idempotencyKey,
        );
      case 'catalog_create_draft':
        return publicCatalogRevision(await this.controlPlane.createCatalogDraft(
          args.context.workspaceId,
          catalogPayload(payload.catalog),
          {
            actorId: args.context.userId,
            correlationId: args.context.correlationId,
          },
        ));
      case 'catalog_discover_draft':
        return publicCatalogRevision(
          await this.controlPlane.createCatalogDiscoveryDraft(
            args.context.workspaceId,
            catalogPayload(payload.catalog),
            {
              actorId: args.context.userId,
              correlationId: args.context.correlationId,
            },
          ),
        );
      case 'catalog_create_safe_draft':
        return publicCatalogRevision(await this.controlPlane.createSafeCatalogDraft(
          args.context.workspaceId,
          safeCatalogModelEdits(payload.models),
          {
            actorId: args.context.userId,
            correlationId: args.context.correlationId,
          },
        ));
      case 'catalog_enable':
        return publicCatalogRevision(await this.controlPlane.enableCatalog(
          args.context.workspaceId,
          requiredString(payload, 'revisionId'),
          {
            actorId: args.context.userId,
            correlationId: args.context.correlationId,
          },
        ));
      case 'catalog_publish':
        return publicCatalogRevision(await this.controlPlane.publishCatalog(
          args.context.workspaceId,
          requiredString(payload, 'revisionId'),
          expectedCatalogHeadRevisionId(payload),
          typeof payload.reason === 'string'
            ? payload.reason
            : 'legacy-admin-action',
          {
            actorId: args.context.userId,
            correlationId: args.context.correlationId,
          },
        ));
      case 'catalog_retire':
        return publicCatalogRevision(await this.controlPlane.retireCatalog(
          args.context.workspaceId,
          requiredString(payload, 'revisionId'),
          typeof payload.reason === 'string'
            ? payload.reason
            : 'legacy-admin-action',
          {
            actorId: args.context.userId,
            correlationId: args.context.correlationId,
          },
        ));
      case 'catalog_rollback':
        return this.controlPlane.rollbackCatalogRevision(
          args.context,
          requiredString(payload, 'revisionId'),
          requiredString(payload, 'reason'),
        );
      case 'prompt_revision_rollback':
        return this.controlPlane.rollbackPromptRevision(
          args.context,
          requiredString(payload, 'revisionId'),
          requiredString(payload, 'reason'),
        );
      default:
        throw new P1DomainError('INVALID_STATE', `Unknown model-supply command ${action}.`);
    }
  }

  async query(args: {
    context: P1Context;
    input: Record<string, unknown>;
  }): Promise<unknown> {
    const action = requiredString(args.input, 'action');
    const payload = object(args.input.payload ?? {});
    if (
      adminQueries.has(action) &&
      args.context.actor !== 'admin' &&
      !this.adminActorIds.has(args.context.userId)
    ) {
      throw new P1DomainError(
        'FORBIDDEN',
        'This query requires a trusted admin actor.',
      );
    }
    switch (action) {
      case 'admin_supply_control':
        await this.controlPlane.initialize(args.context.workspaceId);
        return this.requireAdminSupply().getSnapshot(
          args.context,
          normalizeSupplyRunQuery(payload.runQuery),
        );
      case 'admin_supply_pending_actions':
        await this.controlPlane.initialize(args.context.workspaceId);
        return this.requireAdminSupply().listPendingActions(args.context);
      case 'admin_supply_action_preview':
        await this.controlPlane.initialize(args.context.workspaceId);
        return this.requireAdminSupply().previewAction({
          ...(structuredClone(payload) as unknown as AdminSupplyGovernedActionRequest),
          context: structuredClone(args.context),
        });
      case 'activation_probe_runs':
        return this.controlPlane.listActivationProbeRuns(
          args.context.workspaceId,
        );
      case 'activation_status':
        return this.controlPlane.activationStatus(args.context.workspaceId);
      case 'catalog':
        return this.controlPlane.getCatalog(
          args.context.workspaceId,
          operation(payload),
        );
      case 'canvas_generation_catalog':
      case 'canvas_generation_job':
      case 'canvas_generation_jobs':
        throw retiredCanvasGenerationCommand();
      case 'admin_catalog_control':
        return this.controlPlane.getAdminCatalogControl(
          args.context.workspaceId,
        );
      case 'preferences':
        return this.controlPlane.getPreferences(
          args.context.workspaceId,
          args.context.userId,
          operation(payload),
        );
      case 'job':
        return this.controlPlane.getJob(
          args.context.workspaceId,
          requiredString(payload, 'jobId'),
        );
      case 'quality_dashboard':
        return this.controlPlane.qualityDashboard(args.context.workspaceId);
      case 'quality_evaluations':
        return this.controlPlane.listQualityEvaluations(args.context.workspaceId);
      case 'quality_evaluation':
        return this.controlPlane.getQualityEvaluation(
          args.context.workspaceId,
          requiredString(payload, 'runId'),
        );
      case 'prompt_revisions':
        return this.controlPlane.promptRevisionView(args.context.workspaceId);
      case 'catalog_revisions':
        return this.controlPlane.listCatalogRevisionActivity(
          args.context.workspaceId,
        );
      case 'revision_rollback_audits':
        return this.controlPlane.listRevisionRollbackAudits(
          args.context.workspaceId,
        );
      case 'route_simulation':
        return this.controlPlane.simulateRoute(args.context, {
          operation: operation(payload),
          selection: routeSelection(payload.selection),
          dataClass: videoDataClass(payload.dataClass),
          failureScenario: routeFailureScenario(payload.failureScenario),
          unavailableDeploymentIds: unavailableDeploymentIds(
            payload.unavailableDeploymentIds,
          ),
        });
      case 'video_workflow_public': {
        const current = await this.requireVideoWorkflow().query({
          workflowId: requiredString(payload, 'workflowId'),
          workspaceId: args.context.workspaceId,
        });
        if (current.workflow.actorId !== args.context.userId) {
          throw new P1DomainError(
            'FORBIDDEN',
            'This video workflow belongs to another actor.',
          );
        }
        return projectVideoWorkflowPublic(current.workflow);
      }
      case 'video_workflows': {
        const listed = await this.requireVideoWorkflow().list({
          actorId: args.context.userId,
          workspaceId: args.context.workspaceId,
        });
        return listed.map((item) => projectVideoWorkflowPublic(item.workflow));
      }
      default:
        throw new P1DomainError('INVALID_STATE', `Unknown model-supply query ${action}.`);
    }
  }

  private requireAdminSupply() {
    if (!this.adminSupply) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Admin supply control plane is not configured.',
      );
    }
    return this.adminSupply;
  }

  private requireVideoWorkflow() {
    if (!this.videoWorkflow) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Canonical video workflow is not configured.',
      );
    }
    return this.videoWorkflow;
  }
}

export interface VideoWorkflowReadEditPort {
  edit(input: EditVideoWorkflowInput): Promise<{
    workflow: DurableVideoWorkflow;
  }>;
  list(input: {
    actorId: string;
    workspaceId: string;
  }): Promise<Array<{ workflow: DurableVideoWorkflow }>>;
  query(input: {
    workflowId: string;
    workspaceId: string;
  }): Promise<{ workflow: DurableVideoWorkflow }>;
}

function videoWorkflowEdit(
  payload: Record<string, unknown>,
): EditVideoWorkflowInput['edit'] {
  const edit = object(payload.edit);
  const kind = requiredString(edit, 'kind');
  if (kind === 'select_candidate') {
    return {
      candidateIndex: videoCandidateIndex(edit.candidateIndex),
      kind,
      shotId: requiredString(edit, 'shotId'),
    };
  }
  if (kind === 'reorder_shots') {
    if (!Array.isArray(edit.shotIds) || edit.shotIds.length === 0) {
      throw new P1DomainError(
        'INVALID_STATE',
        'shotIds must be a non-empty array.',
      );
    }
    return {
      kind,
      shotIds: edit.shotIds.map((shotId) =>
        requiredString({ shotId }, 'shotId'),
      ),
    };
  }
  throw new P1DomainError('INVALID_STATE', `Unknown video edit ${kind}.`);
}

function videoWorkflowExpectedRevision(value: unknown) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      'expectedRevision must be a non-negative integer.',
    );
  }
  return value;
}

function videoCandidateIndex(value: unknown) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      'candidateIndex must be a non-negative integer.',
    );
  }
  return value;
}
