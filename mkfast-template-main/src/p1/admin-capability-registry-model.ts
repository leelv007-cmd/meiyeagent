/**
 * Capability registry pure model (J1 / D-051 six questions).
 *
 * - Consumes CAPABILITY_INVENTORY + CapabilityRegistryEntry contracts.
 * - Deepens model-supply / job-queue / entitlements self-reports.
 * - Other domains remain manifest stubs (D-056 minimum fields).
 * - not_instrumented replaces only runtime facts (Q4), never the other five.
 * - Dependency table is static lookup only — no severity propagation.
 */
import {
  type CapabilityAvailabilityStatus,
  type CapabilityDependencyEdge,
  type CapabilityInstrumentStatus,
  type CapabilityInventoryDocument,
  type CapabilityInventoryItem,
  type CapabilityRegistryEntry,
  type OperationalMetricEnvelope,
} from '@meiye/contracts';
import { CAPABILITY_INVENTORY } from '@/p1/capability-inventory';

/** D-051 six-question keys in operator order. */
export const SIX_QUESTION_KEYS = [
  'purposeStatus',
  'configRevisionScope',
  'dependencies',
  'runtimeFacts',
  'recentEvidence',
  'safeActionsHandoff',
] as const;

export type SixQuestionKey = (typeof SIX_QUESTION_KEYS)[number];

/** Questions that must always be filled (not_instrumented may only replace Q4). */
export const REQUIRED_SIX_QUESTION_KEYS = [
  'purposeStatus',
  'configRevisionScope',
  'dependencies',
  'recentEvidence',
  'safeActionsHandoff',
] as const satisfies readonly SixQuestionKey[];

export type QuestionCompletenessStatus =
  | 'complete'
  | 'not_instrumented'
  | 'not_verified'
  | 'missing';

export interface QuestionCompleteness {
  status: QuestionCompletenessStatus;
  summary: string;
  reason?: string;
}

export interface CapabilitySixQuestionProjection {
  capabilityId: string;
  name: string;
  instrumentStatus: CapabilityInstrumentStatus;
  questions: Record<SixQuestionKey, QuestionCompleteness>;
  /** True when Q1–Q3, Q5, Q6 are complete (Q4 may be not_instrumented). */
  requiredComplete: boolean;
  /** True when every question is complete (including instrumented runtime facts). */
  fullyComplete: boolean;
}

export interface CapabilityRegistryView {
  inventory: CapabilityInventoryDocument;
  entries: CapabilityRegistryEntry[];
  dependencyEdges: CapabilityDependencyEdge[];
  projections: CapabilitySixQuestionProjection[];
}

/** Domains deepened in J1 (model supply / job queue / entitlements). */
export const DEEP_CAPABILITY_IDS = [
  'model_supply_routing_quality',
  'generation_copy',
  'generation_image',
  'generation_video',
  'job_queue_harness',
  'entitlements_billing_redemption',
] as const;

export type DeepCapabilityId = (typeof DEEP_CAPABILITY_IDS)[number];

export function isDeepCapabilityId(id: string): id is DeepCapabilityId {
  return (DEEP_CAPABILITY_IDS as readonly string[]).includes(id);
}

const GROUP_LABELS: Record<CapabilityInventoryItem['group'], string> = {
  account_and_commerce: '账号与商业化',
  ai_supply_and_generation: 'AI 供应与生成',
  task_orchestration: '任务编排',
  content_and_assets: '内容与资产',
  external_integrations: '外部集成',
  runtime_and_governance: '运行与治理',
};

export function capabilityGroupLabel(
  group: CapabilityInventoryItem['group']
): string {
  return GROUP_LABELS[group] ?? group;
}

export function inventoryStatusLabel(
  status: CapabilityInventoryItem['status']
): string {
  switch (status) {
    case 'instrumented':
      return '已插桩';
    case 'stub':
      return '存根';
    case 'not_instrumented':
      return '未插桩';
    case 'not_in_scope_for_supply_v1':
      return '供应 v1 范围外';
    default:
      return status;
  }
}

