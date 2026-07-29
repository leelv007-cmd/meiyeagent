import {
  boundedExecutionLimitsSchema,
  boundedExecutionSnapshotSchema,
  type BoundedExecutionLimitName,
} from '@meiye/contracts';
import { z } from 'zod';

import type { HarnessBoundedExecutionContinuationResolver } from '../harness/dbos-workflow.js';
import type { HarnessExecutionBoundsResolver } from '../harness/task-admission.js';
import type { AdminConfigRepository } from './foundation-module.js';

const GLOBAL_WORKSPACE_ID = '__global__';
const REQUIRED_PRODUCTION_LIMITS = [
  'maxIterations',
  'maxCostCents',
  'maxWallClockMs',
] as const satisfies readonly BoundedExecutionLimitName[];

export const BOUNDED_EXECUTION_LIMITS_CONFIG_KEY =
  'harness.bounded_execution.limits';

const configuredLimitSchema = z
  .object({
    default: boundedExecutionLimitsSchema.shape.maxIterations,
    hardCap: boundedExecutionLimitsSchema.shape.maxIterations,
  })
  .strict()
  .superRefine((axis, context) => {
    if (
      (axis.default === 'unset') !==
      (axis.hardCap === 'unset')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A bounded execution axis must set or unset both values.',
      });
      return;
    }
    if (
      axis.default !== 'unset' &&
      axis.hardCap !== 'unset' &&
      axis.default > axis.hardCap
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A bounded execution default cannot exceed its hard cap.',
        path: ['default'],
      });
    }
  });

export const boundedExecutionLimitsConfigSchema = z
  .object({
    maxIterations: configuredLimitSchema,
    maxCostCents: configuredLimitSchema,
    maxWallClockMs: configuredLimitSchema,
    maxDelegations: configuredLimitSchema,
  })
  .strict();

export type BoundedExecutionLimitsConfig = z.infer<
  typeof boundedExecutionLimitsConfigSchema
>;

export const ISSUE_255_RECORDED_CALIBRATION_LIMITS =
  boundedExecutionLimitsConfigSchema.parse({
    maxIterations: { default: 2, hardCap: 4 },
    maxCostCents: { default: 'unset', hardCap: 'unset' },
    maxWallClockMs: { default: 'unset', hardCap: 'unset' },
    maxDelegations: { default: 'unset', hardCap: 'unset' },
  });

export class AdminConfigBoundedExecutionLimitsSource {
  constructor(
    private readonly repository: Pick<AdminConfigRepository, 'get'>,
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
      config: boundedExecutionLimitsConfigSchema.parse(revision.value),
    };
  }
}

export class AdminConfigBoundedExecutionLimitsResolver
  implements HarnessExecutionBoundsResolver
{
  constructor(private readonly source: AdminConfigBoundedExecutionLimitsSource) {}

  async resolve() {
    const configured = await this.source.read();
    const defaults =
      configured.source === 'admin_config'
        ? Object.fromEntries(
            Object.entries(configured.config).map(([limit, axis]) => [
              limit,
              axis.default,
            ]),
          )
        : {
            maxIterations: 'unset',
            maxCostCents: 'unset',
            maxWallClockMs: 'unset',
            maxDelegations: 'unset',
          };
    return boundedExecutionLimitsSchema.parse({
      ...defaults,
      requiredLimits: [...REQUIRED_PRODUCTION_LIMITS],
    });
  }
}

export class AdminConfigBoundedExecutionContinuationResolver
  implements HarnessBoundedExecutionContinuationResolver
{
  constructor(private readonly source: AdminConfigBoundedExecutionLimitsSource) {}

  async resolve(
    input: Parameters<HarnessBoundedExecutionContinuationResolver['resolve']>[0],
  ) {
    const snapshot = boundedExecutionSnapshotSchema.parse(
      input.suspension.snapshot,
    );
    const limit = snapshot.triggeredLimit;
    if (snapshot.stopReason !== 'limit_reached' || limit === null) {
      throw new Error(
        'Bounded execution continuation requires a triggered suspension.',
      );
    }
    const configured = await this.source.read();
    if (configured.source !== 'admin_config') {
      throw new Error(
        'Bounded execution continuation config is unavailable.',
      );
    }
    const axis = configured.config[limit];
    const previous = snapshot[limit];
    if (
      axis.default === 'unset' ||
      axis.hardCap === 'unset' ||
      previous === 'unset'
    ) {
      throw new Error(
        `Bounded execution limit ${limit} is unset and cannot continue.`,
      );
    }
    if (previous >= axis.hardCap) {
      throw new Error(
        `Bounded execution limit ${limit} reached its hard cap.`,
      );
    }
    return {
      limit,
      value: Math.min(axis.hardCap, previous + axis.default),
    };
  }
}
