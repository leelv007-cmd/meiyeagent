/**
 * V31-18 Agent Memory platform (V3.1 §12, U4/U5, A11).
 *
 * Preference / correction ledger stays on the existing three-table base
 * (p1_preference_candidates / promotions / heads). This module owns:
 * - dual-channel authority (session vs cross-thread confirm)
 * - passive observation / Extractor onExtracted → always proposed
 * - scope-narrowest retrieval ranking (similarity never decides tenancy)
 * - MemoryInjectionReceipt write/read + revoke-from-future-injection
 * - historical migration → proposed only
 * - working-memory extract/project strategy interfaces (write path = V31-06)
 *
 * Does NOT touch OutcomeEvidence / resultSignals (V31-19).
 */

import {
  AGENT_MEMORY_ENTRY_SCHEMA_VERSION,
  MEMORY_INJECTION_RECEIPT_SCHEMA_VERSION,
  agentMemoryEntrySchema,
  memoryInjectionReceiptSchema,
  preferenceCandidateSchema,
  type AgentMemoryEntry,
  type AgentMemoryScope,
  type MemoryInjectionReceipt,
  type Preference,
  type PreferenceCandidate,
  type PreferenceMemoryAuthority,
  type PreferenceMemoryDecay,
  type PreferenceMemoryKind,
  type PreferenceMemoryState,
  type ReusableAssetScope,
} from '@meiye/contracts';
import { createHash } from 'node:crypto';

import {
  ReuseMemoryError,
  type MemoryApprovalReceipt,
  type ReuseMemoryService,
} from './reuse-memory-service.js';

// ─── Feature flags / kill switches (spec-E §14) ─────────────────────────────
// Registered in admin-config CONFIG_DEFINITIONS + ADMIN_CONFIG_KEY_CLASSIFICATION.

/** Feature flags (workspace/global allow) — default on when unset. */
export const AGENT_MEMORY_FLAGS = {
  read: 'agent_memory_read_v1',
  candidateWrite: 'agent_memory_candidate_write_v1',
} as const;

/** Kill switches — default off when unset; force-disable independent of feature flags. */
export const AGENT_MEMORY_KILL_SWITCH_KEYS = {
  disableWrite: 'disable_memory_write',
  disableRead: 'disable_memory_read',
} as const;

export type AgentMemoryKillSwitch = {
  disableMemoryWrite: boolean;
  disableMemoryRead: boolean;
};

export type AgentMemoryKillSwitchSource =
  | AgentMemoryKillSwitch
  | (() => AgentMemoryKillSwitch | Promise<AgentMemoryKillSwitch>);

export const DEFAULT_AGENT_MEMORY_KILL_SWITCH: AgentMemoryKillSwitch = {
  disableMemoryWrite: false,
  disableMemoryRead: false,
};

/**
 * Resolve kill switch from admin-config heads.
 * Feature flag off OR kill switch true ⇒ path disabled.
 */
export async function resolveAgentMemoryKillSwitch(reader: {
  get(
    scope: 'global',
    workspaceId: string,
    key: string,
  ): Promise<{ value: unknown } | null>;
}): Promise<AgentMemoryKillSwitch> {
  const global = '__global__';
  const [readFlag, writeFlag, disableWrite, disableRead] = await Promise.all([
    reader.get('global', global, AGENT_MEMORY_FLAGS.read),
    reader.get('global', global, AGENT_MEMORY_FLAGS.candidateWrite),
    reader.get('global', global, AGENT_MEMORY_KILL_SWITCH_KEYS.disableWrite),
    reader.get('global', global, AGENT_MEMORY_KILL_SWITCH_KEYS.disableRead),
  ]);
  const featureReadOn = readFlag?.value !== false;
  const featureWriteOn = writeFlag?.value !== false;
  return {
    disableMemoryWrite: disableWrite?.value === true || !featureWriteOn,
    disableMemoryRead: disableRead?.value === true || !featureReadOn,
  };
}

// ─── Working memory (V31-06 is sole checkpoint writer) ──────────────────────

/**
 * Hook id for Session Harness compaction (V31-06). This platform only defines
 * extract/project strategy contracts — it must not open a second write path.
 */
export const WORKING_MEMORY_CHECKPOINT_WRITE_HOOK =
  'v31-06.session-harness.compaction.write-working-memory' as const;

