import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { seedAcceptedProductContent } from '../fixtures/product';
import { evidencePath } from '../fixtures/evidence';

const CJK_PATTERN = /[\u3400-\u9fff]/u;
const LATIN_PATTERN = /[a-z]/iu;
const ALLOWED_ENGLISH_CJK = ['美业内容簿', '小红书', '抖音', '飞书'] as const;
const ALLOWED_CHINESE_LATIN_PATTERNS = [
  /\bAIGC\b/giu,
  /\b(?:AI|BYOK|MCP)\b/giu,
  /\b(?:L1|L3)\b/giu,
  /\b(?:Cmd|Ctrl)\s*\+\s*K\b/giu,
  /\b[ABC]\b/gu,
  /\b(?:Agent|Asset|Content|Job|Work)\b/giu,
  /\b(?:OpenAI|Anthropic|Google|MiniMax|Kling|Veo|Seedream|Seedance|GPT|Claude)\b/giu,
] as const;

const PNG_FIXTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

/**
 * T34 / #228 — `/en/dashboard/tasks` left this table because the route retired.
 * `/en/dashboard/content` became `/en/dashboard/works`: 一级导航「内容」now lands
 * on the reshelled surface. That surface writes its merchant copy inline rather
 * than through Paraglide, so this row is expected to fail until the reshelled
 * surfaces are put on the message catalogue — the row stays so the gap is
 * visible instead of quietly dropped.
 *
 * T37 / M-04 (#231) named the line: `works-queries.ts` exports
 * `WORKS_TITLE = '内容'` as a module constant, so `/en/dashboard/works` renders
 * a Chinese `h1` in the English locale and this row fails on both the heading
 * and `expectNoChineseSystemCopy`. Putting the works surface on the message
 * catalogue is T32/T34's component work, not this ticket's, so the row is left
 * failing-with-a-reason rather than weakened to match the defect.
 */
const CORE_ENGLISH_ROUTES = [
  ['/en/dashboard', 'Turn one idea into a creation you can keep completing'],
  ['/en/dashboard/assets', 'Asset library'],
  ['/en/dashboard/works', 'Content'],
  ['/en/dashboard/leads', 'Lead ledger'],
  ['/en/dashboard/store', 'Store profile'],
] as const;

function removeAllowedEnglishCjk(value: string) {
  return ALLOWED_ENGLISH_CJK.reduce(
    (copy, allowed) => copy.replaceAll(allowed, ''),
    value
  );
}

async function expectNoChineseSystemCopy(page: Page) {
  let visibleCopy = await page.locator('body').innerText();
  const passThroughCopy = await page
    .locator('[data-i18n-pass-through]')
    .allInnerTexts();
  for (const copy of passThroughCopy) {
    visibleCopy = visibleCopy.replace(copy, '');
  }
  visibleCopy = removeAllowedEnglishCjk(visibleCopy);
  const unexpectedLines = visibleCopy
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && CJK_PATTERN.test(line));

  expect(
    unexpectedLines,
    `Unexpected Chinese system copy: ${unexpectedLines.join(' | ')}`
  ).toEqual([]);
}

async function visibleCopyWithoutPassThrough(page: Page) {
  let visibleCopy = await page.locator('body').innerText();
  const passThroughCopy = await page
    .locator('[data-i18n-pass-through]')
    .allInnerTexts();
  for (const copy of passThroughCopy) {
    visibleCopy = visibleCopy.replaceAll(copy, '');
  }
  return visibleCopy;
}

