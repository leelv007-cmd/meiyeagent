/**
 * Agent-domain: Interrupt protocol (V3.1 §27.6 / D-169① / V31-14)
 * and workbench session projection (MEM-02 / R-P1-07).
 */

import { z } from 'zod';

import {
  agentRunIdSchema,
  agentThreadIdSchema,
  identifierSchema,
  interruptIdSchema,
  merchantResourceIdSchema,
  nonEmptyTrimmedStringSchema,
} from '../identifiers.js';
import { jsonValueSchema, revisionNumberSchema, timestampSchema } from './internal.js';

// ─── 11. Interrupt protocol (V3.1 §27.6 / D-169① / V31-14) ───────────────────
//
// Typed HITL envelope for DBOS suspend/resume. Resume is always by stable
// interruptId + revision CAS — never by list position (dependency groups can
// emit multiple pending interrupts in one batch).
// expiresAt is optional and only appears when a business rule itself has a
// deadline (e.g. D-153 paid confirmation hold). Ordinary ask_merchant must not
// expire because of a carrier TTL.

export const INTERRUPT_PAYLOAD_SCHEMA_VERSION = 'interrupt-payload/v1' as const;

export const interruptActionSchema = z.enum([
  'confirm_paid_execution',
  'resolve_rights',
  'answer_question',
  'confirm_plan',
  'bounded_execution_continuation',
  'fact_change_ack',
  'other',
]);

export type InterruptAction = z.infer<typeof interruptActionSchema>;

export const interruptConfigSchema = z
  .object({
    allowAccept: z.boolean(),
    allowEdit: z.boolean(),
    allowReject: z.boolean(),
    allowRespond: z.boolean(),
  })
  .strict();

export type InterruptConfig = z.infer<typeof interruptConfigSchema>;

export const interruptPayloadSchema = z
  .object({
    schemaVersion: z.literal(INTERRUPT_PAYLOAD_SCHEMA_VERSION),
    interruptId: interruptIdSchema,
    threadId: agentThreadIdSchema,
    runId: agentRunIdSchema,
    workflowId: identifierSchema,
    /** D-169① resume triple coordinate with runId + resumeData. */
    step: nonEmptyTrimmedStringSchema.max(200),
    /** CAS cursor (maps to QuestionCard.workflowRevision). */
    revision: revisionNumberSchema,
    action: interruptActionSchema,
    args: jsonValueSchema,
    config: interruptConfigSchema,
    description: nonEmptyTrimmedStringSchema.max(4_000),
    /**
     * Optional business deadline only (e.g. confirmation hold). Must not be set
     * for ordinary ask_merchant (D-116 / D-169① carrier TTL ban).
     */
    expiresAt: timestampSchema.optional(),
    /** Workspace/resource that owns this interrupt (listPending auth boundary). */
    resourceId: merchantResourceIdSchema,
  })
  .strict();

export type InterruptPayload = z.infer<typeof interruptPayloadSchema>;

export const resumeInterruptTypeSchema = z.enum([
  'accept',
  'edit',
  'reject',
  'respond',
]);

export type ResumeInterruptType = z.infer<typeof resumeInterruptTypeSchema>;

/** Client → server resume. CAS on interruptId + revision; no position index. */
export const resumeInterruptCommandSchema = z
  .object({
    schemaVersion: z.literal(INTERRUPT_PAYLOAD_SCHEMA_VERSION),
    interruptId: interruptIdSchema,
    revision: revisionNumberSchema,
    type: resumeInterruptTypeSchema,
    args: jsonValueSchema.optional(),
    /** Optional client idempotency key for at-least-once submit. */
    idempotencyKey: identifierSchema.optional(),
  })
  .strict();

export type ResumeInterruptCommand = z.infer<typeof resumeInterruptCommandSchema>;

/** listPendingInterrupts query: workspace/resource auth; threadId is filter only. */
export const listPendingInterruptsQuerySchema = z
  .object({
    resourceId: merchantResourceIdSchema,
    threadId: agentThreadIdSchema.optional(),
  })
  .strict();

export type ListPendingInterruptsQuery = z.infer<
  typeof listPendingInterruptsQuerySchema
>;

/** Current or recent Work/task bound to one Thread (MEM-02 / R-P1-07). */
export type WorkbenchSessionTaskRef = {
  taskId: string;
  workId?: string;
};

/**
 * Minimal workbench session projection for reconnect/replay — the cross-tier
 * shape shared by Core session resolve, semantic-event snapshot replay and the
 * App Shell reducer (three byte-identical local copies until 2026-08-12).
 */
export type WorkbenchSessionProjection = {
  resourceId: string;
  threadId: string;
  sessionRevision: number;
  activeRunId?: string;
  title?: string;
  /** Active Work/task on this Thread, if a write turn is still in flight. */
  current?: WorkbenchSessionTaskRef;
  /** Most recent Work/task on this Thread, including delivered. */
  recent?: WorkbenchSessionTaskRef;
};
