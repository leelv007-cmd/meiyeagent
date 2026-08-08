/**
 * Agent semantic stream frames — extension of workflow progress/token/state
 * three-frame pattern (V3.1 §27.1 / V31-03).
 *
 * Frames:
 * - agent.semantic  → durable projected event (wire decimal streamOffset)
 * - agent.ephemeral → transient:true, never persisted
 * - agent.state      → rebuildable StateSnapshot
 */

import {
  agentEphemeralEventWireSchema,
  agentSemanticEventToWire,
  agentSemanticEventWireSchema,
  type AgentEphemeralEventWire,
  type AgentSemanticEvent,
  type AgentSemanticEventWire,
} from '@meiye/contracts';

import {
  AGENT_STATE_SNAPSHOT_SCHEMA_VERSION,
  type AgentStateSnapshot,
} from './snapshot-replay.js';

export type AgentSemanticFrame =
  | { event: 'agent.semantic'; data: AgentSemanticEventWire }
  | { event: 'agent.ephemeral'; data: AgentEphemeralEventWire }
  | { event: 'agent.state'; data: AgentStateSnapshot };

export function semanticFrameFromDomain(
  event: AgentSemanticEvent,
): AgentSemanticFrame {
  return {
    event: 'agent.semantic',
    data: agentSemanticEventWireSchema.parse(agentSemanticEventToWire(event)),
  };
}

export function ephemeralFrame(
  data: AgentEphemeralEventWire,
): AgentSemanticFrame {
  return {
    event: 'agent.ephemeral',
    data: agentEphemeralEventWireSchema.parse(data),
  };
}

export function stateFrame(snapshot: AgentStateSnapshot): AgentSemanticFrame {
  if (snapshot.schemaVersion !== AGENT_STATE_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(`Unsupported state snapshot version ${snapshot.schemaVersion}`);
  }
  return { event: 'agent.state', data: snapshot };
}

export function agentSemanticFrameId(frame: AgentSemanticFrame): string {
  if (frame.event === 'agent.semantic') {
    return frame.data.eventId;
  }
  if (frame.event === 'agent.ephemeral') {
    return frame.data.eventId;
  }
  return [
    frame.data.threadId,
    frame.data.revision,
    frame.data.lastEventId ?? 'none',
  ].join(':');
}

export function encodeAgentSemanticSseFrame(frame: AgentSemanticFrame): string {
  return [
    `id: ${agentSemanticFrameId(frame)}`,
    `event: ${frame.event}`,
    `data: ${JSON.stringify(frame.data)}`,
    '',
    '',
  ].join('\n');
}

/**
 * Resume cursor for agent.semantic frames only (durable recovery).
 * Ephemeral ids never advance the durable lastEventId cursor.
 */
export function isDurableFrame(frame: AgentSemanticFrame): boolean {
  return frame.event === 'agent.semantic' || frame.event === 'agent.state';
}
