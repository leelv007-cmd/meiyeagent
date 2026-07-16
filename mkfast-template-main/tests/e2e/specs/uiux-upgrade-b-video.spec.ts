import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { seedAuthorizedGrounding } from '../fixtures/product';

type VideoWorkflowStatus =
  | 'draft'
  | 'running'
  | 'awaiting_quality_review'
  | 'cancel_requested'
  | 'completed'
  | 'cancelled'
  | 'failed';

interface VideoWorkflowEnvelope {
  job: { error?: string | null; status?: string } | null;
  workflow: {
    composedAsset?: { objectKey: string };
    confirmed: boolean;
    derivedFromWorkflowId?: string;
    id: string;
    revision: number;
    shots: Array<{
      candidates: Array<{ status: string }>;
      prompt: string;
      selectedCandidateIndex?: number;
    }>;
    status: VideoWorkflowStatus;
    storyboardVersion: number;
  };
}

interface CreativeProjection {
  jobs: Array<{ contract: { operation: string }; id: string }>;
  works: Array<{ id: string }>;
}

interface VideoContentPackage {
  id: string;
  kind: 'image_text' | 'video';
  source: {
    assetIds: string[];
    workflowId?: string;
    workId?: string;
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
      data?: CreativeProjection;
      error?: { message: string };
    };
    if (!response.ok || !envelope.data) {
      throw new Error(envelope.error?.message ?? 'Creative projection failed');
    }
    return envelope.data;
  });
}

async function contentPackages(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/core/p1/query', {
      body: JSON.stringify({
        action: 'content_packages',
        module: 'operations',
        payload: {},
      }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const envelope = (await response.json()) as {
      data?: VideoContentPackage[];
      error?: { message: string };
    };
    if (!response.ok || !envelope.data) {
      throw new Error(envelope.error?.message ?? 'ContentPackage query failed');
    }
    return envelope.data;
  });
}

async function createUnrelatedContentPackage(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/core/p1/commands', {
      body: JSON.stringify({
        action: 'create_content_package',
        module: 'operations',
        payload: { kind: 'image_text', source: { assetIds: [] } },
      }),
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'video-e2e-unrelated-content-package',
      },
      method: 'POST',
    });
    const envelope = (await response.json()) as {
      data?: { id: string };
      error?: { message: string };
    };
    if (!response.ok || !envelope.data) {
      throw new Error(
        envelope.error?.message ?? 'Unrelated ContentPackage creation failed'
      );
    }
    return envelope.data;
  });
}

