import type { ObservabilityAxisBinding } from '@meiye/contracts';

import type { P1Context } from '../foundation/domain.js';
import type { CheckResult } from '../harness/check.js';
import type {
  HarnessGateFailure,
  HarnessPolicyInput,
} from '../harness/policy-gates.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';
import type { HarnessCheckTargetScope } from './harness-check-target-scope.js';

export interface P1HarnessCheckApplicationPort {
  executeModule<TInput extends Record<string, unknown>, TOutput>(
    context: P1Context,
    name: string,
    input: TInput,
    idempotencyKey: string,
  ): Promise<TOutput>;
}

export interface P1HarnessCheckInvocation {
  workflowId: string;
  workflowRevision: number;
  workspaceId: string;
  taskId: string;
  correlationId: string;
  observability: ObservabilityAxisBinding;
  policyInput: HarnessPolicyInput;
  rulesets?: string[];
}

export class P1HarnessCheckInvoker {
  constructor(
    private readonly application: P1HarnessCheckApplicationPort,
    private readonly targetScope: HarnessCheckTargetScope,
    private readonly workerId: string,
  ) {}

  execute(
    input: P1HarnessCheckInvocation,
  ): Promise<CheckResult<'block', HarnessGateFailure>> {
    const candidateId = input.policyInput.candidate.candidateId;
    const bundleRevision = input.policyInput.bundle.revision;
    const policyFingerprint = fingerprintValue(input.policyInput);
    const targetRef =
      `harness-candidate:${candidateId}@bundle-${bundleRevision}`;
    const idempotencyKey =
      `wf:${input.workflowId}:s4:agent-check:r${input.workflowRevision}:` +
      `b${bundleRevision}:${candidateId}:${policyFingerprint}`;

    return this.targetScope.withTarget(
      {
        policyInput: input.policyInput,
        taskId: input.taskId,
        targetRef,
      },
      () =>
        this.application.executeModule<
          Record<string, unknown>,
          CheckResult<'block', HarnessGateFailure>
        >(
          {
            actor: 'worker',
            correlationId: input.correlationId,
            userId: this.workerId,
            workspaceId: input.workspaceId,
          },
          'agent-primitives',
          {
            action: 'execute',
            payload: {
              modelInput: {
                ...(input.rulesets
                  ? { rulesets: [...input.rulesets] }
                  : {}),
                target_ref: targetRef,
              },
              observability: input.observability,
              primitiveId: 'check',
              taskId: input.taskId,
            },
          },
          idempotencyKey,
        ),
    );
  }
}
