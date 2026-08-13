/**
 * V31-86 — Day-0 archive card: say a sentence, see prefilled defaults, edit
 * one field, click save once. Full-stack run belongs to the master; this file
 * must `--list`.
 */
import { expect, test, type Page, type Request } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { productState } from '../fixtures/product';

const AUDIT_SENTENCE =
  '我们店叫盘点美发工作室，在市中心，主打染发和头皮护理，染发套餐日常价 388 元';

type ModuleRequest = {
  action?: string;
  module?: string;
};

function moduleRequest(request: Request): ModuleRequest | null {
  if (
    request.method() !== 'POST' ||
    !request.url().includes('/api/core/p1/commands')
  ) {
    return null;
  }
  try {
    return request.postDataJSON() as ModuleRequest;
  } catch {
    return null;
  }
}

function isAction(request: Request, action: string) {
  return moduleRequest(request)?.action === action;
}

async function walkToStep(page: Page, step: string) {
  const wizard = page.getByTestId('store-intake-wizard-store');
  for (let index = 0; index < 5; index += 1) {
    const current = await wizard
      .locator('li[aria-current="step"]')
      .getAttribute('data-step');
    if (current === step) return;
    await wizard.getByTestId('store-intake-next').click();
  }
  throw new Error(`step ${step} was never reached`);
}

test.describe('V31-86 store onboarding archive card', () => {
  test.afterEach(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('saying one sentence prefills the card with defaults and one save creates the store', async ({
    page,
    request,
  }) => {
    test.setTimeout(360_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    const finalizations: ModuleRequest[] = [];
    page.on('request', (outgoing) => {
      if (!isAction(outgoing, 'finalize_store_intake')) return;
      finalizations.push(moduleRequest(outgoing)!);
    });

    await page.goto('/dashboard/store');
    const wizard = page.getByTestId('store-intake-wizard-store');
    await expect(wizard).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByTestId('store-profile-empty-description')
    ).toBeVisible();

    await walkToStep(page, 'say_or_upload');
    await wizard.getByTestId('store-intake-sentence').fill(AUDIT_SENTENCE);

    await walkToStep(page, 'confirm_each');
    await expect(wizard.getByTestId('store-intake-field-name')).toHaveValue(
      '盘点美发工作室'
    );
    await expect(wizard.getByTestId('store-intake-provenance-name')).toHaveText(
      'AI 推测'
    );
    await expect(wizard.getByTestId('store-intake-field-district')).toHaveValue(
      '本区'
    );
    await expect(
      wizard.getByTestId('store-intake-provenance-district')
    ).toHaveText('平台兜底');
    await expect(wizard.getByTestId('store-intake-field-address')).toHaveValue(
      '门店地址待补充'
    );
    await expect(wizard.getByTestId('store-intake-field-booking')).toHaveValue(
      '到店咨询预约'
    );
    await expect(wizard.getByTestId('store-intake-confirm-name')).toHaveCount(
      0
    );

    await wizard.getByTestId('store-intake-field-city').fill('杭州市');
    await wizard
      .getByTestId('store-intake-field-projectPriceValidity-long-term')
      .click();
    await expect(wizard.getByTestId('store-intake-save')).toBeEnabled();

    const finalizeResponse = page.waitForResponse(
      (response) =>
        isAction(response.request(), 'finalize_store_intake') &&
        response.status() < 400,
      { timeout: 90_000 }
    );
    await wizard.getByTestId('store-intake-save').click();
    expect((await finalizeResponse).ok()).toBeTruthy();
    await expect(wizard.getByTestId('store-intake-saved')).toBeVisible({
      timeout: 60_000,
    });
    expect(finalizations).toHaveLength(1);

    await expect
      .poll(async () => (await productState(page)).store?.name, {
        timeout: 60_000,
      })
      .toBe('盘点美发工作室');
    await expect(
      page.getByTestId('store-profile-empty-description')
    ).toHaveCount(0);
    await expect(page.getByText('盘点美发工作室').first()).toBeVisible();

    const facts = page.getByRole('listitem').filter({
      has: page.locator('[data-i18n-pass-through="store-fact"]'),
    });
    // Five, not four: one save writes 店名 / 城市 / 行业 / 项目 / 价格. The count
    // is the teeth against a platform default sneaking in as a confirmed fact,
    // which the three absence assertions below name one by one. The list is a
    // client query, so it needs the same patience as the rest of this journey —
    // the default 5s expect timeout expires while it is still loading.
    await expect(facts).toHaveCount(5, { timeout: 60_000 });
    await expect(page.getByText('盘点美发工作室').first()).toBeVisible();
    await expect(page.getByText('杭州市').first()).toBeVisible();
    await expect(page.getByText('染发套餐').first()).toBeVisible();
    await expect(page.getByText('388').first()).toBeVisible();
    // Scoped to the ledger, not the page: a platform default is a legitimate
    // profile value (the archive card fills and labels it), it just must never
    // be recorded as a fact the merchant confirmed.
    for (const platformDefault of ['本区', '门店地址待补充', '到店咨询预约']) {
      await expect(facts.filter({ hasText: platformDefault })).toHaveCount(0);
    }
  });
});
