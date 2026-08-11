import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createCoreServer } from '../../server.js';
import { P1ApplicationService } from '../foundation/application-service.js';
import { MemoryFoundationRepository } from '../foundation/memory-repository.js';
import {
  AdminConfigFoundationModule,
  MemoryAdminConfigRepository,
} from '../admin-config/foundation-module.js';

async function withServer(
  run: (base: string) => Promise<void>
) {
  const foundation = new MemoryFoundationRepository();
  foundation.grantOwner('workspace-a', 'owner-a');
  const config = new MemoryAdminConfigRepository();
  const server = createCoreServer({
    p1ApplicationService: new P1ApplicationService(foundation, {
      operations: [new AdminConfigFoundationModule(config)],
    }),
    serviceToken: 'test-service-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const { port } = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${port}/v1/workspaces/workspace-a/p1`);
  } finally {
    server.close();
  }
}

function headers(
  role: 'admin' | 'owner' | 'operator' | 'reviewer',
  userId: string
): Record<string, string> {
  if (role === 'admin') {
    return {
      'content-type': 'application/json',
      'x-core-actor': 'admin',
      'x-correlation-id': `perm-${role}`,
      'x-service-token': 'test-service-token',
      'x-user-id': userId,
      'x-workspace-id': 'workspace-a',
    };
  }
  return {
    'content-type': 'application/json',
    'x-correlation-id': `perm-${role}`,
    'x-service-token': 'test-service-token',
    'x-user-id': userId,
    'x-workspace-id': 'workspace-a',
    'x-workspace-role': role,
  };
}

test('HTTP default-denies unregistered module actions with FORBIDDEN/403', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/commands`, {
      method: 'POST',
      headers: {
        ...headers('admin', 'platform-admin'),
        'idempotency-key': 'deny-unregistered-1',
      },
      body: JSON.stringify({
        action: 'totally_unknown_action_xyz',
        module: 'admin-config',
        payload: {},
      }),
    });
    assert.equal(response.status, 403);
    const body = (await response.json()) as {
      error: { code: string; message: string };
    };
    assert.equal(body.error.code, 'FORBIDDEN');
    assert.match(body.error.message, /not registered/i);
  });
});

test('HTTP seven governance domains: admin allowed, owner denied', async () => {
  // Real admin-config module backs config.publish; other domains assert
  // authorize-only (403 for owner, non-403-auth for admin when module missing).
  const cases: Array<{
    domain: string;
    kind: 'command' | 'query';
    module: string;
    action: string;
    /** When true, module is wired and admin should reach 200. */
    wiredSuccess?: boolean;
  }> = [
    {
      domain: 'config.publish',
      kind: 'command',
      module: 'admin-config',
      action: 'config_apply',
      wiredSuccess: true,
    },
    {
      domain: 'system.capability.view',
      kind: 'query',
      module: 'job-runtime',
      action: 'observability',
    },
    {
      domain: 'task.recover',
      kind: 'command',
      module: 'model-supply',
      action: 'recover_task',
    },
    {
      domain: 'channel.lifecycle.manage',
      kind: 'command',
      module: 'model-supply',
      action: 'isolate_channel',
    },
    {
      domain: 'account.commerce.govern',
      kind: 'query',
      module: 'redemptions',
      action: 'list',
    },
    {
      domain: 'credential.govern',
      kind: 'command',
      module: 'integrations',
      action: 'admin_store_provider_credential',
    },
    {
      domain: 'audit.view',
      kind: 'query',
      module: 'integrations',
      action: 'audit',
    },
  ];

  await withServer(async (base) => {
    for (const sample of cases) {
      const path = sample.kind === 'command' ? 'commands' : 'query';
      const ownerInit: RequestInit = {
        method: 'POST',
        headers:
          sample.kind === 'command'
            ? {
                ...headers('owner', 'owner-a'),
                'idempotency-key': `owner-${sample.domain}`,
              }
            : headers('owner', 'owner-a'),
        body: JSON.stringify({
          action: sample.action,
          module: sample.module,
          payload:
            sample.wiredSuccess
              ? {
                  key: 'model.execution.mode',
                  value: 'direct',
                  expectedRevision: null,
                  reason: 'owner attempt',
                }
              : {},
        }),
      };
      const ownerDenied = await fetch(`${base}/${path}`, ownerInit);
      assert.equal(
        ownerDenied.status,
        403,
        `${sample.domain} owner should be forbidden`
      );
      assert.equal(
        ((await ownerDenied.json()) as { error: { code: string } }).error.code,
        'FORBIDDEN'
      );

      const adminInit: RequestInit = {
        method: 'POST',
        headers:
          sample.kind === 'command'
            ? {
                ...headers('admin', 'platform-admin'),
                'idempotency-key': `admin-${sample.domain}`,
              }
            : headers('admin', 'platform-admin'),
        body: JSON.stringify({
          action: sample.action,
          module: sample.module,
          payload:
            sample.wiredSuccess
              ? {
                  key: 'model.execution.mode',
                  value: 'direct',
                  expectedRevision: null,
                  reason: 'admin apply',
                }
              : {},
        }),
      };
      const adminResponse = await fetch(`${base}/${path}`, adminInit);
      if (sample.wiredSuccess) {
        assert.equal(
          adminResponse.status,
          200,
          `${sample.domain} admin wired success`
        );
      } else {
        // Authorization passed (not FORBIDDEN from capability check).
        // Module may be absent → non-403 business error is acceptable.
        assert.notEqual(
          adminResponse.status,
          403,
          `${sample.domain} admin must not be capability-forbidden`
        );
      }
    }
  });
});

test('HTTP Cloudflare write verbs stay FORBIDDEN for admin', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/commands`, {
      method: 'POST',
      headers: {
        ...headers('admin', 'platform-admin'),
        'idempotency-key': 'cf-write-deny',
      },
      body: JSON.stringify({
        action: 'cloudflare_deploy',
        module: 'admin-config',
        payload: {},
      }),
    });
    assert.equal(response.status, 403);
    assert.equal(
      ((await response.json()) as { error: { code: string } }).error.code,
      'FORBIDDEN'
    );
  });
});