async function expectNoEnglishSystemCopy(
  page: Page,
  passThroughCopy: readonly string[] = []
) {
  let visibleCopy = await visibleCopyWithoutPassThrough(page);
  for (const copy of passThroughCopy) {
    visibleCopy = visibleCopy.replaceAll(copy, '');
  }
  for (const allowed of ALLOWED_CHINESE_LATIN_PATTERNS) {
    visibleCopy = visibleCopy.replace(allowed, '');
  }
  const unexpectedLines = visibleCopy
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && LATIN_PATTERN.test(line));

  expect(
    unexpectedLines,
    `Unexpected English system copy: ${unexpectedLines.join(' | ')}`
  ).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  const width = await page.evaluate(async () => {
    const client = document.documentElement.clientWidth;
    const overflowers = Array.from(
      document.body.querySelectorAll<HTMLElement>('*')
    )
      .filter((element) => element.getBoundingClientRect().right > client + 0.5)
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        const parent = element.parentElement;
        return {
          className: element.className.toString().slice(0, 120),
          html: element.outerHTML.slice(0, 240),
          parentClassName: parent?.className.toString().slice(0, 120) ?? '',
          right: Number(bounds.right.toFixed(1)),
          tag: element.tagName.toLowerCase(),
          width: Number(bounds.width.toFixed(1)),
        };
      })
      .slice(0, 12);
    window.scrollTo({
      left: document.documentElement.scrollWidth,
      top: window.scrollY,
    });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const maxScrollX = window.scrollX;
    window.scrollTo({ left: 0, top: window.scrollY });
    return {
      bodyClient: document.body.clientWidth,
      bodyScroll: document.body.scrollWidth,
      client,
      innerWidth: window.innerWidth,
      maxScrollX,
      overflowers,
      scroll: document.documentElement.scrollWidth,
      visualViewport: window.visualViewport?.width,
    };
  });
  expect(
    width.scroll,
    `Horizontal overflow: ${JSON.stringify(width)}`
  ).toBeLessThanOrEqual(width.innerWidth);
  // Mobile Chromium can reserve two CSS pixels for its vertical scrollbar,
  // making clientWidth smaller than the layout viewport without creating a
  // horizontally scrollable page. Prove the root cannot move instead.
  expect(width.maxScrollX, `Horizontal scroll: ${JSON.stringify(width)}`).toBe(
    0
  );
}

async function expectAllVisibleTouchTargets(page: Page, label: string) {
  const audit = await page.locator('.meiye-product-shell').evaluate((shell) => {
    const candidates = Array.from(
      shell.querySelectorAll<HTMLElement>(
        [
          'a[href]',
          'button',
          'input:not([type="hidden"])',
          'label[for]',
          'select',
          'summary',
          'textarea',
          '[contenteditable="true"]',
          '[role="button"]',
          '[role="link"]',
          '[role="tab"]',
        ].join(',')
      )
    );
    const targets = new Set<HTMLElement>();
    for (const candidate of candidates) {
      const associatedLabel =
        candidate instanceof HTMLInputElement
          ? (candidate.labels?.[0] as HTMLElement | undefined)
          : undefined;
      targets.add(associatedLabel ?? candidate);
    }

    const excludedInlineTextLinks: string[] = [];
    const measured: Array<{
      height: number;
      name: string;
      tag: string;
      width: number;
    }> = [];
    for (const target of targets) {
      if (target.matches('[disabled], [aria-disabled="true"]')) continue;

      const style = getComputedStyle(target);
      const bounds = target.getBoundingClientRect();
      const visible =
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) !== 0 &&
        bounds.width > 0 &&
        bounds.height > 0 &&
        bounds.right > 0 &&
        bounds.bottom > 0;
      if (!visible) continue;

      // Inline prose links use surrounding line-height plus link spacing rather
      // than a boxed hit area. They are audited separately from action controls.
      if (target instanceof HTMLAnchorElement && style.display === 'inline') {
        excludedInlineTextLinks.push(target.innerText.trim());
        continue;
      }
      measured.push({
        height: bounds.height,
        name:
          target.getAttribute('aria-label') ||
          target.innerText.trim() ||
          target.getAttribute('name') ||
          '(unnamed)',
        tag: target.tagName.toLowerCase(),
        width: bounds.width,
      });
    }
    return { excludedInlineTextLinks, measured };
  });

  expect(
    audit.measured.length,
    `${label} should expose controls`
  ).toBeGreaterThan(0);
  const undersized = audit.measured.filter(
    (target) => target.height < 48 || target.width < 48
  );
  expect(
    undersized,
    `${label} undersized targets: ${undersized
      .map(
        (target) =>
          `${target.tag} "${target.name}" ${target.width.toFixed(1)}x${target.height.toFixed(1)}`
      )
      .join(
        ' | '
      )}; excluded inline prose links: ${audit.excludedInlineTextLinks.join(' | ')}`
  ).toEqual([]);
}

async function expectProductTypography(page: Page) {
  const typography = await page.evaluate(() => {
    const shell = document.querySelector('.meiye-product-shell');
    if (!shell) throw new Error('Product shell not found');
    return {
      bodyFontSize: getComputedStyle(document.body).fontSize,
      rootFontSize: getComputedStyle(document.documentElement).fontSize,
      shellFontFamily: getComputedStyle(shell).fontFamily,
    };
  });

  expect(typography.rootFontSize).toBe('16px');
  expect(typography.bodyFontSize).toBe('16px');
  expect(typography.shellFontFamily).toContain('HarmonyOS Sans');
  expect(typography.shellFontFamily).toContain('MiSans');
  expect(typography.shellFontFamily).toContain('PingFang SC');
  expect(typography.shellFontFamily).toContain('Microsoft YaHei');
  expect(typography.shellFontFamily).toContain('system-ui');
}

