/**
 * Client event reducer — rebuild Thread UI state from semantic stream
 * (V3.1 §27.6 / §28.2, V31-04).
 *
 * Pure module: out-of-order / duplicate safe. Patch failure discards local
 * projection so reconnectAgentWorkbench can re-fetch snapshot (sole recovery).
 * No Redux / Zustand — consumed via agent-event-store external store.
 */

import {
  compareStreamOffsetWire,
  type AgentSemanticEventWire,
} from '@meiye/contracts';

import {
  parseLivingPlanEventPayload,
  type LivingPlanRevisionFacts,
} from './plan/living-plan-model';

// ─── Session / projections ───────────────────────────────────────────────────

/** Minimal session projection for reconnect (aligns with Core snapshot-replay). */
export type WorkbenchSessionProjection = {
  resourceId: string;
  threadId: string;
  sessionRevision: number;
  activeRunId?: string;
  title?: string;
};

export type NarrativeMessage = {
  id: string;
  text: string;
  occurredAt: string;
  streamOffset: string;
  /** Dedup key for work.delivered — same key never shows twice. */
  deliveryKey?: string;
};

export type AgentActivityStatus = 'running' | 'done' | 'failed' | 'idle';

export type AgentActivity = {
  id: string;
  title: string;
  status: AgentActivityStatus;
  detail?: string;
  collapsed: boolean;
  streamOffset: string;
  updatedAt: string;
};

export type InterruptProjection = {
  interruptId: string;
  interruptType: string;
  description: string;
  revision: number;
  streamOffset: string;
};

export type ArtifactProjection = {
  artifactId: string;
  kind: string;
  revision: string;
  summary?: string;
  streamOffset: string;
};

/** Append-only Living Plan projection per planId (V31-10 / V3.1 §5.3). */
export type PlanProjectionState = {
  planId: string;
  /** Sorted ascending by revision number; never mutates prior rows. */
  revisions: LivingPlanRevisionFacts[];
  latestRevision: number;
};

export type AgentConnectionState =
  | 'connecting'
  | 'live'
  | 'replaying'
  | 'offline'
  | 'resyncing';

export type AgentWorkbenchClientState = {
  session: WorkbenchSessionProjection | null;
  messages: NarrativeMessage[];
  activities: Record<string, AgentActivity>;
  artifacts: Record<string, ArtifactProjection>;
  /** planId → append-only revision history (Living Plan UI). */
  plans: Record<string, PlanProjectionState>;
  /** Most recently touched plan (Workstream renders this). */
  activePlanId: string | null;
  pendingInterrupts: InterruptProjection[];
  connection: AgentConnectionState;
  lastEventId: string | null;
  lastStreamOffset: string | null;
  snapshotRevision: string | null;
  /** §27.6: explicit taskId from URL / host — never overwritten by "recent". */
  explicitTaskId: string | null;
  seenEventIds: ReadonlySet<string>;
  deliveredKeys: ReadonlySet<string>;
  needsSnapshotResync: boolean;
  mobilePane: 'process' | 'works';
};

export type ClientSnapshotCursor = {
  revision: string;
  lastEventId: string | null;
  lastStreamOffset: string | null;
};

export type AgentWorkbenchAction =
  | { type: 'set_connection'; connection: AgentConnectionState }
  | { type: 'set_session'; session: WorkbenchSessionProjection | null }
  | { type: 'set_explicit_task_id'; taskId: string | null }
  | { type: 'set_mobile_pane'; pane: 'process' | 'works' }
  | { type: 'toggle_activity_collapsed'; activityId: string }
  | {
      type: 'hydrate_replay';
      session: WorkbenchSessionProjection;
      snapshot: ClientSnapshotCursor;
      events: readonly AgentSemanticEventWire[];
      /** Ignored when explicitTaskId already set (§27.6). */
      recentTaskId?: string | null;
    }
  | { type: 'apply_semantic_event'; event: AgentSemanticEventWire }
  | { type: 'apply_events_batch'; events: readonly AgentSemanticEventWire[] }
  | { type: 'patch_failed'; reason: string }
  | { type: 'reset' };

export type ReduceResult = {
  state: AgentWorkbenchClientState;
  duplicate: boolean;
  foreign: boolean;
  /** False when apply threw / refused — caller should patch_failed. */
  ok: boolean;
  error?: string;
};

