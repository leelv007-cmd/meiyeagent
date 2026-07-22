import { expect, test, type Page, type Response } from '@playwright/test';

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

function waitForP1Command(
  page: Page,
  module: string,
  action: string
): Promise<Response> {
  return page.waitForResponse(
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
          module?: unknown;
        };
        return body.module === module && body.action === action;
      } catch {
        return false;
      }
    },
    { timeout: 60_000 }
  );
}

test.describe('video Result canonical live commands', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    test.setTimeout(180_000);
    await cleanupE2EUsers(request);
  });

  test('persists edits and executes server quote → confirm → derived task', async ({
    page,
    request,
  }) => {
    test.setTimeout(360_000);
    const contract = JOURNEY_CONTRACTS.find(
      (candidate) => candidate.modality === 'video'
    )!;
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);
    await page.goto('/dashboard');
    const workId = await submitComposerJourney(
      page,
      contract,
      `video-live-commands-${crypto.randomUUID()}`
    );
    await waitForResultJourney(page, contract, workId);

    const candidate = page
      .locator('[data-testid="video-shot-candidate"][aria-pressed="false"]')
      .first();
    await expect(candidate).toBeVisible();
    const candidatePosition = await candidate.evaluate((element) =>
      Array.from(
        document.querySelectorAll('[data-testid="video-shot-candidate"]')
      ).indexOf(element)
    );
    const selectResponsePromise = waitForP1Command(
      page,
      'model-supply',
      'video_workflow_edit'
    );
    await candidate.click();
    const selectResponse = await selectResponsePromise;
    expect(selectResponse.ok(), await selectResponse.text()).toBeTruthy();
    await page.reload();
    await expect(
      page.getByTestId('video-shot-candidate').nth(candidatePosition)
    ).toHaveAttribute('aria-pressed', 'true');

    const firstShotBefore = await page
      .getByTestId('video-shot')
      .first()
      .innerText();
    const reorderResponsePromise = waitForP1Command(
      page,
      'model-supply',
      'video_workflow_edit'
    );
    await page.getByLabel('后移镜头 1').click();
    const reorderResponse = await reorderResponsePromise;
    expect(reorderResponse.ok(), await reorderResponse.text()).toBeTruthy();
    await page.reload();
    await expect(page.getByTestId('video-shot').first()).not.toHaveText(
      firstShotBefore
    );

    const subtitle = `已持久化字幕-${crypto.randomUUID()}`;
    await page.getByTestId('video-subtitle-input').fill(subtitle);
    const subtitleResponsePromise = waitForP1Command(
      page,
      'model-supply',
      'video_workflow_edit'
    );
    await page.getByTestId('video-subtitle-save').click();
    const subtitleResponse = await subtitleResponsePromise;
    expect(subtitleResponse.ok(), await subtitleResponse.text()).toBeTruthy();
    await page.reload();
    await expect(page.getByTestId('video-subtitle-input')).toHaveValue(
      subtitle
    );

    const quoteResponsePromise = waitForP1Command(
      page,
      'video-regeneration',
      'quote'
    );
    await page.getByTestId('video-shot-regenerate').first().click();
    const quoteResponse = await quoteResponsePromise;
    expect(quoteResponse.ok(), await quoteResponse.text()).toBeTruthy();
    const quoteRequest = quoteResponse.request().postDataJSON() as {
      payload: Record<string, unknown>;
    };
    expect(Object.keys(quoteRequest.payload).sort()).toEqual([
      'scope',
      'shotId',
      'sourceRunId',
    ]);
    expect(quoteRequest.payload).not.toHaveProperty('unitRate');
    expect(quoteRequest.payload).not.toHaveProperty('targetSeconds');
    await expect(page.getByTestId('video-regen-confirm')).toContainText('预估');

    const confirmResponsePromise = waitForP1Command(
      page,
      'video-regeneration',
      'confirm'
    );
    await page.getByTestId('video-regen-confirm-action').click();
    const confirmResponse = await confirmResponsePromise;
    expect(confirmResponse.ok(), await confirmResponse.text()).toBeTruthy();
    const confirmRequest = confirmResponse.request().postDataJSON() as {
      payload: { quoteId?: string; taskId?: string };
    };
    expect(confirmRequest.payload.quoteId).toBeTruthy();
    expect(confirmRequest.payload.taskId).toMatch(/^video-regen-/u);
    await expect(page.getByTestId('video-result-status')).toContainText(
      /成片生成中|成片待确认/u,
      { timeout: 60_000 }
    );
  });
});
