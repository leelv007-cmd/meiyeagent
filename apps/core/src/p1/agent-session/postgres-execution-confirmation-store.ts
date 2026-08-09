/**
 * PostgreSQL stores for confirmation request + immutable decision (V31-11).
 *
 * Tables:
 * - p1_execution_confirmation_requests
 * - p1_plan_confirmation_decisions (append-only)
 */

import { isDeepStrictEqual } from 'node:util';

import type {
  AgentExecutionConfirmationRequest,
  PlanConfirmationDecision,
} from '@meiye/contracts';
import type { Pool, PoolClient } from 'pg';

import type { PostgresSchemaMigrator } from '../../postgres-schema-migration.js';
import {
  ExecutionConfirmationError,
  parseConfirmationDecision,
  parseConfirmationRequest,
  type ConfirmationRequestProjectionFacts,
  type ExecutionConfirmationRequestStore,
  type PlanConfirmationDecisionStore,
  type StoredConfirmationRequest,
} from './execution-confirmation-store.js';

type RequestRow = {
  request_id: string;
  workspace_id: string;
  payload: unknown;
  projection: unknown;
  status: string;
  campaign_plan_id: string | null;
  work_ordinal: string | number | null;
};

type DecisionRow = {
  decision_id: string;
  request_id: string;
  payload: unknown;
};

type Queryable = Pick<Pool, 'query'>;

function parseStored(row: RequestRow): StoredConfirmationRequest {
  return {
    request: parseConfirmationRequest(row.payload),
    projection: row.projection as ConfirmationRequestProjectionFacts,
  };
}

