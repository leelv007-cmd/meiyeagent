/**
 * Full-chain eval trace field contract + D-061 sanitizer (V31-23 / §32).
 *
 * Never allow API keys, unredacted customer data, raw CoT, or upstream USD costs.
 */

import {
  EVAL_TRACE_FORBIDDEN_KEYS,
  EVAL_TRACE_REQUIRED_FIELDS,
  evalSafeTraceFieldsSchema,
  type EvalSafeTraceFields,
} from '@meiye/contracts';

import { P1DomainError } from '../foundation/domain.js';

export type TraceLeakFinding = {
  path: string;
  key: string;
  reason: 'forbidden_key' | 'forbidden_value_shape';
};

const FORBIDDEN_KEY_SET = new Set<string>(EVAL_TRACE_FORBIDDEN_KEYS);

/** Value patterns that must never appear in serialized eval traces (D-061). */
const FORBIDDEN_VALUE_PATTERNS: readonly { id: string; pattern: RegExp }[] = [
  { id: 'openai_sk', pattern: /\bsk-[A-Za-z0-9_-]{8,}\b/u },
  { id: 'bearer_token', pattern: /\bBearer\s+[A-Za-z0-9._\-+=/]{12,}\b/iu },
  {
    id: 'upstream_usd',
    pattern: /\b(upstreamUsdCost|provider_usd_cost|usdCost)\b/u,
  },
  {
    id: 'raw_cot_marker',
    pattern: /\b(chainOfThought|raw_cot|rawThinking)\b/u,
  },
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Walk a payload and collect forbidden key / value-shape leaks.
 * Used by constructive negative tests and production sanitize gate.
 */
export function findEvalTraceLeaks(
  payload: unknown,
  basePath = '$',
): TraceLeakFinding[] {
  const findings: TraceLeakFinding[] = [];

  const visit = (value: unknown, path: string) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!isPlainObject(value)) {
      if (typeof value === 'string') {
        for (const rule of FORBIDDEN_VALUE_PATTERNS) {
          if (rule.pattern.test(value)) {
            findings.push({
              path,
              key: rule.id,
              reason: 'forbidden_value_shape',
            });
          }
        }
      }
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (FORBIDDEN_KEY_SET.has(key)) {
        findings.push({ path: childPath, key, reason: 'forbidden_key' });
      }
      visit(child, childPath);
    }
  };

  visit(payload, basePath);
  return findings;
}

export function assertNoEvalTraceLeaks(payload: unknown): void {
  const findings = findEvalTraceLeaks(payload);
  if (findings.length === 0) return;
  throw new P1DomainError(
    'INVALID_STATE',
    `Eval trace leaks forbidden fields (D-061): ${findings
      .map((item) => `${item.path}:${item.key}`)
      .join(', ')}`,
  );
}

export function hasRequiredEvalTraceFields(
  payload: Record<string, unknown>,
): boolean {
  return EVAL_TRACE_REQUIRED_FIELDS.every(
    (field) =>
      typeof payload[field] === 'string' &&
      (payload[field] as string).trim().length > 0,
  );
}

/**
 * Parse + strip to the allowlisted safe field set, then re-check for leaks.
 */
export function sanitizeEvalTraceFields(
  input: unknown,
): EvalSafeTraceFields {
  const parsed = evalSafeTraceFieldsSchema.parse(input);
  assertNoEvalTraceLeaks(parsed);
  return parsed;
}
