/**
 * Admin supply control-plane application seam (#124 / #125).
 *
 * This module only composes current domain truth and governs calls into the
 * existing route, channel, credential, and health domains. It owns no catalog,
 * lifecycle, credential, routing, or audit persistence of its own.
 */
import { createHash } from 'node:crypto';
import {
  requiredP1Capability,
  type CredentialAccountMetadata,
  type HealthOverlayPort,
  type HealthOverlayView,
  type P1Module,
  type ProductCapability,
  type RoutePolicyRevision,
  type SupplierPriceRevision,
  type SupplyCatalogModel,
  type SupplyContract,
  type SupplyDataClass,
  type SupplyDeployment,
  type SupplyExecutionChannel,
  type SupplyOperation,
  type SupplyPool,
  type SupplyProviderProfile,
} from '@meiye/contracts';
import {
  assertPermissionAuditFields,
  projectPermissionAudit,
  type PermissionAuditProjection,
} from '../capability-permission/audit.js';
import type { PermissionAuthorizerPort } from '../capability-permission/port.js';
import { P1DomainError, type P1Context } from '../foundation/domain.js';
import type {
  AccountAllocation,
  AccountAllocationStatus,
  EntitlementPolicyRevision,
  EntitlementPolicyStage,
} from '../entitlement-pools/contracts.js';
import { MODEL_OPERATIONS } from '../model-supply/supply-contracts.js';
import {
  assertNoSecretEcho,
  PLATFORM_CREDENTIAL_WORKSPACE_ID,
  toPublicMetadata,
  type CredentialAccount,
} from './credential-account.js';
import type { ExpandedSupplyRegistrySnapshot } from './expand.js';
import type {
  ModelSupplyRouteSimulationInput,
  RequestedSelection,
} from '../model-supply/route-contracts.js';
import {
  assertSharedExplanationProjection,
  type RouteDecisionExplanation,
} from './route-explanation.js';

export const CORE_SUPPLY_OPERATIONS = [
  'copy.generate',
  'image.generate',
  'video.generate',
] as const satisfies readonly SupplyOperation[];

export type CoreSupplyOperation = (typeof CORE_SUPPLY_OPERATIONS)[number];

export interface SupplyRunRecord {
  id: string;
  taskId: string;
  operation: SupplyOperation;
  modality: 'llm' | 'image' | 'video' | 'audio';
  status:
    | 'queued'
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'draining'
    | 'accepted'
    | 'acceptance_unknown'
    | 'rejected_before_accept';
  catalogModelId: string;
  deploymentId: string;
  providerProfileId: string;
  executionChannelId: string;
  channelKind: 'official_direct' | 'upstream_reseller';
  workspaceId: string;
  accountId: string;
  dataClass: SupplyDataClass;
  startedAt: string;
  endedAt?: string;
  latencyMs?: number;
  queueMs?: number;
  providerMs?: number;
  postprocessMs?: number;
  costMicros?: number;
  currency?: 'CNY' | 'USD';
  errorCode?: string;
  errorMessage?: string;
  artifactPreviewUrl?: string;
  attemptCount: number;
  lifecycle:
    | 'sync_attempt'
    | 'async_submit'
    | 'async_poll'
    | 'async_recover'
    | 'terminal';
  routePolicyRevisionId?: string;
  poolId?: string;
  decisionExplanation?: RouteDecisionExplanation;
}

export type SupplyRunSortField =
  | 'startedAt'
  | 'latencyMs'
  | 'status'
  | 'operation'
  | 'costMicros';

export interface SupplyRunQuery {
  page: number;
  pageSize: number;
  sort: SupplyRunSortField;
  dir: 'asc' | 'desc';
  operation?: SupplyOperation;
  status?: SupplyRunRecord['status'];
  modality?: SupplyRunRecord['modality'];
  channelKind?: SupplyRunRecord['channelKind'];
  catalogModelId?: string;
  deploymentId?: string;
  dataClass?: SupplyDataClass;
  q?: string;
  taskId?: string;
}

export const DEFAULT_SUPPLY_RUN_QUERY: SupplyRunQuery = {
  page: 1,
  pageSize: 20,
  sort: 'startedAt',
  dir: 'desc',
};

export function normalizeSupplyRunQuery(input: unknown): SupplyRunQuery {
  const record =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const positiveInteger = (key: 'page' | 'pageSize', fallback: number) => {
    const value = record[key];
    if (value === undefined) return fallback;
    if (!Number.isInteger(value) || Number(value) < 1) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Supply run ${key} must be a positive integer.`,
      );
    }
    return Number(value);
  };
  const enumValue = <T extends string>(
    key: string,
    allowed: readonly T[],
  ): T | undefined => {
    const value = record[key];
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Supply run ${key} is invalid.`,
      );
    }
    return value as T;
  };
  const stringValue = (key: string): string | undefined => {
    const value = record[key];
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string' || !value.trim()) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Supply run ${key} must be a non-empty string.`,
      );
    }
    return value.trim().slice(0, 256);
  };
  const query: SupplyRunQuery = {
    page: positiveInteger('page', DEFAULT_SUPPLY_RUN_QUERY.page),
    pageSize: Math.min(
      positiveInteger('pageSize', DEFAULT_SUPPLY_RUN_QUERY.pageSize),
      100,
    ),
    sort:
      enumValue('sort', [
        'startedAt',
        'latencyMs',
        'status',
        'operation',
        'costMicros',
      ] as const) ?? DEFAULT_SUPPLY_RUN_QUERY.sort,
    dir:
      enumValue('dir', ['asc', 'desc'] as const) ??
      DEFAULT_SUPPLY_RUN_QUERY.dir,
  };
  const operation = enumValue(
    'operation',
    MODEL_OPERATIONS as readonly SupplyOperation[],
  );
  const status = enumValue('status', [
    'queued',
    'running',
    'succeeded',
    'failed',
    'draining',
    'accepted',
    'acceptance_unknown',
    'rejected_before_accept',
  ] as const);
  const modality = enumValue(
    'modality',
    ['llm', 'image', 'video', 'audio'] as const,
  );
  const channelKind = enumValue(
    'channelKind',
    ['official_direct', 'upstream_reseller'] as const,
  );
  const dataClass = enumValue(
    'dataClass',
    ['public', 'contains_face', 'pii', 'medical', 'medical-health'] as const,
  );
  return {
    ...query,
    ...(operation ? { operation } : {}),
    ...(status ? { status } : {}),
    ...(modality ? { modality } : {}),
    ...(channelKind ? { channelKind } : {}),
    ...(dataClass ? { dataClass } : {}),
    ...(stringValue('catalogModelId')
      ? { catalogModelId: stringValue('catalogModelId') }
      : {}),
    ...(stringValue('deploymentId')
      ? { deploymentId: stringValue('deploymentId') }
      : {}),
    ...(stringValue('q') ? { q: stringValue('q') } : {}),
    ...(stringValue('taskId') ? { taskId: stringValue('taskId') } : {}),
  };
}

