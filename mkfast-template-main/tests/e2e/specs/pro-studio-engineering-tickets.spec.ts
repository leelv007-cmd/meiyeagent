import { expect, test, type Page } from '@playwright/test';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { unlockProStudio } from '../fixtures/pro-studio';

async function p1Command<T>(
  page: Page,
  action: string,
  payload: Record<string, unknown>
) {
  return page.evaluate(
    async ({ action: commandAction, payload: commandPayload }) => {
      const response = await fetch('/api/core/p1/commands', {
        body: JSON.stringify({
          action: commandAction,
          module: 'operations',
          payload: commandPayload,
        }),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `e2e-${commandAction}-${crypto.randomUUID()}`,
        },
        method: 'POST',
      });
      const envelope = (await response.json()) as {
        data?: T;
        error?: { message: string };
      };
      if (!response.ok || !envelope.data) {
        throw new Error(envelope.error?.message ?? `${commandAction} failed`);
      }
      return envelope.data;
    },
    { action, payload }
  );
}

async function p1Query<T>(
  page: Page,
  action: string,
  payload: Record<string, unknown> = {}
) {
  return page.evaluate(
    async ({ action: queryAction, payload: queryPayload }) => {
      const response = await fetch('/api/core/p1/query', {
        body: JSON.stringify({
          action: queryAction,
          module: 'operations',
          payload: queryPayload,
        }),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      const envelope = (await response.json()) as {
        data?: T;
        error?: { message: string };
      };
      if (!response.ok || !envelope.data) {
        throw new Error(envelope.error?.message ?? `${queryAction} failed`);
      }
      return envelope.data;
    },
    { action, payload }
  );
}

async function softCleanupE2EUsers(
  request: Parameters<typeof cleanupE2EUsers>[0]
) {
  try {
    await cleanupE2EUsers(request);
  } catch {
    // Best-effort: a flaky e2e cleanup endpoint must not block ticket evidence.
  }
}

test.describe('Pro Studio engineering tickets 14/16/17/20/23', () => {
  test.beforeAll(async ({ request }) => softCleanupE2EUsers(request));
  test.afterAll(async ({ request }) => softCleanupE2EUsers(request));

  test('ticket 14: unpurchased intro and fixture purchase unlock with evidence screenshot', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await page.goto('/pro-studio');
    await expect(page.getByText('独立加购项')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Owner 立即购买' })
    ).toBeVisible();
    await expect(page.getByRole('link', { name: '查看演示' })).toBeVisible();
    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/pro-studio/ticket14-unpurchased-intro.png',
    });

    await unlockProStudio(page);
    await page.reload();
    await expect(page.getByText('工作区已解锁')).toBeVisible();
    await expect(page.getByRole('button', { name: '一键进入' })).toBeVisible();
    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/pro-studio/ticket14-unlocked-entry.png',
    });
  });

  test('ticket 16: unlocked canvas exposes discoverable prompt seeds', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await page.goto('/pro-studio');
    await unlockProStudio(page);
    await page.reload();
    await page.getByRole('button', { name: '一键进入' }).click();
    const canvasOrigin = `http://localhost:${
      process.env.PLAYWRIGHT_CANVAS_PORT ?? '4200'
    }`;
    await expect(page).toHaveURL(
      (url) => url.origin === canvasOrigin && url.pathname === '/',
      { timeout: 20_000 }
    );
    await expect(page.getByText('美业提示词起点（40 条）')).toBeVisible({
      timeout: 20_000,
    });
    const seedSelect = page.locator('select').filter({
      has: page.locator('option', { hasText: '选择一条产品提供的提示词' }),
    });
    await expect(seedSelect).toBeVisible();
    const options = seedSelect.locator('option');
    // placeholder + 40 seeds
    await expect(options).toHaveCount(41);
    await seedSelect.selectOption({ index: 1 });
    const prompt = page.getByPlaceholder('选择提示词或输入生成指令');
    await expect(prompt).not.toHaveValue('');
    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/pro-studio/ticket16-prompt-seeds.png',
    });
  });

  test('ticket 17/20 gate 1: template edit, raster export, and ContentPackage adoption without Polotno', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const retiredRuntimeRequests: string[] = [];
    page.on('request', (browserRequest) => {
      if (/polotno/iu.test(browserRequest.url())) {
        retiredRuntimeRequests.push(browserRequest.url());
      }
    });
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await page.getByLabel('描述这次想创作的内容').fill('Ticket17 模板闭环');
    await page.getByRole('button', { name: '建立创作记录' }).click();
    await page.getByRole('button', { name: '展开目录' }).click();
    await page.getByRole('button', { name: '新建空白画布' }).click();
    await expect(page).toHaveURL(/\/dashboard\/works\//);
    await expect(
      page.getByRole('heading', { level: 2, name: '日常轻编辑' })
    ).toBeVisible({ timeout: 30_000 });

    const workId = decodeURIComponent(
      new URL(page.url()).pathname.split('/').at(-1)!
    );
    const created = await p1Query<{ currentRevisionId: string }>(page, 'work', {
      workId,
    });
    const document = {
      height: 1350,
      pages: [
        {
          elements: [
            {
              fill: '#171717',
              fontFamily: 'sans-serif',
              fontSize: 48,
              height: 160,
              id: 'headline',
              kind: 'text',
              rotation: 0,
              text: '模板标题',
              width: 800,
              x: 100,
              y: 80,
            },
            {
              assetId: 'fixture-beauty-preview',
              height: 650,
              id: 'hero',
              kind: 'image',
              rotation: 0,
              src: '/model-previews/image-beauty-preview.png',
              width: 900,
              x: 90,
              y: 300,
            },
          ],
          id: 'page-template',
        },
      ],
      width: 1080,
    };
    await p1Command(page, 'save_canvas_revision', {
      document,
      sourceRevisionId: created.currentRevisionId,
      workId,
    });
    const afterSeed = await p1Query<{ currentRevisionId: string }>(
      page,
      'work',
      {
        workId,
      }
    );
    await p1Command(page, 'save_user_template', {
      document,
      name: 'Ticket17 日常模板',
      sourceRevisionId: afterSeed.currentRevisionId,
      workId,
    });

    await page.reload();
    await expect(page.getByLabel('修改文案').first()).toHaveValue('模板标题');
    await page.getByLabel('修改文案').first().fill('模板改写后的标题');
    await page.getByRole('button', { name: '裁剪 10%' }).click();
    await page.getByLabel('上移').last().click();
    const saveResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/core/p1/commands') &&
        response.request().postData()?.includes('save_canvas_revision') === true
    );
    await page.getByRole('button', { name: '保存', exact: true }).click();
    expect((await saveResponsePromise).ok()).toBe(true);

    const saved = await p1Query<{
      currentRevisionId: string;
      revisions: Array<{
        document: {
          pages: Array<{ elements: Array<{ id: string; text?: string }> }>;
        };
        id: string;
      }>;
    }>(page, 'work', { workId });
    const revision = saved.revisions.find(
      (item) => item.id === saved.currentRevisionId
    )!;
    expect(
      revision.document.pages[0]?.elements.find((el) => el.id === 'headline')
        ?.text
    ).toBe('模板改写后的标题');
    const exportResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/core/p1/commands') &&
        response.request().postData()?.includes('export_work') === true
    );
    await page.getByRole('button', { name: '导出', exact: true }).click();
    expect((await exportResponsePromise).ok()).toBe(true);
    await expect(page).toHaveURL(/\/dashboard\/content\?packageId=/, {
      timeout: 30_000,
    });
    const packageId = new URL(page.url()).searchParams.get('packageId');
    expect(packageId).toBeTruthy();
    await expect(
      page.locator(`[data-content-package-id="${packageId}"]`)
    ).toBeVisible({ timeout: 30_000 });
    const adopted = await p1Query<{
      currentVersionId?: string;
      source: {
        layoutCanvas?: {
          exportReceiptId: string;
          workId: string;
          workRevisionId: string;
        };
      };
      status: string;
    }>(page, 'content_package', { packageId });
    expect(adopted.status).toBe('accepted');
    expect(adopted.currentVersionId).toBeTruthy();
    expect(adopted.source.layoutCanvas?.workId).toBe(workId);
    expect(adopted.source.layoutCanvas?.exportReceiptId).toBeTruthy();
    const receipts = await p1Query<
      Array<{ id: string; workRevisionId: string }>
    >(page, 'export_receipts', { workId });
    const adoptedReceipt = receipts.find(
      (receipt) => receipt.id === adopted.source.layoutCanvas?.exportReceiptId
    );
    expect(adoptedReceipt?.workRevisionId).toBe(
      adopted.source.layoutCanvas?.workRevisionId
    );
    expect(retiredRuntimeRequests).toEqual([]);
    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/pro-studio/ticket20-layout-adopted-package.png',
    });
  });

  test('ticket 20: daily creation entry routes never load Polotno', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const polotnoHits: string[] = [];
    page.on('request', (browserRequest) => {
      if (/polotno/iu.test(browserRequest.url())) {
        polotnoHits.push(browserRequest.url());
      }
    });
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    // Blank canvas entry
    await page.getByLabel('描述这次想创作的内容').fill('Ticket20 入口矩阵');
    await page.getByRole('button', { name: '建立创作记录' }).click();
    await page.getByRole('button', { name: '展开目录' }).click();
    await page.getByRole('button', { name: '新建空白画布' }).click();
    await expect(
      page.getByRole('heading', { level: 2, name: '日常轻编辑' })
    ).toBeVisible({ timeout: 30_000 });
    const workUrl = page.url();
    expect(workUrl).toMatch(/\/dashboard\/works\//);

    // Deep link / history detail re-entry
    await page.goto('/dashboard/recent');
    await page.goto(workUrl);
    await expect(
      page.getByRole('heading', { level: 2, name: '日常轻编辑' })
    ).toBeVisible({ timeout: 30_000 });

    // Works list entry
    await page.goto('/dashboard/works');
    await expect(page).toHaveURL(/\/dashboard\/works/);

    expect(polotnoHits).toEqual([]);
  });

  test('ticket 23: authorized admin can diagnose merchant quota without DB access', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const admin = await registerE2EUser(request, { role: 'admin' });
    await loginByForm(page, admin);
    await page.goto('/admin/audit');
    // CardTitle may not map to heading role; assert visible copy instead.
    await expect(page.getByText('商户任务与额度诊断')).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByText(
        '授权客服可直接查看当前商户的任务、额度、失败原因与退回量，无需进入数据库。'
      )
    ).toBeVisible();
    await expect(page.getByText('额度解释')).toBeVisible();
    // Four-factor table headers: 预计 / 实际 / 原因 / 失败退回
    await expect(
      page.getByRole('columnheader', { name: '预计花费' }).first()
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: '实际花费' }).first()
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: '原因' }).first()
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: '失败退回' }).first()
    ).toBeVisible();
    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/pro-studio/ticket23-merchant-support.png',
    });
  });
});
