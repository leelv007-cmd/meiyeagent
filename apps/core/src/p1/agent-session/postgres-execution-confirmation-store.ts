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
import { PostgresProductBillingRepository } from '../product-billing/postgres-repository.js';
import {
  ExecutionConfirmationError,
  parseConfirmationDecision,
  parseConfirmationRequest,
  type ConfirmationRequestProjectionFacts,
  type ConfirmationTransactionClient,
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
        predecessor_request_id text NULL,
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
      ALTER TABLE p1_execution_confirmation_requests
        ADD COLUMN IF NOT EXISTS predecessor_request_id text NULL;
      UPDATE p1_execution_confirmation_requests
         SET predecessor_request_id = payload->>'predecessorRequestId'
       WHERE predecessor_request_id IS NULL
         AND payload ? 'predecessorRequestId';
      CREATE UNIQUE INDEX IF NOT EXISTS p1_execution_confirmation_requests_predecessor_uidx
        ON p1_execution_confirmation_requests (predecessor_request_id)
        WHERE predecessor_request_id IS NOT NULL;
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
    let inserted;
    try {
      inserted = await client.query<RequestRow>(
        `INSERT INTO p1_execution_confirmation_requests (
         request_id, workspace_id, plan_id, plan_revision, status,
         reservation_idempotency_key, hold_expires_at,
         campaign_plan_id, work_ordinal, predecessor_request_id,
         payload, projection, created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9, $10,
         $11::jsonb, $12::jsonb, $13::timestamptz
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
          request.predecessorRequestId ?? null,
          JSON.stringify(request),
          JSON.stringify(input.projection),
          request.createdAt,
        ],
      );
    } catch (error) {
      const databaseError = error as { code?: unknown; constraint?: unknown };
      if (
        databaseError.code === '23505' &&
        databaseError.constraint ===
          'p1_execution_confirmation_requests_predecessor_uidx'
      ) {
        throw new ExecutionConfirmationError(
          'IDEMPOTENCY_CONFLICT',
          `Confirmation predecessor ${request.predecessorRequestId} already has a successor.`,
        );
      }
      throw error;
    }
    if (inserted.rows[0]) {
      return parseStored(inserted.rows[0]);
    }
    const existing = await this.getByIdWithClient(client, request.requestId);
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
    return this.getByIdWithClient(this.pool, requestId);
  }

  async getByIdWithClient(
    client: Queryable,
    requestId: string,
  ): Promise<StoredConfirmationRequest | null> {
    const result = await client.query<RequestRow>(
      `SELECT request_id, workspace_id, payload, projection, status,
              campaign_plan_id, work_ordinal
         FROM p1_execution_confirmation_requests
        WHERE request_id = $1`,
      [requestId],
    );
    return result.rows[0] ? parseStored(result.rows[0]) : null;
  }

  async getByWorkspaceId(
    workspaceId: string,
    requestId: string,
  ): Promise<StoredConfirmationRequest | null> {
    return this.getByWorkspaceIdWithClient(
      this.pool,
      workspaceId,
      requestId,
    );
  }

  async getByWorkspaceIdWithClient(
    client: Queryable,
    workspaceId: string,
    requestId: string,
    forUpdate = false,
  ): Promise<StoredConfirmationRequest | null> {
    const result = await client.query<RequestRow>(
      `SELECT request_id, workspace_id, payload, projection, status,
              campaign_plan_id, work_ordinal
         FROM p1_execution_confirmation_requests
        WHERE workspace_id = $1 AND request_id = $2
        ${forUpdate ? 'FOR UPDATE' : ''}`,
      [workspaceId, requestId],
    );
    return result.rows[0] ? parseStored(result.rows[0]) : null;
  }

  async findSuccessorByPredecessorWithClient(
    client: Queryable,
    predecessorRequestId: string,
  ): Promise<StoredConfirmationRequest | null> {
    const result = await client.query<RequestRow>(
      `SELECT request_id, workspace_id, payload, projection, status,
              campaign_plan_id, work_ordinal
         FROM p1_execution_confirmation_requests
        WHERE predecessor_request_id = $1`,
      [predecessorRequestId],
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
    return this.markStatusForWorkspaceWithClient(this.pool, {
      ...input,
      workspaceId: existing.request.workspaceId,
    });
  }

  async markStatusForWorkspaceWithClient(
    client: Queryable,
    input: {
      workspaceId: string;
      requestId: string;
      status: 'decided' | 'expired';
      expectedStatus?: 'pending';
    },
  ): Promise<StoredConfirmationRequest | null> {
    const existing = await this.getByWorkspaceIdWithClient(
      client,
      input.workspaceId,
      input.requestId,
      true,
    );
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
    const updated = await client.query<RequestRow>(
      `UPDATE p1_execution_confirmation_requests
          SET status = $2, payload = $3::jsonb
        WHERE request_id = $1 AND workspace_id = $4 AND status = 'pending'
        RETURNING request_id, workspace_id, payload, projection, status,
                  campaign_plan_id, work_ordinal`,
      [
        input.requestId,
        input.status,
        JSON.stringify(nextRequest),
        input.workspaceId,
      ],
    );
    if (!updated.rows[0]) {
      const again = await this.getByWorkspaceIdWithClient(
        client,
        input.workspaceId,
        input.requestId,
      );
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
    return this.findCampaignWorkWithClient(this.pool, input);
  }

  async findCampaignWorkWithClient(
    client: Queryable,
    input: {
      workspaceId: string;
      campaignPlanId: string;
      workOrdinal: number;
    },
  ): Promise<StoredConfirmationRequest | null> {
    const result = await client.query<RequestRow>(
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

  async listDuePending(
    now: string,
    limit = 100,
  ): Promise<StoredConfirmationRequest[]> {
    const result = await this.pool.query<RequestRow>(
      `SELECT request_id, workspace_id, payload, projection, status,
              campaign_plan_id, work_ordinal
         FROM p1_execution_confirmation_requests
        WHERE status = 'pending' AND hold_expires_at <= $1::timestamptz
        ORDER BY hold_expires_at, created_at
        LIMIT $2`,
      [now, Math.max(1, Math.min(limit, 500))],
    );
    return result.rows.map(parseStored);
  }

  async listUnreconciledDecided(limit = 100) {
    const result = await this.pool.query<RequestRow>(
      `SELECT request.request_id, request.workspace_id, request.payload,
              request.projection, request.status, request.campaign_plan_id,
              request.work_ordinal
         FROM p1_execution_confirmation_requests request
        WHERE request.status = 'decided'
          AND NOT EXISTS (
            SELECT 1
              FROM p1_plan_confirmation_decisions decision
             WHERE decision.request_id = request.request_id
          )
        ORDER BY request.created_at
        LIMIT $1`,
      [Math.max(1, Math.min(limit, 500))],
    );
    return result.rows.map(parseStored);
  }

  savePendingInTransaction(
    client: ConfirmationTransactionClient,
    input: StoredConfirmationRequest,
  ) {
    return this.savePendingWithClient(requireClient(client), input);
  }

  getByIdInTransaction(
    client: ConfirmationTransactionClient,
    requestId: string,
  ) {
    return this.getByIdWithClient(requireClient(client), requestId);
  }

  getOwnedInTransaction(
    client: ConfirmationTransactionClient,
    workspaceId: string,
    requestId: string,
    forUpdate = false,
  ) {
    return this.getByWorkspaceIdWithClient(
      requireClient(client),
      workspaceId,
      requestId,
      forUpdate,
    );
  }

  findSuccessorByPredecessorInTransaction(
    client: ConfirmationTransactionClient,
    predecessorRequestId: string,
  ) {
    return this.findSuccessorByPredecessorWithClient(
      requireClient(client),
      predecessorRequestId,
    );
  }

  markOwnedStatusInTransaction(
    client: ConfirmationTransactionClient,
    input: Parameters<ExecutionConfirmationRequestStore['markOwnedStatusInTransaction']>[1],
  ) {
    return this.markStatusForWorkspaceWithClient(requireClient(client), input);
  }

  async restoreOwnedPendingInTransaction(
    client: ConfirmationTransactionClient,
    input: { workspaceId: string; requestId: string },
  ) {
    const result = await requireClient(client).query<RequestRow>(
      `UPDATE p1_execution_confirmation_requests
          SET status = 'pending',
              payload = jsonb_set(payload, '{status}', '"pending"'::jsonb, true)
        WHERE workspace_id = $1 AND request_id = $2 AND status = 'decided'
        RETURNING request_id, workspace_id, payload, projection, status,
                  campaign_plan_id, work_ordinal`,
      [input.workspaceId, input.requestId],
    );
    return result.rows[0] ? parseStored(result.rows[0]) : null;
  }

  findCampaignWorkInTransaction(
    client: ConfirmationTransactionClient,
    input: Parameters<ExecutionConfirmationRequestStore['findCampaignWorkInTransaction']>[1],
  ) {
    return this.findCampaignWorkWithClient(requireClient(client), input);
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
    return this.appendWithClient(this.pool, decision);
  }

  async appendWithClient(
    client: Queryable,
    decision: PlanConfirmationDecision,
  ): Promise<PlanConfirmationDecision> {
    const parsed = parseConfirmationDecision(decision);
    const inserted = await client.query<DecisionRow>(
      `INSERT INTO p1_plan_confirmation_decisions (
         decision_id, request_id, actor_id, decision, decided_at, payload
       ) VALUES ($1, $2, $3, $4, $5::timestamptz, $6::jsonb)
       ON CONFLICT DO NOTHING
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
    const byId = await this.getByIdWithClient(client, parsed.decisionId);
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
    const byRequest = await this.getByRequestIdWithClient(
      client,
      parsed.requestId,
    );
    if (byRequest && isDeepStrictEqual(byRequest, parsed)) {
      return byRequest;
    }
    throw new ExecutionConfirmationError(
      'DECISION_IMMUTABLE',
      `Request ${parsed.requestId} already has an immutable decision.`,
    );
  }

  async getById(decisionId: string): Promise<PlanConfirmationDecision | null> {
    return this.getByIdWithClient(this.pool, decisionId);
  }

  async getByIdWithClient(
    client: Queryable,
    decisionId: string,
  ): Promise<PlanConfirmationDecision | null> {
    const result = await client.query<DecisionRow>(
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
    return this.getByRequestIdWithClient(this.pool, requestId);
  }

  private async getByRequestIdWithClient(
    client: Queryable,
    requestId: string,
  ): Promise<PlanConfirmationDecision | null> {
    const result = await client.query<DecisionRow>(
      `SELECT decision_id, request_id, payload
         FROM p1_plan_confirmation_decisions
        WHERE request_id = $1`,
      [requestId],
    );
    return result.rows[0]
      ? parseConfirmationDecision(result.rows[0].payload)
      : null;
  }

  appendInTransaction(
    client: ConfirmationTransactionClient,
    decision: PlanConfirmationDecision,
  ) {
    return this.appendWithClient(requireClient(client), decision);
  }

  getByIdInTransaction(
    client: ConfirmationTransactionClient,
    decisionId: string,
  ) {
    return this.getByIdWithClient(requireClient(client), decisionId);
  }

  getByRequestIdInTransaction(
    client: ConfirmationTransactionClient,
    requestId: string,
  ) {
    return this.getByRequestIdWithClient(requireClient(client), requestId);
  }
}

function requireClient(client: ConfirmationTransactionClient): PoolClient {
  if (!client) {
    throw new Error('Postgres confirmation transactions require a database client.');
  }
  return client;
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
type CreditProjection = import('../credit-billing/credit-ledger.js').CreditBalanceProjection;
type CreditTransaction = import('../credit-billing/credit-ledger.js').CreditLotTransaction;
type CreditConsumeInput = Parameters<
  import('../credit-billing/postgres-credit-ledger.js').PostgresCreditLedger['consume']
>[0];
type CreditRefundInput = Parameters<
  import('../credit-billing/postgres-credit-ledger.js').PostgresCreditLedger['refundUsageOperation']
>[0];

export interface PostgresConfirmationCreditLedger {
  withWorkspaceCreditLock<T>(
    workspaceId: string,
    action: (client: PoolClient) => Promise<T>,
  ): Promise<T>;
  projectWithClient(
    client: PoolClient,
    workspaceId: string,
    asOf?: string,
  ): Promise<CreditProjection>;
  consumeWithClient(
    client: PoolClient,
    input: CreditConsumeInput,
  ): Promise<readonly CreditTransaction[]>;
  refundUsageOperationWithClient(
    client: PoolClient,
    input: CreditRefundInput,
  ): Promise<readonly CreditTransaction[]>;
}

export interface PostgresProductReservationReplacementPort {
  replace(
    client: PoolClient,
    input: {
      workspaceId: string;
      taskId: string;
      quoteRef: { id: string; revision: number | string };
      predecessorCredits: number;
      successorCredits: number;
      updatedAt: string;
    },
  ): Promise<void>;
}

export class PostgresProductReservationReplacement
  implements PostgresProductReservationReplacementPort
{
  constructor(private readonly pool: Pool) {}

  async replace(
    client: PoolClient,
    input: Parameters<PostgresProductReservationReplacementPort['replace']>[1],
  ): Promise<void> {
    for (const lockKey of [
      `quote:${input.quoteRef.id}`,
      `task:${input.taskId}`,
    ].sort()) {
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
        [input.workspaceId, lockKey],
      );
    }
    const repository = new PostgresProductBillingRepository(this.pool, client);
    const quote = await repository.getQuote(
      input.workspaceId,
      input.quoteRef.id,
    );
    const usage = await repository.getUsage(input.workspaceId, input.taskId);
    if (
      !quote ||
      quote.taskId !== input.taskId ||
      String(quote.revision) !== String(input.quoteRef.revision) ||
      quote.creditCost !== input.successorCredits ||
      (quote.lifecycleStatus !== 'reserved' &&
        quote.lifecycleStatus !== 'confirmed') ||
      !usage ||
      usage.status !== 'reserved' ||
      usage.quoteId !== quote.quoteId ||
      usage.reservedCredits !== input.predecessorCredits
    ) {
      throw new Error(
        `Product reservation for task ${input.taskId} does not match the repriced confirmation authority.`,
      );
    }
    await repository.saveUsage(input.workspaceId, {
      ...usage,
      reservedCredits: input.successorCredits,
      updatedAt: input.updatedAt,
    });
  }
}

export function confirmationCreditPortFromPostgresLedger(
  ledger: PostgresConfirmationCreditLedger,
  productReservations?: PostgresProductReservationReplacementPort,
): import('./execution-confirmation-service.js').ConfirmationCreditLedgerPort {
  if (
    typeof ledger.withWorkspaceCreditLock !== 'function' ||
    typeof ledger.projectWithClient !== 'function' ||
    typeof ledger.consumeWithClient !== 'function' ||
    typeof ledger.refundUsageOperationWithClient !== 'function'
  ) {
    throw new Error(
      'Confirmation credit transactions require projectWithClient, consumeWithClient and refundUsageOperationWithClient.',
    );
  }
  const lock = ledger.withWorkspaceCreditLock.bind(ledger);
  const projectWithClient = ledger.projectWithClient.bind(ledger);
  const consumeWithClient = ledger.consumeWithClient.bind(ledger);
  const refundWithClient = ledger.refundUsageOperationWithClient.bind(ledger);
  return {
    withWorkspaceCreditTransaction: async (workspaceId, action) =>
      lock(workspaceId, async (client) => {
        const txLedger: import('./execution-confirmation-service.js').ConfirmationCreditTransactionPort = {
          project: (ws, asOf) => projectWithClient(client, ws, asOf),
          transactionClient: client,
          consume: (input) => consumeWithClient(client, input),
          refundUsageOperation: (input) => refundWithClient(client, input),
          ...(productReservations
            ? {
                replaceProductReservation: (input) =>
                  productReservations.replace(client, input),
              }
            : {}),
        };
        return action(txLedger);
      }),
  };
}

/**
 * Adapts an already-open creation-submission transaction for confirmation.
 * It deliberately does not open or commit a nested transaction: callers own
 * the atomic boundary that includes successor shells and task admission.
 */
export function confirmationCreditTransactionFromPostgresClient(
  ledger: Pick<
    PostgresConfirmationCreditLedger,
    'projectWithClient' | 'consumeWithClient' | 'refundUsageOperationWithClient'
  >,
  client: PoolClient,
  productReservations?: PostgresProductReservationReplacementPort,
): import('./execution-confirmation-service.js').ConfirmationCreditTransactionPort {
  if (
    typeof ledger.projectWithClient !== 'function' ||
    typeof ledger.consumeWithClient !== 'function' ||
    typeof ledger.refundUsageOperationWithClient !== 'function'
  ) {
    throw new Error(
      'Confirmation transaction requires projectWithClient, consumeWithClient and refundUsageOperationWithClient.',
    );
  }
  return {
    project: (workspaceId, asOf) => ledger.projectWithClient(client, workspaceId, asOf),
    transactionClient: client,
    consume: (input) => ledger.consumeWithClient(client, input),
    refundUsageOperation: (input) => ledger.refundUsageOperationWithClient(client, input),
    ...(productReservations
      ? { replaceProductReservation: (input) => productReservations.replace(client, input) }
      : {}),
  };
}

// Keep type import live for store payload documentation.
void (null as unknown as AgentExecutionConfirmationRequest);