test.describe('UI/UX Upgrade B i18n, motion, and mobile contracts', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterEach(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('a clean first visit and authenticated workbench default completely to Chinese', async ({
    context,
    page,
    request,
  }) => {
    await context.clearCookies();
    await page.goto('/auth/login');
    await expect(page).toHaveURL((url) => url.pathname === '/auth/login');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.getByText('欢迎回来', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { exact: true, name: '登录' })
    ).toBeVisible();
    await expectNoEnglishSystemCopy(page, ['name@example.com']);

    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await expect(page).toHaveURL((url) => url.pathname === '/dashboard');
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: '把一句想法变成可继续完成的内容记录',
      })
    ).toBeVisible();
    await expectNoEnglishSystemCopy(page, [user.name, user.email]);
  });

  test('English core product surfaces expose no Chinese system copy', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    for (const [path, heading] of CORE_ENGLISH_ROUTES) {
      await test.step(path, async () => {
        await page.goto(path);
        await expect(
          page.getByRole('heading', { level: 1, name: heading })
        ).toBeVisible();
        await expectNoChineseSystemCopy(page);
      });

      if (path === '/en/dashboard') {
        await expect(
          page.getByText('Read-only · Browsing does not use your allowance', {
            exact: true,
          })
        ).toBeVisible();
        await page.screenshot({
          fullPage: true,
          path: evidencePath(
            'uiux-upgrade-b/screenshots/11-english-product-surface.png'
          ),
        });
      }
    }
  });

  test('language switching preserves the product route, query, hash, and session in both directions', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await page.goto('/dashboard/assets?from=ticket-23#gallery');

    await page.getByRole('button', { exact: true, name: '语言' }).click();
    await page.getByRole('menuitem', { name: /English/ }).click();
    await expect(page).toHaveURL((url) => {
      return (
        url.pathname === '/en/dashboard/assets' &&
        url.searchParams.get('from') === 'ticket-23' &&
        url.hash === '#gallery'
      );
    });
    await expect(
      page.getByRole('heading', { level: 1, name: 'Asset library' })
    ).toBeVisible();
    await expectNoChineseSystemCopy(page);

    await page.reload();
    await expect(page).toHaveURL((url) => {
      return (
        url.pathname === '/en/dashboard/assets' &&
        url.searchParams.get('from') === 'ticket-23' &&
        url.hash === '#gallery'
      );
    });
    await page.getByRole('button', { exact: true, name: 'language' }).click();
    await page.getByRole('menuitem', { name: /中文/ }).click();
    await expect(page).toHaveURL((url) => {
      return (
        url.pathname === '/dashboard/assets' &&
        url.searchParams.get('from') === 'ticket-23' &&
        url.hash === '#gallery'
      );
    });
    await expect(
      page.getByRole('heading', { level: 1, name: '资产库' })
    ).toBeVisible();
    await expectNoEnglishSystemCopy(page, [user.name, user.email]);
  });

  test('model cards keep public metadata while hiding internal model identifiers', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await page.goto('/en/settings/models');

    const tabs = page.getByRole('tablist', { name: 'Model types' });
    await expect(tabs).toBeVisible();
    for (const label of ['Copywriting LLM', 'Image models', 'Video models']) {
      await tabs.getByRole('tab', { name: label }).click();
      await expect(
        page.getByRole('button', { name: /Use for this run|Selected/ }).first()
      ).toBeVisible();

      const visibleCopy = await page.locator('main').innerText();
      expect(visibleCopy).not.toMatch(/\brecorded-[a-z0-9._-]+\b/i);
      expect(visibleCopy).not.toMatch(/\bllm-[a-z0-9._-]+\b/i);
      expect(visibleCopy).not.toMatch(/\b[a-z0-9._-]+-copy\b/i);
      expect(visibleCopy).not.toMatch(/\brecorded-v\d+\b/i);
      expect(visibleCopy).not.toMatch(/\bundefined\b/i);
    }
    await page.screenshot({
      fullPage: true,
      path: evidencePath(
        'uiux-upgrade-b/screenshots/24-model-cards-sanitized-desktop.png'
      ),
    });
  });

  /**
   * M-04 DEMOTED (T37 / #231) — this case only.
   *
   * The reduced-motion contract itself is live and still matters; what died is
   * the surface this case walks to reach a pending request: 「建立创作记录」 →
   * 「快速起步预设」 → `execute-tool-action`, all removed from `src` by the Z1
   * cutover. Relanding it means reaching a pending run through the Composer
   * conversation instead. The sibling reduced-motion case in
   * `landing-page.spec.ts` and the `accent-motion.test.ts` unit still cover the
   * static-accent rule meanwhile.
   */
  test.describe.fixme('reduced motion', () => {
    test('generation accent remains readable and static while a real request is pending', async ({
      page,
      request,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const user = await registerE2EUser(request);
      await loginByForm(page, user);
      await expectProductTypography(page);
      await page
        .getByLabel('描述这次想创作的内容')
        .fill('验证减少动效时生成状态仍然清晰可读');
      await page.getByRole('button', { name: '建立创作记录' }).click();
      const record = page.getByLabel('Agent 创作记录');
      await expect(record).toBeVisible();
      await record
        .getByRole('group', { name: '快速起步预设' })
        .getByRole('button', { name: /^图片生成/ })
        .click();
      const contract = record.getByRole('checkbox', {
        name: /接受本次执行合同/,
      });
      await expect(contract).toBeEnabled();
      await contract.click();

      // T37 / M-04: a submit hold used to sit here, keyed on a command the
      // Composer no longer emits — it held nothing, so these pending-state
      // assertions were racing a live request rather than reading a frozen one.
      const submit = record.getByTestId('execute-tool-action');
      await expect(submit).toBeEnabled();
      await expect(submit).toBeInViewport();
      await submit.click();

      const accent = record
        .locator('output')
        .filter({ hasText: '正在提交生成请求…' });
      await expect(accent).toBeVisible();
      await expect(accent).toContainText('正在提交生成请求…');
      await expect(accent.locator('span')).toHaveCount(2);
      const reducedStyle = await accent.evaluate((element) => {
        const [dot, label] = element.querySelectorAll('span');
        if (!dot || !label) throw new Error('Generation accent is incomplete');
        const dotStyle = getComputedStyle(dot);
        const labelStyle = getComputedStyle(label);
        return {
          animationName: dotStyle.animationName,
          backgroundImage: labelStyle.backgroundImage,
          color: labelStyle.color,
        };
      });
      expect(reducedStyle.animationName).toBe('none');
      expect(reducedStyle.backgroundImage).toBe('none');
      expect(reducedStyle.color).not.toBe('rgba(0, 0, 0, 0)');
      await page.screenshot({
        fullPage: true,
        path: evidencePath(
          'uiux-upgrade-b/screenshots/24-generation-accent-reduced-motion-desktop.png'
        ),
      });
    });
  });
});

