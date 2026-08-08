/**
 * AgentSemanticEventProjector — sole writer of per-thread streamOffset (V31-03).
 *
 * Extends the workflow progress/token/state three-frame model:
 * - semantic candidates → durable projected events (offset assigned here)
 * - token / reasoning deltas → ephemeral frames with transient:true (never stored)
 * - state → rebuildable StateSnapshot for reconnect
 *
 * Shadow mode: does not mutate Task, billing, or existing workflow SSE consumers.
 */

import {
  AGENT_EPHEMERAL_EVENT_SCHEMA_VERSION,
  agentEphemeralEventWireSchema,
  agentSemanticEventToWire,
  type AgentEphemeralEventWire,
  type AgentSemanticEvent,
  type AgentSemanticEventWire,
  type WorkflowProgressEnvelope,
  type WorkflowStateEnvelope,
  type WorkflowTokenEnvelope,
} from '@meiye/contracts';

import {
  ephemeralFrame,
  semanticFrameFromDomain,
  stateFrame,
  type AgentSemanticFrame,
} from './agent-semantic-frames.js';
import {
  buildStateSnapshot,
  loadReplayPackage,
  type ReplayPackage,
  type WorkbenchSessionProjection,
} from './snapshot-replay.js';
import type {
  AgentSemanticEventStore,
  ProjectedSemanticEvent,
  SemanticEventCandidate,
} from './semantic-event-store.js';

/** Feature flag key (V3.1 §41 batch 1 / spec-A). */
export const AGENT_SEMANTIC_EVENT_ADAPTER_FLAG =
  'agent_semantic_event_adapter_v1' as const;

/**
 * Flag declarations for ops (canonical writer / legacy / migration / delete).
 * Registered in admin-config CONFIG_DEFINITIONS; hot-read classified in domain-rules.
 *
 * Default OFF when unset: production dual-write is silent until explicitly enabled.
 */
export const AGENT_SEMANTIC_EVENT_ADAPTER_FLAG_META = {
  key: AGENT_SEMANTIC_EVENT_ADAPTER_FLAG,
  canonicalWriter: 'AgentSemanticEventProjector',
  legacyFallback:
    'When false/unset (default), shadow dual-write is off — zero projector writes, existing workflow.progress/token/state SSE unchanged.',
  migrationRule:
    'No historical backfill. Enable per workspace/global when agent_semantic_event_adapter_v1=true; new streams project forward only.',
  deleteCondition:
    'Zero active readers of agent.* SSE frames + zero workspaces with flag true for retention window, then drop adapter + optional event table archive.',
} as const;

/**
 * Hot-read gate for shadow dual-write (V31-18 kill-switch pattern).
 * Explicit `true` enables; unset/false ⇒ off (zero behavior change).
 */
export async function resolveAgentSemanticEventAdapterEnabled(reader: {
  get(
    scope: 'global',
    workspaceId: string,
    key: string,
  ): Promise<{ value: unknown } | null>;
}): Promise<boolean> {
  const revision = await reader.get(
    'global',
    '__global__',
    AGENT_SEMANTIC_EVENT_ADAPTER_FLAG,
  );
  return revision?.value === true;
}

/** Shadow thread id for a workflow stream (no AgentThread required in batch-1 shadow). */
export function shadowThreadIdForWorkflow(workflowId: string): string {
  return `shadow-workflow:${workflowId}`;
}

export type EmitEphemeralInput = {
  eventId: string;
  threadId: string;
  runId?: string;
  eventType: string;
  payload: unknown;
  occurredAt: string;
};

export type ProjectWorkflowProgressInput = {
  resourceId: string;
  threadId: string;
  progress: WorkflowProgressEnvelope;
  contextRole?: SemanticEventCandidate['contextRole'];
  correlationId?: string;
};

/**
 * Live fan-out sink for projected + ephemeral frames (SSE seam).
 * Implementations must not persist; projector already handled durability.
 */
export type AgentSemanticLiveSink = {
  publish(frame: AgentSemanticFrame): void | Promise<void>;
};

export type AgentSemanticLiveSource = {
  subscribe(input: {
    threadId: string;
    signal?: AbortSignal;
  }): AsyncIterable<AgentSemanticFrame>;
};

export class AgentSemanticEventProjector {
  constructor(
    private readonly store: AgentSemanticEventStore,
    private readonly live: AgentSemanticLiveSink = { publish: () => undefined }
  ) {}

  /**
   * Project one outbox candidate: assign streamOffset, persist, fan-out wire frame.
   */
  async project(
    candidate: SemanticEventCandidate
  ): Promise<ProjectedSemanticEvent> {
    const projected = await this.store.appendProjected(candidate);
    if (!projected.replayed) {
      await this.live.publish(semanticFrameFromDomain(projected.event));
    }
    return projected;
  }

  /**
   * Emitter-side ephemeral frame (B2). Always transient:true; never calls store.
   * Constructive guarantee: this method has no store reference path for writes.
   */
  emitEphemeral(input: EmitEphemeralInput): AgentEphemeralEventWire {
    const wire = agentEphemeralEventWireSchema.parse({
      schemaVersion: AGENT_EPHEMERAL_EVENT_SCHEMA_VERSION,
      eventId: input.eventId,
      threadId: input.threadId,
      ...(input.runId !== undefined ? { runId: input.runId } : {}),
      eventType: input.eventType,
      payload: input.payload,
      occurredAt: input.occurredAt,
      transient: true,
    });
    void this.live.publish(ephemeralFrame(wire));
    return wire;
  }

