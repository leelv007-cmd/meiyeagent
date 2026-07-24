import { expect, test } from '@playwright/test';
import {
  expectHealthyPage,
  installPageHealthMonitor,
  setTheme,
} from '../fixtures/page-health';

const SECTION_ANCHORS = ['#features', '#showcase', '#pricing', '#faq'] as const;

const ALLOWED_HREF = new RegExp(
  [
    '^#',
    '^/$',
    '^/auth/register$',
    '^/auth/login$',
    '^/pricing$',
    '^/contact$',
    '^/terms$',
    '^/privacy$',
    '^/cookie$',
  ].join('|')
);

test.describe('LIKEPAGE marketing landing page', () => {
  test('landing sections render in order', async ({ page }) => {
    const monitor = installPageHealthMonitor(page);
    await expectHealthyPage(page, monitor, '/', { theme: 'light' });

    await expect(page.getByRole('heading', { level: 1 })).toContainText('美页');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('丽客');

    const anchorOffsets: number[] = [];
    for (const anchor of SECTION_ANCHORS) {
      const section = page.locator(anchor);
      await expect(section).toHaveCount(1);
      const box = await section.evaluate(
        (el) => el.getBoundingClientRect().top + window.scrollY
      );
      anchorOffsets.push(box);
    }
    const sorted = [...anchorOffsets].sort((a, b) => a - b);
    expect(anchorOffsets).toEqual(sorted);
    monitor.expectNoErrors('landing sections');
  });

  test('nav anchors scroll to their sections', async ({ page }) => {
    const monitor = installPageHealthMonitor(page);
    await expectHealthyPage(page, monitor, '/', { theme: 'light' });
    await page.waitForLoadState('networkidle');

    const navLabels: Array<{ label: string; anchor: string }> = [
      { label: '功能', anchor: '#features' },
      { label: '作品', anchor: '#showcase' },
      { label: '定价', anchor: '#pricing' },
      { label: '常见问题', anchor: '#faq' },
    ];

    for (const { label, anchor } of navLabels) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(400);
      await page
        .getByRole('navigation', { name: '主导航' })
        .getByRole('link', { name: label })
        .click();
      await page.waitForTimeout(1500);
      const inView = await page.locator(anchor).evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return rect.top < window.innerHeight && rect.bottom > 0;
      });
      expect(
        inView,
        `${anchor} should be in view after clicking ${label}`
      ).toBe(true);
    }
    monitor.expectNoErrors('nav anchors');
  });

  test('pricing tiers speak the pilot contract without a purchase promise', async ({
    page,
  }) => {
    const monitor = installPageHealthMonitor(page);
    await expectHealthyPage(page, monitor, '/', { theme: 'light' });

    const pricing = page.locator('#pricing');
    await pricing.scrollIntoViewIfNeeded();
    await expect(pricing).toContainText('Starter');
    await expect(pricing).toContainText('免费');
    await expect(pricing).toContainText('Growth');
    await expect(pricing).toContainText('¥399');
    await expect(pricing).toContainText('推荐');
    await expect(pricing).toContainText('未开放');

    // D-124: the pilot ships zero payment, so the page may not run a promo and
    // may not imply a tier can be bought. Activation is the redemption code.
    const pricingText = (await pricing.innerText()).replace(/\s+/g, '');
    expect(pricingText).not.toContain('上线特惠');
    expect(pricingText).not.toContain('敬请期待');
    expect(pricingText).not.toMatch(/立即(购买|订阅|升级)/);
    expect(pricingText).toContain('兑换码');
    // The paid tier's CTA no longer speaks in upgrade/subscribe verbs.
    const paidCta = pricing.locator('a[href="/auth/register"]').last();
    await expect(paidCta).toContainText('兑换码');
    await expect(paidCta).not.toContainText('升级');

    const registerLinks = pricing.locator('a[href="/auth/register"]');
    expect(await registerLinks.count()).toBeGreaterThanOrEqual(2);

    const lifetime = pricing.locator('[aria-disabled="true"]');
    await expect(lifetime.first()).toBeVisible();
    expect(
      await lifetime.first().evaluate((el) => el.closest('a') === null)
    ).toBe(true);
    monitor.expectNoErrors('pricing tiers');
  });

  test('rendered copy claims only capability the delivery gate grants', async ({
    page,
  }) => {
    const monitor = installPageHealthMonitor(page);
    await expectHealthyPage(page, monitor, '/', { theme: 'light' });

    const body = (await page.locator('body').innerText()).replace(/\s+/g, '');

    // publish:<platform> has never passed the gate (automatic_verified = 0).
    for (const claim of ['一键发布', '自动发布', '直接发布', '替你发布']) {
      expect(body, `dishonest claim: ${claim}`).not.toContain(claim);
    }
    // Four output kinds (D-118) and the three locked variant platforms (D-128).
    for (const fact of [
      '文案',
      '图片',
      '图文笔记',
      '视频',
      '小红书',
      '抖音',
      '微信视频号',
    ]) {
      expect(body, `missing capability fact: ${fact}`).toContain(fact);
    }
    // The real delivery route the merchant walks today.
    expect(body).toContain('辅助交接');
    expect(body).toContain('兑换码');
    monitor.expectNoErrors('capability copy');
  });

  test('every live CTA stays inside the allowed destinations', async ({
    page,
  }) => {
    const monitor = installPageHealthMonitor(page);
    await expectHealthyPage(page, monitor, '/', { theme: 'light' });

    const hrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]'), (a) =>
        a.getAttribute('href')
      )
    );
    expect(hrefs.length).toBeGreaterThan(10);
    for (const href of hrefs) {
      expect(href, `unexpected href ${href}`).toMatch(ALLOWED_HREF);
      // A placeholder anchor is a dead link, not an allowed destination.
      expect(href, 'placeholder "#" link').not.toBe('#');
    }

    // Every in-page anchor must land on a section that exists in the DOM.
    const anchors = [...new Set(hrefs.filter((href) => href?.startsWith('#')))];
    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of anchors) {
      await expect(
        page.locator(anchor as string),
        `dead anchor ${anchor}`
      ).toHaveCount(1);
    }

    // Every internal route link must resolve — no retired-IA destinations.
    const routes = [...new Set(hrefs.filter((href) => href?.startsWith('/')))];
    for (const route of routes) {
      const response = await page.request.get(route as string);
      expect(response.status(), `dead link ${route}`).toBeLessThan(400);
    }
    monitor.expectNoErrors('cta allowlist');
  });

  test('mobile viewport keeps every section and avoids sideways scroll', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const monitor = installPageHealthMonitor(page);
    await expectHealthyPage(page, monitor, '/', { theme: 'light' });

    for (const anchor of SECTION_ANCHORS) {
      await expect(page.locator(anchor)).toHaveCount(1);
    }
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
    );
    expect(
      overflow,
      'landing must not scroll sideways on mobile'
    ).toBeLessThanOrEqual(1);
    monitor.expectNoErrors('mobile landing');
  });

  test('bottom form invites registration', async ({ page }) => {
    const monitor = installPageHealthMonitor(page);
    await expectHealthyPage(page, monitor, '/', { theme: 'light' });
    await page.waitForLoadState('networkidle');

    const form = page.locator('form').last();
    await form.scrollIntoViewIfNeeded();
    await form.locator('input[type="email"]').fill('e2e-owner@example.test');
    await form.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/auth\/register/);
    monitor.expectNoErrors('bottom form register');
  });

  test('theme toggle flips the landing skin', async ({ page }) => {
    await setTheme(page, 'light');
    const monitor = installPageHealthMonitor(page);
    await expectHealthyPage(page, monitor, '/', { theme: 'light' });
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: '切换到深色主题' }).click();
    await expect
      .poll(async () =>
        page.evaluate(() => document.documentElement.classList.contains('dark'))
      )
      .toBe(true);
    monitor.expectNoErrors('theme toggle');
  });

  test('reduced motion renders all sections', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const monitor = installPageHealthMonitor(page);
    await expectHealthyPage(page, monitor, '/', { theme: 'light' });

    for (const anchor of SECTION_ANCHORS) {
      await expect(page.locator(anchor)).toHaveCount(1);
    }
    const pricing = page.locator('#pricing');
    await pricing.scrollIntoViewIfNeeded();
    await expect(pricing).toContainText('¥399');
    await expect(pricing).toContainText('未开放');
    monitor.expectNoErrors('reduced motion');
  });
});