export function availabilityLabel(
  status: CapabilityAvailabilityStatus
): string {
  switch (status) {
    case 'available':
      return '可用';
    case 'degraded':
      return '降级';
    case 'blocked':
      return '阻塞';
    case 'attention':
      return '需关注';
    case 'not_verified':
      return '未核验';
    case 'not_instrumented':
      return '未插桩';
    case 'stale':
      return '证据过期';
    default:
      return status;
  }
}

/** Honest metric text — never invents zero / green when unknown. */
export function formatMetricEnvelope<T>(
  metric: OperationalMetricEnvelope<T> | undefined,
  format: (value: T) => string = String
): string {
  if (!metric) {
    return 'unknown (metric_absent)';
  }
  if (metric.status === 'known') {
    return format(metric.value);
  }
  return `unknown (${metric.reason})`;
}

export function isKnownMetric<T>(
  metric: OperationalMetricEnvelope<T> | undefined
): metric is Extract<OperationalMetricEnvelope<T>, { status: 'known' }> {
  return metric?.status === 'known';
}

/**
 * Build static capability↔dependency edges from inventory criticalDependencies.
 * relation is always `requires` for inventory-declared critical deps.
 */
export function buildCapabilityDependencyTable(
  inventory: CapabilityInventoryDocument = CAPABILITY_INVENTORY
): CapabilityDependencyEdge[] {
  const edges: CapabilityDependencyEdge[] = [];
  for (const item of inventory.items) {
    for (const dependsOnId of item.criticalDependencies) {
      edges.push({
        capabilityId: item.id,
        dependsOnId,
        relation: 'requires',
      });
    }
  }
  return edges;
}

/** Forward lookup: what does this capability depend on? */
export function lookupDependencies(
  capabilityId: string,
  edges: CapabilityDependencyEdge[]
): CapabilityDependencyEdge[] {
  return edges.filter((edge) => edge.capabilityId === capabilityId);
}

/** Reverse lookup: who depends on this capability? */
export function lookupDependents(
  dependsOnId: string,
  edges: CapabilityDependencyEdge[]
): CapabilityDependencyEdge[] {
  return edges.filter((edge) => edge.dependsOnId === dependsOnId);
}

function knownMetric<T>(
  value: T,
  scope?: string
): OperationalMetricEnvelope<T> {
  return scope ? { status: 'known', value, scope } : { status: 'known', value };
}

function unknownMetric(
  reason: string,
  scope?: string
): OperationalMetricEnvelope<number> {
  return scope
    ? { status: 'unknown', reason, scope }
    : { status: 'unknown', reason };
}

function baseEntry(
  item: CapabilityInventoryItem,
  capturedAt: string,
  partial: Omit<
    CapabilityRegistryEntry,
    'id' | 'group' | 'purpose' | 'owner' | 'dependencyRefs' | 'drilldownKey'
  > &
    Partial<
      Pick<
        CapabilityRegistryEntry,
        'id' | 'group' | 'purpose' | 'owner' | 'dependencyRefs' | 'drilldownKey'
      >
    >
): CapabilityRegistryEntry {
  return {
    id: item.id,
    group: item.group,
    purpose: item.purpose,
    owner: item.owner,
    dependencyRefs: [...item.criticalDependencies],
    drilldownKey: item.drilldownKey,
    evidenceFreshness: {
      capturedAt,
      source:
        partial.evidenceFreshness?.source ?? 'capability_registry_skeleton',
      ...partial.evidenceFreshness,
    },
    ...partial,
  };
}

