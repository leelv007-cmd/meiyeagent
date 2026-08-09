import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import {
  seedComposerInlineAuthorize,
  seedConfirmedStore,
} from '../fixtures/product';
import { selectComposerLens } from '../fixtures/ui-journey';

/**
 * V31-14 / V3.1 §37.4-H — Interrupt resume + pending interrupt reconnect (spec only).
 *
 * Journey under test:
 *   paid Make suspends on typed interrupt → refresh/reconnect → pending interrupt
 *   still visible → resume by interruptId+revision → run continues
 *
 * Real browser run is owned by the merge controller. This file is the Playwright
 * seam contract. Do not run full e2e in agent lanes.
 *
 * Related: §37.4-F material rights revoke, §37.4-E plan stale (other specs).
 */

async function openCustomizedCreate(page: Page) {
  await page.goto('/dashboard');
  // image_text submissions fail closed (400 INVALID_STATE) without a
  // case_image workspace source — seed one first, as the merchant would.
  await seedComposerInlineAuthorize(page, {
    fileName: `v31-journey-${crypto.randomUUID()}.png`,
  });
  await selectComposerLens(page, 'image_text');
  await expect(page.getByTestId('composer-home')).toBeVisible();
}

test.describe('V31-14 Interrupt resume journey (§37.4-H)', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('pending interrupt 刷新/重连不丢 → resume by interruptId', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    await openCustomizedCreate(page);

    const intent = page.getByTestId('composer-intent-input');
    await intent.fill('帮我做一组含配图的小红书笔记，奶油风美甲。');
    await page.getByTestId('composer-submit').click();

    await page.getByRole('button', { name: '确认并开始' }).click();
    const interruptHost = page.getByTestId('agent-pending-interrupt');
    await expect(interruptHost).toBeVisible({ timeout: 120_000 });
    const interruptId = await interruptHost.getAttribute('data-interrupt-id');
    const revision = await interruptHost.getAttribute(
      'data-interrupt-revision'
    );
    expect(interruptId).toBeTruthy();
    expect(revision).toMatch(/^\d+$/u);
    const beforeText = (await interruptHost.innerText()).trim();
    expect(beforeText.length).toBeGreaterThan(0);

    const invalidSchema = await page.request.post(
      '/api/core/p1/interrupts/resume',
      {
        data: {
          schemaVersion: 'interrupt-payload/v999',
          interruptId,
          revision: Number(revision),
          type: 'accept',
          idempotencyKey: `invalid-schema:${interruptId}`,
        },
      }
    );
    expect(invalidSchema.status()).toBe(400);
    const staleRevision = await page.request.post(
      '/api/core/p1/interrupts/resume',
      {
        data: {
          schemaVersion: 'interrupt-payload/v1',
          interruptId,
          revision: Number(revision) + 1,
          type: 'accept',
          idempotencyKey: `stale-revision:${interruptId}`,
        },
      }
    );
    expect(staleRevision.status()).toBe(409);

    // §37.4-H: refresh / reconnect must not drop pending interrupt.
    await page.reload();
    await expect(interruptHost).toHaveAttribute(
      'data-interrupt-id',
      interruptId!
    );
    await expect(interruptHost).toHaveAttribute(
      'data-interrupt-revision',
      revision!
    );
    await page.getByTestId('agent-interrupt-accept').click();
    await expect(interruptHost).toHaveCount(0, { timeout: 60_000 });
    const duplicate = await page.request.post(
      '/api/core/p1/interrupts/resume',
      {
        data: {
          schemaVersion: 'interrupt-payload/v1',
          interruptId,
          revision: Number(revision),
          type: 'accept',
          idempotencyKey: `interrupt-resume:${interruptId}:r${revision}:accept`,
        },
      }
    );
    expect(duplicate.ok(), await duplicate.text()).toBeTruthy();
    expect(await duplicate.json()).toMatchObject({
      data: { outcome: 'replayed' },
    });
  });

  test('homepage pending interrupts list is workspace-scoped', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    await openCustomizedCreate(page);
    await page
      .getByTestId('composer-intent-input')
      .fill('按已确认的门店价格做一组图文。');
    await page.getByTestId('composer-submit').click();
    await page.getByRole('button', { name: '确认并开始' }).click();
    const pending = page.getByTestId('agent-pending-interrupt');
    await expect(pending).toBeVisible({ timeout: 120_000 });
    const interruptId = await pending.getAttribute('data-interrupt-id');

    await page.goto('/dashboard');
    await expect(page.getByTestId('agent-pending-interrupt')).toHaveAttribute(
      'data-interrupt-id',
      interruptId!,
      { timeout: 60_000 }
    );
  });
});
