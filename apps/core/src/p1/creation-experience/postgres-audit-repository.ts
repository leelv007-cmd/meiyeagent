import { isDeepStrictEqual } from 'node:util';

import type { BriefConfirmation, CreationExperienceEvent } from '@meiye/contracts';
import type { Pool, PoolClient } from 'pg';

import { P1DomainError } from '../foundation/domain.js';
import type { BriefConfirmationRepository } from './brief-confirmation-repository.js';
import {
  buildCreationExperienceEvent,
  type CreationExperienceEventAuditPort,
  type RecordCreationExperienceEventInput,
} from './creation-experience-events.js';

type EventRow = { payload: CreationExperienceEvent };
type ConfirmationRow = { payload: BriefConfirmation };

export class PostgresCreationExperienceAuditRepository
  implements CreationExperienceEventAuditPort, BriefConfirmationRepository
{
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient): Promise<void> {
    await (client ?? this.pool).query(`
      CREATE TABLE IF NOT EXISTS p1_creation_experience_events (
        workspace_id text NOT NULL,
        event_id text NOT NULL,
        kind text NOT NULL CHECK (
          kind IN ('exposure', 'select', 'apply', 'start', 'complete', 'correct', 'cancel')
        ),
        payload jsonb NOT NULL,
        recorded_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, event_id)
      );
      CREATE INDEX IF NOT EXISTS p1_creation_experience_events_order_idx
        ON p1_creation_experience_events (workspace_id, recorded_at ASC, event_id);

      CREATE TABLE IF NOT EXISTS p1_creation_brief_confirmations (
        workspace_id text NOT NULL,
        confirmation_id text NOT NULL,
        payload jsonb NOT NULL,
        confirmed_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, confirmation_id)
      );
    `);
  }

  async append(
    workspaceId: string,
    input: RecordCreationExperienceEventInput,
  ): Promise<CreationExperienceEvent> {
    const event = buildCreationExperienceEvent(input);
    const inserted = await this.pool.query<EventRow>(
      `INSERT INTO p1_creation_experience_events
         (workspace_id, event_id, kind, payload, recorded_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)
       ON CONFLICT (workspace_id, event_id) DO NOTHING
       RETURNING payload`,
      [
        workspaceId,
        event.eventId,
        event.kind,
        JSON.stringify(event),
        event.recordedAt,
      ],
    );
    if (inserted.rows[0]) return structuredClone(inserted.rows[0].payload);
    const existing = await this.getEvent(workspaceId, event.eventId);
    if (existing && isDeepStrictEqual(existing, event)) return existing;
    throw new P1DomainError(
      'IDEMPOTENCY_CONFLICT',
      'Creation experience event id is already bound to another payload.',
    );
  }

  async list(workspaceId: string): Promise<CreationExperienceEvent[]> {
    const result = await this.pool.query<EventRow>(
      `SELECT payload
         FROM p1_creation_experience_events
        WHERE workspace_id = $1
        ORDER BY recorded_at ASC, event_id ASC`,
      [workspaceId],
    );
    return result.rows.map((row) => structuredClone(row.payload));
  }

  async putBriefConfirmation(
    workspaceId: string,
    confirmationId: string,
    confirmation: BriefConfirmation,
  ): Promise<BriefConfirmation> {
    const inserted = await this.pool.query<ConfirmationRow>(
      `INSERT INTO p1_creation_brief_confirmations
         (workspace_id, confirmation_id, payload, confirmed_at)
       VALUES ($1, $2, $3::jsonb, $4::timestamptz)
       ON CONFLICT (workspace_id, confirmation_id) DO NOTHING
       RETURNING payload`,
      [
        workspaceId,
        confirmationId,
        JSON.stringify(confirmation),
        confirmation.confirmedAt,
      ],
    );
    if (inserted.rows[0]) return structuredClone(inserted.rows[0].payload);
    const existing = await this.getBriefConfirmation(
      workspaceId,
      confirmationId,
    );
    if (existing && isDeepStrictEqual(existing, confirmation)) return existing;
    throw new P1DomainError(
      'IDEMPOTENCY_CONFLICT',
      'Brief confirmation id is already bound to another revision snapshot.',
    );
  }

  async getBriefConfirmation(
    workspaceId: string,
    confirmationId: string,
  ): Promise<BriefConfirmation | null> {
    const result = await this.pool.query<ConfirmationRow>(
      `SELECT payload
         FROM p1_creation_brief_confirmations
        WHERE workspace_id = $1 AND confirmation_id = $2`,
      [workspaceId, confirmationId],
    );
    return result.rows[0] ? structuredClone(result.rows[0].payload) : null;
  }

  private async getEvent(
    workspaceId: string,
    eventId: string,
  ): Promise<CreationExperienceEvent | null> {
    const result = await this.pool.query<EventRow>(
      `SELECT payload
         FROM p1_creation_experience_events
        WHERE workspace_id = $1 AND event_id = $2`,
      [workspaceId, eventId],
    );
    return result.rows[0] ? structuredClone(result.rows[0].payload) : null;
  }
}
