import { AsyncLocalStorage } from 'node:async_hooks';

import type { HarnessPolicyInput } from '../harness/policy-gates.js';
import type { CheckTargetResolverPort } from './check-handler.js';

interface ScopedCheckTarget {
  targetRef: string;
  policyInput: HarnessPolicyInput;
}

export class HarnessCheckTargetScope implements CheckTargetResolverPort {
  private readonly storage = new AsyncLocalStorage<ScopedCheckTarget>();

  withTarget<Result>(
    input: ScopedCheckTarget,
    operation: () => Result,
  ): Result {
    return this.storage.run(
      {
        policyInput: structuredClone(input.policyInput),
        targetRef: input.targetRef,
      },
      operation,
    );
  }

  async resolve(
    input: Parameters<CheckTargetResolverPort['resolve']>[0],
  ): Promise<HarnessPolicyInput> {
    const target = this.storage.getStore();
    if (!target) {
      throw new Error('No Harness check target is active.');
    }
    if (target.targetRef !== input.targetRef) {
      throw new Error(
        'Harness check target does not match the active execution scope.',
      );
    }
    if (target.policyInput.bundle.workspaceId !== input.workspaceId) {
      throw new Error(
        'Harness check target does not belong to the active execution workspace.',
      );
    }
    return structuredClone(target.policyInput);
  }
}
