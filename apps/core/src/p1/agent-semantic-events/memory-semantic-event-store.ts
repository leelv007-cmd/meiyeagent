/**
 * In-memory AgentSemanticEventStore for tests and fixture runtimes (V31-03).
 */

import type { AgentSemanticEvent } from '@meiye/contracts';

import {
  buildProjectedEvent,
  type AgentSemanticEventStore,
  type ListSemanticEventsInput,
  type ProjectedSemanticEvent,
  type SemanticEventCandidate,
} from './semantic-event-store.js';

type StoredRow = {
  resourceId: string;
  event: AgentSemanticEvent;
};

export class MemoryAgentSemanticEventStore implements AgentSemanticEventStore {
  private readonly byEventId = new Map<string, StoredRow>();
  private readonly byThread = new Map<string, string[]>();
  private readonly nextOffset = new Map<string, bigint>();
  /** Observability for constructive "zero PG write" style checks in-memory. */
  writeCount = 0;

  async appendProjected(
    candidate: SemanticEventCandidate,
  ): Promise<ProjectedSemanticEvent> {
    const existing = this.byEventId.get(candidate.eventId);
    if (existing) {
      if (
        existing.resourceId !== candidate.resourceId ||
        existing.event.threadId !== candidate.threadId
      ) {
        throw new Error(
          `Semantic event ${candidate.eventId} already projected under another boundary.`,
        );
      }
      return { event: structuredClone(existing.event), replayed: true };
    }

    const offset = this.nextOffset.get(candidate.threadId) ?? 1n;
    const event = buildProjectedEvent(candidate, offset);
    this.nextOffset.set(candidate.threadId, offset + 1n);
    this.byEventId.set(candidate.eventId, {
      resourceId: candidate.resourceId,
      event,
    });
    const ids = this.byThread.get(candidate.threadId) ?? [];
    ids.push(candidate.eventId);
    this.byThread.set(candidate.threadId, ids);
    this.writeCount += 1;
    return { event: structuredClone(event), replayed: false };
  }

  async getByEventId(input: {
    resourceId: string;
    eventId: string;
  }): Promise<AgentSemanticEvent | null> {
    const row = this.byEventId.get(input.eventId);
    if (!row || row.resourceId !== input.resourceId) return null;
    return structuredClone(row.event);
  }

  async listByThread(
    input: ListSemanticEventsInput,
  ): Promise<AgentSemanticEvent[]> {
    const ids = this.byThread.get(input.threadId) ?? [];
    const events = ids
      .map((id) => this.byEventId.get(id))
      .filter((row): row is StoredRow => {
        return row !== undefined && row.resourceId === input.resourceId;
      })
      .map((row) => row.event)
      .sort((left, right) =>
        left.streamOffset < right.streamOffset
          ? -1
          : left.streamOffset > right.streamOffset
            ? 1
            : 0,
      );

    let afterOffset = input.afterStreamOffset;
    if (input.afterEventId) {
      const cursor = this.byEventId.get(input.afterEventId);
      if (
        cursor &&
        cursor.resourceId === input.resourceId &&
        cursor.event.threadId === input.threadId
      ) {
        afterOffset = cursor.event.streamOffset;
      }
    }

    const filtered =
      afterOffset === undefined
        ? events
        : events.filter((event) => event.streamOffset > afterOffset);
    return filtered.map((event) => structuredClone(event));
  }

  async latestStreamOffset(input: {
    resourceId: string;
    threadId: string;
  }): Promise<bigint | null> {
    const latest = await this.latestEvent(input);
    return latest?.streamOffset ?? null;
  }

  async latestEvent(input: {
    resourceId: string;
    threadId: string;
  }): Promise<AgentSemanticEvent | null> {
    const events = await this.listByThread({
      resourceId: input.resourceId,
      threadId: input.threadId,
    });
    return events.length === 0
      ? null
      : structuredClone(events[events.length - 1]!);
  }
}
