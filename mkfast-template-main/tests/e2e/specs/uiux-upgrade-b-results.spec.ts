import { expect, test, type Page } from '@playwright/test';
import type { CreativeWorkbenchProjection } from '@meiye/contracts';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

const productionCandidate =
  process.env.PLAYWRIGHT_PRODUCTION_CANDIDATE === 'true';

type CopyStreamTransportProbe = {
  chunkCount: number;
  completed: boolean;
  firstChunkAt?: number;
  lastChunkAt?: number;
};

async function installCopyStreamTransportProbe(page: Page) {
  await page.evaluate(() => {
    const probe: CopyStreamTransportProbe = {
      chunkCount: 0,
      completed: false,
    };
    const browserWindow = window as typeof window & {
      __meiyeCopyStreamTransportProbe?: CopyStreamTransportProbe;
    };
    browserWindow.__meiyeCopyStreamTransportProbe = probe;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const request = args[0];
      const url =
        typeof request === 'string'
          ? request
          : request instanceof Request
            ? request.url
            : request.toString();
      if (!url.includes('/api/core/p1/copy/stream') || !response.body) {
        return response;
      }

      const [productBody, probeBody] = response.body.tee();
      void (async () => {
        const reader = probeBody.getReader();
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          const now = performance.now();
          probe.firstChunkAt ??= now;
          probe.lastChunkAt = now;
          probe.chunkCount += 1;
        }
        probe.completed = true;
      })();
      return new Response(productBody, {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText,
      });
    };
  });
}

