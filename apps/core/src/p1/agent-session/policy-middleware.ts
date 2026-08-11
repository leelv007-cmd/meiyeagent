/** Release-pinned after-model policies used by the Session Harness. */

import type { HarnessMiddlewareBinding } from '@meiye/contracts';

import { P1DomainError } from '../foundation/domain.js';

export type PolicyControlDecision =
  | { control: 'continue'; patch?: Record<string, unknown> }
  | { control: 'end_turn'; reason?: string }
  | {
      control: 'ask_merchant';
      reason?: string;
      question?: { itemId: string; question: string };
    };

export type AfterModelPolicyContext = {
  phase: string;
  runId: string;
  workspaceId: string;
  modelOutput?: unknown;
  state: Record<string, unknown>;
};

export type AfterModelPolicy = {
  binding: HarnessMiddlewareBinding;
  afterModel: (
    context: AfterModelPolicyContext,
  ) => Promise<PolicyControlDecision> | PolicyControlDecision;
};

function bindingKey(binding: HarnessMiddlewareBinding): string {
  return `${binding.policyId}@${binding.revision}:${binding.kind}`;
}

export async function runAfterModelPolicies(
  bindings: readonly HarnessMiddlewareBinding[],
  policies: readonly AfterModelPolicy[],
  context: AfterModelPolicyContext,
): Promise<PolicyControlDecision> {
  const pinnedBindings = bindings
    .filter((binding) => binding.kind === 'after_model')
    .slice()
    .sort((left, right) => right.order - left.order);
  const byBinding = new Map(
    policies.map((policy) => [bindingKey(policy.binding), policy]),
  );
  const unregistered = pinnedBindings.filter(
    (binding) => !byBinding.has(bindingKey(binding)),
  );
  if (unregistered.length > 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      `Middleware binding(s) without a registered policy: ${unregistered.map(bindingKey).join(', ')}. Every after_model binding must resolve to a registered policy.`,
    );
  }
  const pinnedKeys = new Set(pinnedBindings.map(bindingKey));
  const unpinned = policies
    .map((policy) => bindingKey(policy.binding))
    .filter((key) => !pinnedKeys.has(key));
  if (unpinned.length > 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      `Registered policy(ies) the release never pins: ${unpinned.join(', ')}.`,
    );
  }

  for (const binding of pinnedBindings) {
    const decision = await byBinding.get(bindingKey(binding))!.afterModel({
      ...context,
    });
    if (!binding.allowedControlActions.includes(decision.control)) {
      throw new Error(
        `Policy ${binding.policyId}@${binding.revision} attempted control "${decision.control}" outside allowedControlActions=[${binding.allowedControlActions.join(',')}].`,
      );
    }
    if (decision.control !== 'continue') return decision;
    if (decision.patch) Object.assign(context.state, decision.patch);
  }
  return { control: 'continue' };
}
