import {
  assetRevisionSchema,
  preferenceCandidateSchema,
  preferenceSignalSchema,
  preferenceSchema,
  reusableAssetCandidateSchema,
  reusableAssetLifecycleEventSchema,
  reuseTaskSeedSchema,
  type AssetRevision,
  type Preference,
  type PreferenceCandidate,
  type PreferenceSignal,
  type ReusableAssetCandidate,
  type ReusableAssetLifecycleEvent,
  type ReusableAssetScope,
  type ReuseTaskSeed,
} from '@meiye/contracts';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export type ReuseMemoryErrorCode =
  | 'CONFLICT'
  | 'INSUFFICIENT_INDEPENDENT_TASKS'
  | 'INVALID_STATE'
  | 'NOT_FOUND';

export class ReuseMemoryError extends Error {
  readonly status: number;

  constructor(
    readonly code: ReuseMemoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ReuseMemoryError';
    this.status = code === 'NOT_FOUND' ? 404 : 409;
  }
}

export interface CommitAssetRevisionInput {
  revision: AssetRevision;
  lifecycle: ReusableAssetLifecycleEvent;
  expectedRevision: number;
  idempotencyKey: string;
  fingerprint: string;
}

export interface AppendAssetLifecycleInput {
  event: ReusableAssetLifecycleEvent;
  idempotencyKey: string;
  fingerprint: string;
}

export interface CommitPreferenceInput {
  preference: Preference;
  expectedRevision: number;
  idempotencyKey: string;
  fingerprint: string;
}

export interface ReuseMemoryRepository {
  saveReusableCandidate(
    candidate: ReusableAssetCandidate,
  ): Promise<ReusableAssetCandidate>;
  getReusableCandidate(
    workspaceId: string,
    candidateId: string,
  ): Promise<ReusableAssetCandidate | null>;
  commitAssetRevision(input: CommitAssetRevisionInput): Promise<AssetRevision>;
  assetRevisionReceipt(
    workspaceId: string,
    idempotencyKey: string,
    fingerprint: string,
  ): Promise<AssetRevision | null>;
  appendAssetLifecycle(
    input: AppendAssetLifecycleInput,
  ): Promise<ReusableAssetLifecycleEvent>;
  assetHistory(workspaceId: string, assetId: string): Promise<AssetRevision[]>;
  assetLifecycle(
    workspaceId: string,
    assetId: string,
  ): Promise<ReusableAssetLifecycleEvent[]>;
  listAssetHeads(workspaceId: string): Promise<AssetRevision[]>;
  savePreferenceSignal(signal: PreferenceSignal): Promise<PreferenceSignal>;
  getPreferenceSignal(
    workspaceId: string,
    signalId: string,
  ): Promise<PreferenceSignal | null>;
  listPreferenceSignals(workspaceId: string): Promise<PreferenceSignal[]>;
  savePreferenceCandidate(
    candidate: PreferenceCandidate,
  ): Promise<PreferenceCandidate>;
  getPreferenceCandidate(
    workspaceId: string,
    candidateId: string,
  ): Promise<PreferenceCandidate | null>;
  commitPreference(input: CommitPreferenceInput): Promise<Preference>;
  preferenceReceipt(
    workspaceId: string,
    idempotencyKey: string,
    fingerprint: string,
  ): Promise<Preference | null>;
  preferenceHistory(
    workspaceId: string,
    preferenceId: string,
  ): Promise<Preference[]>;
  listPreferenceCandidates(workspaceId: string): Promise<PreferenceCandidate[]>;
  listPreferenceHeads(workspaceId: string): Promise<Preference[]>;
}

export interface ReusableAssetSourceVerifier {
  verifyCandidate(candidate: ReusableAssetCandidate): Promise<void>;
  verifyRevision(revision: AssetRevision): Promise<void>;
}

interface Receipt<T> {
  fingerprint: string;
  result: T;
}

function key(workspaceId: string, id: string) {
  return JSON.stringify([workspaceId, id]);
}

function ensureSameOrConflict<T>(current: T | undefined, next: T, label: string) {
  if (current && !isDeepStrictEqual(current, next)) {
    throw new ReuseMemoryError('CONFLICT', `${label} already has another payload.`);
  }
}

