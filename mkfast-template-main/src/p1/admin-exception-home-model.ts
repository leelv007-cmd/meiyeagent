/**
 * Admin exception-first home projection (J2 / D-055 · D-080 C1).
 *
 * Read-only: no owner / ack / assign workflow, no incident entity.
 * Event sources = ActionableInboxItem (#94 consume-only) + capability
 * OperationalMetric / availability self-reports (J1 registry).
 * Does not re-implement pending-actions service.
 */
import type {
  ActionableInboxItem,
  ActionableInboxStatusKind,
  CapabilityAvailabilityStatus,
} from '@meiye/contracts';

import {
  ADMIN_DRILLDOWN_PAGES,
  buildRedactedHandoffContext,
  type CapabilityCatalogL1Id,
} from '@/p1/admin-capability-catalog-model';
import {
  availabilityLabel,
  buildCapabilityRegistry,
  findInventoryItem,
  type CapabilityRegistryView,
} from '@/p1/admin-capability-registry-model';

/** Exception severities shown on the home list (D-055). */
export const EXCEPTION_SEVERITIES = [
  'blocked',
  'degraded',
  'attention',
  'not_verified',
  'stale',
] as const;

export type ExceptionSeverity = (typeof EXCEPTION_SEVERITIES)[number];

/** Severity rank: lower = more urgent. */
export const EXCEPTION_SEVERITY_RANK: Record<ExceptionSeverity, number> = {
  blocked: 0,
  degraded: 1,
  attention: 2,
  not_verified: 3,
  stale: 4,
};

/** Inbox status kinds that surface as admin exceptions (not success noise). */
export const EXCEPTION_INBOX_STATUS_KINDS = [
  'task_failed',
  'acceptance_unknown_recovery',
  'delivery_partial_or_unknown',
  'needs_choice_or_confirm',
] as const satisfies readonly ActionableInboxStatusKind[];

export type ExceptionInboxStatusKind =
  (typeof EXCEPTION_INBOX_STATUS_KINDS)[number];

const INBOX_SEVERITY: Record<ExceptionInboxStatusKind, ExceptionSeverity> = {
  task_failed: 'blocked',
  acceptance_unknown_recovery: 'attention',
  delivery_partial_or_unknown: 'degraded',
  needs_choice_or_confirm: 'attention',
};

/** Default long-stale window when evidence omits staleAfterMs (30 min). */
export const DEFAULT_STALE_AFTER_MS = 30 * 60 * 1000;

/** Multiplier over staleAfterMs that elevates "long stale" exceptions. */
export const LONG_STALE_MULTIPLIER = 1;

/** Capability catalog entry path (hardcoded until Z2-WIRING batch B). */
export const CAPABILITY_CATALOG_PATH = '/admin/capabilities';

/** Keys / value patterns stripped from technical handoff context. */
const REDACT_KEY_PATTERN =
  /^(.*[_-]?)?(secret|token|password|passwd|api[_-]?key|authorization|cookie|credential|private[_-]?key|access[_-]?key|session)([_-].*)?$/i;
const REDACT_VALUE_PATTERN =
  /(?:sk-|pk-|Bearer\s+|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|postgres(?:ql)?:\/\/\S+|AKIA[0-9A-Z]{16})/i;

export type ExceptionFreshness = 'fresh' | 'stale' | 'unknown';

export type ExceptionEventOrigin =
  | 'actionable_inbox'
  | 'capability_metric';

export interface RedactedTechnicalHandoffLink {
  /** Relative admin drilldown or catalog path (never raw secret). */
  href: string;
  label: string;
  oneClickRepair: false;
  correlationHints: string[];
  redactedContext: Record<string, string>;
}

