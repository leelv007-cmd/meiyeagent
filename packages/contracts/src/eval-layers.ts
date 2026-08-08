/**
 * V3.1 Eval layers contracts (V31-23 / §31 / U3 / U12 / D-061).
 *
 * Pure contract layer — no runtime, DB, or UI.
 * Gates (fidelity/rights/redline) fail closed when any is missing or failed.
 * Thresholds support reverse max bands. Verdict three-state: passed/scored/failed.
 */

import { z } from 'zod';

import {
  harnessReleaseIdSchema,
  identifierSchema,
  nonEmptyTrimmedStringSchema,
} from './identifiers.js';

const timestampSchema = z.iso.datetime();

// ─── Gates / thresholds / verdict (A5) ───────────────────────────────────────

/** Hard gates — any missing kind or failed result forces verdict=failed. */
export const EVAL_GATE_KINDS = ['fidelity', 'rights', 'redline'] as const;
export type EvalGateKind = (typeof EVAL_GATE_KINDS)[number];
export const evalGateKindSchema = z.enum(EVAL_GATE_KINDS);

/**
 * Soft thresholds — reverse max band means higher score is worse
 * (e.g. hallucination). Unmet thresholds never fail alone; they yield scored.
 */
export const EVAL_THRESHOLD_KINDS = [
  'brand_tone',
  'readability',
  'attractiveness',
  'hallucination',
] as const;
export type EvalThresholdKind = (typeof EVAL_THRESHOLD_KINDS)[number];
export const evalThresholdKindSchema = z.enum(EVAL_THRESHOLD_KINDS);

export const evalThresholdDirectionSchema = z.enum(['min', 'max']);
export type EvalThresholdDirection = z.infer<
  typeof evalThresholdDirectionSchema
>;

export const evalVerdictStatusSchema = z.enum(['passed', 'scored', 'failed']);
export type EvalVerdictStatus = z.infer<typeof evalVerdictStatusSchema>;

export const evalGateResultSchema = z
  .object({
    id: identifierSchema,
    kind: evalGateKindSchema,
    passed: z.boolean(),
    reason: nonEmptyTrimmedStringSchema.max(500).optional(),
  })
  .strict();
export type EvalGateResult = z.infer<typeof evalGateResultSchema>;

export const evalThresholdResultSchema = z
  .object({
    id: identifierSchema,
    kind: evalThresholdKindSchema,
    score: z.number().finite(),
    /** min = score must be ≥ bound; max = reverse band, score must be ≤ bound. */
    direction: evalThresholdDirectionSchema,
    bound: z.number().finite(),
    met: z.boolean(),
    reason: nonEmptyTrimmedStringSchema.max(500).optional(),
  })
  .strict();
export type EvalThresholdResult = z.infer<typeof evalThresholdResultSchema>;

export const EVAL_LAYER_IDS = ['l0', 'l0.5', 'l1', 'l2', 'l3', 'l4'] as const;
export type EvalLayerId = (typeof EVAL_LAYER_IDS)[number];
export const evalLayerIdSchema = z.enum(EVAL_LAYER_IDS);

export const EVAL_LAYER_RESULT_SCHEMA_VERSION = 'eval-layer-result/v1' as const;

/**
 * Stored evaluation outcome bound to a HarnessRelease.
 * scored = gates all passed, some threshold unmet → releasable, bookkept only (U12).
 */
export const evalLayerResultSchema = z
  .object({
    schemaVersion: z.literal(EVAL_LAYER_RESULT_SCHEMA_VERSION),
    resultId: identifierSchema,
    layer: evalLayerIdSchema,
    harnessReleaseId: harnessReleaseIdSchema,
    evalSuiteRevision: nonEmptyTrimmedStringSchema.max(200),
    datasetRevision: nonEmptyTrimmedStringSchema.max(200).optional(),
    gates: z.array(evalGateResultSchema).max(50),
    thresholds: z.array(evalThresholdResultSchema).max(50),
    verdict: evalVerdictStatusSchema,
    /** true when verdict is scored — bookkeeping only, never auto-promote (U12). */
    scoredBookkept: z.boolean(),
    /** true for passed and scored; false only for failed. */
    releasable: z.boolean(),
    createdAt: timestampSchema,
    sampleTraceId: identifierSchema.optional(),
    quickCheckIds: z.array(identifierSchema).max(100).optional(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.verdict === 'failed' && result.releasable) {
      context.addIssue({
        code: 'custom',
        message: 'failed verdict must not be releasable',
        path: ['releasable'],
      });
    }
    if (result.verdict === 'scored' && !result.scoredBookkept) {
      context.addIssue({
        code: 'custom',
        message: 'scored verdict must set scoredBookkept=true (U12 bookkeeping)',
        path: ['scoredBookkept'],
      });
    }
    if (result.verdict === 'scored' && !result.releasable) {
      context.addIssue({
        code: 'custom',
        message: 'scored verdict is releasable (gates passed); only bookkept',
        path: ['releasable'],
      });
    }
    if (result.verdict === 'passed' && result.scoredBookkept) {
      context.addIssue({
        code: 'custom',
        message: 'passed verdict must not set scoredBookkept',
        path: ['scoredBookkept'],
      });
    }
  });
export type EvalLayerResult = z.infer<typeof evalLayerResultSchema>;

// ─── L1 dataset freeze (U3) ──────────────────────────────────────────────────

export const EVAL_DATASET_MANIFEST_SCHEMA_VERSION =
  'eval-dataset-manifest/v1' as const;

