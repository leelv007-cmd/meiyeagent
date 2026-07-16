import type {
  CommandResult,
  ProductContext,
  ProductState,
} from '@meiye/contracts';
import type { CopyProviderRequest } from './copy-provider.js';

export interface PendingCopyExecution {
  providerSlot: 'domestic' | 'standard';
  providerName: string;
  providerModel: string;
  providerRegion: 'domestic' | 'overseas' | 'local';
  request: CopyProviderRequest;
  reservationId?: string;
  agentRunId: string;
  toolCallId: string;
}

export type IdempotentProductOutcome =
  | { kind: 'success'; result: CommandResult }
  | {
      kind: 'pending';
      startedAt: string;
      correlationId: string;
      claimToken?: string;
      leaseExpiresAt?: string;
      execution?: PendingCopyExecution;
    }
  | {
      kind: 'error';
      error: {
        code: string;
        message: string;
        status: number;
        details?: Record<string, unknown>;
      };
    };

export interface LoadedIdempotentProductOutcome {
  matches: boolean;
  outcome: IdempotentProductOutcome;
}

export interface ProductRepository {
  withWorkspaceLock<T>(
    workspaceId: string,
    action: (repository: ProductRepository) => Promise<T>
  ): Promise<T>;
  hasMembership(userId: string, workspaceId: string): Promise<boolean>;
  getMembershipRole(userId: string, workspaceId: string): Promise<string | null>;
  getFutureWriteOwner(
    workspaceId: string
  ): Promise<'legacy' | 'frozen' | 'p1'>;
  load(workspaceId: string): Promise<ProductState | null>;
  save(state: ProductState, context?: ProductContext): Promise<void>;
  loadIdempotent(
    workspaceId: string,
    key: string,
    payloadHash: string
  ): Promise<LoadedIdempotentProductOutcome | null>;
  saveIdempotent(
    workspaceId: string,
    key: string,
    payloadHash: string,
    result: IdempotentProductOutcome
  ): Promise<void>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryProductRepository implements ProductRepository {
  private readonly memberships = new Map<string, string>();
  private readonly states = new Map<string, ProductState>();
  private readonly idempotency = new Map<
    string,
    { payloadHash: string; outcome: IdempotentProductOutcome }
  >();
  private readonly locks = new Map<string, Promise<void>>();
  private readonly futureWriteOwners = new Map<
    string,
    'legacy' | 'frozen' | 'p1'
  >();

  grantMembership(userId: string, workspaceId: string, role = 'owner') {
    this.memberships.set(`${userId}:${workspaceId}`, role);
  }

  setFutureWriteOwner(
    workspaceId: string,
    owner: 'legacy' | 'frozen' | 'p1'
  ) {
    this.futureWriteOwners.set(workspaceId, owner);
  }

  async withWorkspaceLock<T>(
    workspaceId: string,
    action: (repository: ProductRepository) => Promise<T>
  ): Promise<T> {
    const previous = this.locks.get(workspaceId) ?? Promise.resolve();
    let release = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(workspaceId, previous.then(() => current));
    await previous;
    try {
      return await action(this);
    } finally {
      release();
      if (this.locks.get(workspaceId) === current) this.locks.delete(workspaceId);
    }
  }

  async hasMembership(userId: string, workspaceId: string) {
    return this.memberships.has(`${userId}:${workspaceId}`);
  }

  async getMembershipRole(userId: string, workspaceId: string) {
    return this.memberships.get(`${userId}:${workspaceId}`) ?? null;
  }

  async getFutureWriteOwner(workspaceId: string) {
    return this.futureWriteOwners.get(workspaceId) ?? 'legacy';
  }

  async load(workspaceId: string) {
    const state = this.states.get(workspaceId);
    return state ? clone(state) : null;
  }

  async save(state: ProductState, _context?: ProductContext) {
    this.states.set(state.workspaceId, clone(state));
  }

  async loadIdempotent(workspaceId: string, key: string, payloadHash: string) {
    const result = this.idempotency.get(`${workspaceId}:${key}`);
    return result
      ? {
          matches: result.payloadHash === payloadHash,
          outcome: clone(result.outcome),
        }
      : null;
  }

  async saveIdempotent(
    workspaceId: string,
    key: string,
    payloadHash: string,
    result: IdempotentProductOutcome
  ) {
    this.idempotency.set(`${workspaceId}:${key}`, {
      outcome: clone(result),
      payloadHash,
    });
  }
}
