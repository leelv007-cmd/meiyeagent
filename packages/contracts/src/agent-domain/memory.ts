/**
 * Agent-domain: Memory (V3.1 §12.5).
 */

import { z } from 'zod';

import {
  agentRunIdSchema,
  harnessReleaseIdSchema,
  identifierSchema,
  memoryIdSchema,
  merchantResourceIdSchema,
  nonEmptyTrimmedStringSchema,
} from '../identifiers.js';
import { agentEvidenceRefSchema } from './shared.js';
import { revisionNumberSchema, timestampSchema } from './internal.js';

// ─── 5. Memory (V3.1 §12.5) ─────────────────────────────────────────────────

export const AGENT_MEMORY_ENTRY_SCHEMA_VERSION = 'agent-memory-entry/v1' as const;

export const agentMemoryKindSchema = z.enum([
  'working',
  'preference',
  'episode',
  'procedure',
  'correction',
]);

export const agentMemoryAuthoritySchema = z.enum([
  'observation',
  'session',
  'strong',
  'confirmed',
]);

export const agentMemoryStateSchema = z.enum([
  'active',
  'proposed',
  'superseded',
  'revoked',
  'expired',
]);

export const agentMemoryScopeSchema = z
  .object({
    storeId: identifierSchema.optional(),
    personaId: identifierSchema.optional(),
    scene: identifierSchema.optional(),
    platform: identifierSchema.optional(),
  })
  .strict();

export type AgentMemoryScope = z.infer<typeof agentMemoryScopeSchema>;

export const agentMemoryEntrySchema = z
  .object({
    schemaVersion: z.literal(AGENT_MEMORY_ENTRY_SCHEMA_VERSION),
    memoryId: memoryIdSchema,
    resourceId: merchantResourceIdSchema,
    kind: agentMemoryKindSchema,
    scope: agentMemoryScopeSchema,
    authority: agentMemoryAuthoritySchema,
    state: agentMemoryStateSchema,
    statement: nonEmptyTrimmedStringSchema.max(4_000),
    evidenceRefs: z.array(agentEvidenceRefSchema).max(100),
    confidence: z.number().min(0).max(1),
    effectiveFrom: timestampSchema,
    expiresAt: timestampSchema.optional(),
    revision: revisionNumberSchema,
  })
  .strict();

export type AgentMemoryEntry = z.infer<typeof agentMemoryEntrySchema>;

export const MEMORY_INJECTION_RECEIPT_SCHEMA_VERSION =
  'memory-injection-receipt/v1' as const;

/** Trace projection: which memories were injected into a run/task (MAJOR-12). */
export const memoryInjectionReceiptSchema = z
  .object({
    schemaVersion: z.literal(MEMORY_INJECTION_RECEIPT_SCHEMA_VERSION),
    taskId: identifierSchema,
    runId: agentRunIdSchema,
    harnessReleaseId: harnessReleaseIdSchema,
    entries: z
      .array(
        z
          .object({
            memoryId: memoryIdSchema,
            statement: nonEmptyTrimmedStringSchema.max(4_000),
            revision: revisionNumberSchema,
            /** Optional on put-once v1 rows written before source projection. */
            source: z
              .object({
                preview: nonEmptyTrimmedStringSchema.max(500).optional(),
                observedAt: timestampSchema.optional(),
                deleted: z.boolean(),
              })
              .strict()
              .optional(),
            /**
             * V31-34 / FIX-P1-02: read-time authority only. Never persisted as
             * the receipt identity — derived from the workspace preference head
             * so the panel survives refresh without local mutation state.
             */
            currentStatus: z
              .enum(['confirmed', 'revoked', 'superseded', 'unavailable'])
              .optional(),
          })
          .strict(),
      )
      .max(100),
    injectedAt: timestampSchema,
  })
  .strict();

export type MemoryInjectionReceipt = z.infer<typeof memoryInjectionReceiptSchema>;