/** Deep self-report for model supply + generation modalities. */
function deepModelSupplyEntry(
  item: CapabilityInventoryItem,
  capturedAt: string
): CapabilityRegistryEntry {
  const isRouting = item.id === 'model_supply_routing_quality';
  return baseEntry(item, capturedAt, {
    availability: 'not_verified',
    instrumentStatus: 'instrumented',
    config: {
      revisionId: isRouting
        ? 'catalog-head-awaiting-live-read'
        : `modality-${item.id}-inherits-catalog`,
      effectiveScope: 'global',
      publishedAt: capturedAt,
    },
    runtimeFacts: {
      // Honest: no live reporter wired on the web shell yet — never fake zeros.
      calls: unknownMetric(
        'domain_reporter_not_wired',
        isRouting ? 'model-supply' : item.id
      ),
      successRate: unknownMetric('domain_reporter_not_wired'),
      p95LatencyMs: unknownMetric('domain_reporter_not_wired'),
      costMicros: unknownMetric('provider_cost_reporter_not_wired'),
      note: 'Instrumented domain structure present; runtime facts await live model-supply reporter (no synthetic health).',
    },
    recentEvidenceRefs: [
      {
        kind: 'change',
        ref: 's2a-capability-inventory',
        at: capturedAt,
      },
      {
        kind: 'audit',
        ref: 'model-supply.catalog_head',
        at: capturedAt,
      },
    ],
    allowedSafeActions: [
      'view_supply_center',
      'open_route_simulator',
      'open_technical_handoff',
    ],
    technicalHandoff: {
      correlationHints: ['model-supply', item.id, item.drilldownKey],
      redactedContext: {
        inventoryStatus: item.status,
        owner: item.owner,
      },
      deepLink: item.drilldownKey,
    },
    affectedScope: isRouting
      ? ['copy', 'image', 'video']
      : [item.id.replace('generation_', '')],
    evidenceFreshness: {
      capturedAt,
      source: 'model_supply_self_report_skeleton',
      staleAfterMs: 15 * 60 * 1000,
    },
  });
}

/** Deep self-report for harness job queue. */
function deepJobQueueEntry(
  item: CapabilityInventoryItem,
  capturedAt: string
): CapabilityRegistryEntry {
  return baseEntry(item, capturedAt, {
    availability: 'not_verified',
    instrumentStatus: 'instrumented',
    config: {
      revisionId: 'job-runtime-harness-head',
      effectiveScope: 'platform',
      publishedAt: capturedAt,
    },
    runtimeFacts: {
      calls: unknownMetric(
        'operational_metrics_collector_not_projected',
        'job-runtime'
      ),
      successRate: unknownMetric('operational_metrics_collector_not_projected'),
      p95LatencyMs: unknownMetric(
        'operational_metrics_collector_not_projected',
        'queue.averageClaimLatencyMs'
      ),
      note: 'Queue domain is instrumented via OperationalMetricEnvelope; live projection joins admin audit health (no zero fill-in).',
    },
    recentEvidenceRefs: [
      {
        kind: 'audit',
        ref: 'job-runtime.operational-metrics',
        at: capturedAt,
      },
    ],
    allowedSafeActions: [
      'view_queue_health',
      'open_task_recover_if_authorized',
      'open_technical_handoff',
    ],
    technicalHandoff: {
      correlationHints: [
        'job-runtime',
        'operational-metrics',
        item.drilldownKey,
      ],
      redactedContext: {
        inventoryStatus: item.status,
        owner: item.owner,
      },
      deepLink: item.drilldownKey,
    },
    evidenceFreshness: {
      capturedAt,
      source: 'job_queue_self_report_skeleton',
      staleAfterMs: 5 * 60 * 1000,
    },
  });
}

/** Deep self-report for entitlements / billing / redemption. */
function deepEntitlementsEntry(
  item: CapabilityInventoryItem,
  capturedAt: string
): CapabilityRegistryEntry {
  return baseEntry(item, capturedAt, {
    availability: 'not_verified',
    instrumentStatus: 'instrumented',
    config: {
      revisionId: 'entitlement-policy-head-awaiting-live-read',
      effectiveScope: 'plan_defaults',
      publishedAt: capturedAt,
    },
    runtimeFacts: {
      entitlementHeadroom: unknownMetric(
        'entitlement_headroom_reporter_not_wired',
        'product-entitlement'
      ),
      calls: unknownMetric('usage_ledger_reporter_not_wired'),
      costMicros: unknownMetric('product_usage_cost_not_projected'),
      note: 'Entitlements domain structure present; headroom/usage await live entitlement-pools reporter (no synthetic allowance zeros).',
    },
    recentEvidenceRefs: [
      {
        kind: 'change',
        ref: 'h1-entitlement-policy-account-allocation',
        at: capturedAt,
      },
      {
        kind: 'audit',
        ref: 'admin.plans',
        at: capturedAt,
      },
    ],
    allowedSafeActions: [
      'view_plan_catalog',
      'view_redemptions',
      'open_technical_handoff',
    ],
    technicalHandoff: {
      correlationHints: [
        'entitlements',
        'entitlement-policy',
        item.drilldownKey,
      ],
      redactedContext: {
        inventoryStatus: item.status,
        owner: item.owner,
      },
      deepLink: item.drilldownKey,
    },
    evidenceFreshness: {
      capturedAt,
      source: 'entitlements_self_report_skeleton',
      staleAfterMs: 15 * 60 * 1000,
    },
  });
}

