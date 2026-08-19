/**
 * Agent-domain: Release (V3.1 §29 + §21.2 controlLimits).
 */

import { z } from 'zod';

import {
  harnessReleaseIdSchema,
  identifierSchema,
  nonEmptyTrimmedStringSchema,
} from '../identifiers.js';
import {
  promptRevisionRefSchema,
  skillManifestRefSchema,
} from './execution-plan.js';
import { agentRevisionRefSchema } from './shared.js';
import {
  hashStringSchema,
  positiveRevisionSchema,
  timestampSchema,
} from './internal.js';

// ─── 8. Release (V3.1 §29 + §21.2 controlLimits) ─────────────────────────────

export const HARNESS_RELEASE_ARTIFACT_SCHEMA_VERSION =
  'harness-release-artifact/v1' as const;

export const agentControlLimitsSchema = z
  .object({
    maxLlmSteps: z.number().int().positive().max(100),
    maxToolCalls: z.number().int().positive().max(200),
    maxRetrievalCalls: z.number().int().positive().max(100),
    maxMerchantQuestions: z.number().int().positive().max(20),
    maxReplans: z.number().int().nonnegative().max(20),
    maxSchemaRepairs: z.number().int().nonnegative().max(20),
    maxContextTokens: z.number().int().positive().max(2_000_000),
    maxDelegations: z.number().int().nonnegative().max(50),
  })
  .strict();

export type AgentControlLimits = z.infer<typeof agentControlLimitsSchema>;

export const harnessMiddlewareBindingSchema = z
  .object({
    policyId: nonEmptyTrimmedStringSchema.max(200),
    revision: nonEmptyTrimmedStringSchema.max(200),
    kind: z.enum([
      'before_model',
      'after_model',
      'wrap_model',
      'wrap_tool_call',
    ]),
    order: z.number().int().nonnegative().safe(),
    allowedControlActions: z
      .array(z.enum(['continue', 'end_turn', 'ask_merchant']))
      .min(1)
      .max(3),
  })
  .strict();

export type HarnessMiddlewareBinding = z.infer<
  typeof harnessMiddlewareBindingSchema
>;

export const harnessReleaseArtifactSchema = z
  .object({
    schemaVersion: z.literal(HARNESS_RELEASE_ARTIFACT_SCHEMA_VERSION),
    releaseId: harnessReleaseIdSchema,
    version: positiveRevisionSchema,
    manifestHash: hashStringSchema,
    agentSessionHarnessVersion: nonEmptyTrimmedStringSchema.max(100),
    makeHarnessVersion: nonEmptyTrimmedStringSchema.max(100),
    /** MAJOR-01: policy composition frozen with the release. */
    middlewareBindings: z.array(harnessMiddlewareBindingSchema).max(100),
    /** U11: calibrated control limits published with the release (no unset). */
    controlLimits: agentControlLimitsSchema,
    supervisorPolicyRef: agentRevisionRefSchema,
    memoryPolicyRef: agentRevisionRefSchema,
    contextCompilerRef: agentRevisionRefSchema,
    planSchemaRevision: nonEmptyTrimmedStringSchema.max(200),
    promptBindings: z.record(nonEmptyTrimmedStringSchema, promptRevisionRefSchema),
    promptPackBindings: z.record(
      nonEmptyTrimmedStringSchema,
      z.array(nonEmptyTrimmedStringSchema.max(200)).max(50),
    ),
    schemaBindings: z.record(
      nonEmptyTrimmedStringSchema,
      nonEmptyTrimmedStringSchema.max(200),
    ),
    skillBindings: z.record(
      nonEmptyTrimmedStringSchema,
      z.array(skillManifestRefSchema).max(50),
    ),
    toolPolicyRevision: nonEmptyTrimmedStringSchema.max(200),
    modelPolicyRevision: nonEmptyTrimmedStringSchema.max(200),
    factPolicyRevision: nonEmptyTrimmedStringSchema.max(200),
    rightsPolicyRevision: nonEmptyTrimmedStringSchema.max(200),
    budgetPolicyRevision: nonEmptyTrimmedStringSchema.max(200),
    evalSuiteRevision: nonEmptyTrimmedStringSchema.max(200),
    createdAt: timestampSchema,
  })
  .strict();

export type HarnessReleaseArtifact = z.infer<typeof harnessReleaseArtifactSchema>;

export const HARNESS_RELEASE_LIFECYCLE_SCHEMA_VERSION =
  'harness-release-lifecycle/v1' as const;

export const harnessReleaseLifecycleStatusSchema = z.enum([
  'draft',
  'evaluating',
  'canary',
  'production',
  'retired',
]);

export const harnessReleaseLifecycleSchema = z
  .object({
    schemaVersion: z.literal(HARNESS_RELEASE_LIFECYCLE_SCHEMA_VERSION),
    releaseId: harnessReleaseIdSchema,
    status: harnessReleaseLifecycleStatusSchema,
    approvedBy: identifierSchema.optional(),
    approvedAt: timestampSchema.optional(),
    updatedAt: timestampSchema,
  })
  .strict();

export type HarnessReleaseLifecycle = z.infer<
  typeof harnessReleaseLifecycleSchema
>;

export const HARNESS_RELEASE_ROLLOUT_SCHEMA_VERSION =
  'harness-release-rollout/v1' as const;

export const harnessReleaseRolloutSchema = z
  .object({
    schemaVersion: z.literal(HARNESS_RELEASE_ROLLOUT_SCHEMA_VERSION),
    releaseId: harnessReleaseIdSchema,
    workspaceAllowlist: z.array(identifierSchema).max(10_000),
    percentage: z.number().int().min(0).max(100).optional(),
    industryAllowlist: z.array(nonEmptyTrimmedStringSchema.max(100)).max(100).optional(),
    updatedAt: timestampSchema,
  })
  .strict();

export type HarnessReleaseRollout = z.infer<typeof harnessReleaseRolloutSchema>;

