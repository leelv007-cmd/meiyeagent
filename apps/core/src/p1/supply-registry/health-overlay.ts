/**
 * Durable health overlay state machine (G4 / D-059 / D-080 C6).
 *
 * Overlay affects NEW tasks only and never mutates a RoutePolicy revision.
 * WT-I reports failure facts; WT-G owns persistence and transitions.
 */
import type {
  HealthOverlayPort,
  HealthOverlayRecord,
  HealthOverlayState,
} from '@meiye/contracts';
import {
  ENVOY_BASE_EJECTION_TIME_SECONDS,
  ENVOY_CONSECUTIVE_5XX,
  LITELLM_ALLOWED_FAILS,
  LITELLM_COOLDOWN_TIME_SECONDS,
} from './health-overlay-constants.js';

export type HealthFailureFactKind =
  | 'success'
  | 'rate_limited'
  | 'server_error'
  | 'connection_error'
  | 'hard_failure'
  | 'accepted_failure'
  | 'acceptance_unknown'
  | 'probe_unavailable'
  | 'manual_degraded'
  | 'manual_unavailable'
  | 'manual_clear';

export interface HealthFailureFact {
  targetKind: HealthOverlayRecord['targetKind'];
  targetId: string;
  kind: HealthFailureFactKind;
  reason: string;
  source: string;
  /** Optional audit correlation / evidence ref. */
  auditRef?: string;
  observedAt?: string;
}

export interface HealthOverlayCounters {
  consecutiveFails: number;
  consecutive5xx: number;
}

export interface StoredHealthOverlay {
  record: HealthOverlayRecord;
  counters: HealthOverlayCounters;
}

/** States that exclude a candidate from NEW task planning (not in-flight). */
export const HEALTH_OVERLAY_BLOCKING_STATES: readonly HealthOverlayState[] = [
  'cooldown',
  'circuit_open',
  'unavailable',
] as const;

export function isHealthOverlayBlocking(
  state: HealthOverlayState | null | undefined,
): boolean {
  return (
    state !== null &&
    state !== undefined &&
    (HEALTH_OVERLAY_BLOCKING_STATES as readonly string[]).includes(state)
  );
}

export function healthOverlayTargetKey(
  targetKind: HealthOverlayRecord['targetKind'],
  targetId: string,
): string {
  return `${targetKind}:${targetId}`;
}