export type WorkingMemoryProjection = {
  kind: 'working';
  statement: string;
  goalSummary?: string;
  strategySummary?: string;
  revision: number;
  effectiveFrom: string;
};

export type WorkingMemoryExtractInput = {
  threadId: string;
  messages: Array<{ role: string; text: string }>;
  priorProjection?: WorkingMemoryProjection | null;
};

/** Extract bounded working projection from Thread context (no persistence). */
export interface WorkingMemoryExtractStrategy {
  extract(input: WorkingMemoryExtractInput): Promise<WorkingMemoryProjection>;
}

/**
 * Project a Thread checkpoint payload into the AgentMemoryEntry shape.
 * Persistence of the checkpoint itself is owned by V31-06 sole writer.
 */
export interface WorkingMemoryProjectStrategy {
  project(input: {
    threadId: string;
    workspaceId: string;
    checkpoint: unknown;
  }): AgentMemoryEntry | null;
}

/** Default extract: bounded one-line summary; never writes. */
export class DefaultWorkingMemoryExtractStrategy
  implements WorkingMemoryExtractStrategy
{
  async extract(
    input: WorkingMemoryExtractInput,
  ): Promise<WorkingMemoryProjection> {
    const tail = input.messages
      .slice(-6)
      .map((message) => message.text.trim())
      .filter(Boolean);
    const statement =
      tail.length > 0
        ? tail.join(' / ').slice(0, 500)
        : 'empty-working-context';
    return {
      kind: 'working',
      statement,
      revision: (input.priorProjection?.revision ?? 0) + 1,
      effectiveFrom: new Date().toISOString(),
    };
  }
}

// ─── Injection receipt store ────────────────────────────────────────────────

export interface MemoryInjectionReceiptStore {
  save(receipt: MemoryInjectionReceipt): Promise<MemoryInjectionReceipt>;
  getByTask(taskId: string): Promise<MemoryInjectionReceipt | null>;
  getByRun(runId: string): Promise<MemoryInjectionReceipt | null>;
}

function hasSameInjectionBusinessIdentity(
  left: MemoryInjectionReceipt,
  right: MemoryInjectionReceipt,
): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.taskId === right.taskId &&
    left.runId === right.runId &&
    left.harnessReleaseId === right.harnessReleaseId &&
    JSON.stringify(left.entries) === JSON.stringify(right.entries)
  );
}

export class MemoryInjectionReceiptMemoryStore
  implements MemoryInjectionReceiptStore
{
  private readonly byTask = new Map<string, MemoryInjectionReceipt>();
  private readonly byRun = new Map<string, MemoryInjectionReceipt>();

  async save(input: MemoryInjectionReceipt) {
    const receipt = memoryInjectionReceiptSchema.parse(input);
    const existing = this.byTask.get(receipt.taskId);
    if (existing) {
      // A retry can have a later clock after the first response was lost.
      if (!hasSameInjectionBusinessIdentity(existing, receipt)) {
        throw new ReuseMemoryError(
          'CONFLICT',
          `Injection receipt for task ${receipt.taskId} already exists with another payload.`,
        );
      }
      return structuredClone(existing);
    }
    this.byTask.set(receipt.taskId, structuredClone(receipt));
    this.byRun.set(receipt.runId, structuredClone(receipt));
    return structuredClone(receipt);
  }

  async getByTask(taskId: string) {
    const receipt = this.byTask.get(taskId);
    return receipt ? structuredClone(receipt) : null;
  }

  async getByRun(runId: string) {
    const receipt = this.byRun.get(runId);
    return receipt ? structuredClone(receipt) : null;
  }
}

// ─── Extractor observation types ────────────────────────────────────────────

export type MemoryExtractionItem = {
  itemId: string;
  kind: PreferenceMemoryKind;
  semanticKey: string;
  proposedValue: unknown;
  defaultScope: ReusableAssetScope;
  statement?: string;
  confidence?: number;
  /** Evidence binding — never optional on production extraction. */
  decisionEventId: string;
  taskId: string;
  source: {
    conversationId: string;
    sourceTurnId: string;
    messageRange: { start: number; end: number };
  };
};

