/**
 * Spec F / #385 — shareable `?exceptions=` client filter on admin exception home.
 * Filter is projection-only (no backend query change). Driver runs this Playwright file.
 */
import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

async function loginAsAdmin(
  page: Page,
  request: Parameters<typeof registerE2EUser>[0]
) {
  const admin = await registerE2EUser(request, { role: 'admin' });
  await loginByForm(page, admin);
}

async function waitForExceptionHome(page: Page) {
  const panel = page.getByTestId('exception-home-panel');
  await expect(panel).toBeVisible({ timeout: 30_000 });
  return panel;
}

test.describe('admin exception-home URL filter (#385)', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('?exceptions=blocked,attention shows only those severities', async ({
    page,
    request,
  }) => {
    await loginAsAdmin(page, request);
    await page.goto('/admin?exceptions=blocked,attention');

    const panel = await waitForExceptionHome(page);
    await expect(panel).toHaveAttribute(
      'data-severity-filter',
      'blocked,attention'
    );

    const rows = panel.getByTestId('exception-row');
    const filterEmpty = panel.getByTestId('exception-filter-empty');
    const emptyState = panel.getByTestId('exception-empty-state');

    // Either the full list is empty, the filter missed everything, or every
    // visible row is blocked/attention.
    if ((await emptyState.count()) > 0) {
      await expect(emptyState).toBeVisible();
      return;
    }

    if ((await filterEmpty.count()) > 0) {
      await expect(filterEmpty).toBeVisible();
      await expect(rows).toHaveCount(0);
      return;
    }

    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const severity = await rows.nth(i).getAttribute('data-severity');
      expect(
        severity === 'blocked' || severity === 'attention',
        `row ${i} severity=${severity}`
      ).toBeTruthy();
    }
  });

  test('reload keeps the same filter from the shareable URL', async ({
    page,
    request,
  }) => {
    await loginAsAdmin(page, request);
    await page.goto('/admin?exceptions=blocked,attention');
    const panel = await waitForExceptionHome(page);
    await expect(panel).toHaveAttribute(
      'data-severity-filter',
      'blocked,attention'
    );

    await page.reload();
    const after = await waitForExceptionHome(page);
    await expect(page).toHaveURL(
      /exceptions=blocked%2Cattention|exceptions=blocked,attention/u
    );
    await expect(after).toHaveAttribute(
      'data-severity-filter',
      'blocked,attention'
    );
  });

  test('no ?exceptions= param shows the full projected list', async ({
    page,
    request,
  }) => {
    await loginAsAdmin(page, request);
    await page.goto('/admin');

    const panel = await waitForExceptionHome(page);
    await expect(panel).toHaveAttribute('data-severity-filter', 'all');
    await expect(page).not.toHaveURL(/[?&]exceptions=/u);

    const emptyState = panel.getByTestId('exception-empty-state');
    if ((await emptyState.count()) > 0) {
      await expect(emptyState).toBeVisible();
      return;
    }

    const projected = Number(await panel.getAttribute('data-exception-count'));
    const visible = Number(
      await panel.getAttribute('data-visible-exception-count')
    );
    expect(Number.isFinite(projected)).toBeTruthy();
    expect(visible).toBe(projected);
    await expect(panel.getByTestId('exception-row')).toHaveCount(projected);
  });

  test('filter toolbar uses replace navigation (no history pollution)', async ({
    page,
    request,
  }) => {
    await loginAsAdmin(page, request);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/u);

    await page.goto('/admin');
    const panel = await waitForExceptionHome(page);

    const emptyState = panel.getByTestId('exception-empty-state');
    if ((await emptyState.count()) > 0) {
      // No exceptions → no filter toolbar; still assert default URL is clean.
      await expect(page).not.toHaveURL(/[?&]exceptions=/u);
      return;
    }

    const toggle = panel.getByTestId('exception-filter-blocking');
    await expect(toggle).toBeVisible();
    await toggle.click();

    await expect(page).toHaveURL(
      /exceptions=blocked%2Cdegraded|exceptions=blocked,degraded/u
    );
    await expect(panel).toHaveAttribute(
      'data-severity-filter',
      'blocked,degraded'
    );

    // Replace: back should leave /admin entirely, not land on unfiltered /admin.
    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard/u);
  });
});
