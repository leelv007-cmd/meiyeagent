/**
 * AG-UI output adapter only (V31-03 / V3.1 §27.3).
 *
 * Domain events keep internal types (run.started, message.final, …).
 * AG-UI enum strings appear only on the adapter output surface — never on
 * AgentSemanticEvent.eventType and never as the projector's source of truth.
 */

import type { AgentSemanticEvent } from '@meiye/contracts';

/**
 * Protocol event names copied from AG-UI docs (output mapping only).
 * Not imported from any AG-UI runtime package.
 */
export const AG_UI_OUTPUT_EVENT_TYPES = [
  'TEXT_MESSAGE_START',
  'TEXT_MESSAGE_CONTENT',
  'TEXT_MESSAGE_END',
  'TOOL_CALL_START',
  'TOOL_CALL_ARGS',
  'TOOL_CALL_END',
  'TOOL_CALL_RESULT',
  'ACTIVITY_SNAPSHOT',
  'ACTIVITY_DELTA',
  'STATE_SNAPSHOT',
  'STATE_DELTA',
  'RUN_STARTED',
  'RUN_FINISHED',
  'RUN_ERROR',
] as const;

export type AgUiOutputEventType = (typeof AG_UI_OUTPUT_EVENT_TYPES)[number];

export type AgUiOutputEvent = {
  type: AgUiOutputEventType;
  threadId: string;
  /** Domain eventId for correlation; not an AG-UI id. */
  sourceEventId: string;
  /** Wire streamOffset decimal string. */
  streamOffset: string;
  payload: unknown;
};

/**
 * Map one domain semantic event to zero-or-more AG-UI protocol events.
 * Unknown domain types yield no output (fail closed on the adapter edge).
 */
export function toAgUiOutput(event: AgentSemanticEvent): AgUiOutputEvent[] {
  const base = {
    threadId: event.threadId,
    sourceEventId: event.eventId,
    streamOffset: event.streamOffset.toString(),
    payload: event.payload,
  };

  switch (event.eventType) {
    case 'run.started':
      return [{ ...base, type: 'RUN_STARTED' }];
    case 'message.final':
      return [
        { ...base, type: 'TEXT_MESSAGE_START' },
        { ...base, type: 'TEXT_MESSAGE_CONTENT' },
        { ...base, type: 'TEXT_MESSAGE_END' },
      ];
    case 'activity.snapshot':
      return [{ ...base, type: 'ACTIVITY_SNAPSHOT' }];
    case 'goal.updated':
    case 'plan.created':
    case 'plan.revised':
    case 'artifact.revised':
    case 'work.waiting':
    case 'work.delivered':
    case 'outcome.recorded':
    case 'memory.proposed':
    case 'memory.promoted':
      return [{ ...base, type: 'STATE_DELTA' }];
    case 'interrupt.requested':
      return [{ ...base, type: 'RUN_FINISHED' }];
    case 'interrupt.resolved':
      return [{ ...base, type: 'RUN_STARTED' }];
    default:
      return [];
  }
}

/** Constructive guard: domain eventType must never be an AG-UI enum string. */
export function isAgUiEnumString(value: string): boolean {
  return (AG_UI_OUTPUT_EVENT_TYPES as readonly string[]).includes(value);
}
