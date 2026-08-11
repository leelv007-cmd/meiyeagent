import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
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
