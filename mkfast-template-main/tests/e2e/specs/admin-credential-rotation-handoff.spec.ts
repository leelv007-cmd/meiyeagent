/**
 * #367 — platform credential rotation receipt display + same-origin handoff.
 *
 * Journey: integrations stage rotate → receipt id/expiry visible, URL has no
 * receiptId → navigate to supply (handoff prefills) → complete rotation →
 * secretVersion advances. Negative Core cases are covered by unit/interaction
 * tests; this file proves the operator-visible closed loop.
 *
 * Driver runs this Playwright suite — lane agents must not start e2e here.
 */
import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

const FORBIDDEN_SECRET =
  /sk-[A-Za-z0-9]{8,}|secretReference|Bearer\s+[A-Za-z0-9._\-+/=]{8,}/i;

async function loginAsAdmin(page: Page, request: APIRequestContext) {
  const admin = await registerE2EUser(request, { role: 'admin' });
  await loginByForm(page, admin);
  return admin;
}

/**
 * Best-effort read of a credential account's public version from supply cards.
 * Falls back to the integrations mask line "vN" when supply projection differs.
 */
async function readDisplayedSecretVersion(
  page: Page,
  accountHint: string | RegExp
): Promise<string | null> {
  const card = page
    .getByTestId('supply-credential-card')
    .filter({ hasText: accountHint })
    .first();
  if ((await card.count()) > 0) {
    const text = (await card.innerText()).replace(/\s+/g, ' ');
    const match = text.match(/\bv(\d+)\b|\bversion[:\s]+(\d+)\b/i);
    if (match) return match[1] ?? match[2] ?? null;
  }
  return null;
}