export interface ExceptionHomeRow {
  /** Stable root-cause key (dedupe id). */
  rootCauseKey: string;
  severity: ExceptionSeverity;
  title: string;
  /** Primary / representative capability when known. */
  primaryCapabilityId?: string;
  /** All capabilities collapsed under this root cause. */
  affectedCapabilityIds: string[];
  affectedScope: string[];
  startedAt: string;
  lastChangedAt: string;
  evidenceSource: string;
  evidenceCapturedAt: string;
  freshness: ExceptionFreshness;
  recentChangeSummary: string;
  /** Operator next action copy when a safe action exists. */
  nextActionLabel?: string;
  technicalHandoff: RedactedTechnicalHandoffLink;
  origin: ExceptionEventOrigin;
  /** Sort helpers (precomputed). */
  scopeWeight: number;
  durationMs: number;
  recencyMs: number;
}

export interface PanoramaStatCard {
  id: string;
  label: string;
  value: string;
  hint: string;
}

export interface ExceptionHomeView {
  projectedAt: string;
  exceptions: ExceptionHomeRow[];
  empty: boolean;
  /** Empty-state panorama (3~5 design hypothesis — not a fixed acceptance count). */
  panoramaStats: PanoramaStatCard[];
  catalogEntry: {
    path: string;
    label: string;
    description: string;
  };
  /** Explicit C1 contract flags for tests / UI guards. */
  readOnly: true;
  supportsAck: false;
  supportsAssign: false;
  supportsOwnerWorkflow: false;
}

export interface BuildExceptionHomeInput {
  /** #94 ActionableInboxItem projection (consume only). */
  inboxItems?: readonly ActionableInboxItem[];
  /** Capability registry view (defaults to J1 skeleton). */
  registry?: CapabilityRegistryView;
  /** Clock for freshness / duration (ISO or epoch ms). */
  now?: string | number;
}

interface ExceptionCandidate {
  rootCauseKey: string;
  severity: ExceptionSeverity;
  title: string;
  capabilityId?: string;
  affectedScope: string[];
  startedAt: string;
  lastChangedAt: string;
  evidenceSource: string;
  evidenceCapturedAt: string;
  freshness: ExceptionFreshness;
  recentChangeSummary: string;
  nextActionLabel?: string;
  origin: ExceptionEventOrigin;
  drilldownKey?: string;
  group?: CapabilityCatalogL1Id;
  correlationHints: string[];
  rawContext: Record<string, string>;
}

function isExceptionInboxKind(
  kind: ActionableInboxStatusKind
): kind is ExceptionInboxStatusKind {
  return (EXCEPTION_INBOX_STATUS_KINDS as readonly string[]).includes(kind);
}

function isExceptionAvailability(
  status: CapabilityAvailabilityStatus
): status is ExceptionSeverity {
  return (EXCEPTION_SEVERITIES as readonly string[]).includes(status);
}

function toEpoch(value: string | number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Project evidence freshness from capturedAt + staleAfterMs.
 * Long stale = age >= staleAfterMs (or DEFAULT_STALE_AFTER_MS).
 */
export function projectEvidenceFreshness(input: {
  capturedAt?: string;
  staleAfterMs?: number;
  nowMs: number;
}): {
  freshness: ExceptionFreshness;
  ageMs: number | null;
  isLongStale: boolean;
  staleAfterMs: number;
} {
  const staleAfterMs =
    typeof input.staleAfterMs === 'number' && input.staleAfterMs > 0
      ? input.staleAfterMs
      : DEFAULT_STALE_AFTER_MS;

  if (!input.capturedAt) {
    return {
      freshness: 'unknown',
      ageMs: null,
      isLongStale: false,
      staleAfterMs,
    };
  }

  const capturedMs = Date.parse(input.capturedAt);
  if (!Number.isFinite(capturedMs)) {
    return {
      freshness: 'unknown',
      ageMs: null,
      isLongStale: false,
      staleAfterMs,
    };
  }

  const ageMs = Math.max(0, input.nowMs - capturedMs);
  const isLongStale = ageMs >= staleAfterMs * LONG_STALE_MULTIPLIER;
  return {
    freshness: isLongStale ? 'stale' : 'fresh',
    ageMs,
    isLongStale,
    staleAfterMs,
  };
}

/** Redact sensitive keys/values from handoff context (D-048). */
export function redactHandoffContext(
  context: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(context)) {
    if (REDACT_KEY_PATTERN.test(key)) {
      out[key] = '[redacted]';
      continue;
    }
    if (typeof value === 'string' && REDACT_VALUE_PATTERN.test(value)) {
      out[key] = '[redacted]';
      continue;
    }
    // Never pass through multi-line blobs that look like env dumps / SQL.
    if (
      typeof value === 'string' &&
      (/\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(value) ||
        /^[A-Z][A-Z0-9_]+=/m.test(value))
    ) {
      out[key] = '[redacted]';
      continue;
    }
    out[key] = value;
  }
  return out;
}

