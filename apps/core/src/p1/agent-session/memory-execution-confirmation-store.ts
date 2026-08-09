/**
 * In-memory confirmation stores for unit tests / fixture (V31-11).
 */

import { isDeepStrictEqual } from 'node:util';

import type {
  AgentExecutionConfirmationRequest,
  PlanConfirmationDecision,
} from '@meiye/contracts';

import {
  ExecutionConfirmationError,
  parseConfirmationDecision,
  parseConfirmationRequest,
  type ExecutionConfirmationRequestStore,
  type ConfirmationTransactionClient,
  type PlanConfirmationDecisionStore,
  type StoredConfirmationRequest,
} from './execution-confirmation-store.js';

export class MemoryExecutionConfirmationRequestStore
  implements ExecutionConfirmationRequestStore
{
  readonly #byId = new Map<string, StoredConfirmationRequest>();

  async savePending(
    input: StoredConfirmationRequest,
  ): Promise<StoredConfirmationRequest> {
    const request = parseConfirmationRequest(input.request);
    if (request.status !== 'pending') {
      throw new ExecutionConfirmationError(
        'INVALID_STATE',
        'Only pending confirmation requests may be created.',
      );
    }
    const existing = this.#byId.get(request.requestId);
    if (existing) {
      if (
        isDeepStrictEqual(existing.request, request) &&
        isDeepStrictEqual(existing.projection, input.projection)
      ) {
        return structuredClone(existing);
      }
      throw new ExecutionConfirmationError(
        'IDEMPOTENCY_CONFLICT',
        `Confirmation request ${request.requestId} already exists with different facts.`,
      );
    }
    if (
      request.approvalScope === 'single_work' &&
      request.campaignPlanRef &&
      request.workOrdinal !== undefined
    ) {
      const twin = await this.findCampaignWork({
        workspaceId: request.workspaceId,
        campaignPlanId: request.campaignPlanRef.id,
        workOrdinal: request.workOrdinal,
      });
      if (twin && twin.request.requestId !== request.requestId) {
        // Same work may re-use only identical pending row (idempotent create).
        if (
          twin.request.status === 'pending' &&
          twin.request.snapshotHash === request.snapshotHash &&
          twin.request.reservationIdempotencyKey ===
            request.reservationIdempotencyKey
        ) {
          return structuredClone(twin);
        }
        throw new ExecutionConfirmationError(
          'CAMPAIGN_WORK_ALREADY_OPEN',
          `Campaign work ordinal ${request.workOrdinal} already has confirmation ${twin.request.requestId}.`,
        );
      }
    }
    const stored: StoredConfirmationRequest = {
      request: Object.freeze({ ...request }) as AgentExecutionConfirmationRequest,
      projection: structuredClone(input.projection),
    };
    this.#byId.set(request.requestId, stored);
    return structuredClone(stored);
  }

  async getById(requestId: string): Promise<StoredConfirmationRequest | null> {
    const row = this.#byId.get(requestId);
    return row ? structuredClone(row) : null;
  }

  async markStatus(input: {
    requestId: string;
    status: 'decided' | 'expired';
    expectedStatus?: 'pending';
  }): Promise<StoredConfirmationRequest | null> {
    const existing = this.#byId.get(input.requestId);
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
      return structuredClone(existing);
    }
    if (existing.request.status !== 'pending') {
      throw new ExecutionConfirmationError(
        'INVALID_STATE',
        `Confirmation request ${input.requestId} cannot leave ${existing.request.status}.`,
      );
    }
    const next: StoredConfirmationRequest = {
      request: parseConfirmationRequest({
        ...existing.request,
        status: input.status,
      }),
      projection: existing.projection,
    };
    this.#byId.set(input.requestId, next);
    return structuredClone(next);
  }

  async findCampaignWork(input: {
    workspaceId: string;
    campaignPlanId: string;
    workOrdinal: number;
  }): Promise<StoredConfirmationRequest | null> {
    for (const row of this.#byId.values()) {
      if (
        row.request.workspaceId === input.workspaceId &&
        row.request.campaignPlanRef?.id === input.campaignPlanId &&
        row.request.workOrdinal === input.workOrdinal &&
        row.request.approvalScope === 'single_work'
      ) {
        return structuredClone(row);
      }
    }
    return null;
  }

  async listPendingByWorkspace(
    workspaceId: string,
  ): Promise<StoredConfirmationRequest[]> {
    return [...this.#byId.values()]
      .filter(
        (row) =>
          row.request.workspaceId === workspaceId &&
          row.request.status === 'pending',
      )
      .map((row) => structuredClone(row));
  }

  savePendingInTransaction(
    _client: ConfirmationTransactionClient,
    input: StoredConfirmationRequest,
  ) {
    return this.savePending(input);
  }

  getByIdInTransaction(
    _client: ConfirmationTransactionClient,
    requestId: string,
  ) {
    return this.getById(requestId);
  }

  async getOwnedInTransaction(
    _client: ConfirmationTransactionClient,
    workspaceId: string,
    requestId: string,
  ) {
    const stored = await this.getById(requestId);
    return stored?.request.workspaceId === workspaceId ? stored : null;
  }

  async markOwnedStatusInTransaction(
    client: ConfirmationTransactionClient,
    input: Parameters<ExecutionConfirmationRequestStore['markOwnedStatusInTransaction']>[1],
  ) {
    const owned = await this.getOwnedInTransaction(
      client,
      input.workspaceId,
      input.requestId,
    );
    return owned ? this.markStatus(input) : null;
  }

  findCampaignWorkInTransaction(
    _client: ConfirmationTransactionClient,
    input: Parameters<ExecutionConfirmationRequestStore['findCampaignWorkInTransaction']>[1],
  ) {
    return this.findCampaignWork(input);
  }

  async listDuePending(now: string, limit = 100) {
    return [...this.#byId.values()]
      .filter(
        (row) =>
          row.request.status === 'pending' &&
          Date.parse(row.request.holdExpiresAt) <= Date.parse(now),
      )
      .sort((a, b) =>
        a.request.holdExpiresAt.localeCompare(b.request.holdExpiresAt),
      )
      .slice(0, Math.max(1, Math.min(limit, 500)))
      .map((row) => structuredClone(row));
  }

  async listUnreconciledDecided(limit = 100) {
    return [...this.#byId.values()]
      .filter((stored) => stored.request.status === 'decided')
      .slice(0, limit)
      .map((stored) => structuredClone(stored));
  }

  async restoreOwnedPendingInTransaction(
    _client: ConfirmationTransactionClient,
    input: { workspaceId: string; requestId: string },
  ) {
    const existing = this.#byId.get(input.requestId);
    if (
      !existing ||
      existing.request.workspaceId !== input.workspaceId ||
      existing.request.status !== 'decided'
    ) {
      return existing ? structuredClone(existing) : null;
    }
    const restored = {
      ...existing,
      request: parseConfirmationRequest({
        ...existing.request,
        status: 'pending',
      }),
    };
    this.#byId.set(input.requestId, restored);
    return structuredClone(restored);
  }
}

export class MemoryPlanConfirmationDecisionStore
  implements PlanConfirmationDecisionStore
{
  readonly #byId = new Map<string, PlanConfirmationDecision>();
  readonly #byRequest = new Map<string, string>();

  async append(
    decision: PlanConfirmationDecision,
  ): Promise<PlanConfirmationDecision> {
    const parsed = parseConfirmationDecision(decision);
    const existingById = this.#byId.get(parsed.decisionId);
    if (existingById) {
      if (isDeepStrictEqual(existingById, parsed)) {
        return structuredClone(existingById);
      }
      throw new ExecutionConfirmationError(
        'DECISION_IMMUTABLE',
        `PlanConfirmationDecision ${parsed.decisionId} is immutable.`,
      );
    }
    const existingRequestDecision = this.#byRequest.get(parsed.requestId);
    if (existingRequestDecision) {
      const prior = this.#byId.get(existingRequestDecision);
      if (prior && isDeepStrictEqual(prior, parsed)) {
        return structuredClone(prior);
      }
      throw new ExecutionConfirmationError(
        'DECISION_IMMUTABLE',
        `Request ${parsed.requestId} already has an immutable decision.`,
      );
    }
    const frozen = Object.freeze({ ...parsed }) as PlanConfirmationDecision;
    this.#byId.set(parsed.decisionId, frozen);
    this.#byRequest.set(parsed.requestId, parsed.decisionId);
    return structuredClone(frozen);
  }

  async getById(decisionId: string): Promise<PlanConfirmationDecision | null> {
    const row = this.#byId.get(decisionId);
    return row ? structuredClone(row) : null;
  }

  async getByRequestId(
    requestId: string,
  ): Promise<PlanConfirmationDecision | null> {
    const id = this.#byRequest.get(requestId);
    return id ? this.getById(id) : null;
  }

  appendInTransaction(
    _client: ConfirmationTransactionClient,
    decision: PlanConfirmationDecision,
  ) {
    return this.append(decision);
  }

  getByIdInTransaction(
    _client: ConfirmationTransactionClient,
    decisionId: string,
  ) {
    return this.getById(decisionId);
  }

  getByRequestIdInTransaction(
    _client: ConfirmationTransactionClient,
    requestId: string,
  ) {
    return this.getByRequestId(requestId);
  }
}