export class MemoryReuseMemoryRepository implements ReuseMemoryRepository {
  private readonly reusableCandidates = new Map<
    string,
    ReusableAssetCandidate
  >();
  private readonly assets = new Map<string, AssetRevision[]>();
  private readonly lifecycles = new Map<
    string,
    ReusableAssetLifecycleEvent[]
  >();
  private readonly assetReceipts = new Map<string, Receipt<AssetRevision>>();
  private readonly assetCandidatePromotions = new Map<string, string>();
  private readonly lifecycleReceipts = new Map<
    string,
    Receipt<ReusableAssetLifecycleEvent>
  >();
  private readonly preferenceCandidates = new Map<string, PreferenceCandidate>();
  private readonly preferenceSignals = new Map<string, PreferenceSignal>();
  private readonly preferences = new Map<string, Preference[]>();
  private readonly preferenceReceipts = new Map<
    string,
    Receipt<Preference>
  >();
  private readonly preferenceCandidatePromotions = new Map<string, string>();

  async saveReusableCandidate(input: ReusableAssetCandidate) {
    const candidate = reusableAssetCandidateSchema.parse(input);
    const identity = key(candidate.workspaceId, candidate.candidateId);
    const current = this.reusableCandidates.get(identity);
    ensureSameOrConflict(current, candidate, `Candidate ${candidate.candidateId}`);
    if (!current) this.reusableCandidates.set(identity, structuredClone(candidate));
    return structuredClone(current ?? candidate);
  }

  async getReusableCandidate(workspaceId: string, candidateId: string) {
    const candidate = this.reusableCandidates.get(key(workspaceId, candidateId));
    return candidate ? structuredClone(candidate) : null;
  }

  async commitAssetRevision(input: CommitAssetRevisionInput) {
    const revision = assetRevisionSchema.parse(input.revision);
    const lifecycle = reusableAssetLifecycleEventSchema.parse(input.lifecycle);
    const receiptIdentity = key(revision.workspaceId, input.idempotencyKey);
    const receipt = this.assetReceipts.get(receiptIdentity);
    if (receipt) {
      if (receipt.fingerprint !== input.fingerprint) {
        throw new ReuseMemoryError(
          'CONFLICT',
          `Idempotency key ${input.idempotencyKey} was reused.`,
        );
      }
      return structuredClone(receipt.result);
    }
    const assetIdentity = key(revision.workspaceId, revision.assetId);
    const promotedRevisionId = this.assetCandidatePromotions.get(
      key(revision.workspaceId, revision.candidateId),
    );
    if (promotedRevisionId) {
      throw new ReuseMemoryError(
        'CONFLICT',
        'Reusable asset candidate was already promoted.',
      );
    }
    const history = this.assets.get(assetIdentity) ?? [];
    if ((history.at(-1)?.revision ?? 0) !== input.expectedRevision) {
      throw new ReuseMemoryError('CONFLICT', 'AssetRevision head changed.');
    }
    if (
      revision.revision !== input.expectedRevision + 1 ||
      lifecycle.action !== 'activated' ||
      lifecycle.assetId !== revision.assetId ||
      lifecycle.revisionId !== revision.revisionId
    ) {
      throw new ReuseMemoryError('INVALID_STATE', 'Invalid AssetRevision commit.');
    }
    this.assets.set(assetIdentity, [...history, revision]);
    this.assetCandidatePromotions.set(
      key(revision.workspaceId, revision.candidateId),
      revision.revisionId,
    );
    this.lifecycles.set(assetIdentity, [
      ...(this.lifecycles.get(assetIdentity) ?? []),
      lifecycle,
    ]);
    this.assetReceipts.set(receiptIdentity, {
      fingerprint: input.fingerprint,
      result: revision,
    });
    return structuredClone(revision);
  }

  async assetRevisionReceipt(
    workspaceId: string,
    idempotencyKey: string,
    expectedFingerprint: string,
  ) {
    const receipt = this.assetReceipts.get(key(workspaceId, idempotencyKey));
    if (!receipt) return null;
    if (receipt.fingerprint !== expectedFingerprint) {
      throw new ReuseMemoryError(
        'CONFLICT',
        `Idempotency key ${idempotencyKey} was reused.`,
      );
    }
    return structuredClone(receipt.result);
  }

