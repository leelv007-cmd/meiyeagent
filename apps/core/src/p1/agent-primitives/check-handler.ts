import type { AgentPrimitiveInputById } from '@meiye/contracts';

import { P1DomainError } from '../foundation/domain.js';
import {
  checkHarnessRedlines,
  type CheckResult,
} from '../harness/check.js';
import type {
  HarnessGateFailure,
  HarnessPolicyInput,
} from '../harness/policy-gates.js';
import type { AgentPrimitiveServerContext } from './runtime.js';

export interface CheckTargetResolverPort {
  resolve(input: {
    targetRef: string;
    workspaceId: string;
    rulesets?: string[];
  }): Promise<HarnessPolicyInput>;
}

export interface CheckViolationAuditPort {
  append(input: {
    targetRef: string;
    workspaceId: string;
    strategy: 'block';
    violation: HarnessGateFailure;
  }): Promise<void>;
}

export class CheckPrimitiveHandler {
  constructor(
    private readonly ports: {
      resolver: CheckTargetResolverPort;
      violationAudit: CheckViolationAuditPort;
    },
  ) {}

  async execute(args: {
    input: AgentPrimitiveInputById['check'];
    serverContext: AgentPrimitiveServerContext;
  }): Promise<CheckResult<'block', HarnessGateFailure>> {
    const resolved = await this.ports.resolver.resolve({
      targetRef: args.input.target_ref,
      workspaceId: args.serverContext.workspaceId,
      ...(args.input.rulesets
        ? { rulesets: [...args.input.rulesets] }
        : {}),
    });
    if (resolved.bundle.workspaceId !== args.serverContext.workspaceId) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Resolved check target does not belong to the execution workspace.',
      );
    }

    return checkHarnessRedlines({
      input: {
        ...resolved,
        phase: 'execution',
      },
      onViolation: (violation, { strategy }) =>
        this.ports.violationAudit.append({
          strategy,
          targetRef: args.input.target_ref,
          violation,
          workspaceId: args.serverContext.workspaceId,
        }),
    });
  }
}