export function createEmptyAgentWorkbenchState(): AgentWorkbenchClientState {
  return {
    session: null,
    messages: [],
    activities: {},
    artifacts: {},
    plans: {},
    activePlanId: null,
    pendingInterrupts: [],
    connection: 'offline',
    lastEventId: null,
    lastStreamOffset: null,
    snapshotRevision: null,
    explicitTaskId: null,
    seenEventIds: new Set(),
    deliveredKeys: new Set(),
    needsSnapshotResync: false,
    mobilePane: 'process',
  };
}

/** Active plan revision history for Workstream Living Plan mount. */
export function projectActivePlanRevisions(
  state: AgentWorkbenchClientState
): readonly LivingPlanRevisionFacts[] {
  if (!state.activePlanId) return [];
  const plan = state.plans[state.activePlanId];
  return plan?.revisions ?? [];
}

/** Visible narrative lines in stream order (card reduction already applied). */
export function projectVisibleNarratives(
  state: AgentWorkbenchClientState
): NarrativeMessage[] {
  return state.messages;
}

/**
 * Visible activities — empty title/status-idle-without-detail never shown
 * (V3.1 批次1 exit: 不显示空 Activity).
 */
export function projectVisibleActivities(
  state: AgentWorkbenchClientState
): AgentActivity[] {
  return Object.values(state.activities)
    .filter((activity) => isActivityVisible(activity))
    .sort((left, right) =>
      compareStreamOffsetWire(left.streamOffset, right.streamOffset)
    );
}

export function isActivityVisible(activity: AgentActivity): boolean {
  const title = activity.title.trim();
  if (!title) return false;
  if (activity.status === 'idle' && !activity.detail?.trim()) return false;
  return true;
}

export function reduceAgentWorkbench(
  state: AgentWorkbenchClientState,
  action: AgentWorkbenchAction
): ReduceResult {
  switch (action.type) {
    case 'set_connection':
      return ok({ ...state, connection: action.connection });
    case 'set_session':
      return ok({ ...state, session: action.session });
    case 'set_explicit_task_id':
      return ok({ ...state, explicitTaskId: action.taskId });
    case 'set_mobile_pane':
      return ok({ ...state, mobilePane: action.pane });
    case 'toggle_activity_collapsed': {
      const current = state.activities[action.activityId];
      if (!current) return ok(state);
      return ok({
        ...state,
        activities: {
          ...state.activities,
          [action.activityId]: {
            ...current,
            collapsed: !current.collapsed,
          },
        },
      });
    }
    case 'reset':
      return ok({
        ...createEmptyAgentWorkbenchState(),
        explicitTaskId: state.explicitTaskId,
      });
    case 'patch_failed':
      return ok(discardProjectionForResync(state));
    case 'hydrate_replay':
      return ok(hydrateReplay(state, action));
    case 'apply_semantic_event':
      return applyOne(state, action.event);
    case 'apply_events_batch':
      return applyBatch(state, action.events);
    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      return ok(state);
    }
  }
}

function ok(state: AgentWorkbenchClientState): ReduceResult {
  return { state, duplicate: false, foreign: false, ok: true };
}

function discardProjectionForResync(
  state: AgentWorkbenchClientState
): AgentWorkbenchClientState {
  return {
    ...createEmptyAgentWorkbenchState(),
    explicitTaskId: state.explicitTaskId,
    mobilePane: state.mobilePane,
    connection: 'resyncing',
    needsSnapshotResync: true,
  };
}

function hydrateReplay(
  prev: AgentWorkbenchClientState,
  action: Extract<AgentWorkbenchAction, { type: 'hydrate_replay' }>
): AgentWorkbenchClientState {
  let next: AgentWorkbenchClientState = {
    ...createEmptyAgentWorkbenchState(),
    explicitTaskId: prev.explicitTaskId,
    mobilePane: prev.mobilePane,
    session: action.session,
    snapshotRevision: action.snapshot.revision,
    lastEventId: action.snapshot.lastEventId,
    lastStreamOffset: action.snapshot.lastStreamOffset,
    connection: 'replaying',
    needsSnapshotResync: false,
  };

  // §27.6: never let recent-task overwrite explicit taskId
  void action.recentTaskId;

  const batch = applyBatch(next, action.events);
  next = batch.state;
  next = {
    ...next,
    connection: 'live',
    needsSnapshotResync: false,
  };
  return next;
}

