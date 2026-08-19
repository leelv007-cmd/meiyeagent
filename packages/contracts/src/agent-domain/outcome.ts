/**
 * Agent-domain: Outcome (V3.1 §26 + V31-19).
 */

import { z } from 'zod';

import {
  identifierSchema,
  marketingGoalIdSchema,
  nonEmptyTrimmedStringSchema,
  outcomeEvidenceIdSchema,
} from '../identifiers.js';
import { agentRevisionRefSchema } from './shared.js';
import { timestampSchema } from './internal.js';

// ─── 10. Outcome (V3.1 §26 + V31-19) ─────────────────────────────────────────
//
// Canonical write contract for result evidence (MAJOR-13 / V31-19).
// Physical store = existing ContentPackage.resultSignals / manual outcome path;
// result ledger and observability may only project — never dual-write.
// Deletion (D-168② for evidence): append-only withdraw only; no hard delete.

export const OUTCOME_EVIDENCE_SCHEMA_VERSION = 'outcome-evidence/v1' as const;

/**
 * Operating signals for OutcomeEvidence.
 * `no_activity` is the explicit U2「没动静」chip — never encode via `feedback`.
 */
export const outcomeSignalSchema = z.enum([
  'published',
  'attention',
  'inquiry',
  'wechat',
  'booking',
  'purchase',
  'redeemed',
  'visit',
  'feedback',
  /** Explicit negative chip: merchant reports no activity (U2 / V31-19). */
  'no_activity',
]);

export type OutcomeSignal = z.infer<typeof outcomeSignalSchema>;

/** Merchant-facing self-report chips (U2 six chips). */
export const OUTCOME_SELF_REPORT_CHIP_SIGNALS = [
  'inquiry',
  'wechat',
  'booking',
  'purchase',
  'visit',
  'no_activity',
] as const satisfies readonly OutcomeSignal[];

export type OutcomeSelfReportChipSignal =
  (typeof OUTCOME_SELF_REPORT_CHIP_SIGNALS)[number];

/**
 * Three evidence tiers (V3.1 §26.1).
 * `inferred` = temporal correlation only — never causality.
 */
export const outcomeSourceSchema = z.enum([
  'verified',
  'merchant_reported',
  'inferred',
]);

export type OutcomeSource = z.infer<typeof outcomeSourceSchema>;

/**
 * Append-only lifecycle of a ledger row.
 * Superseded is usually derived by latest projection from later supersedes links;
 * withdrawn rows are explicit negative appends (D-168② — no hard delete).
 */
export const outcomeEvidenceLifecycleStatusSchema = z.enum([
  'active',
  'superseded',
  'withdrawn',
]);

export type OutcomeEvidenceLifecycleStatus = z.infer<
  typeof outcomeEvidenceLifecycleStatusSchema
>;

export const outcomeEvidenceWriteActionSchema = z.enum([
  'record',
  'correct',
  'withdraw',
]);

export type OutcomeEvidenceWriteAction = z.infer<
  typeof outcomeEvidenceWriteActionSchema
>;

export const outcomeEvidenceSchema = z
  .object({
    schemaVersion: z.literal(OUTCOME_EVIDENCE_SCHEMA_VERSION),
    evidenceId: outcomeEvidenceIdSchema,
    /** Tenant isolation key — required for P1 write path. */
    workspaceId: identifierSchema,
    /** Exact ContentPackage id + revision binding (V31-19). */
    contentPackageRef: agentRevisionRefSchema,
    goalId: marketingGoalIdSchema.optional(),
    signal: outcomeSignalSchema,
    source: outcomeSourceSchema,
    value: z.number().finite().optional(),
    /** Merchant clock for when the signal happened. */
    observedAt: timestampSchema,
    /**
     * Optional external source pointer (receipt / screenshot ref / link id).
     * Participates in the submit idempotency key with observedAt.
     */
    sourceRef: nonEmptyTrimmedStringSchema.max(500).optional(),
    /** When the ledger row was written (server clock). */
    recordedAt: timestampSchema,
    actorId: identifierSchema,
    note: nonEmptyTrimmedStringSchema.max(120).optional(),
    status: outcomeEvidenceLifecycleStatusSchema,
    /** Append-only correction/withdraw chain. */
    supersedesEvidenceId: outcomeEvidenceIdSchema.optional(),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.source === 'inferred') {
      // Inferred may only express temporal association — reject causal value framing.
      // value is allowed as a mirrored quantity from merchant, but signal must not
      // be a negative "no activity" inventing absence as causality.
      if (evidence.signal === 'no_activity') {
        context.addIssue({
          code: 'custom',
          message:
            'inferred outcome evidence cannot use no_activity (absence is merchant-reported only).',
          path: ['signal'],
        });
      }
    }
    if (evidence.status === 'withdrawn' && !evidence.supersedesEvidenceId) {
      context.addIssue({
        code: 'custom',
        message: 'withdrawn evidence must reference the superseded row.',
        path: ['supersedesEvidenceId'],
      });
    }
    if (evidence.status === 'active' && evidence.supersedesEvidenceId) {
      // Correct appends stay active and point at the prior row.
      return;
    }
  });

