import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type { DiagnosticRun } from '@meiye/contracts';
import type { DiagnosticRepository } from '../../diagnostics/repository.js';
import { AdvancedCanvasAdoptionError } from '../../pro-studio-runtime/adoption-rules.js';
import { createCoreServer } from '../../server.js';
import {
  MemoryFoundationRepository,
  P1DomainError,
  P1ApplicationService,
} from '../foundation/index.js';
import {
  MemoryOperationsRepository,
  OperationsError,
  OperationsApplicationService,
  OperationsFoundationModule,
  RecordedCanvasExportAdapter,
  RecordedImageGenerationAdapter,
} from './index.js';
import { ApprovalReceiptError } from './content-package-approval.js';
import { ContentPackageDeliveryError } from './content-package-delivery.js';

const emptyDiagnostics: DiagnosticRepository = {
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

test('P1 HTTP boundary uses the shared module seam and workspace identity', async (t) => {
  const foundation = new MemoryFoundationRepository();
  const operations = new MemoryOperationsRepository();
  foundation.grantOwner('workspace-a', 'owner-a');
  foundation.grantMembership('workspace-a', 'operator-a', 'operator');
  foundation.grantMembership('workspace-a', 'reviewer-a', 'reviewer');
  operations.grantMembership('owner-a', 'workspace-a');
  operations.grantMembership('operator-a', 'workspace-a');
  operations.grantMembership('reviewer-a', 'workspace-a');
  const operationsService = new OperationsApplicationService(operations, {
    canvasExporter: new RecordedCanvasExportAdapter(),
    imageGenerator: new RecordedImageGenerationAdapter(),
    notifier: { async send() {} },
  });
  const p1ApplicationService = new P1ApplicationService(foundation, {
    operations: [new OperationsFoundationModule(operationsService)],
  });
  const server = createCoreServer({
    diagnosticRepository: emptyDiagnostics,
    p1ApplicationService,
    serviceToken: 'test-service-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/v1/workspaces/workspace-a/p1`;
  const headers = {
    'content-type': 'application/json',
    'x-correlation-id': 'corr-p1-http',
    'x-service-token': 'test-service-token',
    'x-user-id': 'owner-a',
    'x-workspace-id': 'workspace-a',
    'x-workspace-role': 'owner',
  };

  const created = await fetch(`${base}/commands`, {
    body: JSON.stringify({
      action: 'create_task',
      module: 'operations',
      payload: {
        dueAt: '2026-07-14T09:00:00.000Z',
        executable: true,
        risk: 'normal',
        source: 'manual',
        title: '确认本周内容',
      },
    }),
    headers: { ...headers, 'idempotency-key': 'p1-create-task' },
    method: 'POST',
  });
  assert.equal(created.status, 200);
  const createdPayload = (await created.json()) as { data: { id: string } };

  const inbox = await fetch(`${base}/query`, {
    body: JSON.stringify({
      action: 'inbox',
      module: 'operations',
      payload: {},
    }),
    headers,
    method: 'POST',
  });
  assert.equal(inbox.status, 200);
  const inboxPayload = (await inbox.json()) as {
    data: { tasks: Array<{ id: string }> };
  };
  assert.deepEqual(inboxPayload.data.tasks.map((task) => task.id), [
    createdPayload.data.id,
  ]);

  const creativeWork = await fetch(`${base}/commands`, {
    body: JSON.stringify({
      action: 'create_creative_work',
      module: 'operations',
      payload: {
        intent: '为本周项目准备一条真实内容',
        mode: 'agent',
        operation: 'video.generate',
        sessionId: 'session-http-a',
        sourceReferences: [{ id: createdPayload.data.id, kind: 'task' }],
      },
    }),
    headers: { ...headers, 'idempotency-key': 'p1-create-creative-work' },
    method: 'POST',
  });
  assert.equal(creativeWork.status, 200);
  assert.equal((await creativeWork.json()).data.operation, 'video.generate');
  const creativeProjection = await fetch(`${base}/query`, {
    body: JSON.stringify({
      action: 'creative_workbench',
      module: 'operations',
      payload: {},
    }),
    headers,
    method: 'POST',
  });
  assert.equal(creativeProjection.status, 200);
  const creativePayload = (await creativeProjection.json()) as {
    data: { works: unknown[]; jobs: unknown[]; contents: unknown[] };
  };
  assert.equal(creativePayload.data.works.length, 1);
  assert.equal(creativePayload.data.jobs.length, 0);
  assert.equal(creativePayload.data.contents.length, 0);

  const adminCreated = await fetch(`${base}/commands`, {
    body: JSON.stringify({
      action: 'admin_create_template',
      module: 'operations',
      payload: {
        document: {
          height: 1350,
          pages: [{ elements: [], id: 'admin-page' }],
          width: 1080,
        },
        family: 'seasonal_campaign',
        name: '管理员模板',
        tags: ['活动'],
      },
    }),
    headers: {
      ...headers,
      'idempotency-key': 'p1-admin-create-template',
      'x-core-actor': 'admin',
    },
    method: 'POST',
  });
  assert.equal(adminCreated.status, 200);

  const operatorCreate = await fetch(`${base}/commands`, {
    body: JSON.stringify({
      action: 'create_task',
      module: 'operations',
      payload: {
        dueAt: '2026-07-15T08:00:00.000Z',
        executable: true,
        risk: 'normal',
        source: 'manual',
        title: '操作员创建任务',
      },
    }),
    headers: {
      ...headers,
      'idempotency-key': 'p1-operator-create-task',
      'x-user-id': 'operator-a',
      'x-workspace-role': 'operator',
    },
    method: 'POST',
  });
  assert.equal(operatorCreate.status, 200);

  const reviewerCreate = await fetch(`${base}/commands`, {
    body: JSON.stringify({
      action: 'create_task',
      module: 'operations',
      payload: {
        dueAt: '2026-07-15T09:00:00.000Z',
        executable: true,
        risk: 'normal',
        source: 'manual',
        title: '审核员不得创建任务',
      },
    }),
    headers: {
      ...headers,
      'idempotency-key': 'p1-reviewer-create-task',
      'x-user-id': 'reviewer-a',
      'x-workspace-role': 'reviewer',
    },
    method: 'POST',
  });
  assert.equal(reviewerCreate.status, 403);

  const reviewerInbox = await fetch(`${base}/query`, {
    body: JSON.stringify({
      action: 'inbox',
      module: 'operations',
      payload: {},
    }),
    headers: {
      ...headers,
      'x-user-id': 'reviewer-a',
      'x-workspace-role': 'reviewer',
    },
    method: 'POST',
  });
  assert.equal(reviewerInbox.status, 200);

  const spoofed = await fetch(`${base}/query`, {
    body: JSON.stringify({
      action: 'inbox',
      module: 'operations',
      payload: {},
    }),
    headers: { ...headers, 'x-workspace-id': 'workspace-b' },
    method: 'POST',
  });
  assert.equal(spoofed.status, 404);
});

test('P1 HTTP boundary never exposes unexpected exception messages', async (t) => {
  const privateMessage = 'postgres://private-user:private-password@internal';
  const p1ApplicationService = {
    async executeModule() {
      throw new Error(privateMessage);
    },
    async queryModule() {
      throw new Error(privateMessage);
    },
  } as unknown as P1ApplicationService;
  const server = createCoreServer({
    diagnosticRepository: emptyDiagnostics,
    p1ApplicationService,
    serviceToken: 'test-service-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/v1/workspaces/workspace-a/p1`;
  const headers = {
    'content-type': 'application/json',
    'x-correlation-id': 'corr-p1-redaction',
    'x-service-token': 'test-service-token',
    'x-user-id': 'owner-a',
    'x-workspace-id': 'workspace-a',
    'x-workspace-role': 'owner',
  };

  for (const [path, action] of [
    ['commands', 'create_task'],
    ['query', 'inbox'],
  ] as const) {
    const response = await fetch(`${base}/${path}`, {
      body: JSON.stringify({ action, module: 'operations', payload: {} }),
      headers: {
        ...headers,
        ...(path === 'commands'
          ? { 'idempotency-key': 'p1-redaction-command' }
          : {}),
      },
      method: 'POST',
    });
    const body = await response.text();
    assert.equal(response.status, 400);
    assert.doesNotMatch(body, /private-user|private-password|internal/);
  }
});

test('P1 HTTP boundary preserves the typed insufficient entitlement code', async (t) => {
  const p1ApplicationService = {
    async executeModule() {
      throw new P1DomainError(
        'INSUFFICIENT_ENTITLEMENT',
        'Insufficient product usage allowance.',
      );
    },
  } as unknown as P1ApplicationService;
  const server = createCoreServer({
    diagnosticRepository: emptyDiagnostics,
    p1ApplicationService,
    serviceToken: 'test-service-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const response = await fetch(
    `http://127.0.0.1:${port}/v1/workspaces/workspace-a/p1/commands`,
    {
      body: JSON.stringify({
        action: 'create_task',
        module: 'operations',
        payload: {},
      }),
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'insufficient-command',
        'x-correlation-id': 'corr-insufficient',
        'x-service-token': 'test-service-token',
        'x-user-id': 'owner-a',
        'x-workspace-id': 'workspace-a',
        'x-workspace-role': 'owner',
      },
      method: 'POST',
    },
  );

  assert.equal(response.status, 409);
  const payload = (await response.json()) as {
    error: { code: string };
  };
  assert.equal(payload.error.code, 'INSUFFICIENT_ENTITLEMENT');
});

test('P1 HTTP boundary returns the current ContentPackage revision on conflict', async (t) => {
  const p1ApplicationService = {
    async executeModule() {
      throw new OperationsError(
        'CONTENT_PACKAGE_REVISION_CONFLICT',
        'ContentPackage revision changed. Refresh and retry.',
        409,
        { currentRevision: 4, expectedRevision: 3, packageId: 'package-1' },
      );
    },
  } as unknown as P1ApplicationService;
  const server = createCoreServer({
    diagnosticRepository: emptyDiagnostics,
    p1ApplicationService,
    serviceToken: 'test-service-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const response = await fetch(
    `http://127.0.0.1:${port}/v1/workspaces/workspace-a/p1/commands`,
    {
      body: JSON.stringify({
        action: 'cancel_content_package',
        module: 'operations',
        payload: { expectedRevision: 3, packageId: 'package-1' },
      }),
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'conflicting-command',
        'x-correlation-id': 'corr-p1-conflict',
        'x-service-token': 'test-service-token',
        'x-user-id': 'owner-a',
        'x-workspace-id': 'workspace-a',
        'x-workspace-role': 'owner',
      },
      method: 'POST',
    },
  );

  assert.equal(response.status, 409);
  const payload = (await response.json()) as {
    error: { code: string; details: Record<string, unknown> };
  };
  assert.equal(payload.error.code, 'CONTENT_PACKAGE_REVISION_CONFLICT');
  assert.deepEqual(payload.error.details, {
    currentRevision: 4,
    expectedRevision: 3,
    packageId: 'package-1',
  });
});

test('P1 HTTP boundary preserves Pro Studio ContentPackage conflict details', async (t) => {
  const p1ApplicationService = {
    async executeModule() {
      throw new AdvancedCanvasAdoptionError(
        'CONTENT_PACKAGE_REVISION_CONFLICT',
        'ContentPackage revision changed. Refresh and retry.',
        { currentRevision: 5, expectedRevision: 4, packageId: 'package-1' },
      );
    },
  } as unknown as P1ApplicationService;
  const server = createCoreServer({
    diagnosticRepository: emptyDiagnostics,
    p1ApplicationService,
    serviceToken: 'test-service-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const response = await fetch(
    `http://127.0.0.1:${port}/v1/workspaces/workspace-a/p1/commands`,
    {
      body: JSON.stringify({
        action: 'adopt',
        module: 'advanced-canvas',
        payload: {},
      }),
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'pro-studio-conflict',
        'x-correlation-id': 'corr-pro-studio-conflict',
        'x-service-token': 'test-service-token',
        'x-user-id': 'owner-a',
        'x-workspace-id': 'workspace-a',
        'x-workspace-role': 'owner',
      },
      method: 'POST',
    },
  );

  assert.equal(response.status, 409);
  const payload = (await response.json()) as {
    error: { code: string; details: Record<string, unknown> };
  };
  assert.equal(payload.error.code, 'CONTENT_PACKAGE_REVISION_CONFLICT');
  assert.deepEqual(payload.error.details, {
    currentRevision: 5,
    expectedRevision: 4,
    packageId: 'package-1',
  });
});

test('P1 HTTP boundary preserves approval and delivery error codes and statuses', async (t) => {
  const failures = [
    {
      code: 'APPROVAL_REQUEST_NOT_PENDING',
      error: new ApprovalReceiptError(
        'APPROVAL_REQUEST_NOT_PENDING',
        'The approval request is no longer pending.'
      ),
      status: 409,
    },
    {
      code: 'APPROVAL_NOT_FOUND',
      error: new ApprovalReceiptError(
        'APPROVAL_NOT_FOUND',
        'The approval receipt was not found.'
      ),
      status: 404,
    },
    {
      code: 'CONTENT_PACKAGE_REVISION_CONFLICT',
      error: new ContentPackageDeliveryError(
        'CONTENT_PACKAGE_REVISION_CONFLICT',
        'ContentPackage revision changed. Refresh and retry.'
      ),
      status: 409,
    },
  ];
  let attempt = 0;
  const p1ApplicationService = {
    async executeModule() {
      throw failures[attempt++]!.error;
    },
  } as unknown as P1ApplicationService;
  const server = createCoreServer({
    diagnosticRepository: emptyDiagnostics,
    p1ApplicationService,
    serviceToken: 'test-service-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  for (const failure of failures) {
    const response = await fetch(
      `http://127.0.0.1:${port}/v1/workspaces/workspace-a/p1/commands`,
      {
        body: JSON.stringify({
          action: 'create_task',
          module: 'operations',
          payload: {},
        }),
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `typed-error-${failure.code}`,
          'x-correlation-id': `corr-${failure.code}`,
          'x-service-token': 'test-service-token',
          'x-user-id': 'owner-a',
          'x-workspace-id': 'workspace-a',
          'x-workspace-role': 'owner',
        },
        method: 'POST',
      }
    );
    const payload = (await response.json()) as {
      error: { code: string };
    };

    assert.equal(response.status, failure.status);
    assert.equal(payload.error.code, failure.code);
  }
});