export interface SupplyRunPage {
  query: SupplyRunQuery;
  total: number;
  totalPages: number;
  rows: SupplyRunRecord[];
  facets: {
    operations: SupplyOperation[];
    statuses: SupplyRunRecord['status'][];
    modalities: SupplyRunRecord['modality'][];
    channelKinds: SupplyRunRecord['channelKind'][];
    dataClasses: SupplyDataClass[];
  };
}

export interface SupplyAuditChange {
  id: string;
  at: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
  correlationId: string;
}

export interface SupplyGatewayDeepLink {
  id: string;
  label: string;
  href: string;
  gatewayFingerprint: string;
  evidenceOnly: true;
}

export interface EntitlementPolicyStatusRecord {
  id: string;
  tier: string;
  revision: number;
  stage: EntitlementPolicyStage;
  revisionId: string;
  concurrencyLimit: number;
  queuePriority: number;
  supportLabel: 'standard' | 'priority';
  publishedAt?: string;
  actorId?: string;
  reason?: string;
}

export interface AccountAllocationStatusRecord {
  id: string;
  accountId: string;
  workspaceId: string;
  kind: 'grant' | 'restrict';
  targetLabel: string;
  source: string;
  status: AccountAllocationStatus;
  reason: string;
  startsAt: string;
  endsAt: string | null;
}

/** Structurally identical to the Web J4 SupplyControlSnapshot. */
export interface SupplyControlSnapshot {
  catalogRevisionId: string;
  catalogRevisionNumber: number;
  capturedAt: string;
  models: SupplyCatalogModel[];
  providerProfiles: SupplyProviderProfile[];
  executionChannels: SupplyExecutionChannel[];
  deployments: SupplyDeployment[];
  contracts: SupplyContract[];
  credentials: CredentialAccountMetadata[];
  pools: SupplyPool[];
  entitlementPolicies: EntitlementPolicyStatusRecord[];
  accountAllocations: AccountAllocationStatusRecord[];
  /** All immutable candidate and retained RoutePolicy revisions. */
  routePolicyRevisions?: RoutePolicyRevision[];
  /** Revisions that have previously been effective and are valid rollback targets. */
  routePolicyPublicationHistory?: RoutePolicyRevision[];
  /** Current effective heads only. */
  routePolicies: RoutePolicyRevision[];
  priceRevisions: SupplierPriceRevision[];
  healthOverlays: HealthOverlayView[];
  runPage: SupplyRunPage;
  /** Current page rows retained for overview and task projection compatibility. */
  runs: SupplyRunRecord[];
  recentChanges: SupplyAuditChange[];
  gatewayDeepLinks: SupplyGatewayDeepLink[];
  featuredCoreModelIds: Partial<Record<CoreSupplyOperation, string>>;
}

export interface SupplyControlRegistryReadPort {
  getCurrentRegistryRevision(
    workspaceId: string,
  ): Promise<ExpandedSupplyRegistrySnapshot | null>;
  listCredentialAccounts(
    workspaceId: string,
  ): Promise<Array<{ account: CredentialAccount; recordRevision: number }>>;
}

export interface SupplyControlSnapshotPorts {
  registry: SupplyControlRegistryReadPort;
  channelLifecycle: {
    getChannelLifecycle(
      channelId: string,
    ): Promise<{ lifecycleRevision: string }>;
  };
  pools: {
    listSupplyPools(workspaceId: string): Promise<SupplyPool[]>;
  };
  entitlements: {
    listEntitlementPolicies(
      workspaceId: string,
    ): Promise<EntitlementPolicyRevision[]>;
    listAccountAllocations(workspaceId: string): Promise<AccountAllocation[]>;
  };
  routes: {
    listPublishedRoutePolicies(
      workspaceId: string,
    ): Promise<RoutePolicyRevision[]>;
    listRoutePolicyRevisions(
      workspaceId: string,
    ): Promise<RoutePolicyRevision[]>;
    listRoutePolicyPublicationHistory(
      workspaceId: string,
    ): Promise<RoutePolicyRevision[]>;
  };
  prices: {
    listSupplierPriceRevisions(
      workspaceId: string,
    ): Promise<SupplierPriceRevision[]>;
  };
  health: HealthOverlayPort;
  runs: {
    listSupplyRuns(
      workspaceId: string,
      query: SupplyRunQuery,
    ): Promise<SupplyRunPage>;
  };
  changes: {
    listRecentSupplyChanges(
      workspaceId: string,
    ): Promise<SupplyAuditChange[]>;
  };
  gateways: {
    listGatewayDeepLinks(workspaceId: string): Promise<SupplyGatewayDeepLink[]>;
  };
  featuredModels: {
    getFeaturedCoreModelIds(
      workspaceId: string,
    ): Promise<Partial<Record<CoreSupplyOperation, string>>>;
  };
}

