/**
 * S5 成品动作面 journey hard gates (issue #239 — W07 / W08 / W09).
 *
 * Two things the browser could not do before this slice, on a real backend:
 *  1. rewrite a selection on a finished 成品, see the diff, and adopt it — the
 *     13-action QuickEditIntent contract finally has a producer;
 *  2. record 「昨天的到店」 with a count, and read the three-tier ladder that
 *     comes back, including the inferred tier that used to be decoration.
 */

import { expect, test } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { seedConfirmedStore } from '../fixtures/product';
import {
  JOURNEY_CONTRACTS,
  adoptResult,
  submitComposerJourney,
  waitForResultJourney,
} from '../fixtures/ui-journey';

const copyContract = JOURNEY_CONTRACTS.find((c) => c.modality === 'copy')!;

test.describe('S5 成品动作面 (#239)', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    test.setTimeout(180_000);
    await cleanupE2EUsers(request);
  });

  test('quick edit and the result ledger work on a finished 成品', async ({
    page,
    request,
  }) => {
    test.setTimeout(420_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);
    await page.goto('/dashboard');

    const workId = await submitComposerJourney(
      page,
      copyContract,
      `S5 皮肤护理 朋友圈项目介绍 ${crypto.randomUUID()}`
    );
    await waitForResultJourney(page, copyContract, workId);
    await adoptResult(page, copyContract);

    // ---- W07 hard gate: 弱促销 → diff → 采用 -----------------------------
    const rewritePanel = page.getByTestId('copy-selection-rewrite');
    await expect(
      rewritePanel,
      'selection rewrite must be mounted, not merely built'
    ).toBeVisible({ timeout: 60_000 });

    const quickEditResponse = page.waitForResponse(
      (response) => {
        if (
          response.request().method() !== 'POST' ||
          !response.url().includes('/api/core/p1/commands')
        ) {
          return false;
        }
        try {
          const body = response.request().postDataJSON() as {
            action?: unknown;
            payload?: { intent?: { action?: unknown } };
          };
          return (
            body.action === 'edit_content_package_version' &&
            body.payload?.intent?.action === 'promotion_weaker'
          );
        } catch {
          return false;
        }
      },
      { timeout: 60_000 }
    );

    await page.getByTestId('copy-rewrite-weaker_promo').click();
    const preview = page.getByTestId('copy-selection-rewrite-preview');
    await expect(
      preview,
      'the merchant decides on a diff, not on trust'
    ).toBeVisible();
    await expect(preview).toHaveAttribute(
      'data-rewrite-action',
      'weaker_promo'
    );
    await expect(
      page.getByTestId('copy-selection-rewrite-before')
    ).toBeVisible();
    await expect(
      page.getByTestId('copy-selection-rewrite-after')
    ).toBeVisible();

    await page.getByTestId('copy-selection-rewrite-adopt').click();
    const quickEdit = await quickEditResponse;
    expect(quickEdit.ok(), await quickEdit.text()).toBeTruthy();
    await expect(preview).toBeHidden({ timeout: 30_000 });

    // ---- W07 hard gate: 做成海报 → 海报入口出现 --------------------------
    const posterResponse = page.waitForResponse(
      (response) => {
        if (
          response.request().method() !== 'POST' ||
          !response.url().includes('/api/core/p1/commands')
        ) {
          return false;
        }
        try {
          const body = response.request().postDataJSON() as {
            action?: unknown;
            payload?: { intent?: { exportUse?: unknown } };
          };
          return (
            body.action === 'edit_content_package_version' &&
            body.payload?.intent?.exportUse === 'poster'
          );
        } catch {
          return false;
        }
      },
      { timeout: 60_000 }
    );
    await page.getByTestId('copy-export-use-poster').click();
    const poster = await posterResponse;
    expect(poster.ok(), await poster.text()).toBeTruthy();

    const carrier = page.getByTestId('result-export-use-carrier');
    await expect(
      carrier,
      'a produced export use must reach its renderer'
    ).toBeVisible({ timeout: 60_000 });
    await expect(carrier).toHaveAttribute('data-export-use', 'poster');

    // ---- W09 hard gate: 「昨天的到店」 → 阶梯 + 推断层 --------------------
    await page.reload();
    await expect(page.getByTestId('result-center-shell')).toBeVisible({
      timeout: 60_000,
    });
    const publicationForm = page.getByTestId('publication-record-form');
    await expect(publicationForm).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('publication-status-failed')).toBeVisible();
    await expect(page.getByTestId('publication-status-unknown')).toBeVisible();
    await page
      .locator('[data-testid^="publication-platform-"]')
      .first()
      .click();
    await page.getByTestId('publication-account').fill('S5 门店账号');
    await page
      .getByTestId('publication-at')
      .fill(new Date().toISOString().slice(0, 16));
    const publicationResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/core/p1/commands'),
      { timeout: 60_000 }
    );
    await page.getByTestId('publication-record-submit').click();
    expect((await publicationResponse).ok()).toBeTruthy();
    await expect(
      page.getByTestId('publication-record-row').first()
    ).toBeVisible({ timeout: 30_000 });

    const chip = page.getByTestId('outcome-chip-store_visit');
    await expect(chip).toHaveAttribute('data-enabled', 'true', {
      timeout: 30_000,
    });
    await page.getByTestId('outcome-detail-quantity').fill('3');
    await page.getByTestId('outcome-detail-yesterday').click();
    const signalResponse = page.waitForResponse(
      (response) => {
        if (
          response.request().method() !== 'POST' ||
          !response.url().includes('/api/core/p1/commands')
        ) {
          return false;
        }
        try {
          const body = response.request().postDataJSON() as {
            action?: unknown;
            payload?: { occurredAt?: unknown; quantity?: unknown };
          };
          return (
            body.action === 'record_content_package_result_signal' &&
            body.payload?.quantity === 3 &&
            typeof body.payload?.occurredAt === 'string'
          );
        } catch {
          return false;
        }
      },
      { timeout: 60_000 }
    );
    await chip.click();
    const signal = await signalResponse;
    expect(signal.ok(), await signal.text()).toBeTruthy();

    await expect(
      page.locator(
        '[data-testid="outcome-result-ladder"] [data-ladder-step="redeemed_or_visited"]'
      )
    ).toHaveAttribute('data-reached', 'true', { timeout: 30_000 });

    const inferred = page.getByTestId('outcome-group-inferred_association');
    await expect(
      inferred.getByTestId('outcome-observation-row').first(),
      'the inferred tier must carry real rows, not stay an empty decoration'
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('outcome-inferred-disclaimer')).toContainText(
      '不代表由该内容导致'
    );

    // The backdated signal keeps the merchant clock, not the typing clock.
    const rowText = await inferred
      .getByTestId('outcome-observation-row')
      .first()
      .innerText();
    const today = new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    expect(
      rowText,
      `backdated row must not read as today (${today})`
    ).not.toContain(today);
    expect(rowText).toContain('数量 3');
  });
});