  async appendAssetLifecycle(input: AppendAssetLifecycleInput) {
    const event = reusableAssetLifecycleEventSchema.parse(input.event);
    const receiptIdentity = key(event.workspaceId, input.idempotencyKey);
    const receipt = this.lifecycleReceipts.get(receiptIdentity);
    if (receipt) {
      if (receipt.fingerprint !== input.fingerprint) {
        throw new ReuseMemoryError(
          'CONFLICT',
          `Idempotency key ${input.idempotencyKey} was reused.`,
        );
      }
      return structuredClone(receipt.result);
    }
    const assetIdentity = key(event.workspaceId, event.assetId);
    const revision = (this.assets.get(assetIdentity) ?? []).at(-1);
    if (!revision || revision.revisionId !== event.revisionId) {
      throw new ReuseMemoryError('NOT_FOUND', 'Current AssetRevision not found.');
    }
    const currentState = this.lifecycles.get(assetIdentity)?.at(-1)?.action;
    if (event.action !== 'deactivated' || currentState !== 'activated') {
      throw new ReuseMemoryError('INVALID_STATE', 'Series is not active.');
    }
    this.lifecycles.set(assetIdentity, [
      ...(this.lifecycles.get(assetIdentity) ?? []),
      event,
    ]);
    this.lifecycleReceipts.set(receiptIdentity, {
      fingerprint: input.fingerprint,
      result: event,
    });
    return structuredClone(event);
  }

  async assetHistory(workspaceId: string, assetId: string) {
    return structuredClone(this.assets.get(key(workspaceId, assetId)) ?? []);
  }

  async assetLifecycle(workspaceId: string, assetId: string) {
    return structuredClone(
      this.lifecycles.get(key(workspaceId, assetId)) ?? [],
    );
  }

  async listAssetHeads(workspaceId: string) {
    const heads: AssetRevision[] = [];
    for (const history of this.assets.values()) {
      const head = history.at(-1);
      if (head?.workspaceId === workspaceId) heads.push(head);
    }
    return structuredClone(
      heads.sort((left, right) => left.assetId.localeCompare(right.assetId)),
    );
  }

  async savePreferenceSignal(input: PreferenceSignal) {
    const signal = preferenceSignalSchema.parse(input);
    const signalIdentity = key(signal.workspaceId, signal.signalId);
    const current = this.preferenceSignals.get(signalIdentity);
    ensureSameOrConflict(
      current,
      signal,
      `Preference signal ${signal.signalId}`,
    );
    if (!current)
      this.preferenceSignals.set(signalIdentity, structuredClone(signal));
    return structuredClone(current ?? signal);
  }

  async getPreferenceSignal(workspaceId: string, signalId: string) {
    const signal = this.preferenceSignals.get(key(workspaceId, signalId));
    return signal ? structuredClone(signal) : null;
  }

  async listPreferenceSignals(workspaceId: string) {
    const signals = [...this.preferenceSignals.values()].filter(
      (signal) => signal.workspaceId === workspaceId,
    );
    return structuredClone(
      signals.sort(
        (left, right) =>
          left.occurredAt.localeCompare(right.occurredAt) ||
          left.signalId.localeCompare(right.signalId),
      ),
    );
  }

  async savePreferenceCandidate(input: PreferenceCandidate) {
    const candidate = preferenceCandidateSchema.parse(input);
    const identity = key(candidate.workspaceId, candidate.candidateId);
    const current = this.preferenceCandidates.get(identity);
    ensureSameOrConflict(current, candidate, `Candidate ${candidate.candidateId}`);
    if (!current) this.preferenceCandidates.set(identity, structuredClone(candidate));
    return structuredClone(current ?? candidate);
  }

  async getPreferenceCandidate(workspaceId: string, candidateId: string) {
    const candidate = this.preferenceCandidates.get(key(workspaceId, candidateId));
    return candidate ? structuredClone(candidate) : null;
  }

