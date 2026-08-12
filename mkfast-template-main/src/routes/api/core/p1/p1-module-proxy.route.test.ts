import assert from 'node:assert/strict';
import test from 'node:test';

import type { AuthSession } from '@/auth/recent-admin-session';
import type { AdminConfigProxyDeniedObservation } from '@/lib/admin-config-proxy-authorization';
import {
  createP1CommandsHandlers,
  createP1QueryHandlers,
  type P1ModuleProxyForwardUpstream,
} from '@/lib/p1-module-proxy';

/**
 * Route-level harness for Spec A / #363.
 * Calls the same POST handler factories wired by
 * `/api/core/p1/commands` and `/api/core/p1/query`, with injectable
 * session getter, admin-config authorizer (default real), and Core upstream.
 */

const merchantSession: AuthSession = {
  session: { createdAt: new Date() },
  user: {
    emailVerified: true,
    id: 'merchant-owner-1',
    role: 'user',
  },
};

const adminSession: AuthSession = {
  session: { createdAt: new Date() },
  user: {
    emailVerified: true,
    id: 'platform-admin-1',
    role: 'admin',
  },
};

function jsonRequest(
  path: '/api/core/p1/commands' | '/api/core/p1/query',
  body: unknown
) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function trackingUpstream(): {
  calls: Array<{ resource: string; body: string | undefined }>;
  forward: P1ModuleProxyForwardUpstream;
} {
  const calls: Array<{ resource: string; body: string | undefined }> = [];
  return {
    calls,
    forward: async ({ body, resource }) => {
      calls.push({ resource, body });
      return Response.json(
        { ok: true, echoedAction: JSON.parse(body ?? '{}').action },
        { status: 200 }
      );
    },
  };
}

