import { expect, test, type Page } from '@playwright/test';
import type {
  MemoryEntriesPage,
  MemoryInjectionReceipt,
} from '@meiye/contracts';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { seedConfirmedStore } from '../fixtures/product';
import {
  JOURNEY_CONTRACTS,
  submitComposerJourney,
  waitForResultJourney,
} from '../fixtures/ui-journey';

const DURABLE_PREFERENCE = '以后每次文案都简洁克制，请长期记住';

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

test.describe('V31-18 memory injection transparency (§37.4-B2)', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('task detail shows source, revoke persists, and the next task excludes it', async ({
    page,
    request,
  }) => {
    test.setTimeout(600_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);
    const copyContract = JOURNEY_CONTRACTS.find(
      (contract) => contract.modality === 'copy'
    )!;

    await page.goto('/dashboard');
    const sourceWorkId = await submitComposerJourney(
      page,
      copyContract,
      DURABLE_PREFERENCE
    );
    await waitForResultJourney(page, copyContract, sourceWorkId);

    let memoryEntryId = '';
    await expect
      .poll(async () => {
        const pageResult = await queryMemory<MemoryEntriesPage>(
          page,
          'entries_page',
          { limit: 20 }
        );
        const entry = pageResult.items.find(
          (candidate) => candidate.value === DURABLE_PREFERENCE
        );
        memoryEntryId = entry?.entryId ?? '';
        return entry?.status;
      })
      .toBe('pending');

    await page.goto('/dashboard/memory');
    const memoryCard = page.getByTestId(`memory-entry-${memoryEntryId}`);
    await memoryCard.getByRole('button', { name: '确认记住' }).click();
    await expect(memoryCard).toContainText('已确认');

    let injectedTaskId = '';
    await page.goto('/dashboard');
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

    let injectedMemoryId = '';
    await expect
      .poll(async () => {
        const result = await queryMemory<{
          receipt: MemoryInjectionReceipt | null;
        }>(page, 'injection_receipt', { taskId: injectedTaskId });
        injectedMemoryId = result.receipt?.entries[0]?.memoryId ?? '';
        return result.receipt?.entries.length ?? 0;
      })
      .toBeGreaterThan(0);

    await page.goto(`/dashboard?taskId=${encodeURIComponent(injectedTaskId)}`);
    const panel = page.getByTestId('memory-injection-receipt-panel');
    await expect(panel).toBeVisible();
    await expect(
      panel.getByTestId('memory-injection-receipt-statement')
    ).toContainText(DURABLE_PREFERENCE);
    await expect(
      panel.getByTestId('memory-injection-receipt-source')
    ).toContainText(injectedMemoryId);
    const revoke = panel.getByTestId(
      `memory-injection-receipt-revoke-${injectedMemoryId}`
    );
    await revoke.click();
    await expect(revoke).toBeDisabled();
    await expect(revoke).toContainText('已撤销');

    let laterTaskId = '';
    await page.goto('/dashboard');
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

    await expect
      .poll(async () => {
        const result = await queryMemory<{
          receipt: MemoryInjectionReceipt | null;
        }>(page, 'injection_receipt', { taskId: laterTaskId });
        return (
          result.receipt?.entries.some(
            (entry) => entry.memoryId === injectedMemoryId
          ) ?? false
        );
      })
      .toBe(false);
  });
});
