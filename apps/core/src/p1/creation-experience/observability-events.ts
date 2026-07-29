import type { ObservabilityEvent } from '@meiye/contracts';
import { isDeepStrictEqual } from 'node:util';

interface HarnessAuditWriter {
  appendAuditIdempotently(event: {
    workspaceId: string;
    id: string;
    workflowId: string;
    stage: string;
    eventType: string;
    payload: unknown;
  }): Promise<void>;
}

function assertServerOwnedEventIdentity(
  workspaceId: string,
  event: ObservabilityEvent,
  idempotencyKey: string,
) {
  if (
    event.eventType === 'agent_primitive.lifecycle' &&
    event.workspaceId !== workspaceId
  ) {
    throw new Error('Agent primitive workspace identity mismatch.');
  }
  if (
    event.eventType === 'agent_primitive.lifecycle' &&
    event.idempotencyKey !== idempotencyKey
  ) {
    throw new Error('Agent primitive idempotency identity mismatch.');
  }
}

export interface ObservabilityEventAuditPort {
  append<Event extends ObservabilityEvent>(
    workspaceId: string,
    event: Event,
    idempotencyKey: string,
  ): Promise<Event> | Event;
}

export class HarnessObservabilityEventAudit
  implements ObservabilityEventAuditPort
{
  constructor(private readonly auditWriter: HarnessAuditWriter) {}

  async append<Event extends ObservabilityEvent>(
    workspaceId: string,
    event: Event,
    idempotencyKey: string,
  ): Promise<Event> {
    assertServerOwnedEventIdentity(workspaceId, event, idempotencyKey);
    await this.auditWriter.appendAuditIdempotently({
      workspaceId,
      id: `observability-${idempotencyKey}`,
      workflowId: event.taskId,
      stage: 'observability_event_ingest',
      eventType: event.eventType,
      payload: event,
    });
    return structuredClone(event);
  }
}

export class MemoryObservabilityEventAudit
  implements ObservabilityEventAuditPort
{
  private readonly events: Array<{
    event: ObservabilityEvent;
    idempotencyKey: string;
    workspaceId: string;
  }> = [];

  append<Event extends ObservabilityEvent>(
    workspaceId: string,
    event: Event,
    idempotencyKey: string,
  ): Event {
    assertServerOwnedEventIdentity(workspaceId, event, idempotencyKey);
    const storedEvent = structuredClone(event) as Event;
    const existing = this.events.find(
      (stored) =>
        stored.workspaceId === workspaceId &&
        stored.idempotencyKey === idempotencyKey,
    );
    if (existing) {
      if (!isDeepStrictEqual(existing.event, storedEvent)) {
        throw new Error('Observability idempotency conflict.');
      }
      return structuredClone(existing.event) as Event;
    }
    this.events.push({ event: storedEvent, idempotencyKey, workspaceId });
    return structuredClone(storedEvent);
  }

  list(workspaceId?: string): readonly ObservabilityEvent[] {
    return this.events
      .filter((stored) => !workspaceId || stored.workspaceId === workspaceId)
      .map((stored) => structuredClone(stored.event));
  }
}