test.describe('UI/UX Upgrade B real publication transition', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test('celebrates only a real published transition once and keeps reduced motion static', async ({
    context,
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const user = await registerE2EUser(request);
    let handoffPage: Page | undefined;
    try {
      await loginByForm(page, user);
      await seedAcceptedProductContent(page, 'uiux-publish-transition');
      await page.goto('/dashboard?stage=handoff');
      await expect(
        page.getByRole('heading', { level: 1, name: '掌心行动簿' })
      ).toBeVisible();

      await page.getByRole('button', { name: 'L3 生成人工发布包' }).click();
      await expect(
        page.getByRole('dialog').getByText('确认建立 L3 人工交接')
      ).toBeVisible();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: '确认当前账号与内容' })
        .click();
      await expect(
        page.getByText('L3 人工发布包已建立，尚未标记发布。')
      ).toBeVisible();
      await expect(
        page.getByText('人工发布结果已确认', { exact: true })
      ).toHaveCount(0);

      const handoffHref = await page
        .getByRole('link', { name: '打开手机发布包' })
        .getAttribute('href');
      expect(handoffHref).toBeTruthy();
      handoffPage = await context.newPage();
      await handoffPage.goto(new URL(handoffHref!, page.url()).href);
      await handoffPage
        .getByLabel('结果备注（可选）')
        .fill('尚未发布，用于验证不误触庆祝');
      await handoffPage
        .getByRole('button', { name: '暂未发布', exact: true })
        .click();
      await expect(
        handoffPage.getByText('已记录暂未发布，发布包仍保持待处理。')
      ).toBeVisible();

      const syncReadyState = page.waitForResponse(
        (response) =>
          response.url().includes('/api/core/product/commands') &&
          response.request().method() === 'POST'
      );
      await page.getByRole('button', { name: '更口语' }).click();
      expect((await syncReadyState).ok()).toBe(true);
      await expect(
        page.getByText('人工发布结果已确认', { exact: true })
      ).toHaveCount(0);

      await handoffPage
        .getByLabel('平台帖子链接（可选）')
        .fill('https://example.test/posts/uiux-published');
      await handoffPage
        .getByRole('button', { name: '已发布', exact: true })
        .click();
      await expect(handoffPage.getByText('已记录人工发布结果。')).toBeVisible();

      await page.getByRole('tab', { name: '行动' }).click();
      await page.locator('#mobile-library-input').setInputFiles({
        name: 'published-state-sync.png',
        mimeType: 'image/png',
        buffer: PNG_FIXTURE,
      });
      await expect(page.getByText('已持久化', { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      const celebration = page
        .locator('output')
        .filter({ hasText: '人工发布结果已确认' });
      await expect(celebration).toHaveCount(1);
      await expect(celebration).toContainText('人工发布结果已确认');
      const reducedState = await celebration.evaluate((element) => {
        const particles = element.querySelector<HTMLElement>(
          'span[aria-hidden="true"]'
        );
        return {
          particleDisplay: particles
            ? getComputedStyle(particles).display
            : 'lazy-fallback',
          text: element.textContent?.trim(),
        };
      });
      expect(reducedState.text).toContain('人工发布结果已确认');
      expect(['none', 'lazy-fallback']).toContain(reducedState.particleDisplay);
      await page.screenshot({
        fullPage: true,
        path: evidencePath(
          'uiux-upgrade-b/screenshots/24-published-celebration-reduced-motion-mobile.png'
        ),
      });

      await page.reload();
      await expect(
        page.getByText('人工回报已发布', { exact: true })
      ).toBeVisible();
      await expect(
        page.getByText('人工发布结果已确认', { exact: true })
      ).toHaveCount(0);
    } finally {
      await handoffPage?.close();
      await cleanupE2EUsers(request);
    }
  });
});

for (const viewport of [
  { width: 379, height: 820 },
  { width: 390, height: 844 },
]) {
  test.describe(`UI/UX Upgrade B mobile ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true });

    test('keeps every visible action, progress, and handoff target usable in both locales', async ({
      page,
      request,
    }) => {
      const user = await registerE2EUser(request);
      try {
        await loginByForm(page, user);
        await expect(
          page.getByRole('heading', { level: 1, name: '掌心行动簿' })
        ).toBeVisible();
        await expectProductTypography(page);
        await expectNoHorizontalOverflow(page);

        const chineseStages = page.getByRole('tablist', {
          name: '掌心行动簿阶段',
        });
        for (const stage of ['行动', '进度', '交接']) {
          await chineseStages.getByRole('tab', { name: stage }).click();
          await expect(
            chineseStages.getByRole('tab', { name: stage })
          ).toHaveAttribute('aria-selected', 'true');
          await expectNoHorizontalOverflow(page);
          await expectAllVisibleTouchTargets(
            page,
            `${viewport.width}px Chinese ${stage} stage`
          );
          if (viewport.width === 390) {
            const screenshotStage =
              stage === '行动'
                ? 'action'
                : stage === '进度'
                  ? 'progress'
                  : 'handoff';
            await page.screenshot({
              fullPage: true,
              path: evidencePath(
                `uiux-upgrade-b/screenshots/25-mobile-${screenshotStage}-390.png`
              ),
            });
          }
        }

        await page.goto('/en/dashboard');
        await expect(
          page.getByRole('heading', { level: 1, name: 'Mobile action book' })
        ).toBeVisible();
        const englishStages = page.getByRole('tablist', {
          name: 'Mobile action book stages',
        });
        await expectNoChineseSystemCopy(page);

        for (const stage of ['Action', 'Progress', 'Handoff']) {
          await englishStages.getByRole('tab', { name: stage }).click();
          await expect(
            englishStages.getByRole('tab', { name: stage })
          ).toHaveAttribute('aria-selected', 'true');
          await expectNoHorizontalOverflow(page);
          await expectNoChineseSystemCopy(page);
          await expectAllVisibleTouchTargets(
            page,
            `${viewport.width}px English ${stage} stage`
          );
        }
      } finally {
        await cleanupE2EUsers(request);
      }
    });
  });
}
