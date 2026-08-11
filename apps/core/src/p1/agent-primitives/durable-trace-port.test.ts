import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  AgentPrimitiveId,
  ObservabilityAxisBinding,
} from '@meiye/contracts';

import {
  HarnessObservabilityEventAudit,
  type ObservabilityEventAuditPort,
} from '../creation-experience/observability-events.js';
import { AgentPrimitiveDurableTracePort } from './durable-trace-port.js';
import type { AgentPrimitiveTraceEvent } from './runtime.js';

const axes: ObservabilityAxisBinding = {
  axisScope: 'execution_child',
  skillRevision: { kind: 'absent' },
  promptVersion: { kind: 'bound', value: 'harness/copy-candidate@7' },
  catalogRevision: { kind: 'bound', value: 'catalog-r7' },
  scene: { kind: 'bound', value: 'harness:copy' },
};

function trace(
  primitiveId: AgentPrimitiveId,
  phase: AgentPrimitiveTraceEvent['phase'],
): AgentPrimitiveTraceEvent {
  const serverContext = {
    actorId: 'harness-worker',
    correlationId: `correlation-${primitiveId}`,
    idempotencyKey: `primitive-${primitiveId}`,
    observability: axes,
    taskId: 'task-agent-primitives',
    workspaceId: 'workspace-agent-primitives',
    ...(primitiveId === 'generate' || primitiveId === 'revise'
      ? {
          billing: {
            productUsageTaskId: `usage-${primitiveId}`,
            quoteId: `quote-${primitiveId}`,
          },
        }
      : {}),
  };
  if (phase === 'rejected') {
    return {
      phase,
      primitiveId,
      rejectionClass: 'execution_failed',
      serverContext,
    };
  }
  return { phase, primitiveId, serverContext };
}

test('all six primitive lifecycles persist through the canonical Harness audit seam', async () => {
  const writes: Array<{
    eventType: string;
    id: string;
    payload: unknown;
    stage: string;
    workflowId: string;
    workspaceId: string;
  }> = [];
  const audit = new HarnessObservabilityEventAudit({
    async appendAuditIdempotently(event) {
      writes.push(structuredClone(event));
    },
  });
  const port = new AgentPrimitiveDurableTracePort(
    audit as ObservabilityEventAuditPort,
  );
  const primitiveIds: AgentPrimitiveId[] = [
    'read_context',
    'generate',
    'revise',
    'record',
    'check',
    'ask_merchant',
  ];

  for (const primitiveId of primitiveIds) {
    await port.append(trace(primitiveId, 'invoked'));
    await port.append(trace(primitiveId, 'succeeded'));
  }

  assert.equal(writes.length, 12);
  assert.deepEqual(
    writes.map(({ payload }) => {
      const event = payload as {
        axisScope: string;
        catalogRevision: string | null;
        payload: {
          billing: { kind: string };
          phase: string;
          primitiveId: string;
        };
        promptVersion: string | null;
        skillRevision: string | null;
      };
      return {
        axisScope: event.axisScope,
        billing: event.payload.billing.kind,
        catalogRevision: event.catalogRevision,
        phase: event.payload.phase,
        primitiveId: event.payload.primitiveId,
        promptVersion: event.promptVersion,
        skillRevision: event.skillRevision,
      };
    }),
    primitiveIds.flatMap((primitiveId) =>
      ['invoked', 'succeeded'].map((phase) => ({
        axisScope: 'execution_child',
        billing:
          primitiveId === 'generate' || primitiveId === 'revise'
            ? 'product_usage'
            : 'not_billed',
        catalogRevision: 'catalog-r7',
        phase,
        primitiveId,
        promptVersion: 'harness/copy-candidate@7',
        skillRevision: null,
      })),
    ),
  );
  assert.equal(JSON.stringify(writes).includes('raw provider failure'), false);
  assert.ok(
    writes.every(
      ({ eventType, stage, workflowId, workspaceId }) =>
        eventType === 'agent_primitive.lifecycle' &&
        stage === 'observability_event_ingest' &&
        workflowId === 'task-agent-primitives' &&
        workspaceId === 'workspace-agent-primitives',
    ),
  );
});

test('rejected lifecycle stores only the typed rejection class', async () => {
  const events: unknown[] = [];
  const audit: ObservabilityEventAuditPort = {
    append(_workspaceId, event) {
      events.push(structuredClone(event));
      return event;
    },
  };
  const port = new AgentPrimitiveDurableTracePort(audit);

  await port.append(trace('check', 'rejected'));

  assert.equal(events.length, 1);
  assert.match(JSON.stringify(events[0]), /"rejectionClass":"execution_failed"/u);
  assert.equal(JSON.stringify(events[0]).includes('"error"'), false);
});
