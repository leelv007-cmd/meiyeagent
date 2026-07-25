import { expect, test, type Page, type Request } from '@playwright/test';
import type {
  CopyStreamRequest,
  CreativeWorkbenchProjection,
} from '@meiye/contracts';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { seedConfirmedStore } from '../fixtures/product';
import { submitComposerJourney } from '../fixtures/ui-journey';

type P1Call = {
  action?: string;
  module?: string;
  payload?: Record<string, unknown>;
};

function p1Call(request: Request): P1Call | undefined {
  try {
    return request.postDataJSON() as P1Call;
  } catch {
    return undefined;
  }
}

function copyStreamRequestFromSubmit(
  call: P1Call | undefined
): CopyStreamRequest | undefined {
  const payload = call?.payload;
  const workId = payload?.workId;
  const submissionKey = payload?.submissionKey;
  const contract = payload?.contract;
  if (
    typeof workId !== 'string' ||
    typeof submissionKey !== 'string' ||
    !contract ||
    typeof contract !== 'object' ||
    typeof (contract as { catalogModelId?: unknown }).catalogModelId !==
      'string'
  ) {
    return undefined;
  }
  return {
    catalogModelId: (contract as { catalogModelId: string }).catalogModelId,
    contract: contract as CopyStreamRequest['contract'],
    submissionKey,
    workId,
  };
}

async function creativeProjection(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/core/p1/query', {
      body: JSON.stringify({
        action: 'creative_workbench',
        module: 'operations',
        payload: {},
      }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const envelope = (await response.json()) as {
      data?: CreativeWorkbenchProjection;
      error?: { message?: string };
    };
    if (!response.ok || !envelope.data) {
      throw new Error(envelope.error?.message ?? 'Creative projection failed');
    }
    return envelope.data;
  });
}

async function seedTaskInboxRows(page: Page, count: number) {
  await page.evaluate(async (rowCount) => {
    const dueAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    for (let index = 0; index < rowCount; index += 1) {
      const token = crypto.randomUUID();
      const response = await fetch('/api/core/p1/commands', {
        body: JSON.stringify({
          action: 'create_task',
          module: 'operations',
          payload: {
            dedupeKey: `mobile-return-anchor-${index}-${token}`,
            dueAt,
            executable: true,
            risk: 'normal',
            source: 'manual',
            title: `移动返回锚点任务 ${index + 1}`,
          },
        }),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `mobile-return-anchor-${index}-${token}`,
        },
        method: 'POST',
      });
      if (!response.ok) throw new Error(await response.text());
    }
  }, count);
}

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

test('keeps identity, assets, and camera authorization reachable on mobile', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const user = await registerE2EUser(request);
  try {
    await loginByForm(page, user);
    const mobileNav = page.getByRole('navigation', { name: '移动端导航' });
    await expect(mobileNav).toBeVisible();
    await expect(
      mobileNav.getByTestId('mobile-identity-assets-entry')
    ).toHaveAttribute('href', /^\/dashboard\/assets(?:\?|$)/u);
    for (const label of ['创作', '身份素材', '内容', '门店']) {
      await expect(mobileNav.getByText(label, { exact: true })).toBeVisible();
    }

    await mobileNav.getByText('身份素材', { exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/assets(?:\?|$)/u);
    await expect(page.getByRole('region', { name: '表达身份' })).toBeVisible();
    await expect(page.getByText('素材', { exact: true }).first()).toBeVisible();

    await mobileNav.getByText('创作', { exact: true }).click();
    await expect(
      page.getByRole('radiogroup', { name: '创作类型' })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '开始创作', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '拍照', exact: true })
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(390);
    await page.screenshot({
      path: 'test-results/evidence/p0-mobile-workbench.png',
      fullPage: true,
    });

    await page.goto('/dashboard/assets');
    const cameraInput = page.locator('input[type="file"]').first();
    await expect(cameraInput).toHaveAttribute('capture', 'environment');
    await expect(cameraInput).toHaveAttribute('accept', /image/);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(390);

    await page.goto('/dashboard/store');
    const leadLedgerLink = page.getByRole('link', { name: '线索台账' });
    await expect(leadLedgerLink).toBeVisible();
    await leadLedgerLink.click();
    await expect(page).toHaveURL(/\/dashboard\/leads$/);
  } finally {
    await cleanupE2EUsers(request);
  }
});

