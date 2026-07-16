import { expect, test } from '@playwright/test';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

test.describe('core runtime health', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('exposes authenticated core health without restoring retired dashboard diagnostics', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    const health = await page.evaluate(async () => {
      const response = await fetch('/api/core/diagnostics', {
        credentials: 'same-origin',
      });
      return {
        body: (await response.json()) as {
          data?: { service?: string; status?: string };
          meta?: { correlationId?: string };
        },
        status: response.status,
      };
    });
    expect(health.status).toBe(200);
    expect(health.body.data).toEqual({
      service: 'meiye-core',
      status: 'ok',
    });
    expect(health.body.meta?.correlationId).toMatch(/^corr-/);
  });
});