export type GovernedSupplyActionId =
  | 'connectivity_probe'
  | 'conformance_probe'
  | 'candidate_config_save'
  | 'candidate_config_validate'
  | 'route_simulate'
  | 'publish'
  | 'rollback'
  | 'isolate'
  | 'recover'
  | 'drain'
  | 'credential_pre_revoke'
  | 'credential_rotate'
  | 'health_refresh';

export type OperationActionTarget = {
  resourceType: 'operation';
  resourceId: SupplyOperation;
};

export type ProbeActionTarget = {
  resourceType: 'deployment';
  resourceId: string;
};

export type RevisionActionTarget = {
  resourceType: 'catalog_revision' | 'route_policy';
  resourceId: string;
};

export type RoutePolicyActionTarget = {
  resourceType: 'route_policy';
  resourceId: string;
};

export type ChannelActionTarget = {
  resourceType: 'channel';
  resourceId: string;
};

export type CredentialActionTarget = {
  resourceType: 'credential_account';
  resourceId: string;
};

export type HealthActionTarget = {
  resourceType: 'deployment' | 'channel' | 'credential_account' | 'pool';
  resourceId: string;
};

type GovernedRequest<
  Action extends GovernedSupplyActionId,
  Target,
  Parameters = undefined,
> = {
  action: Action;
  context: P1Context;
  target: Target;
  /** Concrete operator reason; at least eight trimmed characters. */
  reason: string;
  /** Required CAS field. Null is valid only for an initial publish/simulation. */
  expectedRevisionId: string | null;
  /** Required even for governed queries because their audit is immutable. */
  idempotencyKey: string;
} & ([Parameters] extends [undefined]
  ? { parameters?: never }
  : {
      /** Action-specific input. Secret material must never enter this boundary. */
      parameters: Parameters;
    });

export type ProbeActionParameters = {
  deploymentId: string;
  operation: SupplyOperation;
  probeKind: 'connectivity' | 'conformance';
};

export type RouteSimulationParameters = Omit<
  ModelSupplyRouteSimulationInput,
  'workspaceId'
> & {
  selection: RequestedSelection;
  acceptance?: 'rejected_before_accept' | 'accepted' | 'acceptance_unknown';
  retryIntent?: 'none' | 'query' | 'reconcile' | 'manual_recovery';
};

export type CandidateConfigValidationParameters = RouteSimulationParameters & {
  routePolicyRevisionId: string;
};

export type CandidateConfigSaveParameters = {
  candidate: RoutePolicyRevision;
};

export type CredentialRotationParameters = {
  /** Receipt from the server-side secret broker; never the secret value. */
  secureWriteReceiptId: string;
};

export type RouteGovernedActionRequest =
  | GovernedRequest<
      'connectivity_probe' | 'conformance_probe',
      ProbeActionTarget,
      ProbeActionParameters
    >
  | GovernedRequest<
      'candidate_config_save',
      RoutePolicyActionTarget,
      CandidateConfigSaveParameters
    >
  | GovernedRequest<
      'candidate_config_validate',
      RoutePolicyActionTarget,
      CandidateConfigValidationParameters
    >
  | GovernedRequest<
      'route_simulate',
      OperationActionTarget,
      RouteSimulationParameters
    >
  | GovernedRequest<'publish' | 'rollback', RevisionActionTarget>;

export type ChannelGovernedActionRequest = GovernedRequest<
  'isolate' | 'recover' | 'drain',
  ChannelActionTarget
>;

export type CredentialGovernedActionRequest = GovernedRequest<
  'credential_pre_revoke',
  CredentialActionTarget
> | GovernedRequest<
  'credential_rotate',
  CredentialActionTarget,
  CredentialRotationParameters
>;

export type HealthGovernedActionRequest = GovernedRequest<
  'health_refresh',
  HealthActionTarget
>;

export type AdminSupplyGovernedActionRequest =
  | RouteGovernedActionRequest
  | ChannelGovernedActionRequest
  | CredentialGovernedActionRequest
  | HealthGovernedActionRequest;

type WithApprovedPreview<T> = T extends unknown
  ? T & { approvedPreviewId: string }
  : never;

export type AdminSupplyGovernedActionDispatchRequest =
  WithApprovedPreview<AdminSupplyGovernedActionRequest>;

export interface GovernedSupplyImpactPreview {
  /** Opaque domain-issued token/revision digest. */
  id: string;
  scope: string;
  changes: string[];
  warnings: string[];
  reversible: boolean;
  expectedRevisionId: string | null;
  before: unknown | null;
  after: unknown | null;
  /** Required on route simulation and candidate validation previews. */
  routeDecision?: RouteDecisionExplanation;
}

export interface GovernedSupplyActionExecution {
  request: AdminSupplyGovernedActionRequest;
  preview: GovernedSupplyImpactPreview;
  audit: PermissionAuditProjection;
  idempotency: {
    workspaceId: string;
    key: string;
    payloadHash: string;
  };
}

export interface GovernedRouteDecisionProjection {
  simulator: RouteDecisionExplanation;
  taskAudit: RouteDecisionExplanation;
}

export interface GovernedSupplyDomainResult {
  value: unknown;
  /** The domain adapter persists this audit atomically with its action. */
  audit: PermissionAuditProjection;
  /** Required for route simulation and candidate validation. */
  routeDecision?: GovernedRouteDecisionProjection;
}

/**
 * Adapter seam over existing domain services. Implementations must enforce CAS
 * and atomically persist action + immutable audit + idempotency result. Domain
 * idempotency is mandatory: the outer response cache is not a commit boundary,
 * so a crash or output-safety rejection must never execute the mutation twice.
 */