export const evalDatasetSourceSchema = z.enum([
  'fixture',
  'desensitized_history',
]);
export type EvalDatasetSource = z.infer<typeof evalDatasetSourceSchema>;

export const evalDatasetNodeSchema = z.enum([
  'intent',
  'plan',
  'make',
  'memory',
  'proactive',
]);
export type EvalDatasetNode = z.infer<typeof evalDatasetNodeSchema>;

export const evalDatasetManifestSchema = z
  .object({
    schemaVersion: z.literal(EVAL_DATASET_MANIFEST_SCHEMA_VERSION),
    datasetId: identifierSchema,
    revision: nonEmptyTrimmedStringSchema.max(200),
    source: evalDatasetSourceSchema,
    /** License / permission tag frozen with the revision (U3). */
    license: nonEmptyTrimmedStringSchema.max(200),
    frozenAt: timestampSchema,
    node: evalDatasetNodeSchema,
    caseIds: z.array(identifierSchema).min(1).max(10_000),
    provenanceNote: nonEmptyTrimmedStringSchema.max(1000).optional(),
  })
  .strict();
export type EvalDatasetManifest = z.infer<typeof evalDatasetManifestSchema>;

// ─── Full-chain trace field contract (§32 / D-061) ───────────────────────────

/**
 * Required identity / observability fields on eval-bound spans.
 * Token/cost dual-truth: never store upstream USD or raw provider token bills.
 */
export const EVAL_TRACE_REQUIRED_FIELDS = [
  'threadId',
  'runId',
  'harnessReleaseId',
] as const;
export type EvalTraceRequiredField = (typeof EVAL_TRACE_REQUIRED_FIELDS)[number];

/** Optional but expected on full-chain spans when available. */
export const EVAL_TRACE_OPTIONAL_FIELDS = [
  'parentRunId',
  'intentId',
  'planId',
  'planRevision',
  'taskId',
  'workId',
  'promptVersion',
  'skillRefs',
  'toolPolicyRevision',
  'modelRouteRevision',
  'schemaRevision',
  'latencyMs',
  'repairCount',
  'fallback',
  'interrupt',
  'terminalState',
] as const;

/**
 * Keys that must never appear on eval/trace payloads (D-061 + §32 denylist).
 * Constructive negative tests assert absence of these keys.
 */
export const EVAL_TRACE_FORBIDDEN_KEYS = [
  'apiKey',
  'api_key',
  'API_KEY',
  'secretKey',
  'secret_key',
  'authorization',
  'Authorization',
  'chainOfThought',
  'chain_of_thought',
  'rawCoT',
  'raw_cot',
  'rawThinking',
  'upstreamUsdCost',
  'upstream_usd_cost',
  'usdCost',
  'providerUsdCost',
  'provider_usd_cost',
  'upstreamTokenCost',
  'upstream_token_cost',
  'providerTokenCostUsd',
  'rawCustomerPii',
  'raw_customer_pii',
  'unredactedCustomerData',
] as const;
export type EvalTraceForbiddenKey = (typeof EVAL_TRACE_FORBIDDEN_KEYS)[number];

export const evalSafeTraceFieldsSchema = z
  .object({
    threadId: identifierSchema,
    runId: identifierSchema,
    harnessReleaseId: harnessReleaseIdSchema,
    parentRunId: identifierSchema.optional(),
    intentId: identifierSchema.optional(),
    planId: identifierSchema.optional(),
    planRevision: nonEmptyTrimmedStringSchema.max(200).optional(),
    taskId: identifierSchema.optional(),
    workId: identifierSchema.optional(),
    promptVersion: nonEmptyTrimmedStringSchema.max(200).optional(),
    skillRefs: z.array(nonEmptyTrimmedStringSchema.max(200)).max(50).optional(),
    toolPolicyRevision: nonEmptyTrimmedStringSchema.max(200).optional(),
    modelRouteRevision: nonEmptyTrimmedStringSchema.max(200).optional(),
    schemaRevision: nonEmptyTrimmedStringSchema.max(200).optional(),
    latencyMs: z.number().finite().nonnegative().optional(),
    repairCount: z.number().int().nonnegative().optional(),
    fallback: z.boolean().optional(),
    interrupt: z.boolean().optional(),
    terminalState: nonEmptyTrimmedStringSchema.max(100).optional(),
  })
  .strict();
export type EvalSafeTraceFields = z.infer<typeof evalSafeTraceFieldsSchema>;

// ─── L2/L3 trigger-bound backlog declaration ─────────────────────────────────

export const EVAL_HIGHER_LAYER_KINDS = [
  'l2_journey_replay',
  'l3_shadow',
] as const;
export type EvalHigherLayerKind = (typeof EVAL_HIGHER_LAYER_KINDS)[number];

export const EVAL_HIGHER_LAYER_BACKLOG_SCHEMA_VERSION =
  'eval-higher-layer-backlog/v1' as const;

export const evalHigherLayerBacklogEntrySchema = z
  .object({
    schemaVersion: z.literal(EVAL_HIGHER_LAYER_BACKLOG_SCHEMA_VERSION),
    kind: z.enum(EVAL_HIGHER_LAYER_KINDS),
    status: z.literal('trigger_bound_backlog'),
    trigger: z.literal('historical_tasks_hundreds'),
    /** Must be true — paid side effects forbidden when layer is built (B4). */
    readonlyGateRequired: z.literal(true),
    paidSideEffectsForbidden: z.literal(true),
  })
  .strict();
export type EvalHigherLayerBacklogEntry = z.infer<
  typeof evalHigherLayerBacklogEntrySchema
>;
