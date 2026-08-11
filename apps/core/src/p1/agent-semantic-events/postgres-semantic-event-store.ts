/**
 * PostgreSQL AgentSemanticEventStore: p1_agent_semantic_events (V3.1 §33.1).
 *
 * Payload jsonb is the serialization authority; mirrored columns exist for
 * ordering, uniqueness, and resource isolation. Ephemeral frames have no table.
 */

import type { Pool, PoolClient } from 'pg';

import {
  agentSemanticEventFromWire,
  agentSemanticEventWireSchema,
  type AgentSemanticEvent,
} from '@meiye/contracts';

import type { PostgresSchemaMigrator } from '../../postgres-schema-migration.js';
import {
  AgentSemanticEventStoreError,
  assertProjectedReplayMatches,
  buildProjectedEvent,
  type AgentSemanticEventStore,
  type ListSemanticEventsInput,
  type ProjectedSemanticEvent,
  type SemanticEventCandidate,
} from './semantic-event-store.js';

type PayloadRow = { payload: unknown };

type Queryable = Pick<Pool, 'query'>;

export class PostgresAgentSemanticEventStore
  implements AgentSemanticEventStore, PostgresSchemaMigrator
{
  /** Incremented only on successful new inserts (constructive probe). */
  writeCount = 0;

  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient) {
    const db: Queryable = client ?? this.pool;
    await db.query(`
      CREATE TABLE IF NOT EXISTS p1_agent_semantic_events (
        event_id text PRIMARY KEY,
        thread_id text NOT NULL,
        resource_id text NOT NULL,
        stream_offset bigint NOT NULL CHECK (stream_offset > 0),
        context_role text NOT NULL CHECK (
          context_role IN ('included', 'excluded', 'summarized')
        ),
        event_type text NOT NULL,
        payload jsonb NOT NULL,
        occurred_at timestamptz NOT NULL,
        CONSTRAINT p1_agent_semantic_events_thread_offset_key
          UNIQUE (thread_id, stream_offset)
      )
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS p1_agent_semantic_events_thread_idx
        ON p1_agent_semantic_events (resource_id, thread_id, stream_offset)
    `);
  }

  async appendProjected(
    candidate: SemanticEventCandidate,
  ): Promise<ProjectedSemanticEvent> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Event IDs are idempotency identities. Serialize the check+insert
      // across concurrent workflow and sweeper resolution paths before either
      // one allocates a stream offset.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        candidate.eventId,
      ]);

      const existing = await client.query<PayloadRow>(
        `SELECT payload
           FROM p1_agent_semantic_events
          WHERE event_id = $1
          FOR UPDATE`,
        [candidate.eventId],
      );
      if (existing.rows[0]) {
        const event = parseStoredEvent(existing.rows[0].payload);
        if (
          event.threadId !== candidate.threadId ||
          (await this.resourceOf(client, candidate.eventId)) !==
            candidate.resourceId
        ) {
          await client.query('ROLLBACK');
          throw new AgentSemanticEventStoreError(
            'AGENT_SEMANTIC_EVENT_CONFLICT',
            `Semantic event ${candidate.eventId} already projected under another boundary.`,
            {
              eventId: candidate.eventId,
              threadId: candidate.threadId,
              resourceId: candidate.resourceId,
            },
          );
        }
        assertProjectedReplayMatches(event, candidate);
        await client.query('COMMIT');
        return { event, replayed: true };
      }

      // Serialize offset allocation per thread (sole streamOffset writer path).
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        candidate.threadId,
      ]);
      const max = await client.query<{ max: string | null }>(
        `SELECT MAX(stream_offset)::text AS max
           FROM p1_agent_semantic_events
          WHERE thread_id = $1`,
        [candidate.threadId],
      );
      const nextOffset =
        max.rows[0]?.max === null || max.rows[0]?.max === undefined
          ? 1n
          : BigInt(max.rows[0].max) + 1n;
      const event = buildProjectedEvent(candidate, nextOffset);

      await client.query(
        `INSERT INTO p1_agent_semantic_events
           (event_id, thread_id, resource_id, stream_offset, context_role,
            event_type, payload, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz)`,
        [
          event.eventId,
          event.threadId,
          candidate.resourceId,
          event.streamOffset.toString(),
          event.contextRole,
          event.eventType,
          JSON.stringify(serializeEvent(event)),
          event.occurredAt,
        ],
      );
      await client.query('COMMIT');
      this.writeCount += 1;
      return { event, replayed: false };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async getByEventId(input: {
    resourceId: string;
    eventId: string;
  }): Promise<AgentSemanticEvent | null> {
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload
         FROM p1_agent_semantic_events
        WHERE event_id = $1
          AND resource_id = $2`,
      [input.eventId, input.resourceId],
    );
    const row = result.rows[0];
    return row ? parseStoredEvent(row.payload) : null;
  }

  async listByThread(
    input: ListSemanticEventsInput,
  ): Promise<AgentSemanticEvent[]> {
    let afterOffset: bigint | undefined = input.afterStreamOffset;
    if (input.afterEventId) {
      const cursor = await this.pool.query<{ stream_offset: string }>(
        `SELECT stream_offset::text AS stream_offset
           FROM p1_agent_semantic_events
          WHERE event_id = $1
            AND resource_id = $2
            AND thread_id = $3`,
        [input.afterEventId, input.resourceId, input.threadId],
      );
      if (cursor.rows[0]) {
        afterOffset = BigInt(cursor.rows[0].stream_offset);
      }
    }

    const result =
      afterOffset === undefined
        ? await this.pool.query<PayloadRow>(
            `SELECT payload
               FROM p1_agent_semantic_events
              WHERE resource_id = $1
                AND thread_id = $2
              ORDER BY stream_offset ASC`,
            [input.resourceId, input.threadId],
          )
        : await this.pool.query<PayloadRow>(
            `SELECT payload
               FROM p1_agent_semantic_events
              WHERE resource_id = $1
                AND thread_id = $2
                AND stream_offset > $3
              ORDER BY stream_offset ASC`,
            [input.resourceId, input.threadId, afterOffset.toString()],
          );

    return result.rows.map((row) => parseStoredEvent(row.payload));
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
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload
         FROM p1_agent_semantic_events
        WHERE resource_id = $1
          AND thread_id = $2
        ORDER BY stream_offset DESC
        LIMIT 1`,
      [input.resourceId, input.threadId],
    );
    const row = result.rows[0];
    return row ? parseStoredEvent(row.payload) : null;
  }

  private async resourceOf(
    client: PoolClient,
    eventId: string,
  ): Promise<string | null> {
    const result = await client.query<{ resource_id: string }>(
      `SELECT resource_id FROM p1_agent_semantic_events WHERE event_id = $1`,
      [eventId],
    );
    return result.rows[0]?.resource_id ?? null;
  }
}

/** JSON cannot carry bigint; store streamOffset as decimal string in payload. */
function serializeEvent(event: AgentSemanticEvent): Record<string, unknown> {
  return {
    ...event,
    streamOffset: event.streamOffset.toString(),
  };
}

function parseStoredEvent(payload: unknown): AgentSemanticEvent {
  return agentSemanticEventFromWire(agentSemanticEventWireSchema.parse(payload));
}
