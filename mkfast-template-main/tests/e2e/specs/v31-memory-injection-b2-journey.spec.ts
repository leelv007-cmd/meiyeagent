import { expect, test, type Page } from '@playwright/test';
import type { MemoryEntriesPage } from '@meiye/contracts';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { seedConfirmedStore } from '../fixtures/product';
import {
  JOURNEY_CONTRACTS,
  closeComposerCapsule,
  openComposerCapsule,
  submitComposerJourney,
  waitForResultJourney,
} from '../fixtures/ui-journey';

/**
 * Two durable preferences, not one. With a single memory, revoking it makes a
 * MemoryInjectionReceipt structurally impossible, so `toHaveCount(0)` on the
 * revoked entry passes identically when the whole memory layer is broken — the
 * assertion cannot distinguish "revoke worked" from "nothing was ever
 * injected". The surviving preference is the control: every negative assertion
 * about the revoked one is paired with a positive assertion about the survivor.
 *
 * The former "style constraint took effect" assertions (title ≤ 24 / body ≤ 32 /
 * no forbidden phrase) are deliberately gone. They passed only because the
 * fixture runner regexes its own prompt for `正文不超过 32 字` and then returns
 * hard-coded conforming copy (`ai-sdk-runner.ts:1657`), so they measured the
 * fixture, not the product. Real enforcement of those constraints is unit-tested
 * against real output in `assessMemoryStyleCompliance`
 * (`apps/core/src/p1/harness/make-snapshot-consume.ts`); this journey proves
 * human-readable source preview/deletion fallback, revocation and
 * non-recurrence only.
 */
const REVOKED_PREFERENCE = '以后每次文案都简洁克制，请长期记住';
const SURVIVING_PREFERENCE = '以后每次文案都先说门店位置，请长期记住';

async function selectDestination(page: Page, destination: string) {
  const panel = await openComposerCapsule(page, 'destination');
  await page.getByTestId(`composer-destination-option-${destination}`).click();
  await closeComposerCapsule(page, panel);
}

async function queryMemory<T>(
  page: Page,
  action: string,
  payload: Record<string, unknown>
): Promise<T> {
  return page.evaluate(
    async ({ action: requestAction, payload: requestPayload }) => {
      const response = await fetch('/api/core/p1/query', {
        body: JSON.stringify({
          action: requestAction,
          module: 'memory',
          payload: requestPayload,
        }),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      const envelope = (await response.json()) as {
        data?: unknown;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(envelope.error?.message ?? 'Memory query failed');
      }
      return envelope.data as T;
    },
    { action, payload }
  );
}

/** Poll until the submitted instruction has become a pending memory entry. */
async function pendingEntryId(page: Page, value: string): Promise<string> {
  let entryId = '';
  await expect
    .poll(async () => {
      const pageResult = await queryMemory<MemoryEntriesPage>(
        page,
        'entries_page',
        { limit: 50 }
      );
      const entry = pageResult.items.find(
        (candidate) => candidate.value === value
      );
      entryId = entry?.entryId ?? '';
      return entry?.status;
    })
    .toBe('pending');
  expect(entryId).toBeTruthy();
  return entryId;
}

async function confirmEntry(page: Page, entryId: string) {
  await page.goto('/dashboard/memory');
  const memoryCard = page.getByTestId(`memory-entry-${entryId}`);
  await memoryCard.getByRole('button', { name: '确认记住' }).click();
  await expect(memoryCard).toContainText('已确认');
}

async function deleteEntrySource(page: Page, entryId: string) {
  await page.goto('/dashboard/memory');
  const memoryCard = page.getByTestId(`memory-entry-${entryId}`);
  await memoryCard.getByRole('button', { name: '删除来源对话' }).click();
  await expect(memoryCard.getByTestId('memory-entry-provenance')).toContainText(
    '来源对话已删除'
  );
}

/**
 * Map each receipted statement to the memoryId the panel renders for it.
 *
 * Correlate by statement, never by the memory-page `entryId`: a pending entry's
 * id is the candidateId (`reuse-memory-service.ts:753`) while the receipt
 * carries the confirmed preference head's memoryId, so the two are not
 * interchangeable.
 */
async function receiptedMemoryIdsByStatement(
  page: Page
): Promise<Map<string, string>> {
  const panel = page.getByTestId('memory-injection-receipt-panel');
  await expect(panel).toBeVisible();
  const rows = await panel
    .locator('[data-testid^="memory-injection-receipt-entry-"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        memoryId: (node.getAttribute('data-testid') ?? '').replace(
          'memory-injection-receipt-entry-',
          ''
        ),
        statement:
          node
            .querySelector('[data-testid="memory-injection-receipt-statement"]')
            ?.textContent?.trim() ?? '',
      }))
    );
  return new Map(rows.map((row) => [row.statement, row.memoryId]));
}