export type OnExtractedInput = {
  workspaceId: string;
  items: MemoryExtractionItem[];
  /**
   * Idempotency prefix; candidates become
   * preference-candidate-${hash(workspace|prefix|itemId)}.
   */
  idempotencyPrefix: string;
};

// ─── Retrieval ──────────────────────────────────────────────────────────────

export type MemoryRetrieveQuery = {
  workspaceId: string;
  /** Legal scope filter — store × IP × scene × platform (narrowest combo). */
  scope: AgentMemoryScope;
  /** When set, include session-scoped active candidates for this Thread. */
  threadId?: string;
  /** Optional similarity scores keyed by memoryId — rank ONLY inside legal set. */
  similarityByMemoryId?: Record<string, number>;
  limit?: number;
  now?: string;
  /**
   * V31-18 production chain: when a real generation turn injects memories,
   * the caller binds this context so the platform records the
   * MemoryInjectionReceipt right after retrieval. Omit for read-only /
   * offline retrieval (evals, tests) — no receipt is written.
   */
  injectionContext?: {
    taskId?: string;
    runId: string;
    harnessReleaseId: string;
  };
};

// ─── Migration ──────────────────────────────────────────────────────────────

export type LegacyMemoryMigrationRow = {
  semanticKey: string;
  value: unknown;
  defaultScope: ReusableAssetScope;
  statement?: string;
  kind?: PreferenceMemoryKind;
  evidenceDecisionId: string;
  evidenceTaskId: string;
  source?: PreferenceCandidate['source'];
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function statementOf(
  value: unknown,
  fallback: string,
  explicit?: string,
): string {
  if (explicit?.trim()) return explicit.trim().slice(0, 4_000);
  if (typeof value === 'string' && value.trim()) {
    return value.trim().slice(0, 4_000);
  }
  try {
    return JSON.stringify(value).slice(0, 4_000);
  } catch {
    return fallback;
  }
}

function defaultDecay(kind: PreferenceMemoryKind): PreferenceMemoryDecay {
  return kind === 'correction'
    ? { mode: 'none' }
    : { mode: 'soft_preference', halfLifeDays: 90 };
}

function scopeDimensionCount(scope: {
  storeId?: string;
  personaId?: string;
  scene?: string;
  platform?: string;
}): number {
  let count = 0;
  if (scope.storeId) count += 1;
  if (scope.personaId) count += 1;
  if (scope.scene) count += 1;
  if (scope.platform) count += 1;
  return count;
}

/**
 * Memory applies when every set field on the memory scope matches the query.
 * Missing memory dimensions mean "wider" (applies to more queries).
 * Workspace / rights / fact validity are NOT decided here.
 */
export function memoryScopeMatches(
  memoryScope: {
    storeId?: string;
    personaId?: string;
    scene?: string;
    platform?: string;
  },
  queryScope: AgentMemoryScope,
): boolean {
  for (const key of ['storeId', 'personaId', 'scene', 'platform'] as const) {
    const memoryValue = memoryScope[key];
    if (memoryValue !== undefined && queryScope[key] !== memoryValue) {
      return false;
    }
  }
  return true;
}

/**
 * Soft-preference exponential decay on confidence. Corrections never decay.
 */
export function applyMemoryDecay(input: {
  kind: PreferenceMemoryKind;
  confidence: number;
  decay?: PreferenceMemoryDecay;
  effectiveFrom: string;
  now: string;
}): number {
  if (input.kind === 'correction') return input.confidence;
  const decay = input.decay ?? defaultDecay(input.kind);
  if (decay.mode === 'none') return input.confidence;
  const halfLifeDays = decay.halfLifeDays ?? 90;
  const start = Date.parse(input.effectiveFrom);
  const end = Date.parse(input.now);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return input.confidence;
  }
  const ageDays = (end - start) / (24 * 60 * 60 * 1000);
  const factor = 2 ** (-ageDays / halfLifeDays);
  return Math.max(0, Math.min(1, input.confidence * factor));
}

function kindRank(kind: PreferenceMemoryKind): number {
  // Lower = higher priority. Correction always beats soft preference.
  if (kind === 'correction') return 0;
  if (kind === 'preference') return 1;
  return 2;
}

