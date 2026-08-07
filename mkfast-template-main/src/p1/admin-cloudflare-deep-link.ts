import {
  admin_cloudflare_open_cloudflare_billing_48db8a97,
  admin_cloudflare_open_cloudflare_deployments_and_versions_4dd3a986,
  admin_cloudflare_open_cloudflare_dns_45dc414a,
  admin_cloudflare_open_cloudflare_hyperdrive_a5f81bda,
  admin_cloudflare_open_cloudflare_log_details_41c95baf,
  admin_cloudflare_open_cloudflare_r2_b11f3b16,
  admin_cloudflare_open_cloudflare_security_events_49701c1c,
  admin_cloudflare_open_cloudflare_trace_details_f284b979,
  admin_cloudflare_open_cloudflare_worker_observability_17701712,
} from '@/locale/paraglide/messages';
/**
 * Admin Cloudflare deep-link builder (J6 / D-052).
 *
 * Product admin never calls Cloudflare APIs. This pure builder assembles a
 * redacted handoff envelope (time range / script-deployment / correlation /
 * capability context) for server resolution into an official Dashboard URL.
 *
 * Sensitive fields (token, secret, IP, UA, prompt, user content, raw logs)
 * are rejected.
 */

export const ADMIN_CF_DEEP_LINK_RESOURCE_KINDS = [
  'worker_observability',
  'worker_deployments',
  'worker_versions',
  'worker_logs',
  'worker_traces',
  'r2_bucket',
  'hyperdrive',
  'zone_dns',
  'security_events',
  'billing',
] as const;

export type AdminCfDeepLinkResourceKind =
  (typeof ADMIN_CF_DEEP_LINK_RESOURCE_KINDS)[number];

const SENSITIVE_KEYS = new Set([
  'token',
  'apiToken',
  'api_token',
  'secret',
  'password',
  'authorization',
  'ip',
  'userAgent',
  'user_agent',
  'prompt',
  'userContent',
  'user_content',
  'rawLog',
  'raw_log',
  'path',
  'query',
  'fullUrl',
  'full_url',
]);

export class AdminCfDeepLinkError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'resource_kind_not_allowed'
      | 'resource_ref_required'
      | 'sensitive_context_rejected'
      | 'time_range_invalid'
  ) {
    super(message);
    this.name = 'AdminCfDeepLinkError';
  }
}

export interface AdminCfDeepLinkInput {
  resourceKind: string;
  /** Internal mapped ref (server resolves account/script/zone). */
  resourceRef: string;
  from?: string;
  to?: string;
  signal?: string;
  incidentRef?: string;
  snapshotAt?: string;
  capabilityId?: string;
  capabilityLabel?: string;
  scriptRef?: string;
  deploymentRef?: string;
  versionRef?: string;
  correlationId?: string;
  traceHint?: string;
  returnTo?: string;
}

export interface AdminCfDeepLinkEnvelope {
  provider: 'cloudflare';
  resourceKind: AdminCfDeepLinkResourceKind;
  resourceRef: string;
  from?: string;
  to?: string;
  signal?: string;
  incidentRef?: string;
  snapshotAt: string;
  capabilityContext?: {
    capabilityId?: string;
    capabilityLabel?: string;
  };
  scriptDeployment?: {
    scriptRef?: string;
    deploymentRef?: string;
    versionRef?: string;
  };
  correlation?: {
    correlationId?: string;
    traceHint?: string;
  };
  returnTo?: string;
  /** Always false — deep-link is handoff, not a one-click CF write. */
  mutatesCloudflare: false;
  /** Operator-facing next step. */
  operatorAction: 'open_cloudflare_dashboard';
}

export function isAdminCfDeepLinkResourceKind(
  kind: string
): kind is AdminCfDeepLinkResourceKind {
  return (ADMIN_CF_DEEP_LINK_RESOURCE_KINDS as readonly string[]).includes(
    kind
  );
}

function rejectSensitive(record: Record<string, unknown> | undefined): void {
  if (!record) return;
  for (const key of Object.keys(record)) {
    if (SENSITIVE_KEYS.has(key) && record[key] != null && record[key] !== '') {
      throw new AdminCfDeepLinkError(
        `Sensitive field "${key}" is not allowed in deep-link envelope`,
        'sensitive_context_rejected'
      );
    }
  }
}

