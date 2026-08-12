import {
  p1ModuleRequestSchema,
  requiredP1Capability,
  type P1ModuleRequest,
} from '@meiye/contracts';
import { ADMIN_ROLE, type AuthSession } from '@/auth/recent-admin-session';

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
  // The frozen capability table is the single authority (previously two
  // hand-maintained Sets beside it — a new Core action was silently 403'd
  // until someone remembered the second list). workspace.read passes any
  // verified workspace actor; every admin-scoped capability requires the
  // platform admin role on the BFF; no capability = default deny.
  const capability = requiredP1Capability(
    input.resource === 'p1/query' ? 'query' : 'command',
    'admin-config',
    action
  );
  if (capability === 'workspace.read') {
    return { ok: true };
  }

  const role = input.session.user.role ?? null;
  if (capability !== null) {
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
