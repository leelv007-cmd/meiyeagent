import { randomUUID } from 'node:crypto';
import type { ProductRole } from '@meiye/contracts';
import type {
  P1Context,
  GenerationJob,
  OwnedAsset,
  ProviderAttempt,
  ProviderCostEvent,
  ProductEntitlementEvent,
  RelationFact,
  UsageEvent,
  UsageResource,
  RouteSnapshot,
  CutoverRecord,
  CommandAuditEvent,
} from './domain.js';
import { P1DomainError, REGISTER_GIFT_GRANT_KEY } from './domain.js';
import type {
  FoundationRepository,
  FoundationStore,
  IdempotentExecution,
} from './ports.js';

interface StoredResult {
  payloadHash: string;
  value: unknown;
}

interface StoredModuleCommand {
  payloadHash: string;
  status: 'pending' | 'completed';
  claimToken?: string;
  leaseExpiresAt?: string;
  value?: unknown;
}

export class MemoryFoundationRepository implements FoundationRepository {
  private readonly memberships = new Map<
    string,
    Exclude<ProductRole, 'admin'>
  >();
  private facts = new Map<string, RelationFact>();
  private usageEvents: UsageEvent[] = [];
  private routeSnapshots = new Map<string, RouteSnapshot>();
  private generationJobs = new Map<string, GenerationJob>();
  private attempts = new Map<string, ProviderAttempt>();
  private providerCosts: ProviderCostEvent[] = [];
  private entitlementEvents: ProductEntitlementEvent[] = [];
  private assets = new Map<string, OwnedAsset>();
  private commandResults = new Map<string, StoredResult>();
  private moduleCommands = new Map<string, StoredModuleCommand>();
  private cutovers = new Map<string, CutoverRecord>();
  private commandAudits: CommandAuditEvent[] = [];
  private readonly transactionTails = new Map<string, Promise<void>>();

  constructor(
    private readonly clock: () => Date = () => new Date(),
    private readonly moduleCommandLeaseMs = 5 * 60 * 1000
  ) {}

  grantOwner(workspaceId: string, userId: string) {
    this.grantMembership(workspaceId, userId, 'owner');
  }

  grantMembership(
    workspaceId: string,
    userId: string,
    role: Exclude<ProductRole, 'admin'>
  ) {
    this.memberships.set(`${workspaceId}:${userId}`, role);
  }

  async getOwnerRole(context: P1Context): Promise<'owner' | null> {
    return (await this.getWorkspaceRole(context)) === 'owner' ? 'owner' : null;
  }

  async getWorkspaceRole(context: P1Context) {
    return this.memberships.get(`${context.workspaceId}:${context.userId}`) ?? null;
  }

  async executeIdempotent<T>(
    context: P1Context,
    idempotencyKey: string,
    payloadHash: string,
    action: (store: FoundationStore) => Promise<T>
  ): Promise<IdempotentExecution<T>> {
    const previous =
      this.transactionTails.get(context.workspaceId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.transactionTails.set(context.workspaceId, tail);
    await previous;
    try {
      return await this.executeIdempotentUnlocked(
        context,
        idempotencyKey,
        payloadHash,
        action,
      );
    } finally {
      release();
      if (this.transactionTails.get(context.workspaceId) === tail) {
        this.transactionTails.delete(context.workspaceId);
      }
    }
  }

  private async executeIdempotentUnlocked<T>(
    context: P1Context,
    idempotencyKey: string,
    payloadHash: string,
    action: (store: FoundationStore) => Promise<T>
  ): Promise<IdempotentExecution<T>> {
    const key = `${context.workspaceId}:${idempotencyKey}`;
    const existing = this.commandResults.get(key);
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new P1DomainError('IDEMPOTENCY_CONFLICT', 'Idempotency key was reused with a different payload.');
      }
      return { replayed: true, value: structuredClone(existing.value) as T };
    }

