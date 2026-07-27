import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import {
  seedComposerInlineAuthorize,
  seedConfirmedStore,
} from '../fixtures/product';

/**
 * S3 钱的旅程 — the two legs the money story has to walk end to end.
 *
 * 1. 缺哪桶说哪桶: an image-text run debits copy AND image server-side. A
 *    merchant with images to spare and no copy left must be stopped in front
 *    of 生成 and told it is the 文案 bucket, not handed a rejection after the
 *    fact (P0-5 / W05). Redeeming a code unlocks the same page in place —
 *    the merchant never leaves the composer (D-141).
 * 2. 一个数字一个来源: changing a plan allowance in the operations console
 *    changes what the public pricing page quotes, because both read the same
 *    admin-config revision (D-143 / W06).
 *
 * Both legs drive real backends: the allowance moves through the governed
 * admin-config CAS path an operator uses, the shortfall is a real ledger
 * state, and the redemption is a real code an admin recorded.
 */

const TRIAL_ALLOWANCE_KEY = 'plan.allowances.trial';
const STARTER_ALLOWANCE_KEY = 'plan.allowances.starter';

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

/**
 * Apply an admin-config value through the same CAS + audit path an operator
 * uses, then sign out so the journey continues as the merchant.
 */
async function applyAdminConfig(
  page: Page,
  request: APIRequestContext,
  key: string,
  value: unknown,
  journey: string
) {
  const admin = await registerE2EUser(request, { role: 'admin' });
  await loginByForm(page, admin);

  const current = latestRevision(await readConfigHistory(page, key));
  const reason = `S3 e2e ${journey} ${Date.now()}`;
  const response = await page.request.post('/api/core/p1/commands', {
    data: {
      action: 'config_apply',
      module: 'admin-config',
      payload: {
        expectedRevision: current?.revision ?? null,
        key,
        reason,
        value,
      },
    },
    headers: { 'idempotency-key': `s3-e2e-${journey}-${crypto.randomUUID()}` },
  });
  expect(response.ok(), await response.text()).toBeTruthy();

  await expect
    .poll(async () => latestRevision(await readConfigHistory(page, key)), {
      timeout: 30_000,
    })
    .toMatchObject({ reason });

  await signOut(page);
}