async function copyStreamTransportProbe(page: Page) {
  return page.evaluate(() => {
    const browserWindow = window as typeof window & {
      __meiyeCopyStreamTransportProbe?: CopyStreamTransportProbe;
    };
    return browserWindow.__meiyeCopyStreamTransportProbe;
  });
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

async function frozenRouteSnapshot(page: Page, providerJobId: string) {
  return page.evaluate(async (jobId) => {
    const response = await fetch('/api/core/p1/query', {
      body: JSON.stringify({
        action: 'job',
        module: 'model-supply',
        payload: { jobId },
      }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const envelope = (await response.json()) as {
      data?: {
        result?: { snapshot: Record<string, unknown> };
        snapshot?: Record<string, unknown>;
      };
      error?: { message: string };
    };
    const snapshot = envelope.data?.result?.snapshot ?? envelope.data?.snapshot;
    if (!response.ok || !snapshot) {
      throw new Error(envelope.error?.message ?? 'Frozen route query failed');
    }
    return snapshot;
  }, providerJobId);
}

async function createWork(page: Page, intent: string) {
  await addAuthorizedImage(page);
  await page.getByLabel('描述这次想创作的内容').fill(intent);
  await page.getByRole('button', { name: '建立创作记录' }).click();
  const record = page.getByLabel('创作助理整理的记录');
  await expect(record).toBeVisible();
  await record.getByRole('button', { name: '采用并确认 Brief' }).click();
  await expect(record.getByText('Brief 已确认', { exact: true })).toBeVisible();
  const professionalSettings = record.getByRole('button', {
    name: '调整专业参数',
  });
  await professionalSettings.click();
  const modelGroup = record.getByRole('radiogroup', { name: '执行模型' });
  if ((await modelGroup.getByRole('radio', { checked: true }).count()) === 0) {
    await modelGroup.locator('[role="radio"]:not([disabled])').first().click();
  }
  await professionalSettings.click();
  return record;
}

async function addAuthorizedImage(page: Page) {
  await page.evaluate(async () => {
    const stateResponse = await fetch('/api/core/product/state');
    const stateEnvelope = (await stateResponse.json()) as {
      data?: { workspaceId: string };
    };
    if (!stateResponse.ok || !stateEnvelope.data) {
      throw new Error('Product state failed');
    }
    const assetId = crypto.randomUUID();
    const command = async (body: Record<string, unknown>, key: string) => {
      const response = await fetch('/api/core/product/commands', {
        body: JSON.stringify(body),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': key,
        },
        method: 'POST',
      });
      if (!response.ok) throw new Error(await response.text());
    };
    await command(
      {
        store: {
          accounts: [],
          address: '春熙路 1 号',
          booking: '提前预约',
          brandVoice: '真实、克制',
          city: '成都',
          district: '锦江区',
          name: '测试门店',
          prohibitions: ['不虚构效果'],
          projects: [
            {
              confirmed: true,
              durationMinutes: 90,
              id: 'project-e2e-image',
              name: '真实到店项目',
              price: 168,
            },
          ],
          regulated: false,
        },
        type: 'confirm_store',
      },
      `store-${assetId}`
    );
    await command(
      {
        asset: {
          category: 'other',
          consentScope: 'internal_only',
          containsPerson: false,
          containsSensitiveData: false,
          id: assetId,
          mediaType: 'image',
          minorStatus: 'none',
          objectKey: `${stateEnvelope.data.workspaceId}/e2e/${assetId}.png`,
          rightsOwner: '测试门店',
          sourceType: 'real',
          tags: ['non-first-model-input.png'],
        },
        type: 'add_asset',
      },
      `add-${assetId}`
    );
    await command(
      {
        assetId,
        consentScope: 'public_marketing',
        rightsEvidence: 'e2e-owner-confirmed',
        type: 'authorize_asset',
      },
      `authorize-${assetId}`
    );
  });
  await page.reload();
  const sourceButton = page.getByRole('button', {
    name: 'non-first-model-input.png',
  });
  await expect(sourceButton).toBeVisible();
  if ((await sourceButton.getAttribute('aria-pressed')) !== 'true') {
    await sourceButton.click();
  }
  await expect(sourceButton).toHaveAttribute('aria-pressed', 'true');
}

async function acceptContract(page: Page) {
  const acceptance = page.getByRole('checkbox', {
    name: /我已确认模型、规格、费用和发布标识/,
  });
  await expect(acceptance).toBeEnabled();
  await acceptance.click();
  await expect(acceptance).toBeChecked();
  const submit = page.getByTestId('execute-tool-action');
  await expect(submit).toBeEnabled();
  return submit;
}

async function waitForCopyCandidates(page: Page) {
  const selector = page.getByRole('region', { name: '文案候选择优' });
  await expect(selector).toBeVisible({ timeout: 60_000 });
  await expect(
    selector
      .getByRole('radiogroup', { name: '三条文案候选' })
      .getByRole('radio')
  ).toHaveCount(3, { timeout: 60_000 });
  return selector;
}

test.describe('UI/UX Upgrade B result contracts', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('one real submission exposes streaming start, progress, and exactly three completed candidates', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    const record = await createWork(page, '流式生成三条真实克制的到店文案');
    const submit = await acceptContract(page);

    let streamRequestCount = 0;
    page.on('request', (streamRequest) => {
      if (streamRequest.url().includes('/api/core/p1/copy/stream')) {
        streamRequestCount += 1;
      }
    });

    await submit.click();
    await expect.poll(() => streamRequestCount).toBe(1);
    await expect(
      record.getByRole('heading', { name: '文案候选正在成形' })
    ).toBeVisible();
    await expect(record.getByText(/^候选 [123]$/)).toHaveCount(3);
    await expect(
      record.getByText('透亮猫眼｜真实到店记录', { exact: true })
    ).toBeVisible();
    await expect(
      record.getByText('正在构思标题…', { exact: true })
    ).toHaveCount(2);
    await expect(
      record.getByRole('button', { name: '停止本次流' })
    ).toBeVisible();
    await expect(record.getByTestId('workbench-result-hero')).toHaveCount(0);
    await expect(submit).toBeHidden();
    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/uiux-upgrade-b/screenshots/03-copy-stream-partial-desktop.png',
    });

    const selector = await waitForCopyCandidates(page);
    const resultHero = record.getByTestId('workbench-result-hero');
    await expect(resultHero).toBeVisible();
    await expect(record.getByTestId('execute-tool-action')).toBeHidden();
    await expect(
      page.getByRole('complementary', { name: '今日待办' })
    ).toHaveCount(0);
    const resultBox = await resultHero.boundingBox();
    const reuseBox = await record
      .getByRole('heading', { level: 2, name: '发现与复用' })
      .boundingBox();
    expect(resultBox).not.toBeNull();
    expect(reuseBox).not.toBeNull();
    expect(resultBox?.y).toBeLessThan(reuseBox?.y ?? 0);
    await expect(
      record.getByRole('heading', { name: '文案候选正在成形' })
    ).toHaveCount(0);
    await expect(selector.getByText('第 1 批', { exact: true })).toBeVisible();
    const projection = await creativeProjection(page);
    expect(streamRequestCount).toBe(1);
    expect(projection.works).toHaveLength(1);
    expect(projection.jobs).toHaveLength(1);
    expect(projection.jobs[0]?.status).toBe('completed');
    expect(projection.assets).toHaveLength(3);
    const provenance = resultHero.getByTestId('result-provenance');
    await expect(provenance).toHaveAttribute(
      'data-catalog-model-id',
      projection.jobs[0]?.contract.catalogModelId ?? ''
    );
    await expect(provenance).toHaveAttribute(
      'data-route-snapshot-id',
      projection.jobs[0]?.routeSnapshotId ?? ''
    );
    await expect(provenance).toHaveAttribute(
      'data-provenance',
      'local_fixture'
    );
    await expect(
      provenance.getByText('本地测试可用', { exact: true })
    ).toBeVisible();
    expect(
      projection.assets
        .map((asset) => asset.candidateIndex)
        .sort((left, right) => (left ?? -1) - (right ?? -1))
    ).toEqual([0, 1, 2]);
    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/uiux-upgrade-b/screenshots/04-copy-results-desktop.png',
    });
  });

  test('a non-first settings selection drives the submitted model and frozen route', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const user = await registerE2EUser(request, { role: 'admin' });
    await loginByForm(page, user);
    await page.goto('/settings/models');
    await page.getByRole('tab', { name: '图片模型' }).click();

    const settingsGroup = page.getByRole('radiogroup', { name: '本次使用' });
    const settingsRadios = settingsGroup.getByRole('radio');
    await expect.poll(() => settingsRadios.count()).toBeGreaterThan(1);
    const firstInput = settingsRadios
      .first()
      .locator('xpath=following-sibling::input[@type="radio"]');
    const nonFirstRadio = settingsRadios.nth(1);
    const nonFirstInput = nonFirstRadio.locator(
      'xpath=following-sibling::input[@type="radio"]'
    );
    const firstModelId = await firstInput.inputValue();
    const selectedModelId = await nonFirstInput.inputValue();
    expect(selectedModelId).not.toBe(firstModelId);
    await nonFirstRadio.click();
    await expect(nonFirstInput).toBeChecked();

    await page.goto('/dashboard');
    const record = await createWork(page, '验证非首项模型贯穿报价、路由和结果');
    await record
      .getByRole('group', { name: '成品类型' })
      .getByRole('button', { name: /^图片生成/ })
      .click();
    await record.getByRole('button', { name: '调整专业参数' }).click();
    const selectedWorkbenchInput = record
      .getByRole('radiogroup', { name: '执行模型' })
      .getByRole('radio', { checked: true })
      .locator('xpath=following-sibling::input[@type="radio"]');
    await expect(selectedWorkbenchInput).toHaveValue(selectedModelId);

    const submit = await acceptContract(page);
    const submissionResponse = page.waitForResponse((response) => {
      if (!response.url().includes('/api/core/p1/commands')) return false;
      const requestBody = response.request().postDataJSON() as {
        action?: string;
      };
      return requestBody.action === 'submit_creative_work';
    });
    await submit.click();
    const submitted = await submissionResponse;
    expect(submitted.ok(), await submitted.text()).toBeTruthy();
    await expect(record.getByTestId('workbench-result-hero')).toBeVisible({
      timeout: 60_000,
    });

    const projection = await creativeProjection(page);
    const job = projection.jobs[0];
    expect(job?.contract.catalogModelId).toBe(selectedModelId);
    expect(job?.routeSnapshotId).toBeTruthy();
    expect(job?.providerJobId).toBeTruthy();
    const routeSnapshot = await frozenRouteSnapshot(
      page,
      job?.providerJobId ?? ''
    );
    expect(routeSnapshot.id).toBe(job?.routeSnapshotId);
    expect(routeSnapshot.actualCatalogModelId).toBe(selectedModelId);
    const actualRouteCandidate = (
      routeSnapshot.allowedCandidates as Array<{
        catalogModelId: string;
        providerModel?: string;
        stableModelName?: string;
      }>
    ).find(
      (candidate) =>
        candidate.catalogModelId === routeSnapshot.actualCatalogModelId
    );
    const actualProviderModel =
      routeSnapshot.providerModel ??
      actualRouteCandidate?.providerModel ??
      actualRouteCandidate?.stableModelName;
    expect(actualProviderModel).toEqual(expect.any(String));
    expect(routeSnapshot.apiCounterparty).toEqual(expect.any(String));
    expect(job?.executionProvenance).toMatchObject({
      actualCatalogModelId: routeSnapshot.actualCatalogModelId,
      apiCounterparty: routeSnapshot.apiCounterparty,
      providerModel: actualProviderModel,
    });
    const provenance = record
      .getByTestId('workbench-result-hero')
      .getByTestId('result-provenance');
    await expect(provenance).toHaveAttribute(
      'data-catalog-model-id',
      selectedModelId
    );
    await expect(provenance).toHaveAttribute(
      'data-route-snapshot-id',
      job?.routeSnapshotId ?? ''
    );
    await expect(provenance).toHaveAttribute(
      'data-provider-model',
      String(actualProviderModel)
    );
  });

  test('production candidate preserves paced chunks through Worker and BFF', async ({
    page,
    request,
  }, testInfo) => {
    test.skip(
      !productionCandidate,
      'Runs only against the Wrangler production candidate.'
    );
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await createWork(page, '验证生产候选的流式传输不会被 Worker 或 BFF 缓冲');
    const submit = await acceptContract(page);
    await installCopyStreamTransportProbe(page);

    await submit.click();
    await waitForCopyCandidates(page);
    await expect
      .poll(async () => (await copyStreamTransportProbe(page))?.completed)
      .toBe(true);
    const probe = await copyStreamTransportProbe(page);
    await testInfo.attach('copy-stream-transport-probe', {
      body: JSON.stringify(probe, null, 2),
      contentType: 'application/json',
    });
    expect(probe?.chunkCount).toBeGreaterThan(1);
    expect(
      (probe?.lastChunkAt ?? 0) - (probe?.firstChunkAt ?? 0)
    ).toBeGreaterThan(100);

    const projection = await creativeProjection(page);
    expect(projection.jobs).toHaveLength(1);
    expect(projection.jobs[0]?.status).toBe('completed');
    expect(projection.assets).toHaveLength(3);
  });

  test('stopping a partial copy stream preserves arrived content and resubmits only after explicit confirmation', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    const record = await createWork(page, '验证流式中断后的显式恢复边界');
    const submit = await acceptContract(page);
    let streamRequestCount = 0;
    page.on('request', (streamRequest) => {
      if (streamRequest.url().includes('/api/core/p1/copy/stream')) {
        streamRequestCount += 1;
      }
    });

    await submit.click();
    await expect(
      record.getByText('透亮猫眼｜真实到店记录', { exact: true })
    ).toBeVisible();
    await record.getByRole('button', { name: '停止本次流' }).click();
    await expect(record.getByRole('alert')).toContainText(
      /你已停止本次流，已到达的候选会保留。\s*系统不会自动重投或切换模型。/
    );
    await expect(
      record.getByText('透亮猫眼｜真实到店记录', { exact: true })
    ).toBeVisible();
    await page.waitForTimeout(300);
    expect(streamRequestCount).toBe(1);

    await record.getByRole('button', { name: '由我重新提交' }).click();
    await expect.poll(() => streamRequestCount).toBe(2);
    const selector = await waitForCopyCandidates(page);
    await expect(
      selector
        .getByRole('radiogroup', { name: '三条文案候选' })
        .getByRole('radio')
    ).toHaveCount(3);
  });

  test('the same completed copy batch remains a single-choice flow on mobile', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await createWork(page, '验证移动端同源三选一与固定采用动作');
    const submit = await acceptContract(page);
    await submit.click();
    await waitForCopyCandidates(page);

    await page.setViewportSize({ height: 844, width: 390 });
    await expect(page.getByRole('tab', { name: '进度' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(
      page.getByRole('heading', { level: 2, name: '采用这条内容' })
    ).toBeVisible();
    await expect(
      page.getByText('验证移动端同源三选一与固定采用动作', { exact: true })
    ).toBeVisible();
    const selector = page.getByRole('region', { name: '文案候选择优' });
    const candidates = selector.getByRole('radiogroup', {
      name: '三条文案候选',
    });
    await expect(candidates.getByRole('radio')).toHaveCount(3);
    await candidates.getByRole('radio', { name: /^候选 B：/ }).click();
    await expect(candidates.getByRole('radio', { checked: true })).toHaveCount(
      1
    );
    const stickyActions = selector.locator(
      '[data-mobile-sticky-actions="true"]'
    );
    await expect(stickyActions).toBeVisible();
    await expect(
      stickyActions.getByRole('button', { name: '采用所选文案' })
    ).toBeEnabled();
    await expect(
      selector.getByText('质量重试已用 0/2', { exact: true })
    ).toBeVisible();
    const resultBox = await selector.boundingBox();
    const jobBox = await page
      .getByText('生成任务', { exact: true })
      .boundingBox();
    expect(resultBox).not.toBeNull();
    expect(jobBox).not.toBeNull();
    expect(resultBox?.y).toBeLessThan(jobBox?.y ?? 0);
    await stickyActions.getByRole('button', { name: '采用所选文案' }).click();
    await expect(
      page.getByRole('heading', { level: 2, name: '准备发布已采用内容' })
    ).toBeVisible();
    await page.reload();
    await expect(page.getByRole('tab', { name: '行动' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(
      page.getByRole('heading', { level: 2, name: '准备发布已采用内容' })
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      )
      .toBe(true);
    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/uiux-upgrade-b/screenshots/04b-copy-candidates-mobile.png',
    });
  });

  test('creation assistant streams received text and exposes safe, local-only patch controls', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    const record = await createWork(
      page,
      '保留原始创作意图，不自动写入助手建议'
    );
    const assistant = record.getByLabel('创作副驾');
    await assistant
      .getByLabel('向创作副驾提问')
      .fill('帮我把语气调整成可信的熟客分享');
    await assistant.getByRole('button', { name: '发送' }).click();

    await expect(
      assistant.getByRole('button', { exact: true, name: '停止' })
    ).toBeVisible();
    await expect(
      assistant.getByText(
        '我先按当前创作意图整理重点，再给你一个可检查、可修改的建议。',
        { exact: true }
      )
    ).toBeVisible();
    await expect(
      assistant.getByRole('heading', { level: 2, name: '建议方向' })
    ).toBeVisible();
    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/uiux-upgrade-b/screenshots/05a-assistant-rich-stream-partial-desktop.png',
    });
    await expect(
      assistant.getByRole('link', { name: '核对门店信息' })
    ).toHaveAttribute('href', '/dashboard/store');
    await expect(assistant.locator('[data-streamdown="strong"]')).toContainText(
      ['语气', '行动']
    );
    await expect(assistant.locator('code')).toContainText('人工确认');
    await expect(assistant.getByLabel('当前创作信息')).toContainText(
      '保留原始创作意图，不自动写入助手建议'
    );

    const patch = assistant.getByLabel('语气字段建议');
    await expect(patch).toContainText('只在本地确认');
    await patch.getByRole('button', { name: '编辑' }).click();
    await patch.getByLabel('编辑语气建议').fill('可信、克制，像熟客分享');
    await patch.getByRole('button', { name: '保存本地编辑' }).click();
    await expect(patch).toContainText('已在本地接受，尚未写入创作记录。');
    await expect(record).toContainText('保留原始创作意图，不自动写入助手建议');
    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/uiux-upgrade-b/screenshots/05-assistant-structured-parts-desktop.png',
    });
  });

  test('single selection, paid reroll, and two free quality retries keep their separate usage boundaries', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await createWork(page, '验证候选换批与免费质量重试边界');
    const submit = await acceptContract(page);
    await submit.click();

    const selector = await waitForCopyCandidates(page);
    const candidates = selector.getByRole('radiogroup', {
      name: '三条文案候选',
    });
    const candidateA = candidates.getByRole('radio', { name: /^候选 A：/ });
    const candidateC = candidates.getByRole('radio', { name: /^候选 C：/ });
    await candidateA.click();
    await expect(candidateA).toBeChecked();
    await expect(candidates.getByRole('radio', { checked: true })).toHaveCount(
      1
    );
    await candidateC.click();
    await expect(candidateA).not.toBeChecked();
    await expect(candidateC).toBeChecked();
    await expect(candidates.getByRole('radio', { checked: true })).toHaveCount(
      1
    );

    await expect(selector.getByText('第 1 批', { exact: true })).toBeVisible();
    await expect(
      selector.getByText('质量重试已用 0/2', { exact: true })
    ).toBeVisible();
    await selector.getByRole('button', { name: '确认换一批（付费）' }).click();
    const paidDialog = page.getByRole('alertdialog', {
      name: '确认生成新一批文案？',
    });
    await expect(paidDialog).toContainText('消耗 1 次文案生成额度');
    await paidDialog
      .getByRole('button', { name: '确认消耗 1 次并换一批' })
      .click();
    await expect(selector.getByText('第 2 批', { exact: true })).toBeVisible({
      timeout: 60_000,
    });

    const afterPaid = await creativeProjection(page);
    expect(afterPaid.jobs).toHaveLength(2);
    const paidJob = afterPaid.jobs.find(
      (job) => job.id === afterPaid.works[0]?.currentJobId
    );
    expect(paidJob).toMatchObject({
      batchNumber: 2,
      productUsageQuantity: 1,
      qualityRetryNumber: 0,
      rerollKind: 'paid',
    });
    const rootModel = afterPaid.jobs[0]?.contract.catalogModelId;
    expect(paidJob?.contract.catalogModelId).toBe(rootModel);

    const qualityRetry = selector.getByRole('button', {
      name: '质量不达标，免费重试',
    });
    await qualityRetry.click();
    await expect(selector.getByText('第 3 批', { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      selector.getByText('质量重试已用 1/2', { exact: true })
    ).toBeVisible();
    await expect(selector.getByText(/额外消耗 0 次 · 剩余 1\/2/)).toBeVisible();

    await qualityRetry.click();
    await expect(selector.getByText('第 4 批', { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      selector.getByText('质量重试已用 2/2', { exact: true })
    ).toBeVisible();
    await expect(
      selector.getByText(/额外消耗 0 次 · 免费机会已用完.*剩余 0\/2/)
    ).toBeVisible();
    await expect(qualityRetry).toBeDisabled();

    const exhausted = await creativeProjection(page);
    expect(exhausted.jobs).toHaveLength(4);
    expect(exhausted.assets).toHaveLength(12);
    expect(exhausted.jobs.map((job) => job.contract.catalogModelId)).toEqual([
      rootModel,
      rootModel,
      rootModel,
      rootModel,
    ]);
    expect(exhausted.jobs.map((job) => job.productUsageQuantity)).toEqual([
      1, 1, 0, 0,
    ]);
    expect(exhausted.jobs.at(-1)).toMatchObject({
      batchNumber: 4,
      productUsageQuantity: 0,
      qualityRetryNumber: 2,
      rerollKind: 'quality',
    });
    await expect(
      selector
        .getByRole('radiogroup', { name: '三条文案候选' })
        .getByRole('radio')
    ).toHaveCount(3);
  });

  test('successful image media opens the lightbox and the same canonical Asset detail', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    const record = await createWork(page, '生成一张真实克制的美甲项目图片');
    await record
      .getByRole('group', { name: '成品类型' })
      .getByRole('button', { name: /^图片/ })
      .click();
    const submit = await acceptContract(page);
    await submit.click();

    await expect
      .poll(
        async () => {
          const projection = await creativeProjection(page);
          return projection.jobs.find(
            (job) => job.id === projection.works[0]?.currentJobId
          )?.status;
        },
        { timeout: 60_000 }
      )
      .toBe('completed');
    await page.reload();

    const completed = await creativeProjection(page);
    const imageAsset = completed.assets.find((asset) => asset.kind === 'image');
    const imageJob = completed.jobs.find(
      (job) => job.id === completed.works[0]?.currentJobId
    );
    if (!imageAsset?.objectKey) {
      throw new Error('Completed image Asset is missing its media object key');
    }
    const imageProvenance = page
      .getByTestId('workbench-result-hero')
      .getByTestId('result-provenance');
    await expect(imageProvenance).toHaveAttribute(
      'data-catalog-model-id',
      imageJob?.contract.catalogModelId ?? ''
    );
    await expect(imageProvenance).toHaveAttribute(
      'data-route-snapshot-id',
      imageJob?.routeSnapshotId ?? ''
    );
    await expect(imageProvenance).toHaveAttribute(
      'data-provenance',
      'local_fixture'
    );
    const canonicalMediaSrc = `/api/core/p1/assets?objectKey=${encodeURIComponent(
      imageAsset.objectKey
    )}`;
    const preview = page.getByRole('button', {
      name: `预览成品：${imageAsset.title}`,
    });
    await expect(preview).toBeVisible();
    await expect(
      preview.getByRole('img', { name: imageAsset.title })
    ).toHaveAttribute('src', canonicalMediaSrc);
    await preview.click();

    const lightbox = page.getByRole('dialog', { name: imageAsset.title });
    await expect(lightbox).toBeVisible();
    await expect(
      lightbox.getByRole('img', { name: imageAsset.title })
    ).toHaveAttribute('src', canonicalMediaSrc);
    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/uiux-upgrade-b/screenshots/06-image-lightbox-desktop.png',
    });
    if (!(await lightbox.isVisible())) {
      await preview.click();
      await expect(lightbox).toBeVisible();
    }
    await lightbox.getByRole('link', { name: '打开详情' }).click();
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/assets/${imageAsset.id}$`)
    );
    await expect(
      page.getByRole('heading', { level: 1, name: '素材详情' })
    ).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: `预览成品：${imageAsset.title}`,
      })
    ).toBeVisible();
    const afterDetail = await creativeProjection(page);
    expect(afterDetail.jobs.map(({ id }) => id)).toEqual(
      completed.jobs.map(({ id }) => id)
    );
    expect(afterDetail.assets.map(({ id }) => id)).toEqual(
      completed.assets.map(({ id }) => id)
    );
    expect(afterDetail.contents).toEqual([]);

    await page.goto('/dashboard/assets');
    await expect(
      page.getByRole('button', { name: `预览成品：${imageAsset.title}` })
    ).toBeVisible();
    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/uiux-upgrade-b/screenshots/06b-canonical-gallery-desktop.png',
    });
    await page.setViewportSize({ height: 844, width: 390 });
    await expect(
      page.getByRole('button', { name: `预览成品：${imageAsset.title}` })
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      )
      .toBe(true);
    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/uiux-upgrade-b/screenshots/06c-canonical-gallery-mobile.png',
    });

    await page.setViewportSize({ height: 900, width: 1440 });
    await page.goto('/dashboard/recent');
    const recentAssetLink = page
      .getByRole('link', { exact: true, name: '查看详情' })
      .and(
        page.locator(
          `a[href$="/dashboard/assets/${encodeURIComponent(imageAsset.id)}"]`
        )
      );
    await expect(recentAssetLink).toHaveCount(1);
    const recentAssetItem = recentAssetLink.locator('xpath=ancestor::li[1]');
    const recentPreview = recentAssetItem.getByRole('button', {
      name: `预览成品：${imageAsset.title}`,
    });
    await expect(recentPreview).toBeVisible();
    await expect(
      recentPreview.getByRole('img', { name: imageAsset.title })
    ).toHaveAttribute('src', canonicalMediaSrc);
    await recentPreview.click();
    const recentLightbox = page.getByRole('dialog', {
      name: imageAsset.title,
    });
    await expect(recentLightbox).toBeVisible();
    await expect(
      recentLightbox.getByRole('img', { name: imageAsset.title })
    ).toHaveAttribute('src', canonicalMediaSrc);
    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/uiux-upgrade-b/screenshots/06d-canonical-recent-desktop.png',
    });
  });

  test('English locale retains route context and keeps empty product chrome free of Chinese leakage', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await page.goto('/dashboard/assets?from=i12#gallery');
    await page.getByRole('button', { exact: true, name: '语言' }).click();
    await page.getByRole('menuitem', { name: /English/ }).click();

    await expect(page).toHaveURL((url) => {
      return (
        url.pathname === '/en/dashboard/assets' &&
        url.searchParams.get('from') === 'i12' &&
        url.hash === '#gallery'
      );
    });
    await expect(
      page.getByRole('heading', { level: 1, name: 'Asset library' })
    ).toBeVisible();
    await expect(
      page.getByText('Add your first piece of store material', { exact: true })
    ).toBeVisible();
    let visibleCopy = await page.locator('body').innerText();
    visibleCopy = visibleCopy.replaceAll('美业内容簿', '');
    expect(visibleCopy).not.toMatch(/[\u3400-\u9fff]/u);
    expect(visibleCopy).not.toMatch(
      /TanStarter|MkFast|MkSaaS|recorded-|llm-[a-z]|gpt-[a-z]/i
    );

    await page.reload();
    await expect(page).toHaveURL((url) => {
      return (
        url.pathname === '/en/dashboard/assets' &&
        url.searchParams.get('from') === 'i12' &&
        url.hash === '#gallery'
      );
    });
    await page
      .getByRole('link', { exact: true, name: 'Content library' })
      .click();
    await expect(page).toHaveURL(/\/en\/dashboard\/content$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Content library' })
    ).toBeVisible();
    visibleCopy = (await page.locator('body').innerText()).replaceAll(
      '美业内容簿',
      ''
    );
    expect(visibleCopy).not.toMatch(/[\u3400-\u9fff]/u);
  });
});
