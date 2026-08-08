/**
 * Goal progress projection (V31-24).
 *
 * Consumes delivered Work + OutcomeEvidence facts only — never invents a
 * second statistics truth (V3.1 §11 / spec-F Implementation Decisions).
 */

import {
  marketingGoalProgressSchema,
  type MarketingGoal,
  type MarketingGoalProgress,
} from '@meiye/contracts';

export type DeliveredWorkFact = {
  workId: string;
  goalId?: string | null;
  deliveredAt: string;
};

export type OutcomeEvidenceFact = {
  evidenceId: string;
  goalId?: string | null;
  contentPackageId?: string | null;
  observedAt: string;
  withdrawn?: boolean;
};

export function projectGoalProgress(input: {
  goal: MarketingGoal;
  deliveredWorks: readonly DeliveredWorkFact[];
  evidence: readonly OutcomeEvidenceFact[];
}): MarketingGoalProgress {
  const delivered = input.deliveredWorks.filter(
    (work) => work.goalId === input.goal.goalId,
  );
  const evidence = input.evidence.filter(
    (row) => row.goalId === input.goal.goalId && !row.withdrawn,
  );
  const lastDeliveredAt = delivered
    .map((row) => row.deliveredAt)
    .sort()
    .at(-1);
  const lastEvidenceAt = evidence
    .map((row) => row.observedAt)
    .sort()
    .at(-1);

  return marketingGoalProgressSchema.parse({
    goalId: input.goal.goalId,
    resourceId: input.goal.resourceId,
    status: input.goal.status,
    priority: input.goal.priority,
    statement: input.goal.statement,
    deliveredWorkCount: delivered.length,
    evidenceCount: evidence.length,
    ...(lastDeliveredAt ? { lastDeliveredAt } : {}),
    ...(lastEvidenceAt ? { lastEvidenceAt } : {}),
  });
}

/** Pick the currently most important active goal for Idle first screen. */
export function selectPrimaryGoal(
  goals: readonly MarketingGoal[],
): MarketingGoal | null {
  const active = goals.filter((goal) => goal.status === 'active');
  if (active.length === 0) return null;
  return (
    [...active].sort((left, right) => {
      const byPriority =
        priorityRank(right.priority) - priorityRank(left.priority);
      if (byPriority !== 0) return byPriority;
      return right.updatedAt.localeCompare(left.updatedAt);
    })[0] ?? null
  );
}

function priorityRank(priority: MarketingGoal['priority']): number {
  if (priority === 'high') return 3;
  if (priority === 'normal') return 2;
  return 1;
}
