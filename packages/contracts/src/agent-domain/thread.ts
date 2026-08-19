/**
 * Agent-domain: Thread (V3.1 §9 + U6 sessionRevision).
 */

import { z } from 'zod';

import {
  agentThreadIdSchema,
  marketingGoalIdSchema,
  merchantResourceIdSchema,
  nonEmptyTrimmedStringSchema,
} from '../identifiers.js';
import { revisionNumberSchema, timestampSchema } from './internal.js';

// ─── 1. Thread (V3.1 §9 + U6 sessionRevision) ───────────────────────────────

export const AGENT_THREAD_SCHEMA_VERSION = 'agent-thread/v1' as const;

export const agentThreadStatusSchema = z.enum(['active', 'archived']);

export const agentThreadSchema = z
  .object({
    schemaVersion: z.literal(AGENT_THREAD_SCHEMA_VERSION),
    threadId: agentThreadIdSchema,
    resourceId: merchantResourceIdSchema,
    title: nonEmptyTrimmedStringSchema.max(500),
    status: agentThreadStatusSchema,
    activeGoalIds: z.array(marketingGoalIdSchema).max(50),
    /** Summary compaction generation — does not participate in OCC. */
    summaryRevision: revisionNumberSchema,
    /**
     * OCC cursor for single active write turn (U6). Independent column from
     * summaryRevision — summary updates must not arbitrate concurrency.
     */
    sessionRevision: revisionNumberSchema,
    summary: nonEmptyTrimmedStringSchema.max(8_000).optional(),
    lastRunAt: timestampSchema.optional(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export type AgentThread = z.infer<typeof agentThreadSchema>;

