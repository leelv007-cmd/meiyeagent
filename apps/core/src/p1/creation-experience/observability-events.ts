import type { ObservabilityEvent } from '@meiye/contracts';

interface HarnessAuditWriter {
  appendAudit(event: {
    workspaceId: string;
    id: string;
    workflowId: string;
    stage: string;
    eventType: string;
    payload: unknown;
  }): Promise<void>;
}

export interface ObservabilityEventAuditPort {
  append(
    workspaceId: string,
    event: ObservabilityEvent,
    idempotencyKey: string,
  ): Promise<ObservabilityEvent> | ObservabilityEvent;
}

export class HarnessObservabilityEventAudit
  implements ObservabilityEventAuditPort
{
  constructor(private readonly auditWriter: HarnessAuditWriter) {}

  async append(
    workspaceId: string,
    event: ObservabilityEvent,
    idempotencyKey: string,
  ): Promise<ObservabilityEvent> {
    await this.auditWriter.appendAudit({
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

  append(
    workspaceId: string,
    event: ObservabilityEvent,
    idempotencyKey: string,
  ): ObservabilityEvent {
    const frozen = Object.freeze(structuredClone(event));
    this.events.push({ event: frozen, idempotencyKey, workspaceId });
    return frozen;
  }

  list(workspaceId?: string): readonly ObservabilityEvent[] {
    return this.events
      .filter((stored) => !workspaceId || stored.workspaceId === workspaceId)
      .map((stored) => stored.event);
  }
}
