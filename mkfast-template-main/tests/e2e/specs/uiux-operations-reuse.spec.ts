import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { evidencePath } from '../fixtures/evidence';

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

async function createCreativeWork(page: Page, intent: string) {
  await page.getByLabel('描述这次想创作的内容').fill(intent);
  await page.getByRole('button', { name: '建立创作记录' }).click();
  await expect(
    page.getByLabel(/Agent 创作记录|创作助理整理的记录/u)
  ).toBeVisible();
}

test.describe('S3 operations, reuse, assets, and history', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('keeps one next action and five points in the rail, with full work in canonical tasks', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    const dueAt = new Date(Date.now() + 3_600_000).toISOString();
    await p1Command(page, 'create_task', {
      dueAt,
      executable: false,
      risk: 'attention',
      source: 'asset_gap',
      title: 'S3 补齐猫眼前后对比素材',
    });
    await p1Command(page, 'create_task', {
      dueAt,
      executable: true,
      risk: 'normal',
      source: 'publish_ready',
      title: 'S3 待人工发布内容',
    });

    await page.reload();
    const rail = page.getByRole('complementary', { name: '今日运营' });
    await expect(rail.getByRole('heading', { name: '下一行动' })).toBeVisible();
    await expect(rail.getByText('只显示 1 条')).toBeVisible();
    await expect(
      rail.getByLabel('本周五点态势紧凑周条').locator('li')
    ).toHaveCount(5);
    await expect(rail.getByRole('heading', { name: '异常摘要' })).toBeVisible();

    await rail.getByRole('link', { name: '打开完整任务收件箱' }).click();
    await expect(page).toHaveURL(/\/dashboard\/tasks/);
    await expect(
      page.getByRole('heading', { level: 1, name: '内容任务' })
    ).toBeVisible();
    await expect(page.getByText('S3 补齐猫眼前后对比素材')).toBeVisible();

    await page.getByRole('button', { name: '周批次与回顾' }).click();
    await expect(page).toHaveURL(/mode=week/);
    const batch = await p1Query<{
      included: Array<{ source: string }>;
      excluded: Array<{ source: string; reason: string }>;
    }>(page, 'weekly_batch', {
      from: new Date(Date.now() - 86_400_000).toISOString(),
      to: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });
    expect(batch.included.some((task) => task.source === 'publish_ready')).toBe(
      false
    );
    expect(batch.excluded.some((task) => task.source === 'publish_ready')).toBe(
      true
    );
    await expect(
      page.getByRole('button', { name: '生成只基于事实的周回顾' })
    ).toBeVisible();
  });

  test('uses one catalog, inserts tools without a Job, and persists explicit references', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    const intent = 'S3 同一目录复用与工具执行';
    await createCreativeWork(page, intent);

    const record = page.getByLabel('Agent 创作记录');
    await expect(record).toHaveAttribute('data-job-count', '0');
    await page.getByRole('button', { name: '图片生成', exact: true }).click();
    await expect(
      page.getByText('已插入工具动作，尚未创建任务。', { exact: true })
    ).toBeVisible();
    await expect(record).toHaveAttribute('data-job-count', '0');

    await page.keyboard.press('Meta+K');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page
      .getByPlaceholder('搜索页面、任务、创作记录、执行记录、模板、工具或素材')
      .fill('瑜伽不存在');
    await expect(page.getByText('没有符合条件的命令。')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: '参考解构', exact: true }).click();
    const decomposition = page.getByRole('dialog', {
      name: '参考解构台',
    });
    await expect(decomposition).toBeVisible();
    await decomposition
      .getByRole('button', { name: '我的内容', exact: true })
      .click();
    await decomposition
      .getByRole('button', { name: new RegExp(intent) })
      .click();
    const fields = decomposition.getByRole('checkbox');
    await expect(fields).toHaveCount(5);
    for (let index = 0; index < 5; index += 1) {
      await expect(fields.nth(index)).not.toBeChecked();
    }
    await fields.first().check();
    await decomposition
      .getByRole('button', {
        name: /\u5e26\u5165 1 \u9879\u5e76\u8fd4\u56de\u521b\u4f5c\u8bb0\u5f55/,
      })
      .click();
    await expect(page.getByText('基于上一版调整')).toBeVisible();

    const beforeExecute = await p1Query<{
      jobs: unknown[];
      works: Array<{ sourceReferences: Array<{ kind: string }> }>;
    }>(page, 'creative_workbench');
    expect(beforeExecute.jobs).toHaveLength(0);
    expect(beforeExecute.works.at(-1)?.sourceReferences).toContainEqual(
      expect.objectContaining({ kind: 'work' })
    );

    await page.getByRole('checkbox', { name: /接受本次执行合同/ }).check();
    await page.getByTestId('execute-tool-action').click();
    await expect(record).toHaveAttribute('data-job-count', '1');
    const afterExecute = await p1Query<{ jobs: unknown[] }>(
      page,
      'creative_workbench'
    );
    expect(afterExecute.jobs).toHaveLength(1);

    await page.goto('/dashboard/recent');
    await expect(
      page.getByRole('heading', { level: 1, name: '最近活动' })
    ).toBeVisible();
    await expect(page.getByText(intent).first()).toBeVisible();
    await page.goto('/dashboard/search');
    await page.getByLabel('搜索 canonical 对象').fill(intent);
    await expect(page).toHaveURL(/q=/);
    await page.reload();
    await expect(page.getByLabel('搜索 canonical 对象')).toHaveValue(intent);
    await expect(page.getByText(intent).first()).toBeVisible();
  });

  test('edits, saves, and exports a real light Composer raster with a receipt', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const retiredRuntimeRequests: string[] = [];
    page.on('request', (browserRequest) => {
      if (/polotno/iu.test(browserRequest.url())) {
        retiredRuntimeRequests.push(browserRequest.url());
      }
    });
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await createCreativeWork(page, 'S3 画布 owning route 验证');
    await page.getByRole('button', { name: '展开目录' }).click();
    await page.getByRole('button', { name: '新建空白画布' }).click();
    await expect(page).toHaveURL(/\/dashboard\/works\//);
    await expect(
      page.getByRole('heading', { level: 1, name: '空白图文作品' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: '日常轻编辑' })
    ).toBeVisible({ timeout: 30_000 });
    const workId = decodeURIComponent(
      new URL(page.url()).pathname.split('/').at(-1)!
    );
    const created = await p1Query<{
      currentRevisionId: string;
    }>(page, 'work', { workId });
    await p1Command(page, 'save_canvas_revision', {
      document: {
        height: 1350,
        pages: [
          {
            elements: [
              {
                fill: '#171717',
                fontFamily: 'sans-serif',
                fontSize: 56,
                height: 180,
                id: 'headline',
                kind: 'text',
                rotation: 0,
                text: '初始中文标题',
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
              {
                fill: '#171717',
                fontFamily: 'sans-serif',
                fontSize: 40,
                height: 150,
                id: 'footer',
                kind: 'text',
                rotation: 0,
                text: '预约到店',
                width: 800,
                x: 100,
                y: 1100,
              },
            ],
            id: 'page-runtime-evidence',
          },
        ],
        width: 1080,
      },
      sourceRevisionId: created.currentRevisionId,
      workId,
    });
    await page.reload();

    const copy = page.getByLabel('修改文案').first();
    await expect(copy).toHaveValue('初始中文标题');
    await copy.fill('运行时闭环\n第二行中文');
    await page.getByRole('button', { name: '裁剪 10%' }).click();
    const headlineControls = page
      .locator('code', { hasText: 'headline' })
      .locator('..');
    await headlineControls.getByRole('button', { name: '下移' }).click();

    for (const label of ['品牌水印', 'AIGC 标识']) {
      const toggle = page.getByRole('switch', { name: label });
      if (!(await toggle.isChecked())) await toggle.click();
      await expect(toggle).toBeChecked();
    }

    const saveResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/core/p1/commands') &&
        response.request().postData()?.includes('save_canvas_revision') === true
    );
    await page.getByRole('button', { name: '保存', exact: true }).click();
    expect((await saveResponse).ok()).toBe(true);

    const saved = await p1Query<{
      currentRevisionId: string;
      revisions: Array<{
        document: {
          pages: Array<{
            elements: Array<{
              height: number;
              id: string;
              kind: string;
              text?: string;
              width: number;
            }>;
          }>;
        };
        id: string;
      }>;
    }>(page, 'work', { workId });
    const savedDocument = saved.revisions.find(
      (revision) => revision.id === saved.currentRevisionId
    )!.document;
    expect(
      savedDocument.pages[0]?.elements.map((element) => element.id)
    ).toEqual(['hero', 'headline', 'footer']);
    expect(savedDocument.pages[0]?.elements[1]?.text).toBe(
      '运行时闭环\n第二行中文'
    );
    expect(savedDocument.pages[0]?.elements[0]).toMatchObject({
      height: 520,
      width: 720,
    });

    const workUrl = page.url();
    const combinations = [
      { aigcLabelEnabled: false, brandWatermarkEnabled: false },
      { aigcLabelEnabled: true, brandWatermarkEnabled: false },
      { aigcLabelEnabled: false, brandWatermarkEnabled: true },
      { aigcLabelEnabled: true, brandWatermarkEnabled: true },
    ] as const;
    const matrix: Array<{
      aigcLabelEnabled: boolean;
      brandWatermarkEnabled: boolean;
      bytes: number;
      sha256: string;
    }> = [];
    const setSwitch = async (name: string, enabled: boolean) => {
      const toggle = page.getByRole('switch', { name });
      if ((await toggle.isChecked()) === enabled) return;
      const response = page.waitForResponse(
        (candidate) =>
          candidate.url().includes('/api/core/p1/commands') &&
          candidate.request().postData()?.includes('set_creation_labels') ===
            true
      );
      await toggle.click();
      expect((await response).ok()).toBe(true);
      await expect(toggle).toBeChecked({ checked: enabled });
    };
    for (const [index, combination] of combinations.entries()) {
      await setSwitch('品牌水印', combination.brandWatermarkEnabled);
      await setSwitch('AIGC 标识', combination.aigcLabelEnabled);
      const exportResponse = page.waitForResponse(
        (response) =>
          response.url().includes('/api/core/p1/commands') &&
          response.request().postData()?.includes('export_work') === true
      );
      await page.getByRole('button', { name: '导出', exact: true }).click();
      expect((await exportResponse).ok()).toBe(true);
      const download = page.getByRole('link', {
        name: '下载最近一次可追溯导出',
      });
      await expect(download).toBeVisible();
      const dataUrl = await download.getAttribute('href');
      expect(dataUrl).toMatch(/^data:image\/png;base64,/u);
      const raster = await page.evaluate(async (url) => {
        const bytes = new Uint8Array(await (await fetch(url!)).arrayBuffer());
        const sha256 = [
          ...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
        ]
          .map((value) => value.toString(16).padStart(2, '0'))
          .join('');
        return {
          byteLength: bytes.byteLength,
          magic: [...bytes.slice(0, 8)],
          sha256,
        };
      }, dataUrl);
      expect(raster.magic).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      matrix.push({
        ...combination,
        bytes: raster.byteLength,
        sha256: raster.sha256,
      });
      if (index < combinations.length - 1) {
        await page.goto(workUrl);
      }
    }
    expect(new Set(matrix.map((entry) => entry.sha256)).size).toBe(4);

    const receipts = await p1Query<
      Array<{
        aigcLabelEnabled: boolean;
        brandWatermarkEnabled: boolean;
        bytes: number;
        format: string;
        sha256: string;
        validation: {
          document: {
            cjkLineBreakElementIds: string[];
            fontFamilies: string[];
            imageElementIds: string[];
          };
          raster: { height: number; width: number };
        };
      }>
    >(page, 'export_receipts', { workId });
    for (const entry of matrix) {
      expect(
        receipts.find((receipt) => receipt.sha256 === entry.sha256)
      ).toMatchObject({
        aigcLabelEnabled: entry.aigcLabelEnabled,
        brandWatermarkEnabled: entry.brandWatermarkEnabled,
        bytes: entry.bytes,
        format: 'png',
        sha256: entry.sha256,
        validation: {
          document: {
            cjkLineBreakElementIds: ['headline'],
            fontFamilies: ['sans-serif'],
            imageElementIds: ['hero'],
          },
          raster: { height: 1350, width: 1080 },
        },
      });
    }
    console.info(
      JSON.stringify({
        evidence: 'ticket19-light-composer-compliance-matrix',
        matrix,
      })
    );
    expect(retiredRuntimeRequests).toEqual([]);
    await page.goto(workUrl);
    await expect(
      page.getByRole('heading', { name: '日常轻编辑' })
    ).toBeVisible();
    await page.screenshot({
      fullPage: true,
      path: evidencePath('pro-studio/ticket17-19-light-composer-runtime.png'),
    });
  });
});
