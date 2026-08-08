/**
 * Quick Checks zero-LLM behavior gates (V31-08 / V3.1 §31.1b).
 *
 * Microsecond assertions for CI + production sampling:
 * toolOrder / didNotCall / maxToolCalls / noToolErrors / output includes|excludes|matches.
 *
 * Shared registry is the extension point for V31-23 (eval layers): register more
 * assertions without rewriting the API surface.
 */

/** Six primitives (V3.1 §7 / A8) — domain enums stay out of signatures. */
export const SESSION_SIX_PRIMITIVES = [
  'read_context',
  'generate',
  'revise',
  'record',
  'check',
  'ask_merchant',
] as const;

export type SessionSixPrimitive = (typeof SESSION_SIX_PRIMITIVES)[number];

/** Canonical happy-path production order for Make-style tool sequences. */
export const CANONICAL_SIX_PRIMITIVE_ORDER: readonly SessionSixPrimitive[] = [
  'read_context',
  'generate',
  'check',
  'record',
] as const;

export type QuickCheckToolCall = {
  toolName: string;
  args?: unknown;
  error?: unknown;
  sideEffect?: 'none' | 'internal_write' | 'paid' | 'external';
};

export type QuickCheckTrace = {
  toolCalls: readonly QuickCheckToolCall[];
  /** Zero for Level 0 deterministic path. */
  llmCallCount?: number;
  output?: unknown;
  /** Optional free-form tags for registry filters. */
  tags?: readonly string[];
};

export type QuickCheckVerdict = {
  id: string;
  passed: boolean;
  reason?: string;
};

export type QuickCheckAssertion = {
  id: string;
  description: string;
  /** Optional tags — V31-23 can filter by layer/release. */
  tags?: readonly string[];
  assert: (trace: QuickCheckTrace) => QuickCheckVerdict;
};

/** Subsequence match: expected tools appear in order (extras allowed between). */
export function toolOrder(
  toolCalls: readonly QuickCheckToolCall[] | readonly string[],
  expected: readonly string[],
): boolean {
  const names = toolCalls.map((call) =>
    typeof call === 'string' ? call : call.toolName,
  );
  let index = 0;
  for (const name of names) {
    if (name === expected[index]) index += 1;
    if (index === expected.length) return true;
  }
  return index === expected.length;
}

export function didNotCall(
  toolCalls: readonly QuickCheckToolCall[] | readonly string[],
  toolName: string,
): boolean {
  return !toolCalls.some((call) =>
    typeof call === 'string' ? call === toolName : call.toolName === toolName,
  );
}

export function maxToolCalls(
  toolCalls: readonly QuickCheckToolCall[] | readonly string[],
  max: number,
): boolean {
  return toolCalls.length <= max;
}

export function noToolErrors(toolCalls: readonly QuickCheckToolCall[]): boolean {
  return toolCalls.every((call) => call.error === undefined || call.error === null);
}

function stringifyOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

export function outputIncludes(output: unknown, needle: string): boolean {
  return stringifyOutput(output).includes(needle);
}

export function outputExcludes(output: unknown, needle: string): boolean {
  return !stringifyOutput(output).includes(needle);
}

export function outputMatches(output: unknown, pattern: RegExp): boolean {
  return pattern.test(stringifyOutput(output));
}

/**
 * Shared assertion registry. V31-23 extends via `register` only — do not fork.
 */
export class QuickCheckRegistry {
  private readonly assertions = new Map<string, QuickCheckAssertion>();

  register(assertion: QuickCheckAssertion): this {
    if (this.assertions.has(assertion.id)) {
      throw new Error(`QuickCheck assertion already registered: ${assertion.id}`);
    }
    this.assertions.set(assertion.id, assertion);
    return this;
  }

  /** Idempotent register for test reloads / extension packs. */
  registerOrReplace(assertion: QuickCheckAssertion): this {
    this.assertions.set(assertion.id, assertion);
    return this;
  }

  get(id: string): QuickCheckAssertion | undefined {
    return this.assertions.get(id);
  }

  list(): readonly QuickCheckAssertion[] {
    return [...this.assertions.values()];
  }

  runAll(trace: QuickCheckTrace): QuickCheckVerdict[] {
    return this.list().map((assertion) => {
      const verdict = assertion.assert(trace);
      return { ...verdict, id: assertion.id };
    });
  }

