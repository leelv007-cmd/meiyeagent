import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  registerServiceWorker,
  SERVICE_WORKER_URL,
} from './register-service-worker';

const originalWindow = globalThis.window;
const originalNavigator = globalThis.navigator;

afterEach(() => {
  // Restore any stubs between tests.
  Object.defineProperty(globalThis, 'window', {
    value: originalWindow,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: originalNavigator,
    configurable: true,
    writable: true,
  });
});

test('registerServiceWorker reports ssr when window is missing', async () => {
  Object.defineProperty(globalThis, 'window', {
    value: undefined,
    configurable: true,
    writable: true,
  });
  const result = await registerServiceWorker();
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'ssr');
});

test('registerServiceWorker reports unsupported when serviceWorker API missing', async () => {
  Object.defineProperty(globalThis, 'window', {
    value: {},
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: {},
    configurable: true,
    writable: true,
  });
  const result = await registerServiceWorker();
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'unsupported');
});

test('registerServiceWorker registers same-origin /sw.js on success', async () => {
  const registration = { scope: '/' } as ServiceWorkerRegistration;
  let registeredUrl: string | undefined;
  let registeredOptions: RegistrationOptions | undefined;

  Object.defineProperty(globalThis, 'window', {
    value: {},
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      serviceWorker: {
        register(url: string, options?: RegistrationOptions) {
          registeredUrl = url;
          registeredOptions = options;
          return Promise.resolve(registration);
        },
      },
    },
    configurable: true,
    writable: true,
  });

  const result = await registerServiceWorker();
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.registration, registration);
  assert.equal(registeredUrl, SERVICE_WORKER_URL);
  assert.deepEqual(registeredOptions, {
    scope: '/',
    updateViaCache: 'none',
  });
});
