import { expect, test } from '@playwright/test';
import type { ApiEnvelope, ProductState } from '@meiye/contracts';
import postgres from 'postgres';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

const PNG_FIXTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

for (const viewport of [
  { width: 320, height: 720 },
  { width: 360, height: 800 },
  { width: 379, height: 820 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 844, height: 390 },
]) {
  test.describe(`mobile action book ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true });

    test('renders the unified mobile creation surface without overflow', async ({
      page,
      request,
    }) => {
      const user = await registerE2EUser(request);
      try {
        await loginByForm(page, user);
        await expect(
          page.getByRole('heading', { name: '掌心行动簿' })
        ).toBeVisible();
        await expect(
          page.getByRole('tablist', { name: '掌心行动簿阶段' })
        ).toBeVisible();
        for (const stage of ['行动', '进度', '交接']) {
          await expect(page.getByRole('tab', { name: stage })).toBeVisible();
        }
        await expect(page.getByLabel('描述这次想创作的内容')).toBeVisible();
        await expect(
          page.getByRole('navigation', { name: '移动端导航' })
        ).toBeVisible();
        expect(
          await page.evaluate(() => ({
            client: document.documentElement.clientWidth,
            scroll: document.documentElement.scrollWidth,
          }))
        ).toEqual({ client: viewport.width, scroll: viewport.width });
        const actionHeights = await page
          .getByRole('tablist', { name: '掌心行动簿阶段' })
          .getByRole('tab')
          .evaluateAll((elements) =>
            elements.map((element) => element.getBoundingClientRect().height)
          );
        expect(actionHeights.every((height) => height >= 48)).toBe(true);
        const mobileNavHeights = await page
          .getByRole('navigation', { name: '移动端导航' })
          .locator(':scope > a, :scope > button')
          .evaluateAll((elements) =>
            elements.map((element) => element.getBoundingClientRect().height)
          );
        expect(mobileNavHeights).toHaveLength(5);
        expect(mobileNavHeights.every((height) => height >= 48)).toBe(true);
        for (const label of ['拍摄素材', '从相册 / 文件选择']) {
          const bounds = await page
            .getByText(label, { exact: true })
            .evaluate((element) => element.getBoundingClientRect().height);
          expect(bounds).toBeGreaterThanOrEqual(48);
        }
        const typography = await page.evaluate(() => {
          const productShell = document.querySelector('.meiye-product-shell');
          if (!productShell) throw new Error('Product shell not found');
          return {
            bodyFontSize: getComputedStyle(document.body).fontSize,
            rootFontSize: getComputedStyle(document.documentElement).fontSize,
            shellFontFamily: getComputedStyle(productShell).fontFamily,
          };
        });
        expect(typography.rootFontSize).toBe('18px');
        expect(typography.bodyFontSize).toBe('18px');
        expect(typography.shellFontFamily).toContain('HarmonyOS Sans');
        expect(typography.shellFontFamily).toContain('MiSans');
      } finally {
        await cleanupE2EUsers(request);
      }
    });
  });
}

test.describe('mobile upload and relay', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test('resumes one stable upload after the persisted response is lost', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const user = await registerE2EUser(request);
    const sql = postgres(
      process.env.DATABASE_URL ??
        'postgres://meiye:meiye@127.0.0.1:54329/meiye',
      { max: 1 }
    );
    try {
      await loginByForm(page, user);
      await expect(
        page.getByText('从相册 / 文件选择', { exact: true })
      ).toBeVisible();
      let dropped = false;
      await page.route('**/*', async (route) => {
        const requestData = route.request().postDataBuffer();
        if (
          !dropped &&
          route.request().method() === 'POST' &&
          requestData?.toString('utf8').includes('mobile-resume.png')
        ) {
          await route.fetch();
          dropped = true;
          await route.abort('failed');
          return;
        }
        await route.continue();
      });

      const file = {
        name: 'mobile-resume.png',
        mimeType: 'image/png',
        buffer: PNG_FIXTURE,
      };
      await page.locator('#mobile-library-input').setInputFiles(file);
      await expect(page.getByText('上传中断', { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText(/^Asset /)).toHaveCount(0);
      await page.unroute('**/*');

      await page.locator('#mobile-library-input').setInputFiles(file);
      await expect(page.getByText('已持久化', { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        page.getByText('已保存到素材库', { exact: true })
      ).toBeVisible();
      const state = await page.evaluate(async () => {
        const response = await fetch('/api/core/product/state');
        const envelope = (await response.json()) as ApiEnvelope<ProductState>;
        if ('error' in envelope) throw new Error(envelope.error.message);
        return envelope.data;
      });
      expect(
        state.assets.filter((asset) => asset.id.startsWith('asset-mobile-'))
      ).toHaveLength(1);
      const [row] = await sql<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count
        FROM user_files files
        INNER JOIN "user" users ON users.id = files.user_id
        WHERE users.email = ${user.email}
          AND files.description LIKE 'mobile-upload:%'
      `;
      expect(row?.count).toBe(1);

      await page.reload();
      await expect(
        page.getByText('已保存到素材库', { exact: true })
      ).toBeVisible();
    } finally {
      await sql.end();
      await cleanupE2EUsers(request);
    }
  });

  test('uses desktop relay for settings and admin mobile deep links', async ({
    page,
    request,
  }) => {
    const admin = await registerE2EUser(request, { role: 'admin' });
    try {
      await loginByForm(page, admin);
      await page.goto('/settings/models?section=byok');
      await expect(
        page.getByRole('heading', { name: '完整设置请在桌面继续' })
      ).toBeVisible();
      await expect(page.getByText('模型偏好', { exact: true })).toHaveCount(0);
      await expect(
        page.getByRole('link', { name: '安全返回掌心行动簿' })
      ).toHaveAttribute('href', '/dashboard');

      await page.goto('/admin/models');
      await expect(
        page.getByRole('heading', { name: '管理后台请在桌面继续' })
      ).toBeVisible();
      await expect(page.getByText('管理员渠道控制面')).toHaveCount(0);
    } finally {
      await cleanupE2EUsers(request);
    }
  });
});

