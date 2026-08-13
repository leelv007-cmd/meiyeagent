/**
 * V31-82 — image work stall: bounded timeout + refund + failed inspector +
 * Composer unlock.
 *
 * Sequence under test (full-stack run is owned by the merge controller):
 *   confirm paid image recipe → credits reserved → inject short timeout →
 *   work fails, USAGE refunds, right rail shows the failed face, Composer
 *   accepts a new run.
 *
 * Do not run the full browser stack from a lane worktree.
 */
import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { seedComposerInlineAuthorize } from '../fixtures/product';
import { selectComposerLens } from '../fixtures/ui-journey';

const INTENT = '做一组美甲项目套图，适合发小红书。';

test.describe('V31-82 图文悬死超时退款解锁', () => {
  test.afterEach(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('确认扣分后短超时进入失败终态并退款解锁', async ({ page, request }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });

    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await page.goto('/dashboard');
    await seedComposerInlineAuthorize(page, {
      fileName: `v31-82-${crypto.randomUUID()}.png`,
    });
    await selectComposerLens(page, 'image_text');

    const creditsBefore = await readCreditPill(page);
    await page.getByTestId('composer-intent-input').fill(INTENT);
    const submit = page.getByTestId('composer-submit');
    await expect(submit).toBeEnabled({ timeout: 60_000 });
    await submit.click();

    const confirm = page.getByRole('button', { name: /确认并开始|开始制作/u });
    await expect(confirm).toBeVisible({ timeout: 120_000 });
    await confirm.click();

    await expect
      .poll(async () => readCreditPill(page), { timeout: 60_000 })
      .toBeLessThan(creditsBefore);

    const workId = await page.evaluate(() => {
      const stored = Object.values(sessionStorage).find((value) =>
        value.includes('"task"')
      );
      if (!stored) return null;
      try {
        const parsed = JSON.parse(stored) as { task?: { workId?: string } };
        return parsed.task?.workId ?? null;
      } catch {
        return null;
      }
    });
    expect(workId, 'confirmed run must persist a work handle').toBeTruthy();

    const expiry = await page.request.post(
      '/api/e2e/stalled-work-expiry-fixture',
      {
        data: { workId },
        headers: { 'x-e2e-secret': 'mkfast-e2e-secret' },
      }
    );
    expect(expiry.ok(), await expiry.text()).toBeTruthy();

    await expect(page.getByTestId('workbench-inspector-failed')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId('workbench-inspector-failed')).toContainText(
      /超时|退回/u
    );
    await expect(page.getByTestId('composer-intent-input')).toBeEnabled({
      timeout: 30_000,
    });

    await expect
      .poll(async () => readCreditPill(page), { timeout: 60_000 })
      .toBe(creditsBefore);

    await page.getByTestId('composer-intent-input').fill(`${INTENT} 再来一版`);
    await expect(page.getByTestId('composer-submit')).toBeEnabled({
      timeout: 60_000,
    });
  });
});

async function readCreditPill(page: Page): Promise<number> {
  const pill = page.getByTestId('workbench-credit-balance');
  await expect(pill).toBeVisible({ timeout: 30_000 });
  const text = (await pill.textContent()) ?? '';
  const match = text.match(/(\d+)/u);
  return match ? Number(match[1]) : Number.NaN;
}
