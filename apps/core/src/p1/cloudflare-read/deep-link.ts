/**
 * Cloudflare deep-link / handoff envelope builder (D-052).
 *
 * Server builds short-lived handoff envelopes with redacted time range,
 * script-deployment, correlation, and capability context. Account / zone /
 * script names resolve server-side — never trust browser-supplied CF ids.
 */

import {
  CLOUDFLARE_DEEP_LINK_RESOURCE_KINDS,
  type CloudflareDeepLinkEnvelope,
  type CloudflareDeepLinkResolution,
  type CloudflareDeepLinkResourceKind,
  type CloudflareResourceMapping,
} from './types.js';

export const CLOUDFLARE_HANDOFF_TTL_MS = 10 * 60 * 1000;

const SENSITIVE_CONTEXT_KEYS = [
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
] as const;

export class CloudflareDeepLinkError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'resource_kind_not_allowed'
      | 'resource_ref_required'
      | 'mapping_not_verified'
      | 'sensitive_context_rejected'
      | 'time_range_invalid',
  ) {
    super(message);
    this.name = 'CloudflareDeepLinkError';
  }
}

export function isAllowedDeepLinkResourceKind(
  kind: string,
): kind is CloudflareDeepLinkResourceKind {
  return (CLOUDFLARE_DEEP_LINK_RESOURCE_KINDS as readonly string[]).includes(
    kind,
  );
}

/** Reject envelopes that smuggle sensitive keys into redacted context. */
export function assertNoSensitiveDeepLinkFields(
  input: Record<string, unknown>,
): void {
  for (const key of SENSITIVE_CONTEXT_KEYS) {
    if (key in input && input[key] != null && input[key] !== '') {
      throw new CloudflareDeepLinkError(
        `Sensitive field "${key}" is not allowed in deep-link envelope`,
        'sensitive_context_rejected',
      );
    }
  }
}

function assertValidTimeRange(from?: string, to?: string): void {
  if (from && Number.isNaN(Date.parse(from))) {
    throw new CloudflareDeepLinkError(
      'Invalid from timestamp',
      'time_range_invalid',
    );
  }
  if (to && Number.isNaN(Date.parse(to))) {
    throw new CloudflareDeepLinkError(
      'Invalid to timestamp',
      'time_range_invalid',
    );
  }
  if (from && to && Date.parse(from) > Date.parse(to)) {
    throw new CloudflareDeepLinkError(
      'from must be <= to',
      'time_range_invalid',
    );
  }
}

export interface BuildDeepLinkEnvelopeInput {
  resourceKind: string;
  resourceRef: string;
  from?: string;
  to?: string;
  signal?: string;
  incidentRef?: string;
  snapshotAt?: string;
  capabilityContext?: CloudflareDeepLinkEnvelope['capabilityContext'];
  scriptDeployment?: CloudflareDeepLinkEnvelope['scriptDeployment'];
  correlation?: CloudflareDeepLinkEnvelope['correlation'];
  returnTo?: string;
  /** Extra keys — only non-sensitive string values accepted. */
  extra?: Record<string, unknown>;
}

/**
 * Build a redacted deep-link envelope (no Dashboard URL yet).
 * Call resolveDeepLink with a verified mapping to produce the official URL.
 */
