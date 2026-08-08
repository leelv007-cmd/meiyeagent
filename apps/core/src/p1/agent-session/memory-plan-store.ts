/**
 * In-memory MarketingPlanStore for unit tests and fixture runtimes (V31-09).
 */

import {
  compiledExecutionPlanSchema,
  type CompiledExecutionPlan,
  type MarketingPlanRevision,
} from '@meiye/contracts';

import {
  assertAppendOnlyRevisionSequence,
  MarketingPlanStoreError,
  parseMarketingPlanRevision,
  type AppendMarketingPlanInput,
  type MarketingPlanCompileArtifact,
  type MarketingPlanStore,
} from './plan-store.js';

type StoredRow = {
  revision: MarketingPlanRevision;
  executionPlan: CompiledExecutionPlan;
};

export class MemoryMarketingPlanStore implements MarketingPlanStore {
  readonly #rows = new Map<string, StoredRow[]>();

  async append(
    input: AppendMarketingPlanInput,
  ): Promise<MarketingPlanCompileArtifact> {
    const revision = parseMarketingPlanRevision(input.revision);
    const executionPlan = compiledExecutionPlanSchema.parse(input.executionPlan);
    const existing = this.#rows.get(revision.planId) ?? [];
    const previous = existing[existing.length - 1]?.revision.revision ?? null;
    assertAppendOnlyRevisionSequence({
      planId: revision.planId,
      nextRevision: revision.revision,
      previousRevision: previous,
    });
    // Append-only: never mutate prior entries.
    const next = [
      ...existing,
      { revision: Object.freeze({ ...revision }), executionPlan },
    ];
    this.#rows.set(revision.planId, next);
    return { revision, executionPlan };
  }

  async listRevisions(planId: string): Promise<MarketingPlanRevision[]> {
    return (this.#rows.get(planId) ?? []).map((row) => row.revision);
  }

  async getRevision(
    planId: string,
    revision: number,
  ): Promise<MarketingPlanCompileArtifact | null> {
    const found = (this.#rows.get(planId) ?? []).find(
      (row) => row.revision.revision === revision,
    );
    return found
      ? { revision: found.revision, executionPlan: found.executionPlan }
      : null;
  }

  async getLatest(
    planId: string,
  ): Promise<MarketingPlanCompileArtifact | null> {
    const rows = this.#rows.get(planId) ?? [];
    const last = rows[rows.length - 1];
    return last
      ? { revision: last.revision, executionPlan: last.executionPlan }
      : null;
  }

  /** Test helper: prove prior revision payload is still intact. */
  snapshot(planId: string): MarketingPlanRevision[] {
    return (this.#rows.get(planId) ?? []).map((row) =>
      structuredClone(row.revision),
    );
  }

  assertNotOverwritten(planId: string, revision: number, contentHash: string) {
    const found = (this.#rows.get(planId) ?? []).find(
      (row) => row.revision.revision === revision,
    );
    if (!found) {
      throw new MarketingPlanStoreError(
        'PLAN_REVISION_MISSING',
        `Missing revision ${revision} for ${planId}`,
      );
    }
    if (found.revision.contentHash !== contentHash) {
      throw new MarketingPlanStoreError(
        'PLAN_REVISION_OVERWRITTEN',
        `Revision ${revision} for ${planId} was overwritten.`,
      );
    }
  }
}