export interface AdminSupplyGovernedDomainPort {
  preview(
    request: AdminSupplyGovernedActionRequest,
  ): Promise<GovernedSupplyImpactPreview>;
  execute(
    input: GovernedSupplyActionExecution,
  ): Promise<GovernedSupplyDomainResult>;
  /** Read an already-persisted outcome after an execution-result crash window. */
  queryOutcome(
    input: GovernedSupplyActionExecution,
  ): Promise<GovernedSupplyDomainResult | null>;
}

export interface AdminSupplyGovernedPorts {
  routes: AdminSupplyGovernedDomainPort;
  channels: AdminSupplyGovernedDomainPort;
  credentials: AdminSupplyGovernedDomainPort;
  health: AdminSupplyGovernedDomainPort;
}

export interface AdminSupplyIdempotencyPort {
  /** Implementations cache terminal success and rejection for the payload hash. */
  executeIdempotent<T>(input: {
    workspaceId: string;
    idempotencyKey: string;
    payloadHash: string;
    prepare?: () => Promise<unknown>;
    execute: (recoveryContext?: unknown) => Promise<T>;
  }): Promise<{ replayed: boolean; value: T }>;
  listPendingExecutions(
    workspaceId: string,
  ): Promise<PendingAdminSupplyExecution[]>;
  reconcilePendingExecution<T = unknown>(input: {
    workspaceId: string;
    idempotencyKey: string;
    payloadHash: string;
    recover?: (recoveryContext: unknown) => Promise<T | null>;
  }): Promise<{ replayed: boolean; value: T }>;
}

export interface PendingAdminSupplyExecution {
  idempotencyKey: string;
  payloadHash: string;
  outcome: 'recorded' | 'recoverable' | 'outcome_unknown';
  createdAt: string;
  executedAt?: string;
}

export interface GovernedSupplyDispatchResult {
  action: GovernedSupplyActionId;
  target: AdminSupplyGovernedActionRequest['target'];
  value: unknown;
  audit: PermissionAuditProjection;
  routeDecision?: GovernedRouteDecisionProjection;
  replayed: boolean;
}

type ActionAuthorization = {
  kind: 'command' | 'query';
  module: P1Module;
  authorizationAction: string;
};

type GovernedPortKey = keyof AdminSupplyGovernedPorts;

type ActionDescriptor = ActionAuthorization & {
  domain: GovernedPortKey;
  targetTypes: readonly string[];
  nullCas: boolean;
  reversible: boolean;
};

const ACTIONS: Record<GovernedSupplyActionId, ActionDescriptor> = {
  connectivity_probe: {
    kind: 'command',
    module: 'model-supply',
    authorizationAction: 'activation_probe_run',
    domain: 'routes',
    targetTypes: ['deployment'],
    nullCas: false,
    reversible: false,
  },
  conformance_probe: {
    kind: 'command',
    module: 'model-supply',
    authorizationAction: 'activation_probe_run',
    domain: 'routes',
    targetTypes: ['deployment'],
    nullCas: false,
    reversible: false,
  },
  candidate_config_validate: {
    kind: 'query',
    module: 'model-supply',
    authorizationAction: 'route_simulation',
    domain: 'routes',
    targetTypes: ['route_policy'],
    nullCas: true,
    reversible: false,
  },
  candidate_config_save: {
    kind: 'command',
    module: 'model-supply',
    authorizationAction: 'admin_supply_action',
    domain: 'routes',
    targetTypes: ['route_policy'],
    nullCas: false,
    reversible: false,
  },
  route_simulate: {
    kind: 'query',
    module: 'model-supply',
    authorizationAction: 'route_simulation',
    domain: 'routes',
    targetTypes: ['operation'],
    nullCas: true,
    reversible: false,
  },
  publish: {
    kind: 'command',
    module: 'model-supply',
    authorizationAction: 'catalog_publish',
    domain: 'routes',
    targetTypes: ['catalog_revision', 'route_policy'],
    nullCas: true,
    reversible: false,
  },
  rollback: {
    kind: 'command',
    module: 'model-supply',
    authorizationAction: 'catalog_rollback',
    domain: 'routes',
    targetTypes: ['catalog_revision', 'route_policy'],
    nullCas: false,
    reversible: false,
  },
  isolate: {
    kind: 'command',
    module: 'model-supply',
    authorizationAction: 'isolate_channel',
    domain: 'channels',
    targetTypes: ['channel'],
    nullCas: false,
    reversible: true,
  },
  recover: {
    kind: 'command',
    module: 'model-supply',
    authorizationAction: 'recover_channel',
    domain: 'channels',
    targetTypes: ['channel'],
    nullCas: false,
    reversible: true,
  },
  drain: {
    kind: 'command',
    module: 'model-supply',
    authorizationAction: 'drain_channel',
    domain: 'channels',
    targetTypes: ['channel'],
    nullCas: false,
    reversible: true,
  },
  credential_pre_revoke: {
    kind: 'query',
    module: 'integrations',
    authorizationAction: 'admin_provider_credentials',
    domain: 'credentials',
    targetTypes: ['credential_account'],
    nullCas: false,
    reversible: false,
  },
  credential_rotate: {
    kind: 'command',
    module: 'integrations',
    authorizationAction: 'admin_rotate_provider_credential',
    domain: 'credentials',
    targetTypes: ['credential_account'],
    nullCas: false,
    reversible: false,
  },
  health_refresh: {
    kind: 'query',
    module: 'model-supply',
    authorizationAction: 'activation_status',
    domain: 'health',
    targetTypes: ['deployment', 'channel', 'credential_account', 'pool'],
    nullCas: false,
    reversible: false,
  },
};

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

