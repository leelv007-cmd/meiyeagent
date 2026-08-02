import { expect, test } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

test.describe('live creation catalog capability gate', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('server catalog hides ordinary tools without a verified execution chain', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    const catalogCalls: string[] = [];
    page.on('request', (outgoing) => {
      if (!outgoing.url().includes('/api/core/p1/query')) return;
      const body = outgoing.postDataJSON() as {
        module?: string;
        action?: string;
      };
      if (body.module === 'creation-experience' && body.action) {
        catalogCalls.push(body.action);
      }
    });

    await page.goto('/dashboard/catalog');
    await expect(page.getByText('朋友圈项目介绍')).toBeVisible();
    await expect
      .poll(() => ({
        surface: catalogCalls.includes('surface_browser'),
        tools: catalogCalls.includes('tool_list'),
      }))
      .toEqual({ surface: true, tools: true });

    await page.getByText('朋友圈项目介绍').click();
    await expect(page).toHaveURL(
      /catalogRecipeRevisionId=recipe\.project_intro/
    );
    // L3-2: radiogroup lives in the lens capsule panel. Catalog apply still
    // selects copy; open the panel to assert radio state, then face echo.
    await page.getByTestId('composer-capsule-lens').click();
    await expect(page.getByTestId('composer-capsule-lens-panel')).toBeVisible();
    // The lens options are native radios (`lens-radiogroup.tsx`), so selection
    // is the `checked` property plus `data-state` — not an `aria-checked`
    // attribute, which a native radio does not need and does not carry. Same
    // idiom the shared journey fixture uses.
    const copyLens = page.getByTestId('composer-lens-option-copy');
    await expect(copyLens).toBeChecked();
    await expect(copyLens).toHaveAttribute('data-state', 'checked');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('composer-capsule-lens-panel')).toBeHidden();
    await expect(page.getByTestId('composer-capsule-lens')).toContainText(
      '文案'
    );

    await page.goto('/dashboard/catalog?tab=tools');
    await expect(page.getByText('多尺寸适配', { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /Pro Studio/u })
    ).toBeVisible();
    await expect(page.getByTestId('composer-catalog-empty')).toHaveCount(0);

    await page.goto('/dashboard/tools/tool.multi_size');
    await expect(page.getByRole('alert')).toContainText('该创作工具不可用');
    await expect(page.getByTestId('ordinary-tool-page')).toHaveCount(0);
  });
});
