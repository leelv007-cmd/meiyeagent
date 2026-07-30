import type { ProductRole } from '@meiye/contracts';
import type {
  GenerationJob,
  OwnedAsset,
  P1Context,
  ProviderAttempt,
  ProviderCostEvent,
  ProductEntitlementEvent,
  RelationFact,
  RouteSnapshot,
  CutoverRecord,
  CommandAuditEvent,
  UsageEvent,
  UsageResource,
} from './domain.js';

export interface IdempotentExecution<T> {
  replayed: boolean;
  value: T;
}

export interface FoundationStore {
  getOwnerRole(context: P1Context): Promise<'owner' | null>;
  getWorkspaceRole(
    context: P1Context
  ): Promise<Exclude<ProductRole, 'admin'> | null>;
  insertRelationFact(fact: RelationFact): Promise<void>;
  getRelationFact(workspaceId: string, factId: string): Promise<RelationFact | null>;
  appendUsageEvent(event: UsageEvent): Promise<void>;
  listUsageEvents(workspaceId: string, resource: UsageResource): Promise<UsageEvent[]>;
  insertRouteSnapshot(snapshot: RouteSnapshot): Promise<void>;
  getRouteSnapshot(workspaceId: string, snapshotId: string): Promise<RouteSnapshot | null>;
  insertGenerationJob(job: GenerationJob): Promise<void>;
  getGenerationJob(workspaceId: string, jobId: string): Promise<GenerationJob | null>;
  updateGenerationJob(job: GenerationJob): Promise<void>;
  listGenerationDurationSamples(
    workspaceId: string,
    operation: GenerationJob['operation'],
    catalogModelId: string,
    since: string
  ): Promise<number[]>;
  insertProviderAttempt(attempt: ProviderAttempt): Promise<void>;
  listProviderAttempts(workspaceId: string, jobId: string): Promise<ProviderAttempt[]>;
  getProviderAttempt(workspaceId: string, attemptId: string): Promise<ProviderAttempt | null>;
  updateProviderAttempt(attempt: ProviderAttempt): Promise<void>;
  appendProviderCost(event: ProviderCostEvent): Promise<void>;
  listProviderCosts(workspaceId: string, attemptId: string): Promise<ProviderCostEvent[]>;
  appendProductEntitlementEvent(event: ProductEntitlementEvent): Promise<void>;
  listProductEntitlementEvents(workspaceId: string): Promise<ProductEntitlementEvent[]>;
  insertOwnedAsset(asset: OwnedAsset): Promise<void>;
  getOwnedAsset(workspaceId: string, assetId: string): Promise<OwnedAsset | null>;
  insertCutover(record: CutoverRecord): Promise<void>;
  getCutover(workspaceId: string, cutoverId: string): Promise<CutoverRecord | null>;
  updateCutover(record: CutoverRecord): Promise<void>;
  listCommandAudits(workspaceId: string): Promise<CommandAuditEvent[]>;
}

export interface FoundationRepository extends FoundationStore {
  executeIdempotent<T>(
    context: P1Context,
    idempotencyKey: string,
    payloadHash: string,
    action: (store: FoundationStore) => Promise<T>
  ): Promise<IdempotentExecution<T>>;
  claimModuleCommand<T>(
    context: P1Context,
    idempotencyKey: string,
    payloadHash: string
  ): Promise<
    | { decision: 'execute'; claimToken: string }
    | { decision: 'in_progress' }
    | { decision: 'replay'; value: T }
  >;
  renewModuleCommand(
    context: P1Context,
    idempotencyKey: string,
    payloadHash: string,
    claimToken: string
  ): Promise<void>;
  completeModuleCommand<T>(
    context: P1Context,
    idempotencyKey: string,
    payloadHash: string,
    claimToken: string,
    value: T
  ): Promise<void>;
  abandonModuleCommand(
    context: P1Context,
    idempotencyKey: string,
    payloadHash: string,
    claimToken: string
  ): Promise<void>;
}

export interface P1OperationModule {
  name: string;
  execute(args: {
    context: P1Context;
    input: Record<string, unknown>;
    store: FoundationStore;
    idempotencyKey: string;
  }): Promise<unknown>;
  query?(args: {
    context: P1Context;
    input: Record<string, unknown>;
    store: FoundationStore;
  }): Promise<unknown>;
}

export interface JobPort {
  enqueue(input: {
    jobId: string;
    workspaceId: string;
    kind: string;
    runAt?: string;
    payload: Record<string, unknown>;
    scheduling?: {
      queuePriority: number;
      workspaceConcurrencyLimit: number;
    };
  }): Promise<void>;
  /**
   * Enqueues a new transport for an existing logical job after an explicit
   * failed-job resume. Implementations must not relax normal enqueue
   * idempotency to provide this capability.
   */
  resume?(
    input: {
      jobId: string;
      workspaceId: string;
      kind: string;
      runAt?: string;
      payload: Record<string, unknown>;
      scheduling?: {
        queuePriority: number;
        workspaceConcurrencyLimit: number;
      };
    },
    sequence: number
  ): Promise<void>;
  cancel(workspaceId: string, jobId: string): Promise<void>;
}

export interface ProviderExecutionPort {
  execute(input: {
    operation: string;
    routeSnapshotId: string;
    payload: Record<string, unknown>;
  }): Promise<{ acceptance: 'rejected_before_accept' | 'accepted' | 'acceptance_unknown'; taskRef?: string }>;
}

export interface SecretPort {
  put(workspaceId: string, value: string): Promise<{ secretRef: string; version: string }>;
  revoke(workspaceId: string, secretRef: string): Promise<void>;
}

export interface StoragePort {
  persist(input: {
    workspaceId: string;
    sourceUrl: string;
    expectedHash?: string;
  }): Promise<{ objectKey: string; sha256: string; sizeBytes: number }>;
}

export interface SearchPort {
  search(workspaceId: string, query: string): Promise<Array<{ id: string; score: number }>>;
}

export interface DouyinPort {
  submit(workspaceId: string, payload: Record<string, unknown>): Promise<{ externalId?: string; status: string }>;
}

export interface McpPort {
  call(workspaceId: string, toolId: string, input: Record<string, unknown>): Promise<unknown>;
}
