export const TELEMETRY_SCHEMA_VERSION = 'uiux-telemetry-v1';

const fieldAllowlist = {
  api_request: ['durationMs', 'endpoint', 'method', 'status'],
  chunk_error: ['errorCode', 'route'],
  model_selection: ['availability', 'modelId', 'operation'],
  page_error: ['errorCode', 'route'],
  permission_denied: ['capability', 'surface'],
  publish_route: ['outcome', 'route'],
  query_error: ['action', 'errorCode', 'module'],
  quote_state: ['operation', 'state'],
  recovery_action: ['action', 'objectKind', 'outcome'],
  redirect: ['fromRoute', 'reason', 'toRoute'],
  route_loaded: ['durationMs', 'route'],
  tool_action: ['action', 'tool'],
  version_observed: [],
} as const;

export type TelemetryEventName = keyof typeof fieldAllowlist;
type TelemetryValue = boolean | number | string;
type TelemetryFields = Record<string, TelemetryValue>;

interface TelemetryVersions {
  releaseVersion: string;
  schemaRevision: string;
}

type TelemetryWindow = Window & {
  gtag?: (...args: unknown[]) => void;
  plausible?: (
    event: string,
    options: { props: Record<string, TelemetryValue> }
  ) => void;
  umami?: {
    track: (event: string, data: Record<string, TelemetryValue>) => void;
  };
};

const runtimeEnv = (
  import.meta as ImportMeta & {
    env?: Record<string, string | boolean | undefined>;
  }
).env;

const runtimeVersions: TelemetryVersions = {
  releaseVersion: String(runtimeEnv?.VITE_RELEASE_VERSION ?? 'local'),
  schemaRevision: String(runtimeEnv?.VITE_SCHEMA_REVISION ?? 'uiux-p1-v1'),
};

const routeFields = new Set(['endpoint', 'fromRoute', 'route', 'toRoute']);

export function normalizeTelemetryPath(value: string) {
  const pathname = value.split(/[?#]/, 1)[0] || '/';
  return pathname
    .replace(
      /^\/dashboard\/(tasks|assets|content|sessions|works|jobs|leads)\/[^/]+/,
      '/dashboard/$1/:id'
    )
    .replace(/^\/dashboard\/handoff\/[^/]+/, '/dashboard/handoff/:token');
}

export function buildTelemetryEvent(
  event: TelemetryEventName,
  fields: TelemetryFields,
  versions: TelemetryVersions = runtimeVersions
) {
  const payload: TelemetryFields & {
    event: TelemetryEventName;
    releaseVersion: string;
    schemaRevision: string;
    schemaVersion: typeof TELEMETRY_SCHEMA_VERSION;
  } = {
    event,
    releaseVersion: versions.releaseVersion.slice(0, 80),
    schemaRevision: versions.schemaRevision.slice(0, 80),
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
  };
  for (const key of fieldAllowlist[event]) {
    const value = fields[key];
    if (
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean'
    ) {
      continue;
    }
    payload[key] =
      typeof value === 'number'
        ? Math.round(value * 10) / 10
        : typeof value === 'string'
          ? (routeFields.has(key)
              ? normalizeTelemetryPath(value)
              : value
            ).slice(0, 120)
          : value;
  }
  return payload;
}

export function emitTelemetry(
  event: TelemetryEventName,
  fields: TelemetryFields = {}
) {
  if (typeof window === 'undefined') return;
  const payload = buildTelemetryEvent(event, fields);
  window.dispatchEvent(new CustomEvent('meiye:telemetry', { detail: payload }));
  const analytics = window as TelemetryWindow;
  analytics.gtag?.('event', event, payload);
  analytics.plausible?.(event, { props: payload });
  analytics.umami?.track(event, payload);
}

export async function telemetryFetch(
  input: string,
  init?: RequestInit
): Promise<Response> {
  const startedAt = typeof performance === 'undefined' ? 0 : performance.now();
  let status = 0;
  try {
    const response = await fetch(input, init);
    status = response.status;
    return response;
  } finally {
    emitTelemetry('api_request', {
      durationMs:
        typeof performance === 'undefined' ? 0 : performance.now() - startedAt,
      endpoint: input,
      method: init?.method ?? 'GET',
      status,
    });
  }
}