test.fixme(
  'keeps a running Copy Work on the exact mobile Result route and restores its typed source anchor (blocked: L3 needs accepted-quote stream or lifecycle hold)',
  async ({ page, request }) => {
    test.setTimeout(180_000);
    const user = await registerE2EUser(request);
    let releaseSubmitRequest = () => {};
    let releaseWorkbenchQuery = () => {};
    try {
      await loginByForm(page, user);
      await seedConfirmedStore(page);
      await seedTaskInboxRows(page, 18);

      const submitRequestGate = new Promise<void>((resolve) => {
        releaseSubmitRequest = resolve;
      });
      let copyStreamRequest: CopyStreamRequest | undefined;
      await page.route('**/api/core/p1/commands', async (route) => {
        const call = p1Call(route.request());
        if (
          call?.module === 'operations' &&
          call.action === 'submit_creative_work'
        ) {
          const input = copyStreamRequestFromSubmit(call);
          if (!input) {
            throw new Error(
              'submit_creative_work must carry a Copy stream contract'
            );
          }
          copyStreamRequest = input;
          await submitRequestGate;
        }
        await route.continue().catch(() => undefined);
      });

      const journey = submitComposerJourney(
        page,
        {
          deliveryTarget: 'wechat_moments',
          modality: 'copy',
          workspace: 'copy',
          expectedActivations: 2,
          packageFormat: 'text',
          packageButtonName: /朋友圈分段包/u,
          packageFileName: /朋友圈分段包\.txt$/u,
          resultSurfaceTestId: 'copy-image-text-worksurface',
        },
        `皮肤护理 移动进度真实文案 ${crypto.randomUUID()}`
      );
      void journey.catch(() => undefined);

      await expect
        .poll(() => copyStreamRequest, { timeout: 30_000 })
        .not.toBeUndefined();
      const runningCopyRequest = copyStreamRequest!;
      await expect(
        page.evaluate(async (input) => {
          const response = await fetch('/api/core/p1/copy/stream', {
            body: JSON.stringify(input),
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            method: 'POST',
          });
          if (!response.ok || !response.body) {
            throw new Error(`Copy stream failed: ${await response.text()}`);
          }
          const reader = response.body.getReader();
          const firstChunk = await reader.read();
          if (firstChunk.done || !firstChunk.value?.length) {
            throw new Error('Copy stream returned no first chunk');
          }
          (
            window as typeof window & {
              __e2eCopyStreamReader?: ReadableStreamDefaultReader<Uint8Array>;
            }
          ).__e2eCopyStreamReader = reader;
          return response.status;
        }, runningCopyRequest)
      ).toBe(200);
      await expect
        .poll(async () => {
          const projection = await creativeProjection(page);
          const work = projection.works.find(
            (candidate) => candidate.id === runningCopyRequest.workId
          );
          const job = projection.jobs.find(
            (candidate) => candidate.id === work?.currentJobId
          );
          return {
            operation: job?.contract.operation,
            status: job?.status,
            workId: work?.id,
          };
        })
        .toEqual({
          operation: 'copy.generate',
          status: 'running',
          workId: runningCopyRequest.workId,
        });

      const workbenchQueryGate = new Promise<void>((resolve) => {
        releaseWorkbenchQuery = resolve;
      });
      let holdWorkbenchQuery = true;
      let observedWorkbenchProjection: CreativeWorkbenchProjection | undefined;
      await page.route('**/api/core/p1/query', async (route) => {
        const call = p1Call(route.request());
        if (
          holdWorkbenchQuery &&
          call?.module === 'operations' &&
          call.action === 'creative_workbench'
        ) {
          const response = await route.fetch();
          const envelope = (await response.json()) as {
            data?: CreativeWorkbenchProjection;
          };
          observedWorkbenchProjection = envelope.data;
          await workbenchQueryGate;
          await route.fulfill({ json: envelope, response });
          return;
        }
        await route.fallback();
      });

      await page.goto(
        '/dashboard/tasks?date=all&mode=inbox&relatedKind=all&risk=all&source=manual&status=all'
      );
      await expect
        .poll(() => {
          const work = observedWorkbenchProjection?.works.find(
            (candidate) => candidate.id === runningCopyRequest.workId
          );
          const job = observedWorkbenchProjection?.jobs.find(
            (candidate) => candidate.id === work?.currentJobId
          );
          return { operation: job?.contract.operation, status: job?.status };
        })
        .toEqual({ operation: 'copy.generate', status: 'running' });
      const mobileNav = page.getByRole('navigation', { name: '移动端导航' });
      const progressEntry = mobileNav.getByTestId('mobile-progress-entry');
      await expect(progressEntry).toBeDisabled();
      await expect(progressEntry).not.toHaveAttribute('href');
      const entryBox = await progressEntry.boundingBox();
      if (!entryBox) throw new Error('Mobile progress entry was not rendered');
      await page.mouse.click(
        entryBox.x + entryBox.width / 2,
        entryBox.y + entryBox.height / 2
      );
      await expect(page).toHaveURL(/\/dashboard\/tasks/u);

      holdWorkbenchQuery = false;
      releaseWorkbenchQuery();
      await expect(progressEntry).toHaveAttribute(
        'href',
        new RegExp(
          `/dashboard/results/${encodeURIComponent(runningCopyRequest.workId)}(?:\\?|$)`,
          'u'
        )
      );

      await expect(page.getByText('移动返回锚点任务 18')).toBeVisible();
      const sourceScrollY = await page.evaluate(() => {
        const maximum =
          document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo(0, Math.min(320, Math.max(maximum, 0)));
        return window.scrollY;
      });
      expect(sourceScrollY).toBeGreaterThan(0);

      await progressEntry.click();
      await expect(page).toHaveURL((url) => {
        const search = url.searchParams;
        return (
          url.pathname === `/dashboard/results/${runningCopyRequest.workId}` &&
          search.get('returnTo') === 'task-inbox' &&
          search.get('returnDate') === 'all' &&
          search.get('returnPanel') === 'inbox' &&
          search.get('returnSource') === 'manual' &&
          search.get('returnScrollY') === String(sourceScrollY) &&
          search.get('returnFocusKey') === 'mobile-progress-entry'
        );
      });
      await expect(page.getByTestId('result-back')).toBeVisible({
        timeout: 60_000,
      });

      await page.reload();
      await expect(page).toHaveURL((url) => {
        return (
          url.pathname === `/dashboard/results/${runningCopyRequest.workId}` &&
          url.searchParams.get('returnTo') === 'task-inbox' &&
          url.searchParams.get('returnScrollY') === String(sourceScrollY)
        );
      });
      await expect(page.getByTestId('result-back')).toBeVisible({
        timeout: 60_000,
      });
      await page.getByTestId('result-back').click();

      await expect(page).toHaveURL((url) => {
        const search = url.searchParams;
        return (
          url.pathname === '/dashboard/tasks' &&
          search.get('date') === 'all' &&
          search.get('mode') === 'inbox' &&
          search.get('relatedKind') === 'all' &&
          search.get('risk') === 'all' &&
          search.get('source') === 'manual' &&
          search.get('status') === 'all' &&
          search.get('restoreScrollY') === String(sourceScrollY) &&
          search.get('restoreFocusKey') === 'mobile-progress-entry'
        );
      });
      await expect
        .poll(() => page.evaluate(() => window.scrollY))
        .toBe(sourceScrollY);
      await expect(progressEntry).toBeFocused();
      await expect(
        page.getByRole('button', { name: '任务', exact: true })
      ).toHaveAttribute('aria-pressed', 'true');

      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.dataset.globalCommandReady
          )
        )
        .toBe('true');
      await page.keyboard.press('Meta+K');
      const dialog = page.getByRole('dialog', {
        name: '全局命令：导航或添加到创作',
      });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute('aria-modal', 'true');
      await expect
        .poll(() =>
          dialog.evaluate((element) => element.contains(document.activeElement))
        )
        .toBe(true);
      await expect(page.locator('[aria-modal="true"]:visible')).toHaveCount(1);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(progressEntry).toBeFocused();
    } finally {
      releaseWorkbenchQuery();
      releaseSubmitRequest();
      await cleanupE2EUsers(request);
    }
  }
);

