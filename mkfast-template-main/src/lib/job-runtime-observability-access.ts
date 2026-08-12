import { apiFailureSchema, p1ModuleRequestSchema } from '@meiye/contracts';

/**
 * Job-runtime observability access (V31-68).
 *
 * Core keeps `job-runtime/observability` behind an env-configured actor
 * allowlist (`P1_ADMIN_ACTOR_IDS`), which the platform admin *role* does not
 * imply — two different identities on purpose, and that gate is not relaxed
 * here. What changes is the answer an unlisted admin gets: the admin shell
 * header polls this read on every admin page, so a 403 put two console errors
 * on every single one of them and no admin page could ever hold a zero-error
 * journey contract.
 *
 * So the proxy translates exactly this one denial into a readable "not open to
 * you" payload the widgets render as a degraded state. Any other 403 — another
 * module, another action, a write — is replayed to the caller untouched.
 */

const OBSERVABILITY_MODULE = 'job-runtime';
const OBSERVABILITY_ACTION = 'observability';
const UNAUTHORIZED_REASON = 'job_runtime_observability_actor_not_allowlisted';

export type JobRuntimeObservabilityUnauthorized = {
  observability: 'unauthorized';
  reason: typeof UNAUTHORIZED_REASON;
};

type P1ProxyResource = 'p1/commands' | 'p1/query';

export function jobRuntimeObservabilityUnauthorized(): JobRuntimeObservabilityUnauthorized {
  return { observability: 'unauthorized', reason: UNAUTHORIZED_REASON };
}

/**
 * Discriminated on its own key rather than on a missing `capturedAt`: an empty
 * or malformed snapshot is a different failure with a different message, and
 * the two must not collapse into one card.
 */
export function isJobRuntimeObservabilityUnauthorized(
  value: unknown
): value is JobRuntimeObservabilityUnauthorized {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { observability?: unknown }).observability === 'unauthorized'
  );
}

/** Exact match only — one resource, one module, one read action. */
function isJobRuntimeObservabilityQuery(input: {
  body: string | undefined;
  resource: P1ProxyResource;
}) {
  if (input.resource !== 'p1/query' || !input.body) return false;
  let json: unknown;
  try {
    json = JSON.parse(input.body);
  } catch {
    return false;
  }
  const parsed = p1ModuleRequestSchema.safeParse(json);
  return (
    parsed.success &&
    parsed.data.module === OBSERVABILITY_MODULE &&
    parsed.data.action === OBSERVABILITY_ACTION
  );
}

/**
 * Translate Core's allowlist denial for the observability read into a 200
 * degraded payload; return the upstream response otherwise.
 *
 * The body is read only once the resource/module/action already matched, and
 * a non-matching envelope is replayed verbatim so a 403 this function does not
 * own leaves the route exactly as it found it.
 */
export async function degradeJobRuntimeObservabilityForbidden(input: {
  body: string | undefined;
  resource: P1ProxyResource;
  upstream: Response;
}): Promise<Response> {
  const { upstream } = input;
  if (upstream.status !== 403) return upstream;
  if (!isJobRuntimeObservabilityQuery(input)) return upstream;

  const text = await upstream.text();
  const failure = parseApiFailure(text);
  if (failure?.error.code !== 'FORBIDDEN') {
    return new Response(text, {
      status: upstream.status,
      headers: upstream.headers,
    });
  }

  const headers = new Headers(upstream.headers);
  headers.set('content-type', 'application/json');
  return new Response(
    JSON.stringify({
      data: jobRuntimeObservabilityUnauthorized(),
      meta: failure.meta,
    }),
    { status: 200, headers }
  );
}

function parseApiFailure(text: string) {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = apiFailureSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