function dispatchPayloadHash(
  request: AdminSupplyGovernedActionDispatchRequest,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        stable({
          action: request.action,
          actor: request.context.actor,
          approvedPreviewId: request.approvedPreviewId,
          correlationId: request.context.correlationId,
          expectedRevisionId: request.expectedRevisionId,
          parameters: request.parameters ?? {},
          reason: request.reason.trim(),
          target: request.target,
          userId: request.context.userId,
        }),
      ),
    )
    .digest('hex');
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function assertPublicPayloadSafe(payload: unknown): void {
  assertNoSecretEcho(payload);
  const json = JSON.stringify(payload);
  if (json === undefined) return;
  if (
    /"(accessToken|refreshToken|credential|secretValue)"\s*:/i.test(json) ||
    /[?&](?:api[_-]?key|access[_-]?token|secret|token)=[^&"\s]+/i.test(json)
  ) {
    throw new Error('Admin supply public payload must not echo secrets.');
  }
}

function assertNoBlindMediaRetry(
  request: AdminSupplyGovernedActionRequest,
): void {
  const parameters = request.parameters as
    | Readonly<Record<string, unknown>>
    | undefined;
  const acceptance = parameters?.acceptance;
  const safeRetryValues = new Set<unknown>([
    false,
    0,
    null,
    'none',
    'query',
    'reconcile',
    'manual_recovery',
  ]);
  const containsBlindRetry = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(containsBlindRetry);
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value as Record<string, unknown>).some(
      ([key, item]) => {
        const retryField = /retry|resubmit/i.test(key);
        if (retryField && !safeRetryValues.has(item)) return true;
        return containsBlindRetry(item);
      },
    );
  };
  if (
    (acceptance === 'accepted' || acceptance === 'acceptance_unknown') &&
    containsBlindRetry(parameters)
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Accepted or acceptance_unknown media must be queried or reconciled, never blindly resubmitted.',
    );
  }
}

function auditActionFor(request: AdminSupplyGovernedActionRequest): string {
  if (request.target.resourceType === 'route_policy') {
    if (request.action === 'publish') return 'route_policy_publish';
    if (request.action === 'rollback') return 'route_policy_rollback';
  }
  switch (request.action) {
    case 'connectivity_probe':
    case 'conformance_probe':
    case 'candidate_config_save':
    case 'candidate_config_validate':
    case 'credential_pre_revoke':
      return request.action;
    case 'health_refresh':
      return 'health_balance_refresh';
    default:
      break;
  }
  return ACTIONS[request.action].authorizationAction;
}

function validateActionParameters(request: AdminSupplyGovernedActionRequest): void {
  const parameters = (request.parameters ?? {}) as Record<string, unknown>;
  if (request.action === 'candidate_config_save') {
    const candidate = parameters.candidate as
      | Partial<RoutePolicyRevision>
      | undefined;
    if (
      !candidate ||
      typeof candidate.id !== 'string' ||
      !candidate.id.trim() ||
      typeof candidate.revisionId !== 'string' ||
      !candidate.revisionId.trim() ||
      !(MODEL_OPERATIONS as readonly SupplyOperation[]).includes(
        candidate.operation as SupplyOperation,
      ) ||
      !['quality', 'balanced', 'auto'].includes(
        candidate.qualityTier ?? 'quality',
      ) ||
      !Array.isArray(candidate.hardConstraints) ||
      !candidate.hardConstraints.every(
        (constraint) => typeof constraint === 'string' && constraint.trim(),
      ) ||
      !Array.isArray(candidate.candidateDeploymentIds) ||
      candidate.candidateDeploymentIds.length === 0 ||
      !candidate.candidateDeploymentIds.every(
        (deploymentId) =>
          typeof deploymentId === 'string' && deploymentId.trim(),
      ) ||
      !Number.isInteger(candidate.maxAttempts) ||
      Number(candidate.maxAttempts) < 1 ||
      typeof candidate.fallbackAuthorized !== 'boolean' ||
      candidate.publishedAt !== undefined
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'RoutePolicy candidate save requires a complete unpublished immutable revision.',
      );
    }
  }
  if (
    request.action === 'connectivity_probe' ||
    request.action === 'conformance_probe'
  ) {
    const expectedProbeKind =
      request.action === 'conformance_probe'
        ? 'conformance'
        : 'connectivity';
    if (
      parameters.deploymentId !== request.target.resourceId ||
      !(MODEL_OPERATIONS as readonly SupplyOperation[]).includes(
        parameters.operation as SupplyOperation,
      ) ||
      parameters.probeKind !== expectedProbeKind
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Probe parameters must identify the target deployment, a supported operation, and the exact probe kind.',
      );
    }
  }
  if (
    request.action === 'candidate_config_validate' ||
    request.action === 'route_simulate'
  ) {
    if (
      !(MODEL_OPERATIONS as readonly SupplyOperation[]).includes(
        parameters.operation as SupplyOperation,
      ) ||
      !parameters.selection ||
      typeof parameters.selection !== 'object' ||
      !Array.isArray(parameters.dataClass) ||
      !['success', 'rejected_before_accept', 'accepted_failure', 'acceptance_unknown'].includes(
        String(parameters.failureScenario),
      ) ||
      !Array.isArray(parameters.unavailableDeploymentIds)
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Route simulation requires matching operation, selection, and dataClass parameters.',
      );
    }
  }
  if (
    request.action === 'route_simulate' &&
    parameters.operation !== request.target.resourceId
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Route simulation operation must match the operation target.',
    );
  }
  if (
    request.action === 'candidate_config_validate' &&
    parameters.routePolicyRevisionId !== request.target.resourceId
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Candidate validation requires a routePolicyRevisionId matching the target revision.',
    );
  }
  if (
    request.action === 'credential_rotate'
  ) {
    assertPublicPayloadSafe(parameters);
    if (
      typeof parameters.secureWriteReceiptId !== 'string' ||
      !parameters.secureWriteReceiptId.trim()
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Credential rotation requires a secureWriteReceiptId and never accepts raw secret material.',
      );
    }
  }
}