function candidateIdFrom(parts: unknown[]): string {
  const digest = createHash('sha256')
    .update(JSON.stringify(parts))
    .digest('hex')
    .slice(0, 24);
  return `preference-candidate-${digest}`;
}

function asMemoryId(id: string) {
  return id as AgentMemoryEntry['memoryId'];
}

function asResourceId(id: string) {
  return id as AgentMemoryEntry['resourceId'];
}

function asRunId(id: string) {
  return id as MemoryInjectionReceipt['runId'];
}

function asReleaseId(id: string) {
  return id as MemoryInjectionReceipt['harnessReleaseId'];
}

export function normalizeCandidateFields(candidate: PreferenceCandidate): {
  kind: PreferenceMemoryKind;
  authority: PreferenceMemoryAuthority;
  memoryState: PreferenceMemoryState;
  decay: PreferenceMemoryDecay;
  confidence: number;
  statement: string;
  channel: 'session' | 'cross_thread';
} {
  const kind = candidate.kind ?? 'preference';
  return {
    kind,
    authority: candidate.authority ?? 'observation',
    memoryState: candidate.memoryState ?? 'proposed',
    decay: candidate.decay ?? defaultDecay(kind),
    confidence: candidate.confidence ?? 0.5,
    statement: statementOf(
      candidate.proposedValue,
      candidate.semanticKey,
      candidate.statement,
    ),
    channel: candidate.channel ?? 'cross_thread',
  };
}

export function projectPreferenceToAgentMemoryEntry(
  preference: Preference,
  options?: { now?: string },
): AgentMemoryEntry {
  const kind = preference.kind ?? 'preference';
  const effectiveFrom = preference.confirmedAt;
  const baseConfidence = preference.confidence ?? 1;
  const decay = preference.decay ?? defaultDecay(kind);
  const confidence =
    preference.recordState === 'current'
      ? applyMemoryDecay({
          kind,
          confidence: baseConfidence,
          decay,
          effectiveFrom,
          now: options?.now ?? new Date().toISOString(),
        })
      : 0;
  const state: PreferenceMemoryState =
    preference.memoryState ??
    (preference.recordState === 'current'
      ? 'active'
      : preference.recordState === 'revoked'
        ? 'revoked'
        : 'superseded');
  return agentMemoryEntrySchema.parse({
    schemaVersion: AGENT_MEMORY_ENTRY_SCHEMA_VERSION,
    memoryId: asMemoryId(preference.preferenceId),
    resourceId: asResourceId(preference.workspaceId),
    kind,
    scope: {
      storeId: preference.finalScope.storeId,
      personaId: preference.finalScope.personaId,
      scene: preference.finalScope.scene,
      platform: preference.finalScope.platform,
    },
    authority: preference.authority ?? 'confirmed',
    state,
    statement: statementOf(
      preference.value,
      preference.semanticKey,
      preference.statement,
    ),
    evidenceRefs: preference.evidenceDecisionIds.map((id) => ({
      kind: 'decision',
      ref: id,
    })),
    confidence,
    effectiveFrom,
    revision: preference.revision,
  });
}

export function projectCandidateToAgentMemoryEntry(
  candidate: PreferenceCandidate,
): AgentMemoryEntry {
  const fields = normalizeCandidateFields(candidate);
  return agentMemoryEntrySchema.parse({
    schemaVersion: AGENT_MEMORY_ENTRY_SCHEMA_VERSION,
    memoryId: asMemoryId(candidate.candidateId),
    resourceId: asResourceId(candidate.workspaceId),
    kind: fields.kind,
    scope: {
      storeId: candidate.defaultScope.storeId,
      personaId: candidate.defaultScope.personaId,
      scene: candidate.defaultScope.scene,
      platform: candidate.defaultScope.platform,
    },
    authority: fields.authority,
    state: fields.memoryState,
    statement: fields.statement,
    evidenceRefs: candidate.evidenceDecisionIds.map((id) => ({
      kind: 'decision',
      ref: id,
    })),
    confidence: fields.confidence,
    effectiveFrom: candidate.proposedAt,
    revision: 0,
  });
}

// ─── Platform service ───────────────────────────────────────────────────────

