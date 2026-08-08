/**
 * Controlled Surface Registry foundation (V3.1 §28.4 / §0.5 / §37.1, V31-04).
 *
 * Models may only request client-approved semantic surfaces. V31-04 registers
 * narrative + activity; later tickets register their own keys only.
 *
 * Forbidden on every request: className, html, component, action, dangerous URLs.
 */

export const AGENT_FOUNDATION_SURFACE_KEYS = ['narrative', 'activity'] as const;

export type AgentFoundationSurfaceKey =
  (typeof AGENT_FOUNDATION_SURFACE_KEYS)[number];

/**
 * Extensible key union. Foundation keys are closed; later tickets add via
 * registerAgentSurface (runtime) using string keys.
 */
export type AgentSurfaceKey = AgentFoundationSurfaceKey | (string & {});

export type SurfaceRejectReason =
  | 'unregistered_surface'
  | 'forbidden_className'
  | 'forbidden_html'
  | 'forbidden_component'
  | 'forbidden_action'
  | 'forbidden_url'
  | 'unknown_prop';

export type ControlledSurfaceRequest = {
  surface: string;
  props?: Record<string, unknown>;
};

export type ControlledSurfaceOk = {
  ok: true;
  surface: AgentSurfaceKey;
  props: Record<string, unknown>;
};

export type ControlledSurfaceReject = {
  ok: false;
  reason: SurfaceRejectReason;
  detail?: string;
};

export type ControlledSurfaceResult =
  | ControlledSurfaceOk
  | ControlledSurfaceReject;

export type SurfaceRegistration = {
  /** Allowlisted prop keys (beyond none). Forbidden keys always win. */
  allowedPropKeys: readonly string[];
};

const FORBIDDEN_PROP_KEYS = new Set([
  'className',
  'classname',
  'html',
  'dangerouslySetInnerHTML',
  'component',
  'Component',
  'action',
  'actions',
  'onClick',
  'onclick',
]);

const URL_PROP_KEYS = new Set([
  'href',
  'src',
  'url',
  'actionUrl',
  'link',
  'to',
]);

const DANGEROUS_URL_RE = /^(?:\s)*(?:javascript:|data:|vbscript:)/iu;

const registry = new Map<string, SurfaceRegistration>();

function bootstrapFoundation(): void {
  if (registry.size > 0) return;
  registry.set('narrative', {
    allowedPropKeys: ['text', 'id', 'occurredAt', 'streamOffset', 'deliveryKey'],
  });
  registry.set('activity', {
    allowedPropKeys: [
      'id',
      'title',
      'status',
      'detail',
      'collapsed',
      'streamOffset',
      'updatedAt',
    ],
  });
}

bootstrapFoundation();

/** Register a surface for a later ticket. Overwrites same key. */
export function registerAgentSurface(
  key: AgentSurfaceKey,
  registration: SurfaceRegistration
): void {
  bootstrapFoundation();
  registry.set(key, registration);
}

/** Test seam: restore foundation-only registry. */
export function __resetControlledSurfaceRegistryForTests(): void {
  registry.clear();
  bootstrapFoundation();
}

export function listRegisteredSurfaces(): readonly string[] {
  bootstrapFoundation();
  return [...registry.keys()];
}

export function isSurfaceRequestRejected(
  request: ControlledSurfaceRequest
): boolean {
  return !resolveControlledSurface(request).ok;
}

export function resolveControlledSurface(
  request: ControlledSurfaceRequest
): ControlledSurfaceResult {
  bootstrapFoundation();
  const surface = request.surface?.trim() ?? '';
  if (!surface || !registry.has(surface)) {
    return { ok: false, reason: 'unregistered_surface', detail: surface };
  }

  const registration = registry.get(surface)!;
  const props = request.props ?? {};
  const allowed = new Set(registration.allowedPropKeys);

  for (const key of Object.keys(props)) {
    if (key === 'className' || key === 'classname') {
      return { ok: false, reason: 'forbidden_className', detail: key };
    }
    if (key === 'html' || key === 'dangerouslySetInnerHTML') {
      return { ok: false, reason: 'forbidden_html', detail: key };
    }
    if (key === 'component' || key === 'Component') {
      return { ok: false, reason: 'forbidden_component', detail: key };
    }
    if (key === 'action' || key === 'actions') {
      return { ok: false, reason: 'forbidden_action', detail: key };
    }
    if (FORBIDDEN_PROP_KEYS.has(key)) {
      if (key.toLowerCase().includes('html')) {
        return { ok: false, reason: 'forbidden_html', detail: key };
      }
      if (key.toLowerCase().includes('action')) {
        return { ok: false, reason: 'forbidden_action', detail: key };
      }
      return { ok: false, reason: 'forbidden_component', detail: key };
    }
    if (URL_PROP_KEYS.has(key)) {
      const value = props[key];
      if (typeof value === 'string' && DANGEROUS_URL_RE.test(value)) {
        return { ok: false, reason: 'forbidden_url', detail: key };
      }
      // Non-allowlisted URL props are still forbidden even if scheme is safe
      if (!allowed.has(key)) {
        return { ok: false, reason: 'forbidden_url', detail: key };
      }
    }
    if (!allowed.has(key)) {
      return { ok: false, reason: 'unknown_prop', detail: key };
    }
  }

  return {
    ok: true,
    surface,
    props: { ...props },
  };
}