async function latestVideoWorkflow(page: Page, workId: string) {
  return page.evaluate(async (currentWorkId) => {
    const response = await fetch('/api/core/p1/query', {
      body: JSON.stringify({
        action: 'video_workflow_latest',
        module: 'model-supply',
        payload: { workId: currentWorkId },
      }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const envelope = (await response.json()) as {
      data?: VideoWorkflowEnvelope | null;
      error?: { message: string };
    };
    if (!response.ok) {
      throw new Error(envelope.error?.message ?? 'Video workflow query failed');
    }
    return envelope.data ?? null;
  }, workId);
}

async function createWork(page: Page, intent: string) {
  await page.getByLabel('描述这次想创作的内容').fill(intent);
  await page.getByRole('button', { name: '建立创作记录' }).click();
  const record = page.getByLabel('创作助理整理的记录');
  await expect(record).toBeVisible();
  await expect(page).toHaveURL(/[?&]workId=/u);
  await record.getByRole('button', { name: '采用并确认 Brief' }).click();
  await expect(record.getByText('Brief 已确认', { exact: true })).toBeVisible();
  return record;
}

async function openVideoComposer(record: Locator) {
  await record
    .getByRole('group', { name: '成品类型' })
    .getByRole('button', { name: /^做视频/ })
    .click();
  await record.getByRole('button', { name: /^调整专业参数/ }).click();
  const checkedModel = record
    .getByRole('radiogroup', { name: '执行模型' })
    .getByRole('radio', { checked: true });
  if ((await checkedModel.count()) === 0) {
    await record
      .getByRole('radiogroup', { name: '执行模型' })
      .locator('[role="radio"]:not([disabled])')
      .first()
      .click();
  }
  await expect(checkedModel).toHaveCount(1);
  await expect(record.getByText('本地测试可用', { exact: true })).toBeVisible();
  await expect(
    record.getByText(
      '当前结果来自本地测试数据，仅用于完整体验流程，不代表生产模型已验证。',
      { exact: true }
    )
  ).toBeVisible();

  const acceptance = record.getByRole('checkbox', {
    name: /我已确认模型、规格、费用和发布标识/,
  });
  await expect(acceptance).toBeEnabled();
  await acceptance.click();
  await expect(acceptance).toBeChecked();

  const panel = record.getByLabel('视频成片工作流');
  await expect(panel).toBeVisible();
  return panel;
}

async function openMobileVideoProgress(page: Page) {
  await expect(page.getByRole('heading', { name: '移动工作台' })).toBeVisible();
  await page.getByRole('tab', { name: '进度' }).click();
  const panel = page.getByLabel('视频成片工作流');
  await expect(panel).toBeVisible();
  return panel;
}

async function finishWorkflowAndReviewIfRequired(
  page: Page,
  panel: Locator,
  workId: string
) {
  const deadline = Date.now() + 150_000;
  let lastEnvelope: VideoWorkflowEnvelope | null = null;
  let reviewSelections = 0;
  let sawBackgroundStatus = false;

  while (Date.now() < deadline) {
    const envelope = await latestVideoWorkflow(page, workId);
    lastEnvelope = envelope;
    if (!envelope) throw new Error('Video workflow disappeared after confirm');
    if (envelope.job?.status === 'failed') {
      throw new Error(
        `Video worker failed: ${envelope.job.error ?? 'no worker error returned'}`
      );
    }

    if (envelope.workflow.status === 'completed') {
      return { envelope, reviewSelections, sawBackgroundStatus };
    }
    if (
      envelope.workflow.status === 'cancelled' ||
      envelope.workflow.status === 'cancel_requested'
    ) {
      throw new Error(
        `Video workflow unexpectedly entered ${envelope.workflow.status}`
      );
    }

    if (envelope.workflow.status === 'awaiting_quality_review') {
      await expect(
        panel.getByRole('heading', { name: '等待镜头复核' })
      ).toBeVisible({ timeout: 10_000 });
      const selection = panel
        .getByRole('button', { name: /^选择分镜 \d+ 候选 \d+$/ })
        .first();
      await expect(selection).toBeEnabled();
      const previousRevision = envelope.workflow.revision;
      await selection.click();
      await expect
        .poll(
          async () =>
            (await latestVideoWorkflow(page, workId))?.workflow.revision ??
            previousRevision,
          { timeout: 30_000 }
        )
        .toBeGreaterThan(previousRevision);
      reviewSelections += 1;
      continue;
    }

    if (envelope.workflow.status === 'running' && !sawBackgroundStatus) {
      await expect(
        panel.getByRole('heading', { name: '后台生成中' })
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        panel.getByText('已提交后台，可以离开此页，返回后会恢复同一任务。', {
          exact: true,
        })
      ).toBeVisible();
      sawBackgroundStatus = true;
    }

    await page.waitForTimeout(500);
  }

  throw new Error(
    `Video workflow did not complete before the E2E deadline: ${JSON.stringify({
      job: lastEnvelope?.job,
      reviewSelections,
      shots: lastEnvelope?.workflow.shots.map((shot) => ({
        candidates: shot.candidates.map((candidate) => candidate.status),
        selectedCandidateIndex: shot.selectedCandidateIndex,
      })),
      status: lastEnvelope?.workflow.status,
    })}`
  );
}

test.describe('UI/UX Upgrade B durable video workflow', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('a Work edits and restores V1, then the real fixture worker completes one durable video workflow', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const commandActions: Array<{ action: string; module: string }> = [];
    const legacyProcessRequests: string[] = [];
    page.on('request', (browserRequest) => {
      if (
        new URL(browserRequest.url()).pathname ===
        '/api/core/product/video/process'
      ) {
        legacyProcessRequests.push(browserRequest.method());
      }
      if (!browserRequest.url().includes('/api/core/p1/commands')) return;
      const body = browserRequest.postDataJSON() as {
        action?: string;
        module?: string;
      } | null;
      if (body?.action && body.module) {
        commandActions.push({ action: body.action, module: body.module });
      }
    });

    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedAuthorizedGrounding(page);
    const record = await createWork(
      page,
      '为真实美甲到店过程制作一条克制可信的竖屏视频'
    );
    const workId = (await creativeProjection(page)).works[0]?.id;
    expect(workId).toBeTruthy();
    if (!workId) throw new Error('Created Work has no id');

    let panel = await openVideoComposer(record);
    const storyboard = [
      ['Attention 抓住注意', '镜头一：自然光下展示猫眼纹理，不夸大效果。'],
      ['Interest 建立兴趣', '镜头二：展示真实到店环境与消毒准备。'],
      ['Desire 激发向往', '镜头三：展示操作细节，并保留个体差异。'],
      ['Action 引导行动', '镜头四：提示先咨询适配款式，不制造紧迫感。'],
    ] as const;
    for (const [label, prompt] of storyboard) {
      await panel.getByLabel(label).fill(prompt);
    }

    await panel.getByRole('button', { name: '锁定分镜' }).click();
    await expect(panel.getByText('分镜版本 V1', { exact: true })).toBeVisible();
    await expect(
      panel.getByRole('heading', { name: '分镜已锁定' })
    ).toBeVisible();
    const locked = await latestVideoWorkflow(page, workId);
    expect(locked?.workflow.storyboardVersion).toBe(1);
    expect(locked?.workflow.shots.map((shot) => shot.prompt)).toEqual(
      storyboard.map(([, prompt]) => prompt)
    );
    const v1WorkflowId = locked?.workflow.id;
    expect(v1WorkflowId).toBeTruthy();
    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/uiux-upgrade-b/screenshots/07-video-workflow-draft-desktop.png',
    });

    panel = page.getByLabel('创作助理整理的记录').getByLabel('视频成片工作流');
    await expect(
      panel.getByRole('button', { name: '以此新建分镜版本' })
    ).toBeVisible();
    await panel.getByRole('button', { name: '以此新建分镜版本' }).click();
    const revisedOpening =
      '镜头一：自然光下展示猫眼纹理，并补充同角度近景，不夸大效果。';
    await panel.getByLabel('Attention 抓住注意').fill(revisedOpening);
    await panel.getByRole('button', { name: '锁定分镜' }).click();
    await expect(panel.getByText('分镜版本 V2', { exact: true })).toBeVisible();
    const revised = await latestVideoWorkflow(page, workId);
    const workflowId = revised?.workflow.id;
    expect(workflowId).toBeTruthy();
    expect(workflowId).not.toBe(v1WorkflowId);
    expect(revised?.workflow.derivedFromWorkflowId).toBe(v1WorkflowId);
    expect(revised?.workflow.shots[0]?.prompt).toBe(revisedOpening);

    await page.reload();
    const restoredRecord = page.getByLabel('创作助理整理的记录');
    await expect(restoredRecord).toBeVisible();
    panel = await openVideoComposer(restoredRecord);
    await expect(panel.getByText('分镜版本 V2', { exact: true })).toBeVisible();
    for (const prompt of [
      revisedOpening,
      ...storyboard.slice(1).map(([, value]) => value),
    ]) {
      await expect(panel.getByText(prompt, { exact: true })).toBeVisible();
    }
    expect((await latestVideoWorkflow(page, workId))?.workflow.id).toBe(
      workflowId
    );

    await panel.getByRole('button', { name: '确认分镜并开始生成' }).click();
    await expect
      .poll(
        async () =>
          (await latestVideoWorkflow(page, workId))?.workflow.confirmed ?? false
      )
      .toBe(true);

    await page.setViewportSize({ height: 844, width: 390 });
    await page.reload();
    panel = await openMobileVideoProgress(page);
    await expect(
      panel.getByRole('heading', { name: '后台生成中' })
    ).toBeVisible({
      timeout: 10_000,
    });
    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/uiux-upgrade-b/screenshots/09a-video-workflow-running-mobile.png',
    });

    const completed = await finishWorkflowAndReviewIfRequired(
      page,
      panel,
      workId
    );
    expect(completed.envelope.workflow.id).toBe(workflowId);
    expect(completed.sawBackgroundStatus).toBe(true);
    expect(completed.envelope.workflow.composedAsset?.objectKey).toBeTruthy();
    expect(completed.envelope.job?.status).toBe('completed');
    await expect(
      panel.getByRole('heading', { name: '成片已完成' })
    ).toBeVisible({ timeout: 10_000 });
    const finalVideo = panel.getByLabel('最终竖屏成片');
    await expect(finalVideo).toBeVisible();
    await expect(finalVideo).toHaveAttribute(
      'src',
      /^\/api\/core\/p1\/assets\?objectKey=/
    );
    const playbackResponse = await finalVideo.evaluate(async (element) => {
      const response = await fetch((element as HTMLVideoElement).src, {
        credentials: 'same-origin',
      });
      return {
        contentType: response.headers.get('content-type'),
        ok: response.ok,
      };
    });
    expect(playbackResponse).toEqual({ contentType: 'video/mp4', ok: true });
    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/uiux-upgrade-b/screenshots/09b-video-workflow-completed-mobile.png',
    });

    await page.setViewportSize({ height: 900, width: 1440 });
    await page.reload();
    const finalRecord = page.getByLabel('创作助理整理的记录');
    await expect(finalRecord).toBeVisible();
    panel = await openVideoComposer(finalRecord);
    await expect(
      panel.getByRole('heading', { name: '成片已完成' })
    ).toBeVisible();
    await expect(panel.getByLabel('最终竖屏成片')).toBeVisible();
    const recovered = await latestVideoWorkflow(page, workId);
    expect(recovered?.workflow.id).toBe(workflowId);
    expect(recovered?.workflow.status).toBe('completed');
    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/uiux-upgrade-b/screenshots/08-video-workflow-completed-desktop.png',
    });

    const videoPackage = (await contentPackages(page)).find(
      (contentPackage) =>
        contentPackage.source.workflowId === workflowId &&
        contentPackage.kind === 'video'
    );
    expect(videoPackage?.source.workId).toBe(workId);
    expect(videoPackage).toBeTruthy();
    if (!videoPackage) throw new Error('Completed video has no ContentPackage');
    await page.goto(
      `/dashboard/content?packageId=${encodeURIComponent(videoPackage.id)}`
    );
    const detailWorkflow = page.getByLabel('视频成片工作流');
    await expect(
      detailWorkflow.getByRole('heading', { name: '成片已完成' })
    ).toBeVisible();
    await expect(detailWorkflow.getByLabel('最终竖屏成片')).toBeVisible();
    await expect(page.locator('img[src*=".mp4"]')).toHaveCount(0);

    const unrelatedPackage = await createUnrelatedContentPackage(page);
    expect(unrelatedPackage.id).not.toBe(videoPackage.id);
    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto(
      `/dashboard?stage=handoff&workId=${encodeURIComponent(workId)}`
    );
    await expect(page.getByText(/^已采用内容 · 视频成片/)).toBeVisible();
    await expect(
      page
        .locator(`a[href*="packageId=${encodeURIComponent(videoPackage.id)}"]`)
        .first()
    ).toBeVisible();

    expect(
      commandActions.filter(
        ({ action, module }) =>
          module === 'model-supply' && action === 'video_workflow_create_draft'
      )
    ).toHaveLength(2);
    expect(
      commandActions.filter(
        ({ action, module }) =>
          module === 'model-supply' && action === 'video_workflow_confirm'
      )
    ).toHaveLength(1);
    expect(
      commandActions.filter(
        ({ action, module }) =>
          module === 'model-supply' &&
          action === 'video_workflow_select_candidate'
      )
    ).toHaveLength(completed.reviewSelections);
    expect(
      commandActions.some(
        ({ action, module }) =>
          module === 'operations' && action === 'submit_creative_work'
      )
    ).toBe(false);
    expect(
      (await creativeProjection(page)).jobs.some(
        (job) => job.contract.operation === 'video.generate'
      )
    ).toBe(false);
    expect(legacyProcessRequests).toEqual([]);

    const retiredLegacyResponse = await request.post(
      '/api/core/product/video/process',
      { data: { workId } }
    );
    expect(retiredLegacyResponse.ok()).toBe(false);
    expect(retiredLegacyResponse.status()).toBe(404);
  });

  test('a confirmed workflow can be cancelled and restores the cancelled state after reload', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedAuthorizedGrounding(page);
    const record = await createWork(page, '验证视频后台任务可由商家明确取消');
    const workId = (await creativeProjection(page)).works[0]?.id;
    if (!workId) throw new Error('Created Work has no id');
    let panel = await openVideoComposer(record);

    await panel.getByRole('button', { name: '锁定分镜' }).click();
    await expect(panel.getByText('分镜版本 V1', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: '确认分镜并开始生成' }).click();
    const cancel = panel.getByRole('button', { name: '取消视频任务' });
    await expect(cancel).toBeVisible({ timeout: 30_000 });
    await cancel.click();
    const cancellationStartedAt = Date.now();
    const cancellationTrace: Array<{
      elapsedMs: number;
      jobError?: string | null;
      jobStatus?: string;
      workflowRevision?: number;
      workflowStatus?: VideoWorkflowStatus;
    }> = [];
    try {
      await expect
        .poll(
          async () => {
            const envelope = await latestVideoWorkflow(page, workId);
            cancellationTrace.push({
              elapsedMs: Date.now() - cancellationStartedAt,
              jobError: envelope?.job?.error,
              jobStatus: envelope?.job?.status,
              workflowRevision: envelope?.workflow.revision,
              workflowStatus: envelope?.workflow.status,
            });
            return envelope?.workflow.status;
          },
          { timeout: 30_000 }
        )
        .toBe('cancelled');
    } finally {
      await test.info().attach('video-cancellation-state-trace', {
        body: Buffer.from(JSON.stringify(cancellationTrace, null, 2)),
        contentType: 'application/json',
      });
      if (cancellationTrace.at(-1)?.workflowStatus !== 'cancelled') {
        console.info('VIDEO_CANCEL_TRACE', JSON.stringify(cancellationTrace));
      }
    }

    await page.reload();
    panel = await openVideoComposer(page.getByLabel('创作助理整理的记录'));
    await expect(
      panel.getByRole('heading', { name: '任务已取消' })
    ).toBeVisible();
    await expect(
      panel.getByRole('button', { name: '取消视频任务' })
    ).toHaveCount(0);
    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/uiux-upgrade-b/screenshots/07c-video-workflow-cancelled-desktop.png',
    });
  });
});