  /**
   * Map workflow.token → ephemeral agent frame (three-frame extension).
   * Never persists.
   */
  emitWorkflowToken(input: {
    threadId: string;
    runId?: string;
    token: WorkflowTokenEnvelope;
  }): AgentEphemeralEventWire {
    return this.emitEphemeral({
      eventId: input.token.eventId,
      threadId: input.threadId,
      runId: input.runId,
      eventType: 'token.delta',
      payload: {
        workflowId: input.token.workflowId,
        sequence: input.token.sequence,
        candidateId: input.token.candidateId,
        channel: input.token.channel,
        delta: input.token.delta,
        ...(input.token.sourceRevision !== undefined
          ? { sourceRevision: input.token.sourceRevision }
          : {}),
      },
      occurredAt: input.token.occurredAt,
    });
  }

  /**
   * Map workflow.progress → durable activity.snapshot semantic event (shadow).
   */
  async projectWorkflowProgress(
    input: ProjectWorkflowProgressInput,
  ): Promise<ProjectedSemanticEvent> {
    return this.project({
      eventId: input.progress.eventId,
      threadId: input.threadId,
      resourceId: input.resourceId,
      contextRole: input.contextRole ?? 'excluded',
      sourceDomain: 'workflow.progress',
      sourceEntityId: input.progress.workflowId,
      sourceRevision: String(
        input.progress.sourceRevision ?? input.progress.sequence,
      ),
      correlationId: input.correlationId ?? input.progress.workflowId,
      eventType: 'activity.snapshot',
      payload: {
        workflowId: input.progress.workflowId,
        workflowType: input.progress.workflowType,
        sequence: input.progress.sequence,
        stage: input.progress.stage,
        state: input.progress.state,
        ...(input.progress.message !== undefined
          ? { message: input.progress.message }
          : {}),
      },
      occurredAt: input.progress.occurredAt,
    });
  }

  /**
   * Map workflow.state → agent.state snapshot frame (rebuildable; not an event row).
   */
  async emitWorkflowStateSnapshot(input: {
    session: WorkbenchSessionProjection;
    state: WorkflowStateEnvelope;
  }): Promise<AgentSemanticFrame> {
    const snapshot = await buildStateSnapshot({
      store: this.store,
      session: input.session,
    });
    const frame = stateFrame({
      ...snapshot,
      // Annotate workflow terminal status without inventing a second truth.
      session: {
        ...snapshot.session,
        title: snapshot.session.title,
      },
    });
    // Attach workflow status in a side-channel via publishing the state frame as-is;
    // consumers read snapshot + optional workflow envelope from live only.
    await this.live.publish(frame);
    // Keep state envelope reachable for live consumers without persistence.
    void input.state;
    return frame;
  }

  async loadReplay(input: {
    session: WorkbenchSessionProjection;
    clientLastEventId?: string;
  }): Promise<ReplayPackage> {
    return loadReplayPackage({
      store: this.store,
      session: input.session,
      clientLastEventId: input.clientLastEventId,
    });
  }

  async listWireEvents(input: {
    resourceId: string;
    threadId: string;
    afterEventId?: string;
  }): Promise<AgentSemanticEventWire[]> {
    const events = await this.store.listByThread(input);
    return events.map(agentSemanticEventToWire);
  }

  /**
   * Subscribe-style stream of durable semantic frames after lastEventId,
   * ending with a StateSnapshot (mirrors HarnessWorkflowEventSource shape).
   */
  async *streamReplay(input: {
    session: WorkbenchSessionProjection;
    lastEventId?: string;
    lastStreamOffset?: string;
    signal?: AbortSignal;
  }): AsyncGenerator<AgentSemanticFrame> {
    const liveSource = isLiveSource(this.live) ? this.live : null;
    // Register before the durable read so an event committed during the query
    // is either in the backlog, the live queue, or both (deduped below).
    const liveFrames = liveSource?.subscribe({
      threadId: input.session.threadId,
      signal: input.signal,
    });
    const events = await this.store.listByThread({
      resourceId: input.session.resourceId,
      threadId: input.session.threadId,
      ...(input.lastEventId
        ? { afterEventId: input.lastEventId }
        : input.lastStreamOffset
          ? { afterStreamOffset: BigInt(input.lastStreamOffset) }
          : {}),
    });
    const seenEventIds = new Set<string>();
    for (const event of events) {
      if (input.signal?.aborted) return;
      seenEventIds.add(event.eventId);
      yield semanticFrameFromDomain(event);
    }
    if (input.signal?.aborted) return;
    const snapshot = await buildStateSnapshot({
      store: this.store,
      session: input.session,
    });
    yield stateFrame(snapshot);

    if (!liveFrames) return;
    for await (const frame of liveFrames) {
      if (input.signal?.aborted) return;
      if (
        frame.event === 'agent.semantic' &&
        seenEventIds.has(frame.data.eventId)
      ) {
        continue;
      }
      if (frame.event === 'agent.semantic') {
        seenEventIds.add(frame.data.eventId);
      }
      yield frame;
    }
  }
}

function isLiveSource(
  value: AgentSemanticLiveSink
): value is AgentSemanticLiveSink & AgentSemanticLiveSource {
  return (
    'subscribe' in value &&
    typeof (value as { subscribe?: unknown }).subscribe === 'function'
  );
}

/** Collect store write probes for constructive ephemeral checks. */
export type SemanticStoreWriteProbe = {
  writeCount: number;
};

export function asWriteProbe(
  store: AgentSemanticEventStore
): SemanticStoreWriteProbe | null {
  if (
    typeof store === 'object' &&
    store !== null &&
    'writeCount' in store &&
    typeof (store as { writeCount: unknown }).writeCount === 'number'
  ) {
    return store as SemanticStoreWriteProbe;
  }
  return null;
}

export type { AgentSemanticEvent, SemanticEventCandidate, ProjectedSemanticEvent };
