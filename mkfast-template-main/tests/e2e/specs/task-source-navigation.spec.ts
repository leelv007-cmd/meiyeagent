import { expect, test } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import {
  productCommand,
  seedAcceptedProductContent,
} from '../fixtures/product';

test.describe('task source navigation', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('opens content, asset, and publication source objects without cross-workspace search', async ({
    page,
    request,
  }) => {
    // T34 / #228 — 显式降级 (ADR-0019 测试纪律 8). Every link this exercises started
    // on the 旧任务收件箱, which retired with no successor: 待办 moved to the
    // pending-actions inbox, which reads a different projection and renders no
    // source-object links. Re-homing the cross-workspace guarantee onto the new
    // inbox needs a journey decision, so this is parked rather than rewritten —
    // T38 takes it with the rest of the old task IA.
    test.skip(
      true,
      'T34/#228: 旧任务收件箱路由下线，来源对象链接无替代面；随 T38 删除批处置'
    );
    test.setTimeout(90_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    const { assetId, contentId } = await seedAcceptedProductContent(
      page,
      'source-navigation'
    );
    const packaged = await productCommand(page, {
      type: 'create_handoff',
      contentId,
      platform: 'xiaohongshu',
    });
    const handoffId = packaged.output.packageId;
    if (!handoffId) throw new Error('Product handoff was not created');
    const sourceIds = { assetId, contentId, handoffId };

    await page.evaluate(async (ids) => {
      const dueAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const tasks = [
        {
          dedupeKey: `e2e-source-content-${ids.contentId}`,
          relatedObject: { id: ids.contentId, kind: 'content' },
          source: 'manual',
          title: '来源内容任务',
        },
        {
          dedupeKey: `e2e-source-asset-${ids.assetId}`,
          relatedObject: { id: ids.assetId, kind: 'asset' },
          source: 'manual',
          title: '来源素材任务',
        },
        {
          dedupeKey: `e2e-source-publication-${ids.handoffId}`,
          relatedObject: { id: ids.handoffId, kind: 'publication' },
          source: 'publish_ready',
          title: '来源发布任务',
        },
      ];
      for (const task of tasks) {
        const response = await fetch('/api/core/p1/commands', {
          body: JSON.stringify({
            action: 'create_task',
            module: 'operations',
            payload: {
              ...task,
              dueAt,
              executable: true,
              risk: 'normal',
              source: task.source,
            },
          }),
          headers: {
            'content-type': 'application/json',
            'idempotency-key': task.dedupeKey,
          },
          method: 'POST',
        });
        if (!response.ok) throw new Error(await response.text());
      }
    }, sourceIds);

    await page.goto('/dashboard/tasks');
    const contentTask = page
      .getByRole('heading', { name: '来源内容任务' })
      .locator('xpath=ancestor::li');
    const contentLink = contentTask.getByRole('link', { name: '查看来源' });
    await expect(contentLink).toHaveAttribute(
      'href',
      `/dashboard/content?contentId=${encodeURIComponent(sourceIds.contentId)}`
    );
    await contentLink.click();
    await expect(page).toHaveURL(/\/dashboard\/content\?contentId=/);
    await expect(page.locator('[data-source-highlight="true"]')).toHaveCount(1);

    await page.goto('/dashboard/content?contentId=foreign-workspace-content');
    await expect(page.getByText('找不到来源内容')).toBeVisible();
    await expect(page.locator('[data-source-highlight="true"]')).toHaveCount(0);

    await page.goto('/dashboard/tasks');
    const assetTask = page
      .getByRole('heading', { name: '来源素材任务' })
      .locator('xpath=ancestor::li');
    const assetLink = assetTask.getByRole('link', { name: '查看来源' });
    await expect(assetLink).toHaveAttribute(
      'href',
      `/dashboard/assets/${encodeURIComponent(sourceIds.assetId)}`
    );
    await assetLink.click();
    await expect(page).toHaveURL(/\/dashboard\/assets\//);
    await expect(page.locator('[data-source-highlight="true"]')).toHaveCount(1);

    await page.goto('/dashboard/assets/foreign-workspace-asset');
    await expect(page.getByText('找不到这个 Asset')).toBeVisible();
    await expect(page.locator('[data-source-highlight="true"]')).toHaveCount(0);

    await page.goto('/dashboard/tasks');
    const publicationTask = page
      .getByRole('heading', { name: '来源发布任务' })
      .locator('xpath=ancestor::li');
    const publicationLink = publicationTask.getByRole('link', {
      name: '查看来源',
    });
    await expect(publicationLink).toHaveAttribute(
      'href',
      `/dashboard/content?handoffId=${encodeURIComponent(sourceIds.handoffId)}`
    );
    await publicationLink.click();
    await expect(page).toHaveURL(/\/dashboard\/content\?handoffId=/);
    await expect(
      page.getByRole('heading', { name: 'L3 发布包' })
    ).toBeVisible();
    await expect(
      page.locator('[data-source-highlight="true"]')
    ).not.toHaveCount(0);

    await page.goto('/dashboard/content?handoffId=foreign-workspace-handoff');
    await expect(page.getByText('找不到来源发布包')).toBeVisible();
  });
});