/** Isolation key used by recorded adapters / gateway PoC (workspace×deployment×credential). */
export function healthOverlayIsolationTargetId(input: {
  workspaceId: string;
  deploymentId: string;
  credentialVersion?: string;
}): string {
  return `${input.workspaceId}:${input.deploymentId}:${input.credentialVersion ?? 'platform'}`;
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Resolve stored record against wall clock: expired cooldown/circuit returns healthy.
 * Does not mutate revision; caller may persist the resolved record.
 */
export function resolveHealthOverlayRecord(
  record: HealthOverlayRecord,
  nowMs: number,
): HealthOverlayRecord {
  if (
    (record.state === 'cooldown' || record.state === 'circuit_open') &&
    record.endsAt &&
    Date.parse(record.endsAt) <= nowMs
  ) {
    return {
      targetKind: record.targetKind,
      targetId: record.targetId,
      state: 'healthy',
      reason: 'overlay_window_elapsed',
      source: record.source,
      startedAt: toIso(nowMs),
      ...(record.auditRef ? { auditRef: record.auditRef } : {}),
    };
  }
  return record;
}

export function applyHealthFailureFact(input: {
  previous: StoredHealthOverlay | null;
  fact: HealthFailureFact;
  nowMs: number;
  allowedFails?: number;
  cooldownTimeSeconds?: number;
  consecutive5xx?: number;
  baseEjectionTimeSeconds?: number;
}): StoredHealthOverlay {
  const allowedFails = input.allowedFails ?? LITELLM_ALLOWED_FAILS;
  const cooldownSeconds =
    input.cooldownTimeSeconds ?? LITELLM_COOLDOWN_TIME_SECONDS;
  const consecutive5xxLimit = input.consecutive5xx ?? ENVOY_CONSECUTIVE_5XX;
  const ejectionSeconds =
    input.baseEjectionTimeSeconds ?? ENVOY_BASE_EJECTION_TIME_SECONDS;
  const nowIso = input.fact.observedAt ?? toIso(input.nowMs);
  const base = input.previous
    ? {
        record: resolveHealthOverlayRecord(input.previous.record, input.nowMs),
        counters: { ...input.previous.counters },
      }
    : {
        record: {
          targetKind: input.fact.targetKind,
          targetId: input.fact.targetId,
          state: 'healthy' as const,
          reason: 'initial',
          source: input.fact.source,
          startedAt: nowIso,
        },
        counters: { consecutiveFails: 0, consecutive5xx: 0 },
      };

  const withAudit = (
    record: HealthOverlayRecord,
    counters: HealthOverlayCounters,
  ): StoredHealthOverlay => ({
    record: {
      ...record,
      ...(input.fact.auditRef ? { auditRef: input.fact.auditRef } : {}),
    },
    counters,
  });

  switch (input.fact.kind) {
    case 'success':
    case 'manual_clear':
      return withAudit(
        {
          targetKind: input.fact.targetKind,
          targetId: input.fact.targetId,
          state: 'healthy',
          reason: input.fact.reason,
          source: input.fact.source,
          startedAt: nowIso,
        },
        { consecutiveFails: 0, consecutive5xx: 0 },
      );
    case 'manual_degraded':
      return withAudit(
        {
          targetKind: input.fact.targetKind,
          targetId: input.fact.targetId,
          state: 'degraded',
          reason: input.fact.reason,
          source: input.fact.source,
          startedAt: nowIso,
        },
        base.counters,
      );
    case 'manual_unavailable':
    case 'probe_unavailable':
      return withAudit(
        {
          targetKind: input.fact.targetKind,
          targetId: input.fact.targetId,
          state: 'unavailable',
          reason: input.fact.reason,
          source: input.fact.source,
          startedAt: nowIso,
        },
        base.counters,
      );
    case 'rate_limited': {
      // LiteLLM treats 429 as immediate cooldown for cooldown_time.
      return withAudit(
        {
          targetKind: input.fact.targetKind,
          targetId: input.fact.targetId,
          state: 'cooldown',
          reason: input.fact.reason,
          source: input.fact.source,
          startedAt: nowIso,
          endsAt: toIso(input.nowMs + cooldownSeconds * 1000),
        },
        {
          consecutiveFails: base.counters.consecutiveFails + 1,
          consecutive5xx: 0,
        },
      );
    }
    case 'server_error':
    case 'connection_error': {
      const consecutive5xx = base.counters.consecutive5xx + 1;
      const consecutiveFails = base.counters.consecutiveFails + 1;
      if (consecutive5xx >= consecutive5xxLimit) {
        return withAudit(
          {
            targetKind: input.fact.targetKind,
            targetId: input.fact.targetId,
            state: 'circuit_open',
            reason: input.fact.reason,
            source: input.fact.source,
            startedAt: nowIso,
            endsAt: toIso(input.nowMs + ejectionSeconds * 1000),
          },
          { consecutiveFails, consecutive5xx: 0 },
        );
      }
      if (consecutiveFails >= allowedFails) {
        return withAudit(
          {
            targetKind: input.fact.targetKind,
            targetId: input.fact.targetId,
            state: 'cooldown',
            reason: input.fact.reason,
            source: input.fact.source,
            startedAt: nowIso,
            endsAt: toIso(input.nowMs + cooldownSeconds * 1000),
          },
          { consecutiveFails: 0, consecutive5xx },
        );
      }
      return withAudit(
        {
          targetKind: input.fact.targetKind,
          targetId: input.fact.targetId,
          state: 'degraded',
          reason: input.fact.reason,
          source: input.fact.source,
          startedAt: nowIso,
        },
        { consecutiveFails, consecutive5xx },
      );
    }
    case 'hard_failure':
    case 'accepted_failure':
    case 'acceptance_unknown': {
      // Gateway PoC / hard failures enter cooldown immediately (duration = C6).
      return withAudit(
        {
          targetKind: input.fact.targetKind,
          targetId: input.fact.targetId,
          state: 'cooldown',
          reason: input.fact.reason,
          source: input.fact.source,
          startedAt: nowIso,
          endsAt: toIso(input.nowMs + cooldownSeconds * 1000),
        },
        {
          consecutiveFails: base.counters.consecutiveFails + 1,
          consecutive5xx: base.counters.consecutive5xx,
        },
      );
    }
    default: {
      const _exhaustive: never = input.fact.kind;
      throw new Error(`Unknown health failure fact ${_exhaustive}`);
    }
  }
}

export class MemoryHealthOverlayPort implements HealthOverlayPort {
  private readonly store = new Map<string, StoredHealthOverlay>();

  constructor(private readonly clock: () => number = Date.now) {}

  async get(
    targetKind: HealthOverlayRecord['targetKind'],
    targetId: string,
  ): Promise<HealthOverlayRecord | null> {
    const stored = this.store.get(healthOverlayTargetKey(targetKind, targetId));
    if (!stored) return null;
    const resolved = resolveHealthOverlayRecord(stored.record, this.clock());
    if (resolved.state !== stored.record.state) {
      this.store.set(healthOverlayTargetKey(targetKind, targetId), {
        record: resolved,
        counters:
          resolved.state === 'healthy'
            ? { consecutiveFails: 0, consecutive5xx: 0 }
            : stored.counters,
      });
    }
    return structuredClone(resolved);
  }

  async list(filter?: {
    targetKind?: HealthOverlayRecord['targetKind'];
  }): Promise<HealthOverlayRecord[]> {
    const now = this.clock();
    const records: HealthOverlayRecord[] = [];
    for (const stored of this.store.values()) {
      if (filter?.targetKind && stored.record.targetKind !== filter.targetKind) {
        continue;
      }
      const resolved = resolveHealthOverlayRecord(stored.record, now);
      records.push(structuredClone(resolved));
    }
    return records;
  }

  async upsert(record: HealthOverlayRecord): Promise<void> {
    const key = healthOverlayTargetKey(record.targetKind, record.targetId);
    const previous = this.store.get(key);
    this.store.set(key, {
      record: structuredClone(record),
      counters: previous?.counters ?? { consecutiveFails: 0, consecutive5xx: 0 },
    });
  }

  async clear(
    targetKind: HealthOverlayRecord['targetKind'],
    targetId: string,
  ): Promise<void> {
    this.store.delete(healthOverlayTargetKey(targetKind, targetId));
  }

  /** Apply a failure/success fact through the state machine and persist. */
  async reportFact(fact: HealthFailureFact): Promise<HealthOverlayRecord> {
    const key = healthOverlayTargetKey(fact.targetKind, fact.targetId);
    const previous = this.store.get(key) ?? null;
    const next = applyHealthFailureFact({
      previous,
      fact,
      nowMs: this.clock(),
    });
    this.store.set(key, next);
    return structuredClone(next.record);
  }

  /** Test/helper: read counters without resolving. */
  peek(targetKind: HealthOverlayRecord['targetKind'], targetId: string) {
    return this.store.get(healthOverlayTargetKey(targetKind, targetId));
  }

  clearWorkspacePrefix(workspaceId: string) {
    const prefix = `${workspaceId}:`;
    for (const [key, stored] of this.store) {
      if (stored.record.targetId.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }
}

/** Process-shared overlay for recorded adapters — single map owner (G4). */
let sharedRecordedHealthOverlay: MemoryHealthOverlayPort | undefined;

export function getSharedRecordedHealthOverlay(
  clock?: () => number,
): MemoryHealthOverlayPort {
  if (!sharedRecordedHealthOverlay) {
    sharedRecordedHealthOverlay = new MemoryHealthOverlayPort(clock);
  }
  return sharedRecordedHealthOverlay;
}

/** Test-only reset of the shared recorded overlay. */
export function resetSharedRecordedHealthOverlay(
  clock?: () => number,
): MemoryHealthOverlayPort {
  sharedRecordedHealthOverlay = new MemoryHealthOverlayPort(clock ?? Date.now);
  return sharedRecordedHealthOverlay;
}
