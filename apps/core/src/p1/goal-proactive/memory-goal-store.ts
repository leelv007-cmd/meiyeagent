/**
 * In-memory MarketingGoalStore — tests / fixture only (V31-24).
 * Production assembly must use PostgresMarketingGoalStore.
 */

import type { MarketingGoal, MarketingGoalStatus } from '@meiye/contracts';

import {
  assertGoalFound,
  assertGoalRevision,
  goalWithEvidence,
  goalWithStatus,
  MarketingGoalStoreError,
  newMarketingGoal,
  type AppendGoalEvidenceInput,
  type CreateMarketingGoalInput,
  type MarketingGoalStore,
  type TransitionMarketingGoalStatusInput,
} from './goal-store.js';

export class MemoryMarketingGoalStore implements MarketingGoalStore {
  private readonly goals = new Map<string, MarketingGoal>();

  async create(input: CreateMarketingGoalInput): Promise<MarketingGoal> {
    const existing = this.goals.get(input.goalId);
    if (existing) {
      if (existing.resourceId !== input.resourceId) {
        throw new MarketingGoalStoreError(
          'GOAL_ID_TAKEN',
          `Marketing goal ${input.goalId} already exists for another resource.`,
          { goalId: input.goalId },
        );
      }
      return structuredClone(existing);
    }
    const goal = newMarketingGoal(input);
    this.goals.set(goal.goalId, goal);
    return structuredClone(goal);
  }

  async get(input: {
    resourceId: string;
    goalId: string;
  }): Promise<MarketingGoal | null> {
    const goal = this.goals.get(input.goalId);
    if (!goal || goal.resourceId !== input.resourceId) return null;
    return structuredClone(goal);
  }

  async list(input: {
    resourceId: string;
    status?: MarketingGoalStatus;
    limit?: number;
  }): Promise<MarketingGoal[]> {
    const rows = [...this.goals.values()]
      .filter((goal) => goal.resourceId === input.resourceId)
      .filter((goal) => (input.status ? goal.status === input.status : true))
      .sort((left, right) => {
        const byPriority =
          priorityRank(right.priority) - priorityRank(left.priority);
        if (byPriority !== 0) return byPriority;
        return right.updatedAt.localeCompare(left.updatedAt);
      })
      .map((goal) => structuredClone(goal));
    return input.limit === undefined ? rows : rows.slice(0, input.limit);
  }

  async transitionStatus(
    input: TransitionMarketingGoalStatusInput,
  ): Promise<MarketingGoal> {
    const current = assertGoalFound(
      await this.get({ resourceId: input.resourceId, goalId: input.goalId }),
      input.goalId,
    );
    assertGoalRevision(current, input.expectedRevision);
    const next = goalWithStatus(current, input.nextStatus, input.now);
    this.goals.set(next.goalId, next);
    return structuredClone(next);
  }

  async appendEvidence(input: AppendGoalEvidenceInput): Promise<MarketingGoal> {
    const current = assertGoalFound(
      await this.get({ resourceId: input.resourceId, goalId: input.goalId }),
      input.goalId,
    );
    assertGoalRevision(current, input.expectedRevision);
    const next = goalWithEvidence(current, input.evidenceRefs, input.now);
    this.goals.set(next.goalId, next);
    return structuredClone(next);
  }
}

function priorityRank(priority: MarketingGoal['priority']): number {
  if (priority === 'high') return 3;
  if (priority === 'normal') return 2;
  return 1;
}
