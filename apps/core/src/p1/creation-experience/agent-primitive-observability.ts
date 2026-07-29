import { createHash } from 'node:crypto';

import {
  agentPrimitiveLifecycleEventSchema,
  observabilityAxisBindingSchema,
  type AgentPrimitiveLifecycleEvent,
  type AgentPrimitiveRejectionClass,
  type ObservabilityAxisBinding,
} from '@meiye/contracts';

import type { P1Context } from '../foundation/domain.js';
import { serverAuditReference } from './creation-experience-events.js';
import type { ObservabilityEventAuditPort } from './observability-events.js';

type AgentPrimitiveBilling =
  AgentPrimitiveLifecycleEvent['payload']['billing'];

export interface AgentPrimitiveBillingIdentityPort {
  resolve(input: {
    workspaceId: string;
    taskId: string;
    primitiveId: string;
    baseIdempotencyKey: string;
  }): Promise<AgentPrimitiveBilling> | AgentPrimitiveBilling;
}

interface AgentPrimitiveLifecycleBaseInput {
  context: P1Context;
  taskId: string;
  primitiveId: string;
  baseIdempotencyKey: string;
  axes: ObservabilityAxisBinding;
}

export type AgentPrimitiveLifecycleInput =
  AgentPrimitiveLifecycleBaseInput &
    (
      | { phase: 'invoked' | 'succeeded' }
      | {
          phase: 'rejected';
          rejectionClass: AgentPrimitiveRejectionClass;
        }
    );

function requiredIdentity(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Agent primitive ${field} is required.`);
  }
  return normalized;
}

function primitiveLifecycleIdempotencyKey(input: {
  workspaceId: string;
  taskId: string;
  baseIdempotencyKey: string;
  phase: AgentPrimitiveLifecycleInput['phase'];
}) {
  const phaseSlot = input.phase === 'invoked' ? 'invoked' : 'terminal';
  const digest = createHash('sha256')
    .update(
      [
        input.workspaceId,
        input.taskId,
        input.baseIdempotencyKey,
        phaseSlot,
      ].join('\0'),
    )
    .digest('hex');
  return `agent-primitive-${digest}`;
}

export class AgentPrimitiveObservabilityAdapter {
  constructor(
    private readonly audit: ObservabilityEventAuditPort,
    private readonly billingIdentities: AgentPrimitiveBillingIdentityPort,
  ) {}

  async append(
    input: AgentPrimitiveLifecycleInput,
  ): Promise<AgentPrimitiveLifecycleEvent> {
    const actorKind = input.context.actor;
    if (!actorKind) {
      throw new Error('Agent primitive actor kind is required.');
    }
    const actorIdentity = input.context.userId;
    requiredIdentity(actorIdentity, 'actor identity');
    const workspaceId = requiredIdentity(
      input.context.workspaceId,
      'workspace identity',
    );
    const taskId = requiredIdentity(input.taskId, 'task identity');
    const primitiveId = requiredIdentity(
      input.primitiveId,
      'primitive identity',
    );
    const baseIdempotencyKey = requiredIdentity(
      input.baseIdempotencyKey,
      'base idempotency key',
    );
    const axes = observabilityAxisBindingSchema.parse(input.axes);
    const axisValue = (
      value: ObservabilityAxisBinding['skillRevision'],
    ) => (value.kind === 'bound' ? value.value : null);
    const idempotencyKey = primitiveLifecycleIdempotencyKey({
      workspaceId,
      taskId,
      baseIdempotencyKey,
      phase: input.phase,
    });
    const billing = await this.billingIdentities.resolve({
      workspaceId,
      taskId,
      primitiveId,
      baseIdempotencyKey,
    });
    const event = agentPrimitiveLifecycleEventSchema.parse({
      eventType: 'agent_primitive.lifecycle',
      taskId,
      workspaceId,
      actorId: serverAuditReference(actorIdentity),
      actorKind,
      idempotencyKey,
      axisScope: axes.axisScope,
      skillRevision: axisValue(axes.skillRevision),
      promptVersion: axisValue(axes.promptVersion),
      catalogRevision: axisValue(axes.catalogRevision),
      scene: axisValue(axes.scene),
      payload: {
        primitiveId,
        phase: input.phase,
        billing,
        ...('rejectionClass' in input
          ? { rejectionClass: input.rejectionClass }
          : {}),
      },
    });
    return this.audit.append(workspaceId, event, idempotencyKey);
  }
}