  async commitPreference(input: CommitPreferenceInput) {
    const preference = preferenceSchema.parse(input.preference);
    const receiptIdentity = key(preference.workspaceId, input.idempotencyKey);
    const receipt = this.preferenceReceipts.get(receiptIdentity);
    if (receipt) {
      if (receipt.fingerprint !== input.fingerprint) {
        throw new ReuseMemoryError(
          'CONFLICT',
          `Idempotency key ${input.idempotencyKey} was reused.`,
        );
      }
      return structuredClone(receipt.result);
    }
    const preferenceIdentity = key(
      preference.workspaceId,
      preference.preferenceId,
    );
    const promotionIdentity = key(
      preference.workspaceId,
      preference.candidateId,
    );
    const promotedPreferenceId = this.preferenceCandidatePromotions.get(
      promotionIdentity,
    );
    if (
      (input.expectedRevision === 0 && promotedPreferenceId) ||
      (input.expectedRevision > 0 &&
        promotedPreferenceId !== preference.preferenceId)
    ) {
      throw new ReuseMemoryError(
        'CONFLICT',
        'PreferenceCandidate was already promoted.',
      );
    }
    const history = this.preferences.get(preferenceIdentity) ?? [];
    if ((history.at(-1)?.revision ?? 0) !== input.expectedRevision) {
      throw new ReuseMemoryError('CONFLICT', 'Preference head changed.');
    }
    if (preference.revision !== input.expectedRevision + 1) {
      throw new ReuseMemoryError('INVALID_STATE', 'Invalid Preference revision.');
    }
    this.preferences.set(preferenceIdentity, [...history, preference]);
    this.preferenceCandidatePromotions.set(
      promotionIdentity,
      preference.preferenceId,
    );
    this.preferenceReceipts.set(receiptIdentity, {
      fingerprint: input.fingerprint,
      result: preference,
    });
    return structuredClone(preference);
  }

  async preferenceReceipt(
    workspaceId: string,
    idempotencyKey: string,
    expectedFingerprint: string,
  ) {
    const receipt = this.preferenceReceipts.get(
      key(workspaceId, idempotencyKey),
    );
    if (!receipt) return null;
    if (receipt.fingerprint !== expectedFingerprint) {
      throw new ReuseMemoryError(
        'CONFLICT',
        `Idempotency key ${idempotencyKey} was reused.`,
      );
    }
    return structuredClone(receipt.result);
  }

  async preferenceHistory(workspaceId: string, preferenceId: string) {
    return structuredClone(
      this.preferences.get(key(workspaceId, preferenceId)) ?? [],
    );
  }

  async listPreferenceCandidates(workspaceId: string) {
    const candidates: PreferenceCandidate[] = [];
    for (const candidate of this.preferenceCandidates.values()) {
      if (candidate.workspaceId === workspaceId) candidates.push(candidate);
    }
    return structuredClone(
      candidates.sort((left, right) =>
        left.candidateId.localeCompare(right.candidateId),
      ),
    );
  }

  async listPreferenceHeads(workspaceId: string) {
    const heads: Preference[] = [];
    for (const history of this.preferences.values()) {
      const head = history.at(-1);
      if (head?.workspaceId === workspaceId) heads.push(head);
    }
    return structuredClone(
      heads.sort((left, right) =>
        left.preferenceId.localeCompare(right.preferenceId),
      ),
    );
  }
}

function fingerprint(value: unknown) {
  return JSON.stringify(value);
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([itemKey, item]) => [itemKey, stable(item)]),
    );
  }
  return value;
}

function preferenceCandidateId(input: {
  workspaceId: string;
  semanticKey: string;
  value: unknown;
  defaultScope: ReusableAssetScope;
}) {
  const digest = createHash('sha256')
    .update(JSON.stringify(stable(input)))
    .digest('hex')
    .slice(0, 24);
  return `preference-candidate-${digest}`;
}

function resolveFinalScope(input: {
  defaultScope: ReusableAssetScope;
  finalScope?: ReusableAssetScope;
  scopeDecisionId?: string;
  decidedBy: string;
  decidedAt: string;
  fallbackDecisionId: string;
}) {
  const finalScope = input.finalScope ?? input.defaultScope;
  if (finalScope.storeId !== input.defaultScope.storeId) {
    throw new ReuseMemoryError(
      'INVALID_STATE',
      'A reusable scope cannot move to another store.',
    );
  }
  for (const key of ['personaId', 'scene', 'platform'] as const) {
    if (
      finalScope[key] !== undefined &&
      finalScope[key] !== input.defaultScope[key]
    ) {
      throw new ReuseMemoryError(
        'INVALID_STATE',
        'A final reusable scope must preserve or widen the default scope.',
      );
    }
  }
  const expanded = !isDeepStrictEqual(input.defaultScope, finalScope);
  if (expanded && !input.scopeDecisionId) {
    throw new ReuseMemoryError(
      'INVALID_STATE',
      'Expanding a reusable scope requires an explicit confirmation decision.',
    );
  }
  return {
    defaultScope: input.defaultScope,
    finalScope,
    scopeDecision: {
      mode: expanded ? ('explicitly_expanded' as const) : ('accepted_default' as const),
      decisionId: input.scopeDecisionId ?? input.fallbackDecisionId,
      decidedBy: input.decidedBy,
      decidedAt: input.decidedAt,
    },
  };
}

