import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  RECENT_AUTHENTICATION_WINDOW_MS,
  RecentAuthenticationRequiredError,
  recentAuthenticationRequiredResponse,
  requireRecentAuthentication,
  requiresRecentAuthenticationForP1Command,
  requiresRecentAuthenticationForP1RequestBody,
  requiresRecentAuthentication,
} from './recent-authentication';
import { createRecentAuthenticationHook } from './recent-authentication-hook';

describe('route-level recent authentication', () => {
  it('accepts a login inside the 15 minute window and rejects its boundary', () => {
    const now = new Date('2026-07-22T10:15:00.000Z');

    assert.doesNotThrow(() =>
      requireRecentAuthentication(
        { createdAt: new Date('2026-07-22T10:00:00.001Z') },
        now
      )
    );
    assert.throws(
      () =>
        requireRecentAuthentication(
          {
            createdAt: new Date(
              now.getTime() - RECENT_AUTHENTICATION_WINDOW_MS
            ),
          },
          now
        ),
      RecentAuthenticationRequiredError
    );
  });

  it('does not treat a refreshed session timestamp as a new authentication', () => {
    assert.throws(
      () =>
        requireRecentAuthentication(
          {
            createdAt: new Date('2026-07-22T09:00:00.000Z'),
            updatedAt: new Date('2026-07-22T10:14:59.000Z'),
          },
          new Date('2026-07-22T10:15:00.000Z')
        ),
      RecentAuthenticationRequiredError
    );
  });

  it('guards API key writes, account deletion and critical admin writes only', () => {
    for (const path of [
      '/api-key/create',
      '/api-key/update',
      '/api-key/delete',
      '/delete-user',
      '/admin/set-role',
      '/admin/create-user',
      '/admin/update-user',
      '/admin/ban-user',
      '/admin/unban-user',
      '/admin/impersonate-user',
      '/admin/revoke-user-session',
      '/admin/revoke-user-sessions',
      '/admin/remove-user',
      '/admin/set-user-password',
    ]) {
      assert.equal(requiresRecentAuthentication(path), true, path);
    }

    for (const path of [
      '/get-session',
      '/api-key/list',
      '/admin/list-users',
      '/admin/stop-impersonating',
    ]) {
      assert.equal(requiresRecentAuthentication(path), false, path);
    }
  });

  it('guards high-impact governance commands and publication actions', () => {
    for (const [module, action] of [
      ['integrations', 'admin_store_provider_credential'],
      ['admin-config', 'config_apply'],
      ['admin-config', 'config_rollback'],
      ['creation-experience', 'recipe_publish'],
      ['creation-experience', 'recipe_rollback'],
      ['creation-experience', 'surface_publish'],
      ['creation-experience', 'surface_rollback'],
      ['operations', 'admin_publish_template_version'],
      ['operations', 'admin_enable_template_version'],
      ['operations', 'admin_retire_template'],
      ['model-supply', 'catalog_enable'],
      ['model-supply', 'catalog_publish'],
      ['model-supply', 'catalog_retire'],
      ['model-supply', 'catalog_rollback'],
      ['model-supply', 'prompt_revision_rollback'],
      ['redemptions', 'create'],
      ['model-supply', 'isolate_deployment'],
      ['operations', 'force_fail_task'],
      ['model-supply', 'admin_supply_action'],
      ['integrations', 'publish_feishu_tool'],
      ['job-runtime', 'schedule_recurring'],
    ] as const) {
      assert.equal(
        requiresRecentAuthenticationForP1Command(module, action),
        true,
        `${module}.${action}`
      );
      assert.equal(
        requiresRecentAuthenticationForP1RequestBody(
          JSON.stringify({ action, module, payload: {} })
        ),
        true,
        `${module}.${action} request body`
      );
    }

    for (const [module, action] of [
      ['creation-experience', 'recipe_draft'],
      ['creation-experience', 'recipe_get'],
      ['creation-experience', 'recipe_history'],
      ['creation-experience', 'recipe_preview'],
      ['creation-experience', 'recipe_validate'],
      ['creation-experience', 'surface_draft'],
      ['creation-experience', 'surface_get'],
      ['creation-experience', 'surface_history'],
      ['creation-experience', 'surface_preview'],
      ['creation-experience', 'surface_validate'],
      ['model-supply', 'catalog_create_draft'],
      ['model-supply', 'catalog_create_safe_draft'],
      ['operations', 'admin_create_template'],
      ['operations', 'admin_create_template_version'],
      ['admin-config', 'config_get'],
      ['admin-config', 'config_history'],
      ['admin-config', 'config_list'],
    ] as const) {
      assert.equal(
        requiresRecentAuthenticationForP1Command(module, action),
        false,
        `${module}.${action} remains an iterative or read action`
      );
    }

    for (const [module, action] of [
      ['integrations', 'create_connection'],
      ['admin-config', 'config_defaults'],
      ['redemptions', 'redeem'],
    ] as const) {
      assert.equal(
        requiresRecentAuthenticationForP1Command(module, action),
        false,
        `${module}.${action}`
      );
    }
    assert.equal(requiresRecentAuthenticationForP1RequestBody('{'), false);
  });

  it('returns a stable 403 contract that clients can route to reauthentication', async () => {
    const response = recentAuthenticationRequiredResponse();

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: 'Recent authentication is required.',
      code: 'RECENT_AUTHENTICATION_REQUIRED',
    });
  });

  it('runs stale high-risk requests through the Better Auth before hook', async () => {
    const observed: Array<{
      path: string;
      options: { disableCookieCache?: boolean } | undefined;
    }> = [];
    const hook = createRecentAuthenticationHook(async (context, options) => {
      observed.push({ path: context.path, options });
      return {
        session: {
          createdAt: new Date(Date.now() - RECENT_AUTHENTICATION_WINDOW_MS),
        },
        user: {},
      } as never;
    });

    for (const path of [
      '/api-key/create',
      '/delete-user',
      '/admin/set-role',
      '/admin/ban-user',
      '/admin/revoke-user-session',
    ]) {
      await assert.rejects(hook({ path } as never), (error: unknown) => {
        assert.equal((error as { statusCode?: number }).statusCode, 403);
        assert.equal(
          (error as { body?: { code?: string } }).body?.code,
          'RECENT_AUTHENTICATION_REQUIRED'
        );
        return true;
      });
    }

    assert.deepEqual(observed, [
      {
        path: '/api-key/create',
        options: { disableCookieCache: true },
      },
      {
        path: '/delete-user',
        options: { disableCookieCache: true },
      },
      {
        path: '/admin/set-role',
        options: { disableCookieCache: true },
      },
      {
        path: '/admin/ban-user',
        options: { disableCookieCache: true },
      },
      {
        path: '/admin/revoke-user-session',
        options: { disableCookieCache: true },
      },
    ]);
  });

  it('attributes admin-created users to the authenticated actor', async () => {
    const hook = createRecentAuthenticationHook(async () => {
      return {
        session: {
          createdAt: new Date(),
        },
        user: {
          id: 'admin-user',
        },
      } as never;
    });
    const context = {
      path: '/admin/create-user',
      body: {
        data: {
          provisionedByUserId: 'forged-user',
        },
      },
    };

    await hook(context as never);

    assert.deepEqual(context.body.data, {
      emailVerified: true,
      provisionedByUserId: 'admin-user',
    });
  });

  it('strips forged attribution from admin user update routes', async () => {
    const hook = createRecentAuthenticationHook(async () => {
      return {
        session: {
          createdAt: new Date(),
        },
        user: {
          id: 'admin-user',
        },
      } as never;
    });
    const context = {
      path: '/admin/update-user',
      body: {
        data: {
          name: 'Merchant',
          provisionedByUserId: 'forged-user',
        },
      },
    };

    await hook(context as never);

    assert.deepEqual(context.body.data, {
      name: 'Merchant',
    });
  });
});
