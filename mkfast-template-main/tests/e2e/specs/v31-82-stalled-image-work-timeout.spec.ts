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
import {
  chooseImageTextDirection,
  selectComposerLens,
} from '../fixtures/ui-journey';

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

    // An image_text run asks which direction to take before it binds a task,
    // so the handle this test needs does not exist until that is answered —
    // the run is mid-flight, not stalled, and 「no handle」 was this journey
    // skipping a step a merchant cannot skip.
    await chooseImageTextDirection(page);

    // The credit pill moves as soon as the reservation lands; the session
    // handle is written by the client a beat later, so read it with patience
    // rather than once.
    const readWorkId = () =>
      page.evaluate(() => {
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
    await expect
      .poll(readWorkId, {
        message: 'confirmed run must persist a work handle',
        timeout: 60_000,
      })
      .toBeTruthy();
    const workId = await readWorkId();

    // KNOWN RED — do not "fix" this by retrying the fixture. The fixture only
    // advances the clock past a stall that already exists; it cannot create
    // one. In fixture mode this run has no stall to find: once the direction
    // is answered the image_text run completes end to end (成品 r1 + 发布包),
    // and a retry loop here goes green off `alreadyTerminal` — i.e. off a
    // successful run — which is worse than the red. The stall V31-82 fixes is
    // a work that stays running with no generation job; reaching it from a
    // browser needs a way to source the work id before the run moves (the
    // client only persists the handle after the direction is answered) plus a
    // fixture that holds the run there. Recorded 2026-08-13; see V31-77 gate
    // notes.
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
  // The topbar balance, not the capsule one: `workbench-credit-balance` only
  // mounts while the credit popover is open, so reading it would make the
  // refund assertion depend on holding a panel open across the whole run.
  const pill = page.getByTestId('workbench-credit-topbar-balance');
  await expect(pill).toBeVisible({ timeout: 30_000 });
  const text = (await pill.textContent()) ?? '';
  const match = text.match(/(\d+)/u);
  return match ? Number(match[1]) : Number.NaN;
}