/**
 * Manifest stub: D-056 minimum fields.
 * not_instrumented replaces only runtime facts; other five questions stay present.
 */
function stubEntry(
  item: CapabilityInventoryItem,
  capturedAt: string
): CapabilityRegistryEntry {
  const instrumentStatus: CapabilityInstrumentStatus =
    item.status === 'not_in_scope_for_supply_v1'
      ? 'not_in_scope_for_supply_v1'
      : item.status === 'not_instrumented'
        ? 'not_instrumented'
        : 'stub';

  const availability: CapabilityAvailabilityStatus =
    instrumentStatus === 'not_in_scope_for_supply_v1' ||
    instrumentStatus === 'not_instrumented'
      ? 'not_instrumented'
      : 'not_verified';

  return baseEntry(item, capturedAt, {
    availability,
    instrumentStatus,
    config: {
      revisionId: `manifest-stub:${item.id}`,
      effectiveScope: 'manifest',
      publishedAt: capturedAt,
    },
    // Q4 only — not_instrumented substitutes runtime facts, not other questions.
    runtimeFacts: {
      note:
        item.notes ??
        'not_instrumented: runtime facts absent until domain self-report lands',
      calls: unknownMetric('not_instrumented'),
      successRate: unknownMetric('not_instrumented'),
      p95LatencyMs: unknownMetric('not_instrumented'),
    },
    recentEvidenceRefs: [
      {
        kind: 'audit',
        ref: `manifest:${CAPABILITY_INVENTORY.revision}`,
        at: capturedAt,
      },
    ],
    allowedSafeActions: ['view_drilldown', 'open_technical_handoff'],
    technicalHandoff: {
      correlationHints: ['manifest-stub', item.id, item.drilldownKey],
      redactedContext: {
        inventoryStatus: item.status,
        owner: item.owner,
        gap: 'domain_self_report_pending',
      },
      deepLink: item.drilldownKey,
    },
    evidenceFreshness: {
      capturedAt,
      source: 'capability_inventory_manifest_stub',
    },
  });
}

export function buildRegistryEntry(
  item: CapabilityInventoryItem,
  capturedAt: string = CAPABILITY_INVENTORY.capturedAt
): CapabilityRegistryEntry {
  if (
    item.id === 'model_supply_routing_quality' ||
    item.id === 'generation_copy' ||
    item.id === 'generation_image' ||
    item.id === 'generation_video'
  ) {
    return deepModelSupplyEntry(item, capturedAt);
  }
  if (item.id === 'job_queue_harness') {
    return deepJobQueueEntry(item, capturedAt);
  }
  if (item.id === 'entitlements_billing_redemption') {
    return deepEntitlementsEntry(item, capturedAt);
  }
  return stubEntry(item, capturedAt);
}

function nonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function projectPurposeStatus(
  entry: CapabilityRegistryEntry
): QuestionCompleteness {
  if (!nonEmpty(entry.purpose)) {
    return {
      status: 'missing',
      summary: '用途缺失',
      reason: 'purpose_absent',
    };
  }
  if (entry.availability === 'not_instrumented') {
    return {
      status: 'complete',
      summary: `${entry.purpose} · 状态=未插桩`,
    };
  }
  if (entry.availability === 'not_verified') {
    return {
      status: 'complete',
      summary: `${entry.purpose} · 状态=未核验`,
    };
  }
  return {
    status: 'complete',
    summary: `${entry.purpose} · 状态=${availabilityLabel(entry.availability)}`,
  };
}

