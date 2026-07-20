import assert from 'node:assert/strict';
import test from 'node:test';

import {
  workspaceCoreFetchInit,
  workspaceCoreUpstreamPath,
  workspaceHarnessDecisionResource,
  workspaceWorkflowEventResource,
} from '@/lib/core-request';

test('the workspace stream proxy forwards the browser Request signal upstream', async () => {
  const controller = new AbortController();
  const request = new Request('http://localhost/api/core/p1/copy/stream', {
    body: '{}',
    method: 'POST',
    signal: controller.signal,
  });
  const init = workspaceCoreFetchInit(request, new Headers(), '{}');
  const reason = new DOMException('client disconnected', 'AbortError');
  const upstream = new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
      once: true,
    });
  });

  assert.equal(init.signal, request.signal);
  controller.abort(reason);
  await assert.rejects(
    upstream,
    (error: unknown) => error === reason && request.signal.aborted
  );
});

test('the harness decision proxy encodes one task path without changing the workspace route', () => {
  const request = new Request(
    'http://localhost/api/core/p1/harness/tasks/task%2Fone/decision'
  );
  const resource = workspaceHarnessDecisionResource('task/one');

  assert.equal(resource, 'p1/harness/tasks/task%2Fone/decision');
  assert.equal(
    workspaceCoreUpstreamPath('workspace-a', resource, request.url),
    '/v1/workspaces/workspace-a/p1/harness/tasks/task%2Fone/decision'
  );
});

test('the harness task collection keeps the authenticated workspace path', () => {
  assert.equal(
    workspaceCoreUpstreamPath(
      'workspace-a',
      'p1/harness/tasks',
      'http://localhost/api/core/p1/harness/tasks'
    ),
    '/v1/workspaces/workspace-a/p1/harness/tasks'
  );
});

test('the workflow proxy preserves Last-Event-ID, query, and one encoded dynamic path', () => {
  const request = new Request(
    'http://localhost/api/core/p1/workflows/task%2Fone/events?source=video',
    { headers: { 'last-event-id': 'task-one:7:running' } }
  );
  const headers = new Headers();
  const init = workspaceCoreFetchInit(request, headers, undefined);
  const resource = workspaceWorkflowEventResource('task/one');

  assert.equal(init.headers, headers);
  assert.equal(headers.get('last-event-id'), 'task-one:7:running');
  assert.equal(resource, 'p1/workflows/task%2Fone/events');
  assert.equal(
    workspaceCoreUpstreamPath('workspace-a', resource, request.url),
    '/v1/workspaces/workspace-a/p1/workflows/task%2Fone/events?source=video'
  );
});
