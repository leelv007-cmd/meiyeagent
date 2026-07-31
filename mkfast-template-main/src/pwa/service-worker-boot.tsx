import { useEffect } from 'react';
import { ensureServiceWorkerRegistered } from './register-service-worker';
import { InstallPrompt } from './install-prompt';

/**
 * Client-only mount: register SW + optional low-interruption mobile install hint.
 * Settings surface hosts the full install card separately.
 * Production builds only — dev/test stacks must not take a SW or surface the hint.
 */
export function ServiceWorkerBoot() {
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    ensureServiceWorkerRegistered();
  }, []);

  if (!import.meta.env.PROD) return null;
  return <InstallPrompt variant="mobile-hint" />;
}
