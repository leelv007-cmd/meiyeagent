import { z } from 'zod';

import {
  boundedExecutionEventSchema,
  boundedExecutionSnapshotSchema,
  type BoundedExecutionEvent,
} from './bounded-execution.js';
import {
  notePageRegeneratedEventSchema,
  notePageRegeneratedPayloadSchema,
  type NotePageRegeneratedEvent,
} from './note-page-regenerated.js';
import {
  observabilityAxesSchema,
  type ObservabilityAxes,
} from './observability.js';
import { productSettlementStatuses } from './product-quote.js';

const observabilityIdSchema = z.string().trim().min(1).max(500);
const observabilityAuditReferenceSchema = z
  .string()
  .regex(/^ref:[a-f0-9]{64}$/u);
const deliveryRatingVerdictSchema = z.enum(['up', 'down']);
const nullableObservabilityAxesShape = {
  skillRevision: observabilityAxesSchema.shape.skillRevision.nullable(),
  promptVersion: observabilityAxesSchema.shape.promptVersion.nullable(),
  catalogRevision: observabilityAxesSchema.shape.catalogRevision.nullable(),
  scene: observabilityAxesSchema.shape.scene.nullable(),
};

const deliveryRatingIdentityShape = {
  packageId: observabilityIdSchema,
  versionId: observabilityIdSchema,
  revision: z.number().int().nonnegative().safe(),
};

export const actionUsageSchema = z
  .object({
    actionId: observabilityIdSchema,
    taskId: observabilityIdSchema,
    status: z.enum(['completed', 'rejected']),
    settlementStatus: z.enum(productSettlementStatuses),
    settledUnits: z.number().int().nonnegative().safe(),
    refundedUnits: z.number().int().nonnegative().safe(),
  })
  .strict()
  .superRefine((usage, context) => {
    if (usage.status === 'rejected' && usage.settledUnits !== 0) {
      context.addIssue({
        code: 'custom',
        message: 'Rejected actions must explicitly settle zero merchant units.',
        path: ['settledUnits'],
      });
    }
  });

export type ActionUsage = z.infer<typeof actionUsageSchema>;

const observabilityEnvelopeShape = {
  taskId: observabilityIdSchema,
  axisScope: z.enum(['task_root', 'execution_child']),
  ...nullableObservabilityAxesShape,
};

const deliveryRatingRecordedEventSchema = z
  .object({
    eventType: z.literal('delivery_rating.recorded'),
    ...observabilityEnvelopeShape,
    payload: z
      .object({
        ...deliveryRatingIdentityShape,
        verdict: deliveryRatingVerdictSchema,
      })
      .strict(),
  })
  .strict();

const deliveryRatingWithdrawnEventSchema = z
  .object({
    eventType: z.literal('delivery_rating.withdrawn'),
    ...observabilityEnvelopeShape,
    payload: z
      .object({
        ...deliveryRatingIdentityShape,
        previousVerdict: deliveryRatingVerdictSchema,
      })
      .strict(),
  })
  .strict();

export const merchantDeliveryRatingEventInputSchema = z.discriminatedUnion(
  'eventType',
  [
    z
      .object({
        eventType: z.literal('delivery_rating.recorded'),
        taskId: observabilityIdSchema,
        payload: z
          .object({
            ...deliveryRatingIdentityShape,
            verdict: deliveryRatingVerdictSchema,
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        eventType: z.literal('delivery_rating.withdrawn'),
        taskId: observabilityIdSchema,
        payload: z
          .object({
            ...deliveryRatingIdentityShape,
            previousVerdict: deliveryRatingVerdictSchema,
          })
          .strict(),
      })
      .strict(),
  ],
);

export type MerchantDeliveryRatingEventInput = z.infer<
  typeof merchantDeliveryRatingEventInputSchema
>;

const actionUsageRecordedEventSchema = z
  .object({
    eventType: z.literal('action_usage.recorded'),
    ...observabilityEnvelopeShape,
    payload: actionUsageSchema,
  })
  .strict();

const boundedExecutionSuspendedObservabilityEventSchema = z
  .object({
    eventType: z.literal('bounded_execution.suspended'),
    ...observabilityEnvelopeShape,
    payload: z
      .object({
        snapshot: boundedExecutionSnapshotSchema,
        currentBest: z.json(),
        unmetExplanation: z.string().trim().min(1),
        resumable: z.literal(true),
      })
      .strict(),
  })
  .strict();

const boundedExecutionResumedObservabilityEventSchema = z
  .object({
    eventType: z.literal('bounded_execution.resumed'),
    ...observabilityEnvelopeShape,
    payload: z
      .object({
        previousSnapshot: boundedExecutionSnapshotSchema,
        snapshot: boundedExecutionSnapshotSchema,
        decisionId: observabilityIdSchema,
      })
      .strict(),
  })
  .strict();

const notePageRegeneratedObservabilityEventSchema = z
  .object({
    eventType: z.literal('note_page_regenerated'),
    ...observabilityEnvelopeShape,
    payload: notePageRegeneratedPayloadSchema,
  })
  .strict();

export const agentPrimitiveRejectionClassSchema = z.enum([
  'request_invalid',
  'actor_forbidden',
  'billing_identity_missing',
  'execution_budget_exceeded',
  'execution_failed',
  'execution_uncertain',
]);

export type AgentPrimitiveRejectionClass = z.infer<
  typeof agentPrimitiveRejectionClassSchema
>;

const agentPrimitiveBillingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not_billed') }).strict(),
  z
    .object({
      kind: z.literal('product_usage'),
      productUsageTaskId: observabilityIdSchema,
      quoteId: observabilityIdSchema,
    })
    .strict(),
]);