function applyBatch(
  state: AgentWorkbenchClientState,
  events: readonly AgentSemanticEventWire[]
): ReduceResult {
  const ordered = [...events].sort((left, right) =>
    compareStreamOffsetWire(left.streamOffset, right.streamOffset)
  );
  let current = state;
  let anyDup = false;
  let anyForeign = false;
  for (const event of ordered) {
    const result = applyOne(current, event);
    if (!result.ok) {
      return {
        state: discardProjectionForResync(current),
        duplicate: false,
        foreign: false,
        ok: false,
        error: result.error,
      };
    }
    current = result.state;
    anyDup = anyDup || result.duplicate;
    anyForeign = anyForeign || result.foreign;
  }
  return {
    state: current,
    duplicate: anyDup,
    foreign: anyForeign,
    ok: true,
  };
}

function applyOne(
  state: AgentWorkbenchClientState,
  event: AgentSemanticEventWire
): ReduceResult {
  if (state.session && event.threadId !== state.session.threadId) {
    return { state, duplicate: false, foreign: true, ok: true };
  }
  if (state.seenEventIds.has(event.eventId)) {
    return { state, duplicate: true, foreign: false, ok: true };
  }

  try {
    const projected = projectEvent(state, event);
    if (!projected.ok) {
      return {
        state,
        duplicate: false,
        foreign: false,
        ok: false,
        error: projected.error,
      };
    }
    const next = projected.state;
    const seen = new Set(state.seenEventIds);
    seen.add(event.eventId);
    let lastEventId = next.lastEventId;
    let lastStreamOffset = next.lastStreamOffset;
    if (
      lastStreamOffset === null ||
      compareStreamOffsetWire(event.streamOffset, lastStreamOffset) > 0
    ) {
      lastStreamOffset = event.streamOffset;
      lastEventId = event.eventId;
    }
    return {
      state: {
        ...next,
        seenEventIds: seen,
        lastEventId,
        lastStreamOffset,
      },
      duplicate: false,
      foreign: false,
      ok: true,
    };
  } catch (error) {
    return {
      state,
      duplicate: false,
      foreign: false,
      ok: false,
      error: error instanceof Error ? error.message : 'apply_threw',
    };
  }
}

type ProjectResult =
  | { ok: true; state: AgentWorkbenchClientState }
  | { ok: false; error: string };