async function signOut(page: Page) {
  const signedOut = await page.evaluate(async () => {
    const response = await fetch('/api/auth/sign-out', {
      body: '{}',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    return { body: await response.text(), ok: response.ok };
  });
  expect(signedOut.ok, signedOut.body).toBeTruthy();
}

/** Record a redemption code as an admin, then hand the composer back. */
async function recordRedemptionCode(
  page: Page,
  request: APIRequestContext,
  code: string
) {
  const admin = await registerE2EUser(request, { role: 'admin' });
  await loginByForm(page, admin);
  await page.goto('/admin/redemptions');
  await page.locator('#redeem-copy').fill('5');
  await page.locator('#redeem-image').fill('5');
  await page.locator('#redeem-video').fill('1');
  await page.locator('#redeem-audio').fill('0');
  await page.locator('#redeem-code').fill(code);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/core/p1/commands')
  );
  await page.getByRole('button', { name: /录入兑换码|record code/iu }).click();
  const response = await responsePromise;
  expect(response.ok(), await response.text()).toBeTruthy();
  await expect(page.getByRole('row').filter({ hasText: code })).toBeVisible();
  await signOut(page);
}

/**
 * The seeds these journeys move away from and must put back.
 *
 * admin_config rows outlive a Playwright run — the business database is
 * migrated, not dropped — so a journey that leaves the trial grant at copy 0
 * reddens every later spec that expects a usable trial. Restoring is part of
 * the journey, not cleanup etiquette. Values: D-123 seed / manifest C-3.
 */
const TRIAL_SEED = {
  allowance: { audio: 0, copy: 5, image: 5, video: 1 },
  concurrencyLimit: 1,
  queuePriority: 1,
  supportLabel: 'standard',
  expireDays: 7,
};
const STARTER_SEED = {
  allowance: { audio: 0, copy: 100, image: 40, video: 3 },
  concurrencyLimit: 1,
  queuePriority: 1,
  supportLabel: 'standard',
};

test.describe('S3 钱的旅程', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('a copy-empty image-rich merchant is stopped before 生成 and told which bucket, then a code unlocks in place', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000);
    const code = `S3GATE-${Date.now().toString(36).toUpperCase()}`;

    // The workspace's trial grant is what the merchant starts with, so this is
    // where a copy-empty / image-rich merchant is made — no ledger surgery.
    await applyAdminConfig(
      page,
      request,
      TRIAL_ALLOWANCE_KEY,
      {
        ...TRIAL_SEED,
        allowance: { audio: 0, copy: 0, image: 20, video: 1 },
      },
      'copy-empty-trial'
    );
    try {
      await recordRedemptionCode(page, request, code);

      const merchant = await registerE2EUser(request);
      await loginByForm(page, merchant);
      await page.goto('/dashboard');
      await seedConfirmedStore(page);

      // The two-bucket shape is the 图文笔记 recipe's: it binds a page count, so
      // the run debits copy 1 + image·pages. Reaching it needs an authorized
      // source the same way the note compiler journey does.
      await page.getByTestId('composer-lens-option-image_text').click();
      await seedComposerInlineAuthorize(page, { fileName: 'note-case.png' });
      await page.reload();
      await page.getByTestId('composer-lens-option-image_text').click();
      await page
        .getByTestId('composer-recipe-card-recipe.case_to_xhs_note')
        .click();
      const applyRecipe = page.getByRole('button', { name: '套用并更新设置' });
      const recipeApplied = page.getByTestId('composer-recipe-apply-undo');
      await expect(recipeApplied.or(applyRecipe)).toBeVisible();
      if (await applyRecipe.isVisible()) await applyRecipe.click();
      await expect(recipeApplied).toBeVisible();
      await page
        .getByTestId('composer-intent-input')
        .fill('把这周的护发案例做成一条小红书图文笔记');

      // 缺哪桶说哪桶 — 图片额度 is plentiful, so a card that only says
      // 「额度不足」 would send the merchant to top up the wrong bucket.
      const shortfall = page.getByTestId('composer-quota-shortfall');
      await expect(shortfall).toBeVisible({ timeout: 60_000 });
      await expect(shortfall).toContainText('文案额度');
      await expect(shortfall).toHaveAttribute(
        'data-quota-short-resources',
        /copy/u
      );
      await expect(page.getByTestId('composer-submit')).toBeDisabled();

      // D-141: the exits are the inline code and a human, not a link back to the
      // read-only usage page the merchant is already looking at.
      await expect(
        page.getByTestId('composer-quota-contact-operations')
      ).toHaveAttribute('href', '/contact');

      await page.getByTestId('composer-quota-redemption-code').fill(code);
      await page.getByTestId('composer-quota-redeem-submit').click();

      // Unlocked in place: same page, same draft, submit alive again.
      await expect(
        page.getByTestId('composer-quota-unlock-success')
      ).toBeVisible({
        timeout: 60_000,
      });
      await expect(page).toHaveURL(/\/dashboard/u);
      await expect(page.getByTestId('composer-intent-input')).toHaveValue(
        /护发/u
      );
      await expect(page.getByTestId('composer-submit')).toBeEnabled({
        timeout: 60_000,
      });
    } finally {
      await applyAdminConfig(
        page,
        request,
        TRIAL_ALLOWANCE_KEY,
        TRIAL_SEED,
        'restore-trial-seed'
      );
    }
  });

  test('changing the 初级 copy allowance changes what the public pricing page quotes', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const nextCopyAllowance = 137;

    await page.goto('/pricing');
    const starterQuota = page.getByTestId('pricing-plan-quota-starter');
    await expect(starterQuota).toBeVisible();
    await expect(starterQuota).not.toContainText(`${nextCopyAllowance} 条`);

    await applyAdminConfig(
      page,
      request,
      STARTER_ALLOWANCE_KEY,
      {
        ...STARTER_SEED,
        allowance: { ...STARTER_SEED.allowance, copy: nextCopyAllowance },
      },
      'starter-copy-allowance'
    );

    try {
      // No deploy, no second number to edit: the public page reads the same
      // revision the grant reads (D-143 单一商品目录).
      await page.goto('/pricing');
      await expect(
        page.getByTestId('pricing-plan-quota-starter')
      ).toContainText(`${nextCopyAllowance} 条`);
    } finally {
      await applyAdminConfig(
        page,
        request,
        STARTER_ALLOWANCE_KEY,
        STARTER_SEED,
        'restore-starter-seed'
      );
    }
  });
});
