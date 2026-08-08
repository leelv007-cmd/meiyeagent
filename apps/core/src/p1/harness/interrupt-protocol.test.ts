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
  );
  return { store, svc };
}

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