  runTagged(
    trace: QuickCheckTrace,
    tag: string,
  ): QuickCheckVerdict[] {
    return this.runMatching(trace, { includeTags: [tag] });
  }

  /**
   * V31-23 production sampling filter.
   * includeTags: assertion must include every listed tag (AND).
   * excludeTags: drop assertion if any listed tag is present.
   */
  runMatching(
    trace: QuickCheckTrace,
    filter: {
      includeTags?: readonly string[];
      excludeTags?: readonly string[];
    } = {},
  ): QuickCheckVerdict[] {
    const include = filter.includeTags ?? [];
    const exclude = filter.excludeTags ?? [];
    return this.list()
      .filter((assertion) => {
        const tags = assertion.tags ?? [];
        if (include.length > 0 && !include.every((tag) => tags.includes(tag))) {
          return false;
        }
        if (exclude.some((tag) => tags.includes(tag))) {
          return false;
        }
        return true;
      })
      .map((assertion) => {
        const verdict = assertion.assert(trace);
        return { ...verdict, id: assertion.id };
      });
  }

  clear(): void {
    this.assertions.clear();
  }
}

/** Session-side default suite (V31-08). V31-23 adds L1 datasets elsewhere. */
export function createSessionBehaviorQuickCheckRegistry(): QuickCheckRegistry {
  const registry = new QuickCheckRegistry();

  registry.register({
    id: 'session.toolOrder.canonical_make',
    description:
      'toolOrder subsequence for Make-style six-primitive happy path',
    tags: ['session', 'l0.5', 'toolOrder'],
    assert: (trace) => {
      const passed = toolOrder(trace.toolCalls, [
        ...CANONICAL_SIX_PRIMITIVE_ORDER,
      ]);
      return {
        id: 'session.toolOrder.canonical_make',
        passed,
        reason: passed
          ? undefined
          : `expected order ${CANONICAL_SIX_PRIMITIVE_ORDER.join('→')}`,
      };
    },
  });

  registry.register({
    id: 'session.didNotCall.record_readonly',
    description: "Read-only Session Harness must not call record",
    tags: ['session', 'l0.5', 'didNotCall', 'readonly'],
    assert: (trace) => {
      const passed = didNotCall(trace.toolCalls, 'record');
      return {
        id: 'session.didNotCall.record_readonly',
        passed,
        reason: passed ? undefined : "didNotCall('record') failed",
      };
    },
  });

  registry.register({
    id: 'session.maxToolCalls.default_8',
    description: 'Session turn stays within default maxToolCalls bound',
    tags: ['session', 'l0.5', 'maxToolCalls'],
    assert: (trace) => {
      const passed = maxToolCalls(trace.toolCalls, 8);
      return {
        id: 'session.maxToolCalls.default_8',
        passed,
        reason: passed ? undefined : `toolCalls=${trace.toolCalls.length} > 8`,
      };
    },
  });

  registry.register({
    id: 'session.noToolErrors',
    description: 'No tool-level errors on the trace',
    tags: ['session', 'l0.5', 'noToolErrors'],
    assert: (trace) => {
      const passed = noToolErrors(trace.toolCalls);
      return {
        id: 'session.noToolErrors',
        passed,
        reason: passed ? undefined : 'one or more tool errors present',
      };
    },
  });

  registry.register({
    id: 'session.level0.zero_llm',
    description: 'Level 0 deterministic path must record zero LLM calls',
    tags: ['session', 'l0.5', 'level0', 'llm'],
    assert: (trace) => {
      if (!trace.tags?.includes('level0')) {
        return { id: 'session.level0.zero_llm', passed: true };
      }
      const count = trace.llmCallCount ?? -1;
      const passed = count === 0;
      return {
        id: 'session.level0.zero_llm',
        passed,
        reason: passed ? undefined : `llmCallCount=${count}`,
      };
    },
  });

  return registry;
}

/** Process-wide default registry instance for CI entrypoints. */
let defaultRegistry: QuickCheckRegistry | null = null;

export function getDefaultSessionQuickCheckRegistry(): QuickCheckRegistry {
  if (!defaultRegistry) {
    defaultRegistry = createSessionBehaviorQuickCheckRegistry();
  }
  return defaultRegistry;
}

/** Test helper — reset singleton between suites. */
export function resetDefaultSessionQuickCheckRegistryForTests(): void {
  defaultRegistry = null;
}