function coreFailureUpstream(input: {
  code: string;
  message: string;
  status: number;
}): {
  calls: Array<{ resource: string; body: string | undefined }>;
  forward: P1ModuleProxyForwardUpstream;
} {
  const calls: Array<{ resource: string; body: string | undefined }> = [];
  return {
    calls,
    forward: async ({ body, resource }) => {
      calls.push({ resource, body });
      return Response.json(
        {
          error: { code: input.code, message: input.message },
          meta: { correlationId: 'corr-1' },
        },
        { status: input.status }
      );
    },
  };
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

test('route modules bind the real injectable POST handlers', async () => {
  const commands = await import('./commands');
  const query = await import('./query');
  assert.equal(typeof commands.p1CommandsHandlers.POST, 'function');
  assert.equal(typeof query.p1QueryHandlers.POST, 'function');
});

test('merchant config_get/list/history on query route → BFF 403 and no upstream', async () => {
  for (const action of [
    'config_get',
    'config_list',
    'config_history',
  ] as const) {
    const upstream = trackingUpstream();
    const observations: AdminConfigProxyDeniedObservation[] = [];
    const handlers = createP1QueryHandlers({
      getSession: async () => merchantSession,
      forwardUpstream: upstream.forward,
      observeDenied: (event) => {
        observations.push(event);
      },
    });

    const response = await handlers.POST({
      request: jsonRequest('/api/core/p1/query', {
        module: 'admin-config',
        action,
        payload: { key: 'plan.credits.growth' },
      }),
    });

    assert.equal(response.status, 403, action);
    const body = await readJson(response);
    assert.deepEqual(body, {
      error: {
        code: 'ADMIN_CONFIG_FORBIDDEN',
        message: 'Admin configuration access denied.',
        action,
        module: 'admin-config',
        reason: 'admin_required',
      },
    });
    assert.equal(upstream.calls.length, 0, `${action} must not call upstream`);
    assert.equal(observations.length, 1);
    assert.deepEqual(observations[0], {
      event: 'admin_config_proxy_denied',
      module: 'admin-config',
      action,
      resource: 'p1/query',
      userId: 'merchant-owner-1',
      role: 'user',
      reason: 'admin_required',
    });
  }
});

test('admin config_get/list/history on query route → forwarded to Core upstream', async () => {
  for (const action of [
    'config_get',
    'config_list',
    'config_history',
  ] as const) {
    const upstream = trackingUpstream();
    const handlers = createP1QueryHandlers({
      getSession: async () => adminSession,
      forwardUpstream: upstream.forward,
    });

    const response = await handlers.POST({
      request: jsonRequest('/api/core/p1/query', {
        module: 'admin-config',
        action,
        payload: { key: 'plan.credits.growth' },
      }),
    });

    assert.equal(response.status, 200, action);
    assert.equal(upstream.calls.length, 1, action);
    assert.equal(upstream.calls[0]?.resource, 'p1/query');
    assert.equal(JSON.parse(upstream.calls[0]?.body ?? '{}').action, action);
  }
});

test('merchant config_defaults on query route → forwarded to Core upstream', async () => {
  const upstream = trackingUpstream();
  const handlers = createP1QueryHandlers({
    getSession: async () => merchantSession,
    forwardUpstream: upstream.forward,
  });

  const response = await handlers.POST({
    request: jsonRequest('/api/core/p1/query', {
      module: 'admin-config',
      action: 'config_defaults',
      payload: {},
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(upstream.calls.length, 1);
  assert.equal(
    JSON.parse(upstream.calls[0]?.body ?? '{}').action,
    'config_defaults'
  );
});

test('merchant config_apply/rollback on commands route → BFF 403 and no upstream', async () => {
  // Sensitive admin-config writes still hit the existing step-up admin session
  // gate before the admin-config action authorizer; either way upstream must
  // not run and the client still receives 403.
  for (const action of ['config_apply', 'config_rollback'] as const) {
    const upstream = trackingUpstream();
    const handlers = createP1CommandsHandlers({
      getSession: async () => merchantSession,
      forwardUpstream: upstream.forward,
    });

    const response = await handlers.POST({
      request: jsonRequest('/api/core/p1/commands', {
        module: 'admin-config',
        action,
        payload: {
          key: 'plan.credits.growth',
          value: {},
          expectedRevision: null,
          reason: 'merchant should not apply platform config',
        },
      }),
    });

    assert.equal(response.status, 403, action);
    assert.equal(upstream.calls.length, 0, action);
  }
});

test('admin config_apply on commands route → forwarded to Core upstream', async () => {
  const upstream = trackingUpstream();
  const handlers = createP1CommandsHandlers({
    getSession: async () => adminSession,
    forwardUpstream: upstream.forward,
  });

  const response = await handlers.POST({
    request: jsonRequest('/api/core/p1/commands', {
      module: 'admin-config',
      action: 'config_apply',
      payload: {
        key: 'plan.credits.growth',
        value: {},
        expectedRevision: null,
        reason: 'platform operator update for test',
      },
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(upstream.calls.length, 1);
  assert.equal(upstream.calls[0]?.resource, 'p1/commands');
});

test('unknown admin-config action is denied on both routes with structured observation', async () => {
  for (const [resource, createHandlers] of [
    ['p1/query', createP1QueryHandlers] as const,
    ['p1/commands', createP1CommandsHandlers] as const,
  ]) {
    const path =
      resource === 'p1/query' ? '/api/core/p1/query' : '/api/core/p1/commands';
    const upstream = trackingUpstream();
    const observations: AdminConfigProxyDeniedObservation[] = [];
    const handlers = createHandlers({
      getSession: async () => adminSession,
      forwardUpstream: upstream.forward,
      observeDenied: (event) => {
        observations.push(event);
      },
    });

    const response = await handlers.POST({
      request: jsonRequest(path, {
        module: 'admin-config',
        action: 'config_secret_exfiltrate',
        payload: {},
      }),
    });

    assert.equal(response.status, 403, resource);
    const body = await readJson(response);
    assert.equal(
      (body.error as { code: string }).code,
      'ADMIN_CONFIG_FORBIDDEN'
    );
    assert.equal((body.error as { reason: string }).reason, 'unknown_action');
    assert.equal(upstream.calls.length, 0, resource);
    assert.deepEqual(observations[0], {
      event: 'admin_config_proxy_denied',
      module: 'admin-config',
      action: 'config_secret_exfiltrate',
      resource,
      userId: 'platform-admin-1',
      role: 'admin',
      reason: 'unknown_action',
    });
  }
});

test('non-admin-config module actions still forward for merchants', async () => {
  const upstream = trackingUpstream();
  const handlers = createP1QueryHandlers({
    getSession: async () => merchantSession,
    forwardUpstream: upstream.forward,
  });

  const response = await handlers.POST({
    request: jsonRequest('/api/core/p1/query', {
      module: 'creation-experience',
      action: 'recipe_preview',
      payload: {},
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(upstream.calls.length, 1);
});

/**
 * V31-68. Core's job-runtime allowlist is untouched; what the browser receives
 * for that one denial changes, because the admin shell polls this read on every
 * admin page and each 403 lands in the console as an error.
 */
test('Core allowlist denial for job-runtime observability is degraded to a readable 200', async () => {
  const upstream = coreFailureUpstream({
    code: 'FORBIDDEN',
    message:
      'Job runtime operations require an allowlisted worker or admin actor.',
    status: 403,
  });
  const handlers = createP1QueryHandlers({
    getSession: async () => adminSession,
    forwardUpstream: upstream.forward,
  });

  const response = await handlers.POST({
    request: jsonRequest('/api/core/p1/query', {
      module: 'job-runtime',
      action: 'observability',
      payload: {},
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await readJson(response), {
    data: {
      observability: 'unauthorized',
      reason: 'job_runtime_observability_actor_not_allowlisted',
    },
    meta: { correlationId: 'corr-1' },
  });
  // The read still went to Core: the allowlist decides, not the proxy.
  assert.equal(upstream.calls.length, 1);
});

test('a granted job-runtime observability read is forwarded untouched', async () => {
  const upstream = trackingUpstream();
  const handlers = createP1QueryHandlers({
    getSession: async () => adminSession,
    forwardUpstream: upstream.forward,
  });

  const response = await handlers.POST({
    request: jsonRequest('/api/core/p1/query', {
      module: 'job-runtime',
      action: 'observability',
      payload: {},
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await readJson(response), {
    ok: true,
    echoedAction: 'observability',
  });
});

test('every other 403 keeps its status and body — only this one read is degraded', async () => {
  const cases = [
    {
      name: 'another module',
      resource: 'p1/query' as const,
      request: {
        module: 'model-supply',
        action: 'admin_supply_control',
        payload: {},
      },
      code: 'FORBIDDEN',
    },
    {
      name: 'another job-runtime read',
      resource: 'p1/query' as const,
      request: { module: 'job-runtime', action: 'metrics', payload: {} },
      code: 'FORBIDDEN',
    },
    {
      name: 'the write route',
      resource: 'p1/commands' as const,
      request: { module: 'job-runtime', action: 'observability', payload: {} },
      code: 'FORBIDDEN',
    },
    {
      name: 'a denial that is not the allowlist gate',
      resource: 'p1/query' as const,
      request: {
        module: 'job-runtime',
        action: 'observability',
        payload: {},
      },
      code: 'INSUFFICIENT_ENTITLEMENT',
    },
  ];

  for (const scenario of cases) {
    const upstream = coreFailureUpstream({
      code: scenario.code,
      message: 'Denied.',
      status: 403,
    });
    const handlers =
      scenario.resource === 'p1/query'
        ? createP1QueryHandlers({
            getSession: async () => adminSession,
            forwardUpstream: upstream.forward,
          })
        : createP1CommandsHandlers({
            getSession: async () => adminSession,
            forwardUpstream: upstream.forward,
          });
    const path =
      scenario.resource === 'p1/query'
        ? '/api/core/p1/query'
        : '/api/core/p1/commands';

    const response = await handlers.POST({
      request: jsonRequest(path, scenario.request),
    });

    assert.equal(response.status, 403, scenario.name);
    assert.deepEqual(
      await readJson(response),
      {
        error: { code: scenario.code, message: 'Denied.' },
        meta: { correlationId: 'corr-1' },
      },
      scenario.name
    );
  }
});

test('unverified session is rejected before the admin-config gate or upstream', async () => {
  const upstream = trackingUpstream();
  const handlers = createP1QueryHandlers({
    getSession: async () => ({
      session: { createdAt: new Date() },
      user: {
        emailVerified: false,
        id: 'unverified-1',
        role: 'user',
      },
    }),
    forwardUpstream: upstream.forward,
  });

  const response = await handlers.POST({
    request: jsonRequest('/api/core/p1/query', {
      module: 'admin-config',
      action: 'config_defaults',
      payload: {},
    }),
  });

  assert.equal(response.status, 401);
  assert.equal(upstream.calls.length, 0);
});
