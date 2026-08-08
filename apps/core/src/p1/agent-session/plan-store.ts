/**
 * Append-only MarketingPlanRevision store contract (V31-09 / V3.1 §13).
 *
 * Sole writer of marketing_plan_revision semantic fact = PlanCompiler
 * (packages/contracts ownership matrix). No status/readiness column.
 */

import {
  marketingPlanRevisionSchema,
  type CompiledExecutionPlan,
  type MarketingPlanRevision,
} from '@meiye/contracts';

import { assertNoReadinessWriterOnRevision } from './plan-readiness.js';

export class MarketingPlanStoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MarketingPlanStoreError';
    this.code = code;
  }
}

export type MarketingPlanCompileArtifact = {
  revision: MarketingPlanRevision;
  executionPlan: CompiledExecutionPlan;
};

export type AppendMarketingPlanInput = MarketingPlanCompileArtifact;

export interface MarketingPlanStore {
  /**
   * Append a new immutable revision. Never updates prior rows.
   * revision number must be previous+1 for the same planId (or 1 if first).
   */
  append(input: AppendMarketingPlanInput): Promise<MarketingPlanCompileArtifact>;
  listRevisions(planId: string): Promise<MarketingPlanRevision[]>;
  getRevision(
    planId: string,
    revision: number,
  ): Promise<MarketingPlanCompileArtifact | null>;
  getLatest(planId: string): Promise<MarketingPlanCompileArtifact | null>;
}

export function parseMarketingPlanRevision(
  payload: unknown,
): MarketingPlanRevision {
  if (payload && typeof payload === 'object') {
    assertNoReadinessWriterOnRevision(payload as Record<string, unknown>);
  }
  return marketingPlanRevisionSchema.parse(payload);
}

export function assertAppendOnlyRevisionSequence(input: {
  planId: string;
  nextRevision: number;
  previousRevision: number | null;
}): void {
  if (input.previousRevision === null) {
    if (input.nextRevision !== 1) {
      throw new MarketingPlanStoreError(
        'PLAN_REVISION_SEQUENCE',
        `First revision for ${input.planId} must be 1, got ${input.nextRevision}.`,
      );
    }
    return;
  }
  if (input.nextRevision !== input.previousRevision + 1) {
    throw new MarketingPlanStoreError(
      'PLAN_REVISION_SEQUENCE',
      `Plan ${input.planId} next revision must be ${input.previousRevision + 1}, got ${input.nextRevision}.`,
    );
  }
}