test.describe('desktop secondary surfaces', () => {
  test.use({ viewport: { width: 1365, height: 900 } });

  test('separates user models, BYOK, external connections, and six real admin routes', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const admin = await registerE2EUser(request, { role: 'admin' });
    try {
      await loginByForm(page, admin);
      await page.goto('/settings/models');
      await expect(
        page.getByRole('heading', { name: '模型偏好' })
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { name: '工作区 BYOK' })
      ).toBeVisible();
      await expect(
        page.getByText('BYOK 模型凭据', { exact: true }).first()
      ).toBeVisible();
      await expect(page.getByText('抖音连接', { exact: true })).toHaveCount(0);

      await page.goto('/settings/connections');
      await expect(page.getByRole('tab', { name: '抖音连接' })).toBeVisible();
      await expect(page.getByRole('tab', { name: '飞书 MCP' })).toBeVisible();
      await expect(
        page.getByText('BYOK 模型凭据', { exact: true })
      ).toHaveCount(0);

      const routes: Array<[string, string]> = [
        ['/admin/models', '管理员渠道控制面'],
        ['/admin/templates', '创建官方模板'],
        ['/admin/integrations', '目录由后台统一更新'],
        ['/admin/plans', '动作级权益目录'],
        ['/admin/users', '用户管理'],
        ['/admin/audit', '高影响操作审计'],
      ];
      for (const [path, text] of routes) {
        await page.goto(path);
        await expect(
          page.getByText(text, { exact: false }).first()
        ).toBeVisible();
      }

      await page.goto('/admin/models');
      await page.getByLabel('Revision ID').fill('revision-impact-review');
      await page.getByRole('button', { name: '发布 enabled revision' }).click();
      await expect(
        page.getByRole('dialog').getByText('发布模型目录 revision')
      ).toBeVisible();
      await expect(page.getByText('影响范围')).toBeVisible();
      await expect(page.getByText('变更摘要')).toBeVisible();
      await expect(page.getByLabel('执行原因（写入审计）')).toBeVisible();
    } finally {
      await cleanupE2EUsers(request);
    }
  });

  test('shows the fixture-local admin activation canary evidence seam', async ({
    page,
    request,
  }) => {
    const admin = await registerE2EUser(request, { role: 'admin' });
    try {
      await loginByForm(page, admin);
      await page.goto('/admin/models');
      await expect(
        page.getByText('配置 → 脱敏沙箱 → 非计费金丝雀 → 证据', {
          exact: true,
        })
      ).toBeVisible();
      await expect(
        page.getByRole('columnheader', { name: '供应成本证据' })
      ).toBeVisible();
      await expect(
        page.getByRole('columnheader', { name: '证据详情' })
      ).toBeVisible();
      for (const operation of [
        'copy.generate',
        'copy.adapt',
        'text.respond',
        'image.generate',
        'image.edit',
        'video.generate',
      ]) {
        await expect(
          page
            .getByRole('button', {
              name: `运行真实探针 · ${operation}`,
            })
            .first()
        ).toBeVisible();
      }
    } finally {
      await cleanupE2EUsers(request);
    }
  });

  test('expresses public plans and account usage only as deliverable output', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    try {
      await page.goto('/pricing');
      await expect(
        page.getByRole('heading', { name: '每个账期可交付产出' })
      ).toBeVisible();
      for (const label of ['文案', '图片', '视频', '并发任务']) {
        await expect(
          page.getByText(label, { exact: true }).first()
        ).toBeVisible();
      }
      const pricingText = (
        await page.locator('main').innerText()
      ).toLowerCase();
      expect(pricingText).not.toMatch(/\bcredit(s)?\b|\btoken(s)?\b|积分/);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth)
      ).toBeLessThanOrEqual(1365);

      await loginByForm(page, user);
      await page.goto('/settings/account?section=usage');
      for (const label of ['可用', '预留', '已结算', '已释放', '本期到期']) {
        await expect(
          page.getByText(label, { exact: false }).first()
        ).toBeVisible();
      }
      const accountText = (
        await page.locator('main').innerText()
      ).toLowerCase();
      expect(accountText).not.toMatch(/\bcredit(s)?\b|\btoken(s)?\b|积分/);
    } finally {
      await cleanupE2EUsers(request);
    }
  });
});
