/**
 * MarketingGoalStore seam (V31-24 / V3.1 §11 / ownership: MarketingGoalStore).
 *
 * Canonical writer for marketing_goal. Create and status transitions only land
 * after merchant confirm; revision OCC rejects stale confirms with current row.
 */

import {
  MARKETING_GOAL_SCHEMA_VERSION,
  marketingGoalSchema,
  type MarketingGoal,
  type MarketingGoalObjective,
  type MarketingGoalPriority,
  type MarketingGoalStatus,
  type AgentEvidenceRef,
} from '@meiye/contracts';

export type MarketingGoalStoreErrorCode =
  | 'GOAL_NOT_FOUND'
  | 'GOAL_ID_TAKEN'
  | 'GOAL_REVISION_CONFLICT'
  | 'GOAL_STATE_INVALID';

const STATUS: Record<MarketingGoalStoreErrorCode, number> = {
  GOAL_NOT_FOUND: 404,
  GOAL_ID_TAKEN: 409,
  GOAL_REVISION_CONFLICT: 409,
  GOAL_STATE_INVALID: 400,
};

export class MarketingGoalStoreError extends Error {
  readonly status: number;

  constructor(
    readonly code: MarketingGoalStoreErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'MarketingGoalStoreError';
    this.status = STATUS[code];
  }
}

export type CreateMarketingGoalInput = {
  goalId: string;
  resourceId: string;
  objective: MarketingGoalObjective;
  statement: string;
  priority?: MarketingGoalPriority;
  horizon?: MarketingGoal['horizon'];
  evidenceRefs?: readonly AgentEvidenceRef[];
  now: string;
};

export type TransitionMarketingGoalStatusInput = {
  resourceId: string;
  goalId: string;
  expectedRevision: number;
  nextStatus: MarketingGoalStatus;
  now: string;
};

export type AppendGoalEvidenceInput = {
  resourceId: string;
  goalId: string;
  expectedRevision: number;
  evidenceRefs: readonly AgentEvidenceRef[];
  now: string;
};

export interface MarketingGoalStore {
  create(input: CreateMarketingGoalInput): Promise<MarketingGoal>;
  get(input: {
    resourceId: string;
    goalId: string;
  }): Promise<MarketingGoal | null>;
  list(input: {
    resourceId: string;
    status?: MarketingGoalStatus;
    limit?: number;
  }): Promise<MarketingGoal[]>;
  transitionStatus(
    input: TransitionMarketingGoalStatusInput,
  ): Promise<MarketingGoal>;
  appendEvidence(input: AppendGoalEvidenceInput): Promise<MarketingGoal>;
}

export function newMarketingGoal(input: CreateMarketingGoalInput): MarketingGoal {
  return marketingGoalSchema.parse({
    schemaVersion: MARKETING_GOAL_SCHEMA_VERSION,
    goalId: input.goalId,
    resourceId: input.resourceId,
    objective: input.objective,
    statement: input.statement,
    ...(input.horizon ? { horizon: input.horizon } : {}),
    priority: input.priority ?? 'normal',
    status: 'active',
    evidenceRefs: [...(input.evidenceRefs ?? [])],
    revision: 0,
    createdAt: input.now,
    updatedAt: input.now,
  });
}

export function assertGoalFound(
  goal: MarketingGoal | null,
  goalId: string,
): MarketingGoal {
  if (!goal) {
    throw new MarketingGoalStoreError(
      'GOAL_NOT_FOUND',
      `Marketing goal ${goalId} was not found.`,
      { goalId },
    );
  }
  return goal;
}

export function assertGoalRevision(
  goal: MarketingGoal,
  expectedRevision: number,
): void {
  if (goal.revision !== expectedRevision) {
    throw new MarketingGoalStoreError(
      'GOAL_REVISION_CONFLICT',
      `Marketing goal ${goal.goalId} is at revision ${goal.revision}.`,
      {
        goalId: goal.goalId,
        expectedRevision,
        currentRevision: goal.revision,
      },
    );
  }
}

/** Allowed status transitions for merchant-confirmed moves. */
export function assertStatusTransitionAllowed(
  current: MarketingGoalStatus,
  next: MarketingGoalStatus,
): void {
  if (current === next) {
    throw new MarketingGoalStoreError(
      'GOAL_STATE_INVALID',
      `Marketing goal is already ${current}.`,
      { current, next },
    );
  }
  const allowed: Record<MarketingGoalStatus, readonly MarketingGoalStatus[]> = {
    active: ['paused', 'completed', 'abandoned'],
    paused: ['active', 'completed', 'abandoned'],
    completed: [],
    abandoned: [],
  };
  const nextAllowed = allowed[current] ?? [];
  if (!nextAllowed.includes(next)) {
    throw new MarketingGoalStoreError(
      'GOAL_STATE_INVALID',
      `Cannot transition marketing goal from ${current} to ${next}.`,
      { current, next },
    );
  }
}

export function goalWithStatus(
  goal: MarketingGoal,
  nextStatus: MarketingGoalStatus,
  now: string,
): MarketingGoal {
  assertStatusTransitionAllowed(goal.status, nextStatus);
  return marketingGoalSchema.parse({
    ...goal,
    status: nextStatus,
    revision: goal.revision + 1,
    updatedAt: now,
  });
}

export function goalWithEvidence(
  goal: MarketingGoal,
  evidenceRefs: readonly AgentEvidenceRef[],
  now: string,
): MarketingGoal {
  const merged = [...goal.evidenceRefs];
  for (const ref of evidenceRefs) {
    if (!merged.some((item) => item.kind === ref.kind && item.ref === ref.ref)) {
      merged.push(ref);
    }
  }
  return marketingGoalSchema.parse({
    ...goal,
    evidenceRefs: merged.slice(0, 100),
    revision: goal.revision + 1,
    updatedAt: now,
  });
}