function projectEvent(
  state: AgentWorkbenchClientState,
  event: AgentSemanticEventWire
): ProjectResult {
  const payload = asRecord(event.payload);

  switch (event.eventType) {
    case 'message.final': {
      const text = readString(payload, 'text')?.trim() ?? '';
      if (!text) {
        // Empty narrative is a no-op projection (still advances cursor via applyOne)
        return { ok: true, state };
      }
      return {
        ok: true,
        state: {
          ...state,
          messages: [
            ...state.messages,
            {
              id: event.eventId,
              text,
              occurredAt: event.occurredAt,
              streamOffset: event.streamOffset,
            },
          ],
        },
      };
    }
    case 'activity.snapshot': {
      const activityId = readString(payload, 'activityId')?.trim() ?? '';
      if (!activityId) {
        return { ok: false, error: 'activity.snapshot missing activityId' };
      }
      const title = readString(payload, 'title')?.trim() ?? '';
      const status = readActivityStatus(payload.status);
      const detail = readString(payload, 'detail')?.trim();
      const existing = state.activities[activityId];
      const nextActivity: AgentActivity = {
        id: activityId,
        title,
        status,
        detail: detail || undefined,
        collapsed: existing?.collapsed ?? true,
        streamOffset: event.streamOffset,
        updatedAt: event.occurredAt,
      };
      // Store even if not visible — projectVisibleActivities filters empty
      return {
        ok: true,
        state: {
          ...state,
          activities: {
            ...state.activities,
            [activityId]: nextActivity,
          },
        },
      };
    }
    case 'interrupt.requested': {
      const interruptId = readString(payload, 'interruptId')?.trim() ?? '';
      if (!interruptId) {
        return { ok: false, error: 'interrupt.requested missing interruptId' };
      }
      const interrupt: InterruptProjection = {
        interruptId,
        interruptType:
          readString(payload, 'interruptType')?.trim() || 'unknown',
        description: readString(payload, 'description')?.trim() || '',
        revision: readNumber(payload, 'revision') ?? 0,
        streamOffset: event.streamOffset,
      };
      const without = state.pendingInterrupts.filter(
        (item) => item.interruptId !== interruptId
      );
      return {
        ok: true,
        state: {
          ...state,
          // Pending interrupts always listed (priority for host display)
          pendingInterrupts: [interrupt, ...without],
        },
      };
    }
    case 'interrupt.resolved': {
      const interruptId = readString(payload, 'interruptId')?.trim() ?? '';
      if (!interruptId) {
        return { ok: false, error: 'interrupt.resolved missing interruptId' };
      }
      return {
        ok: true,
        state: {
          ...state,
          pendingInterrupts: state.pendingInterrupts.filter(
            (item) => item.interruptId !== interruptId
          ),
        },
      };
    }
    case 'work.delivered': {
      const deliveryKey =
        readString(payload, 'deliveryKey')?.trim() || event.eventId;
      if (state.deliveredKeys.has(deliveryKey)) {
        // Duplicate delivery — advance cursor but no second card
        return { ok: true, state };
      }
      const text =
        readString(payload, 'text')?.trim() ||
        readString(payload, 'summary')?.trim() ||
        '交付已就绪';
      const deliveredKeys = new Set(state.deliveredKeys);
      deliveredKeys.add(deliveryKey);
      return {
        ok: true,
        state: {
          ...state,
          deliveredKeys,
          messages: [
            ...state.messages,
            {
              id: event.eventId,
              text,
              occurredAt: event.occurredAt,
              streamOffset: event.streamOffset,
              deliveryKey,
            },
          ],
        },
      };
    }
    case 'artifact.revised': {
      const artifactId = readString(payload, 'artifactId')?.trim() ?? '';
      if (!artifactId) {
        return { ok: false, error: 'artifact.revised missing artifactId' };
      }
      const artifact: ArtifactProjection = {
        artifactId,
        kind: readString(payload, 'kind')?.trim() || 'unknown',
        revision: readString(payload, 'revision')?.trim() || event.streamOffset,
        summary: readString(payload, 'summary')?.trim() || undefined,
        streamOffset: event.streamOffset,
      };
      return {
        ok: true,
        state: {
          ...state,
          artifacts: {
            ...state.artifacts,
            [artifactId]: artifact,
          },
        },
      };
    }
    case 'plan.created':
    case 'plan.revised': {
      const facts = parseLivingPlanEventPayload(payload);
      if (!facts) {
        // Malformed plan payload: advance cursor only (fail closed on UI body)
        return { ok: true, state };
      }
      const withCursor: LivingPlanRevisionFacts = {
        ...facts,
        streamOffset: event.streamOffset,
        occurredAt: event.occurredAt,
      };
      return {
        ok: true,
        state: appendPlanRevision(state, withCursor),
      };
    }
    case 'run.started':
    case 'goal.updated':
    case 'memory.proposed':
    case 'memory.promoted':
    case 'work.waiting':
    case 'outcome.recorded':
      // Known semantic types without Workstream card body yet — cursor only
      return { ok: true, state };
    default:
      // Unknown event types: accept for forward-compat, no UI mutation
      return { ok: true, state };
  }
}

/**
 * Append-only plan revision projection. Never mutates prior revision rows.
 * Duplicate revision numbers for the same planId are ignored (idempotent).
 */
function appendPlanRevision(
  state: AgentWorkbenchClientState,
  facts: LivingPlanRevisionFacts
): AgentWorkbenchClientState {
  const existing = state.plans[facts.planId];
  if (existing) {
    if (existing.revisions.some((row) => row.revision === facts.revision)) {
      return {
        ...state,
        activePlanId: facts.planId,
      };
    }
    if (facts.revision <= existing.latestRevision) {
      // Out-of-order lower revision: still record if not present, keep sort
      const revisions = [...existing.revisions, facts].sort(
        (left, right) => left.revision - right.revision
      );
      return {
        ...state,
        activePlanId: facts.planId,
        plans: {
          ...state.plans,
          [facts.planId]: {
            planId: facts.planId,
            revisions,
            latestRevision: revisions[revisions.length - 1]!.revision,
          },
        },
      };
    }
    const revisions = [...existing.revisions, facts];
    return {
      ...state,
      activePlanId: facts.planId,
      plans: {
        ...state.plans,
        [facts.planId]: {
          planId: facts.planId,
          revisions,
          latestRevision: facts.revision,
        },
      },
    };
  }

  return {
    ...state,
    activePlanId: facts.planId,
    plans: {
      ...state.plans,
      [facts.planId]: {
        planId: facts.planId,
        revisions: [facts],
        latestRevision: facts.revision,
      },
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function readString(
  record: Record<string, unknown>,
  key: string
): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function readNumber(
  record: Record<string, unknown>,
  key: string
): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function readActivityStatus(value: unknown): AgentActivityStatus {
  if (
    value === 'running' ||
    value === 'done' ||
    value === 'failed' ||
    value === 'idle'
  ) {
    return value;
  }
  return 'running';
}