function drilldownPathForKey(drilldownKey: string | undefined): string {
  if (!drilldownKey) return CAPABILITY_CATALOG_PATH;
  if (drilldownKey.includes('supply') || drilldownKey.includes('model')) {
    return '/admin/supply';
  }
  const page = ADMIN_DRILLDOWN_PAGES.find(
    (item) =>
      drilldownKey === `admin.${item.pageId}` ||
      drilldownKey.startsWith(`admin.${item.pageId}`) ||
      item.capabilityIds.some((id) => drilldownKey.includes(id))
  );
  if (page) return page.path;

  // Map common registry drilldown keys to existing admin pages.
  if (drilldownKey.includes('job') || drilldownKey.includes('audit')) {
    return '/admin/audit';
  }
  if (drilldownKey.includes('entitlement') || drilldownKey.includes('plan')) {
    return '/admin/plans';
  }
  if (drilldownKey.includes('integration') || drilldownKey.includes('channel')) {
    return '/admin/integrations';
  }
  if (drilldownKey.includes('content') || drilldownKey.includes('template')) {
    return '/admin/templates';
  }
  if (drilldownKey.includes('account') || drilldownKey.includes('user')) {
    return '/admin/users';
  }
  return CAPABILITY_CATALOG_PATH;
}

function groupForCapability(
  capabilityId: string | undefined,
  registry: CapabilityRegistryView
): CapabilityCatalogL1Id {
  if (!capabilityId) return 'runtime_and_governance';
  const item = findInventoryItem(capabilityId, registry.inventory);
  return (item?.group ?? 'runtime_and_governance') as CapabilityCatalogL1Id;
}

function buildHandoffLink(input: {
  group: CapabilityCatalogL1Id;
  capabilityId?: string;
  drilldownKey?: string;
  correlationHints: string[];
  rawContext: Record<string, string>;
  severity: ExceptionSeverity;
}): RedactedTechnicalHandoffLink {
  const page = ADMIN_DRILLDOWN_PAGES.find((item) => item.domain === input.group);
  const href = drilldownPathForKey(input.drilldownKey);
  const base = buildRedactedHandoffContext({
    domain: input.group,
    capabilityId: input.capabilityId,
    pageId: page?.pageId,
    correlationHints: input.correlationHints,
    extra: {
      severity: input.severity,
      ...input.rawContext,
    },
  });

  return {
    href,
    label: '技术台移交（脱敏）',
    oneClickRepair: false,
    correlationHints: base.correlationHints,
    redactedContext: redactHandoffContext(base.redactedContext),
  };
}

function inboxRootCauseKey(item: ActionableInboxItem): string {
  const source = item.eventSource;
  if (source.kind === 'task_terminal') {
    return `inbox:task:${source.taskId}:${item.statusKind}`;
  }
  if (source.kind === 'delivery_event') {
    return `inbox:delivery:${source.packageId}:${source.eventType}`;
  }
  return `inbox:pending:${source.taskId}:${source.pendingActionKind}`;
}

