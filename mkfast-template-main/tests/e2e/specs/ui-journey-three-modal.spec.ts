import { expect, test } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { setTheme, type ThemeMode } from '../fixtures/page-health';
import {
  seedComposerInlineAuthorize,
  seedConfirmedStore,
} from '../fixtures/product';
import { installUserActivationCounter } from '../fixtures/user-activation';
import {
  adoptResult,
  adjustResult,
  assertJourneyRestored,
  assertThreeModalDiscovery,
  downloadFullPackage,
  JOURNEY_CONTRACTS,
  openDeliveryPanel,
  submitComposerJourney,
  waitForResultJourney,
} from '../fixtures/ui-journey';

type SurfaceProfile = {
  name: 'desktop' | 'mobile-dark';
  theme: ThemeMode;
  viewport: { width: number; height: number };
};

const SURFACE_PROFILES: readonly SurfaceProfile[] = [
  {
    name: 'desktop',
    theme: 'light',
    viewport: { width: 1440, height: 900 },
  },
  {
    name: 'mobile-dark',
    theme: 'dark',
    viewport: { width: 375, height: 812 },
  },
] as const;

test.describe('Z1 / #105 real Playwright three-modal Day-0 journeys', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    test.setTimeout(180_000);
    await cleanupE2EUsers(request);
  });

  for (const contract of JOURNEY_CONTRACTS) {
    for (const surface of SURFACE_PROFILES) {
      const resultStep = contract.modality === 'video' ? 'receive' : 'adjust';
      test(`${contract.modality}:${contract.deliveryTarget} · ${surface.name}: discover → submit → wait → result → ${resultStep} → adopt → download → restore`, async ({
        page,
        request,
      }) => {
        test.setTimeout(contract.modality === 'video' ? 600_000 : 360_000);
        await page.setViewportSize(surface.viewport);
        await setTheme(page, surface.theme);
        const activationCounter = await installUserActivationCounter(page);
        const user = await registerE2EUser(request);
        await loginByForm(page, user);
        await seedConfirmedStore(page);
        await page.goto('/dashboard');

        await expect(page.locator('html')).toHaveClass(
          new RegExp(`\\b${surface.theme}\\b`)
        );
        await assertThreeModalDiscovery(page);
        if (contract.modality !== 'copy') {
          await seedComposerInlineAuthorize(page, {
            fileName: `${contract.modality}-day0-${contract.deliveryTarget}-${surface.name}.png`,
          });
        }

        if (contract.modality !== 'copy') {
          await seedComposerInlineAuthorize(page, {
            fileName: `three-modal-${contract.modality}-${crypto.randomUUID()}.png`,
          });
        }

        activationCounter.beginMeasurement();
        // Intent must name the distribution target for delivery package labels:
        // copy → 朋友圈分段包; image_text → 小红书 ZIP; video → 抖音 ZIP.
        const intentSeed =
          contract.deliveryTarget === 'wechat_moments'
            ? '朋友圈项目介绍'
            : contract.deliveryTarget === 'xiaohongshu'
              ? '小红书套图'
              : contract.deliveryTarget === 'video_account'
                ? '微信视频号项目成片'
                : '抖音项目成片';
        const intent =
          contract.modality === 'video'
            ? `为门店已确认的透亮猫眼项目制作${intentSeed}`
            : `Z1 皮肤护理 ${intentSeed} ${contract.modality} ${surface.name} ${crypto.randomUUID()}`;
        const workId = await submitComposerJourney(
          page,
          contract,
          intent,
          // ADR-0014: opening Result Center from the 成品预览卡 is a navigation,
          // not an activation. Freeze the count at the point the merchant has
          // their result, which is what the C6 budget is about.
          { onDeliveryCardVisible: () => activationCounter.stop() }
        );
        await waitForResultJourney(page, contract, workId);
        if (surface.name === 'mobile-dark') {
          const actions = page.getByTestId('result-shell-actions');
          await expect(actions).toHaveAttribute(
            'data-mobile-sticky-actions',
            'true'
          );
          await expect(
            actions.getByTestId('result-primary-action')
          ).toHaveCount(1);
          await expect(
            actions.getByTestId('result-secondary-action')
          ).toHaveCount(0);
        }
        expect(
          activationCounter.count(),
          `${contract.modality} C6 activation budget: ${JSON.stringify(activationCounter.events())}`
        ).toBe(contract.expectedActivations);

        // Copy hand edits require an adopted canonical ContentPackage first.
        // Every adjustment then creates a new candidate version that must be
        // adopted before delivery.
        if (contract.modality === 'copy') {
          await adoptResult(page, contract);
        }
        const adjusted = await adjustResult(page, contract.modality);
        if (adjusted.workId) {
          await waitForResultJourney(page, contract, adjusted.workId);
        }
        await adoptResult(page, contract);
        await openDeliveryPanel(page, contract.modality);
        await downloadFullPackage(page, contract);
        await assertJourneyRestored(page, contract, adjusted.workId ?? workId);

        if (surface.name === 'mobile-dark') {
          await expect(page.getByTestId('composer-home')).toHaveCount(0);
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth
          );
          expect(
            overflow,
            'mobile Result Center must not overflow horizontally'
          ).toBeLessThanOrEqual(1);
        }
      });
    }
  }
});
