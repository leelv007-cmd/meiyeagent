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
    // 'unset' means the axis was never calibrated, so admission must fail
    // closed. 'deliberately_unbounded' means someone decided this axis carries
    // no ceiling and signed for it; the runtime meaning of the value is the
    // same (the controller never triggers an 'unset' axis), but admission stops
    // treating the axis as a missing calibration. D-167 (2026-07-30).
    provenance: z
      .enum(['recorded_provisional', 'deliberately_unbounded', 'unset'])
      .optional(),
    authorization: z
      .object({
        owner: z.string().trim().min(1).max(200),
        reason: z.string().trim().min(1).max(500),
        recordedAt: z.string().datetime(),
      })
      .strict()
      .optional(),
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
    if (
      axis.provenance === 'recorded_provisional' &&
      axis.default === 'unset'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A provisional bounded execution axis must be configured.',
        path: ['provenance'],
      });
    }
    if (
      axis.provenance === 'unset' &&
      axis.default !== 'unset'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'An unset bounded execution axis cannot carry a value.',
        path: ['provenance'],
      });
    }
    if (
      axis.provenance === 'deliberately_unbounded' &&
      axis.default !== 'unset'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A deliberately unbounded axis cannot carry a ceiling.',
        path: ['provenance'],
      });
    }
    if (
      (axis.provenance === 'deliberately_unbounded') !==
      (axis.authorization !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'A deliberately unbounded axis needs an accountable authorization, and only that provenance may carry one.',
        path: ['authorization'],
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

export const ISSUE_247_RECORDED_PROVISIONAL_LIMITS =
  boundedExecutionLimitsConfigSchema.parse({
    maxIterations: {
      default: 2,
      hardCap: 4,
      provenance: 'recorded_provisional',
    },
    maxCostCents: {
      default: 100,
      hardCap: 200,
      provenance: 'recorded_provisional',
    },
    maxWallClockMs: {
      default: 60_000,
      hardCap: 150_000,
      provenance: 'recorded_provisional',
    },
    maxDelegations: {
      default: 'unset',
      hardCap: 'unset',
      provenance: 'unset',
    },
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
    // An axis whose absent ceiling was decided and signed for is no longer a
    // missing calibration, so it drops out of the required set. Everything
    // else stays required and keeps failing admission closed.
    const deliberatelyUnbounded =
      configured.source === 'admin_config'
        ? new Set(
            Object.entries(configured.config)
              .filter(
                ([, axis]) => axis.provenance === 'deliberately_unbounded',
              )
              .map(([limit]) => limit),
          )
        : new Set<string>();
    return boundedExecutionLimitsSchema.parse({
      ...defaults,
      requiredLimits: REQUIRED_PRODUCTION_LIMITS.filter(
        (limit) => !deliberatelyUnbounded.has(limit),
      ),
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
