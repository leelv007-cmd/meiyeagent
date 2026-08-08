/**
 * Eval verdict storage port (V31-23).
 * Results are immutable once written and always bound to harnessReleaseId.
 */

import { isDeepStrictEqual } from 'node:util';

import {
  evalLayerResultSchema,
  type EvalLayerResult,
} from '@meiye/contracts';

import { P1DomainError } from '../foundation/domain.js';

export interface EvalVerdictStore {
  putImmutable(result: EvalLayerResult): Promise<EvalLayerResult>;
  get(resultId: string): Promise<EvalLayerResult | null>;
  listByRelease(
    harnessReleaseId: string,
    limit?: number,
  ): Promise<EvalLayerResult[]>;
}

export class MemoryEvalVerdictStore implements EvalVerdictStore {
  private readonly byId = new Map<string, EvalLayerResult>();

  async putImmutable(input: EvalLayerResult): Promise<EvalLayerResult> {
    const result = evalLayerResultSchema.parse(input);
    const existing = this.byId.get(result.resultId);
    if (existing) {
      if (isDeepStrictEqual(existing, result)) {
        return structuredClone(existing);
      }
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        `EvalLayerResult ${result.resultId} is immutable and already bound to different facts.`,
      );
    }
    this.byId.set(result.resultId, structuredClone(result));
    return structuredClone(result);
  }

  async get(resultId: string): Promise<EvalLayerResult | null> {
    const value = this.byId.get(resultId);
    return value ? structuredClone(value) : null;
  }

  async listByRelease(
    harnessReleaseId: string,
    limit = 100,
  ): Promise<EvalLayerResult[]> {
    return [...this.byId.values()]
      .filter((item) => item.harnessReleaseId === harnessReleaseId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((item) => structuredClone(item));
  }
}