function inboxCapabilityHint(item: ActionableInboxItem): string | undefined {
  if (item.statusKind === 'delivery_partial_or_unknown') {
    return 'content_package_canvas';
  }
  if (
    item.statusKind === 'task_failed' ||
    item.statusKind === 'acceptance_unknown_recovery'
  ) {
    return 'job_queue_harness';
  }
  if (item.statusKind === 'needs_choice_or_confirm') {
    return 'job_queue_harness';
  }
  return undefined;
}

/** Map ActionableInboxItem → exception candidates (skip non-exception kinds). */
export function projectInboxExceptionCandidates(
  items: readonly ActionableInboxItem[],
  nowMs: number
): ExceptionCandidate[] {
  const candidates: ExceptionCandidate[] = [];

  for (const item of items) {
    if (!isExceptionInboxKind(item.statusKind)) continue;

    const severity = INBOX_SEVERITY[item.statusKind];
    const createdMs = toEpoch(item.createdAt, nowMs);
    const capabilityId = inboxCapabilityHint(item);
    const evidenceSource = `actionable_inbox:${item.eventSource.kind}`;

    candidates.push({
      rootCauseKey: inboxRootCauseKey(item),
      severity,
      title: item.title,
      capabilityId,
      affectedScope: item.workspaceId ? [`workspace:${item.workspaceId}`] : [],
      startedAt: toIso(createdMs),
      lastChangedAt: toIso(createdMs),
      evidenceSource,
      evidenceCapturedAt: toIso(createdMs),
      freshness: 'fresh',
      recentChangeSummary: `inbox ${item.statusKind} · ${item.nextActionLabel}`,
      nextActionLabel: item.nextActionLabel,
      origin: 'actionable_inbox',
      drilldownKey:
        capabilityId === 'content_package_canvas'
          ? 'admin.content'
          : 'admin.jobs',
      group:
        capabilityId === 'content_package_canvas'
          ? 'content_and_assets'
          : 'task_orchestration',
      correlationHints: [
        'actionable_inbox',
        item.statusKind,
        item.eventSource.kind,
      ],
      rawContext: {
        statusKind: item.statusKind,
        nextActionLabel: item.nextActionLabel,
        eventSourceKind: item.eventSource.kind,
        // Intentionally omit workspace secrets / tokens even if present upstream.
      },
    });
  }

  return candidates;
}

/**
 * Map capability registry OperationalMetric / availability self-reports
 * into exception candidates (blocked/degraded/attention/not_verified/long stale).
 */