export class PostgresExecutionConfirmationRequestStore
  implements ExecutionConfirmationRequestStore, PostgresSchemaMigrator
{
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient): Promise<void> {
    const db: Queryable = client ?? this.pool;
    await db.query(`
      CREATE TABLE IF NOT EXISTS p1_execution_confirmation_requests (
        request_id text PRIMARY KEY,
        workspace_id text NOT NULL,
        plan_id text NOT NULL,
        plan_revision bigint NOT NULL,
        status text NOT NULL CHECK (status IN ('pending', 'decided', 'expired')),
        reservation_idempotency_key text NOT NULL,
        hold_expires_at timestamptz NOT NULL,
        campaign_plan_id text NULL,
        work_ordinal bigint NULL,
        payload jsonb NOT NULL,
        projection jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        UNIQUE (reservation_idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS p1_execution_confirmation_requests_ws_status_idx
        ON p1_execution_confirmation_requests (workspace_id, status);
      CREATE INDEX IF NOT EXISTS p1_execution_confirmation_requests_campaign_idx
        ON p1_execution_confirmation_requests (
          workspace_id, campaign_plan_id, work_ordinal
        )
        WHERE campaign_plan_id IS NOT NULL;
    `);
  }

  async savePending(
    input: StoredConfirmationRequest,
  ): Promise<StoredConfirmationRequest> {
    return this.savePendingWithClient(this.pool, input);
  }

  /**
   * P1-b: insert the pending request row on the caller-provided connection so
   * it joins the same DB transaction as balance check + reservation + FEFO
   * deduction (withWorkspaceCreditTransaction). Keeps ON CONFLICT
   * (request_id) DO NOTHING idempotency.
   */
  async savePendingWithClient(
    client: Queryable,
    input: StoredConfirmationRequest,
  ): Promise<StoredConfirmationRequest> {
    const request = parseConfirmationRequest(input.request);
    if (request.status !== 'pending') {
      throw new ExecutionConfirmationError(
        'INVALID_STATE',
        'Only pending confirmation requests may be created.',
      );
    }
    const inserted = await client.query<RequestRow>(
      `INSERT INTO p1_execution_confirmation_requests (
         request_id, workspace_id, plan_id, plan_revision, status,
         reservation_idempotency_key, hold_expires_at,
         campaign_plan_id, work_ordinal, payload, projection, created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9, $10::jsonb, $11::jsonb, $12::timestamptz
       )
       ON CONFLICT (request_id) DO NOTHING
       RETURNING request_id, workspace_id, payload, projection, status,
                 campaign_plan_id, work_ordinal`,
      [
        request.requestId,
        request.workspaceId,
        request.planId,
        request.planRevision,
        request.status,
        request.reservationIdempotencyKey,
        request.holdExpiresAt,
        request.campaignPlanRef?.id ?? null,
        request.workOrdinal ?? null,
        JSON.stringify(request),
        JSON.stringify(input.projection),
        request.createdAt,
      ],
    );
    if (inserted.rows[0]) {
      return parseStored(inserted.rows[0]);
    }
    const existing = await this.getById(request.requestId);
    if (
      existing &&
      isDeepStrictEqual(existing.request, request) &&
      isDeepStrictEqual(existing.projection, input.projection)
    ) {
      return existing;
    }
    throw new ExecutionConfirmationError(
      'IDEMPOTENCY_CONFLICT',
      `Confirmation request ${request.requestId} already exists with different facts.`,
    );
  }

  async getById(requestId: string): Promise<StoredConfirmationRequest | null> {
    const result = await this.pool.query<RequestRow>(
      `SELECT request_id, workspace_id, payload, projection, status,
              campaign_plan_id, work_ordinal
         FROM p1_execution_confirmation_requests
        WHERE request_id = $1`,
      [requestId],
    );
    return result.rows[0] ? parseStored(result.rows[0]) : null;
  }

  async markStatus(input: {
    requestId: string;
    status: 'decided' | 'expired';
    expectedStatus?: 'pending';
  }): Promise<StoredConfirmationRequest | null> {
    const existing = await this.getById(input.requestId);
    if (!existing) return null;
    if (
      input.expectedStatus &&
      existing.request.status !== input.expectedStatus
    ) {
      throw new ExecutionConfirmationError(
        'INVALID_STATE',
        `Confirmation request ${input.requestId} is ${existing.request.status}, expected ${input.expectedStatus}.`,
      );
    }
    if (existing.request.status === input.status) {
      return existing;
    }
    if (existing.request.status !== 'pending') {
      throw new ExecutionConfirmationError(
        'INVALID_STATE',
        `Confirmation request ${input.requestId} cannot leave ${existing.request.status}.`,
      );
    }
    const nextRequest = parseConfirmationRequest({
      ...existing.request,
      status: input.status,
    });
    const updated = await this.pool.query<RequestRow>(
      `UPDATE p1_execution_confirmation_requests
          SET status = $2, payload = $3::jsonb
        WHERE request_id = $1 AND status = 'pending'
        RETURNING request_id, workspace_id, payload, projection, status,
                  campaign_plan_id, work_ordinal`,
      [input.requestId, input.status, JSON.stringify(nextRequest)],
    );
    if (!updated.rows[0]) {
      const again = await this.getById(input.requestId);
      if (again?.request.status === input.status) return again;
      throw new ExecutionConfirmationError(
        'INVALID_STATE',
        `Confirmation request ${input.requestId} status race.`,
      );
    }
    return parseStored(updated.rows[0]);
  }

  async findCampaignWork(input: {
    workspaceId: string;
    campaignPlanId: string;
    workOrdinal: number;
  }): Promise<StoredConfirmationRequest | null> {
    const result = await this.pool.query<RequestRow>(
      `SELECT request_id, workspace_id, payload, projection, status,
              campaign_plan_id, work_ordinal
         FROM p1_execution_confirmation_requests
        WHERE workspace_id = $1
          AND campaign_plan_id = $2
          AND work_ordinal = $3
          AND (payload->>'approvalScope') = 'single_work'
        ORDER BY created_at DESC
        LIMIT 1`,
      [input.workspaceId, input.campaignPlanId, input.workOrdinal],
    );
    return result.rows[0] ? parseStored(result.rows[0]) : null;
  }

  async listPendingByWorkspace(
    workspaceId: string,
  ): Promise<StoredConfirmationRequest[]> {
    const result = await this.pool.query<RequestRow>(
      `SELECT request_id, workspace_id, payload, projection, status,
              campaign_plan_id, work_ordinal
         FROM p1_execution_confirmation_requests
        WHERE workspace_id = $1 AND status = 'pending'
        ORDER BY created_at ASC`,
      [workspaceId],
    );
    return result.rows.map(parseStored);
  }
}

