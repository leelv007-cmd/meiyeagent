/**
 * Append-only opportunity decision log (V31-24 / V3.1 §25 narrow §33.1).
 *
 * candidate body is derived projection; only accept/dismiss decisions persist.
 * Accept idempotency key = candidateId (one Thread turn per accept).
 */

import {
  OPPORTUNITY_DECISION_SCHEMA_VERSION,
  opportunityDecisionSchema,
  type OpportunityDecision,
} from '@meiye/contracts';

export type OpportunityDecisionStoreErrorCode =
  | 'DECISION_CONFLICT'
  | 'DECISION_NOT_FOUND';

export class OpportunityDecisionStoreError extends Error {
  readonly status: number;

  constructor(
    readonly code: OpportunityDecisionStoreErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'OpportunityDecisionStoreError';
    this.status = code === 'DECISION_NOT_FOUND' ? 404 : 409;
  }
}

export type AppendOpportunityDecisionInput = {
  decisionId: string;
  candidateId: string;
  resourceId: string;
  actorId: string;
  decision: 'accepted' | 'dismissed';
  decidedAt: string;
  threadId?: string;
  runId?: string;
};

export interface OpportunityDecisionStore {
  /**
   * Append decision. For decision=accepted, candidateId is the idempotency key:
   * replaying the same accept returns the original row (same thread/run).
   * Divergent accept payload for the same candidateId → CONFLICT.
   */
  append(input: AppendOpportunityDecisionInput): Promise<{
    decision: OpportunityDecision;
    replayed: boolean;
  }>;
  latestForCandidate(input: {
    resourceId: string;
    candidateId: string;
  }): Promise<OpportunityDecision | null>;
  listForResource(input: {
    resourceId: string;
    limit?: number;
  }): Promise<OpportunityDecision[]>;
}

export function parseOpportunityDecision(
  value: unknown,
): OpportunityDecision {
  return opportunityDecisionSchema.parse(value);
}

export function newOpportunityDecision(
  input: AppendOpportunityDecisionInput,
): OpportunityDecision {
  return opportunityDecisionSchema.parse({
    schemaVersion: OPPORTUNITY_DECISION_SCHEMA_VERSION,
    decisionId: input.decisionId,
    candidateId: input.candidateId,
    resourceId: input.resourceId,
    actorId: input.actorId,
    decision: input.decision,
    decidedAt: input.decidedAt,
    ...(input.threadId ? { threadId: input.threadId } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
  });
}