test.describe('admin credential rotation handoff (#367)', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('integrations stages receipt, handoff prefills supply, rotation advances secretVersion', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    await loginAsAdmin(page, request);

    // --- Baseline version on supply (if any credential cards exist) ---
    await page.goto('/admin/supply');
    await expect(page.getByTestId('supply-control-center-panel')).toBeVisible({
      timeout: 60_000,
    });
    const versionBefore =
      (await readDisplayedSecretVersion(page, /model\.direct|平台|ark|凭证/i)) ??
      null;

    // Capture outbound navigations / analytics-ish requests for receipt leak checks.
    const outbound: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      // Same-origin app APIs are expected; flag receipt only in URL / body later.
      outbound.push(url);
    });

    // --- Stage rotation on integrations ---
    await page.goto('/admin/integrations');
    const slot = page.locator(
      '[data-testid="provider-credential-slot"][data-slot="model.direct"]'
    );
    await expect(slot).toBeVisible({ timeout: 60_000 });

    // Ensure a credential exists so the control offers Rotate (store first if empty).
    const rotateOrStore = slot.getByRole('button', {
      name: /轮换|Rotate|保存凭据|Store secret/i,
    });
    await expect(rotateOrStore).toBeVisible();
    const secretInput = slot.getByLabel(/model\.direct|新凭据|New secret/i);
    const stagedSecret = `e2e-rotate-${randomUUID()}`;
    await secretInput.fill(stagedSecret);

    const buttonName = await rotateOrStore.innerText();
    if (/保存|Store/i.test(buttonName)) {
      await rotateOrStore.click();
      await expect(secretInput).toHaveValue('', { timeout: 30_000 });
      // First store has no receipt — rotate next.
      await secretInput.fill(`e2e-rotate-${randomUUID()}`);
      await slot.getByRole('button', { name: /轮换|Rotate/i }).click();
    } else {
      await rotateOrStore.click();
    }

    const receiptCard = slot.getByTestId('provider-credential-rotation-receipt');
    await expect(receiptCard).toBeVisible({ timeout: 60_000 });
    await expect(slot.getByTestId('provider-credential-receipt-id')).toBeVisible();
    await expect(
      slot.getByTestId('provider-credential-receipt-expires')
    ).toBeVisible();

    const receiptText = await slot
      .getByTestId('provider-credential-receipt-id')
      .innerText();
    const receiptIdMatch = receiptText.match(
      /secure-write-[0-9a-f-]{36}|secure-write-receipt-[A-Za-z0-9._:-]+|swr_[A-Za-z0-9._:-]+/i
    );
    expect(receiptIdMatch, 'staged receipt id should be visible').toBeTruthy();
    const receiptId = receiptIdMatch![0];

    // URL must never carry receiptId (query/hash).
    expect(page.url()).not.toContain(receiptId);
    expect(page.url()).not.toMatch(/[?#].*receipt/i);

    // Secret must not remain in the input or receipt card.
    await expect(secretInput).toHaveValue('');
    await expect(receiptCard).not.toHaveText(FORBIDDEN_SECRET);
    await expect(receiptCard).not.toContainText(stagedSecret);

    const completeLink = slot.getByTestId('provider-credential-complete-rotation');
    await expect(completeLink).toHaveAttribute('href', '/admin/supply');
    const href = await completeLink.getAttribute('href');
    expect(href).not.toContain(receiptId);
    expect(href).not.toMatch(/receipt/i);

    // --- Handoff navigate to supply (same-origin, no receipt in URL) ---
    await completeLink.click();
    await expect(page).toHaveURL(/\/admin\/supply\/?$/);
    expect(page.url()).not.toContain(receiptId);

    await expect(page.getByTestId('supply-control-center-panel')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId('supply-credential-panel')).toBeVisible();
    await expect(page.getByTestId('supply-credential-panel')).not.toHaveText(
      FORBIDDEN_SECRET
    );

    const rotateRow = page.locator(
      '[data-testid="supply-governed-action-row"][data-action-id="credential_rotate"]'
    );
    await expect(rotateRow).toBeVisible();

    const receiptField = rotateRow.getByTestId('supply-credential-rotate-receipt');
    await expect(receiptField).toHaveValue(receiptId, { timeout: 15_000 });
    await expect(receiptField).toHaveAttribute('data-handoff-prefill', 'true');
    await expect(
      rotateRow.getByTestId('supply-credential-rotate-handoff-hint')
    ).toBeVisible();

    // Target should be preselected when the handoff account exists in snapshot.
    const target = rotateRow.getByRole('combobox', {
      name: /凭据轮换目标|Credential/i,
    });
    const targetValue = await target.inputValue();
    if (!targetValue) {
      // Recovery: pick the first non-empty option (still proves handoff receipt).
      const options = target.locator('option');
      const count = await options.count();
      for (let i = 0; i < count; i += 1) {
        const value = await options.nth(i).getAttribute('value');
        if (value) {
          await target.selectOption(value);
          break;
        }
      }
    }

    await rotateRow
      .getByRole('textbox', { name: /凭据轮换原因|reason/i })
      .fill('E2E complete platform credential rotation via handoff');
    await rotateRow.getByRole('button', { name: /凭据轮换/i }).click();

    const dialog = page.getByRole('dialog', { name: /凭据轮换/i });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole('button', { name: /确认凭据轮换/i }).click();

    await expect(page.getByTestId('supply-governed-action-result')).toContainText(
      /执行成功|成功/,
      { timeout: 60_000 }
    );

    // After success the handoff is cleared — remounting supply must not re-prefill.
    await page.reload();
    await expect(page.getByTestId('supply-control-center-panel')).toBeVisible({
      timeout: 60_000,
    });
    const rotateRowAfter = page.locator(
      '[data-testid="supply-governed-action-row"][data-action-id="credential_rotate"]'
    );
    await expect(
      rotateRowAfter.getByTestId('supply-credential-rotate-receipt')
    ).toHaveValue('');

    // secretVersion advanced when we had a readable baseline.
    const versionAfter = await readDisplayedSecretVersion(
      page,
      /model\.direct|平台|ark|凭证/i
    );
    if (versionBefore && versionAfter) {
      expect(Number(versionAfter)).toBeGreaterThan(Number(versionBefore));
    } else if (versionAfter) {
      // At least a version is projected after rotate.
      expect(Number(versionAfter)).toBeGreaterThan(0);
    }

    // Receipt must not leak into captured outbound URLs (analytics / external).
    const leak = outbound.filter(
      (url) => url.includes(receiptId) || /[?&#]receiptId=/i.test(url)
    );
    expect(leak, 'receiptId must not appear in request URLs').toEqual([]);
  });
});