const agentPrimitiveLifecyclePayloadSchema = z.discriminatedUnion('phase', [
  z
    .object({
      primitiveId: observabilityIdSchema,
      phase: z.literal('invoked'),
      billing: agentPrimitiveBillingSchema,
    })
    .strict(),
  z
    .object({
      primitiveId: observabilityIdSchema,
      phase: z.literal('succeeded'),
      billing: agentPrimitiveBillingSchema,
    })
    .strict(),
  z
    .object({
      primitiveId: observabilityIdSchema,
      phase: z.literal('rejected'),
      billing: agentPrimitiveBillingSchema,
      rejectionClass: agentPrimitiveRejectionClassSchema,
    })
    .strict(),
]);

export const agentPrimitiveLifecycleEventSchema = z
  .object({
    eventType: z.literal('agent_primitive.lifecycle'),
    taskId: observabilityIdSchema,
    workspaceId: observabilityIdSchema,
    actorId: observabilityAuditReferenceSchema,
    actorKind: z.enum([
      'admin',
      'owner',
      'operator',
      'reviewer',
      'worker',
      'payment',
    ]),
    idempotencyKey: observabilityIdSchema,
    axisScope: z.enum(['task_root', 'execution_child']),
    ...nullableObservabilityAxesShape,
    payload: agentPrimitiveLifecyclePayloadSchema,
  })
  .strict();

export type AgentPrimitiveLifecycleEvent = z.infer<
  typeof agentPrimitiveLifecycleEventSchema
>;

export const observabilityEventSchema = z
  .discriminatedUnion('eventType', [
    deliveryRatingRecordedEventSchema,
    deliveryRatingWithdrawnEventSchema,
    actionUsageRecordedEventSchema,
    boundedExecutionSuspendedObservabilityEventSchema,
    boundedExecutionResumedObservabilityEventSchema,
    notePageRegeneratedObservabilityEventSchema,
    agentPrimitiveLifecycleEventSchema,
  ])
  .superRefine((event, context) => {
    if (
      event.eventType === 'action_usage.recorded' &&
      event.taskId !== event.payload.taskId
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Action usage must belong to the envelope task.',
        path: ['payload', 'taskId'],
      });
    }
    if (
      event.eventType === 'bounded_execution.suspended' ||
      event.eventType === 'bounded_execution.resumed'
    ) {
      const sourceEvent = {
        event: event.eventType,
        skillRevision: event.skillRevision ?? 'absent@1',
        promptVersion: event.promptVersion ?? 'absent@1',
        catalogRevision: event.catalogRevision ?? 'absent',
        scene: event.scene ?? 'absent',
        ...event.payload,
      };
      if (!boundedExecutionEventSchema.safeParse(sourceEvent).success) {
        context.addIssue({
          code: 'custom',
          message:
            'Bounded execution observability payload must preserve the domain event contract.',
          path: ['payload'],
        });
      }
    }
  });

export type ObservabilityEvent = z.infer<typeof observabilityEventSchema>;

export function canonicalizeBoundedExecutionEvent(
  taskId: string,
  event: BoundedExecutionEvent,
): ObservabilityEvent {
  const parsed = boundedExecutionEventSchema.parse(event);
  const {
    event: eventType,
    skillRevision,
    promptVersion,
    catalogRevision,
    scene,
    ...payload
  } = parsed;
  return observabilityEventSchema.parse({
    eventType,
    taskId,
    axisScope: 'execution_child',
    skillRevision,
    promptVersion,
    catalogRevision,
    scene,
    payload,
  });
}

export function canonicalizeNotePageRegeneratedEvent(
  taskId: string,
  axes: ObservabilityAxes,
  event: NotePageRegeneratedEvent,
): ObservabilityEvent {
  const parsedAxes = observabilityAxesSchema.parse(axes);
  const parsedEvent = notePageRegeneratedEventSchema.parse(event);
  return observabilityEventSchema.parse({
    eventType: parsedEvent.eventType,
    taskId,
    axisScope: 'execution_child',
    ...parsedAxes,
    payload: parsedEvent.payload,
  });
}
