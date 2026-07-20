import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type { DiagnosticRun, WorkflowProgressFrame } from '@meiye/contracts';

import type { DiagnosticRepository } from '../diagnostics/repository.js';
import { createCoreServer } from '../server.js';
import {
  WorkflowEventApplicationService,
  type WorkflowEventSource,
} from './workflow-events.js';

const diagnostics: DiagnosticRepository = {
  async create(run: DiagnosticRun) {
    return run;
  },
  async get() {
    return null;
  },
  async save(run: DiagnosticRun) {
    return run;
  },
};

test('workflow SSE preserves the cursor, heartbeat, frame types, and ownership 404', async (t) => {
  const cursors: Array<string | undefined> = [];
  let streamReads = 0;
  const progress: WorkflowProgressFrame = {
    data: {
      eventId: 'task-a:2',
      message: '正在编译成品简报',
      occurredAt: '2026-07-18T08:00:01.000Z',
      sequence: 2,
      stage: 'brief_compilation',
      state: 'running',
      workflowId: 'task-a',
      workflowType: 'beauty_marketing',
    },
    event: 'workflow.progress',
  };
  const source: WorkflowEventSource = {
    async owns(workspaceId, workflowId) {
      return workspaceId === 'workspace-a' && workflowId === 'task-a';
    },
    async *stream(input) {
      streamReads += 1;
      cursors.push(input.lastEventId);
      yield progress;
      yield {
        data: {
          occurredAt: '2026-07-18T08:00:02.000Z',
          snapshot: { packageId: 'package-a' },
          sourceRevision: 3,
          status: 'success',
          workflowId: 'task-a',
        },
        event: 'workflow.state',
      };
    },
  };
  const server = createCoreServer({
    diagnosticRepository: diagnostics,
    serviceToken: 'test-service-token',
    workflowEvents: new WorkflowEventApplicationService([source]),
    workflowHeartbeatMs: 5,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const headers = {
    'last-event-id': 'task-a:1',
    'x-service-token': 'test-service-token',
    'x-user-id': 'owner-a',
    'x-workspace-id': 'workspace-a',
    'x-workspace-role': 'owner',
  };

  const response = await fetch(
    `http://127.0.0.1:${port}/v1/workspaces/workspace-a/p1/workflows/task-a/events`,
    { headers }
  );
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('content-type'),
    'text/event-stream; charset=utf-8'
  );
  assert.equal(
    response.headers.get('x-meiye-stream-protocol'),
    'workflow-events-v1'
  );
  assert.match(body, /: heartbeat/);
  assert.match(body, /id: task-a:2\nevent: workflow\.progress/);
  assert.match(body, /id: task-a:3:success\nevent: workflow\.state/);
  assert.deepEqual(cursors, ['task-a:1']);

  const foreign = await fetch(
    `http://127.0.0.1:${port}/v1/workspaces/workspace-a/p1/workflows/task-b/events`,
    { headers }
  );
  assert.equal(foreign.status, 404);
  assert.equal(streamReads, 1);
});
