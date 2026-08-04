import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
  signOut,
} from '../fixtures/auth';

/**
 * S3 money journeys after #311.
 *
 * Bucket allowance hot-config (`plan.allowances.*`) is retired. Merchant
 * billing truth is `plan.credits.*`. The shortfall/redemption leg moved to the
 * credit workbench surface (#305); public pricing reads the credit catalogue
 * (#310).
 */

const STARTER_CREDIT_KEY = 'plan.credits.starter';

const STARTER_CREDIT_SEED = {
  concurrencyLimit: 1,
  credits: 500,
  currency: 'HKD',
  monthlyPriceMicros: 231_000_000,
  queuePriority: 1,
  storageMb: 1_024,
  supportLabel: 'standard',
};

type AdminConfigRevision = {
  reason?: string;
  revision?: number;
  storedValue?: unknown;
};

async function readConfigHistory(
  page: Page,
  key: string
): Promise<AdminConfigRevision[]> {
  const response = await page.request.post('/api/core/p1/query', {
    data: {
      action: 'config_history',
      module: 'admin-config',
      payload: { key },
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (
    ((await response.json()) as { data?: AdminConfigRevision[] }).data ?? []
  );
}

function latestRevision(history: AdminConfigRevision[]) {
  return history.reduce<AdminConfigRevision | undefined>(
    (latest, candidate) =>
      (candidate.revision ?? 0) > (latest?.revision ?? 0) ? candidate : latest,
    undefined
  );
}

async function applyAdminConfig(
  page: Page,
  request: APIRequestContext,
  key: string,
  value: unknown,
  journey: string
) {
  await signOut(page).catch(() => undefined);
  const admin = await registerE2EUser(request, { role: 'admin' });
  await loginByForm(page, admin);

  const history = await readConfigHistory(page, key);
  const expectedRevision = latestRevision(history)?.revision ?? null;
  const response = await page.request.post('/api/core/p1/command', {
    data: {
      action: 'config_apply',
      idempotencyKey: `s3-${journey}-${Date.now()}`,
      module: 'admin-config',
      payload: {
        expectedRevision,
        key,
        reason: `s3 money journey ${journey}`,
        value,
      },
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  await signOut(page);
}

test.describe('S3 钱的旅程', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('retired plan.allowances keys are rejected by admin-config CAS', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await signOut(page).catch(() => undefined);
    const admin = await registerE2EUser(request, { role: 'admin' });
    await loginByForm(page, admin);

    const response = await page.request.post('/api/core/p1/command', {
      data: {
        action: 'config_apply',
        idempotencyKey: `s3-reject-allowance-${Date.now()}`,
        module: 'admin-config',
        payload: {
          expectedRevision: null,
          key: 'plan.allowances.starter',
          reason: 'must fail closed after #311',
          value: {
            allowance: { audio: 0, copy: 100, image: 40, video: 3 },
            concurrencyLimit: 1,
            queuePriority: 1,
            supportLabel: 'standard',
          },
        },
      },
    });
    expect(response.ok()).toBeFalsy();
    await signOut(page);
  });

  test('changing 初级 credits changes what the public pricing page quotes', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const nextCredits = 137;

    await page.goto('/pricing');
    const starterCredits = page.getByTestId('pricing-credits-starter');
    await expect(starterCredits).toBeVisible();
    await expect(starterCredits).not.toContainText(String(nextCredits));

    try {
      await applyAdminConfig(
        page,
        request,
        STARTER_CREDIT_KEY,
        {
          ...STARTER_CREDIT_SEED,
          credits: nextCredits,
        },
        'starter-credits'
      );

      await page.goto('/pricing');
      await expect(page.getByTestId('pricing-credits-starter')).toContainText(
        String(nextCredits)
      );
    } finally {
      await applyAdminConfig(
        page,
        request,
        STARTER_CREDIT_KEY,
        STARTER_CREDIT_SEED,
        'restore-starter-credit-seed'
      );
    }
  });
});