export type OutcomeEvidence = z.infer<typeof outcomeEvidenceSchema>;

/**
 * Submit idempotency key (V3.1 §26.1 / MAJOR-13):
 * contentPackageRef + signal + observedAt/sourceRef
 */
export function buildOutcomeEvidenceIdempotencyKey(input: {
  contentPackageId: string;
  contentPackageRevision: number | string;
  signal: OutcomeSignal;
  observedAt: string;
  sourceRef?: string;
}): string {
  const sourcePart = input.sourceRef?.trim() || '_';
  return [
    input.contentPackageId,
    String(input.contentPackageRevision),
    input.signal,
    input.observedAt,
    sourcePart,
  ].join('|');
}

/** Reject encoding「没动静」via the catch-all feedback signal. */
export function isForbiddenNoActivityEncoding(
  signal: OutcomeSignal,
  note?: string,
): boolean {
  if (signal === 'no_activity') return false;
  if (signal !== 'feedback') return false;
  const text = (note ?? '').trim();
  return /没动静|无反馈|没有人问|无人问|no[_ ]?activity/iu.test(text);
}

/**
 * Map legacy ContentPackage.resultSignals.kind → OutcomeEvidence.signal.
 * `no_activity` is first-class; feedback is never a stand-in.
 */
export function mapContentPackageResultKindToOutcomeSignal(
  kind: string,
): OutcomeSignal | null {
  switch (kind) {
    case 'attention':
      return 'attention';
    case 'inquiry':
    case 'private_message':
      return 'inquiry';
    case 'wechat':
    case 'wechat_added':
    case 'contact_added':
      return 'wechat';
    case 'booking':
    case 'appointment':
      return 'booking';
    case 'purchase':
    case 'voucher_purchase':
    case 'voucher_purchased':
      return 'purchase';
    case 'redeemed':
    case 'redemption':
      return 'redeemed';
    case 'visit':
    case 'store_visit':
      return 'visit';
    case 'published':
      return 'published';
    case 'feedback':
      return 'feedback';
    case 'no_activity':
      return 'no_activity';
    default:
      return null;
  }
}

/** Map OutcomeEvidence.signal → preferred ContentPackage.resultSignals.kind. */
export function mapOutcomeSignalToContentPackageResultKind(
  signal: OutcomeSignal,
): string {
  switch (signal) {
    case 'attention':
      return 'attention';
    case 'inquiry':
      return 'inquiry';
    case 'wechat':
      return 'wechat_added';
    case 'booking':
      return 'appointment';
    case 'purchase':
      return 'voucher_purchase';
    case 'redeemed':
      return 'redeemed';
    case 'visit':
      return 'store_visit';
    case 'no_activity':
      return 'no_activity';
    case 'published':
      return 'published';
    case 'feedback':
      return 'feedback';
  }
}

export function mapContentPackageResultSourceToOutcomeSource(
  source: string,
): OutcomeSource | null {
  switch (source) {
    case 'verified_adapter':
    case 'verified':
      return 'verified';
    case 'merchant_recorded':
    case 'merchant_reported':
      return 'merchant_reported';
    case 'inferred_temporal':
    case 'inferred_association':
    case 'inferred':
      return 'inferred';
    default:
      return null;
  }
}

export function mapOutcomeSourceToContentPackageResultSource(
  source: OutcomeSource,
): 'verified_adapter' | 'merchant_recorded' | 'inferred_temporal' {
  switch (source) {
    case 'verified':
      return 'verified_adapter';
    case 'merchant_reported':
      return 'merchant_recorded';
    case 'inferred':
      return 'inferred_temporal';
  }
}

/**
 * Latest projection over an append-only evidence log.
 * Superseded = referenced by a later supersedesEvidenceId;
 * withdrawn supersedes target is excluded; withdrawn rows themselves excluded.
 */
export function projectLatestOutcomeEvidence(
  history: readonly OutcomeEvidence[],
): OutcomeEvidence[] {
  const superseded = new Set<string>();
  for (const row of history) {
    if (row.supersedesEvidenceId) {
      superseded.add(row.supersedesEvidenceId);
    }
  }
  return history.filter(
    (row) =>
      row.status !== 'withdrawn' &&
      row.status !== 'superseded' &&
      !superseded.has(row.evidenceId),
  );
}