export class AgentMemoryPlatform {
  constructor(
    private readonly reuse: ReuseMemoryService,
    private readonly injectionStore: MemoryInjectionReceiptStore = new MemoryInjectionReceiptMemoryStore(),
    private readonly killSwitch: AgentMemoryKillSwitchSource = DEFAULT_AGENT_MEMORY_KILL_SWITCH,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /**
   * Extractor onExtracted hook (V3.1 §12.4 / A6).
   * Always lands candidates as proposed / observation — never active heads.
   * false_persistence_rate gate: no path here writes preference heads.
   */
  async onExtracted(input: OnExtractedInput): Promise<PreferenceCandidate[]> {
    await this.assertWriteEnabled();
    const proposed: PreferenceCandidate[] = [];
    for (const item of input.items) {
      if (/^(?:business_fact|store_fact)\./u.test(item.semanticKey)) {
        throw new ReuseMemoryError(
          'INVALID_STATE',
          `Business Fact ${item.semanticKey} belongs to the fact ledger and cannot be overridden by Memory.`,
        );
      }
      if (item.kind !== 'preference' && item.kind !== 'correction' && item.kind !== 'procedure') {
        throw new ReuseMemoryError(
          'INVALID_STATE',
          `Extractor kind ${String(item.kind)} is not writable on preference ledger.`,
        );
      }
      const candidateId = candidateIdFrom([
        input.workspaceId,
        input.idempotencyPrefix,
        item.itemId,
      ]);
      // Idempotent onExtracted: same workspace|prefix|itemId returns existing row.
      const view = await this.reuse.preferenceView(input.workspaceId);
      const existing = view.candidates.find(
        (row) => row.candidateId === candidateId,
      );
      if (existing) {
        if (
          existing.status === 'confirmed' ||
          existing.memoryState === 'active'
        ) {
          // Existing active/confirmed head from another path is a false-persistence signal.
          throw new ReuseMemoryError(
            'INVALID_STATE',
            'Extractor onExtracted must not activate memory.',
          );
        }
        const {
          preference: _preference,
          ...raw
        } = existing as PreferenceCandidate & {
          preference?: Preference | null;
        };
        void _preference;
        proposed.push(preferenceCandidateSchema.parse(raw));
        continue;
      }
      const decay = defaultDecay(item.kind);
      const candidate = await this.reuse.proposePreference(
        preferenceCandidateSchema.parse({
          candidateId,
          workspaceId: input.workspaceId,
          semanticKey: item.semanticKey,
          proposedValue: item.proposedValue,
          defaultScope: item.defaultScope,
          evidenceDecisionIds: [item.decisionEventId],
          evidenceTaskIds: [item.taskId],
          trigger: 'explicit_long_term_intent',
          status: 'pending',
          proposedAt: this.now(),
          source: item.source,
          kind: item.kind,
          // Dual-channel red line: Extractor never session-activates or confirms.
          authority: 'observation',
          memoryState: 'proposed',
          decay,
          confidence: item.confidence ?? 0.5,
          statement: statementOf(
            item.proposedValue,
            item.semanticKey,
            item.statement,
          ),
          channel: 'cross_thread',
        }),
      );
      // Constructive false-persistence check: status must remain pending.
      if (candidate.status !== 'pending' || candidate.memoryState === 'active') {
        throw new ReuseMemoryError(
          'INVALID_STATE',
          'Extractor onExtracted must not activate memory.',
        );
      }
      proposed.push(candidate);
    }
    return proposed;
  }

  /**
   * L1 Session-scoped channel: Thread-local immediate effect.
   * Does not promote to preference heads; cross-thread requires confirm.
   */
  async activateSessionScoped(input: {
    workspaceId: string;
    threadId: string;
    kind: PreferenceMemoryKind;
    semanticKey: string;
    proposedValue: unknown;
    defaultScope: ReusableAssetScope;
    decisionEventId: string;
    taskId: string;
    statement?: string;
    confidence?: number;
    source?: PreferenceCandidate['source'];
    idempotencyKey: string;
  }): Promise<PreferenceCandidate> {
    await this.assertWriteEnabled();
    if (input.kind === 'procedure') {
      // Procedural always requires propose → confirm (L3).
      throw new ReuseMemoryError(
        'INVALID_STATE',
        'Procedural memory cannot activate on the session channel.',
      );
    }
    const candidateId = candidateIdFrom([
      input.workspaceId,
      input.idempotencyKey,
      'session',
    ]);
    return this.reuse.proposePreference(
      preferenceCandidateSchema.parse({
        candidateId,
        workspaceId: input.workspaceId,
        semanticKey: input.semanticKey,
        proposedValue: input.proposedValue,
        defaultScope: input.defaultScope,
        evidenceDecisionIds: [input.decisionEventId],
        evidenceTaskIds: [input.taskId],
        trigger: 'explicit_long_term_intent',
        status: 'pending',
        proposedAt: this.now(),
        source: input.source,
        kind: input.kind,
        authority: 'session',
        memoryState: 'active',
        decay: defaultDecay(input.kind),
        confidence: input.confidence ?? 1,
        statement: statementOf(
          input.proposedValue,
          input.semanticKey,
          input.statement,
        ),
        threadId: input.threadId,
        channel: 'session',
      }),
    );
  }

  /**
   * End-of-Thread one-click proposal: session → cross-thread candidate (still proposed).
   */
  async proposeSessionPromotion(input: {
    workspaceId: string;
    sessionCandidateId: string;
    idempotencyKey: string;
  }): Promise<PreferenceCandidate> {
    await this.assertWriteEnabled();
    const session = await this.requireCandidate(
      input.workspaceId,
      input.sessionCandidateId,
    );
    const fields = normalizeCandidateFields(session);
    if (fields.authority !== 'session' || fields.channel !== 'session') {
      throw new ReuseMemoryError(
        'INVALID_STATE',
        'Only session-scoped memory can be promoted to a cross-thread candidate.',
      );
    }
    const candidateId = candidateIdFrom([
      input.workspaceId,
      input.idempotencyKey,
      'promote',
    ]);
    return this.reuse.proposePreference(
      preferenceCandidateSchema.parse({
        candidateId,
        workspaceId: input.workspaceId,
        semanticKey: session.semanticKey,
        proposedValue: session.proposedValue,
        defaultScope: session.defaultScope,
        evidenceDecisionIds: session.evidenceDecisionIds,
        evidenceTaskIds: session.evidenceTaskIds,
        trigger: 'explicit_long_term_intent',
        status: 'pending',
        proposedAt: this.now(),
        source: session.source,
        kind: fields.kind,
        authority: 'observation',
        memoryState: 'proposed',
        decay: fields.decay,
        confidence: fields.confidence,
        statement: fields.statement,
        channel: 'cross_thread',
      }),
    );
  }

  async confirmMemoryCandidate(
    context: { workspaceId: string; userId: string },
    input: {
      candidateId: string;
      preferenceId: string;
      positiveExamples?: string[];
      negativeExamples?: string[];
      finalScope?: ReusableAssetScope;
      scopeDecisionId?: string;
      idempotencyKey: string;
    },
  ): Promise<Preference> {
    await this.assertWriteEnabled();
    const candidate = await this.requireCandidate(
      context.workspaceId,
      input.candidateId,
    );
    const fields = normalizeCandidateFields(candidate);
    if (fields.authority === 'session' && fields.channel === 'session') {
      throw new ReuseMemoryError(
        'INVALID_STATE',
        'Session memory must be promoted to a cross-thread candidate before confirm.',
      );
    }
    return this.reuse.confirmPreference(context, {
      candidateId: input.candidateId,
      preferenceId: input.preferenceId,
      expectedRevision: 0,
      positiveExamples: input.positiveExamples ?? [],
      negativeExamples: input.negativeExamples ?? [],
      finalScope: input.finalScope,
      scopeDecisionId: input.scopeDecisionId,
      idempotencyKey: input.idempotencyKey,
    });
  }

  async revokeMemory(
    context: { workspaceId: string; userId: string },
    input: {
      preferenceId: string;
      expectedRevision: number;
      idempotencyKey: string;
    },
  ): Promise<Preference> {
    await this.assertWriteEnabled();
    return this.reuse.revokePreference(context, input);
  }

  /**
   * Retrieve injectable memories for a generation run.
   * Filter order (hard): workspace → scope match → state/authority eligibility.
   * Sort order: kind (correction first) → scope narrowness → confidence
   * → optional similarity (never overrides prior keys).
   */
  async retrieveForInjection(
    query: MemoryRetrieveQuery,
  ): Promise<AgentMemoryEntry[]> {
    await this.assertReadEnabled();
    const now = query.now ?? this.now();
    const limit = query.limit ?? 20;
    const entries: AgentMemoryEntry[] = [];

    const heads = await this.reuse.listConfirmedPreferences(query.workspaceId);
    for (const preference of heads) {
      if (preference.workspaceId !== query.workspaceId) continue; // belt+suspenders
      if (preference.recordState !== 'current') continue;
      if (!memoryScopeMatches(preference.finalScope, query.scope)) continue;
      entries.push(
        projectPreferenceToAgentMemoryEntry(preference, { now }),
      );
    }

    if (query.threadId) {
      const view = await this.reuse.preferenceView(query.workspaceId);
      for (const candidate of view.candidates) {
        const fields = normalizeCandidateFields(candidate);
        if (fields.authority !== 'session' || fields.memoryState !== 'active') {
          continue;
        }
        if (candidate.threadId !== query.threadId) continue;
        if (candidate.workspaceId !== query.workspaceId) continue;
        if (!memoryScopeMatches(candidate.defaultScope, query.scope)) continue;
        // Skip if already promoted to a confirmed head for same candidate id.
        if (candidate.status === 'confirmed') continue;
        entries.push(projectCandidateToAgentMemoryEntry(candidate));
      }
    }

    const similarity = query.similarityByMemoryId ?? {};
    entries.sort((left, right) => {
      const kindDelta =
        kindRank(left.kind as PreferenceMemoryKind) -
        kindRank(right.kind as PreferenceMemoryKind);
      if (kindDelta !== 0) return kindDelta;
      const narrowDelta =
        scopeDimensionCount(right.scope) - scopeDimensionCount(left.scope);
      if (narrowDelta !== 0) return narrowDelta;
      if (right.confidence !== left.confidence) {
        return right.confidence - left.confidence;
      }
      const simDelta =
        (similarity[right.memoryId] ?? 0) - (similarity[left.memoryId] ?? 0);
      if (simDelta !== 0) return simDelta;
      return left.memoryId.localeCompare(right.memoryId);
    });

    const result = entries.slice(0, limit);

    // Persist the receipt before returning injectable memory. Plan compilation
    // may only apply these entries after the durable receipt/outbox commits.
    const injection = query.injectionContext;
    const confirmedForInjection = result.filter(
      (entry) => entry.authority !== 'session',
    );
    if (injection && confirmedForInjection.length > 0 && injection.taskId) {
      await this.recordInjectionReceipt({
        taskId: injection.taskId,
        runId: injection.runId,
        harnessReleaseId: injection.harnessReleaseId,
        entries: confirmedForInjection,
      });
    }

    return result;
  }

  /**
   * Record MemoryInjectionReceipt bound to exact task/run/release + revision refs.
   */
  async recordInjectionReceipt(input: {
    taskId: string;
    runId: string;
    harnessReleaseId: string;
    entries: AgentMemoryEntry[];
    injectedAt?: string;
  }): Promise<MemoryInjectionReceipt> {
    await this.assertWriteEnabled();
    return this.injectionStore.save(
      memoryInjectionReceiptSchema.parse({
        schemaVersion: MEMORY_INJECTION_RECEIPT_SCHEMA_VERSION,
        taskId: input.taskId,
        runId: asRunId(input.runId),
        harnessReleaseId: asReleaseId(input.harnessReleaseId),
        entries: input.entries.map((entry) => ({
          memoryId: entry.memoryId,
          statement: entry.statement,
          revision: entry.revision,
        })),
        injectedAt: input.injectedAt ?? this.now(),
      }),
    );
  }

  async getInjectionReceiptByTask(
    taskId: string,
  ): Promise<MemoryInjectionReceipt | null> {
    await this.assertReadEnabled();
    return this.injectionStore.getByTask(taskId);
  }

  async getInjectionReceiptByRun(
    runId: string,
  ): Promise<MemoryInjectionReceipt | null> {
    await this.assertReadEnabled();
    return this.injectionStore.getByRun(runId);
  }

  /**
   * Historical migration: only produce proposed candidates — never auto-activate.
   */
  async migrateLegacyAsProposed(input: {
    workspaceId: string;
    rows: LegacyMemoryMigrationRow[];
    migrationBatchId: string;
  }): Promise<PreferenceCandidate[]> {
    await this.assertWriteEnabled();
    const proposed: PreferenceCandidate[] = [];
    for (const [index, row] of input.rows.entries()) {
      const kind = row.kind ?? 'preference';
      const candidateId = candidateIdFrom([
        input.workspaceId,
        input.migrationBatchId,
        index,
        row.semanticKey,
      ]);
      const candidate = await this.reuse.proposePreference(
        preferenceCandidateSchema.parse({
          candidateId,
          workspaceId: input.workspaceId,
          semanticKey: row.semanticKey,
          proposedValue: row.value,
          defaultScope: row.defaultScope,
          evidenceDecisionIds: [row.evidenceDecisionId],
          evidenceTaskIds: [row.evidenceTaskId],
          trigger: 'explicit_long_term_intent',
          status: 'pending',
          proposedAt: this.now(),
          source: row.source,
          kind,
          authority: 'observation',
          memoryState: 'proposed',
          decay: defaultDecay(kind),
          confidence: 0.4,
          statement: statementOf(row.value, row.semanticKey, row.statement),
          channel: 'cross_thread',
        }),
      );
      if (candidate.memoryState === 'active' || candidate.status !== 'pending') {
        throw new ReuseMemoryError(
          'INVALID_STATE',
          'Historical migration must only produce proposed candidates.',
        );
      }
      proposed.push(candidate);
    }
    return proposed;
  }

  /**
   * A11: delete memory entry while ApprovalReceipt rows remain readable.
   */
  async deleteMemoryKeepingReceipts(
    context: { workspaceId: string; userId: string },
    entryId: string,
  ): Promise<{
    deleted: 'deleted' | 'not_found';
    approvalReceipts: MemoryApprovalReceipt[];
  }> {
    await this.assertWriteEnabled();
    const deleted = await this.reuse.deleteMemoryEntry(context, entryId);
    const approvalReceipts =
      await this.reuse.listMemoryApprovalReceipts(context.workspaceId);
    return { deleted, approvalReceipts };
  }

  /**
   * Mark source conversation deleted without cascading memory rows (A11).
   * Entries remain listable with source.status = 'deleted'.
   */
  async markSourceDeleted(
    workspaceId: string,
    conversationId: string,
  ): Promise<void> {
    await this.assertWriteEnabled();
    await this.reuse.markMemorySourceDeleted(workspaceId, conversationId);
  }

  /** Offline retrieval precision helper (eval seam). */
  static scoreRetrievalPrecision(input: {
    retrievedIds: string[];
    relevantIds: string[];
  }): number {
    if (input.relevantIds.length === 0) return 1;
    const relevant = new Set(input.relevantIds);
    const hits = input.retrievedIds.filter((id) => relevant.has(id)).length;
    return hits / input.relevantIds.length;
  }

  private async requireCandidate(workspaceId: string, candidateId: string) {
    const view = await this.reuse.preferenceView(workspaceId);
    const candidate = view.candidates.find(
      (row) => row.candidateId === candidateId,
    );
    if (!candidate) {
      throw new ReuseMemoryError('NOT_FOUND', 'Candidate not found.');
    }
    // Strip view-only preference join for re-propose / parse safety.
    const {
      preference: _preference,
      ...raw
    } = candidate as PreferenceCandidate & { preference?: Preference | null };
    void _preference;
    return preferenceCandidateSchema.parse(raw);
  }

  private async resolveKillSwitch(): Promise<AgentMemoryKillSwitch> {
    if (typeof this.killSwitch === 'function') {
      return this.killSwitch();
    }
    return this.killSwitch;
  }

  private async assertWriteEnabled() {
    const switchState = await this.resolveKillSwitch();
    if (switchState.disableMemoryWrite) {
      throw new ReuseMemoryError(
        'INVALID_STATE',
        'Memory write is disabled by kill switch.',
      );
    }
  }

  private async assertReadEnabled() {
    const switchState = await this.resolveKillSwitch();
    if (switchState.disableMemoryRead) {
      throw new ReuseMemoryError(
        'INVALID_STATE',
        'Memory read is disabled by kill switch.',
      );
    }
  }
}
