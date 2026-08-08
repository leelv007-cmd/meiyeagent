/**
 * Stores for ExecutionConfirmationRequest + PlanConfirmationDecision (V31-11 / §14.3).
 *
 * Request rows are mutable only for status transitions (pending→decided|expired).
 * Decision rows are append-only / immutable (PlanConfirmationDecisionStore ownership).
 */

import {
  agentExecutionConfirmationRequestSchema,
  planConfirmationDecisionSchema,
  type AgentExecutionConfirmationRequest,
  type PlanConfirmationDecision,
} from '@meiye/contracts';

export class ExecutionConfirmationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ExecutionConfirmationError';
    this.code = code;
  }
}

/**
 * Merchant-facing projection facts kept beside the domain request.
 * Amounts stay sourced from billing at create time; dual-truth (D-061) holds.
 */
export type ConfirmationRequestProjectionFacts = {
  reservedCredits: number;
  failureRefundsCredits: boolean;
  rightsSummary: string | null;
  factSummary: string | null;
};

export type StoredConfirmationRequest = {
  request: AgentExecutionConfirmationRequest;
  projection: ConfirmationRequestProjectionFacts;
};

export interface ExecutionConfirmationRequestStore {
  savePending(input: StoredConfirmationRequest): Promise<StoredConfirmationRequest>;
  getById(requestId: string): Promise<StoredConfirmationRequest | null>;
  /**
   * Mark status transition. Only pending → decided|expired.
   * Returns updated row or null if not found.
   */
  markStatus(input: {
    requestId: string;
    status: 'decided' | 'expired';
    expectedStatus?: 'pending';
  }): Promise<StoredConfirmationRequest | null>;
  /**
   * Campaign U7: find an existing single_work request for the same campaign work.
   */
  findCampaignWork(input: {
    workspaceId: string;
    campaignPlanId: string;
    workOrdinal: number;
  }): Promise<StoredConfirmationRequest | null>;
  listPendingByWorkspace(
    workspaceId: string,
  ): Promise<StoredConfirmationRequest[]>;
}

export interface PlanConfirmationDecisionStore {
  /**
   * Append-only insert. Same facts → idempotent return; different facts → conflict.
   */
  append(decision: PlanConfirmationDecision): Promise<PlanConfirmationDecision>;
  getById(decisionId: string): Promise<PlanConfirmationDecision | null>;
  getByRequestId(requestId: string): Promise<PlanConfirmationDecision | null>;
}

export function parseConfirmationRequest(
  payload: unknown,
): AgentExecutionConfirmationRequest {
  return agentExecutionConfirmationRequestSchema.parse(payload);
}

export function parseConfirmationDecision(
  payload: unknown,
): PlanConfirmationDecision {
  return planConfirmationDecisionSchema.parse(payload);
}
