import type { ZodType } from 'zod';

import type { AdminConfigRepository } from './foundation-module.js';

const GLOBAL_WORKSPACE_ID = '__global__';

export const BOUNDED_EXECUTION_LIMITS_CONFIG_KEY =
  'harness.bounded_execution.limits';

export class AdminConfigBoundedExecutionLimitsSource<Limits> {
  constructor(
    private readonly repository: Pick<AdminConfigRepository, 'get'>,
    private readonly limitsSchema: ZodType<Limits>,
  ) {}

  async read() {
    const revision = await this.repository.get(
      'global',
      GLOBAL_WORKSPACE_ID,
      BOUNDED_EXECUTION_LIMITS_CONFIG_KEY,
    );
    if (!revision) {
      return { source: 'missing' as const };
    }
    return {
      source: 'admin_config' as const,
      revision: revision.revision,
      limits: this.limitsSchema.parse(revision.value),
    };
  }
}
