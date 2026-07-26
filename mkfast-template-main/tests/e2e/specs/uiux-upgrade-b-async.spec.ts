import { expect, test, type Page, type Request } from '@playwright/test';
import type { CreativeWorkbenchProjection } from '@meiye/contracts';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { evidencePath } from '../fixtures/evidence';

interface P1Call {
  action?: string;
  module?: string;
}

function p1Call(request: Request): P1Call | undefined {
  try {
    return request.postDataJSON() as P1Call;
  } catch {
    return undefined;
  }
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
      error?: { message: string };
    };
    if (!response.ok || !envelope.data) {
      throw new Error(envelope.error?.message ?? 'Creative projection failed');
    }
    return envelope.data;
  });
}

/**
 * M-04 DEMOTED (T37 / #231).
 *
 * This journey drives the retired unified creation workbench —
 * 「建立创作记录」, 「快速起步预设」, `execute-tool-action`,
 * `workbench-result-hero` — which the Z1 cutover removed from `src` (see
 * `src/product/composer/z1-cutover-retirement.static.test.ts`: the workbench
 * files are asserted physically absent). It cannot pass, and it must not be
 * mistaken for coverage of the shipped Composer.
 *
 * It is demoted rather than deleted: the disposition matrix approves no
 * deletion batch for these specs, and the asynchronous-Job contracts it
 * describes (one Job observable across routes, no fake percentage, no silent
 * auto-resume) are still worth relanding on the conversation container. The
 * required browser gate is `m04-browser-hard-gate.spec.ts`.
 */
