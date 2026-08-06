/**
 * Shared EvalRun registry port (Spec I #393).
 *
 * Owned by harness so creation-experience (and issuers) can read/write run
 * facts without depending on SkillRepository. Skill still keeps its own
 * putImmutable path (with reference edges) on the same physical table —
 * that write path is intentionally not migrated or redirected.
 */

import { isDeepStrictEqual } from 'node:util';

import { evalRunSchema, type EvalRun } from '../../contracts/index.js';

import { P1DomainError } from '../foundation/domain.js';

export interface EvalRunRegistryPort {
  putImmutable(runId: string, fullRun: EvalRun): Promise<EvalRun>;
  get(runId: string): Promise<EvalRun | null>;
}

/**
 * In-memory put-once EvalRun registry for tests and fixture assembly.
 */
export class MemoryEvalRunRegistry implements EvalRunRegistryPort {
  private readonly runs = new Map<string, EvalRun>();

  async putImmutable(runId: string, input: EvalRun): Promise<EvalRun> {
    const run = evalRunSchema.parse(input);
    if (run.runId !== runId) {
      throw new P1DomainError(
        'INVALID_STATE',
        'EvalRun ID must match the immutable registry key.',
      );
    }
    const existing = this.runs.get(runId);
    if (existing) {
      if (isDeepStrictEqual(existing, run)) {
        return structuredClone(existing);
      }
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'EvalRun is already bound to different facts.',
      );
    }
    this.runs.set(runId, structuredClone(run));
    return structuredClone(run);
  }

  async get(runId: string): Promise<EvalRun | null> {
    const value = this.runs.get(runId);
    return value ? evalRunSchema.parse(structuredClone(value)) : null;
  }
}