export class PostgresPlanConfirmationDecisionStore
  implements PlanConfirmationDecisionStore, PostgresSchemaMigrator
{
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient): Promise<void> {
    const db: Queryable = client ?? this.pool;
    await db.query(`
      CREATE TABLE IF NOT EXISTS p1_plan_confirmation_decisions (
        decision_id text PRIMARY KEY,
        request_id text NOT NULL UNIQUE,
        actor_id text NOT NULL,
        decision text NOT NULL CHECK (decision IN ('confirmed', 'rejected')),
        decided_at timestamptz NOT NULL,
        payload jsonb NOT NULL
      );
      CREATE INDEX IF NOT EXISTS p1_plan_confirmation_decisions_request_idx
        ON p1_plan_confirmation_decisions (request_id);
    `);
  }

  async append(
    decision: PlanConfirmationDecision,
  ): Promise<PlanConfirmationDecision> {
    const parsed = parseConfirmationDecision(decision);
    const inserted = await this.pool.query<DecisionRow>(
      `INSERT INTO p1_plan_confirmation_decisions (
         decision_id, request_id, actor_id, decision, decided_at, payload
       ) VALUES ($1, $2, $3, $4, $5::timestamptz, $6::jsonb)
       ON CONFLICT (decision_id) DO NOTHING
       RETURNING decision_id, request_id, payload`,
      [
        parsed.decisionId,
        parsed.requestId,
        parsed.actorId,
        parsed.decision,
        parsed.decidedAt,
        JSON.stringify(parsed),
      ],
    );
    if (inserted.rows[0]) {
      return parseConfirmationDecision(inserted.rows[0].payload);
    }
    const byId = await this.getById(parsed.decisionId);
    if (byId && isDeepStrictEqual(byId, parsed)) {
      return byId;
    }
    if (byId) {
      throw new ExecutionConfirmationError(
        'DECISION_IMMUTABLE',
        `PlanConfirmationDecision ${parsed.decisionId} is immutable.`,
      );
    }
    // Conflict on request_id unique: another decision already recorded.
    const byRequest = await this.getByRequestId(parsed.requestId);
    if (byRequest && isDeepStrictEqual(byRequest, parsed)) {
      return byRequest;
    }
    throw new ExecutionConfirmationError(
      'DECISION_IMMUTABLE',
      `Request ${parsed.requestId} already has an immutable decision.`,
    );
  }

  async getById(decisionId: string): Promise<PlanConfirmationDecision | null> {
    const result = await this.pool.query<DecisionRow>(
      `SELECT decision_id, request_id, payload
         FROM p1_plan_confirmation_decisions
        WHERE decision_id = $1`,
      [decisionId],
    );
    return result.rows[0]
      ? parseConfirmationDecision(result.rows[0].payload)
      : null;
  }

  async getByRequestId(
    requestId: string,
  ): Promise<PlanConfirmationDecision | null> {
    const result = await this.pool.query<DecisionRow>(
      `SELECT decision_id, request_id, payload
         FROM p1_plan_confirmation_decisions
        WHERE request_id = $1`,
      [requestId],
    );
    return result.rows[0]
      ? parseConfirmationDecision(result.rows[0].payload)
      : null;
  }
}

/**
 * Combined migrator for both confirmation tables (single assembly entry).
 */
