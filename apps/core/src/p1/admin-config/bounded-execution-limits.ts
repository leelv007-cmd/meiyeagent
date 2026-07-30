import {
  boundedExecutionLimitsSchema,
  boundedExecutionSnapshotSchema,
  type BoundedExecutionLimitName,
} from '@meiye/contracts';
import { z } from 'zod';

import type { HarnessBoundedExecutionContinuationResolver } from '../harness/dbos-workflow.js';
import { assertBoundedExecutionContinuationAuthorization } from '../harness/workflow-core.js';
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
export const BOUNDED_EXECUTION_LIVE_CALIBRATION_CONFIG_KEY =
  'harness.bounded_execution.live_calibration';

const liveCalibrationValueSchema = z.union([
  z.number().int().positive().safe(),
  z.literal('unset'),
]);
const unboundedAuthorizationSchema = z
  .object({
    owner: z.string().trim().min(1).max(200),
    reason: z.string().trim().min(1).max(500),
    recordedAt: z.string().datetime(),
  })
  .strict();
const liveCalibrationAnchorSchema = z
  .object({
    evidenceKind: z.literal('live'),
    actualAmountMicros: liveCalibrationValueSchema,
    wallClockMs: liveCalibrationValueSchema,
    costEvidenceRef: z.string().trim().min(1).max(500).optional(),
    wallClockEvidenceRef: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((anchor, context) => {
    if (anchor.actualAmountMicros !== 'unset' && !anchor.costEvidenceRef) {
      context.addIssue({
        code: 'custom',
        message: 'A live cost anchor requires a durable evidence reference.',
        path: ['costEvidenceRef'],
      });
    }
    if (anchor.wallClockMs !== 'unset' && !anchor.wallClockEvidenceRef) {
      context.addIssue({
        code: 'custom',
        message: 'A live wall-clock anchor requires a durable evidence reference.',
        path: ['wallClockEvidenceRef'],
      });
    }
  });
const safetyFactorsSchema = z
  .object({
    defaultBps: z.number().int().positive().max(100_000),
    hardCapBps: z.number().int().positive().max(100_000),
  })
  .strict()
  .refine((factors) => factors.defaultBps <= factors.hardCapBps, {
    message: 'A calibration default safety factor cannot exceed its hard cap.',
  });
const calibrationAxisPolicySchema = z.union([
  safetyFactorsSchema,
  z
    .object({
      mode: z.literal('deliberately_unbounded'),
      authorization: unboundedAuthorizationSchema,
    })
    .strict(),
]);

export const boundedExecutionLiveCalibrationConfigSchema = z
  .object({
    schemaVersion: z.literal('issue-255-live-calibration/v1'),
    anchors: z
      .object({
        copy: liveCalibrationAnchorSchema,
        image: liveCalibrationAnchorSchema,
        video: liveCalibrationAnchorSchema,
      })
      .strict(),
    policy: z
      .object({
        expectedCalls: z
          .object({
            copy: z.number().int().nonnegative().max(100),
            image: z.number().int().nonnegative().max(100),
            video: z.number().int().nonnegative().max(100),
          })
          .strict()
          .refine((calls) => calls.copy + calls.image + calls.video > 0, {
            message: 'Live calibration must cover at least one expected call.',
          }),
        observedMaxIterations: liveCalibrationValueSchema,
        iterationsEvidenceRef: z.string().trim().min(1).max(500).optional(),
        iterations: calibrationAxisPolicySchema,
        cost: calibrationAxisPolicySchema,
        wallClock: calibrationAxisPolicySchema,
      })
      .strict()
      .superRefine((policy, context) => {
        if (
          policy.observedMaxIterations !== 'unset' &&
          !policy.iterationsEvidenceRef
        ) {
          context.addIssue({
            code: 'custom',
            message:
              'A live iteration anchor requires a durable evidence reference.',
            path: ['iterationsEvidenceRef'],
          });
        }
      }),
  })
  .strict()
  .superRefine((config, context) => {
    if (config.anchors.copy.actualAmountMicros !== 12_551) {
      context.addIssue({
        code: 'custom',
        message: 'The finalized Issue 255 copy anchor must be CNY 0.012551.',
        path: ['anchors', 'copy', 'actualAmountMicros'],
      });
    }
    if (config.anchors.image.actualAmountMicros !== 50_000) {
      context.addIssue({
        code: 'custom',
        message: 'The finalized Issue 255 image anchor must be CNY 0.05.',
        path: ['anchors', 'image', 'actualAmountMicros'],
      });
    }
  });

export type BoundedExecutionLiveCalibrationConfig = z.infer<
  typeof boundedExecutionLiveCalibrationConfigSchema
>;

export const ISSUE_255_LIVE_CALIBRATION_TEMPLATE =
  boundedExecutionLiveCalibrationConfigSchema.parse({
    schemaVersion: 'issue-255-live-calibration/v1',
    anchors: {
      copy: {
        evidenceKind: 'live',
        actualAmountMicros: 12_551,
        wallClockMs: 'unset',
        costEvidenceRef: 'docs/ops/merge-ledger.md#561ab568',
      },
      image: {
        evidenceKind: 'live',
        actualAmountMicros: 50_000,
        wallClockMs: 'unset',
        costEvidenceRef: 'docs/ops/merge-ledger.md#561ab568',
      },
      video: {
        evidenceKind: 'live',
        actualAmountMicros: 'unset',
        wallClockMs: 'unset',
      },
    },
    policy: {
      expectedCalls: { copy: 1, image: 1, video: 1 },
      observedMaxIterations: 1,
      iterationsEvidenceRef: 'docs/ops/merge-ledger.md#561ab568',
      iterations: { defaultBps: 20_000, hardCapBps: 40_000 },
      cost: { defaultBps: 20_000, hardCapBps: 40_000 },
      wallClock: { defaultBps: 15_000, hardCapBps: 30_000 },
    },
  });

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
    authorization: unboundedAuthorizationSchema.optional(),
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
    const [revision, calibrationRevision] = await Promise.all([
      this.repository.get(
        'global',
        GLOBAL_WORKSPACE_ID,
        BOUNDED_EXECUTION_LIMITS_CONFIG_KEY,
      ),
      this.repository.get(
        'global',
        GLOBAL_WORKSPACE_ID,
        BOUNDED_EXECUTION_LIVE_CALIBRATION_CONFIG_KEY,
      ),
    ]);
    if (calibrationRevision) {
      return {
        source: 'admin_config' as const,
        revision: calibrationRevision.revision,
        config: deriveLiveCalibrationLimits(calibrationRevision.value),
      };
    }
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

export function deriveLiveCalibrationLimits(input: unknown) {
  const calibration = boundedExecutionLiveCalibrationConfigSchema.parse(input);
  const modalities = ['copy', 'image', 'video'] as const;
  const aggregate = (field: 'actualAmountMicros' | 'wallClockMs') => {
    let total = 0n;
    for (const modality of modalities) {
      const calls = calibration.policy.expectedCalls[modality];
      const value = calibration.anchors[modality][field];
      if (calls > 0 && value === 'unset') return 'unset' as const;
      if (value !== 'unset') total += BigInt(value) * BigInt(calls);
    }
    return total;
  };
  const iterations = calibration.policy.observedMaxIterations;
  const costMicros = aggregate('actualAmountMicros');
  const wallClockMs = aggregate('wallClockMs');
  const axis = (
    value: number | bigint | 'unset',
    policy: z.infer<typeof calibrationAxisPolicySchema>,
    divisor: number,
  ) => {
    if ('mode' in policy) {
      return {
        default: 'unset' as const,
        hardCap: 'unset' as const,
        provenance: 'deliberately_unbounded' as const,
        authorization: policy.authorization,
      };
    }
    return value === 'unset'
      ? {
          default: 'unset' as const,
          hardCap: 'unset' as const,
          provenance: 'unset' as const,
        }
      : {
          default: ceilScaled(value, policy.defaultBps, divisor),
          hardCap: ceilScaled(value, policy.hardCapBps, divisor),
        };
  };
  return boundedExecutionLimitsConfigSchema.parse({
    maxIterations: axis(iterations, calibration.policy.iterations, 10_000),
    maxCostCents: axis(costMicros, calibration.policy.cost, 100_000_000),
    maxWallClockMs: axis(wallClockMs, calibration.policy.wallClock, 10_000),
    maxDelegations: {
      default: 'unset',
      hardCap: 'unset',
      provenance: 'unset',
    },
  });
}

function ceilScaled(
  value: number | bigint,
  multiplier: number,
  divisor: number,
) {
  const exactValue = BigInt(value);
  const result =
    (exactValue * BigInt(multiplier) + BigInt(divisor) - 1n) /
    BigInt(divisor);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Derived bounded execution limit exceeds a safe integer.');
  }
  return Number(result);
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

  async capability(
    input: Parameters<
      HarnessBoundedExecutionContinuationResolver['capability']
    >[0],
  ) {
    const snapshot = boundedExecutionSnapshotSchema.safeParse(
      input.suspension.snapshot,
    );
    if (
      !snapshot.success ||
      snapshot.data.stopReason !== 'limit_reached' ||
      snapshot.data.triggeredLimit === null
    ) {
      return {
        kind: 'unavailable' as const,
        reason: 'config_unavailable' as const,
      };
    }
    const configured = await this.source.read();
    if (configured.source !== 'admin_config') {
      return {
        kind: 'unavailable' as const,
        reason: 'config_unavailable' as const,
      };
    }
    const limit = snapshot.data.triggeredLimit;
    const axis = configured.config[limit];
    const previous = snapshot.data[limit];
    if (
      axis.default === 'unset' ||
      axis.hardCap === 'unset' ||
      previous === 'unset'
    ) {
      return { kind: 'unavailable' as const, reason: 'unset' as const };
    }
    if (previous >= axis.hardCap) {
      return { kind: 'unavailable' as const, reason: 'hard_cap' as const };
    }
    return { kind: 'available' as const };
  }

  async resolve(
    input: Parameters<HarnessBoundedExecutionContinuationResolver['resolve']>[0],
  ) {
    assertBoundedExecutionContinuationAuthorization(input);
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
