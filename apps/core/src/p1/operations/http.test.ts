import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type { DiagnosticRun } from '@meiye/contracts';
import type { DiagnosticRepository } from '../../diagnostics/repository.js';
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
  const work = await operationsService.createBlankWork(
    {
      actor: 'owner',
      correlationId: 'corr-p1-http-setup',
      userId: 'owner-a',
      workspaceId: 'workspace-a',
    },
    { height: 1350, name: 'HTTP boundary work', width: 1080 },
  );
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

  const labelUpdateResponse = await fetch(`${base}/commands`, {
    body: JSON.stringify({
      action: 'set_creation_labels',
      module: 'operations',
      payload: {
        aigcLabelEnabled: true,
        brandWatermarkEnabled: false,
        workId: work.id,
      },
    }),
    headers: { ...headers, 'idempotency-key': 'p1-set-creation-labels' },
    method: 'POST',
  });
  assert.equal(labelUpdateResponse.status, 200);
  const labelUpdatePayload = (await labelUpdateResponse.json()) as {
    data: { aigcLabelEnabled: boolean; brandWatermarkEnabled: boolean };
  };
  assert.equal(labelUpdatePayload.data.aigcLabelEnabled, true);
  assert.equal(labelUpdatePayload.data.brandWatermarkEnabled, false);

  const catalog = await fetch(`${base}/query`, {
    body: JSON.stringify({
      action: 'creation_catalog',
      module: 'operations',
      payload: {},
    }),
    headers,
    method: 'POST',
  });
  assert.equal(catalog.status, 200);
  const catalogPayload = (await catalog.json()) as {
    data: {
      shortcuts: unknown[];
      templates: unknown[];
      userTemplates: unknown[];
    };
  };
  assert.deepEqual(catalogPayload.data, {
    shortcuts: [],
    templates: [],
    userTemplates: [],
  });

  const workProjection = await fetch(`${base}/query`, {
    body: JSON.stringify({
      action: 'work',
      module: 'operations',
      payload: { workId: work.id },
    }),
    headers,
    method: 'POST',
  });
  assert.equal(workProjection.status, 200);
  const workPayload = (await workProjection.json()) as {
    data: { aigcLabelEnabled: boolean; brandWatermarkEnabled: boolean };
  };
  assert.equal(workPayload.data.aigcLabelEnabled, true);
  assert.equal(workPayload.data.brandWatermarkEnabled, false);

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

  const operatorUpdate = await fetch(`${base}/commands`, {
    body: JSON.stringify({
      action: 'set_creation_labels',
      module: 'operations',
      payload: {
        aigcLabelEnabled: false,
        brandWatermarkEnabled: true,
        workId: work.id,
      },
    }),
    headers: {
      ...headers,
      'idempotency-key': 'p1-operator-set-creation-labels',
      'x-user-id': 'operator-a',
      'x-workspace-role': 'operator',
    },
    method: 'POST',
  });
  assert.equal(operatorUpdate.status, 200);

  const reviewerUpdate = await fetch(`${base}/commands`, {
    body: JSON.stringify({
      action: 'set_creation_labels',
      module: 'operations',
      payload: {
        aigcLabelEnabled: false,
        brandWatermarkEnabled: true,
        workId: work.id,
      },
    }),
    headers: {
      ...headers,
      'idempotency-key': 'p1-reviewer-set-creation-labels',
      'x-user-id': 'reviewer-a',
      'x-workspace-role': 'reviewer',
    },
    method: 'POST',
  });
  assert.equal(reviewerUpdate.status, 403);

  const reviewerWork = await fetch(`${base}/query`, {
    body: JSON.stringify({
      action: 'work',
      module: 'operations',
      payload: { workId: work.id },
    }),
    headers: {
      ...headers,
      'x-user-id': 'reviewer-a',
      'x-workspace-role': 'reviewer',
    },
    method: 'POST',
  });
  assert.equal(reviewerWork.status, 200);

  const spoofed = await fetch(`${base}/query`, {
    body: JSON.stringify({
      action: 'work',
      module: 'operations',
      payload: { workId: work.id },
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
    ['commands', 'set_creation_labels'],
    ['query', 'work'],
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
        action: 'set_creation_labels',
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
        action: 'edit_content_package_version',
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
          action: 'set_creation_labels',
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