async function openTaskDetail(page: Page, taskId: string) {
  const receiptLoaded = page.waitForResponse((response) => {
    const body = response.request().postData() ?? '';
    return (
      response.url().includes('/api/core/p1/query') &&
      body.includes('injection_receipt') &&
      body.includes(taskId)
    );
  });
  await page.goto(`/dashboard?taskId=${encodeURIComponent(taskId)}`);
  await receiptLoaded;
  await expect(page.getByTestId('agent-workbench-host')).toBeVisible();
}

test.describe('V31-18 memory injection transparency (§37.4-B2)', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('revoking one of two confirmed memories stops only that one from injecting', async ({
    page,
    request,
  }) => {
    test.setTimeout(900_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);
    const copyContract = JOURNEY_CONTRACTS.find(
      (contract) => contract.modality === 'copy'
    )!;

    // Two submissions, each stating one durable preference, then both confirmed.
    await page.goto('/dashboard');
    await selectDestination(page, copyContract.deliveryTarget);
    const firstWorkId = await submitComposerJourney(
      page,
      copyContract,
      REVOKED_PREFERENCE
    );
    await waitForResultJourney(page, copyContract, firstWorkId);
    const revokedEntryId = await pendingEntryId(page, REVOKED_PREFERENCE);
    await confirmEntry(page, revokedEntryId);

    await page.goto('/dashboard');
    await selectDestination(page, copyContract.deliveryTarget);
    const secondWorkId = await submitComposerJourney(
      page,
      copyContract,
      SURVIVING_PREFERENCE
    );
    await waitForResultJourney(page, copyContract, secondWorkId);
    const survivingEntryId = await pendingEntryId(page, SURVIVING_PREFERENCE);
    await confirmEntry(page, survivingEntryId);

    // A task after both confirmations must receipt BOTH — this is the positive
    // baseline the later negative assertion is measured against.
    let injectedTaskId = '';
    await page.goto('/dashboard');
    await selectDestination(page, copyContract.deliveryTarget);
    const injectedWorkId = await submitComposerJourney(
      page,
      copyContract,
      '再写一条周末护理到店文案',
      {
        onSubmissionAccepted({ taskId }) {
          injectedTaskId = taskId;
        },
      }
    );
    await waitForResultJourney(page, copyContract, injectedWorkId);
    // The merchant's own words are memory, never delivered copy.
    await expect(
      page.getByTestId(copyContract.resultSurfaceTestId)
    ).not.toContainText(REVOKED_PREFERENCE);
    await expect(
      page.getByTestId(copyContract.resultSurfaceTestId)
    ).not.toContainText(SURVIVING_PREFERENCE);

    await openTaskDetail(page, injectedTaskId);
    const receipted = await receiptedMemoryIdsByStatement(page);
    const revokedMemoryId = receipted.get(REVOKED_PREFERENCE);
    const survivingMemoryId = receipted.get(SURVIVING_PREFERENCE);
    expect(
      revokedMemoryId,
      'the confirmed preference to be revoked must be receipted'
    ).toBeTruthy();
    expect(
      survivingMemoryId,
      'the surviving confirmed preference must be receipted'
    ).toBeTruthy();
    expect(revokedMemoryId).not.toBe(survivingMemoryId);

    const receiptPanel = page.getByTestId('memory-injection-receipt-panel');
    const revokedReceiptRow = receiptPanel.getByTestId(
      `memory-injection-receipt-entry-${revokedMemoryId}`
    );
    const survivingReceiptRow = receiptPanel.getByTestId(
      `memory-injection-receipt-entry-${survivingMemoryId}`
    );
    const revokedSource = revokedReceiptRow.getByTestId(
      'memory-injection-receipt-source'
    );
    const survivingSource = survivingReceiptRow.getByTestId(
      'memory-injection-receipt-source'
    );
    await expect(revokedSource).toContainText(REVOKED_PREFERENCE);
    await expect(revokedSource).toContainText(/因为你 .+ 说过：/u);
    await expect(survivingSource).toContainText(SURVIVING_PREFERENCE);
    await expect(survivingSource).toContainText(/因为你 .+ 说过：/u);

    // Source deletion is projected dynamically onto the immutable receipt:
    // only the deleted source loses its preview, while the other stays legible.
    await deleteEntrySource(page, survivingEntryId);
    await openTaskDetail(page, injectedTaskId);
    const refreshedPanel = page.getByTestId('memory-injection-receipt-panel');
    const refreshedSurvivor = refreshedPanel.getByTestId(
      `memory-injection-receipt-entry-${survivingMemoryId}`
    );
    await expect(
      refreshedSurvivor.getByTestId('memory-injection-receipt-source')
    ).toContainText('来源对话已删除');
    await expect(
      refreshedSurvivor.getByTestId('memory-injection-receipt-source')
    ).not.toContainText(SURVIVING_PREFERENCE);
    await expect(
      refreshedPanel
        .getByTestId(`memory-injection-receipt-entry-${revokedMemoryId}`)
        .getByTestId('memory-injection-receipt-source')
    ).toContainText(REVOKED_PREFERENCE);

    // Revoke exactly one.
    const panel = refreshedPanel;
    await panel
      .getByTestId(`memory-injection-receipt-revoke-${revokedMemoryId}`)
      .click();

    // V31-34: revoke UI authority is the server projection (currentStatus on
    // injection_receipt), not a local Set — so disabled/已撤销 survive reload.
    await expect(
      panel.getByTestId(`memory-injection-receipt-revoke-${revokedMemoryId}`)
    ).toBeDisabled();
    await expect(
      panel.getByTestId(`memory-injection-receipt-revoke-${revokedMemoryId}`)
    ).toHaveText('已撤销');
    // The survivor stays revocable — a blanket disable would also satisfy the
    // assertion above.
    await expect(
      panel.getByTestId(`memory-injection-receipt-revoke-${survivingMemoryId}`)
    ).toBeEnabled();
    await expect(
      panel.getByTestId(`memory-injection-receipt-revoke-${survivingMemoryId}`)
    ).toHaveText('撤销，之后不再使用');

    // Server truth, independent of the panel.
    const entriesAfterRevoke = await queryMemory<MemoryEntriesPage>(
      page,
      'entries_page',
      { limit: 50 }
    );
    expect(
      entriesAfterRevoke.items.find(
        (entry) => entry.entryId === survivingEntryId
      )?.status
    ).toBe('confirmed');
    expect(
      entriesAfterRevoke.items.find((entry) => entry.entryId === revokedEntryId)
        ?.status
    ).not.toBe('confirmed');

    // Refresh must keep the revoked row disabled and the survivor enabled.
    await openTaskDetail(page, injectedTaskId);
    const afterReloadPanel = page.getByTestId('memory-injection-receipt-panel');
    await expect(
      afterReloadPanel.getByTestId(
        `memory-injection-receipt-revoke-${revokedMemoryId}`
      )
    ).toBeDisabled();
    await expect(
      afterReloadPanel.getByTestId(
        `memory-injection-receipt-revoke-${revokedMemoryId}`
      )
    ).toHaveText('已撤销');
    await expect(
      afterReloadPanel.getByTestId(
        `memory-injection-receipt-revoke-${survivingMemoryId}`
      )
    ).toBeEnabled();
    await expect(
      afterReloadPanel.getByTestId(
        `memory-injection-receipt-revoke-${survivingMemoryId}`
      )
    ).toHaveText('撤销，之后不再使用');

    // The next task must still receipt the survivor and must not receipt the
    // revoked one. The positive half is what makes this test fail if memory
    // retrieval is broken outright, instead of passing vacuously.
    let laterTaskId = '';
    await page.goto('/dashboard');
    await selectDestination(page, copyContract.deliveryTarget);
    const laterWorkId = await submitComposerJourney(
      page,
      copyContract,
      '撤销后再写一条到店文案',
      {
        onSubmissionAccepted({ taskId }) {
          laterTaskId = taskId;
        },
      }
    );
    await waitForResultJourney(page, copyContract, laterWorkId);

    await openTaskDetail(page, laterTaskId);
    const laterPanel = page.getByTestId('memory-injection-receipt-panel');
    await expect(laterPanel).toBeVisible();
    await expect(
      laterPanel.getByTestId(
        `memory-injection-receipt-entry-${survivingMemoryId}`
      )
    ).toHaveCount(1);
    await expect(
      laterPanel.getByTestId(
        `memory-injection-receipt-entry-${revokedMemoryId}`
      )
    ).toHaveCount(0);
    await expect(
      laterPanel.getByTestId('memory-injection-receipt-statement')
    ).not.toContainText(REVOKED_PREFERENCE);
    const laterSurvivorSource = laterPanel
      .getByTestId(`memory-injection-receipt-entry-${survivingMemoryId}`)
      .getByTestId('memory-injection-receipt-source');
    await expect(laterSurvivorSource).toContainText('来源对话已删除');
    await expect(laterSurvivorSource).not.toContainText(SURVIVING_PREFERENCE);
  });
});