/**
 * Build a redacted Cloudflare handoff envelope for the admin UI.
 * Server adapter resolves this into a short-lived Dashboard URL.
 */
export function buildAdminCloudflareDeepLink(
  input: AdminCfDeepLinkInput
): AdminCfDeepLinkEnvelope {
  if (!isAdminCfDeepLinkResourceKind(input.resourceKind)) {
    throw new AdminCfDeepLinkError(
      `resourceKind "${input.resourceKind}" is not allowed`,
      'resource_kind_not_allowed'
    );
  }
  if (!input.resourceRef?.trim()) {
    throw new AdminCfDeepLinkError(
      'resourceRef is required',
      'resource_ref_required'
    );
  }
  if (input.from && Number.isNaN(Date.parse(input.from))) {
    throw new AdminCfDeepLinkError('Invalid from', 'time_range_invalid');
  }
  if (input.to && Number.isNaN(Date.parse(input.to))) {
    throw new AdminCfDeepLinkError('Invalid to', 'time_range_invalid');
  }
  if (input.from && input.to && Date.parse(input.from) > Date.parse(input.to)) {
    throw new AdminCfDeepLinkError('from must be <= to', 'time_range_invalid');
  }

  rejectSensitive(input as unknown as Record<string, unknown>);

  return {
    provider: 'cloudflare',
    resourceKind: input.resourceKind,
    resourceRef: input.resourceRef.trim(),
    ...(input.from ? { from: input.from } : {}),
    ...(input.to ? { to: input.to } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.incidentRef ? { incidentRef: input.incidentRef } : {}),
    snapshotAt: input.snapshotAt ?? new Date().toISOString(),
    ...(input.capabilityId || input.capabilityLabel
      ? {
          capabilityContext: {
            ...(input.capabilityId ? { capabilityId: input.capabilityId } : {}),
            ...(input.capabilityLabel
              ? { capabilityLabel: input.capabilityLabel }
              : {}),
          },
        }
      : {}),
    ...(input.scriptRef || input.deploymentRef || input.versionRef
      ? {
          scriptDeployment: {
            ...(input.scriptRef ? { scriptRef: input.scriptRef } : {}),
            ...(input.deploymentRef
              ? { deploymentRef: input.deploymentRef }
              : {}),
            ...(input.versionRef ? { versionRef: input.versionRef } : {}),
          },
        }
      : {}),
    ...(input.correlationId || input.traceHint
      ? {
          correlation: {
            ...(input.correlationId
              ? { correlationId: input.correlationId }
              : {}),
            ...(input.traceHint ? { traceHint: input.traceHint } : {}),
          },
        }
      : {}),
    ...(input.returnTo ? { returnTo: input.returnTo } : {}),
    mutatesCloudflare: false,
    operatorAction: 'open_cloudflare_dashboard',
  };
}

/** Human label for deep-link target (operator language). */
export function adminCfDeepLinkLabel(
  kind: AdminCfDeepLinkResourceKind
): string {
  switch (kind) {
    case 'worker_observability':
      return admin_cloudflare_open_cloudflare_worker_observability_17701712();
    case 'worker_deployments':
    case 'worker_versions':
      return admin_cloudflare_open_cloudflare_deployments_and_versions_4dd3a986();
    case 'worker_logs':
      return admin_cloudflare_open_cloudflare_log_details_41c95baf();
    case 'worker_traces':
      return admin_cloudflare_open_cloudflare_trace_details_f284b979();
    case 'r2_bucket':
      return admin_cloudflare_open_cloudflare_r2_b11f3b16();
    case 'hyperdrive':
      return admin_cloudflare_open_cloudflare_hyperdrive_a5f81bda();
    case 'zone_dns':
      return admin_cloudflare_open_cloudflare_dns_45dc414a();
    case 'security_events':
      return admin_cloudflare_open_cloudflare_security_events_49701c1c();
    case 'billing':
      return admin_cloudflare_open_cloudflare_billing_48db8a97();
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