export function projectCapabilityExceptionCandidates(
  registry: CapabilityRegistryView,
  nowMs: number
): ExceptionCandidate[] {
  const candidates: ExceptionCandidate[] = [];

  for (const entry of registry.entries) {
    const freshnessInfo = projectEvidenceFreshness({
      capturedAt: entry.evidenceFreshness?.capturedAt,
      staleAfterMs: entry.evidenceFreshness?.staleAfterMs,
      nowMs,
    });

    const availability = entry.availability;
    let severity: ExceptionSeverity | null = null;

    if (isExceptionAvailability(availability)) {
      severity = availability;
    } else if (freshnessInfo.isLongStale && availability === 'available') {
      severity = 'stale';
    } else if (freshnessInfo.isLongStale && availability === 'not_instrumented') {
      // not_instrumented alone is a gap, not a home exception; long-stale
      // instrumented evidence is handled above. Skip pure not_instrumented.
      severity = null;
    }

    // Long-stale elevation: when already not_verified / attention and evidence
    // is long stale, keep original severity (more specific than plain stale)
    // but mark freshness=stale. When availability is only "stale", keep stale.
    if (!severity) continue;

    // Pure not_instrumented is excluded from EXCEPTION_SEVERITIES path above.
    const item = findInventoryItem(entry.id, registry.inventory);
    const evidenceSource =
      entry.evidenceFreshness?.source ?? 'capability_registry';
    const capturedAt =
      entry.evidenceFreshness?.capturedAt ??
      registry.inventory.capturedAt ??
      toIso(nowMs);

    // Root-cause: group identical source + severity so shared self-report
    // skeletons collapse to one primary event + affected capability list.
    const rootCauseKey = `registry:${evidenceSource}:${severity}`;

    const recentRef = entry.recentEvidenceRefs?.[0];
    const recentChangeSummary = recentRef
      ? `${recentRef.kind}:${recentRef.ref}${recentRef.at ? ` @ ${recentRef.at}` : ''}`
      : `availability=${availabilityLabel(availability)}`;

    const nextSafe =
      entry.allowedSafeActions?.find((action) => action !== 'open_technical_handoff') ??
      entry.allowedSafeActions?.[0];

    candidates.push({
      rootCauseKey,
      severity,
      title: `${item?.name ?? entry.id} · ${availabilityLabel(severity)}`,
      capabilityId: entry.id,
      affectedScope: entry.affectedScope ? [...entry.affectedScope] : [],
      startedAt: capturedAt,
      lastChangedAt: recentRef?.at ?? capturedAt,
      evidenceSource,
      evidenceCapturedAt: capturedAt,
      freshness: freshnessInfo.freshness,
      recentChangeSummary,
      nextActionLabel: nextSafe
        ? safeActionLabel(nextSafe)
        : '打开技术台移交',
      origin: 'capability_metric',
      drilldownKey: entry.drilldownKey,
      group: entry.group as CapabilityCatalogL1Id,
      correlationHints: [
        ...(entry.technicalHandoff?.correlationHints ?? []),
        entry.id,
        entry.drilldownKey,
      ],
      rawContext: {
        availability,
        instrumentStatus: entry.instrumentStatus,
        owner: entry.owner,
        ...(entry.technicalHandoff?.redactedContext ?? {}),
      },
    });
  }

  return candidates;
}

function safeActionLabel(action: string): string {
  switch (action) {
    case 'view_supply_center':
      return '查看供应中心';
    case 'open_route_simulator':
      return '打开路由模拟';
    case 'view_queue_health':
      return '查看队列健康';
    case 'open_task_recover_if_authorized':
      return '打开任务恢复（需授权）';
    case 'view_plan_catalog':
      return '查看套餐目录';
    case 'view_redemptions':
      return '查看兑换码';
    case 'view_drilldown':
      return '打开能力下钻';
    case 'open_technical_handoff':
      return '打开技术台移交';
    default:
      return action.replace(/_/g, ' ');
  }
}

function moreSevere(
  a: ExceptionSeverity,
  b: ExceptionSeverity
): ExceptionSeverity {
  return EXCEPTION_SEVERITY_RANK[a] <= EXCEPTION_SEVERITY_RANK[b] ? a : b;
}

