import {
  assetRevisionSchema,
  memoryEntriesPageQuerySchema,
  memoryEntriesPageSchema,
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
  type MemoryEntriesPage,
  type MemoryEntriesPageQuery,
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
  decision?: MemoryCandidateDecision;
  approvalReceipt?: MemoryApprovalReceipt;
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
  saveMemoryWorkLog(log: MemoryWorkLog): Promise<MemoryWorkLog>;
  saveMemorySourceConversation(
    conversation: MemorySourceConversation,
  ): Promise<MemorySourceConversation>;
  getMemoryWorkLog(
    workspaceId: string,
    turnId: string,
  ): Promise<MemoryWorkLog | null>;
  hasMemorySourceConversation(
    workspaceId: string,
    conversationId: string,
  ): Promise<boolean>;
  appendMemorySedimentationAudit(
    event: MemorySedimentationAudit,
  ): Promise<MemorySedimentationAudit>;
  listMemorySedimentationAudits(
    workspaceId: string,
  ): Promise<MemorySedimentationAudit[]>;
  appendMemoryCandidateDecision(
    decision: MemoryCandidateDecision,
  ): Promise<MemoryCandidateDecision>;
  listMemoryCandidateDecisions(
    workspaceId: string,
  ): Promise<MemoryCandidateDecision[]>;
  listMemoryApprovalReceipts(
    workspaceId: string,
  ): Promise<MemoryApprovalReceipt[]>;
  rejectMemoryCandidate(
    decision: MemoryCandidateDecision,
  ): Promise<'rejected'>;
  listMemoryEntriesPage(
    workspaceId: string,
    query: MemoryEntriesPageQuery,
  ): Promise<MemoryEntriesPage>;
  markMemorySourceDeleted(
    workspaceId: string,
    conversationId: string,
    deletedAt: string,
  ): Promise<void>;
  deleteMemoryEntry(input: {
    workspaceId: string;
    entryId: string;
    deletedAt: string;
    deletedBy: string;
  }): Promise<'deleted' | 'not_found'>;
  isMemoryEntryDeleted(
    workspaceId: string,
    entryId: string,
  ): Promise<boolean>;
}

export interface MemoryWorkLog {
  workspaceId: string;
  conversationId: string;
  turnId: string;
  observedAt: string;
  messages: Array<{ index: number; text: string }>;
}

export type MemorySourceConversation = MemoryWorkLog;

export interface MemorySedimentationAudit {
  auditId: string;
  workspaceId: string;
  conversationId: string;
  itemId: string;
  outcome: 'persisted' | 'aborted' | 'failed';
  decision:
    | 'allow'
    | 'rewrite'
    | 'discard'
    | 'to_pending_confirmation'
    | 'parse_failed'
    | 'item_failed'
    | 'redline_aborted';
  reason: string;
  occurredAt: string;
}

export interface MemoryCandidateDecision {
  decisionId: string;
  workspaceId: string;
  candidateId: string;
  action: 'confirmed' | 'rejected';
  reason: string;
  decidedBy: string;
  decidedAt: string;
}