export class PostgresExecutionConfirmationMigration
  implements PostgresSchemaMigrator
{
  private readonly requests: PostgresExecutionConfirmationRequestStore;
  private readonly decisions: PostgresPlanConfirmationDecisionStore;

  constructor(pool: Pool) {
    this.requests = new PostgresExecutionConfirmationRequestStore(pool);
    this.decisions = new PostgresPlanConfirmationDecisionStore(pool);
  }

  async migrate(client?: PoolClient): Promise<void> {
    await this.requests.migrate(client);
    await this.decisions.migrate(client);
  }

  get requestStore(): PostgresExecutionConfirmationRequestStore {
    return this.requests;
  }

  get decisionStore(): PostgresPlanConfirmationDecisionStore {
    return this.decisions;
  }
}

/**
 * Postgres credit ledger adapter that runs create under one workspace lock.
 */
export function confirmationCreditPortFromPostgresLedger(
  ledger: {
    project(
      workspaceId: string,
      asOf?: string,
    ):
      | Promise<import('../credit-billing/credit-ledger.js').CreditBalanceProjection>
      | import('../credit-billing/credit-ledger.js').CreditBalanceProjection;
    consume(input: {
      workspaceId: string;
      credits: number;
      transactionId: string;
      actorId: string;
      correlationId: string;
      createdAt: string;
    }): Promise<
      readonly import('../credit-billing/credit-ledger.js').CreditLotTransaction[]
    >;
    refundUsageOperation(input: {
      workspaceId: string;
      usageOperationId: string;
      refundOperationId: string;
      actorId: string;
      correlationId: string;
      createdAt: string;
    }): Promise<
      readonly import('../credit-billing/credit-ledger.js').CreditLotTransaction[]
    >;
    withWorkspaceCreditLock?<T>(
      workspaceId: string,
      action: (client: PoolClient) => Promise<T>,
    ): Promise<T>;
    consumeWithClient?(
      client: PoolClient,
      input: {
        workspaceId: string;
        credits: number;
        transactionId: string;
        actorId: string;
        correlationId: string;
        createdAt: string;
      },
    ): Promise<
      readonly import('../credit-billing/credit-ledger.js').CreditLotTransaction[]
    >;
    refundUsageOperationWithClient?(
      client: PoolClient,
      input: {
        workspaceId: string;
        usageOperationId: string;
        refundOperationId: string;
        actorId: string;
        correlationId: string;
        createdAt: string;
      },
    ): Promise<
      readonly import('../credit-billing/credit-ledger.js').CreditLotTransaction[]
    >;
  },
): import('./execution-confirmation-service.js').ConfirmationCreditLedgerPort {
  type Port =
    import('./execution-confirmation-service.js').ConfirmationCreditLedgerPort;
  return {
    project: (workspaceId, asOf) => ledger.project(workspaceId, asOf),
    consume: (input) => ledger.consume(input),
    refundUsageOperation: (input) => ledger.refundUsageOperation(input),
    withWorkspaceCreditTransaction: ledger.withWorkspaceCreditLock
      ? async (workspaceId, action) => {
          const lock = ledger.withWorkspaceCreditLock!.bind(ledger);
          return lock(workspaceId, async (client) => {
            const txLedger: Port = {
              project: (ws, asOf) => ledger.project(ws, asOf),
              transactionClient: client,
              consume: async (input) => {
                if (!ledger.consumeWithClient) {
                  return ledger.consume(input);
                }
                return ledger.consumeWithClient(client, input);
              },
              refundUsageOperation: async (input) => {
                if (!ledger.refundUsageOperationWithClient) {
                  return ledger.refundUsageOperation(input);
                }
                return ledger.refundUsageOperationWithClient(client, input);
              },
            };
            return action(txLedger);
          });
        }
      : undefined,
  };
}

// Keep type import live for store payload documentation.
void (null as unknown as AgentExecutionConfirmationRequest);
