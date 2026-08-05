import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { createE2EUser } from '../fixtures/test-data';

type CreditBalance = {
  availableCredits: number;
  expiredCredits: number;
  grantedCredits: number;
  refundedCredits: number;
  soonestExpiringLot: unknown;
  usedCredits: number;
};

type EntitlementProjection = {
  credits: CreditBalance;
  plan?: { tier?: string };
};

type ProvisioningShape = {
  credits: CreditBalance;
  defaults: Record<string, string | null>;
  planTier?: string;
};

/**
 * The seeded one-time trial grant (`plan.credits.trial`) and the credits this
 * spec's own recorded codes carry. Operators can move the trial number in
 * admin-config; the e2e stack boots on the governed default.
 */
const TRIAL_CREDITS = 100;
const CODE_CREDITS = 30;

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

async function signOut(page: Page) {
  const response = await page.evaluate(async () => {
    const result = await fetch('/api/auth/sign-out', {
      body: '{}',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    return { body: await result.text(), ok: result.ok };
  });
  expect(response.ok, response.body).toBeTruthy();
}

async function provisioningShape(page: Page): Promise<ProvisioningShape> {
  const entitlement = await p1Query<EntitlementProjection>(
    page,
    'entitlements',
    'projection'
  );
  const defaults = Object.fromEntries(
    await Promise.all(
      ['copy.generate', 'image.generate', 'video.generate'].map(
        async (operation) => {
          const preference = await p1Query<{ platformDefault?: string }>(
            page,
            'model-supply',
            'preferences',
            { operation }
          );
          return [operation, preference.platformDefault ?? null] as const;
        }
      )
    )
  );
  return {
    credits: entitlement.credits,
    defaults,
    planTier: entitlement.plan?.tier,
  };
}

/**
 * Record a code on the admin console the operator actually uses. The console
 * mints credit codes — the retired per-bucket amount fields are gone with the
 * buckets, and the recorded row is read back in credits.
 */
async function recordCode(page: Page, code: string) {
  await page.locator('#redeem-credits').fill(String(CODE_CREDITS));
  await page.locator('#redeem-code').fill(code);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/core/p1/commands')
  );
  await page.getByRole('button', { name: /录入兑换码|record code/iu }).click();
  const response = await responsePromise;
  expect(response.ok(), await response.text()).toBeTruthy();
  const row = page.getByRole('row').filter({ hasText: code });
  await expect(row).toBeVisible();
  await expect(row).toContainText(/可兑换|active/iu);
  return row;
}

test.describe('registration and redemption chain (#219)', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('records, queries, redeems exactly once, voids, and enters the workbench', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const suffix = randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase();
    const redeemCode = `PILOT-${suffix}`;
    const voidCode = `VOID-${suffix}`;
    const admin = await registerE2EUser(request, { role: 'admin' });
    await loginByForm(page, admin);
    const adminActor = await page.evaluate(async () => {
      const response = await fetch('/api/auth/get-session', {
        credentials: 'same-origin',
      });
      const session = (await response.json()) as {
        user?: { id?: string };
      } | null;
      return session?.user?.id;
    });
    expect(adminActor).toBeTruthy();

    await page.goto('/admin/redemptions');

    const redeemRow = await recordCode(page, redeemCode);
    await expect(
      redeemRow,
      'the console must read the recorded amount back in credits'
    ).toContainText(`${CODE_CREDITS} 积分`);

    const voidRow = await recordCode(page, voidCode);
    const voidResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/core/p1/commands')
    );
    await voidRow.getByRole('button', { name: /作废|void/iu }).click();
    const voidResponse = await voidResponsePromise;
    expect(voidResponse.ok(), await voidResponse.text()).toBeTruthy();
    await expect(voidRow).toContainText(/已作废|voided/iu);

    const assisted = createE2EUser();
    await page.goto('/admin/users');
    await page.waitForLoadState('networkidle');
    await page.locator('#admin-create-user-name').fill(assisted.name);
    await page.locator('#admin-create-user-email').fill(assisted.email);
    await page.locator('#admin-create-user-password').fill(assisted.password);
    const assistedResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/auth/admin/create-user')
    );
    await page
      .getByRole('button', { name: /^create account$|^创建账号$/iu })
      .click();
    const assistedResponse = await assistedResponsePromise;
    expect(assistedResponse.ok(), await assistedResponse.text()).toBeTruthy();
    const assistedBody = (await assistedResponse.json()) as {
      user?: {
        createdAt?: string;
        provisionedByUserId?: unknown;
      };
    };
    expect(assistedBody.user).not.toHaveProperty('provisionedByUserId');
    expect(Date.parse(assistedBody.user?.createdAt ?? '')).not.toBeNaN();
    const assistedRow = page
      .getByRole('row')
      .filter({ hasText: assisted.email });
    await expect(assistedRow).toContainText(admin.name);
    await expect(assistedRow).not.toContainText(adminActor!);

    await signOut(page);
    await loginByForm(page, assisted);
    const assistedShape = await provisioningShape(page);
    expect(assistedShape).toEqual({
      credits: {
        availableCredits: TRIAL_CREDITS,
        expiredCredits: 0,
        grantedCredits: TRIAL_CREDITS,
        refundedCredits: 0,
        soonestExpiringLot: null,
        usedCredits: 0,
      },
      defaults: {
        'copy.generate': 'deepseek-v4-pro',
        'image.generate': 'nano-banana-2',
        'video.generate': 'seedance-2',
      },
      planTier: 'trial',
    });
    await signOut(page);

    const forged = createE2EUser();
    const forgedResponse = await page.evaluate(async (user) => {
      const response = await fetch('/api/auth/sign-up/email', {
        body: JSON.stringify({
          email: user.email,
          name: user.name,
          password: user.password,
          provisionedByUserId: 'forged-user',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      return {
        body: (await response.json()) as { code?: string },
        status: response.status,
      };
    }, forged);
    expect(forgedResponse).toEqual({
      body: {
        code: 'FIELD_NOT_ALLOWED',
        message: 'provisionedByUserId is not allowed to be set',
      },
      status: 400,
    });

    const merchant = createE2EUser();
    await page.goto('/auth/register');
    await page.waitForLoadState('networkidle');
    await page.locator('input[name="name"]').fill(merchant.name);
    await page.locator('input[name="email"]').fill(merchant.email);
    await page.locator('input[name="password"]').fill(merchant.password);
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
    const registrationBody = (await registrationResponse.json()) as {
      user?: {
        id?: string;
        provisionedByUserId?: unknown;
      };
    };
    expect(registrationBody.user).not.toHaveProperty('provisionedByUserId');
    expect(registrationBody.user?.id).toBeTruthy();

    const naturalShape = await provisioningShape(page);
    expect(naturalShape).toEqual(assistedShape);

    await signOut(page);
    await loginByForm(page, admin);
    const attributionForgery = await page.evaluate(
      async ({ email, name, userId }) => {
        const updateResponse = await fetch('/api/auth/admin/update-user', {
          body: JSON.stringify({
            data: {
              name,
              provisionedByUserId: 'forged-admin-user',
            },
            userId,
          }),
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        });
        const listResponse = await fetch(
          `/api/auth/admin/list-users?limit=100&searchField=email&searchValue=${encodeURIComponent(email)}`,
          { credentials: 'same-origin' }
        );
        return {
          listBody: (await listResponse.json()) as {
            users?: Array<{
              email?: string;
              provisionedByUserId?: unknown;
            }>;
          },
          listOk: listResponse.ok,
          updateBody: await updateResponse.text(),
          updateOk: updateResponse.ok,
        };
      },
      {
        email: merchant.email,
        name: merchant.name,
        userId: registrationBody.user!.id!,
      }
    );
    expect(attributionForgery.updateOk, attributionForgery.updateBody).toBe(
      true
    );
    expect(attributionForgery.listOk).toBe(true);
    const listedMerchant = attributionForgery.listBody.users?.find(
      (user) => user.email === merchant.email
    );
    expect(listedMerchant).toBeDefined();
    expect(listedMerchant).not.toHaveProperty('provisionedByUserId');

    await signOut(page);
    await loginByForm(page, merchant);
    await page.goto('/settings/account');
    const codeInput = page.locator('#workspace-redemption-code');
    await codeInput.fill(redeemCode);
    const redeemResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/core/p1/commands')
    );
    await page.getByRole('button', { name: /兑换|redeem/iu }).click();
    const redeemResponse = await redeemResponsePromise;
    expect(redeemResponse.ok(), await redeemResponse.text()).toBeTruthy();

    const after = await p1Query<EntitlementProjection>(
      page,
      'entitlements',
      'projection'
    );
    // Redeeming adds the code's credits to the trial grant the merchant
    // already holds — a second batch on the same ledger, not a replacement.
    expect(
      after.credits,
      'the redeemed code must land on the credit ledger'
    ).toMatchObject({
      availableCredits: TRIAL_CREDITS + CODE_CREDITS,
      expiredCredits: 0,
      grantedCredits: TRIAL_CREDITS + CODE_CREDITS,
      refundedCredits: 0,
      usedCredits: 0,
    });

    await codeInput.fill(redeemCode);
    const replayResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/core/p1/commands')
    );
    await page.getByRole('button', { name: /兑换|redeem/iu }).click();
    const replayResponse = await replayResponsePromise;
    expect(replayResponse.ok(), await replayResponse.text()).toBeTruthy();
    const replayed = await p1Query<EntitlementProjection>(
      page,
      'entitlements',
      'projection'
    );
    expect(
      replayed.credits,
      'redeeming the same code twice must not grant a second batch'
    ).toEqual(after.credits);

    await page.goto('/dashboard');
    await expect(
      page
        .getByRole('navigation', { name: '业务导航' })
        .getByRole('link', { name: '创作', exact: true })
    ).toBeVisible();
  });
});