test('keeps mobile identity and assets reachable during a slow canonical query', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const user = await registerE2EUser(request);
  let releaseWorkbenchQuery = () => {};
  try {
    const workbenchQueryGate = new Promise<void>((resolve) => {
      releaseWorkbenchQuery = resolve;
    });
    let holdWorkbenchQuery = true;
    await page.route('**/api/core/p1/query', async (route) => {
      const call = p1Call(route.request());
      if (
        holdWorkbenchQuery &&
        call?.module === 'operations' &&
        call.action === 'creative_workbench'
      ) {
        await workbenchQueryGate;
      }
      await route.continue().catch(() => undefined);
    });

    await loginByForm(page, user);
    await page.goto(
      '/dashboard/tasks?date=all&mode=inbox&relatedKind=all&risk=all&source=manual&status=all'
    );
    const mobileNav = page.getByRole('navigation', { name: '移动端导航' });
    const identityAssetsEntry = mobileNav.getByTestId(
      'mobile-identity-assets-entry'
    );
    await expect(identityAssetsEntry).toHaveAttribute(
      'href',
      '/dashboard/assets'
    );
    await expect(page).toHaveURL(/\/dashboard\/tasks/u);

    holdWorkbenchQuery = false;
    releaseWorkbenchQuery();
    await expect(identityAssetsEntry).toHaveAttribute(
      'href',
      '/dashboard/assets'
    );
    await page.unroute('**/api/core/p1/query');
    await identityAssetsEntry.click();
    await expect(page).toHaveURL(/\/dashboard\/assets/u);
    await expect(page.getByRole('region', { name: '表达身份' })).toBeVisible();
  } finally {
    releaseWorkbenchQuery();
    await cleanupE2EUsers(request);
  }
});