export function buildCloudflareDeepLinkEnvelope(
  input: BuildDeepLinkEnvelopeInput,
): CloudflareDeepLinkEnvelope {
  if (!isAllowedDeepLinkResourceKind(input.resourceKind)) {
    throw new CloudflareDeepLinkError(
      `resourceKind "${input.resourceKind}" is not on the allowlist`,
      'resource_kind_not_allowed',
    );
  }
  if (!input.resourceRef?.trim()) {
    throw new CloudflareDeepLinkError(
      'resourceRef is required (internal mapped ref)',
      'resource_ref_required',
    );
  }
  assertValidTimeRange(input.from, input.to);
  if (input.extra) {
    assertNoSensitiveDeepLinkFields(input.extra);
  }
  assertNoSensitiveDeepLinkFields({
    ...input.capabilityContext,
    ...input.scriptDeployment,
    ...input.correlation,
  });

  return {
    provider: 'cloudflare',
    resourceKind: input.resourceKind,
    resourceRef: input.resourceRef.trim(),
    ...(input.from ? { from: input.from } : {}),
    ...(input.to ? { to: input.to } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.incidentRef ? { incidentRef: input.incidentRef } : {}),
    snapshotAt: input.snapshotAt ?? new Date().toISOString(),
    ...(input.capabilityContext
      ? { capabilityContext: { ...input.capabilityContext } }
      : {}),
    ...(input.scriptDeployment
      ? { scriptDeployment: { ...input.scriptDeployment } }
      : {}),
    ...(input.correlation ? { correlation: { ...input.correlation } } : {}),
    ...(input.returnTo ? { returnTo: input.returnTo } : {}),
  };
}

/**
 * Resolve envelope + verified mapping into an official Dashboard URL.
 * URL templates are server-owned so Dashboard path changes stay in one place.
 */
export function resolveCloudflareDeepLink(
  envelope: CloudflareDeepLinkEnvelope,
  mapping: CloudflareResourceMapping,
  options: { now?: Date; baseUrl?: string } = {},
): CloudflareDeepLinkResolution {
  if (!mapping.verified) {
    throw new CloudflareDeepLinkError(
      'Production mapping is not verified; cannot build Dashboard deep-link',
      'mapping_not_verified',
    );
  }
  if (envelope.resourceRef !== mapping.internalRef) {
    throw new CloudflareDeepLinkError(
      'resourceRef does not match verified mapping internalRef',
      'resource_ref_required',
    );
  }

  const base = (options.baseUrl ?? 'https://dash.cloudflare.com').replace(
    /\/+$/,
    '',
  );
  const account = mapping.accountId ?? 'account';
  const script = mapping.scriptName ?? 'worker';
  const zone = mapping.zoneId;

  const path = dashboardPathFor(envelope.resourceKind, {
    account,
    script,
    zone,
    bucket: mapping.r2BucketName,
    hyperdrive: mapping.hyperdriveConfigId,
  });

  const url = new URL(`${base}${path}`);
  // Time range as non-sensitive query context only when present.
  if (envelope.from) url.searchParams.set('from', envelope.from);
  if (envelope.to) url.searchParams.set('to', envelope.to);
  if (envelope.signal) url.searchParams.set('signal', envelope.signal);

  return {
    envelope,
    dashboardUrl: url.toString(),
    ttlMs: CLOUDFLARE_HANDOFF_TTL_MS,
    singleUse: true,
  };
}

function dashboardPathFor(
  kind: CloudflareDeepLinkResourceKind,
  refs: {
    account: string;
    script: string;
    zone?: string;
    bucket?: string;
    hyperdrive?: string;
  },
): string {
  switch (kind) {
    case 'worker_observability':
    case 'worker_logs':
    case 'worker_traces':
      return `/${refs.account}/workers/services/view/${refs.script}/production/observability`;
    case 'worker_deployments':
    case 'worker_versions':
      return `/${refs.account}/workers/services/view/${refs.script}/production/deployments`;
    case 'r2_bucket':
      return refs.bucket
        ? `/${refs.account}/r2/default/buckets/${refs.bucket}`
        : `/${refs.account}/r2/overview`;
    case 'hyperdrive':
      return refs.hyperdrive
        ? `/${refs.account}/workers/hyperdrive/${refs.hyperdrive}`
        : `/${refs.account}/workers/hyperdrive`;
    case 'zone_dns':
      return refs.zone
        ? `/${refs.account}/${refs.zone}/dns/records`
        : `/${refs.account}/domains`;
    case 'security_events':
      return refs.zone
        ? `/${refs.account}/${refs.zone}/security/events`
        : `/${refs.account}/security/overview`;
    case 'billing':
      return `/${refs.account}/billing`;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
