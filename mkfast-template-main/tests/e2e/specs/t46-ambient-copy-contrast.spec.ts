import { expect, test } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { measureContrast } from '../fixtures/contrast';
import { setTheme } from '../fixtures/page-health';

/**
 * T46 / OI-73 — ambient 氛围底图上的文案可读性.
 *
 * 一级导航「内容」落在 /dashboard/works 之后，冷启店主第一眼就是那一屏的空态
 * (T34 走查 seq 1179)。三行字浮在门店橱窗 ambient 照片上，两个主题下都近乎不可读。
 * DESIGN.md:251 对压在氛围层上的文字有 ≥4.5:1 的硬门，D-130 又写明组件库的产物
 * 同样受这条约束——vendored EmptyState 把 `--muted` 当前景色用，而 .meiye-product-shell
 * 在子树里把该 token 重定义成 4%/6% 的底色，于是描述整行隐形。
 *
 * 这里量的是**画出来的**对比度而不是声明的对比度：底图、压暗遮罩、玻璃三层合成后
 * 是什么颜色，只有真拍一张才知道。空态是新用户的默认状态，所以一个字都不用种——
 * 注册完直接就是这几屏。
 *
 * 覆盖面＝生产可达且落在 product 氛围壳里的全部 vendored EmptyState。退休件
 * (-content-library-surface / content-task-inbox / canonical-history-page) 用的是
 * WarmEmptyState，不是这个组件，故不在此列。
 */

const AMBIENT_MINIMUM = 4.5;

/** 每个面读得到的字，逐行量;「就绪锚点」保证量的是空态而不是它前面的加载态。 */
const SURFACES = [
  {
    copy: [
      // 页头本就是 .meiye-ambient-copy（--ambient-text 白字 + 投影），一起量，
      // 好让票面「逐位标注本就达标」是测出来的而不是论证出来的。
      ['works-ambient-title', '氛围页头'],
      ['works-ambient-aux', '氛围页头副行'],
      ['works-empty-title', '标题'],
      ['works-empty-description', '描述'],
      ['works-empty-cta', '主行动'],
    ],
    label: '内容面空态',
    path: '/dashboard/works',
    ready: 'works-empty',
    slug: 'works-empty',
  },
  {
    copy: [
      ['store-ambient-title', '氛围页头'],
      ['store-ambient-aux', '氛围页头副行'],
      ['store-profile-empty-description', '描述'],
    ],
    label: '门店档案空态',
    path: '/dashboard/store',
    ready: 'store-profile-empty-description',
    slug: 'store-profile-empty',
  },
  {
    copy: [
      ['identity-ambient-title', '氛围页头'],
      ['identity-empty-description', '描述'],
    ],
    label: '营销身份空态',
    path: '/dashboard/identity',
    ready: 'identity-empty-description',
    slug: 'identity-empty',
  },
] as const;

const VIEWPORTS = [
  { height: 844, label: 'mobile', width: 390 },
  { height: 900, label: 'desktop', width: 1440 },
] as const;

/** 失败时说清是哪个 token 没给对，而不只是数字太小。 */
const TOKENS_OF_INTEREST = ['--muted', '--foreground', '--default', '--ink-60'];

test.describe('T46 氛围壳里的空态文案可读性', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  for (const theme of ['light', 'dark'] as const) {
    test(`空态文案在 ${theme} 主题下的桌面与移动端实测 ≥4.5:1`, async ({
      page,
      request,
    }) => {
      test.setTimeout(300_000);
      const user = await registerE2EUser(request);
      await setTheme(page, theme);
      await loginByForm(page, user);

      for (const viewport of VIEWPORTS) {
        await page.setViewportSize({
          height: viewport.height,
          width: viewport.width,
        });

        for (const surface of SURFACES) {
          await test.step(`${surface.label} @ ${theme}/${viewport.label}`, async () => {
            await page.goto(surface.path);
            await expect(page.locator('html')).toHaveClass(
              new RegExp(`\\b${theme}\\b`, 'u')
            );
            await expect(page.getByTestId(surface.ready)).toBeVisible({
              timeout: 60_000,
            });

            // 截图在断言之前：修复前这一跑是红的，而票面要的正是那四张红图。
            await page.screenshot({
              fullPage: true,
              path:
                `../.scratch/t46-ambient-copy-contrast-2026-07-26/shots/` +
                `${surface.slug}-${viewport.label}-${theme}.png`,
            });

            // soft：一跑收齐全部读数，而不是停在第一个不达标的字上。
            for (const [testId, part] of surface.copy) {
              const sample = await measureContrast(
                page,
                testId,
                TOKENS_OF_INTEREST
              );
              // eslint-disable-next-line no-console
              console.log(
                `[contrast] ${theme}/${viewport.label} ${testId} = ${sample.ratio}:1 ` +
                  `color=${sample.color} ${sample.tokens} ` +
                  `fg=${sample.foreground} bg=${sample.backdrop}`
              );
              expect
                .soft(
                  sample.ratio,
                  `${theme}/${viewport.label} ${surface.label}${part} contrast`
                )
                .toBeGreaterThanOrEqual(AMBIENT_MINIMUM);
            }
          });
        }
      }
    });
  }
});
