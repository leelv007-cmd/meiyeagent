import { expect, test } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { measureContrast } from '../fixtures/contrast';
import { seedConfirmedStore } from '../fixtures/product';
import { setTheme } from '../fixtures/page-health';

/**
 * S7 / U07 轮 2 — `--muted` 语义冲突在商家壳里的可读性门.
 *
 * `--muted` 在 HeroUI（含 vendored 组件表）是**前景色**，在 `.meiye-product-shell`
 * 里是 4%/6% 的底色 tint-hover（src/styles.css）。T46 已经在 EmptyState 这一面收过
 * 一次，换壳把 Glass 表铺到全部 /dashboard 与 /settings 之后，同一个破口还剩三面：
 *
 *  - vendored Segment 的未选中项 `color: var(--muted)`（vendor/css/segment.css），
 *    也就是 /dashboard 上 D-111 双入口「定制创作 / 自由创作」里没选中的那一格；
 *  - Tailwind 工具类 `text-muted`（→ --color-muted → --muted），素材面与获客台账
 *    的说明文案都在用。
 *  - 作品页的 Segment 位于更透的玻璃底，需通过局部变量把未选中项提到 --ink-90。
 *
 * 修在 heroui-pro/heroui-glass.css 的共享边界上（映到壳自己的 muted 前景 --ink-60），
 * 这里量的是**画出来的**对比度：底图、压暗遮罩、玻璃三层合成后是什么颜色，只有真拍
 * 一张才知道，和 T46 复用同一个 fixtures/contrast.ts。双主题各跑一遍——两套 token
 * 表不一样，一套过不能替另一套背书。
 */

const MINIMUM = 4.5;

const SURFACES = [
  {
    /* 默认 creationMode = 'customized'（composer-home.tsx），未选中的是「自由创作」。 */
    copy: [['composer-creation-mode-free', '未选中入口标签']],
    label: '双入口分段控件',
    path: '/dashboard',
    ready: 'composer-prompt-bar',
    unselected: 'composer-creation-mode-free',
  },
  {
    /* 默认 shape = 'all'（works-list-page.tsx），未选中的是「文案」。 */
    copy: [['works-shape-copy', '未选中作品类型标签']],
    label: '作品筛选分段控件',
    path: '/dashboard/works',
    ready: 'works-shape-filter',
    unselected: 'works-shape-copy',
  },
  {
    /*
     * 这两行不在白瓷件里，压的是门店橱窗氛围底图——第一跑量出 1.6:1，说明
     * token 侧收不动它，得按「压在氛围层上的字」处理（见 workspace-assets-page.tsx）。
     * 同页其余 text-muted 都在 `Widget.meiye-porcelain` 里，白底，token 一映就够。
     */
    copy: [
      ['workspace-materials-summary', '白瓷件里的 text-muted 计数'],
      ['workspace-assets-description', '面说明文案'],
      ['workspace-assets-footnote', '页脚指路文案'],
    ],
    label: '素材面',
    path: '/dashboard/workspace',
    ready: 'workspace-assets-description',
  },
  {
    copy: [['lead-ledger-attribution-notice', '归因说明文案']],
    label: '获客台账',
    path: '/dashboard/leads',
    ready: 'lead-ledger-attribution-notice',
  },
] as const;

/** 失败时说清是哪个 token 没给对，而不只是数字太小。 */
const TOKENS_OF_INTEREST = [
  '--muted',
  '--meiye-segment-unselected',
  '--ink-60',
  '--foreground',
  '--default',
];

test.describe('S7 商家壳里 --muted 消费点的文案可读性', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  for (const theme of ['light', 'dark'] as const) {
    test(`Segment 未选中项与 text-muted 文案在 ${theme} 主题下实测 ≥4.5:1`, async ({
      page,
      request,
    }) => {
      test.setTimeout(180_000);
      const user = await registerE2EUser(request);
      await setTheme(page, theme);
      await loginByForm(page, user);
      await seedConfirmedStore(page);
      await page.setViewportSize({ width: 1440, height: 900 });

      for (const surface of SURFACES) {
        await test.step(`${surface.label} @ ${theme}`, async () => {
          await page.goto(surface.path);
          await expect(page.locator('html')).toHaveClass(
            new RegExp(`\\b${theme}\\b`, 'u')
          );
          await expect(page.getByTestId(surface.ready)).toBeVisible({
            timeout: 60_000,
          });

          // 量的必须是未选中那一格：选中项走的是 --segment-foreground，
          // 它读数漂亮并不能替未选中项背书。
          if ('unselected' in surface) {
            await expect(
              page.getByTestId(surface.unselected)
            ).not.toHaveAttribute('data-selected', 'true');
          }

          // soft：一跑收齐全部读数，而不是停在第一个不达标的字上。
          for (const [testId, part] of surface.copy) {
            const sample = await measureContrast(page, testId, [
              ...TOKENS_OF_INTEREST,
            ]);
            // eslint-disable-next-line no-console
            console.log(
              `[contrast] ${theme} ${testId} = ${sample.ratio}:1 ` +
                `color=${sample.color} ${sample.tokens} ` +
                `fg=${sample.foreground} bg=${sample.backdrop}`
            );
            expect
              .soft(sample.ratio, `${theme} ${surface.label}${part} contrast`)
              .toBeGreaterThanOrEqual(MINIMUM);
          }
        });
      }
    });
  }
});
