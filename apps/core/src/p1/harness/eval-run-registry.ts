import type { EvalRun } from '@meiye/contracts';

export interface EvalRunRegistryPort {
  putImmutable(runId: string, fullRun: EvalRun): Promise<EvalRun>;
  get(runId: string): Promise<EvalRun | null>;
}