export interface MemoryApprovalReceipt {
  receiptId: string;
  workspaceId: string;
  candidateId: string;
  decisionId: string;
  status: 'approved';
  approvedBy: string;
  approvedAt: string;
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
  private readonly memoryWorkLogs = new Map<string, MemoryWorkLog>();
  private readonly memorySourceConversations = new Map<
    string,
    MemorySourceConversation
  >();
  private readonly memoryAudits: MemorySedimentationAudit[] = [];
  private readonly memoryCandidateDecisions: MemoryCandidateDecision[] = [];
  private readonly memoryApprovalReceipts: MemoryApprovalReceipt[] = [];
  private readonly sourceTombstones = new Map<string, string>();
  private readonly entryTombstones = new Set<string>();

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
      this.memoryCandidateDecisions.some(
        (decision) =>
          decision.workspaceId === preference.workspaceId &&
          decision.candidateId === preference.candidateId &&
          decision.action === 'rejected',
      )
    ) {
      throw new ReuseMemoryError(
        'INVALID_STATE',
        'A rejected candidate cannot be confirmed.',
      );
    }
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
    if (
      input.expectedRevision === 0 &&
      (!input.decision || !input.approvalReceipt)
    ) {
      throw new ReuseMemoryError(
        'INVALID_STATE',
        'Preference confirmation requires a decision and approval receipt.',
      );
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
    if (input.expectedRevision === 0) {
      if (!input.decision || !input.approvalReceipt) {
        throw new ReuseMemoryError(
          'INVALID_STATE',
          'Preference confirmation requires a decision and approval receipt.',
        );
      }
      await this.appendMemoryCandidateDecision(input.decision);
      const approval = this.memoryApprovalReceipts.find(
        (item) =>
          item.workspaceId === input.approvalReceipt!.workspaceId &&
          item.receiptId === input.approvalReceipt!.receiptId,
      );
      ensureSameOrConflict(
        approval,
        input.approvalReceipt,
        `Memory approval ${input.approvalReceipt.receiptId}`,
      );
      if (!approval) {
        this.memoryApprovalReceipts.push(
          structuredClone(input.approvalReceipt),
        );
      }
    }
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

  async saveMemoryWorkLog(input: MemoryWorkLog) {
    if (
      this.sourceTombstones.has(
        key(input.workspaceId, input.conversationId),
      )
    ) {
      throw new ReuseMemoryError(
        'INVALID_STATE',
        `Conversation ${input.conversationId} was deleted.`,
      );
    }
    const identity = key(input.workspaceId, input.turnId);
    const current = this.memoryWorkLogs.get(identity);
    ensureSameOrConflict(current, input, `Work log ${input.turnId}`);
    if (!current) this.memoryWorkLogs.set(identity, structuredClone(input));
    return structuredClone(current ?? input);
  }

  async saveMemorySourceConversation(input: MemorySourceConversation) {
    const identity = key(input.workspaceId, input.conversationId);
    const current = this.memorySourceConversations.get(identity);
    ensureSameOrConflict(
      current,
      input,
      `Source conversation ${input.conversationId}`,
    );
    if (!current) {
      this.memorySourceConversations.set(identity, structuredClone(input));
    }
    return structuredClone(current ?? input);
  }

  async getMemoryWorkLog(workspaceId: string, turnId: string) {
    const log = this.memoryWorkLogs.get(key(workspaceId, turnId));
    return log ? structuredClone(log) : null;
  }

  async hasMemorySourceConversation(
    workspaceId: string,
    conversationId: string,
  ) {
    return this.memorySourceConversations.has(
      key(workspaceId, conversationId),
    );
  }

  async appendMemorySedimentationAudit(input: MemorySedimentationAudit) {
    const current = this.memoryAudits.find(
      (event) =>
        event.workspaceId === input.workspaceId && event.auditId === input.auditId,
    );
    ensureSameOrConflict(current, input, `Sedimentation audit ${input.auditId}`);
    if (!current) this.memoryAudits.push(structuredClone(input));
    return structuredClone(current ?? input);
  }

  async listMemorySedimentationAudits(workspaceId: string) {
    return structuredClone(
      this.memoryAudits.filter((event) => event.workspaceId === workspaceId),
    );
  }

  async appendMemoryCandidateDecision(input: MemoryCandidateDecision) {
    const current = this.memoryCandidateDecisions.find(
      (event) =>
        event.workspaceId === input.workspaceId &&
        event.decisionId === input.decisionId,
    );
    ensureSameOrConflict(current, input, `Memory decision ${input.decisionId}`);
    if (!current) {
      this.memoryCandidateDecisions.push(structuredClone(input));
    }
    return structuredClone(current ?? input);
  }

  async listMemoryCandidateDecisions(workspaceId: string) {
    return structuredClone(
      this.memoryCandidateDecisions.filter(
        (event) => event.workspaceId === workspaceId,
      ),
    );
  }

  async listMemoryApprovalReceipts(workspaceId: string) {
    return structuredClone(
      this.memoryApprovalReceipts.filter(
        (receipt) => receipt.workspaceId === workspaceId,
      ),
    );
  }

  async rejectMemoryCandidate(input: MemoryCandidateDecision) {
    if (
      this.preferenceCandidatePromotions.has(
        key(input.workspaceId, input.candidateId),
      )
    ) {
      throw new ReuseMemoryError(
        'INVALID_STATE',
        'A confirmed candidate cannot be rejected.',
      );
    }
    await this.appendMemoryCandidateDecision(input);
    return 'rejected' as const;
  }

  async listMemoryEntriesPage(
    workspaceId: string,
    query: MemoryEntriesPageQuery,
  ): Promise<MemoryEntriesPage> {
    const ordered = [...this.preferenceCandidates.values()]
      .filter(
        (candidate) =>
          candidate.workspaceId === workspaceId &&
          !this.entryTombstones.has(key(workspaceId, candidate.candidateId)),
      )
      .sort(
        (left, right) =>
          right.proposedAt.localeCompare(left.proposedAt) ||
          right.candidateId.localeCompare(left.candidateId),
      );
    const cursor = query.cursor
      ? (JSON.parse(
          Buffer.from(query.cursor, 'base64url').toString('utf8'),
        ) as [string, string])
      : null;
    const after = cursor
      ? ordered.filter(
          (candidate) =>
            candidate.proposedAt < cursor[0] ||
            (candidate.proposedAt === cursor[0] &&
              candidate.candidateId < cursor[1]),
        )
      : ordered;
    const selected = after.slice(0, query.limit + 1);
    const pageItems = selected.slice(0, query.limit);
    return {
      items: pageItems.map((candidate) => {
        const source = candidate.source;
        const log = source
          ? this.memorySourceConversations.get(
              key(workspaceId, source.conversationId),
            )
          : null;
        const preview = log?.messages
          .filter(
            (message) =>
              message.index >= (source?.messageRange.start ?? 0) &&
              message.index <= (source?.messageRange.end ?? -1),
          )
          .map((message) => message.text)
          .join(' ')
          .trim();
        const preferenceId = this.preferenceCandidatePromotions.get(
          key(workspaceId, candidate.candidateId),
        );
        const preferenceHead = preferenceId
          ? this.preferences.get(key(workspaceId, preferenceId))?.at(-1)
          : undefined;
        // Promotion alone is not "confirmed": a revoked head must project
        // `revoked` so vault / B2 AC3 stop treating it as active memory.
        const status = preferenceId
          ? preferenceHead?.recordState === 'revoked'
            ? ('revoked' as const)
            : ('confirmed' as const)
          : this.memoryCandidateDecisions.some(
                (decision) =>
                  decision.workspaceId === workspaceId &&
                  decision.candidateId === candidate.candidateId &&
                  decision.action === 'rejected',
              )
            ? ('rejected' as const)
            : ('pending' as const);
        return {
          entryId: candidate.candidateId,
          semanticKey: candidate.semanticKey,
          value: candidate.proposedValue,
          status,
          proposedAt: candidate.proposedAt,
          source:
            source
              ? {
                  conversationId: source.conversationId,
                  sourceTurnId: source.sourceTurnId,
                  messageRange: source.messageRange,
                  status: this.sourceTombstones.has(
                    key(workspaceId, source.conversationId),
                  )
                    ? ('deleted' as const)
                    : log && preview
                      ? ('available' as const)
                      : ('unavailable' as const),
                  observedAt: log?.observedAt ?? null,
                  preview:
                    this.sourceTombstones.has(
                      key(workspaceId, source.conversationId),
                    ) || !preview
                      ? null
                      : preview.slice(0, 500),
                  deletedAt:
                    this.sourceTombstones.get(
                      key(workspaceId, source.conversationId),
                    ) ?? null,
                }
              : null,
        };
      }),
      nextCursor:
        selected.length > query.limit && pageItems.at(-1)
          ? Buffer.from(
              JSON.stringify([
                pageItems.at(-1)?.proposedAt,
                pageItems.at(-1)?.candidateId,
              ]),
            ).toString('base64url')
          : null,
    };
  }

  async markMemorySourceDeleted(
    workspaceId: string,
    conversationId: string,
    deletedAt: string,
  ) {
    this.sourceTombstones.set(key(workspaceId, conversationId), deletedAt);
    this.memorySourceConversations.delete(key(workspaceId, conversationId));
    for (const [identity, log] of this.memoryWorkLogs) {
      if (
        log.workspaceId === workspaceId &&
        log.conversationId === conversationId
      ) {
        this.memoryWorkLogs.delete(identity);
      }
    }
  }

  async deleteMemoryEntry(input: {
    workspaceId: string;
    entryId: string;
    deletedAt: string;
    deletedBy: string;
  }) {
    const identity = key(input.workspaceId, input.entryId);
    if (this.entryTombstones.has(identity)) return 'deleted' as const;
    const candidate = this.preferenceCandidates.get(identity);
    if (!candidate) return 'not_found' as const;
    const preferenceId = this.preferenceCandidatePromotions.get(identity);
    if (preferenceId) {
      this.preferences.delete(key(input.workspaceId, preferenceId));
      this.preferenceCandidatePromotions.delete(identity);
      for (const [receiptIdentity, receipt] of this.preferenceReceipts) {
        if (
          receipt.result.workspaceId === input.workspaceId &&
          receipt.result.candidateId === input.entryId
        ) {
          this.preferenceReceipts.delete(receiptIdentity);
        }
      }
    }
    this.preferenceCandidates.delete(identity);
    this.entryTombstones.add(identity);
    return 'deleted' as const;
  }

  async isMemoryEntryDeleted(workspaceId: string, entryId: string) {
    return this.entryTombstones.has(key(workspaceId, entryId));
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
    if (
      await this.repository.isMemoryEntryDeleted(
        context.workspaceId,
        input.candidateId,
      )
    ) {
      throw new ReuseMemoryError('NOT_FOUND', 'Candidate was deleted.');
    }
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
    const kind = candidate.kind ?? 'preference';
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
      // V3.1 §12.5: cross-thread confirm → confirmed/active; copy ledger expansion
      kind,
      authority: 'confirmed' as const,
      memoryState: 'active' as const,
      decay:
        candidate.decay ??
        (kind === 'correction'
          ? { mode: 'none' as const }
          : { mode: 'soft_preference' as const, halfLifeDays: 90 }),
      confidence: candidate.confidence ?? 1,
      statement: candidate.statement,
      channel: 'cross_thread' as const,
    });
    const decision: MemoryCandidateDecision = {
      decisionId: `memory:confirmed:${input.idempotencyKey}`,
      workspaceId: context.workspaceId,
      candidateId: input.candidateId,
      action: 'confirmed',
      reason: 'candidate_confirmed',
      decidedBy: context.userId,
      decidedAt,
    };
    return this.repository.commitPreference({
      preference,
      decision,
      approvalReceipt: {
        receiptId: `memory-approval:${input.idempotencyKey}`,
        workspaceId: context.workspaceId,
        candidateId: input.candidateId,
        decisionId: decision.decisionId,
        status: 'approved',
        approvedBy: context.userId,
        approvedAt: decidedAt,
      },
      expectedRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey,
      fingerprint: commitFingerprint,
    });
  }

  async rejectPreferenceCandidate(
    context: { workspaceId: string; userId: string },
    input: {
      candidateId: string;
      reason: string;
      idempotencyKey: string;
    },
  ) {
    if (
      await this.repository.isMemoryEntryDeleted(
        context.workspaceId,
        input.candidateId,
      )
    ) {
      throw new ReuseMemoryError('NOT_FOUND', 'Candidate was deleted.');
    }
    const candidate = await this.repository.getPreferenceCandidate(
      context.workspaceId,
      input.candidateId,
    );
    if (!candidate) {
      throw new ReuseMemoryError('NOT_FOUND', 'Candidate not found.');
    }
    return this.repository.rejectMemoryCandidate({
      decisionId: `memory:rejected:${input.idempotencyKey}`,
      workspaceId: context.workspaceId,
      candidateId: input.candidateId,
      action: 'rejected',
      reason: input.reason,
      decidedBy: context.userId,
      decidedAt: this.now(),
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
      memoryState: 'revoked',
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
      candidates: candidates.map((candidate) => {
        const preference = preferenceByCandidate.get(candidate.candidateId);
        // Only a current head elevates the candidate to confirmed. A revoked
        // head must not re-confirm the vault/extractor view (V31-18 AC3).
        return {
          ...candidate,
          status:
            preference?.recordState === 'current'
              ? ('confirmed' as const)
              : candidate.status,
          preference: preference ?? null,
        };
      }),
      preferences,
    };
  }

  async memoryEntriesPage(
    workspaceId: string,
    input: MemoryEntriesPageQuery,
  ) {
    const query = memoryEntriesPageQuerySchema.parse(input);
    try {
      return memoryEntriesPageSchema.parse(
        await this.repository.listMemoryEntriesPage(workspaceId, query),
      );
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ReuseMemoryError('INVALID_STATE', 'Invalid memory page cursor.');
      }
      throw error;
    }
  }

  async listConfirmedPreferences(workspaceId: string) {
    const current = (await this.repository.listPreferenceHeads(workspaceId))
      .filter((preference) => preference.recordState === 'current')
      .sort(
        (left, right) =>
          right.confirmedAt.localeCompare(left.confirmedAt) ||
          right.preferenceId.localeCompare(left.preferenceId),
      );
    const latest = new Map<string, Preference>();
    for (const preference of current) {
      const semanticScope = JSON.stringify([
        preference.semanticKey,
        preference.finalScope,
      ]);
      if (!latest.has(semanticScope)) {
        latest.set(semanticScope, preference);
      }
    }
    return [...latest.values()].sort((left, right) =>
      left.preferenceId.localeCompare(right.preferenceId),
    );
  }

  async preferenceContextRevision(workspaceId: string) {
    const preferences = await this.listConfirmedPreferences(workspaceId);
    if (preferences.length === 0) return 0;
    return createHash('sha256')
      .update(
        JSON.stringify(
          preferences
            .map((preference) => ({
              preferenceId: preference.preferenceId,
              revision: preference.revision,
              recordState: preference.recordState,
            }))
            .sort((left, right) =>
              left.preferenceId.localeCompare(right.preferenceId),
            ),
        ),
      )
      .digest('hex');
  }

  async preferenceContextSnapshot(workspaceId: string) {
    const preferences = await this.listConfirmedPreferences(workspaceId);
    const revision =
      preferences.length === 0
        ? 0
        : createHash('sha256')
            .update(
              JSON.stringify(
                preferences.map((preference) => ({
                  preferenceId: preference.preferenceId,
                  revision: preference.revision,
                  recordState: preference.recordState,
                })),
              ),
            )
            .digest('hex');
    return { preferences, revision };
  }

  async markMemorySourceDeleted(
    workspaceId: string,
    conversationId: string,
  ) {
    await this.repository.markMemorySourceDeleted(
      workspaceId,
      conversationId,
      this.now(),
    );
  }

  async saveMemoryWorkLog(input: MemoryWorkLog) {
    return this.repository.saveMemoryWorkLog(input);
  }

  async saveMemorySourceConversation(input: MemorySourceConversation) {
    return this.repository.saveMemorySourceConversation(input);
  }

  async deleteMemorySourceConversation(
    context: { workspaceId: string },
    conversationId: string,
  ) {
    if (
      !(await this.repository.hasMemorySourceConversation(
        context.workspaceId,
        conversationId,
      ))
    ) {
      throw new ReuseMemoryError(
        'NOT_FOUND',
        'Source conversation was not found.',
      );
    }
    await this.repository.markMemorySourceDeleted(
      context.workspaceId,
      conversationId,
      this.now(),
    );
    return 'deleted' as const;
  }

  async deleteMemoryEntry(
    context: { workspaceId: string; userId: string },
    entryId: string,
  ) {
    return this.repository.deleteMemoryEntry({
      workspaceId: context.workspaceId,
      entryId,
      deletedAt: this.now(),
      deletedBy: context.userId,
    });
  }

  /** A11: ApprovalReceipts survive memory entry deletion. */
  async listMemoryApprovalReceipts(workspaceId: string) {
    return this.repository.listMemoryApprovalReceipts(workspaceId);
  }
}
