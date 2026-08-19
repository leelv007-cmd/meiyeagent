/**
 * Agent-domain: Run (V3.1 §10 + durability/executionLink).
 */

import { z } from 'zod';

import {
  agentRunIdSchema,
  agentThreadIdSchema,
  harnessReleaseIdSchema,
  identifierSchema,
} from '../identifiers.js';
import { hashStringSchema, timestampSchema } from './internal.js';

// ─── 2. Run (V3.1 §10 + durability/executionLink) ───────────────────────────

export const AGENT_RUN_SCHEMA_VERSION = 'agent-run/v1' as const;

export const agentRunTriggerSchema = z.enum([
  'merchant_turn',
  'proactive_signal',
  'follow_up',
  'system_resume',
]);

export const agentRunStatusSchema = z.enum([
  'running',
  'waiting',
  'completed',
  'failed',
  'cancelled',
]);

export const agentRunDurabilitySchema = z.enum(['exit', 'sync']);

/**
 * Session run → DBOS execution link. Required when durability=sync; immutable
 * after create (parentRunId + workflowId + snapshotHash association).
 */
export const agentRunExecutionLinkSchema = z
  .object({
    workflowId: identifierSchema,
    snapshotHash: hashStringSchema,
  })
  .strict();

export type AgentRunExecutionLink = z.infer<typeof agentRunExecutionLinkSchema>;

export const agentRunSchema = z
  .object({
    schemaVersion: z.literal(AGENT_RUN_SCHEMA_VERSION),
    runId: agentRunIdSchema,
    threadId: agentThreadIdSchema,
    parentRunId: agentRunIdSchema.optional(),
    trigger: agentRunTriggerSchema,
    status: agentRunStatusSchema,
    /**
     * Immutable after create. exit = read-only session turn; sync = paid-side
     * effect child run linked to DBOS via executionLink.
     */
    durability: agentRunDurabilitySchema,
    harnessReleaseId: harnessReleaseIdSchema,
    /**
     * Present iff durability=sync. Creation-time immutable link to workflow +
     * frozen ExecutionPlanSnapshot hash.
     */
    executionLink: agentRunExecutionLinkSchema.optional(),
    startedAt: timestampSchema,
    finishedAt: timestampSchema.optional(),
  })
  .strict()
  .superRefine((run, context) => {
    if (run.durability === 'sync' && !run.executionLink) {
      context.addIssue({
        code: 'custom',
        message:
          'sync AgentRun requires immutable executionLink (workflowId + snapshotHash).',
        path: ['executionLink'],
      });
    }
    if (run.durability === 'exit' && run.executionLink) {
      context.addIssue({
        code: 'custom',
        message: 'exit AgentRun must not carry executionLink (no paid side effects).',
        path: ['executionLink'],
      });
    }
  });

export type AgentRun = z.infer<typeof agentRunSchema>;