export class ReuseMemoryService {
  constructor(
    private readonly repository: ReuseMemoryRepository,
    private readonly sourceVerifier: ReusableAssetSourceVerifier,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async proposeReusableAsset(input: ReusableAssetCandidate) {
    const candidate = reusableAssetCandidateSchema.parse(input);
    if (candidate.status !== 'pending') {
      throw new ReuseMemoryError(
        'INVALID_STATE',
        'A new reusable asset candidate must be pending.',
      );
    }
    await this.sourceVerifier.verifyCandidate(candidate);
    return this.repository.saveReusableCandidate(candidate);
  }

  async confirmReusableAsset(
    context: { workspaceId: string; userId: string },
    input: {
      candidateId: string;
      expectedAssetRevision: number;
      revisionId: string;
      nextSuggestions: AssetRevision['nextSuggestions'];
      finalScope?: ReusableAssetScope;
      scopeDecisionId?: string;
      idempotencyKey: string;
    },
  ) {
    const commitFingerprint = fingerprint({
      action: 'confirm_reusable_asset',
      candidateId: input.candidateId,
      expectedAssetRevision: input.expectedAssetRevision,
      revisionId: input.revisionId,
      nextSuggestions: input.nextSuggestions,
      finalScope: input.finalScope,
      scopeDecisionId: input.scopeDecisionId,
    });
    const replay = await this.repository.assetRevisionReceipt(
      context.workspaceId,
      input.idempotencyKey,
      commitFingerprint,
    );
    if (replay) return replay;
    const candidate = await this.repository.getReusableCandidate(
      context.workspaceId,
      input.candidateId,
    );
    if (!candidate) throw new ReuseMemoryError('NOT_FOUND', 'Candidate not found.');
    await this.sourceVerifier.verifyCandidate(candidate);
    const slotKeys = new Set(candidate.variableSlots.map((slot) => slot.key));
    if (
      input.nextSuggestions.some((suggestion) =>
        suggestion.variableSlotKeys.some((slotKey) => !slotKeys.has(slotKey)),
      )
    ) {
      throw new ReuseMemoryError(
        'INVALID_STATE',
        'A series suggestion references an unknown variable slot.',
      );
    }
    const decidedAt = this.now();
    const scopes = resolveFinalScope({
      defaultScope: candidate.defaultScope,
      finalScope: input.finalScope,
      scopeDecisionId: input.scopeDecisionId,
      decidedBy: context.userId,
      decidedAt,
      fallbackDecisionId: `reuse-memory:${input.idempotencyKey}`,
    });
    const revision = assetRevisionSchema.parse({
      assetId: candidate.assetId,
      revisionId: input.revisionId,
      candidateId: candidate.candidateId,
      revision: input.expectedAssetRevision + 1,
      workspaceId: context.workspaceId,
      kind: candidate.kind,
      name: candidate.name,
      fixedItems: candidate.fixedItems,
      variableSlots: candidate.variableSlots,
      ...scopes,
      provenance: candidate.provenance,
      rights: candidate.rights,
      nextSuggestions: input.nextSuggestions,
      createdAt: decidedAt,
      createdBy: context.userId,
    });
    return this.repository.commitAssetRevision({
      revision,
      lifecycle: reusableAssetLifecycleEventSchema.parse({
        eventId: `reuse-memory:${input.idempotencyKey}`,
        workspaceId: context.workspaceId,
        assetId: candidate.assetId,
        revisionId: input.revisionId,
        action: 'activated',
        reason: 'Reusable asset candidate confirmed.',
        actorId: context.userId,
        occurredAt: decidedAt,
      }),
      expectedRevision: input.expectedAssetRevision,
      idempotencyKey: input.idempotencyKey,
      fingerprint: commitFingerprint,
    });
  }

  async deactivateSeries(
    context: { workspaceId: string; userId: string },
    input: {
      assetId: string;
      revisionId: string;
      reason: string;
      idempotencyKey: string;
    },
  ) {
    const event = reusableAssetLifecycleEventSchema.parse({
      eventId: `reuse-memory:${input.idempotencyKey}`,
      workspaceId: context.workspaceId,
      assetId: input.assetId,
      revisionId: input.revisionId,
      action: 'deactivated',
      reason: input.reason,
      actorId: context.userId,
      occurredAt: this.now(),
    });
    return this.repository.appendAssetLifecycle({
      event,
      idempotencyKey: input.idempotencyKey,
      fingerprint: fingerprint({
        action: 'deactivate_series',
        assetId: input.assetId,
        revisionId: input.revisionId,
        reason: input.reason,
      }),
    });
  }

  async listAutomaticSeriesSuggestions(workspaceId: string) {
    const results: Array<{
      assetId: string;
      revisionId: string;
      suggestion: AssetRevision['nextSuggestions'][number];
    }> = [];
    for (const head of await this.repository.listAssetHeads(workspaceId)) {
      if (head.kind !== 'series') continue;
      const lifecycle = await this.repository.assetLifecycle(
        workspaceId,
        head.assetId,
      );
      if (lifecycle.at(-1)?.action !== 'activated') continue;
      results.push(
        ...head.nextSuggestions.map((suggestion) => ({
          assetId: head.assetId,
          revisionId: head.revisionId,
          suggestion,
        })),
      );
    }
    return results;
  }

  async createReuseTaskSeed(
    workspaceId: string,
    assetId: string,
    revision: number,
  ): Promise<ReuseTaskSeed> {
    const assetRevision = (
      await this.repository.assetHistory(workspaceId, assetId)
    ).find((item) => item.revision === revision);
    if (!assetRevision) {
      throw new ReuseMemoryError('NOT_FOUND', 'AssetRevision not found.');
    }
    await this.sourceVerifier.verifyRevision(assetRevision);
    return reuseTaskSeedSchema.parse({
      assetId: assetRevision.assetId,
      assetRevision: assetRevision.revision,
      sourcePackageId: assetRevision.provenance.sourcePackageId,
      sourceVersionId: assetRevision.provenance.sourceVersionId,
      sourcePackageRevision: assetRevision.provenance.sourcePackageRevision,
      assetRevisionId: assetRevision.revisionId,
      fixedItemKeys: assetRevision.fixedItems.map((item) => item.key),
      variableSlotKeys: assetRevision.variableSlots.map((item) => item.key),
    });
  }

  async verifyReuseTaskSeed(workspaceId: string, input: ReuseTaskSeed) {
    const seed = reuseTaskSeedSchema.parse(input);
    const revision = (
      await this.repository.assetHistory(workspaceId, seed.assetId)
    ).find((item) => item.revision === seed.assetRevision);
    if (!revision) {
      throw new ReuseMemoryError('NOT_FOUND', 'AssetRevision not found.');
    }
    const expected = reuseTaskSeedSchema.parse({
      assetId: revision.assetId,
      assetRevision: revision.revision,
      sourcePackageId: revision.provenance.sourcePackageId,
      sourceVersionId: revision.provenance.sourceVersionId,
      sourcePackageRevision: revision.provenance.sourcePackageRevision,
      assetRevisionId: revision.revisionId,
      fixedItemKeys: revision.fixedItems.map((item) => item.key),
      variableSlotKeys: revision.variableSlots.map((item) => item.key),
    });
    if (!isDeepStrictEqual(seed, expected)) {
      throw new ReuseMemoryError(
        'INVALID_STATE',
        'Reuse Task seed does not match its immutable AssetRevision.',
      );
    }
    await this.sourceVerifier.verifyRevision(revision);
    return revision;
  }

  async createSeriesContinuationSeed(
    workspaceId: string,
    assetId: string,
    revision: number,
    suggestionId: string,
  ) {
    const seed = await this.createReuseTaskSeed(workspaceId, assetId, revision);
    const assetRevision = await this.verifyReuseTaskSeed(workspaceId, seed);
    const suggestion = assetRevision.nextSuggestions.find(
      (item) => item.suggestionId === suggestionId,
    );
    if (!suggestion) {
      throw new ReuseMemoryError('NOT_FOUND', 'Series suggestion not found.');
    }
    return { seed, suggestion };
  }

  async assetView(workspaceId: string, assetId: string) {
    const [revisions, lifecycle] = await Promise.all([
      this.repository.assetHistory(workspaceId, assetId),
      this.repository.assetLifecycle(workspaceId, assetId),
    ]);
    if (revisions.length === 0) {
      throw new ReuseMemoryError('NOT_FOUND', 'Reusable asset not found.');
    }
    return { revisions, lifecycle };
  }

  async recordPreferenceSignal(
    context: { workspaceId: string },
    input: Omit<PreferenceSignal, 'workspaceId' | 'occurredAt'>,
  ) {
    const existing = await this.repository.getPreferenceSignal(
      context.workspaceId,
      input.signalId,
    );
    const signal = await this.repository.savePreferenceSignal(
      preferenceSignalSchema.parse({
        ...input,
        workspaceId: context.workspaceId,
        occurredAt: existing?.occurredAt ?? this.now(),
      }),
    );
    if (signal.kind !== 'modified') return { signal, candidate: null };
    const matching = (
      await this.repository.listPreferenceSignals(context.workspaceId)
    ).filter(
      (candidate) =>
        candidate.kind === 'modified' &&
        candidate.semanticKey === signal.semanticKey &&
        isDeepStrictEqual(candidate.value, signal.value) &&
        isDeepStrictEqual(candidate.defaultScope, signal.defaultScope),
    );
    const byTask = new Map<string, PreferenceSignal>();
    for (const candidate of matching) {
      if (!byTask.has(candidate.taskId))
        byTask.set(candidate.taskId, candidate);
    }
    if (byTask.size < 3) return { signal, candidate: null };
    const evidence = [...byTask.values()].sort((left, right) =>
      left.taskId.localeCompare(right.taskId),
    );
    const candidateId = preferenceCandidateId({
      workspaceId: context.workspaceId,
      semanticKey: signal.semanticKey,
      value: signal.value,
      defaultScope: signal.defaultScope,
    });
    const existingCandidate = await this.repository.getPreferenceCandidate(
      context.workspaceId,
      candidateId,
    );
    if (existingCandidate) {
      if (
        existingCandidate.trigger !== 'repeated_signal' ||
        existingCandidate.semanticKey !== signal.semanticKey ||
        !isDeepStrictEqual(existingCandidate.proposedValue, signal.value) ||
        !isDeepStrictEqual(existingCandidate.defaultScope, signal.defaultScope)
      ) {
        throw new ReuseMemoryError(
          'CONFLICT',
          'Preference candidate identity collided with another pattern.',
        );
      }
      return { signal, candidate: existingCandidate };
    }
    const candidate = await this.proposePreference({
      candidateId,
      workspaceId: context.workspaceId,
      semanticKey: signal.semanticKey,
      proposedValue: signal.value,
      defaultScope: signal.defaultScope,
      evidenceDecisionIds: evidence.map((item) => item.decisionId),
      evidenceTaskIds: evidence.map((item) => item.taskId),
      trigger: 'repeated_signal',
      status: 'pending',
      proposedAt: signal.occurredAt,
    });
    return { signal, candidate };
  }

  async proposePreference(input: PreferenceCandidate) {
    const candidate = preferenceCandidateSchema.parse(input);
    if (candidate.status !== 'pending') {
      throw new ReuseMemoryError(
        'INVALID_STATE',
        'A new PreferenceCandidate must be pending.',
      );
    }
    if (candidate.trigger === 'repeated_signal') {
      const taskIds = new Set(candidate.evidenceTaskIds);
      const decisionIds = new Set(candidate.evidenceDecisionIds);
      if (
        taskIds.size < 3 ||
        decisionIds.size < 3 ||
        taskIds.size !== candidate.evidenceTaskIds.length ||
        decisionIds.size !== candidate.evidenceDecisionIds.length
      ) {
        throw new ReuseMemoryError(
          'INSUFFICIENT_INDEPENDENT_TASKS',
          'Repeated preference signals require three independent tasks.',
        );
      }
      const persistedEvidence = (
        await this.repository.listPreferenceSignals(candidate.workspaceId)
      ).filter(
        (signal) =>
          signal.kind === 'modified' &&
          signal.semanticKey === candidate.semanticKey &&
          isDeepStrictEqual(signal.value, candidate.proposedValue) &&
          isDeepStrictEqual(signal.defaultScope, candidate.defaultScope) &&
          taskIds.has(signal.taskId) &&
          decisionIds.has(signal.decisionId),
      );
      if (
        new Set(persistedEvidence.map((signal) => signal.taskId)).size !==
          taskIds.size ||
        new Set(persistedEvidence.map((signal) => signal.decisionId)).size !==
          decisionIds.size
      ) {
        throw new ReuseMemoryError(
          'INSUFFICIENT_INDEPENDENT_TASKS',
          'Repeated preference evidence must match persisted modification signals.',
        );
      }
    }
    return this.repository.savePreferenceCandidate(candidate);
  }

  async confirmPreference(
    context: { workspaceId: string; userId: string },
    input: {
      candidateId: string;
      preferenceId: string;
      expectedRevision: number;
      positiveExamples: string[];
      negativeExamples: string[];
      finalScope?: ReusableAssetScope;
      scopeDecisionId?: string;
      idempotencyKey: string;
    },
  ) {
    if (input.expectedRevision !== 0) {
      throw new ReuseMemoryError(
        'INVALID_STATE',
        'Preference confirmation creates only the first inactive revision.',
      );
    }
    const commitFingerprint = fingerprint({
      action: 'confirm_preference',
      candidateId: input.candidateId,
      preferenceId: input.preferenceId,
      expectedRevision: input.expectedRevision,
      positiveExamples: input.positiveExamples,
      negativeExamples: input.negativeExamples,
      finalScope: input.finalScope,
      scopeDecisionId: input.scopeDecisionId,
    });
    const replay = await this.repository.preferenceReceipt(
      context.workspaceId,
      input.idempotencyKey,
      commitFingerprint,
    );
    if (replay) return replay;
    const candidate = await this.repository.getPreferenceCandidate(
      context.workspaceId,
      input.candidateId,
    );
    if (!candidate) throw new ReuseMemoryError('NOT_FOUND', 'Candidate not found.');
    const decidedAt = this.now();
    const scopes = resolveFinalScope({
      defaultScope: candidate.defaultScope,
      finalScope: input.finalScope,
      scopeDecisionId: input.scopeDecisionId,
      decidedBy: context.userId,
      decidedAt,
      fallbackDecisionId: `reuse-memory:${input.idempotencyKey}`,
    });
    const preference = preferenceSchema.parse({
      preferenceId: input.preferenceId,
      revision: input.expectedRevision + 1,
      workspaceId: context.workspaceId,
      candidateId: candidate.candidateId,
      semanticKey: candidate.semanticKey,
      value: candidate.proposedValue,
      ...scopes,
      positiveExamples: input.positiveExamples,
      negativeExamples: input.negativeExamples,
      evidenceDecisionIds: candidate.evidenceDecisionIds,
      status: 'inactive_stage2',
      recordState: 'current',
      confirmedBy: context.userId,
      confirmedAt: decidedAt,
      revokedAt: null,
      supersededByPreferenceId: null,
      changedBy: context.userId,
      changedAt: decidedAt,
      changeReason: 'candidate_confirmed',
    });
    return this.repository.commitPreference({
      preference,
      expectedRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey,
      fingerprint: commitFingerprint,
    });
  }

  async revokePreference(
    context: { workspaceId: string; userId: string },
    input: {
      preferenceId: string;
      expectedRevision: number;
      idempotencyKey: string;
    },
  ) {
    const commitFingerprint = fingerprint({
      action: 'revoke_preference',
      preferenceId: input.preferenceId,
      expectedRevision: input.expectedRevision,
    });
    const replay = await this.repository.preferenceReceipt(
      context.workspaceId,
      input.idempotencyKey,
      commitFingerprint,
    );
    if (replay) return replay;
    const current = (
      await this.repository.preferenceHistory(
        context.workspaceId,
        input.preferenceId,
      )
    ).at(-1);
    if (!current) throw new ReuseMemoryError('NOT_FOUND', 'Preference not found.');
    if (current.recordState !== 'current') {
      throw new ReuseMemoryError('INVALID_STATE', 'Preference is not current.');
    }
    const revokedAt = this.now();
    const preference = preferenceSchema.parse({
      ...current,
      revision: input.expectedRevision + 1,
      recordState: 'revoked',
      revokedAt,
      changedBy: context.userId,
      changedAt: revokedAt,
      changeReason: 'user_revoked',
    });
    return this.repository.commitPreference({
      preference,
      expectedRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey,
      fingerprint: commitFingerprint,
    });
  }

  async preferenceView(workspaceId: string) {
    const [signals, candidates, preferences] = await Promise.all([
      this.repository.listPreferenceSignals(workspaceId),
      this.repository.listPreferenceCandidates(workspaceId),
      this.repository.listPreferenceHeads(workspaceId),
    ]);
    const preferenceByCandidate = new Map(
      preferences.map((preference) => [preference.candidateId, preference]),
    );
    return {
      signals,
      candidates: candidates.map((candidate) => ({
        ...candidate,
        status: preferenceByCandidate.has(candidate.candidateId)
          ? ('confirmed' as const)
          : candidate.status,
        preference: preferenceByCandidate.get(candidate.candidateId) ?? null,
      })),
      preferences,
    };
  }
}
