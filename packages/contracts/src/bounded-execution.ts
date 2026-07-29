import { z } from 'zod';
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

const boundedExecutionSuspendedEventSchema = z
  .object({
    event: z.literal('bounded_execution.suspended'),
    ...observabilityAxesSchema.shape,
    snapshot: boundedExecutionSnapshotSchema,
    currentBest: z.json(),
    unmetExplanation: z.string().trim().min(1),
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
  });

const boundedExecutionResumedEventSchema = z
  .object({
    event: z.literal('bounded_execution.resumed'),
    ...observabilityAxesSchema.shape,
    previousSnapshot: boundedExecutionSnapshotSchema,
    snapshot: boundedExecutionSnapshotSchema,
    decisionId: z.string().trim().min(1),
  })
  .strict()
  .superRefine((event, context) => {
    if (
      event.previousSnapshot.stopReason !== 'limit_reached' ||
      event.snapshot.stopReason !== null
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'A resume event requires a triggered predecessor and an active successor.',
        path: ['snapshot', 'stopReason'],
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
