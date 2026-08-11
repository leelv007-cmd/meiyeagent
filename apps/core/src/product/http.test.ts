import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type { ProductState } from '@meiye/contracts';
import { createCoreServer } from '../server.js';
import { ProductService } from './product-service.js';
import { MemoryProductRepository } from './repository.js';

test('product HTTP boundary trusts service-authenticated identity and hides cross-workspace facts', async (t) => {
  const repository = new MemoryProductRepository();
  repository.grantMembership('user-a', 'workspace-a');
  repository.grantMembership('user-b', 'workspace-b');
  const server = createCoreServer({
    productService: new ProductService({ repository }),
    serviceToken: 'test-service-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());

  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/v1/workspaces/workspace-a/state`;
  const allowed = await fetch(url, {
    headers: {
      'x-correlation-id': 'corr-product-http',
      'x-service-token': 'test-service-token',
      'x-user-id': 'user-a',
      'x-workspace-id': 'workspace-a',
      'x-workspace-role': 'owner',
    },
  });
  assert.equal(allowed.status, 200);
  const payload = (await allowed.json()) as { data: ProductState };
  assert.equal(payload.data.workspaceId, 'workspace-a');

  const denied = await fetch(url, {
    headers: {
      'x-service-token': 'test-service-token',
      'x-user-id': 'user-b',
      'x-workspace-id': 'workspace-a',
      'x-workspace-role': 'owner',
    },
  });
  assert.equal(denied.status, 404);

  const clientWorkspaceSpoof = await fetch(url, {
    headers: {
      'x-service-token': 'test-service-token',
      'x-user-id': 'user-a',
      'x-workspace-id': 'workspace-b',
      'x-workspace-role': 'owner',
    },
  });
  assert.equal(clientWorkspaceSpoof.status, 404);

  const creationCheck = await fetch(
    `http://127.0.0.1:${port}/v1/workspaces/workspace-a/commands`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'creation-check-http-command',
        'x-correlation-id': 'corr-product-http',
        'x-service-token': 'test-service-token',
        'x-user-id': 'user-a',
        'x-workspace-id': 'workspace-a',
        'x-workspace-role': 'owner',
      },
      body: JSON.stringify({
        type: 'check_content',
        text: '保证效果并绕过审核',
      }),
    }
  );
  assert.equal(creationCheck.status, 200);
  const creationPayload = (await creationCheck.json()) as {
    data: { state: ProductState };
  };
  assert.equal(creationPayload.data.state.complianceResults.length, 0);

  const crossWorkspaceMutation = await fetch(
    `http://127.0.0.1:${port}/v1/workspaces/workspace-a/commands`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'cross-workspace-command',
        'x-service-token': 'test-service-token',
        'x-user-id': 'user-b',
        'x-workspace-id': 'workspace-a',
        'x-workspace-role': 'owner',
      },
      body: JSON.stringify({ type: 'hide_example', hidden: true }),
    }
  );
  assert.equal(crossWorkspaceMutation.status, 404);

  const workspaceBMutation = await fetch(
    `http://127.0.0.1:${port}/v1/workspaces/workspace-b/commands`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'workspace-b-command',
        'x-service-token': 'test-service-token',
        'x-user-id': 'user-b',
        'x-workspace-id': 'workspace-b',
        'x-workspace-role': 'owner',
      },
      body: JSON.stringify({ type: 'hide_example', hidden: true }),
    }
  );
  assert.equal(workspaceBMutation.status, 200);
  const workspaceAAfter = await fetch(url, {
    headers: {
      'x-service-token': 'test-service-token',
      'x-user-id': 'user-a',
      'x-workspace-id': 'workspace-a',
      'x-workspace-role': 'owner',
    },
  });
  const workspaceAAfterPayload = (await workspaceAAfter.json()) as {
    data: ProductState;
  };
  assert.deepEqual(
    workspaceAAfterPayload.data.exampleStores.map((example) => example.hidden),
    payload.data.exampleStores.map((example) => example.hidden)
  );

  const retiredSynchronousRender = await fetch(
    `http://127.0.0.1:${port}/v1/workspaces/workspace-a/video-jobs/legacy-job/render`,
    {
      method: 'POST',
      headers: {
        'content-type': 'image/png',
        'idempotency-key': 'legacy-render-must-be-retired',
        'x-core-actor': 'worker',
        'x-service-token': 'test-service-token',
        'x-user-id': 'user-a',
        'x-worker-id': 'legacy-worker',
        'x-workspace-id': 'workspace-a',
      },
      body: new Uint8Array([0]),
    }
  );
  assert.equal(retiredSynchronousRender.status, 404);
});

test('product HTTP boundary enforces trusted workspace command roles', async (t) => {
  const repository = new MemoryProductRepository();
  repository.grantMembership('reviewer-a', 'workspace-a');
  const server = createCoreServer({
    productService: new ProductService({ repository }),
    serviceToken: 'test-service-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());

  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/v1/workspaces/workspace-a/commands`;
  const baseHeaders = {
    'content-type': 'application/json',
    'x-service-token': 'test-service-token',
    'x-user-id': 'reviewer-a',
    'x-workspace-id': 'workspace-a',
  };
  const command = JSON.stringify({
    type: 'check_content',
    text: '测试内容',
  });

  const missingRole = await fetch(url, {
    method: 'POST',
    headers: { ...baseHeaders, 'idempotency-key': 'missing-role' },
    body: command,
  });
  assert.equal(missingRole.status, 403);

  const reviewer = await fetch(url, {
    method: 'POST',
    headers: {
      ...baseHeaders,
      'idempotency-key': 'reviewer-generate',
      'x-workspace-role': 'reviewer',
    },
    body: command,
  });
  assert.equal(reviewer.status, 403);
  assert.equal(
    ((await reviewer.json()) as { error: { code: string } }).error.code,
    'COMMAND_ROLE_FORBIDDEN'
  );
});
