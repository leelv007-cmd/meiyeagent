import { p1ModuleRequestSchema, type P1ModuleRequest } from '@meiye/contracts';
import { ADMIN_ROLE, type AuthSession } from '@/auth/recent-admin-session';

/** Admin-config actions that any verified workspace actor may proxy. */
const ADMIN_CONFIG_WORKSPACE_ACTIONS = new Set<string>(['config_defaults']);

/**
 * Admin-config actions that require platform role === admin on the BFF.
 * Includes product admin-only reads/writes under config.publish and
 * system.capability.view. Unknown actions fall through to default deny.
 */
const ADMIN_CONFIG_ADMIN_ACTIONS = new Set<string>([
  'config_get',
  'config_list',
  'config_history',
  'config_apply',
  'config_rollback',
  'cloudflare_inventory',
]);

export type AdminConfigProxyDeniedReason = 'admin_required' | 'unknown_action';

export type AdminConfigProxyDeniedObservation = {
  event: 'admin_config_proxy_denied';
  module: 'admin-config';
  action: string;
  resource: 'p1/commands' | 'p1/query';
  userId: string;
  role: string | null;
  reason: AdminConfigProxyDeniedReason;
};

export type AdminConfigProxyAuthorizationResult =
  | { ok: true }
  | {
      ok: false;
      response: Response;
      observation: AdminConfigProxyDeniedObservation;
    };

export type AuthorizeAdminConfigProxyRequestInput = {
  body: string | undefined;
  resource: 'p1/commands' | 'p1/query';
  session: AuthSession;
};

export function adminConfigProxyForbiddenResponse(input: {
  action: string;
  reason: AdminConfigProxyDeniedReason;
}) {
  return Response.json(
    {
      error: {
        code: 'ADMIN_CONFIG_FORBIDDEN',
        message: 'Admin configuration access denied.',
        action: input.action,
        module: 'admin-config',
        reason: input.reason,
      },
    },
    { status: 403 }
  );
}

export function observeAdminConfigProxyDenied(
  observation: AdminConfigProxyDeniedObservation
) {
  console.warn('[admin-config-proxy]', observation);
}

/**
 * BFF admin-config action gate (Spec A / #363).
 *
 * Matrix:
 * - non-admin-config or unparseable envelope → allow (Core remains authoritative)
 * - config_defaults → allow verified workspace actor (caller already checked login+email)
 * - config_get/list/history/apply/rollback (+ known admin reads) → platform admin only
 * - unknown admin-config action → default deny
 */
export function authorizeAdminConfigProxyRequest(
  input: AuthorizeAdminConfigProxyRequestInput
): AdminConfigProxyAuthorizationResult {
  const parsed = parseAdminConfigModuleRequest(input.body);
  if (!parsed) return { ok: true };

  const { action } = parsed;
  if (ADMIN_CONFIG_WORKSPACE_ACTIONS.has(action)) {
    return { ok: true };
  }

  const role = input.session.user.role ?? null;
  if (ADMIN_CONFIG_ADMIN_ACTIONS.has(action)) {
    if (role === ADMIN_ROLE) return { ok: true };
    return denied({
      action,
      reason: 'admin_required',
      resource: input.resource,
      session: input.session,
    });
  }

  return denied({
    action,
    reason: 'unknown_action',
    resource: input.resource,
    session: input.session,
  });
}

function parseAdminConfigModuleRequest(
  body: string | undefined
): P1ModuleRequest | null {
  if (!body) return null;
  try {
    const parsed = p1ModuleRequestSchema.safeParse(JSON.parse(body));
    if (!parsed.success || parsed.data.module !== 'admin-config') {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function denied(input: {
  action: string;
  reason: AdminConfigProxyDeniedReason;
  resource: 'p1/commands' | 'p1/query';
  session: AuthSession;
}): Extract<AdminConfigProxyAuthorizationResult, { ok: false }> {
  const observation: AdminConfigProxyDeniedObservation = {
    event: 'admin_config_proxy_denied',
    module: 'admin-config',
    action: input.action,
    resource: input.resource,
    userId: input.session.user.id,
    role: input.session.user.role ?? null,
    reason: input.reason,
  };
  return {
    ok: false,
    observation,
    response: adminConfigProxyForbiddenResponse({
      action: input.action,
      reason: input.reason,
    }),
  };
}
