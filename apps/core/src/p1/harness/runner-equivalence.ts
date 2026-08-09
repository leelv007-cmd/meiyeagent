/**
 * Convergence equivalence baseline (V31-25).
 *
 * Compares deliverable / settlement / recovery semantics for the same fixture
 * task set before and after runner convergence. Does not hash LLM prose.
 */

export type EquivalenceDeliverableSemantics = {
  outcome: 'delivered' | 'cancelled' | 'failed' | 'unknown';
  delivery: {
    packageId?: string;
    versionId?: string;
    revision?: number;
  } | null;
  deliveryLayer?: string;
  recommendationDeliverables?: readonly string[];
  merchantReportPresent: boolean;
  billingReceiptPresent: boolean;
  resolutionSource?: string;
};

export type EquivalenceRecoverySemantics = {
  /** Stable effect idempotency keys observed (ordered, unique). */
  effectKeys: readonly string[];
  /** Stage sequence from progress (stage:state). */
  progressSequence: readonly string[];
  /** Trace stages in order. */
  traceStages: readonly string[];
};

export type EquivalenceSettlementSemantics = {
  cancelled: boolean;
  resolutionSource?: string;
  /** Opaque billing markers only — never USD/token (D-061). */
  hasBillingReceipt: boolean;
  settlementStatus?: string;
};

export type RunnerEquivalenceSnapshot = {
  deliverable: EquivalenceDeliverableSemantics;
  settlement: EquivalenceSettlementSemantics;
  recovery: EquivalenceRecoverySemantics;
};

export type HarnessResultLike = {
  outcome?: string;
  delivery?: {
    packageId?: string;
    versionId?: string;
    revision?: number;
  } | null;
  deliveryLayer?: string;
  recommendation?: {
    deliverables?: readonly string[];
    decisionTrace?: { deliverables?: readonly string[] };
    recommendedCandidateId?: string;
  };
  merchantReport?: unknown;
  billingReceipt?: unknown;
  resolutionSource?: string;
  merchantMessage?: string;
};

/**
 * Extract merchant-visible + durable-semantic fields from a harness result.
 * Deterministic fields only (shadow reconciliation D8 family).
 */
export function extractDeliverableSemantics(
  result: HarnessResultLike,
): EquivalenceDeliverableSemantics {
  const outcome =
    result.outcome === 'cancelled'
      ? 'cancelled'
      : result.delivery
        ? 'delivered'
        : result.outcome === 'failed'
          ? 'failed'
          : result.delivery === null && result.merchantMessage
            ? 'cancelled'
            : 'unknown';
  return {
    outcome,
    delivery: result.delivery
      ? {
          packageId: result.delivery.packageId,
          versionId: result.delivery.versionId,
          revision: result.delivery.revision,
        }
      : result.delivery === null
        ? null
        : null,
    deliveryLayer: result.deliveryLayer,
    recommendationDeliverables: (() => {
      const fromRec = result.recommendation?.deliverables;
      if (fromRec) return [...fromRec];
      const fromTrace = result.recommendation?.decisionTrace?.deliverables;
      if (fromTrace) return [...fromTrace];
      return undefined;
    })(),
    merchantReportPresent: result.merchantReport !== undefined,
    billingReceiptPresent: result.billingReceipt !== undefined,
    resolutionSource: result.resolutionSource,
  };
}

export function extractSettlementSemantics(
  result: HarnessResultLike,
): EquivalenceSettlementSemantics {
  const cancelled =
    result.outcome === 'cancelled' ||
    (result.delivery === null && Boolean(result.merchantMessage));
  const receipt = result.billingReceipt as
    | { settlementStatus?: string }
    | undefined;
  return {
    cancelled,
    resolutionSource: result.resolutionSource,
    hasBillingReceipt: result.billingReceipt !== undefined,
    settlementStatus: receipt?.settlementStatus,
  };
}

export function extractRecoverySemantics(input: {
  effectKeys?: readonly string[];
  progress?: readonly { stage: string; state: string }[];
  traces?: readonly { stage: string }[];
}): EquivalenceRecoverySemantics {
  // Executor orchestration receipts are new durable metadata. The before/after
  // baseline compares business effects, so keep those receipts out of the
  // pre-convergence effect-key contract.
  const effectKeys = [
    ...new Set(
      (input.effectKeys ?? []).filter(
        (key) => !key.startsWith('compiled-primitive:'),
      ),
    ),
  ].sort();
  const progressSequence = (input.progress ?? []).map(
    (p) => `${p.stage}:${p.state}`,
  );
  const traceStages = (input.traces ?? []).map((t) => t.stage);
  return { effectKeys, progressSequence, traceStages };
}

export function buildRunnerEquivalenceSnapshot(input: {
  result: HarnessResultLike;
  effectKeys?: readonly string[];
  progress?: readonly { stage: string; state: string }[];
  traces?: readonly { stage: string }[];
}): RunnerEquivalenceSnapshot {
  return {
    deliverable: extractDeliverableSemantics(input.result),
    settlement: extractSettlementSemantics(input.result),
    recovery: extractRecoverySemantics({
      effectKeys: input.effectKeys,
      progress: input.progress,
      traces: input.traces,
    }),
  };
}

export type EquivalenceMismatch = {
  path: string;
  expected: unknown;
  actual: unknown;
};

/**
 * Compare two equivalence snapshots field-by-field.
 * Returns empty array when fully equivalent.
 */
export function diffRunnerEquivalence(
  expected: RunnerEquivalenceSnapshot,
  actual: RunnerEquivalenceSnapshot,
): EquivalenceMismatch[] {
  const mismatches: EquivalenceMismatch[] = [];
  const walk = (prefix: string, a: unknown, b: unknown) => {
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        mismatches.push({ path: prefix, expected: a, actual: b });
        return;
      }
      for (let i = 0; i < a.length; i += 1) {
        walk(`${prefix}[${i}]`, a[i], b[i]);
      }
      return;
    }
    if (
      a !== null &&
      b !== null &&
      typeof a === 'object' &&
      typeof b === 'object'
    ) {
      const aKeys = Object.keys(a as object).sort();
      const bKeys = Object.keys(b as object).sort();
      const keys = new Set([...aKeys, ...bKeys]);
      for (const key of keys) {
        walk(
          prefix ? `${prefix}.${key}` : key,
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
        );
      }
      return;
    }
    if (a !== b) {
      mismatches.push({ path: prefix, expected: a, actual: b });
    }
  };
  walk('', expected, actual);
  return mismatches;
}

/**
 * Assert kill/restart style double-run produces zero extra side effects:
 * second run's effect key multiset must equal the first (idempotent replay).
 */
export function assertZeroDuplicateSideEffects(input: {
  firstEffectKeys: readonly string[];
  secondEffectKeys: readonly string[];
}): void {
  const a = [...input.firstEffectKeys].sort();
  const b = [...input.secondEffectKeys].sort();
  if (a.length !== b.length || a.some((key, i) => key !== b[i])) {
    throw new Error(
      `kill/restart side-effect drift: first=${JSON.stringify(a)} second=${JSON.stringify(b)}`,
    );
  }
}
