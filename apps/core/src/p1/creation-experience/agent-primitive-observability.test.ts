import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AgentPrimitiveObservabilityAdapter,
} from './agent-primitive-observability.js';
import { serverAuditReference } from './creation-experience-events.js';
import { MemoryObservabilityEventAudit } from './observability-events.js';

const context = {
  workspaceId: 'workspace-a',
  userId: 'worker-a',
  correlationId: 'corr-primitive',
  actor: 'worker' as const,
};

const absentRootAxes = {
  axisScope: 'task_root',
  skillRevision: { kind: 'absent' },
  promptVersion: { kind: 'absent' },
  catalogRevision: { kind: 'absent' },
  scene: { kind: 'absent' },
} as const;

describe('agent primitive observability adapter', () => {
  it('projects server identity, explicit absent axes, and stable phase identities', async () => {
    const audit = new MemoryObservabilityEventAudit();
    const serverContext = { ...context, userId: ' worker-a ' };
    const adapter = new AgentPrimitiveObservabilityAdapter(audit, {
      resolve() {
        return { kind: 'not_billed' };
      },
    });
    const input = {
      context: serverContext,
      taskId: 'task-primitive',
      primitiveId: 'generate',
      baseIdempotencyKey: 'primitive-call-1',
      axes: absentRootAxes,
    };

    const invoked = await adapter.append({ ...input, phase: 'invoked' });
    const invokedReplay = await adapter.append({ ...input, phase: 'invoked' });
    const succeeded = await adapter.append({ ...input, phase: 'succeeded' });

    assert.deepEqual(invokedReplay, invoked);
    assert.notEqual(invoked.idempotencyKey, succeeded.idempotencyKey);
    assert.deepEqual(audit.list('workspace-a'), [invoked, succeeded]);
    assert.deepEqual(
      {
        workspaceId: invoked.workspaceId,
        actorKind: invoked.actorKind,
        axisScope: invoked.axisScope,
        skillRevision: invoked.skillRevision,
        promptVersion: invoked.promptVersion,
        catalogRevision: invoked.catalogRevision,
        scene: invoked.scene,
      },
      {
        workspaceId: 'workspace-a',
        actorKind: 'worker',
        axisScope: 'task_root',
        skillRevision: null,
        promptVersion: null,
        catalogRevision: null,
        scene: null,
      },
    );
    assert.equal(invoked.actorId, serverAuditReference(serverContext.userId));
  });

  it('uses one terminal identity so contradictory outcomes fail closed', async () => {
    const audit = new MemoryObservabilityEventAudit();
    const adapter = new AgentPrimitiveObservabilityAdapter(audit, {
      resolve() {
        return {
          kind: 'product_usage',
          productUsageTaskId: 'usage-task-1',
          quoteId: 'quote-1',
        };
      },
    });
    const input = {
      context,
      taskId: 'task-primitive',
      primitiveId: 'generate',
      baseIdempotencyKey: 'primitive-call-2',
      axes: {
        axisScope: 'execution_child',
        skillRevision: { kind: 'bound', value: 'copywriter@rev-17' },
        promptVersion: { kind: 'bound', value: 'marketing/copy@v4' },
        catalogRevision: { kind: 'bound', value: 'catalog-2026-07-29' },
        scene: { kind: 'bound', value: 'opening-campaign' },
      } as const,
    };

    const succeeded = await adapter.append({ ...input, phase: 'succeeded' });
    await assert.rejects(
      () =>
        adapter.append({
          ...input,
          primitiveId: 'revise',
          phase: 'rejected',
          rejectionClass: 'execution_failed',
        }),
      /idempotency conflict/i,
    );

    assert.equal(audit.list().length, 1);
    const stored = audit.list()[0];
    assert.equal(stored?.eventType, 'agent_primitive.lifecycle');
    if (stored?.eventType !== 'agent_primitive.lifecycle') {
      throw new Error('Expected one agent primitive lifecycle event.');
    }
    assert.equal(stored.idempotencyKey, succeeded.idempotencyKey);
  });

  it('requires a server-owned actor kind', async () => {
    const adapter = new AgentPrimitiveObservabilityAdapter(
      new MemoryObservabilityEventAudit(),
      {
        resolve() {
          return { kind: 'not_billed' };
        },
      },
    );

    await assert.rejects(
      () =>
        adapter.append({
          context: { ...context, actor: undefined },
          taskId: 'task-primitive',
          primitiveId: 'generate',
          baseIdempotencyKey: 'primitive-call-3',
          axes: absentRootAxes,
          phase: 'invoked',
        }),
      /actor kind/i,
    );
  });
});