/** Dedupe candidates by rootCauseKey → primary event + affected capabilities. */
export function dedupeExceptionCandidates(
  candidates: readonly ExceptionCandidate[],
  registry: CapabilityRegistryView,
  nowMs: number
): ExceptionHomeRow[] {
  const groups = new Map<string, ExceptionCandidate[]>();
  for (const candidate of candidates) {
    const list = groups.get(candidate.rootCauseKey) ?? [];
    list.push(candidate);
    groups.set(candidate.rootCauseKey, list);
  }

  const rows: ExceptionHomeRow[] = [];
  for (const [rootCauseKey, group] of groups) {
    const sortedGroup = [...group].sort((a, b) => {
      const sev = EXCEPTION_SEVERITY_RANK[a.severity] - EXCEPTION_SEVERITY_RANK[b.severity];
      if (sev !== 0) return sev;
      return a.capabilityId?.localeCompare(b.capabilityId ?? '') ?? 0;
    });
    const primary = sortedGroup[0]!;
    const severity = sortedGroup.reduce(
      (acc, item) => moreSevere(acc, item.severity),
      primary.severity
    );

    const capabilityIds = [
      ...new Set(
        sortedGroup
          .map((item) => item.capabilityId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      ),
    ].sort();

    const affectedScope = [
      ...new Set(sortedGroup.flatMap((item) => item.affectedScope)),
    ].sort();

    const startedMs = Math.min(
      ...sortedGroup.map((item) => toEpoch(item.startedAt, nowMs))
    );
    const lastChangedMs = Math.max(
      ...sortedGroup.map((item) => toEpoch(item.lastChangedAt, nowMs))
    );

    const freshness: ExceptionFreshness = sortedGroup.some(
      (item) => item.freshness === 'stale'
    )
      ? 'stale'
      : sortedGroup.every((item) => item.freshness === 'unknown')
        ? 'unknown'
        : 'fresh';

    const title =
      capabilityIds.length > 1
        ? `${availabilityLabel(severity)} · ${capabilityIds.length} 项能力同源`
        : primary.title;

    const groupId =
      primary.group ??
      groupForCapability(primary.capabilityId ?? capabilityIds[0], registry);

    const handoff = buildHandoffLink({
      group: groupId,
      capabilityId: primary.capabilityId ?? capabilityIds[0],
      drilldownKey: primary.drilldownKey,
      correlationHints: [
        ...new Set(sortedGroup.flatMap((item) => item.correlationHints)),
      ],
      rawContext: {
        rootCauseKey,
        affectedCapabilityIds: capabilityIds.join(','),
        ...primary.rawContext,
      },
      severity,
    });

    const scopeWeight = capabilityIds.length + affectedScope.length;
    const durationMs = Math.max(0, nowMs - startedMs);
    const recencyMs = Math.max(0, nowMs - lastChangedMs);

    rows.push({
      rootCauseKey,
      severity,
      title,
      primaryCapabilityId: primary.capabilityId ?? capabilityIds[0],
      affectedCapabilityIds: capabilityIds,
      affectedScope,
      startedAt: toIso(startedMs),
      lastChangedAt: toIso(lastChangedMs),
      evidenceSource: primary.evidenceSource,
      evidenceCapturedAt: primary.evidenceCapturedAt,
      freshness,
      recentChangeSummary: primary.recentChangeSummary,
      nextActionLabel: primary.nextActionLabel,
      technicalHandoff: handoff,
      origin: primary.origin,
      scopeWeight,
      durationMs,
      recencyMs,
    });
  }

  return rows;
}

/**
 * Sort: severity (asc rank) × scope (desc) × duration (desc) × recent change (asc recency = more recent first).
 */
export function sortExceptionRows(
  rows: readonly ExceptionHomeRow[]
): ExceptionHomeRow[] {
  return [...rows].sort((a, b) => {
    const severity =
      EXCEPTION_SEVERITY_RANK[a.severity] - EXCEPTION_SEVERITY_RANK[b.severity];
    if (severity !== 0) return severity;

    if (b.scopeWeight !== a.scopeWeight) return b.scopeWeight - a.scopeWeight;
    if (b.durationMs !== a.durationMs) return b.durationMs - a.durationMs;
    if (a.recencyMs !== b.recencyMs) return a.recencyMs - b.recencyMs;
    return a.rootCauseKey.localeCompare(b.rootCauseKey);
  });
}

/** Empty-state panorama StatCards (3~5 design hypothesis). */
export function buildPanoramaStatCards(
  registry: CapabilityRegistryView
): PanoramaStatCard[] {
  const items = registry.inventory.items;
  const instrumented = items.filter((item) => item.status === 'instrumented')
    .length;
  const stubOrGap = items.length - instrumented;
  const domains = new Set(items.map((item) => item.group)).size;
  const notVerified = registry.entries.filter(
    (entry) => entry.availability === 'not_verified'
  ).length;
  const drilldowns = ADMIN_DRILLDOWN_PAGES.length;

  return [
    {
      id: 'instrumented',
      label: '已插桩能力',
      value: String(instrumented),
      hint: '运行事实域已接入骨架',
    },
    {
      id: 'stub_or_gap',
      label: '存根 / 未插桩',
      value: String(stubOrGap),
      hint: '待域自报，不伪装健康',
    },
    {
      id: 'domains',
      label: '能力域',
      value: String(domains),
      hint: '一级目录覆盖',
    },
    {
      id: 'not_verified',
      label: '未核验能力',
      value: String(notVerified),
      hint: '有结构无生产核验',
    },
    {
      id: 'drilldowns',
      label: '证据下钻页',
      value: String(drilldowns),
      hint: '既有管理页复用',
    },
  ];
}

/**
 * Build the read-only exception-first home view.
 * Combines ActionableInboxItem + capability OperationalMetric self-reports.
 */
export function buildExceptionHomeView(
  input: BuildExceptionHomeInput = {}
): ExceptionHomeView {
  const registry = input.registry ?? buildCapabilityRegistry();
  const nowMs = toEpoch(input.now, Date.now());
  const projectedAt = toIso(nowMs);

  const inboxCandidates = projectInboxExceptionCandidates(
    input.inboxItems ?? [],
    nowMs
  );
  const metricCandidates = projectCapabilityExceptionCandidates(
    registry,
    nowMs
  );
  const deduped = dedupeExceptionCandidates(
    [...inboxCandidates, ...metricCandidates],
    registry,
    nowMs
  );
  const exceptions = sortExceptionRows(deduped);
  const empty = exceptions.length === 0;

  return {
    projectedAt,
    exceptions,
    empty,
    panoramaStats: buildPanoramaStatCards(registry),
    catalogEntry: {
      path: CAPABILITY_CATALOG_PATH,
      label: '打开能力目录',
      description:
        '两层信息架构：一级能力域（功能/用户影响），二级技术依赖与证据下钻。',
    },
    readOnly: true,
    supportsAck: false,
    supportsAssign: false,
    supportsOwnerWorkflow: false,
  };
}

/** Severity operator label. */
export function exceptionSeverityLabel(severity: ExceptionSeverity): string {
  switch (severity) {
    case 'blocked':
      return '阻塞';
    case 'degraded':
      return '降级';
    case 'attention':
      return '需关注';
    case 'not_verified':
      return '未核验';
    case 'stale':
      return '证据过期';
    default:
      return severity;
  }
}

export function exceptionFreshnessLabel(freshness: ExceptionFreshness): string {
  switch (freshness) {
    case 'fresh':
      return '新鲜';
    case 'stale':
      return '过期';
    case 'unknown':
      return '未知';
    default:
      return freshness;
  }
}

/** Negative-check helpers for C1 (no ack/assign/owner workflow). */
export const FORBIDDEN_EXCEPTION_HOME_UI_PATTERNS = [
  /data-testid=["']exception-ack["']/,
  /data-testid=["']exception-assign["']/,
  /data-testid=["']exception-owner["']/,
  /data-action=["']ack["']/,
  /data-action=["']assign["']/,
  /data-action=["']set-owner["']/,
] as const;

export function assertNoAckAssignOwnerUi(html: string): string[] {
  const hits: string[] = [];
  for (const pattern of FORBIDDEN_EXCEPTION_HOME_UI_PATTERNS) {
    if (pattern.test(html)) {
      hits.push(pattern.source);
    }
  }
  // Operator-facing Chinese workflow labels that must not appear as controls.
  if (/data-testid="[^"]*ack[^"]*"/.test(html)) {
    hits.push('testid-contains-ack');
  }
  if (/指派负责人|确认异常|分配给|Acknowledge|Assign owner/i.test(html)) {
    hits.push('forbidden-workflow-copy');
  }
  return hits;
}
