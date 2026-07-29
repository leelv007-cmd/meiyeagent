import {
  storeFactSchema,
  type StoreFact,
  type StoreFactKind,
} from '@meiye/contracts';
import { createHash } from 'node:crypto';

export interface StoreFactApplicability {
  storeId: string;
  serviceId?: string;
  personaId?: string;
  platform?: string;
}

export interface AppendStoreFactInput {
  factId: string;
  workspaceId: string;
  kind: StoreFactKind;
  key: string;
  value: StoreFact['value'];
  scope: StoreFactApplicability;
  source: StoreFact['source'];
  effectiveFrom: string;
  expiresAt: string | null;
  revisionKind?: StoreFact['revisionKind'];
  recordedAt: string;
  recordedBy: string;
  expectedRevision: number;
}

export interface ActiveStoreFactQuery {
  workspaceId: string;
  scope: StoreFactApplicability;
  at: string;
}

export type ExpiredStoreFact = StoreFact & { expiresAt: string };

export interface StoreFactLedger {
  append(input: AppendStoreFactInput): Promise<StoreFact>;
  currentRevision(workspaceId: string): Promise<number>;
  contextRevision(input: ActiveStoreFactQuery): Promise<string>;
  history(workspaceId: string, factId: string): Promise<StoreFact[]>;
  listActive(input: ActiveStoreFactQuery): Promise<StoreFact[]>;
  /**
   * Reads the named heads and runs `action` with them while no append to those
   * facts may commit. A caller that has to act on a head it just read — write
   * the value somewhere else, say — gets to do so without another writer
   * slipping a revocation in between the read and the write.
   */
  withPinnedHeads<T>(
    workspaceId: string,
    factIds: readonly string[],
    action: (heads: ReadonlyMap<string, StoreFact | null>) => Promise<T>,
  ): Promise<T>;
}

export class StoreFactRevisionConflictError extends Error {
  readonly code = 'STORE_FACT_REVISION_CONFLICT';
  readonly status = 409;

  constructor(
    public readonly factId: string,
    public readonly expectedRevision: number,
    public readonly currentRevision: number,
  ) {
    super(
      `Store fact ${factId} expected revision ${expectedRevision}, current revision is ${currentRevision}.`,
    );
    this.name = 'StoreFactRevisionConflictError';
  }
}

export function storeFactAppliesTo(
  factScope: StoreFactApplicability,
  requestedScope: StoreFactApplicability,
) {
  if (factScope.storeId !== requestedScope.storeId) return false;
  if (
    requestedScope.serviceId !== undefined &&
    factScope.serviceId !== undefined &&
    factScope.serviceId !== requestedScope.serviceId
  ) {
    return false;
  }
  for (const key of ['personaId', 'platform'] as const) {
    if (factScope[key] !== undefined && factScope[key] !== requestedScope[key]) {
      return false;
    }
  }
  return true;
}

function currentAt(history: readonly StoreFact[], at: string) {
  const timestamp = Date.parse(at);
  return history
    .filter((fact) => Date.parse(fact.effectiveFrom) <= timestamp)
    .sort((left, right) => right.revision - left.revision)[0];
}

export function isStoreFactActive(fact: StoreFact, at: string) {
  const timestamp = Date.parse(at);
  return (
    Date.parse(fact.effectiveFrom) <= timestamp &&
    fact.revisionKind !== 'revocation' &&
    // A standard service price may be open-ended. A promotion cannot: without
    // a window, group-buy and discount evidence remains historical/pending
    // rather than silently becoming a current promise.
    !(
      (fact.kind === 'group_buy' || fact.kind === 'discount') &&
      fact.expiresAt === null
    ) &&
    !isStoreFactExpired(fact, at)
  );
}

export function isStoreFactExpired(
  fact: StoreFact,
  at: string,
): fact is ExpiredStoreFact {
  return fact.expiresAt !== null && Date.parse(fact.expiresAt) <= Date.parse(at);
}

export function storeFactContextRevision(
  activeFacts: readonly StoreFact[],
) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        active: activeFacts
          .map((fact) => ({ factId: fact.factId, revision: fact.revision }))
          .sort((left, right) => left.factId.localeCompare(right.factId)),
      }),
    )
    .digest('hex');
}

export class MemoryStoreFactLedger implements StoreFactLedger {
  private readonly revisions = new Map<string, StoreFact[]>();
  private readonly workspaceRevisions = new Map<string, number>();

  async append(input: AppendStoreFactInput) {
    const identity = JSON.stringify([input.workspaceId, input.factId]);
    const history = this.revisions.get(identity) ?? [];
    const currentRevision = history.at(-1)?.revision ?? 0;
    if (currentRevision !== input.expectedRevision) {
      throw new StoreFactRevisionConflictError(
        input.factId,
        input.expectedRevision,
        currentRevision,
      );
    }
    const { expectedRevision: _expectedRevision, ...factInput } = input;
    const fact = storeFactSchema.parse({
      ...factInput,
      revision: currentRevision + 1,
    });
    this.revisions.set(identity, [...history, fact]);
    this.workspaceRevisions.set(
      input.workspaceId,
      (this.workspaceRevisions.get(input.workspaceId) ?? 0) + 1,
    );
    return structuredClone(fact);
  }

  async currentRevision(workspaceId: string) {
    return this.workspaceRevisions.get(workspaceId) ?? 0;
  }

  async contextRevision(input: ActiveStoreFactQuery) {
    return storeFactContextRevision(await this.listActive(input));
  }

  async history(workspaceId: string, factId: string) {
    return structuredClone(
      this.revisions.get(JSON.stringify([workspaceId, factId])) ?? [],
    );
  }

  async withPinnedHeads<T>(
    workspaceId: string,
    factIds: readonly string[],
    action: (heads: ReadonlyMap<string, StoreFact | null>) => Promise<T>,
  ) {
    // The in-process ledger serves single-threaded tests, so the pin is just
    // the batched head read: `append` runs to completion inside one tick and
    // there is no second connection to fence out. The Postgres ledger is where
    // the pin has to hold real writers off.
    const heads = new Map<string, StoreFact | null>();
    for (const factId of factIds) {
      heads.set(
        factId,
        this.revisions.get(JSON.stringify([workspaceId, factId]))?.at(-1) ??
          null,
      );
    }
    return action(heads);
  }

  async listActive(input: ActiveStoreFactQuery) {
    const active: StoreFact[] = [];
    for (const history of this.revisions.values()) {
      if (history[0]?.workspaceId !== input.workspaceId) continue;
      const current = currentAt(history, input.at);
      if (
        current &&
        isStoreFactActive(current, input.at) &&
        storeFactAppliesTo(current.scope, input.scope)
      ) {
        active.push(current);
      }
    }
    return structuredClone(
      active.sort((left, right) => left.factId.localeCompare(right.factId)),
    );
  }

}
