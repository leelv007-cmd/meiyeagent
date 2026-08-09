/**
 * Policy middleware runner (V3.1 §20.4 / MAJOR-01).
 *
 * Hooks: before_model / after_model / wrap_model / wrap_tool_call.
 * Control actions closed set: continue | end_turn | ask_merchant.
 * Composition order is pinned by HarnessRelease.middlewareBindings
 * (before ascending order, after reverse, wrap nested).
 */

import type { HarnessMiddlewareBinding } from '@meiye/contracts';

import { P1DomainError } from '../foundation/domain.js';

export const POLICY_CONTROL_ACTIONS = [
  'continue',
  'end_turn',
  'ask_merchant',
] as const;

export type PolicyControlAction = (typeof POLICY_CONTROL_ACTIONS)[number];

export type PolicyMiddlewareKind = HarnessMiddlewareBinding['kind'];

export type PolicyControlDecision =
  | { control: 'continue'; patch?: Record<string, unknown> }
  | { control: 'end_turn'; reason?: string }
  | {
      control: 'ask_merchant';
      reason?: string;
      question?: { itemId: string; question: string };
    };

export type ToolCallIntercept =
  | { allowed: true }
  | {
      allowed: false;
      /** Model-visible refusal (gate id + reason). */
      gateId: string;
      reason: string;
    };

export type PolicyMiddlewareContext = {
  phase: string;
  runId: string;
  workspaceId: string;
  toolName?: string;
  toolArgs?: unknown;
  modelOutput?: unknown;
  state: Record<string, unknown>;
};

export type PolicyMiddlewareHandlers = {
  before_model?: (
    ctx: PolicyMiddlewareContext,
  ) => Promise<PolicyControlDecision> | PolicyControlDecision;
  after_model?: (
    ctx: PolicyMiddlewareContext,
  ) => Promise<PolicyControlDecision> | PolicyControlDecision;
  wrap_model?: (
    ctx: PolicyMiddlewareContext,
    next: () => Promise<unknown>,
  ) => Promise<unknown>;
  wrap_tool_call?: (
    ctx: PolicyMiddlewareContext,
    next: () => Promise<unknown>,
  ) => Promise<unknown | ToolCallIntercept>;
};

export type RegisteredPolicy = {
  binding: HarnessMiddlewareBinding;
  handlers: PolicyMiddlewareHandlers;
};

export class PolicyMiddlewareError extends Error {
  readonly code = 'POLICY_MIDDLEWARE_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'PolicyMiddlewareError';
  }
}

function assertControlAllowed(
  binding: HarnessMiddlewareBinding,
  control: PolicyControlAction,
): void {
  if (!binding.allowedControlActions.includes(control)) {
    throw new PolicyMiddlewareError(
      `Policy ${binding.policyId}@${binding.revision} attempted control "${control}" outside allowedControlActions=[${binding.allowedControlActions.join(',')}].`,
    );
  }
}

/**
 * Pin execution order from release bindings:
 * - before_model: ascending order
 * - after_model: descending order (onion unwind)
 * - wrap_*: ascending order (outer = lower order)
 */
export function composeMiddlewareOrder(
  bindings: readonly HarnessMiddlewareBinding[],
): {
  beforeModel: HarnessMiddlewareBinding[];
  afterModel: HarnessMiddlewareBinding[];
  wrapModel: HarnessMiddlewareBinding[];
  wrapToolCall: HarnessMiddlewareBinding[];
} {
  const byKind = (kind: PolicyMiddlewareKind) =>
    bindings
      .filter((binding) => binding.kind === kind)
      .slice()
      .sort((left, right) => left.order - right.order);

  const beforeModel = byKind('before_model');
  const afterModel = byKind('after_model').slice().reverse();
  return {
    beforeModel,
    afterModel,
    wrapModel: byKind('wrap_model'),
    wrapToolCall: byKind('wrap_tool_call'),
  };
}