test.describe.fixme('UI/UX Upgrade B asynchronous job contracts', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('keeps one image Job observable across routes and completes it without a manual refresh or fake percentage', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    const taskCenter = page.getByLabel('异步任务中心');
    await expect(
      taskCenter.getByRole('button', { name: '任务', exact: true })
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          Object.keys(window.localStorage).some((key) =>
            key.startsWith('meiye:async-task-center:')
          )
        )
      )
      .toBe(true);

    await page
      .getByLabel('描述这次想创作的内容')
      .fill('生成一张用于验证后台任务自动回收的美甲项目图片');
    await page.getByRole('button', { name: '建立创作记录' }).click();
    const record = page.getByLabel('Agent 创作记录');
    await expect(record).toBeVisible();
    await record
      .getByRole('group', { name: '快速起步预设' })
      .getByRole('button', { name: /^图片生成/ })
      .click();

    const durationSummary = record
      .getByText('预计产出与历史耗时', { exact: true })
      .locator('..');
    await expect(durationSummary).toBeVisible();
    const durationText = await durationSummary.innerText();
    expect(durationText).toMatch(
      /(?:暂无足够真实样本[\s\S]*不展示猜测耗时|通常约[^\n]+[–-][^\n]+[\s\S]*基于最近 30 天 \d+ 次可核对的生产完成记录)/
    );
    expect(durationText).not.toMatch(/约\s*(?:12|45|90)\s*秒/);

    let releaseProviderQueries = () => {};
    const providerQueryGate = new Promise<void>((resolve) => {
      releaseProviderQueries = resolve;
    });
    let providerPollCount = 0;
    let automaticResumeCount = 0;

    await page.route('**/api/core/p1/query', async (route) => {
      const call = p1Call(route.request());
      if (call?.module === 'model-supply' && call.action === 'job') {
        providerPollCount += 1;
        await providerQueryGate;
      }
      await route.continue().catch(() => undefined);
    });
    // T37 / M-04: the submit hold that used to sit here waited on a command the
    // Composer no longer emits, so it never held anything — the 「正在提交生成
    // 请求」 assertion below was passing against an unheld request.
    page.on('request', (outgoing) => {
      if (!outgoing.url().includes('/api/core/p1/commands')) return;
      const call = p1Call(outgoing);
      if (
        call?.module === 'operations' &&
        call.action === 'resume_creative_job'
      ) {
        automaticResumeCount += 1;
      }
    });

    const acceptance = record.getByRole('checkbox', {
      name: /接受.*执行合同/,
    });
    await expect(acceptance).toBeEnabled();
    await acceptance.check();
    await page.getByTestId('execute-tool-action').click();
    await expect(
      record.getByText('正在提交生成请求', { exact: true })
    ).toBeVisible();
    await page.screenshot({
      fullPage: true,
      path: evidencePath(
        'uiux-upgrade-b/screenshots/09a-job-submitting-desktop.png'
      ),
    });

    let jobId = '';
    await expect
      .poll(
        async () => {
          const projection = await creativeProjection(page);
          const currentWork = projection.works[0];
          const currentJob = projection.jobs.find(
            (job) => job.id === currentWork?.currentJobId
          );
          jobId = currentJob?.id ?? '';
          return currentJob?.status;
        },
        { timeout: 30_000 }
      )
      .toBe('running');
    expect(jobId).not.toBe('');
    await expect.poll(() => providerPollCount).toBeGreaterThan(0);

    await page
      .getByRole('link', { name: '资产库', exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(/\/dashboard\/assets$/);

    const taskToggle = taskCenter.getByRole('button');
    try {
      await expect(taskToggle).toContainText('1 个进行中');
      await taskToggle.click();
      const panel = page.locator('#async-task-center-panel');
      await expect(panel).toBeVisible();
      await expect(panel.getByText(/执行中|已排队/)).toBeVisible();
      await expect(
        panel.getByText(/已运行(?:不足 1 分钟|约 \d+ 分钟)/)
      ).toBeVisible();
      await expect(
        panel.getByRole('link', { name: '打开任务' })
      ).toHaveAttribute('href', `/dashboard/jobs/${jobId}`);
      await expect(panel.getByRole('progressbar')).toHaveCount(0);
      expect(await panel.innerText()).not.toMatch(/\b\d+(?:\.\d+)?\s*%/);
      await page.screenshot({
        fullPage: true,
        path: evidencePath(
          'uiux-upgrade-b/screenshots/09b-job-running-desktop.png'
        ),
      });
      await page.setViewportSize({ height: 844, width: 390 });
      await expect(panel).toBeVisible();
      await page.screenshot({
        fullPage: true,
        path: evidencePath(
          'uiux-upgrade-b/screenshots/09c-job-running-mobile.png'
        ),
      });
      await page.setViewportSize({ height: 900, width: 1440 });
      await taskToggle.click();
      await expect(taskToggle).toHaveAttribute('aria-expanded', 'false');
    } finally {
      releaseProviderQueries();
    }

    await expect
      .poll(() => automaticResumeCount, { timeout: 60_000 })
      .toBeGreaterThan(0);
    await expect
      .poll(
        async () => {
          const projection = await creativeProjection(page);
          return projection.jobs.find((job) => job.id === jobId)?.status;
        },
        { timeout: 60_000 }
      )
      .toBe('completed');
    expect(automaticResumeCount).toBe(1);

    await expect(
      taskCenter.getByText('1 个任务有新结果', { exact: true })
    ).toHaveText('1 个任务有新结果');
    await expect(taskToggle).toContainText('1');
    await expect(taskToggle).not.toContainText('进行中');
    await page.screenshot({
      fullPage: true,
      path: evidencePath(
        'uiux-upgrade-b/screenshots/10a-task-center-unread-collapsed-desktop.png'
      ),
    });
    await taskToggle.click();

    const completedPanel = page.locator('#async-task-center-panel');
    await expect(completedPanel).toBeVisible();
    await expect(
      completedPanel.getByText('已完成', { exact: true })
    ).toBeVisible();
    await expect(
      completedPanel.getByText(/总用时(?:不足 1 分钟|约 \d+ 分钟)/)
    ).toBeVisible();
    const returnLink = completedPanel.getByRole('link', { name: '打开任务' });
    await expect(returnLink).toHaveAttribute(
      'href',
      `/dashboard/jobs/${jobId}`
    );
    await expect(completedPanel.getByRole('progressbar')).toHaveCount(0);
    expect(await completedPanel.innerText()).not.toMatch(/\b\d+(?:\.\d+)?\s*%/);
    await page.screenshot({
      fullPage: true,
      path: evidencePath(
        'uiux-upgrade-b/screenshots/10-async-task-center-desktop.png'
      ),
    });
    await page.setViewportSize({ height: 844, width: 390 });
    await expect(completedPanel).toBeVisible();
    await page.screenshot({
      fullPage: true,
      path: evidencePath(
        'uiux-upgrade-b/screenshots/10b-task-center-completed-mobile.png'
      ),
    });
    await page.setViewportSize({ height: 900, width: 1440 });

    const completed = await creativeProjection(page);
    expect(completed.jobs).toHaveLength(1);
    expect(completed.jobs[0]).toMatchObject({ id: jobId, status: 'completed' });
    expect(completed.assets).toHaveLength(1);

    await returnLink.click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/jobs/${jobId}$`));
    await expect(
      page.getByRole('heading', { level: 1, name: '执行详情' })
    ).toBeVisible();
    await expect(
      page.getByText('已完成', { exact: true }).first()
    ).toBeVisible();
  });
});
