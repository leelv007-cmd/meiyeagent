/**
 * Production Service Worker registration (same-origin /sw.js only).
 * Safe to call on every client boot; no-ops when unsupported or on SSR.
 */

export const SERVICE_WORKER_URL = '/sw.js';

export type ServiceWorkerRegistrationResult =
  | { ok: true; registration: ServiceWorkerRegistration }
  | { ok: false; reason: 'unsupported' | 'ssr' | 'error'; error?: unknown };

export async function registerServiceWorker(
  swUrl: string = SERVICE_WORKER_URL
): Promise<ServiceWorkerRegistrationResult> {
  if (typeof window === 'undefined') {
    return { ok: false, reason: 'ssr' };
  }
  if (!('serviceWorker' in navigator)) {
    return { ok: false, reason: 'unsupported' };
  }

  try {
    const registration = await navigator.serviceWorker.register(swUrl, {
      scope: '/',
      updateViaCache: 'none',
    });
    return { ok: true, registration };
  } catch (error) {
    return { ok: false, reason: 'error', error };
  }
}

/** Fire-and-forget registration for app shell mount. */
export function ensureServiceWorkerRegistered(): void {
  if (typeof window === 'undefined') return;
  // Defer until idle so first paint is not blocked.
  const run = () => {
    void registerServiceWorker().then((result) => {
      if (!result.ok && result.reason === 'error') {
        console.warn('[pwa] service worker registration failed', result.error);
      }
    });
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(run, { timeout: 4000 });
  } else {
    window.setTimeout(run, 1);
  }
}
