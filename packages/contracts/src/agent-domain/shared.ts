/**
 * Shared revision / evidence pointers used across agent-domain contracts.
 */

import { z } from 'zod';

import {
  identifierSchema,
  nonEmptyTrimmedStringSchema,
} from '../identifiers.js';
import { revisionNumberSchema } from './internal.js';

// ─── Shared refs ────────────────────────────────────────────────────────────

/** Opaque revision pointer (quote / policy / content package). */
export const agentRevisionRefSchema = z
  .object({
    id: identifierSchema,
    revision: z.union([revisionNumberSchema, nonEmptyTrimmedStringSchema]),
  })
  .strict();

export type AgentRevisionRef = z.infer<typeof agentRevisionRefSchema>;

/** Evidence pointer used by Goal / Memory / Outcome. */
export const agentEvidenceRefSchema = z
  .object({
    kind: nonEmptyTrimmedStringSchema.max(100),
    ref: nonEmptyTrimmedStringSchema.max(500),
  })
  .strict();

export type AgentEvidenceRef = z.infer<typeof agentEvidenceRefSchema>;

