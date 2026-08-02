import { expect, test } from '@playwright/test';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { productState } from '../fixtures/product';

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
  test.describe(`mobile Composer ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true });

    test('keeps the Composer and five-slot navigation usable without overflow', async ({
      page,
      request,
    }) => {
      const user = await registerE2EUser(request);
      try {
        await loginByForm(page, user);
        await expect(page.getByTestId('composer-home')).toBeVisible();
        // L3-2: lens radiogroup is inside the capsule popover; cold mobile still
        // exposes the required lens capsule trigger on the prompt bar.
        await expect(page.getByTestId('composer-capsule-lens')).toBeVisible();
        await expect(page.getByTestId('composer-capsule-lens')).toHaveAttribute(
          'aria-required',
          'true'
        );
        await expect(page.getByTestId('composer-intent-input')).toBeVisible();
        const mobileNav = page.getByRole('navigation', { name: '移动端导航' });
        await expect(mobileNav).toBeVisible();
        const mobileNavHeights = await mobileNav
          .locator(':scope > a, :scope > button')
          .evaluateAll((elements) =>
            elements.map((element) => element.getBoundingClientRect().height)
          );
        expect(mobileNavHeights).toHaveLength(5);
        expect(mobileNavHeights.every((height) => height >= 44)).toBe(true);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth
          )
        ).toBeLessThanOrEqual(1);
        const typography = await page.evaluate(() => {
          const productShell = document.querySelector('.meiye-product-shell');
          if (!productShell) throw new Error('Product shell not found');
          return {
            bodyFontSize: getComputedStyle(document.body).fontSize,
            rootFontSize: getComputedStyle(document.documentElement).fontSize,
            shellFontFamily: getComputedStyle(productShell).fontFamily,
          };
        });
        expect(typography.rootFontSize).toBe('16px');
        expect(typography.bodyFontSize).toBe('16px');
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

  test('retries a Composer upload without creating a duplicate source', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const user = await registerE2EUser(request);
    try {
      await loginByForm(page, user);
      const before = await productState(page);
      let dropped = false;
      await page.route(
        '**/api/storage/upload?purpose=product_asset',
        async (route) => {
          if (
            !dropped &&
            route.request().method() === 'POST' &&
            route
              .request()
              .postDataBuffer()
              ?.toString('utf8')
              .includes('mobile-resume.png')
          ) {
            dropped = true;
            await route.fulfill({
              body: JSON.stringify({ error: 'transient fixture failure' }),
              contentType: 'application/json',
              status: 503,
            });
            return;
          }
          await route.continue();
        }
      );

      const file = {
        name: 'mobile-resume.png',
        mimeType: 'image/png',
        buffer: PNG_FIXTURE,
      };
      await page.locator('#composer-gallery-input').setInputFiles(file);
      await page.getByRole('button', { name: /确认：允许公开宣传/ }).click();
      await expect(page.getByText('图片上传失败，请重试。')).toBeVisible({
        timeout: 30_000,
      });
      await page.unroute('**/api/storage/upload?purpose=product_asset');
      await page.getByRole('button', { name: '重试', exact: true }).click();
      await expect(
        page.getByText('已保存到素材库', { exact: true })
      ).toBeVisible({ timeout: 60_000 });
      const after = await productState(page);
      expect(after.assets).toHaveLength(before.assets.length + 1);
    } finally {
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
        page.getByText('高级连接设置', { exact: true })
      ).toBeVisible();
      await page.getByText('高级连接设置', { exact: true }).click();
      await expect(
        page.getByRole('tab', { name: '使用自己的模型密钥' })
      ).toBeVisible();
      await expect(page.getByText('抖音连接', { exact: true })).toHaveCount(0);

      await page.goto('/settings/connections');
      await expect(page.getByRole('tab', { name: '飞书连接' })).toBeVisible();
      await expect(page.getByRole('tab', { name: '抖音连接' })).toHaveCount(0);
      await expect(
        page.getByRole('tab', { name: '使用自己的模型密钥' })
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

  test('keeps unpublished credit pricing off the public plans', async ({
    page,
  }) => {
    await page.goto('/pricing');
    await expect(
      page.getByRole('heading', { name: '每个账期可交付产出' })
    ).toBeVisible();
    await expect(
      page.getByText('可同时进行的创作数', { exact: true }).first()
    ).toBeVisible();
    for (const label of ['文案', '图片', '视频']) {
      await expect(page.getByText(label, { exact: true })).toHaveCount(0);
    }
    for (const [tier, credits] of [
      ['starter', '500'],
      ['growth', '1300'],
      ['pro', '2800'],
    ] as const) {
      await expect(
        page.getByTestId(`pricing-plan-quota-${tier}`)
      ).not.toContainText(credits);
    }
    const pricingText = (await page.locator('main').innerText()).toLowerCase();
    expect(pricingText).not.toMatch(/\bcredit(s)?\b|\btoken(s)?\b|积分/);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(1365);
  });

  test('expresses account usage only as deliverable output', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    try {
      await loginByForm(page, user);
      await page.goto('/settings/account?section=usage');
      await page.getByTestId('account-usage-details-toggle').click();
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
