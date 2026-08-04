import { z } from 'zod';
import { nonEmptyTrimmedStringSchema } from './identifiers.js';
import { observabilityAxesSchema } from './observability.js';

export const BOUNDED_EXECUTION_LIMITS = [
  'maxIterations',
  'maxCostCents',
  'maxWallClockMs',
  'maxDelegations',
] as const;

export const boundedExecutionLimitNameSchema = z.enum(
  BOUNDED_EXECUTION_LIMITS,
);

export type BoundedExecutionLimitName = z.infer<
  typeof boundedExecutionLimitNameSchema
>;

const BOUNDED_EXECUTION_CONSUMPTION_BY_LIMIT = {
  maxIterations: 'iterations',
  maxCostCents: 'costCents',
  maxWallClockMs: 'wallClockMs',
  maxDelegations: 'delegations',
} as const satisfies Record<
  BoundedExecutionLimitName,
  keyof BoundedExecutionConsumption
>;

const boundedExecutionLimitSchema = z.union([
  z.number().int().nonnegative().safe(),
  z.literal('unset'),
]);

const boundedExecutionLimitShape = {
  maxIterations: boundedExecutionLimitSchema,
  maxCostCents: boundedExecutionLimitSchema,
  maxWallClockMs: boundedExecutionLimitSchema,
  maxDelegations: boundedExecutionLimitSchema,
};

export const boundedExecutionLimitsSchema = z
  .object({
    ...boundedExecutionLimitShape,
    requiredLimits: z.array(boundedExecutionLimitNameSchema).max(4),
  })
  .strict()
  .superRefine(assertCanonicalRequiredLimits);

export type BoundedExecutionLimits = z.infer<
  typeof boundedExecutionLimitsSchema
>;

export const boundedExecutionConsumptionSchema = z
  .object({
    iterations: z.number().int().nonnegative().safe(),
    costCents: z.number().int().nonnegative().safe(),
    wallClockMs: z.number().int().nonnegative().safe(),
    delegations: z.number().int().nonnegative().safe(),
  })
  .strict();

export type BoundedExecutionConsumption = z.infer<
  typeof boundedExecutionConsumptionSchema
>;

export const boundedExecutionSnapshotSchema = z
  .object({
    schemaVersion: z.literal('bounded-execution-snapshot/v1'),
    ...boundedExecutionLimitShape,
    requiredLimits: z.array(boundedExecutionLimitNameSchema).max(4),
    consumption: boundedExecutionConsumptionSchema,
    stopReason: z.literal('limit_reached').nullable(),
    triggeredLimit: boundedExecutionLimitNameSchema.nullable(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    assertCanonicalRequiredLimits(snapshot, context);
    if (
      (snapshot.stopReason === null) !==
      (snapshot.triggeredLimit === null)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Bounded execution stopReason and triggeredLimit must be set together.',
        path: ['stopReason'],
      });
    }
    if (
      snapshot.triggeredLimit !== null &&
      snapshot[snapshot.triggeredLimit] === 'unset'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A triggered execution limit must have an explicit value.',
        path: ['triggeredLimit'],
      });
    }
  });

export type BoundedExecutionSnapshot = z.infer<
  typeof boundedExecutionSnapshotSchema
>;

export const boundedExecutionSuspendedEventSchema = z
  .object({
    event: z.literal('bounded_execution.suspended'),
    ...observabilityAxesSchema.shape,
    snapshot: boundedExecutionSnapshotSchema,
    currentBest: z.json(),
    unmetExplanation: nonEmptyTrimmedStringSchema,
    resumable: z.literal(true),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.snapshot.stopReason !== 'limit_reached') {
      context.addIssue({
        code: 'custom',
        message: 'A suspension event requires a triggered execution snapshot.',
        path: ['snapshot', 'stopReason'],
      });
    }
    const triggeredLimit = event.snapshot.triggeredLimit;
    if (triggeredLimit === null) {
      return;
    }
    const limit = event.snapshot[triggeredLimit];
    const consumption =
      event.snapshot.consumption[
        BOUNDED_EXECUTION_CONSUMPTION_BY_LIMIT[triggeredLimit]
      ];
    if (limit !== 'unset' && consumption < limit) {
      context.addIssue({
        code: 'custom',
        message:
          'A suspension event requires consumption to reach the triggered execution limit.',
        path: ['snapshot', 'consumption'],
      });
    }
  });

