/**
 * Agent-domain: Steering (V3.1 §23.3 / §24).
 */

import { z } from 'zod';

import {
  agentThreadIdSchema,
  executionUnitIdSchema,
  identifierSchema,
  nonEmptyTrimmedStringSchema,
  steeringCommandIdSchema,
} from '../identifiers.js';
import {
  hashStringSchema,
  positiveRevisionSchema,
  timestampSchema,
} from './internal.js';

// ─── 9. Steering (V3.1 §23.3 / §24) ──────────────────────────────────────────

export const STEERING_COMMAND_SCHEMA_VERSION = 'steering-command/v1' as const;

export const steeringClassificationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('future_step_patch'),
      affectedUnits: z.array(executionUnitIdSchema).min(1).max(100),
      requiresRequote: z.literal(false),
    })
    .strict(),
  z
    .object({
      kind: z.literal('derived_revision'),
      completedUnits: z.array(executionUnitIdSchema).max(100),
      requiresRequote: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('plan_change'),
      reason: nonEmptyTrimmedStringSchema.max(2_000),
      requiresReplan: z.literal(true),
    })
    .strict(),
  z
    .object({
      kind: z.literal('unsafe_or_conflicting'),
      reason: nonEmptyTrimmedStringSchema.max(2_000),
    })
    .strict(),
]);

export type SteeringClassification = z.infer<typeof steeringClassificationSchema>;

/** Dual queue: steer = interrupt-after-unit; follow_up = after all units (B7). */
export const steeringQueueModeSchema = z.enum(['steer', 'follow_up']);

/**
 * Server-projected unit progress for Make steering authority (V31-107).
 * `label` / `pageIndex` are optional on old rows; Core fills them from
 * `p1_make_steering_task_progress` once Make has written them.
 */
export const steeringUnitProgressSchema = z
  .object({
    unitId: executionUnitIdSchema,
    status: z.enum(['pending', 'running', 'completed', 'failed']),
    label: nonEmptyTrimmedStringSchema.max(200).optional(),
    pageIndex: z.number().int().nonnegative().max(50).optional(),
  })
  .strict();

export type SteeringUnitProgress = z.infer<typeof steeringUnitProgressSchema>;

export const makeSteeringCommandSchema = z
  .object({
    schemaVersion: z.literal(STEERING_COMMAND_SCHEMA_VERSION),
    commandId: steeringCommandIdSchema,
    threadId: agentThreadIdSchema,
    taskId: identifierSchema,
    workId: identifierSchema.optional(),
    sourcePlanRevision: positiveRevisionSchema,
    sourceContentVersionIds: z.array(identifierSchema).max(50),
    snapshotHash: hashStringSchema.optional(),
    instruction: nonEmptyTrimmedStringSchema.max(4_000),
    classification: steeringClassificationSchema,
    affectedUnitIds: z.array(executionUnitIdSchema).max(100),
    queueMode: steeringQueueModeSchema,
    createdAt: timestampSchema,
    actorId: identifierSchema,
  })
  .strict();

export type MakeSteeringCommand = z.infer<typeof makeSteeringCommandSchema>;