function requireCurrentRegistry(
  current: ExpandedSupplyRegistrySnapshot | null,
): asserts current is ExpandedSupplyRegistrySnapshot & {
  catalogRevisionId: string;
  catalogRevisionNumber: number;
} {
  if (!current) {
    throw new P1DomainError(
      'NOT_FOUND',
      'The effective supply registry was not found.',
    );
  }
  if (
    !current.catalogRevisionId ||
    typeof current.catalogRevisionNumber !== 'number'
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'The effective supply registry is missing its durable revision identity.',
    );
  }
}

function entitlementPolicyStatus(
  policy: EntitlementPolicyRevision,
): EntitlementPolicyStatusRecord {
  return {
    id: policy.id,
    tier: policy.tier,
    revision: policy.revision,
    stage: policy.stage,
    revisionId: policy.id,
    concurrencyLimit: policy.body.concurrencyLimit,
    queuePriority: policy.body.queuePriority,
    supportLabel: policy.body.supportLabel,
    publishedAt: policy.createdAt,
    actorId: policy.actorId,
    reason: policy.reason,
  };
}

function allocationTargetLabel(target: AccountAllocation['target']): string {
  switch (target.type) {
    case 'catalog_model':
      return `catalog_model:${target.catalogModelId}`;
    case 'quality_tier':
      return `quality_tier:${target.qualityTier}`;
    case 'supply_pool':
      return `supply_pool:${target.supplyPoolId}`;
    case 'allowance':
      return `allowance:${target.resource}`;
    case 'concurrency':
    case 'queue_priority':
      return target.type;
  }
}

function accountAllocationStatus(
  allocation: AccountAllocation,
): AccountAllocationStatusRecord {
  return {
    id: allocation.id,
    accountId: allocation.accountId,
    workspaceId: allocation.workspaceId,
    kind: allocation.kind,
    targetLabel: allocationTargetLabel(allocation.target),
    source: allocation.source,
    status: allocation.status,
    reason: allocation.reason,
    startsAt: allocation.startsAt,
    endsAt: allocation.endsAt,
  };
}

export class AdminSupplyControlPlane {
  private readonly snapshot: SupplyControlSnapshotPorts;
  private readonly permission: PermissionAuthorizerPort;
  private readonly idempotency: AdminSupplyIdempotencyPort;
  private readonly governed: AdminSupplyGovernedPorts;
  private readonly clock: () => Date;

  constructor(options: {
    snapshot: SupplyControlSnapshotPorts;
    permission: PermissionAuthorizerPort;
    idempotency: AdminSupplyIdempotencyPort;
    governed: AdminSupplyGovernedPorts;
    clock?: () => Date;
  }) {
    this.snapshot = options.snapshot;
    this.permission = options.permission;
    this.idempotency = options.idempotency;
    this.governed = options.governed;
    this.clock = options.clock ?? (() => new Date());
  }

  async getSnapshot(
    context: P1Context,
    runQuery: SupplyRunQuery = DEFAULT_SUPPLY_RUN_QUERY,
  ): Promise<SupplyControlSnapshot> {
    this.permission.authorize({
      actor: context.actor,
      kind: 'query',
      module: 'model-supply',
      action: 'capability_registry',
    });

    const [
      current,
      credentialRows,
      pools,
      entitlementPolicies,
      accountAllocations,
      routePolicyRevisions,
      routePolicyPublicationHistory,
      routePolicies,
      priceRevisions,
      healthRecords,
      runPage,
      recentChanges,
      gatewayDeepLinks,
      featuredCoreModelIds,
    ] = await Promise.all([
      this.snapshot.registry.getCurrentRegistryRevision(context.workspaceId),
      this.snapshot.registry.listCredentialAccounts(
        PLATFORM_CREDENTIAL_WORKSPACE_ID,
      ),
      this.snapshot.pools.listSupplyPools(context.workspaceId),
      this.snapshot.entitlements.listEntitlementPolicies(context.workspaceId),
      this.snapshot.entitlements.listAccountAllocations(context.workspaceId),
      this.snapshot.routes.listRoutePolicyRevisions(context.workspaceId),
      this.snapshot.routes.listRoutePolicyPublicationHistory(
        context.workspaceId,
      ),
      this.snapshot.routes.listPublishedRoutePolicies(context.workspaceId),
      this.snapshot.prices.listSupplierPriceRevisions(context.workspaceId),
      this.snapshot.health.list(),
      this.snapshot.runs.listSupplyRuns(context.workspaceId, runQuery),
      this.snapshot.changes.listRecentSupplyChanges(context.workspaceId),
      this.snapshot.gateways.listGatewayDeepLinks(context.workspaceId),
      this.snapshot.featuredModels.getFeaturedCoreModelIds(context.workspaceId),
    ]);
    requireCurrentRegistry(current);
    const executionChannels = await Promise.all(
      current.executionChannels.map(async (channel) => ({
        ...structuredClone(channel),
        lifecycleRevision: (
          await this.snapshot.channelLifecycle.getChannelLifecycle(channel.id)
        ).lifecycleRevision,
      })),
    );

    const result: SupplyControlSnapshot = {
      catalogRevisionId: current.catalogRevisionId,
      catalogRevisionNumber: current.catalogRevisionNumber,
      capturedAt: this.clock().toISOString(),
      models: structuredClone(current.models),
      providerProfiles: structuredClone(current.providerProfiles),
      executionChannels,
      deployments: structuredClone(current.deployments),
      contracts: structuredClone(current.contracts),
      credentials: credentialRows.map(({ account }) => toPublicMetadata(account)),
      pools: structuredClone(pools),
      entitlementPolicies: entitlementPolicies.map(entitlementPolicyStatus),
      accountAllocations: accountAllocations
        .filter((allocation) => allocation.target.type !== 'allowance')
        .map(accountAllocationStatus),
      routePolicyRevisions: structuredClone(routePolicyRevisions),
      routePolicyPublicationHistory: structuredClone(
        routePolicyPublicationHistory,
      ),
      routePolicies: structuredClone(routePolicies),
      priceRevisions: structuredClone(priceRevisions),
      healthOverlays: healthRecords.map((record) => ({
        targetId: record.targetId,
        state: record.state,
        reason: record.reason,
        source: record.source,
        startedAt: record.startedAt,
        ...(record.endsAt ? { endsAt: record.endsAt } : {}),
      })),
      runPage: structuredClone(runPage),
      runs: structuredClone(runPage.rows),
      recentChanges: structuredClone(recentChanges),
      gatewayDeepLinks: structuredClone(gatewayDeepLinks),
      featuredCoreModelIds: structuredClone(featuredCoreModelIds),
    };
    assertPublicPayloadSafe(result);
    return result;
  }

