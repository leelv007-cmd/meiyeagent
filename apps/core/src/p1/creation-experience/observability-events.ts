import {
  observabilityAxisBindingSchema,
  observabilityEventSchema,
  type ObservabilityAxisBinding,
  type ObservabilityEvent,
} from '@meiye/contracts';
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

function taskRootClaim(event: ObservabilityEvent) {
  if (
    event.eventType !== 'agent_primitive.lifecycle' ||
    event.axisScope !== 'task_root' ||
    event.payload.primitiveId !== 'harness-assembly:event_persistence'
  ) {
    return;
  }
  const { idempotencyKey: _idempotencyKey, ...claim } = event;
  return claim;
}

export interface ObservabilityEventAuditPort {
  append<Event extends ObservabilityEvent>(
    workspaceId: string,
    event: Event,
    idempotencyKey: string,
  ): Promise<Event> | Event;
}

export interface TaskObservabilityContextPort {
  readTaskRootAxes(
    workspaceId: string,
    taskId: string,
  ): Promise<ObservabilityAxisBinding | null>;
  deliveryBelongsToTask(
    workspaceId: string,
    taskId: string,
    delivery: {
      packageId: string;
      versionId: string;
      revision: number;
    },
  ): Promise<boolean>;
}

export function childObservabilityEnvelope(
  binding: ObservabilityAxisBinding,
) {
  const parsed = observabilityAxisBindingSchema.parse(binding);
  const value = (
    axis:
      | ObservabilityAxisBinding['skillRevision']
      | ObservabilityAxisBinding['promptVersion']
      | ObservabilityAxisBinding['catalogRevision']
      | ObservabilityAxisBinding['scene'],
  ) => (axis.kind === 'bound' ? axis.value : null);
  return {
    axisScope: 'execution_child' as const,
    skillRevision: value(parsed.skillRevision),
    promptVersion: value(parsed.promptVersion),
    catalogRevision: value(parsed.catalogRevision),
    scene: value(parsed.scene),
  };
}

export function canonicalObservabilityEvent(input: {
  taskId: string;
  binding: ObservabilityAxisBinding;
  eventType: Exclude<
    ObservabilityEvent['eventType'],
    'agent_primitive.lifecycle'
  >;
  payload: unknown;
}): ObservabilityEvent {
  return observabilityEventSchema.parse({
    eventType: input.eventType,
    taskId: input.taskId,
    ...childObservabilityEnvelope(input.binding),
    payload: input.payload,
  });
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
  private readonly taskRootClaims = new Map<string, unknown>();

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
    const rootClaim = taskRootClaim(storedEvent);
    if (rootClaim) {
      const claimKey = `${workspaceId}\u0000${event.taskId}`;
      const existingClaim = this.taskRootClaims.get(claimKey);
      if (existingClaim && !isDeepStrictEqual(existingClaim, rootClaim)) {
        throw new Error('Task root observability conflict.');
      }
      if (existingClaim) return structuredClone(storedEvent);
      this.taskRootClaims.set(claimKey, structuredClone(rootClaim));
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
