import type { EvalRun } from '../../contracts/index.js';

export interface EvalRunRegistryPort {
  putImmutable(runId: string, fullRun: EvalRun): Promise<EvalRun>;
  get(runId: string): Promise<EvalRun | null>;
}
