/**
 * V31-11 / U7 — Campaign 每个含付费媒体的派生 Work 单独确认。
 *
 * Spec only (local rule: Playwright files are authored, not executed in-lane).
 * Asserts the confirmation surface is per-work (second paid Work shows a fresh
 * confirmation card; plan_only campaign approval does not pre-authorize charges).
 */
import { expect, test } from '@playwright/test';

test.describe('V31-11 Campaign paid Work confirmation (U7)', () => {
  test.skip(
    true,
    'Authored for CI/journey owners; local agent lanes do not run Playwright e2e.',
  );

  test('second paid Work under one Campaign requires its own confirmation', async ({
    page,
  }) => {
    // Journey sketch (when live fixture supplies Campaign L3 + two media Works):
    // 1) Approve Campaign plan_only (schedule only — no debit).
    // 2) First paid Work freezes exact quote/rights → confirmation card.
    // 3) Confirm Work 1 → execute.
    // 4) Second paid Work freezes its own quote → a *new* confirmation card
    //    (different requestId / workOrdinal=2), never silent reuse of Work 1.
    await page.goto('/app');

    const firstCard = page.getByTestId('execution-confirmation-interaction-card');
    await expect(firstCard).toBeVisible({ timeout: 30_000 });
    const firstRequestId = await firstCard.getAttribute('data-request-id');
    expect(firstRequestId).toBeTruthy();

    await firstCard.getByRole('button', { name: /确认执行/ }).click();
    await expect(firstCard).toBeHidden({ timeout: 30_000 });

    const secondCard = page.getByTestId(
      'execution-confirmation-interaction-card',
    );
    await expect(secondCard).toBeVisible({ timeout: 60_000 });
    const secondRequestId = await secondCard.getAttribute('data-request-id');
    expect(secondRequestId).toBeTruthy();
    expect(secondRequestId).not.toEqual(firstRequestId);

    // Hold / debit visibility on the compact strip when units were reserved.
    await expect(
      secondCard.getByTestId('execution-confirmation-held').or(
        secondCard.getByText(/已预留|确认本次执行方案/),
      ),
    ).toBeVisible();

    await secondCard.getByRole('button', { name: /确认执行/ }).click();
  });

  test('compact confirm strip shows credits hold and only reject/confirm', async ({
    page,
  }) => {
    await page.goto('/app');
    const card = page.getByTestId('execution-confirm-card');
    // Host may mount either the interaction card or the client confirm strip.
    const surface = card.or(
      page.getByTestId('execution-confirmation-interaction-card'),
    );
    await expect(surface.first()).toBeVisible({ timeout: 30_000 });

    // Read-only: no parameter pickers.
    await expect(surface.first().locator('select')).toHaveCount(0);
    await expect(
      surface.first().getByRole('button', { name: /确认|暂不|先不/ }),
    ).toHaveCount(2);
  });
});