/**
 * U2 self-report frequency parameters (contract surface for V31-17).
 * 40% first-window coverage is observation-only — never a hard gate here.
 */
export const OUTCOME_SELF_REPORT_FREQUENCY_PARAMS = Object.freeze({
  schemaVersion: 'outcome-self-report-frequency/v1' as const,
  /** Next calendar day after publish handoff — single ask (U2=A). */
  askTiming: 'next_day_once' as const,
  /** Same Work is asked at most once. */
  maxAsksPerWork: 1,
  /** After this many consecutive ignores, store-level backoff applies. */
  consecutiveIgnoreThresholdForStoreBackoff: 2,
  /**
   * Pilot coverage target is observation only (U2).
   * Consumers must not hard-gate product journeys on this number until a later
   * baseline promotion decision.
   */
  coverageGateMode: 'observation_only' as const,
  coverageObservationTarget: 0.4,
});

export const outcomeSelfReportFrequencyParamsSchema = z
  .object({
    schemaVersion: z.literal(
      OUTCOME_SELF_REPORT_FREQUENCY_PARAMS.schemaVersion,
    ),
    askTiming: z.literal(OUTCOME_SELF_REPORT_FREQUENCY_PARAMS.askTiming),
    maxAsksPerWork: z.literal(
      OUTCOME_SELF_REPORT_FREQUENCY_PARAMS.maxAsksPerWork,
    ),
    consecutiveIgnoreThresholdForStoreBackoff: z.literal(
      OUTCOME_SELF_REPORT_FREQUENCY_PARAMS.consecutiveIgnoreThresholdForStoreBackoff,
    ),
    coverageGateMode: z.literal(
      OUTCOME_SELF_REPORT_FREQUENCY_PARAMS.coverageGateMode,
    ),
    coverageObservationTarget: z.literal(
      OUTCOME_SELF_REPORT_FREQUENCY_PARAMS.coverageObservationTarget,
    ),
  })
  .strict();

export type OutcomeSelfReportFrequencyParams = z.infer<
  typeof outcomeSelfReportFrequencyParamsSchema
>;

/**
 * Canonical write command for OutcomeEvidence (manual outcome contract extension).
 * Bound to exact ContentPackage revision; result ledger / observability project only.
 */
export const recordOutcomeEvidenceCommandSchema = z
  .object({
    schemaVersion: z.literal(OUTCOME_EVIDENCE_SCHEMA_VERSION),
    action: outcomeEvidenceWriteActionSchema.default('record'),
    workspaceId: identifierSchema,
    contentPackageRef: agentRevisionRefSchema,
    goalId: marketingGoalIdSchema.optional(),
    signal: outcomeSignalSchema,
    /** Write path is merchant_reported by default; verified adapters use their own path later. */
    source: outcomeSourceSchema.default('merchant_reported'),
    value: z.number().finite().optional(),
    observedAt: timestampSchema.optional(),
    sourceRef: nonEmptyTrimmedStringSchema.max(500).optional(),
    note: nonEmptyTrimmedStringSchema.max(120).optional(),
    actorId: identifierSchema,
    /** Required for correct / withdraw. */
    supersedesEvidenceId: outcomeEvidenceIdSchema.optional(),
  })
  .strict()
  .superRefine((command, context) => {
    if (
      (command.action === 'correct' || command.action === 'withdraw') &&
      !command.supersedesEvidenceId
    ) {
      context.addIssue({
        code: 'custom',
        message: `${command.action} requires supersedesEvidenceId.`,
        path: ['supersedesEvidenceId'],
      });
    }
    if (command.action === 'record' && command.supersedesEvidenceId) {
      context.addIssue({
        code: 'custom',
        message: 'record must not set supersedesEvidenceId; use correct.',
        path: ['supersedesEvidenceId'],
      });
    }
    if (command.source === 'inferred') {
      context.addIssue({
        code: 'custom',
        message:
          'inferred evidence is projection-only and cannot be written via the manual contract.',
        path: ['source'],
      });
    }
    if (isForbiddenNoActivityEncoding(command.signal, command.note)) {
      context.addIssue({
        code: 'custom',
        message:
          'no_activity must use signal=no_activity; do not encode via feedback.',
        path: ['signal'],
      });
    }
  });

export type RecordOutcomeEvidenceCommand = z.infer<
  typeof recordOutcomeEvidenceCommandSchema
>;

