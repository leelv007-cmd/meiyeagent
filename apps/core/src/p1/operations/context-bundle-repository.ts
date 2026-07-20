import {
  contextBundleRecompileEventSchema,
  contextBundleSchema,
  type ContextBundle,
  type ContextBundleRecompileEvent,
} from '@meiye/contracts';
import {
  canonicalContextJson,
  type CompiledContextBundle,
  contextSourceChanges,
  hashContextBundlePayload,
} from './context-compiler.js';

export interface FreezeContextBundleInput {
  workspaceId: string;
  bundleId: string;
  compiled: CompiledContextBundle;
  expectedRevision: number;
  frozenAt: string;
  frozenBy: string;
  idempotencyKey: string;
  reason: string;
}

export interface ContextBundleRepository {
  freeze(input: FreezeContextBundleInput): Promise<ContextBundle>;
  get(
    workspaceId: string,
    bundleId: string,
    revision?: number,
  ): Promise<ContextBundle | null>;
  history(workspaceId: string, bundleId: string): Promise<ContextBundle[]>;
  listRecompileEvents(
    workspaceId: string,
    bundleId: string,
  ): Promise<ContextBundleRecompileEvent[]>;
  listReferencingBundles(
    workspaceId: string,
    factId: string,
    revision: number,
  ): Promise<ContextBundle[]>;
}

export class ContextBundleRevisionConflictError extends Error {
  readonly code = 'CONTEXT_BUNDLE_REVISION_CONFLICT';
  readonly status = 409;

  constructor(
    public readonly bundleId: string,
    public readonly expectedRevision: number,
    public readonly currentRevision: number,
  ) {
    super(
      `ContextBundle ${bundleId} expected revision ${expectedRevision}, current revision is ${currentRevision}.`,
    );
    this.name = 'ContextBundleRevisionConflictError';
  }
}

export class ContextBundleIdempotencyConflictError extends Error {
  readonly code = 'CONTEXT_BUNDLE_IDEMPOTENCY_CONFLICT';
  readonly status = 409;

  constructor(idempotencyKey: string) {
    super(`Idempotency key ${idempotencyKey} was reused with another payload.`);
    this.name = 'ContextBundleIdempotencyConflictError';
  }
}

export function contextBundleFreezeFingerprint(input: FreezeContextBundleInput) {
  return canonicalContextJson({
    bundleId: input.bundleId,
    compiled: input.compiled,
    expectedRevision: input.expectedRevision,
    frozenBy: input.frozenBy,
    reason: input.reason,
    workspaceId: input.workspaceId,
  });
}

export function validateCompiledContextBundle(compiled: CompiledContextBundle) {
  if (hashContextBundlePayload(compiled.payload) !== compiled.hash) {
    throw new Error('Compiled ContextBundle hash does not match its payload.');
  }
}

interface MemoryFreezeReceipt {
  fingerprint: string;
  bundle: ContextBundle;
}

export class MemoryContextBundleRepository
  implements ContextBundleRepository
{
  private readonly bundles = new Map<string, ContextBundle[]>();
  private readonly events = new Map<string, ContextBundleRecompileEvent[]>();
  private readonly receipts = new Map<string, MemoryFreezeReceipt>();

  async freeze(input: FreezeContextBundleInput) {
    validateCompiledContextBundle(input.compiled);
    const receiptIdentity = `${input.workspaceId}:${input.idempotencyKey}`;
    const fingerprint = contextBundleFreezeFingerprint(input);
    const receipt = this.receipts.get(receiptIdentity);
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) {
        throw new ContextBundleIdempotencyConflictError(input.idempotencyKey);
      }
      return structuredClone(receipt.bundle);
    }
    const identity = `${input.workspaceId}:${input.bundleId}`;
    const history = this.bundles.get(identity) ?? [];
    const current = history.at(-1);
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== input.expectedRevision) {
      throw new ContextBundleRevisionConflictError(
        input.bundleId,
        input.expectedRevision,
        currentRevision,
      );
    }
    const changedSources = current
      ? contextSourceChanges(
          current.sourceRevisions,
          input.compiled.payload.sourceRevisions,
        )
      : [];
    if (current && changedSources.length === 0) {
      throw new Error(
        'A ContextBundle recompile requires at least one source revision change.',
      );
    }
    const bundle = contextBundleSchema.parse({
      ...input.compiled.payload,
      bundleId: input.bundleId,
      revision: currentRevision + 1,
      hash: input.compiled.hash,
      frozenAt: input.frozenAt,
      frozenBy: input.frozenBy,
      previousRevision: current?.revision ?? null,
    });
    this.bundles.set(identity, [...history, bundle]);
    if (current) {
      const event = contextBundleRecompileEventSchema.parse({
        eventId: `${input.bundleId}:recompile:${bundle.revision}`,
        workspaceId: input.workspaceId,
        bundleId: input.bundleId,
        fromRevision: current.revision,
        toRevision: bundle.revision,
        changedSources,
        reason: input.reason,
        occurredAt: input.frozenAt,
      });
      this.events.set(identity, [...(this.events.get(identity) ?? []), event]);
    }
    this.receipts.set(receiptIdentity, { fingerprint, bundle });
    return structuredClone(bundle);
  }

  async get(workspaceId: string, bundleId: string, revision?: number) {
    const history = this.bundles.get(`${workspaceId}:${bundleId}`) ?? [];
    const bundle =
      revision === undefined
        ? history.at(-1)
        : history.find((candidate) => candidate.revision === revision);
    return bundle ? structuredClone(bundle) : null;
  }

  async history(workspaceId: string, bundleId: string) {
    return structuredClone(
      this.bundles.get(`${workspaceId}:${bundleId}`) ?? [],
    );
  }

  async listRecompileEvents(workspaceId: string, bundleId: string) {
    return structuredClone(
      this.events.get(`${workspaceId}:${bundleId}`) ?? [],
    );
  }

  async listReferencingBundles(
    workspaceId: string,
    factId: string,
    revision: number,
  ) {
    const matches: ContextBundle[] = [];
    for (const [identity, history] of this.bundles) {
      if (!identity.startsWith(`${workspaceId}:`)) continue;
      matches.push(
        ...history.filter((bundle) =>
          bundle.referencedFactRevisions.some(
            (reference) =>
              reference.factId === factId && reference.revision === revision,
          ),
        ),
      );
    }
    return structuredClone(
      matches.sort(
        (left, right) =>
          left.bundleId.localeCompare(right.bundleId) ||
          left.revision - right.revision,
      ),
    );
  }
}
