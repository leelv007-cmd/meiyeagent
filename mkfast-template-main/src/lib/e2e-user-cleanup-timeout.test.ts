import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { request as playwrightRequest } from '@playwright/test';

import { cleanupE2EUsers } from '../../tests/e2e/fixtures/auth.js';

test(
  'E2E user cleanup stops waiting on an unresponsive application',
  { timeout: 25_000 },
  async (t) => {
    const server = createServer(() => undefined);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as AddressInfo;
    const previousOrigin = process.env.PLAYWRIGHT_AUTH_BASE_URL;
    process.env.PLAYWRIGHT_AUTH_BASE_URL = `http://127.0.0.1:${port}`;
    const request = await playwrightRequest.newContext();
    const forceClose = setTimeout(() => {
      server.closeAllConnections();
      server.close();
    }, 17_000);

    t.after(async () => {
      clearTimeout(forceClose);
      if (previousOrigin === undefined) {
        delete process.env.PLAYWRIGHT_AUTH_BASE_URL;
      } else {
        process.env.PLAYWRIGHT_AUTH_BASE_URL = previousOrigin;
      }
      await request.dispose();
      server.closeAllConnections();
      if (server.listening) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    const startedAt = performance.now();
    await assert.rejects(cleanupE2EUsers(request), /timeout|timed out/iu);
    const elapsedMs = performance.now() - startedAt;

    assert.ok(elapsedMs >= 14_000, `cleanup stopped too early: ${elapsedMs}ms`);
    assert.ok(elapsedMs < 16_500, `cleanup exceeded its bound: ${elapsedMs}ms`);
  }
);