export type PolicyMiddlewareRunnerOptions = {
  /**
   * Allow bindings that resolve to no registered policy.
   * Test-only: pins execution order without handlers. Production default is
   * fail-closed — every middlewareBinding must resolve to a registered policy.
   */
  allowUnregisteredBindings?: boolean;
};

export class PolicyMiddlewareRunner {
  private readonly byExactBinding = new Map<string, RegisteredPolicy>();

  constructor(
    private readonly bindings: readonly HarnessMiddlewareBinding[],
    policies: readonly RegisteredPolicy[],
    options: PolicyMiddlewareRunnerOptions = {},
  ) {
    for (const policy of policies) {
      this.byExactBinding.set(bindingKey(policy.binding), policy);
    }
    // Fail-closed: a release pinning an unregistered policy would silently
    // skip its gate otherwise. Only order-only tests opt out explicitly.
    if (options.allowUnregisteredBindings !== true) {
      const unregistered = bindings.filter(
        (binding) => !this.byExactBinding.has(bindingKey(binding)),
      );
      if (unregistered.length > 0) {
        const ids = unregistered.map(bindingKey).join(', ');
        throw new P1DomainError(
          'INVALID_STATE',
          `Middleware binding(s) without a registered policy: ${ids}. Every middlewareBinding must resolve to a registered policy; allowUnregisteredBindings is test-only.`,
        );
      }
    }
  }

  get pinnedOrder() {
    return composeMiddlewareOrder(this.bindings);
  }

  async runBeforeModel(
    ctx: PolicyMiddlewareContext,
  ): Promise<PolicyControlDecision> {
    const { beforeModel } = this.pinnedOrder;
    for (const binding of beforeModel) {
      const policy = this.byExactBinding.get(bindingKey(binding));
      const handler = policy?.handlers.before_model;
      if (!handler) continue;
      const decision = await handler({ ...ctx });
      assertControlAllowed(binding, decision.control);
      if (decision.control !== 'continue') return decision;
      if (decision.patch) {
        Object.assign(ctx.state, decision.patch);
      }
    }
    return { control: 'continue' };
  }

  async runAfterModel(
    ctx: PolicyMiddlewareContext,
  ): Promise<PolicyControlDecision> {
    const { afterModel } = this.pinnedOrder;
    for (const binding of afterModel) {
      const policy = this.byExactBinding.get(bindingKey(binding));
      const handler = policy?.handlers.after_model;
      if (!handler) continue;
      const decision = await handler({ ...ctx });
      assertControlAllowed(binding, decision.control);
      if (decision.control !== 'continue') return decision;
      if (decision.patch) {
        Object.assign(ctx.state, decision.patch);
      }
    }
    return { control: 'continue' };
  }

  async wrapModelCall(
    ctx: PolicyMiddlewareContext,
    core: () => Promise<unknown>,
  ): Promise<unknown> {
    const { wrapModel } = this.pinnedOrder;
    let next = core;
    // Outer = lower order: nest from highest order down to lowest.
    for (const binding of [...wrapModel].reverse()) {
      const policy = this.byExactBinding.get(bindingKey(binding));
      const handler = policy?.handlers.wrap_model;
      if (!handler) continue;
      const inner = next;
      next = () => handler({ ...ctx }, inner);
    }
    return next();
  }

  async wrapToolCall(
    ctx: PolicyMiddlewareContext,
    core: () => Promise<unknown>,
  ): Promise<unknown | ToolCallIntercept> {
    const { wrapToolCall } = this.pinnedOrder;
    let next: () => Promise<unknown | ToolCallIntercept> = core;
    for (const binding of [...wrapToolCall].reverse()) {
      const policy = this.byExactBinding.get(bindingKey(binding));
      const handler = policy?.handlers.wrap_tool_call;
      if (!handler) continue;
      const inner = next;
      next = () => handler({ ...ctx }, inner);
    }
    return next();
  }
}

function bindingKey(binding: HarnessMiddlewareBinding): string {
  return `${binding.policyId}@${binding.revision}:${binding.kind}`;
}
