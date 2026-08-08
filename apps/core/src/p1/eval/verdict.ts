/**
 * Gates / thresholds / verdict three-state (V31-23 / V3.1 §31.2 / U12).
 *
 * - Gates (fidelity/rights/redline): any missing kind or failed → failed
 * - Thresholds (brand_tone/readability/…): reverse max band supported
 * - scored = gates all pass, some threshold unmet → releasable + bookkept only
 */

import {
  EVAL_GATE_KINDS,
  evalGateResultSchema,
  evalThresholdResultSchema,
  type EvalGateKind,
  type EvalGateResult,
  type EvalThresholdResult,
  type EvalVerdictStatus,
} from '@meiye/contracts';

export type ComputeEvalVerdictInput = {
  gates: readonly EvalGateResult[];
  thresholds?: readonly EvalThresholdResult[];
};

export type ComputeEvalVerdictOutput = {
  verdict: EvalVerdictStatus;
  scoredBookkept: boolean;
  releasable: boolean;
  missingGateKinds: EvalGateKind[];
  failedGateIds: string[];
  unmetThresholdIds: string[];
  gates: EvalGateResult[];
  thresholds: EvalThresholdResult[];
};

/** Evaluate a single threshold against its bound (min ≥, max ≤ reverse). */
export function thresholdMet(
  score: number,
  direction: 'min' | 'max',
  bound: number,
): boolean {
  if (!Number.isFinite(score) || !Number.isFinite(bound)) return false;
  return direction === 'min' ? score >= bound : score <= bound;
}

export function buildThresholdResult(input: {
  id: string;
  kind: EvalThresholdResult['kind'];
  score: number;
  direction: 'min' | 'max';
  bound: number;
  reason?: string;
}): EvalThresholdResult {
  const met = thresholdMet(input.score, input.direction, input.bound);
  return evalThresholdResultSchema.parse({
    id: input.id,
    kind: input.kind,
    score: input.score,
    direction: input.direction,
    bound: input.bound,
    met,
    reason:
      input.reason ??
      (met
        ? undefined
        : `score=${input.score} direction=${input.direction} bound=${input.bound}`),
  });
}

export function buildGateResult(input: {
  id: string;
  kind: EvalGateKind;
  passed: boolean;
  reason?: string;
}): EvalGateResult {
  return evalGateResultSchema.parse({
    id: input.id,
    kind: input.kind,
    passed: input.passed,
    reason: input.reason,
  });
}

/**
 * Compute three-state verdict.
 * Missing any of the three required gate kinds → failed (缺一即 failed).
 */
export function computeEvalVerdict(
  input: ComputeEvalVerdictInput,
): ComputeEvalVerdictOutput {
  const gates = input.gates.map((gate) => evalGateResultSchema.parse(gate));
  const thresholds = (input.thresholds ?? []).map((item) =>
    evalThresholdResultSchema.parse(item),
  );

  const presentKinds = new Set(gates.map((gate) => gate.kind));
  const missingGateKinds = EVAL_GATE_KINDS.filter(
    (kind) => !presentKinds.has(kind),
  );
  const failedGateIds = gates
    .filter((gate) => !gate.passed)
    .map((gate) => gate.id);
  const unmetThresholdIds = thresholds
    .filter((item) => !item.met)
    .map((item) => item.id);

  if (missingGateKinds.length > 0 || failedGateIds.length > 0) {
    return {
      verdict: 'failed',
      scoredBookkept: false,
      releasable: false,
      missingGateKinds: [...missingGateKinds],
      failedGateIds,
      unmetThresholdIds,
      gates,
      thresholds,
    };
  }

  if (unmetThresholdIds.length > 0) {
    return {
      verdict: 'scored',
      scoredBookkept: true,
      releasable: true,
      missingGateKinds: [],
      failedGateIds: [],
      unmetThresholdIds,
      gates,
      thresholds,
    };
  }

  return {
    verdict: 'passed',
    scoredBookkept: false,
    releasable: true,
    missingGateKinds: [],
    failedGateIds: [],
    unmetThresholdIds: [],
    gates,
    thresholds,
  };
}