  async previewAction(
    request: AdminSupplyGovernedActionRequest,
  ): Promise<GovernedSupplyImpactPreview> {
    this.validateAndAuthorize(request);
    const preview = await this.domainFor(request.action).preview(request);
    this.assertPreview(request, preview);
    return structuredClone(preview);
  }

  async dispatchAction(
    request: AdminSupplyGovernedActionDispatchRequest,
  ): Promise<GovernedSupplyDispatchResult> {
    const { permission, descriptor } = this.validateAndAuthorize(request);
    if (!request.approvedPreviewId?.trim()) {
      throw new P1DomainError(
        'INVALID_STATE',
        'An approved impact preview is required.',
      );
    }

    const payloadHash = dispatchPayloadHash(request);
    const execution = await this.idempotency.executeIdempotent({
      workspaceId: request.context.workspaceId,
      idempotencyKey: request.idempotencyKey,
      payloadHash,
      prepare: async () => {
        const preview = await this.domainFor(request.action).preview(request);
        this.assertPreview(request, preview);
        if (preview.id !== request.approvedPreviewId) {
          throw new P1DomainError(
            'IDEMPOTENCY_CONFLICT',
            'The approved impact preview is stale or does not match the current target.',
          );
        }

        const audit = projectPermissionAudit({
          actor: {
            userId: request.context.userId,
            role:
              typeof request.context.actor === 'string'
                ? request.context.actor
                : null,
          },
          permission,
          target: {
            kind: descriptor.kind,
            module: descriptor.module,
            action: auditActionFor(request),
            resourceId: request.target.resourceId,
            resourceType: request.target.resourceType,
          },
          reason: request.reason.trim(),
          before: preview.before,
          after: preview.after,
          correlationId: request.context.correlationId,
          occurredAt: this.clock().toISOString(),
        });
        assertPublicPayloadSafe(audit);
        return {
          request,
          preview,
          audit,
          idempotency: {
            workspaceId: request.context.workspaceId,
            key: request.idempotencyKey,
            payloadHash,
          },
        } satisfies GovernedSupplyActionExecution;
      },
      execute: async (recoveryContext) => {
        const prepared = this.assertRecoveryContext(
          recoveryContext,
          request.context.workspaceId,
          request.idempotencyKey,
          payloadHash,
        );
        const result = await this.domainFor(request.action).execute(prepared);
        const { preview, audit } = prepared;
        this.assertDomainResult(request, preview, audit, result);
        return {
          action: request.action,
          target: structuredClone(request.target),
          value: structuredClone(result.value),
          audit: structuredClone(result.audit),
          ...(result.routeDecision
            ? { routeDecision: structuredClone(result.routeDecision) }
            : {}),
        };
      },
    });

    return { ...execution.value, replayed: execution.replayed };
  }

  async listPendingActions(
    context: P1Context,
  ): Promise<PendingAdminSupplyExecution[]> {
    this.permission.authorize({
      actor: context.actor,
      kind: 'query',
      module: 'model-supply',
      action: 'admin_supply_pending_actions',
    });
    const pending = await this.idempotency.listPendingExecutions(
      context.workspaceId,
    );
    assertPublicPayloadSafe(pending);
    return structuredClone(pending);
  }

