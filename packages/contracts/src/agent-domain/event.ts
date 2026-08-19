/**
 * Agent-domain: Event (V3.1 §27).
 */

import { z } from 'zod';

import {
  agentRunIdSchema,
  agentSemanticEventIdSchema,
  agentThreadIdSchema,
  identifierSchema,
  nonEmptyTrimmedStringSchema,
} from '../identifiers.js';
import { jsonValueSchema, timestampSchema } from './internal.js';

// ─── 6. Event (V3.1 §27) ────────────────────────────────────────────────────

export const AGENT_SEMANTIC_EVENT_SCHEMA_VERSION =
  'agent-semantic-event/v1' as const;

export const agentEventContextRoleSchema = z.enum([
  'included',
  'excluded',
  'summarized',
]);

export const AGENT_SEMANTIC_EVENT_TYPES = [
  'run.started',
  'message.final',
  'activity.snapshot',
  'goal.updated',
  'plan.created',
  'plan.revised',
  'interrupt.requested',
  'interrupt.resolved',
  'artifact.revised',
  'memory.proposed',
  'memory.promoted',
  'work.waiting',
  'work.delivered',
  'outcome.recorded',
] as const;

export const agentSemanticEventTypeSchema = z.enum(AGENT_SEMANTIC_EVENT_TYPES);

/**
 * Domain schema: streamOffset is bigint (per-thread monotonic).
 * Wire schema uses decimal string — see agentSemanticEventWireSchema.
 */
export const agentSemanticEventSchema = z
  .object({
    schemaVersion: z.literal(AGENT_SEMANTIC_EVENT_SCHEMA_VERSION),
    eventId: agentSemanticEventIdSchema,
    threadId: agentThreadIdSchema,
    streamOffset: z.bigint(),
    contextRole: agentEventContextRoleSchema,
    sourceDomain: nonEmptyTrimmedStringSchema.max(100),
    sourceEntityId: identifierSchema,
    sourceRevision: nonEmptyTrimmedStringSchema.max(200),
    correlationId: identifierSchema,
    causationId: identifierSchema.optional(),
    eventType: z.union([
      agentSemanticEventTypeSchema,
      nonEmptyTrimmedStringSchema.max(100),
    ]),
    payload: jsonValueSchema,
    occurredAt: timestampSchema,
  })
  .strict();

export type AgentSemanticEvent = z.infer<typeof agentSemanticEventSchema>;

/** Decimal-string streamOffset for JSON/SSE (MAJOR-02). Compare numerically. */
export const agentSemanticEventWireSchema = z
  .object({
    schemaVersion: z.literal(AGENT_SEMANTIC_EVENT_SCHEMA_VERSION),
    eventId: agentSemanticEventIdSchema,
    threadId: agentThreadIdSchema,
    streamOffset: z
      .string()
      .regex(/^(0|[1-9]\d*)$/u, 'streamOffset wire must be non-negative decimal'),
    contextRole: agentEventContextRoleSchema,
    sourceDomain: nonEmptyTrimmedStringSchema.max(100),
    sourceEntityId: identifierSchema,
    sourceRevision: nonEmptyTrimmedStringSchema.max(200),
    correlationId: identifierSchema,
    causationId: identifierSchema.optional(),
    eventType: z.union([
      agentSemanticEventTypeSchema,
      nonEmptyTrimmedStringSchema.max(100),
    ]),
    payload: jsonValueSchema,
    occurredAt: timestampSchema,
  })
  .strict();

export type AgentSemanticEventWire = z.infer<typeof agentSemanticEventWireSchema>;

export const AGENT_EPHEMERAL_EVENT_SCHEMA_VERSION =
  'agent-ephemeral-event/v1' as const;

/**
 * Ephemeral frames are emitter-side transient=true and never persist.
 * Not part of recovery correctness.
 */
export const agentEphemeralEventWireSchema = z
  .object({
    schemaVersion: z.literal(AGENT_EPHEMERAL_EVENT_SCHEMA_VERSION),
    eventId: identifierSchema,
    threadId: agentThreadIdSchema,
    runId: agentRunIdSchema.optional(),
    eventType: nonEmptyTrimmedStringSchema.max(100),
    payload: jsonValueSchema,
    occurredAt: timestampSchema,
    /** Emission-side mark: never write to PostgreSQL (B2). */
    transient: z.literal(true),
  })
  .strict();

export type AgentEphemeralEventWire = z.infer<typeof agentEphemeralEventWireSchema>;

export function agentSemanticEventToWire(
  event: AgentSemanticEvent,
): AgentSemanticEventWire {
  return agentSemanticEventWireSchema.parse({
    ...event,
    streamOffset: event.streamOffset.toString(),
  });
}

export function agentSemanticEventFromWire(
  wire: AgentSemanticEventWire,
): AgentSemanticEvent {
  return agentSemanticEventSchema.parse({
    ...wire,
    streamOffset: BigInt(wire.streamOffset),
  });
}

/** Compare wire cursors by numeric order (not lexicographic). */
export function compareStreamOffsetWire(left: string, right: string): number {
  const a = BigInt(left);
  const b = BigInt(right);
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

