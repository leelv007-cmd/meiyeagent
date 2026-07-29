import {
  validateHarnessPolicy,
  type HarnessGateFailure,
  type HarnessPolicyInput,
} from './policy-gates.js';

export const CHECK_STRATEGIES = ['block', 'warn', 'detect'] as const;

export type CheckStrategy = (typeof CHECK_STRATEGIES)[number];

type Awaitable<Value> = Promise<Value> | Value;

type ViolationStatusByStrategy = {
  block: 'blocked';
  detect: 'detected';
  warn: 'warned';
};

export interface CheckResult<Strategy extends CheckStrategy, Violation> {
  allowed: boolean;
  status: 'passed' | ViolationStatusByStrategy[Strategy];
  strategy: Strategy;
  violations: Violation[];
}

export async function check<
  Target,
  Violation,
  Strategy extends CheckStrategy,
>(input: {
  target: Target;
  strategy: Strategy;
  evaluate: (target: Target) => Awaitable<readonly Violation[]>;
  onViolation: (
    violation: Violation,
    context: { strategy: Strategy }
  ) => Awaitable<void>;
}): Promise<CheckResult<Strategy, Violation>> {
  const violations = [...(await input.evaluate(input.target))];
  for (const violation of violations) {
    await input.onViolation(violation, { strategy: input.strategy });
  }
  const status =
    violations.length === 0
      ? 'passed'
      : (
          {
            block: 'blocked',
            detect: 'detected',
            warn: 'warned',
          } as const
        )[input.strategy];
  return {
    allowed: input.strategy !== 'block' || violations.length === 0,
    status,
    strategy: input.strategy,
    violations,
  };
}

export interface HarnessRedlineCheckInput {
  input: HarnessPolicyInput;
  onViolation: (
    violation: HarnessGateFailure,
    context: { strategy: 'block' }
  ) => Awaitable<void>;
}

export function checkHarnessRedlines(
  input: HarnessRedlineCheckInput
): Promise<CheckResult<'block', HarnessGateFailure>> {
  return check({
    target: input.input,
    strategy: 'block',
    evaluate: (target) => validateHarnessPolicy(target).failures,
    onViolation: input.onViolation,
  });
}
