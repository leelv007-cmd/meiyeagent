/**
 * V31-89 — spoken-sentence LLM extract: non-template wording is arranged
 * into the archive card, then one save. Full-stack run belongs to the master;
 * this file must `--list`.
 */
import { expect, test, type Page, type Request } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { productState } from '../fixtures/product';

/** Regex in extractStoreFactsFromSentence cannot parse this line. */
const NON_TEMPLATE_SENTENCE = '盘点美发工作室开在杭州，染发套餐价格三百八十八';

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

test.describe('V31-89 spoken sentence LLM extract', () => {
  test.afterEach(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('non-template wording is arranged into the archive card and one save writes the store', async ({
    page,
    request,
  }) => {
    test.setTimeout(360_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    const extracts: ModuleRequest[] = [];
    const finalizations: ModuleRequest[] = [];
    page.on('request', (outgoing) => {
      if (isAction(outgoing, 'extract_store_sentence')) {
        extracts.push(moduleRequest(outgoing)!);
      }
      if (isAction(outgoing, 'finalize_store_intake')) {
        finalizations.push(moduleRequest(outgoing)!);
      }
    });

    await page.goto('/dashboard/store');
    const wizard = page.getByTestId('store-intake-wizard-store');
    await expect(wizard).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByTestId('store-profile-empty-description')
    ).toBeVisible();

    await walkToStep(page, 'say_or_upload');
    await wizard
      .getByTestId('store-intake-sentence')
      .fill(NON_TEMPLATE_SENTENCE);

    const extractResponse = page.waitForResponse(
      (response) =>
        isAction(response.request(), 'extract_store_sentence') &&
        response.status() < 400,
      { timeout: 30_000 }
    );
    await walkToStep(page, 'confirm_each');
    expect((await extractResponse).ok()).toBeTruthy();

    await expect(wizard.getByTestId('store-intake-field-name')).toHaveValue(
      '盘点美发工作室',
      { timeout: 30_000 }
    );
    await expect(wizard.getByTestId('store-intake-provenance-name')).toHaveText(
      'AI 推测'
    );
    await expect(wizard.getByTestId('store-intake-field-city')).toHaveValue(
      '杭州'
    );
    await expect(
      wizard.getByTestId('store-intake-field-projectName')
    ).toHaveValue('染发套餐');
    await expect(
      wizard.getByTestId('store-intake-field-projectPrice')
    ).toHaveValue('388');
    await expect(wizard.getByTestId('store-intake-confirm-name')).toHaveCount(
      0
    );

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

    expect(extracts.length).toBeGreaterThanOrEqual(1);
    expect(finalizations).toHaveLength(1);
    expect(finalizations[0]?.action).toBe('finalize_store_intake');

    await expect
      .poll(async () => (await productState(page)).store?.name, {
        timeout: 60_000,
      })
      .toBe('盘点美发工作室');
    await expect(
      page.getByTestId('store-profile-empty-description')
    ).toHaveCount(0);
  });
});