    const factsBefore = structuredClone(this.facts);
    const usageBefore = structuredClone(this.usageEvents);
    const snapshotsBefore = structuredClone(this.routeSnapshots);
    const jobsBefore = structuredClone(this.generationJobs);
    const attemptsBefore = structuredClone(this.attempts);
    const costsBefore = structuredClone(this.providerCosts);
    const entitlementsBefore = structuredClone(this.entitlementEvents);
    const assetsBefore = structuredClone(this.assets);
    const cutoversBefore = structuredClone(this.cutovers);
    const auditsBefore = structuredClone(this.commandAudits);
    try {
      const value = await action(this);
      this.commandAudits.push({
        workspaceId: context.workspaceId, idempotencyKey, payloadHash,
        actorId: context.userId, correlationId: context.correlationId,
        createdAt: new Date().toISOString(),
      });
      this.commandResults.set(key, { payloadHash, value: structuredClone(value) });
      return { replayed: false, value };
    } catch (error) {
      this.facts = factsBefore;
      this.usageEvents = usageBefore;
      this.routeSnapshots = snapshotsBefore;
      this.generationJobs = jobsBefore;
      this.attempts = attemptsBefore;
      this.providerCosts = costsBefore;
      this.entitlementEvents = entitlementsBefore;
      this.assets = assetsBefore;
      this.cutovers = cutoversBefore;
      this.commandAudits = auditsBefore;
      throw error;
    }
  }

  async claimModuleCommand<T>(
    context: P1Context,
    idempotencyKey: string,
    payloadHash: string
  ) {
    const key = `${context.workspaceId}:${idempotencyKey}`;
    const existing = this.moduleCommands.get(key);
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'Idempotency key was reused with a different payload.'
        );
      }
      if (existing.status === 'completed') {
        return {
          decision: 'replay' as const,
          value: structuredClone(existing.value) as T,
        };
      }
      if (
        existing.leaseExpiresAt &&
        Date.parse(existing.leaseExpiresAt) > this.clock().getTime()
      ) {
        return { decision: 'in_progress' as const };
      }
      const claimToken = randomUUID();
      this.moduleCommands.set(key, {
        ...existing,
        claimToken,
        leaseExpiresAt: new Date(
          this.clock().getTime() + this.moduleCommandLeaseMs
        ).toISOString(),
      });
      return { decision: 'execute' as const, claimToken };
    }
    const claimToken = randomUUID();
    this.moduleCommands.set(key, {
      claimToken,
      leaseExpiresAt: new Date(
        this.clock().getTime() + this.moduleCommandLeaseMs
      ).toISOString(),
      payloadHash,
      status: 'pending',
    });
    return { decision: 'execute' as const, claimToken };
  }

  async completeModuleCommand<T>(
    context: P1Context,
    idempotencyKey: string,
    payloadHash: string,
    claimToken: string,
    value: T
  ) {
    const key = `${context.workspaceId}:${idempotencyKey}`;
    const existing = this.moduleCommands.get(key);
    if (
      !existing ||
      existing.payloadHash !== payloadHash ||
      existing.status !== 'pending' ||
      existing.claimToken !== claimToken
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Module command claim was not found.'
      );
    }
    this.moduleCommands.set(key, {
      payloadHash,
      status: 'completed',
      value: structuredClone(value),
    });
    this.commandAudits.push({
      workspaceId: context.workspaceId,
      idempotencyKey,
      payloadHash,
      actorId: context.userId,
      correlationId: context.correlationId,
      createdAt: new Date().toISOString(),
    });
  }

  async renewModuleCommand(
    context: P1Context,
    idempotencyKey: string,
    payloadHash: string,
    claimToken: string
  ) {
    const key = `${context.workspaceId}:${idempotencyKey}`;
    const existing = this.moduleCommands.get(key);
    if (
      !existing ||
      existing.payloadHash !== payloadHash ||
      existing.status !== 'pending' ||
      existing.claimToken !== claimToken
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Module command claim was not found.'
      );
    }
    this.moduleCommands.set(key, {
      ...existing,
      leaseExpiresAt: new Date(
        this.clock().getTime() + this.moduleCommandLeaseMs
      ).toISOString(),
    });
  }

  async abandonModuleCommand(
    context: P1Context,
    idempotencyKey: string,
    payloadHash: string,
    claimToken: string
  ) {
    const key = `${context.workspaceId}:${idempotencyKey}`;
    const existing = this.moduleCommands.get(key);
    if (
      existing?.status === 'pending' &&
      existing.payloadHash === payloadHash &&
      existing.claimToken === claimToken
    ) {
      this.moduleCommands.delete(key);
    }
  }

  async insertRelationFact(fact: RelationFact) {
    const key = `${fact.workspaceId}:${fact.id}`;
    if (this.facts.has(key)) throw new P1DomainError('INVALID_STATE', 'Relation fact already exists.');
    this.facts.set(key, structuredClone(fact));
  }

  async getRelationFact(workspaceId: string, factId: string) {
    const fact = this.facts.get(`${workspaceId}:${factId}`);
    return fact ? structuredClone(fact) : null;
  }

  async appendUsageEvent(event: UsageEvent) {
    if (this.usageEvents.some((item) => item.workspaceId === event.workspaceId && item.id === event.id)) {
      throw new P1DomainError('INVALID_STATE', 'Usage event already exists.');
    }
    this.usageEvents.push(structuredClone(event));
  }

  async listUsageEvents(workspaceId: string, resource: UsageResource) {
    return structuredClone(
      this.usageEvents.filter((event) => event.workspaceId === workspaceId && event.resource === resource)
    );
  }

  async insertRouteSnapshot(snapshot: RouteSnapshot) {
    const key = `${snapshot.workspaceId}:${snapshot.id}`;
    if (this.routeSnapshots.has(key)) throw new P1DomainError('INVALID_STATE', 'Route snapshot already exists.');
    this.routeSnapshots.set(key, structuredClone(snapshot));
  }

  async getRouteSnapshot(workspaceId: string, snapshotId: string) {
    const value = this.routeSnapshots.get(`${workspaceId}:${snapshotId}`);
    return value ? structuredClone(value) : null;
  }

  async insertGenerationJob(job: GenerationJob) {
    const key = `${job.workspaceId}:${job.id}`;
    if (this.generationJobs.has(key)) throw new P1DomainError('INVALID_STATE', 'Generation job already exists.');
    this.generationJobs.set(key, structuredClone(job));
  }

  async getGenerationJob(workspaceId: string, jobId: string) {
    const value = this.generationJobs.get(`${workspaceId}:${jobId}`);
    return value ? structuredClone(value) : null;
  }

  async updateGenerationJob(job: GenerationJob) {
    const key = `${job.workspaceId}:${job.id}`;
    if (!this.generationJobs.has(key)) throw new P1DomainError('NOT_FOUND', 'Generation job was not found.');
    this.generationJobs.set(key, structuredClone(job));
  }

  async listGenerationDurationSamples(
    workspaceId: string,
    operation: GenerationJob['operation'],
    catalogModelId: string,
    since: string
  ) {
    const sinceMs = Date.parse(since);
    return [...this.generationJobs.values()].flatMap((job) => {
      if (
        job.workspaceId !== workspaceId ||
        job.operation !== operation ||
        job.status !== 'completed' ||
        Date.parse(job.createdAt) < sinceMs
      ) {
        return [];
      }
      const snapshot = this.routeSnapshots.get(
        `${workspaceId}:${job.routeSnapshotId}`
      );
      const candidate = snapshot?.allowedCandidates[0];
      if (
        snapshot?.requestedCatalogModelId !== catalogModelId ||
        candidate?.catalogModelId !== catalogModelId ||
        candidate.activationStatus !== 'live_verified'
      ) {
        return [];
      }
      const seconds = Math.round(
        (Date.parse(job.updatedAt) - Date.parse(job.createdAt)) / 1_000
      );
      return seconds > 0 ? [seconds] : [];
    });
  }

  async insertProviderAttempt(attempt: ProviderAttempt) {
    const key = `${attempt.workspaceId}:${attempt.id}`;
    if (this.attempts.has(key)) throw new P1DomainError('INVALID_STATE', 'Provider attempt already exists.');
    this.attempts.set(key, structuredClone(attempt));
  }

  async listProviderAttempts(workspaceId: string, jobId: string) {
    return structuredClone([...this.attempts.values()].filter((item) => item.workspaceId === workspaceId && item.jobId === jobId));
  }

  async getProviderAttempt(workspaceId: string, attemptId: string) {
    const value = this.attempts.get(`${workspaceId}:${attemptId}`);
    return value ? structuredClone(value) : null;
  }

  async updateProviderAttempt(attempt: ProviderAttempt) {
    const key = `${attempt.workspaceId}:${attempt.id}`;
    if (!this.attempts.has(key)) throw new P1DomainError('NOT_FOUND', 'Provider attempt was not found.');
    this.attempts.set(key, structuredClone(attempt));
  }

  async appendProviderCost(event: ProviderCostEvent) {
    if (this.providerCosts.some((item) => item.workspaceId === event.workspaceId && item.id === event.id)) {
      throw new P1DomainError('INVALID_STATE', 'Provider cost event already exists.');
    }
    this.providerCosts.push(structuredClone(event));
  }

  async listProviderCosts(workspaceId: string, attemptId: string) {
    return structuredClone(this.providerCosts.filter((item) => item.workspaceId === workspaceId && item.attemptId === attemptId));
  }

  async appendProductEntitlementEvent(event: ProductEntitlementEvent) {
    if (
      this.entitlementEvents.some(
        (item) => item.workspaceId === event.workspaceId && item.id === event.id,
      )
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Product entitlement event already exists.',
      );
    }
    if (
      'paymentEventId' in event &&
      this.entitlementEvents.some(
        (item) =>
          item.workspaceId === event.workspaceId &&
          'paymentEventId' in item &&
          item.paymentEventId === event.paymentEventId,
      )
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Payment event already activated an entitlement.',
      );
    }
    if (
      event.kind === 'plan_activated' &&
      event.grantKey === REGISTER_GIFT_GRANT_KEY &&
      this.entitlementEvents.some(
        (item) =>
          item.workspaceId === event.workspaceId &&
          item.kind === 'plan_activated' &&
          item.grantKey === REGISTER_GIFT_GRANT_KEY,
      )
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Register gift already activated an entitlement.',
      );
    }
    this.entitlementEvents.push(structuredClone(event));
  }

  async listProductEntitlementEvents(workspaceId: string) {
    return structuredClone(
      this.entitlementEvents.filter(
        (event) => event.workspaceId === workspaceId,
      ),
    );
  }

  async insertOwnedAsset(asset: OwnedAsset) {
    const key = `${asset.workspaceId}:${asset.id}`;
    if (this.assets.has(key)) throw new P1DomainError('INVALID_STATE', 'Owned asset already exists.');
    this.assets.set(key, structuredClone(asset));
  }

  async getOwnedAsset(workspaceId: string, assetId: string) {
    const asset = this.assets.get(`${workspaceId}:${assetId}`);
    return asset ? structuredClone(asset) : null;
  }

  async insertCutover(record: CutoverRecord) {
    const key = `${record.workspaceId}:${record.id}`;
    if (this.cutovers.has(key)) throw new P1DomainError('INVALID_STATE', 'Cutover record already exists.');
    this.cutovers.set(key, structuredClone(record));
  }

  async getCutover(workspaceId: string, cutoverId: string) {
    const value = this.cutovers.get(`${workspaceId}:${cutoverId}`);
    return value ? structuredClone(value) : null;
  }

  async updateCutover(record: CutoverRecord) {
    const key = `${record.workspaceId}:${record.id}`;
    if (!this.cutovers.has(key)) throw new P1DomainError('NOT_FOUND', 'Cutover record was not found.');
    this.cutovers.set(key, structuredClone(record));
  }

  async listCommandAudits(workspaceId: string) {
    return structuredClone(this.commandAudits.filter((event) => event.workspaceId === workspaceId));
  }
}
