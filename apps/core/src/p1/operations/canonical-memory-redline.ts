import type { HarnessPolicyInput } from '../harness/policy-gates.js';
import { checkHarnessRedlines } from '../harness/check.js';

export interface MemoryProposalForRedline {
  candidateId: string;
  workspaceId: string;
  proposedValue: unknown;
}

export interface MemoryProposalPolicyResolver {
  resolve(input: MemoryProposalForRedline): Promise<HarnessPolicyInput>;
}

export interface MemoryProposalViolationAudit {
  append(input: {
    candidateId: string;
    workspaceId: string;
    gateId: string;
    reason: string;
  }): Promise<void>;
}

export class CanonicalMemoryProposalRedline {
  constructor(
    private readonly resolver: MemoryProposalPolicyResolver,
    private readonly audit: MemoryProposalViolationAudit,
  ) {}

  async check(input: MemoryProposalForRedline) {
    const policy = await this.resolver.resolve(structuredClone(input));
    if (
      policy.bundle.workspaceId !== input.workspaceId ||
      policy.candidate.workspaceId !== input.workspaceId
    ) {
      throw new Error(
        'Memory proposal policy does not belong to the proposal workspace.',
      );
    }
    const value =
      typeof input.proposedValue === 'string'
        ? input.proposedValue
        : JSON.stringify(input.proposedValue);
    const result = await checkHarnessRedlines({
      input: {
        ...policy,
        phase: 'delivery',
        candidate: {
          ...policy.candidate,
          visibleText: [
            ...(policy.candidate.visibleText ?? []),
            { field: 'memory.proposedValue', text: value },
          ],
        },
      },
      onViolation: (violation) =>
        this.audit.append({
          candidateId: input.candidateId,
          workspaceId: input.workspaceId,
          gateId: violation.gateId,
          reason: violation.reason,
        }),
    });
    return {
      allowed: result.allowed,
      failures: result.violations,
    };
  }
}