function projectConfig(entry: CapabilityRegistryEntry): QuestionCompleteness {
  const revision = entry.config?.revisionId;
  const scope = entry.config?.effectiveScope;
  if (!nonEmpty(revision) && !nonEmpty(scope)) {
    return {
      status: 'missing',
      summary: '配置 revision / 生效范围缺失',
      reason: 'config_absent',
    };
  }
  return {
    status: 'complete',
    summary: [
      revision ? `revision=${revision}` : null,
      scope ? `scope=${scope}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
  };
}

function projectDependencies(
  entry: CapabilityRegistryEntry
): QuestionCompleteness {
  // Empty dependency list is valid (e.g. config_secrets root).
  if (!Array.isArray(entry.dependencyRefs)) {
    return {
      status: 'missing',
      summary: '依赖引用缺失',
      reason: 'dependency_refs_absent',
    };
  }
  return {
    status: 'complete',
    summary:
      entry.dependencyRefs.length === 0
        ? '无关键依赖'
        : `依赖 ${entry.dependencyRefs.length} 项：${entry.dependencyRefs.join(', ')}`,
  };
}

function projectRuntimeFacts(
  entry: CapabilityRegistryEntry
): QuestionCompleteness {
  const facts = entry.runtimeFacts;
  const instrument = entry.instrumentStatus;

  if (
    instrument === 'not_instrumented' ||
    instrument === 'stub' ||
    instrument === 'not_in_scope_for_supply_v1'
  ) {
    return {
      status: 'not_instrumented',
      summary: facts?.note ?? '运行事实未插桩',
      reason: instrument,
    };
  }

  if (!facts) {
    return {
      status: 'missing',
      summary: '运行事实摘要缺失',
      reason: 'runtime_facts_absent',
    };
  }

  const metricParts = [
    facts.calls ? `calls=${formatMetricEnvelope(facts.calls)}` : null,
    facts.successRate
      ? `successRate=${formatMetricEnvelope(facts.successRate, (v) =>
          typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : String(v)
        )}`
      : null,
    facts.p95LatencyMs
      ? `p95=${formatMetricEnvelope(facts.p95LatencyMs, (v) => `${v}ms`)}`
      : null,
    facts.entitlementHeadroom
      ? `headroom=${formatMetricEnvelope(facts.entitlementHeadroom)}`
      : null,
    facts.costMicros ? `cost=${formatMetricEnvelope(facts.costMicros)}` : null,
  ].filter(Boolean);

  // Instrumented domains may still report all-unknown — that is complete honesty,
  // not a missing field, as long as the envelope structure is present.
  if (metricParts.length === 0 && !nonEmpty(facts.note)) {
    return {
      status: 'missing',
      summary: '运行事实摘要为空',
      reason: 'runtime_facts_empty',
    };
  }

  return {
    status: 'complete',
    summary: [...metricParts, facts.note].filter(Boolean).join(' · '),
  };
}

function projectRecentEvidence(
  entry: CapabilityRegistryEntry
): QuestionCompleteness {
  const refs = entry.recentEvidenceRefs;
  if (!refs || refs.length === 0) {
    return {
      status: 'missing',
      summary: '最近变更/审计引用缺失',
      reason: 'recent_evidence_absent',
    };
  }
  return {
    status: 'complete',
    summary: refs.map((ref) => `${ref.kind}:${ref.ref}`).join(', '),
  };
}

function projectSafeActionsHandoff(
  entry: CapabilityRegistryEntry
): QuestionCompleteness {
  const actions = entry.allowedSafeActions;
  const handoff = entry.technicalHandoff;
  if ((!actions || actions.length === 0) && !handoff) {
    return {
      status: 'missing',
      summary: '安全操作/移交 envelope 缺失',
      reason: 'safe_actions_handoff_absent',
    };
  }
  const parts = [
    actions && actions.length > 0 ? `actions=${actions.join('|')}` : null,
    handoff?.deepLink ? `handoff=${handoff.deepLink}` : null,
  ].filter(Boolean);
  return {
    status: 'complete',
    summary: parts.join(' · ') || 'handoff envelope present',
  };
}

export function projectSixQuestionCompleteness(
  entry: CapabilityRegistryEntry,
  name: string
): CapabilitySixQuestionProjection {
  const questions: Record<SixQuestionKey, QuestionCompleteness> = {
    purposeStatus: projectPurposeStatus(entry),
    configRevisionScope: projectConfig(entry),
    dependencies: projectDependencies(entry),
    runtimeFacts: projectRuntimeFacts(entry),
    recentEvidence: projectRecentEvidence(entry),
    safeActionsHandoff: projectSafeActionsHandoff(entry),
  };

  const requiredComplete = REQUIRED_SIX_QUESTION_KEYS.every(
    (key) => questions[key].status === 'complete'
  );
  const fullyComplete = SIX_QUESTION_KEYS.every(
    (key) => questions[key].status === 'complete'
  );

  return {
    capabilityId: entry.id,
    name,
    instrumentStatus: entry.instrumentStatus,
    questions,
    requiredComplete,
    fullyComplete,
  };
}

export function findInventoryItem(
  capabilityId: string,
  inventory: CapabilityInventoryDocument = CAPABILITY_INVENTORY
): CapabilityInventoryItem | undefined {
  return inventory.items.find((item) => item.id === capabilityId);
}

export function buildCapabilityRegistry(
  inventory: CapabilityInventoryDocument = CAPABILITY_INVENTORY
): CapabilityRegistryView {
  const dependencyEdges = buildCapabilityDependencyTable(inventory);
  const entries = inventory.items.map((item) =>
    buildRegistryEntry(item, inventory.capturedAt)
  );
  const projections = entries.map((entry) => {
    const item = findInventoryItem(entry.id, inventory);
    return projectSixQuestionCompleteness(entry, item?.name ?? entry.id);
  });
  return {
    inventory,
    entries,
    dependencyEdges,
    projections,
  };
}

export function getRegistryEntry(
  view: CapabilityRegistryView,
  capabilityId: string
): CapabilityRegistryEntry | undefined {
  return view.entries.find((entry) => entry.id === capabilityId);
}

export function getProjection(
  view: CapabilityRegistryView,
  capabilityId: string
): CapabilitySixQuestionProjection | undefined {
  return view.projections.find(
    (projection) => projection.capabilityId === capabilityId
  );
}

/** Group inventory items for panorama rendering. */
export function groupInventoryByDomain(
  inventory: CapabilityInventoryDocument = CAPABILITY_INVENTORY
): Array<{
  group: CapabilityInventoryItem['group'];
  label: string;
  items: CapabilityInventoryItem[];
}> {
  const order: CapabilityInventoryItem['group'][] = [
    'account_and_commerce',
    'ai_supply_and_generation',
    'task_orchestration',
    'content_and_assets',
    'external_integrations',
    'runtime_and_governance',
  ];
  return order
    .map((group) => ({
      group,
      label: capabilityGroupLabel(group),
      items: inventory.items.filter((item) => item.group === group),
    }))
    .filter((section) => section.items.length > 0);
}

/**
 * Assert that a known metric is not being used to fake health via zero defaults
 * when the underlying evidence is missing. Used by tests and future reporters.
 */
export function assertNoSyntheticZeroHealth(
  entry: CapabilityRegistryEntry
): string[] {
  const violations: string[] = [];
  const facts = entry.runtimeFacts;
  if (!facts) return violations;

  for (const [key, metric] of Object.entries(facts)) {
    if (key === 'note' || !metric || typeof metric !== 'object') continue;
    const envelope = metric as OperationalMetricEnvelope<unknown>;
    if (envelope.status === 'known' && envelope.value === 0) {
      // Zero is allowed only when explicitly known; flag if scope claims "default".
      if (envelope.scope === 'synthetic_default') {
        violations.push(`${entry.id}.${key}: synthetic zero health`);
      }
    }
  }
  return violations;
}

// Re-export knownMetric helper for tests constructing overlays.
export { knownMetric, unknownMetric };
