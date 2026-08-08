/**
 * In-memory opportunity decision log — tests only (V31-24).
 */

import type { OpportunityDecision } from '@meiye/contracts';

import {
  newOpportunityDecision,
  OpportunityDecisionStoreError,
  type AppendOpportunityDecisionInput,
  type OpportunityDecisionStore,
} from './opportunity-decision-store.js';

export class MemoryOpportunityDecisionStore
  implements OpportunityDecisionStore
{
  private readonly byDecisionId = new Map<string, OpportunityDecision>();
  /** Accept idempotency: candidateId → first accepted decision. */
  private readonly acceptByCandidate = new Map<string, OpportunityDecision>();
  private readonly byResource = new Map<string, OpportunityDecision[]>();

  async append(input: AppendOpportunityDecisionInput): Promise<{
    decision: OpportunityDecision;
    replayed: boolean;
  }> {
    if (input.decision === 'accepted') {
      const prior = this.acceptByCandidate.get(input.candidateId);
      if (prior) {
        if (prior.resourceId !== input.resourceId) {
          throw new OpportunityDecisionStoreError(
            'DECISION_CONFLICT',
            `Candidate ${input.candidateId} already accepted for another resource.`,
            { candidateId: input.candidateId },
          );
        }
        // Idempotent accept: same thread/run (or missing on replay with match).
        if (
          prior.threadId &&
          input.threadId &&
          prior.threadId !== input.threadId
        ) {
          throw new OpportunityDecisionStoreError(
            'DECISION_CONFLICT',
            `Candidate ${input.candidateId} already accepted into thread ${prior.threadId}.`,
            {
              candidateId: input.candidateId,
              existingThreadId: prior.threadId,
              requestedThreadId: input.threadId,
            },
          );
        }
        return { decision: structuredClone(prior), replayed: true };
      }
    }

    const decision = newOpportunityDecision(input);
    if (this.byDecisionId.has(decision.decisionId)) {
      const existing = this.byDecisionId.get(decision.decisionId)!;
      if (JSON.stringify(existing) !== JSON.stringify(decision)) {
        throw new OpportunityDecisionStoreError(
          'DECISION_CONFLICT',
          `Decision ${decision.decisionId} already exists with different payload.`,
          { decisionId: decision.decisionId },
        );
      }
      return { decision: structuredClone(existing), replayed: true };
    }

    this.byDecisionId.set(decision.decisionId, decision);
    if (decision.decision === 'accepted') {
      this.acceptByCandidate.set(decision.candidateId, decision);
    }
    const list = this.byResource.get(decision.resourceId) ?? [];
    list.push(decision);
    this.byResource.set(decision.resourceId, list);
    return { decision: structuredClone(decision), replayed: false };
  }

  async latestForCandidate(input: {
    resourceId: string;
    candidateId: string;
  }): Promise<OpportunityDecision | null> {
    const rows = this.byResource.get(input.resourceId) ?? [];
    const matches = rows.filter((row) => row.candidateId === input.candidateId);
    if (matches.length === 0) return null;
    return structuredClone(matches[matches.length - 1]!);
  }

  async listForResource(input: {
    resourceId: string;
    limit?: number;
  }): Promise<OpportunityDecision[]> {
    const rows = [...(this.byResource.get(input.resourceId) ?? [])]
      .sort((a, b) => a.decidedAt.localeCompare(b.decidedAt))
      .map((row) => structuredClone(row));
    return input.limit === undefined ? rows : rows.slice(-input.limit);
  }
}
