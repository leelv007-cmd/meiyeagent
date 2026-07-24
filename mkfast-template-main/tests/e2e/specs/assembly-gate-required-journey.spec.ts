import { expect, test, type Page } from '@playwright/test';
import { cleanupE2EUsers } from '../fixtures/auth';
import { createE2EUser } from '../fixtures/test-data';
import {
  assertThreeModalDiscovery,
  JOURNEY_CONTRACTS,
  waitForResultJourney,
} from '../fixtures/ui-journey';

async function p1Query<T>(
  page: Page,
  module: string,
  action: string,
  payload: Record<string, unknown> = {}
) {
  return page.evaluate(
    async ({ queryAction, queryModule, queryPayload }) => {
      const response = await fetch('/api/core/p1/query', {
        body: JSON.stringify({
          action: queryAction,
          module: queryModule,
          payload: queryPayload,
        }),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      const envelope = (await response.json()) as {
        data?: unknown;
        error?: { message?: string };
      };
      if (!response.ok || envelope.data === undefined) {
        throw new Error(
          envelope.error?.message ??
            `${queryModule}.${queryAction} query failed`
        );
      }
      return envelope.data;
    },
    {
      queryAction: action,
      queryModule: module,
      queryPayload: payload,
    }
  ) as Promise<T>;
}

async function submitFirstCopy(page: Page, intent: string) {
  const lens = page.getByTestId('composer-lens-option-copy');
  await lens.click();
  await expect(lens).toBeChecked();
  await page.getByTestId('composer-intent-input').fill(intent);
  await expect(page.getByTestId('composer-quote-line')).toBeVisible({
    timeout: 30_000,
  });

  const submissionResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/core/p1/composer/submissions'),
    { timeout: 120_000 }
  );
  await page.getByTestId('composer-submit').click();
  const response = await submissionResponsePromise;
  const body = (await response.json()) as {
    data?: { work?: { id?: string } };
    error?: { message?: string };
  };
  expect(
    response.ok(),
    body.error?.message ?? 'Composer submission failed'
  ).toBeTruthy();
  const workId = body.data?.work?.id;
  expect(workId).toBeTruthy();
  await expect(page).toHaveURL(
    new RegExp(`/dashboard/results/${encodeURIComponent(workId!)}`, 'u'),
    { timeout: 60_000 }
  );
  return workId!;
}

test.describe('required assembly gate', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('registers a cold tenant and produces its first copy with zero configuration', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const user = createE2EUser();
    await page.goto('/auth/register');
    await page.waitForLoadState('networkidle');
    await page.locator('input[name="name"]').fill(user.name);
    await page.locator('input[name="email"]').fill(user.email);
    await page.locator('input[name="password"]').fill(user.password);
    const registrationResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/auth/sign-up/email')
    );
    await page.getByRole('button', { name: /^sign up$|^注册$/iu }).click();
    const registrationResponse = await registrationResponsePromise;
    expect(
      registrationResponse.ok(),
      await registrationResponse.text()
    ).toBeTruthy();

    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const response = await fetch('/api/auth/get-session', {
              credentials: 'same-origin',
            });
            if (!response.ok) return null;
            const session = (await response.json()) as {
              user?: { email?: string };
            } | null;
            return session?.user?.email ?? null;
          }),
        { timeout: 30_000 }
      )
      .toBe(user.email);

    await page.goto('/dashboard');
    await assertThreeModalDiscovery(page);

    const entitlement = await p1Query<{
      plan?: { tier?: string };
      usage: Record<string, { allowance: number }>;
    }>(page, 'entitlements', 'projection');
    expect(entitlement.plan?.tier).toBe('trial');
    expect({
      copy: entitlement.usage.copy?.allowance,
      image: entitlement.usage.image?.allowance,
      video: entitlement.usage.video?.allowance,
    }).toEqual({ copy: 5, image: 5, video: 1 });

    const defaults = await Promise.all(
      [
        ['copy.generate', 'deepseek-v4-pro'],
        ['image.generate', 'seedream-5-pro'],
        ['video.generate', 'seedance-2'],
      ].map(async ([operation, expectedModel]) => {
        const preference = await p1Query<{ workspaceDefault?: string }>(
          page,
          'model-supply',
          'preferences',
          { operation }
        );
        return [operation, preference.workspaceDefault, expectedModel];
      })
    );
    for (const [operation, actualModel, expectedModel] of defaults) {
      expect(actualModel, `${operation} platform default`).toBe(expectedModel);
    }

    const identities = await p1Query<unknown[]>(
      page,
      'marketing-identity',
      'marketing_identities',
      { includeInactive: true }
    );
    expect(identities).toEqual([]);

    const copyContract = JOURNEY_CONTRACTS[0];
    const workId = await submitFirstCopy(
      page,
      '写一条介绍本周护理服务的朋友圈文案'
    );
    await waitForResultJourney(page, copyContract, workId);
  });
});
