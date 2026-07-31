import { useEffect } from 'react';
import { ensureServiceWorkerRegistered } from './register-service-worker';
import { InstallPrompt } from './install-prompt';

/**
 * Client-only mount: register SW + optional low-interruption mobile install hint.
 * Settings surface hosts the full install card separately.
 */
export function ServiceWorkerBoot() {
  useEffect(() => {
    ensureServiceWorkerRegistered();
  }, []);

  return <InstallPrompt variant="mobile-hint" />;
}
