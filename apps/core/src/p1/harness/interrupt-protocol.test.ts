/**
 * V31-14 Interrupt typed protocol — CAS resume, listPending workspace auth,
 * duplicate resume/submit idempotent.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  interruptPayloadSchema,
  resumeInterruptCommandSchema,
  type InterruptPayload,
  type ResumeInterruptCommand,
} from '@meiye/contracts';

import {
  buildInterruptPayload,
  InterruptProtocolError,
  InterruptProtocolService,
  MemoryInterruptStore,
  type InterruptResumeBridgeInput,
  type InterruptResumeBridgePort,
} from './interrupt-protocol.js';

const TS = '2026-08-08T12:00:00.000Z';

function payload(overrides: Record<string, unknown> = {}): InterruptPayload {
  return buildInterruptPayload(
    interruptPayloadSchema.parse({
      schemaVersion: 'interrupt-payload/v1',
      interruptId: 'int-1',
      threadId: 'thread-1',
      runId: 'run-1',
      workflowId: 'wf-1',
      step: 'execution_selection',
      revision: 3,
      action: 'confirm_paid_execution',
      args: { quoteId: 'q1' },
      config: {
        allowAccept: true,
        allowEdit: false,
        allowReject: true,
        allowRespond: false,
      },
      description: '确认执行付费生成',
      resourceId: 'ws-1',
      ...overrides,
    }),
  );
}

function resumeCommand(
  overrides: Record<string, unknown> = {},
): ResumeInterruptCommand {
  return resumeInterruptCommandSchema.parse({
    schemaVersion: 'interrupt-payload/v1',
    interruptId: 'int-1',
    revision: 3,
    type: 'accept',
    ...overrides,
  });
}

function service(options?: {
  members?: Set<string>;
  now?: string;
  bridge?: InterruptResumeBridgePort;
}) {
  const members = options?.members ?? new Set(['user-1:ws-1']);
  const store = new MemoryInterruptStore();
  const svc = new InterruptProtocolService(
    store,
    {
      async hasMembership(userId, workspaceId) {
        return members.has(`${userId}:${workspaceId}`);
      },
    },
    () => options?.now ?? TS,
    options?.bridge,
  );
  return { store, svc };
}

test('request and resume project the canonical interrupt lifecycle once', async () => {
  const events: Array<{ eventType: string; payload: unknown; threadId: string }> = [];
  const eventIds = new Set<string>();
  const store = new MemoryInterruptStore();
  const svc = new InterruptProtocolService(
    store,
    { async hasMembership() { return true; } },
    () => TS,
    undefined,
    {
      async project(candidate) {
        if (eventIds.has(candidate.eventId)) return;
        eventIds.add(candidate.eventId);
        events.push({
          eventType: candidate.eventType,
          payload: candidate.payload,
          threadId: candidate.threadId,
        });
      },
    },
  );

  await svc.request({ workspaceId: 'ws-1', payload: payload() });
  await svc.request({ workspaceId: 'ws-1', payload: payload() });
  await svc.resume({
    userId: 'user-1',
    workspaceId: 'ws-1',
    command: resumeCommand({ idempotencyKey: 'semantic-1' }),
  });
  await svc.resume({
    userId: 'user-1',
    workspaceId: 'ws-1',
    command: resumeCommand({ idempotencyKey: 'semantic-1' }),
  });

  assert.deepEqual(events.map((event) => event.eventType), [
    'interrupt.requested',
    'interrupt.resolved',
  ]);
  assert.equal(events[0]?.threadId, 'thread-1');
  assert.deepEqual(events[0]?.payload, {
    interruptId: 'int-1',
    interruptType: 'confirm_paid_execution',
    description: '确认执行付费生成',
    revision: 3,
    schemaVersion: 'interrupt-payload/v1',
  });
});

test('request is idempotent for identical payload', async () => {
  const { svc } = service();
  const first = await svc.request({ workspaceId: 'ws-1', payload: payload() });
  const second = await svc.request({ workspaceId: 'ws-1', payload: payload() });
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(first.record.payload.interruptId, 'int-1');
});

test('resume by interruptId+revision CAS applies once; duplicate is replay', async () => {
  const { svc } = service();
  await svc.request({ workspaceId: 'ws-1', payload: payload() });
  const command = resumeCommand({ idempotencyKey: 'resume-1' });
  const first = await svc.resume({
    userId: 'user-1',
    workspaceId: 'ws-1',
    command,
  });
  assert.equal(first.outcome, 'applied');
  const second = await svc.resume({
    userId: 'user-1',
    workspaceId: 'ws-1',
    command,
  });
  assert.equal(second.outcome, 'replayed');
});

test('stale revision resume is rejected (no position index)', async () => {
  const { svc } = service();
  await svc.request({ workspaceId: 'ws-1', payload: payload({ revision: 5 }) });
  await assert.rejects(
    () =>
      svc.resume({
        userId: 'user-1',
        workspaceId: 'ws-1',
        command: resumeCommand({ revision: 3 }),
      }),
    (error: unknown) =>
      error instanceof InterruptProtocolError && error.code === 'STALE_REVISION',
  );
});

test('different resume payload after resolve → IDEMPOTENCY_CONFLICT', async () => {
  const { svc } = service();
  await svc.request({ workspaceId: 'ws-1', payload: payload() });
  await svc.resume({
    userId: 'user-1',
    workspaceId: 'ws-1',
    command: resumeCommand({ idempotencyKey: 'k1' }),
  });
  await assert.rejects(
    () =>
      svc.resume({
        userId: 'user-1',
        workspaceId: 'ws-1',
        command: resumeCommand({ type: 'reject', idempotencyKey: 'k2' }),
      }),
    (error: unknown) =>
      error instanceof InterruptProtocolError &&
      error.code === 'IDEMPOTENCY_CONFLICT',
  );
});

test('listPendingInterrupts requires workspace membership', async () => {
  const { svc } = service({ members: new Set(['user-1:ws-1']) });
  await svc.request({ workspaceId: 'ws-1', payload: payload() });
  await svc.request({
    workspaceId: 'ws-1',
    payload: payload({
      interruptId: 'int-2',
      threadId: 'thread-2',
      revision: 1,
    }),
  });

  const all = await svc.listPending({
    userId: 'user-1',
    workspaceId: 'ws-1',
    query: { resourceId: 'ws-1' as InterruptPayload['resourceId'] },
  });
  assert.equal(all.length, 2);

  const filtered = await svc.listPending({
    userId: 'user-1',
    workspaceId: 'ws-1',
    query: {
      resourceId: 'ws-1' as InterruptPayload['resourceId'],
      threadId: 'thread-1' as InterruptPayload['threadId'],
    },
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.interruptId, 'int-1');

  await assert.rejects(
    () =>
      svc.listPending({
        userId: 'stranger',
        workspaceId: 'ws-1',
        query: { resourceId: 'ws-1' as InterruptPayload['resourceId'] },
      }),
    (error: unknown) =>
      error instanceof InterruptProtocolError &&
      error.code === 'FORBIDDEN' &&
      error.status === 403,
  );
});

test('resume without membership is forbidden', async () => {
  const { svc } = service();
  await svc.request({ workspaceId: 'ws-1', payload: payload() });
  await assert.rejects(
    () =>
      svc.resume({
        userId: 'stranger',
        workspaceId: 'ws-1',
        command: resumeCommand(),
      }),
    (error: unknown) =>
      error instanceof InterruptProtocolError && error.code === 'FORBIDDEN',
  );
});

test('expired business hold rejects resume', async () => {
  const { svc } = service({ now: '2026-08-08T13:00:00.000Z' });
  await svc.request({
    workspaceId: 'ws-1',
    payload: payload({ expiresAt: '2026-08-08T12:30:00.000Z' }),
  });
  await assert.rejects(
    () =>
      svc.resume({
        userId: 'user-1',
        workspaceId: 'ws-1',
        command: resumeCommand(),
      }),
    (error: unknown) =>
      error instanceof InterruptProtocolError && error.code === 'EXPIRED',
  );
});

test('kill/restart seam: re-request + re-resume identical payload has zero side effect', async () => {
  const { svc } = service();
  await svc.request({ workspaceId: 'ws-1', payload: payload() });
  const again = await svc.request({ workspaceId: 'ws-1', payload: payload() });
  assert.equal(again.replayed, true);
  const command = resumeCommand({ idempotencyKey: 'durable-1' });
  assert.equal(
    (await svc.resume({ userId: 'user-1', workspaceId: 'ws-1', command }))
      .outcome,
    'applied',
  );
  assert.equal(
    (await svc.resume({ userId: 'user-1', workspaceId: 'ws-1', command }))
      .outcome,
    'replayed',
  );
  const pending = await svc.listPending({
    userId: 'user-1',
    workspaceId: 'ws-1',
    query: { resourceId: 'ws-1' as InterruptPayload['resourceId'] },
  });
  assert.equal(pending.length, 0);
});

test('resume bridge delivers once per CAS application; duplicate resume re-delivers idempotently', async () => {
  const deliveries: InterruptResumeBridgeInput[] = [];
  const { svc } = service({
    bridge: {
      async deliver(input) {
        deliveries.push(input);
      },
    },
  });
  await svc.request({ workspaceId: 'ws-1', payload: payload() });
  const command = resumeCommand({ idempotencyKey: 'bridge-1' });

  const first = await svc.resume({
    userId: 'user-1',
    workspaceId: 'ws-1',
    command,
  });
  assert.equal(first.outcome, 'applied');
  const second = await svc.resume({
    userId: 'user-1',
    workspaceId: 'ws-1',
    command,
  });
  assert.equal(second.outcome, 'replayed');

  assert.equal(deliveries.length, 2, 'at-least-once re-delivery');
  assert.deepEqual(
    deliveries.map((d) => d.command),
    [command, command],
    'identical resume input on retry keeps side effects dedupable',
  );
  assert.equal(deliveries[0]?.payload.interruptId, 'int-1');
  assert.equal(deliveries[0]?.payload.revision, 3);
  assert.equal(deliveries[0]?.workspaceId, 'ws-1');
});

test('bridge failure fails resume; retry after CAS applied re-delivers (resume not lost)', async () => {
  let fail = true;
  const deliveries: InterruptResumeBridgeInput[] = [];
  const { svc } = service({
    bridge: {
      async deliver(input) {
        if (fail) throw new Error('workflow channel down');
        deliveries.push(input);
      },
    },
  });
  await svc.request({ workspaceId: 'ws-1', payload: payload() });
  const command = resumeCommand({ idempotencyKey: 'bridge-retry' });

  await assert.rejects(() =>
    svc.resume({ userId: 'user-1', workspaceId: 'ws-1', command }),
  );
  assert.equal(deliveries.length, 0);

  fail = false;
  const retried = await svc.resume({
    userId: 'user-1',
    workspaceId: 'ws-1',
    command,
  });
  assert.equal(retried.outcome, 'replayed', 'CAS already applied, replay recovers');
  assert.equal(deliveries.length, 1, 'replayed resume re-delivers the command');
  assert.deepEqual(deliveries[0]?.command, command);
});

test('resolveByWorkflow syncs a mirrored interrupt without a resume command', async () => {
  const { svc } = service();
  await svc.request({ workspaceId: 'ws-1', payload: payload() });
  const first = await svc.resolveByWorkflow({
    workspaceId: 'ws-1',
    interruptId: 'int-1',
    revision: 3,
    source: 'core_hold_expired',
  });
  assert.equal(first, 'applied');
  const again = await svc.resolveByWorkflow({
    workspaceId: 'ws-1',
    interruptId: 'int-1',
    revision: 3,
    source: 'core_hold_expired',
  });
  assert.equal(again, 'replayed', 'duplicate workflow resolution replays');

  const pending = await svc.listPending({
    userId: 'user-1',
    workspaceId: 'ws-1',
    query: { resourceId: 'ws-1' as InterruptPayload['resourceId'] },
  });
  assert.equal(pending.length, 0, 'resolved interrupts leave the pending list');

  // A later merchant resume on the resolved row conflicts (workflow moved on).
  await assert.rejects(
    () =>
      svc.resume({
        userId: 'user-1',
        workspaceId: 'ws-1',
        command: resumeCommand({ idempotencyKey: 'after-workflow-resolve' }),
      }),
    (error: unknown) =>
      error instanceof InterruptProtocolError &&
      error.code === 'IDEMPOTENCY_CONFLICT',
  );
});

test('resolveByWorkflow is a no-op for foreign or missing rows', async () => {
  const { svc } = service();
  await svc.request({ workspaceId: 'ws-1', payload: payload() });
  assert.equal(
    await svc.resolveByWorkflow({
      workspaceId: 'ws-2',
      interruptId: 'int-1',
      revision: 3,
      source: 'decision',
    }),
    'replayed',
  );
  assert.equal(
    await svc.resolveByWorkflow({
      workspaceId: 'ws-1',
      interruptId: 'int-unknown',
      revision: 3,
      source: 'decision',
    }),
    'replayed',
  );
});