export const boundedExecutionResumedEventSchema = z
  .object({
    event: z.literal('bounded_execution.resumed'),
    ...observabilityAxesSchema.shape,
    previousSnapshot: boundedExecutionSnapshotSchema,
    snapshot: boundedExecutionSnapshotSchema,
    decisionId: nonEmptyTrimmedStringSchema,
  })
  .strict()
  .superRefine((event, context) => {
    if (
      event.previousSnapshot.stopReason !== 'limit_reached' ||
      event.previousSnapshot.triggeredLimit === null ||
      event.snapshot.stopReason !== null ||
      event.snapshot.triggeredLimit !== null
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'A resume event requires a triggered predecessor and an active successor.',
        path: ['snapshot', 'stopReason'],
      });
    }
    const triggeredLimit = event.previousSnapshot.triggeredLimit;
    if (triggeredLimit === null) {
      return;
    }
    const previousLimit = event.previousSnapshot[triggeredLimit];
    const raisedLimit = event.snapshot[triggeredLimit];
    const previousConsumption =
      event.previousSnapshot.consumption[
        BOUNDED_EXECUTION_CONSUMPTION_BY_LIMIT[triggeredLimit]
      ];
    if (
      previousLimit !== 'unset' &&
      previousConsumption < previousLimit
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'A resume event requires predecessor consumption to reach the triggered limit.',
        path: ['previousSnapshot', 'consumption'],
      });
    }
    if (
      previousLimit === 'unset' ||
      raisedLimit === 'unset' ||
      raisedLimit <= previousLimit ||
      raisedLimit <= previousConsumption
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'A resume event must raise the triggered limit above previous consumption.',
        path: ['snapshot', triggeredLimit],
      });
    }
    if (event.snapshot.schemaVersion !== event.previousSnapshot.schemaVersion) {
      context.addIssue({
        code: 'custom',
        message: 'A resume event must preserve the snapshot schema version.',
        path: ['snapshot', 'schemaVersion'],
      });
    }
    if (
      event.snapshot.requiredLimits.length !==
        event.previousSnapshot.requiredLimits.length ||
      event.snapshot.requiredLimits.some(
        (limit, index) =>
          limit !== event.previousSnapshot.requiredLimits[index],
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A resume event must preserve required execution limits.',
        path: ['snapshot', 'requiredLimits'],
      });
    }
    for (const limit of BOUNDED_EXECUTION_LIMITS) {
      if (
        limit !== triggeredLimit &&
        event.snapshot[limit] !== event.previousSnapshot[limit]
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'A resume event may only change the triggered execution limit.',
          path: ['snapshot', limit],
        });
      }
    }
    if (
      event.snapshot.consumption.iterations !==
        event.previousSnapshot.consumption.iterations ||
      event.snapshot.consumption.costCents !==
        event.previousSnapshot.consumption.costCents ||
      event.snapshot.consumption.wallClockMs !==
        event.previousSnapshot.consumption.wallClockMs ||
      event.snapshot.consumption.delegations !==
        event.previousSnapshot.consumption.delegations
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A resume event must preserve execution consumption.',
        path: ['snapshot', 'consumption'],
      });
    }
  });

export const boundedExecutionEventSchema = z.discriminatedUnion('event', [
  boundedExecutionSuspendedEventSchema,
  boundedExecutionResumedEventSchema,
]);

export type BoundedExecutionEvent = z.infer<
  typeof boundedExecutionEventSchema
>;

function assertCanonicalRequiredLimits(
  input: { requiredLimits: BoundedExecutionLimitName[] },
  context: z.RefinementCtx,
) {
  const requiredLimitSet = new Set(input.requiredLimits);
  if (requiredLimitSet.size !== input.requiredLimits.length) {
    context.addIssue({
      code: 'custom',
      message: 'Required execution limits must be unique.',
      path: ['requiredLimits'],
    });
  }
  const canonicalRequiredLimits = BOUNDED_EXECUTION_LIMITS.filter((limit) =>
    requiredLimitSet.has(limit),
  );
  if (
    input.requiredLimits.some(
      (limit, index) => limit !== canonicalRequiredLimits[index],
    )
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Required execution limits must use canonical order.',
      path: ['requiredLimits'],
    });
  }
}
