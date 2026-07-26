import { expect, test } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import {
  productCommand,
  productState,
  seedAcceptedProductContent,
} from '../fixtures/product';

test.describe('canonical product golden journey', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('hands off accepted content, records exports separately, and links a lead', async ({
    context,
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    const { contentId } = await seedAcceptedProductContent(
      page,
      'golden-journey'
    );
    const packaged = await productCommand(page, {
      type: 'create_handoff',
      contentId,
      platform: 'xiaohongshu',
    });
    const packageId = packaged.output.packageId;
    const handoffToken = packaged.output.handoffToken;
    expect(packageId).toBeTruthy();
    expect(handoffToken).toBeTruthy();

    // T34 / #228: the 旧内容库 hosted a 发布包 card whose only job was to open
    // the handoff page. The library retired; the handoff page is the same page
    // it always was, so the journey addresses it directly.
    await page.goto(`/dashboard/handoff/${encodeURIComponent(handoffToken!)}`);
    await expect(
      page.getByRole('heading', { name: /小红书\s*发布包/ })
    ).toBeVisible();

    await page.getByRole('button', { name: '复制' }).first().click();
    await expect(page.getByText('已复制，可切换到平台粘贴。')).toBeVisible();
    await expect
      .poll(async () => {
        const state = await productState(page);
        return state.handoffPackages
          .find((handoff) => handoff.id === packageId)
          ?.exportEvents.map((event) => event.type);
      })
      .toContain('copied');
    let state = await productState(page);
    expect(
      state.handoffPackages.find((handoff) => handoff.id === packageId)?.status
    ).toBe('ready');
    expect(
      state.contents.find((content) => content.id === contentId)?.status
    ).toBe('draft');

    await page
      .getByLabel('结果备注（可选）')
      .fill('平台草稿尚未完成，稍后继续');
    await page.getByRole('button', { name: '暂未发布', exact: true }).click();
    await expect(
      page.getByText('已记录暂未发布，发布包仍保持待处理。')
    ).toBeVisible();
    state = await productState(page);
    const pendingHandoff = state.handoffPackages.find(
      (handoff) => handoff.id === packageId
    );
    expect(pendingHandoff?.status).toBe('ready');
    expect(pendingHandoff?.manualReports.at(-1)?.outcome).toBe('not_published');

    await page
      .getByLabel('平台帖子链接（可选）')
      .fill('https://example.test/posts/e2e-golden');
    await page.getByRole('button', { name: '已发布', exact: true }).click();
    await expect(page.getByText('已记录人工发布结果。')).toBeVisible();
    state = await productState(page);
    expect(
      state.handoffPackages.find((handoff) => handoff.id === packageId)?.status
    ).toBe('published');
    expect(
      state.contents.find((content) => content.id === contentId)?.status
    ).toBe('published');

    await page.goto('/dashboard/leads');
    // Labels below are the shipped Paraglide values; the two this spec used to
    // name ('意向金额（可选）' / '最小备注') were renamed before T33 and never
    // re-synced here, so this step could not pass on the baseline either.
    await page.getByLabel('预计成交金额（可选）').fill('299');
    await page
      .getByLabel('客户备注')
      .fill('顾客从私信询问同款，人工关联用于复盘');
    await page.getByRole('button', { name: '记录私信线索' }).click();
    await expect(page.getByText('顾客从私信询问同款')).toBeVisible();
    // T33 / #227: the ledger reshelled onto HeroUI Pro V3, so the follow-up
    // control is a listbox rather than a native <select>. Same capability.
    // Behaviour lives in leads.interaction.test.tsx — this journey cannot reach
    // the ledger while its content seed is closed.
    const statusPicker = page.getByRole('button', { name: /更新线索状态/u });
    await statusPicker.click();
    await page.getByRole('option', { name: '已联系' }).click();
    await expect(statusPicker).toHaveText('已联系');
    await expect(page.getByText(/不表示自动或因果归因/)).toBeVisible();
  });
});
