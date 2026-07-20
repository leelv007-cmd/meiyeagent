/**
 * Capability registry contracts (D-051 six questions + D-056 minimum fields).
 *
 * Naming disambiguation (Implementation 2):
 * - CapabilityRegistryEntry = ops capability status on the admin command surface
 * - productCapabilities / ProductCapability = authorization keys (capability-permission)
 * - CapabilityRevision (model-supply catalog) = model operation-level supply revisions
 * These three concepts must never share type names.
 */

/** Honest known|unknown envelope elevated from job-runtime OperationalMetric. */
export type OperationalMetricReasonCode = string;

export type OperationalMetricEnvelope<T, Reason extends string = OperationalMetricReasonCode> =
  | {
      status: 'known';
      value: T;
      scope?: string;
    }
  | {
      status: 'unknown';
      reason: Reason;
      scope?: string;
    };

export type CapabilityInstrumentStatus =
  | 'instrumented'
  | 'stub'
  | 'not_instrumented'
  | 'not_verified'
  | 'not_in_scope_for_supply_v1';

export type CapabilityAvailabilityStatus =
  | 'available'
  | 'degraded'
  | 'blocked'
  | 'attention'
  | 'not_verified'
  | 'not_instrumented'
  | 'stale';

export type CapabilityDomainGroup =
  | 'account_and_commerce'
  | 'ai_supply_and_generation'
  | 'task_orchestration'
  | 'content_and_assets'
  | 'external_integrations'
  | 'runtime_and_governance';

/** D-051 six-question capability contract. */
export interface CapabilityRegistryEntry {
  /** Stable capability id (e.g. `model_supply.routing`). */
  id: string;
  /** Primary IA group (D-051 / D-054 two-level catalog). */
  group: CapabilityDomainGroup;
  /** ① Purpose — operator language, not infra jargon. */
  purpose: string;
  /** Owning module / team label for handoff. */
  owner: string;
  /** ① Availability status (honest; no fake green). */
  availability: CapabilityAvailabilityStatus;
  instrumentStatus: CapabilityInstrumentStatus;
  /** ② Current config revision + effective scope. */
  config?: {
    revisionId?: string;
    effectiveScope?: string;
    publishedAt?: string;
  };
  /** ③ Dependency refs (static lookup table join keys only — no propagation engine). */
  dependencyRefs: string[];
  /** ④ Runtime facts summary (may be not_instrumented). */
  runtimeFacts?: {
    calls?: OperationalMetricEnvelope<number>;
    successRate?: OperationalMetricEnvelope<number>;
    p95LatencyMs?: OperationalMetricEnvelope<number>;
    entitlementHeadroom?: OperationalMetricEnvelope<number>;
    costMicros?: OperationalMetricEnvelope<number>;
    note?: string;
  };
  /** Evidence freshness for status claims. */
  evidenceFreshness?: {
    capturedAt?: string;
    staleAfterMs?: number;
    source?: string;
  };
  /** Affected scope (workspaces/ops/modalities) when degraded. */
  affectedScope?: string[];
  /** ⑤ Recent change / alert / audit evidence refs. */
  recentEvidenceRefs?: Array<{
    kind: 'change' | 'alert' | 'audit';
    ref: string;
    at?: string;
  }>;
  /** ⑥ Safe actions allowed on this capability (D-048 boundary). */
  allowedSafeActions?: string[];
  /** Technical handoff envelope (redacted context). */
  technicalHandoff?: {
    correlationHints?: string[];
    redactedContext?: Record<string, string>;
    deepLink?: string;
  };
  /** Drill-down route key (admin path token, not full URL). */
  drilldownKey: string;
}

/** Static capability↔dependency lookup row (no severity propagation). */
export interface CapabilityDependencyEdge {
  capabilityId: string;
  dependsOnId: string;
  relation: 'requires' | 'observes' | 'configured_by';
}

export type CapabilityInventoryItemStatus =
  | 'instrumented'
  | 'stub'
  | 'not_instrumented'
  | 'not_in_scope_for_supply_v1';

/**
 * Versioned capability inventory row (D-051 decision ③ list).
 * Audio remains not_instrumented / not_in_scope_for_supply_v1 stub — must not disappear.
 */
export interface CapabilityInventoryItem {
  id: string;
  name: string;
  purpose: string;
  group: CapabilityDomainGroup;
  status: CapabilityInventoryItemStatus;
  owner: string;
  drilldownKey: string;
  /** Critical dependency ids for join; stubs still declare these. */
  criticalDependencies: string[];
  notes?: string;
}

export interface CapabilityInventoryDocument {
  revision: string;
  capturedAt: string;
  items: CapabilityInventoryItem[];
}

/** Health overlay five states (D-080 C6 / D-059). Owned by supply control plane. */
export type HealthOverlayState =
  | 'healthy'
  | 'degraded'
  | 'cooldown'
  | 'circuit_open'
  | 'unavailable';

export interface HealthOverlayRecord {
  targetKind: 'deployment' | 'execution_channel' | 'credential_account' | 'provider_profile';
  targetId: string;
  state: HealthOverlayState;
  reason: string;
  source: string;
  startedAt: string;
  endsAt?: string;
  auditRef?: string;
}

/**
 * Port for reading/writing short-lived health overlay (does not mutate RoutePolicy revision).
 * Persistence + migration of process-local cooldown maps = WT-G (G4).
 */
export interface HealthOverlayPort {
  get(targetKind: HealthOverlayRecord['targetKind'], targetId: string): Promise<HealthOverlayRecord | null>;
  list(filter?: { targetKind?: HealthOverlayRecord['targetKind'] }): Promise<HealthOverlayRecord[]>;
  upsert(record: HealthOverlayRecord): Promise<void>;
  clear(targetKind: HealthOverlayRecord['targetKind'], targetId: string): Promise<void>;
}