  async reconcilePendingAction(
    context: P1Context,
    input: { idempotencyKey: string; payloadHash: string },
  ): Promise<{ replayed: boolean; value: unknown }> {
    this.permission.authorize({
      actor: context.actor,
      kind: 'command',
      module: 'model-supply',
      action: 'admin_supply_reconcile_pending',
    });
    if (!input.idempotencyKey?.trim() || !input.payloadHash?.trim()) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Pending reconciliation requires the original idempotency key and payload hash.',
      );
    }
    const result = await this.idempotency.reconcilePendingExecution({
      workspaceId: context.workspaceId,
      idempotencyKey: input.idempotencyKey.trim(),
      payloadHash: input.payloadHash.trim(),
      recover: async (recoveryContext) => {
        const prepared = this.assertRecoveryContext(
          recoveryContext,
          context.workspaceId,
          input.idempotencyKey.trim(),
          input.payloadHash.trim(),
        );
        const domainResult = await this.domainFor(
          prepared.request.action,
        ).queryOutcome(prepared);
        if (domainResult === null) return null;
        this.assertDomainResult(
          prepared.request,
          prepared.preview,
          prepared.audit,
          domainResult,
        );
        return {
          action: prepared.request.action,
          target: structuredClone(prepared.request.target),
          value: structuredClone(domainResult.value),
          audit: structuredClone(domainResult.audit),
          ...(domainResult.routeDecision
            ? { routeDecision: structuredClone(domainResult.routeDecision) }
            : {}),
        };
      },
    });
    assertPublicPayloadSafe(result);
    return structuredClone(result);
  }

  private assertRecoveryContext(
    value: unknown,
    workspaceId: string,
    idempotencyKey: string,
    payloadHash: string,
  ): GovernedSupplyActionExecution {
    const candidate = value as Partial<GovernedSupplyActionExecution> | null;
    const recoveredRequest = candidate?.request as
      | AdminSupplyGovernedActionDispatchRequest
      | undefined;
    if (
      !candidate ||
      !recoveredRequest ||
      !candidate.preview ||
      !candidate.audit ||
      !recoveredRequest.approvedPreviewId?.trim() ||
      recoveredRequest.context.workspaceId !== workspaceId ||
      recoveredRequest.idempotencyKey !== idempotencyKey ||
      candidate.idempotency?.workspaceId !== workspaceId ||
      candidate.idempotency.key !== idempotencyKey ||
      candidate.idempotency.payloadHash !== payloadHash ||
      candidate.preview.id !== recoveredRequest.approvedPreviewId ||
      dispatchPayloadHash(recoveredRequest) !== payloadHash ||
      candidate.audit.actor.userId !== recoveredRequest.context.userId ||
      candidate.audit.correlationId !==
        recoveredRequest.context.correlationId ||
      candidate.audit.reason !== recoveredRequest.reason.trim() ||
      candidate.audit.target.resourceId !==
        recoveredRequest.target.resourceId ||
      candidate.audit.target.resourceType !==
        recoveredRequest.target.resourceType ||
      !valuesEqual(candidate.audit.before, candidate.preview.before) ||
      !valuesEqual(candidate.audit.after, candidate.preview.after)
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'The pending governed action recovery context is missing or does not match its immutable identity.',
      );
    }
    assertPublicPayloadSafe(candidate);
    return structuredClone(candidate as GovernedSupplyActionExecution);
  }

  private validateAndAuthorize(request: AdminSupplyGovernedActionRequest): {
    descriptor: ActionDescriptor;
    permission: ProductCapability;
  } {
    const descriptor = ACTIONS[request.action];
    if (!descriptor) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Unknown governed supply action ${String(request.action)}.`,
      );
    }
    if (!request.reason || request.reason.trim().length < 8) {
      throw new P1DomainError(
        'INVALID_STATE',
        'A concrete governed-action reason of at least eight characters is required.',
      );
    }
    if (
      !('expectedRevisionId' in request) ||
      request.expectedRevisionId === undefined
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'expectedRevisionId is required for the CAS contract.',
      );
    }
    if (
      request.expectedRevisionId === null &&
      !descriptor.nullCas
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        `${request.action} requires a non-empty expectedRevisionId CAS value.`,
      );
    }
    if (
      typeof request.expectedRevisionId === 'string' &&
      !request.expectedRevisionId.trim()
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'expectedRevisionId cannot be blank.',
      );
    }
    if (!request.idempotencyKey?.trim()) {
      throw new P1DomainError(
        'INVALID_STATE',
        'A non-empty idempotency key is required.',
      );
    }
    if (
      !request.target?.resourceId?.trim() ||
      !descriptor.targetTypes.includes(request.target.resourceType)
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Invalid target for governed action ${request.action}.`,
      );
    }

    assertNoBlindMediaRetry(request);
    validateActionParameters(request);
    this.permission.authorize({
      actor: request.context.actor,
      kind: descriptor.kind,
      module: descriptor.module,
      action: descriptor.authorizationAction,
    });
    const permission = requiredP1Capability(
      descriptor.kind,
      descriptor.module,
      descriptor.authorizationAction,
    );
    if (!permission) {
      throw new P1DomainError(
        'FORBIDDEN',
        'The governed supply action is not registered for authorization.',
      );
    }
    return { descriptor, permission };
  }

  private domainFor(action: GovernedSupplyActionId): AdminSupplyGovernedDomainPort {
    return this.governed[ACTIONS[action].domain];
  }

  private assertPreview(
    request: AdminSupplyGovernedActionRequest,
    preview: GovernedSupplyImpactPreview,
  ): void {
    if (!preview.id?.trim() || !preview.scope?.trim()) {
      throw new P1DomainError(
        'INVALID_STATE',
        'The domain impact preview must include an id and scope.',
      );
    }
    if (!Array.isArray(preview.changes) || preview.changes.length === 0) {
      throw new P1DomainError(
        'INVALID_STATE',
        'The domain impact preview must describe at least one change.',
      );
    }
    if (preview.expectedRevisionId !== request.expectedRevisionId) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'The impact preview was built for a different CAS revision.',
      );
    }
    if (ACTIONS[request.action].reversible && !preview.reversible) {
      throw new P1DomainError(
        'INVALID_STATE',
        `${request.action} must expose reversible channel semantics.`,
      );
    }
    if (
      (request.action === 'route_simulate' ||
        request.action === 'candidate_config_validate') &&
      preview.routeDecision?.surface !== 'simulator'
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Route impact preview must include the shared simulator decision explanation.',
      );
    }
    assertPublicPayloadSafe(preview);
  }

  private assertDomainResult(
    request: AdminSupplyGovernedActionRequest,
    preview: GovernedSupplyImpactPreview,
    expectedAudit: PermissionAuditProjection,
    result: GovernedSupplyDomainResult,
  ): void {
    assertPermissionAuditFields(result.audit);
    if (!valuesEqual(result.audit, expectedAudit)) {
      throw new P1DomainError(
        'INVALID_STATE',
        'The domain result did not persist the immutable governed-action audit contract.',
      );
    }
    assertPublicPayloadSafe(result.audit);
    assertPublicPayloadSafe(result.value);
    if (
      request.action === 'route_simulate' ||
      request.action === 'candidate_config_validate'
    ) {
      if (
        !result.routeDecision ||
        result.routeDecision.simulator.surface !== 'simulator' ||
        result.routeDecision.taskAudit.surface !== 'task_audit'
      ) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Route simulation must return the shared simulator and task-audit decision explanation.',
        );
      }
      assertSharedExplanationProjection(
        result.routeDecision.simulator,
        result.routeDecision.taskAudit,
      );
      if (!valuesEqual(result.routeDecision.simulator, preview.routeDecision)) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'The executed route explanation diverged from the approved simulator preview.',
        );
      }
      assertPublicPayloadSafe(result.routeDecision);
    }
  }
}
