import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

interface CreativeProjection {
  jobs: Array<{ id: string }>;
  works: Array<{
    id: string;
    intent: string;
    mode: 'agent' | 'direct';
    sourceReferences: Array<{ id: string; kind: string }>;
  }>;
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

test.describe('UI/UX Upgrade B composer contracts', () => {
  test.setTimeout(60_000);

  test.beforeAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    await cleanupE2EUsers(request);
  });

  test('the empty workbench leads with one editable request and one primary action', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    const intent = page.getByLabel('描述这次想创作的内容');
    const guidance = page.getByRole('heading', {
      level: 3,
      name: '今日建议',
    });
    const method = page.getByRole('group', { name: '选择创作方式' });
    await expect(intent).toBeVisible();
    await expect(guidance).toBeVisible();

    const intentBox = await intent.boundingBox();
    const guidanceBox = await guidance.boundingBox();
    const methodBox = await method.boundingBox();
    expect(intentBox).not.toBeNull();
    expect(guidanceBox).not.toBeNull();
    expect(methodBox).not.toBeNull();
    expect(intentBox?.y).toBeLessThan(guidanceBox?.y ?? 0);
    expect(intentBox?.y).toBeLessThan(methodBox?.y ?? 0);
    await expect(page.locator('button.bg-primary:visible')).toHaveCount(1);
  });

  test('a failed projection keeps the editable intent and recovers only after an explicit retry', async ({
    page,
    request,
  }) => {
    let failProjection = true;
    await page.route('**/api/core/p1/query', async (route) => {
      const body = route.request().postDataJSON() as {
        action?: string;
        module?: string;
      };
      if (
        failProjection &&
        body.module === 'operations' &&
        body.action === 'creative_workbench'
      ) {
        await route.fulfill({
          body: JSON.stringify({
            error: {
              code: 'UPSTREAM_SECRET_FAILURE',
              message: 'postgres password=must-not-leak',
            },
            meta: { correlationId: 'corr-fixture-retry' },
          }),
          contentType: 'application/json',
          status: 503,
        });
        return;
      }
      await route.continue();
    });
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    const failure = page.getByText('内容簿暂时无法打开', { exact: true });
    await expect(failure).toBeVisible();
    await expect(
      page.getByText('内容记录暂时无法读取。你仍可保留当前输入，稍后重试。', {
        exact: true,
      })
    ).toBeVisible();
    await expect(page.getByText(/password|postgres|must-not-leak/)).toHaveCount(
      0
    );
    const intent = page.getByLabel('描述这次想创作的内容');
    await intent.fill('失败时也要保留这条真实创作意图');
    await expect(
      page.getByRole('button', { name: '建立创作记录' })
    ).toBeDisabled();
    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/uiux-upgrade-b/screenshots/00-fixture-friendly-error-retry-desktop.png',
    });

    failProjection = false;
    await page.getByRole('button', { name: '重新读取' }).click();
    await expect(failure).toBeHidden();
    await expect(intent).toHaveValue('失败时也要保留这条真实创作意图');
  });

  test('today suggestions and scene chips prefill an editable intent without writes', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    await expect(
      page.getByRole('heading', { level: 3, name: '今日建议' })
    ).toBeVisible();
    await expect(
      page.getByText('结合当前任务与素材，先给你三个可以直接编辑的起点。', {
        exact: true,
      })
    ).toBeVisible();
    const intent = page.getByLabel('描述这次想创作的内容');
    const suggestion = page.getByRole('button', {
      name: /^做一条同城引流内容/,
    });

    await suggestion.click();
    await expect(suggestion).toHaveAttribute('aria-pressed', 'true');
    await expect(intent).toBeFocused();
    await expect(intent).toHaveValue(/同城新客/);
    await intent.fill(`${await intent.inputValue()}，补充周末预约时段。`);
    await expect(intent).toHaveValue(/补充周末预约时段/);

    const sceneGroup = page.getByRole('group', { name: '灵感场景' });
    for (const label of ['引流', '种草', '促销', '复购']) {
      await expect(
        sceneGroup.getByRole('button', { name: new RegExp(`^${label}`) })
      ).toBeVisible();
    }
    await sceneGroup
      .getByRole('button', { exact: true, name: '全部场景' })
      .click();
    for (const label of ['引流 · 美发', '种草 · 美发', '引流 · 皮肤管理']) {
      await expect(
        sceneGroup.getByRole('button', { name: new RegExp(`^${label}`) })
      ).toBeVisible();
    }

    const scene = sceneGroup.getByRole('button', {
      name: /^复购/,
    });
    await scene.click();
    await expect(scene).toHaveAttribute('aria-pressed', 'true');
    await expect(intent).toBeFocused();
    await expect(intent).toHaveValue(/老客复购/);
    await intent.fill(`${await intent.inputValue()}，保留人工修改。`);
    await expect(intent).toHaveValue(/保留人工修改/);
    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/uiux-upgrade-b/screenshots/01-opening-guidance-desktop.png',
    });
    await page.setViewportSize({ height: 844, width: 390 });
    await expect(
      page.getByRole('heading', { level: 1, name: '移动工作台' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 3, name: '今日建议' })
    ).toBeVisible();
    const mobileIntent = page.getByLabel('描述这次想创作的内容');
    await expect(mobileIntent).toHaveValue(/保留人工修改/);
    const mobileScenes = page.getByRole('group', { name: '灵感场景' });
    for (const label of ['引流', '种草', '促销', '复购']) {
      await expect(
        mobileScenes.getByRole('button', { name: new RegExp(`^${label}`) })
      ).toBeVisible();
    }
    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/uiux-upgrade-b/screenshots/01b-opening-guidance-mobile.png',
    });

    expect(await creativeProjection(page)).toMatchObject({
      jobs: [],
      works: [],
    });
  });

  test('the edited intent and explicit mode persist only after the merchant creates the Work', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    const intent = page.getByLabel('描述这次想创作的内容');
    await page.getByRole('button', { name: /^做一条同城引流内容/ }).click();
    await intent.fill('周末同城新客内容，保留人工确认的预约时段。');
    await page.getByRole('button', { name: '直接生成' }).click();
    expect(await creativeProjection(page)).toMatchObject({
      jobs: [],
      works: [],
    });

    await page.getByRole('button', { name: '建立创作记录' }).click();
    await expect(page.getByLabel('直接生成的创作记录')).toBeVisible();
    const projection = await creativeProjection(page);
    expect(projection.jobs).toEqual([]);
    expect(projection.works).toHaveLength(1);
    expect(projection.works[0]).toMatchObject({
      intent: '周末同城新客内容，保留人工确认的预约时段。',
      mode: 'direct',
    });
  });

  test('named preset transfers focus from the hidden prompt to the material path', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    const prompt = page.getByLabel('描述这次想创作的内容');
    await expect(prompt).toBeVisible();
    await page.getByRole('button', { name: /^前后对比/ }).click();

    await expect(prompt).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: '添加图片素材' })
    ).toBeFocused();
    await expect(
      page.getByText(/同一项目、同一角度的前后对比图各 1 张/).first()
    ).toBeVisible();
    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/uiux-upgrade-b/screenshots/02b-named-preset-material-path-desktop.png',
    });

    await page.getByRole('button', { name: /^价格卡/ }).click();
    await expect(prompt).toHaveCount(0);
    await expect(
      page.getByText(/已确认的项目与价格清单 1 份/).first()
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: '添加图片素材' })
    ).toBeFocused();
  });

  test('named preset opens a progressive composer with one explicit model and an editable content suite', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);

    const prompt = page.getByLabel('描述这次想创作的内容');
    await expect(prompt).toBeVisible();
    await page.getByRole('button', { name: /^前后对比/ }).click();
    await expect(prompt).toHaveCount(0);
    await expect(
      page.getByText('这套创作模板已准备好所需输入，无需再写提示词。', {
        exact: true,
      })
    ).toBeVisible();

    await page.getByRole('button', { name: '建立创作记录' }).click();
    const record = page.getByLabel('创作助理整理的记录');
    await expect(record).toBeVisible();
    await expect(record).toHaveAttribute('data-job-count', '0');
    await expect(record.getByText('快速起步', { exact: true })).toBeVisible();

    const professional = record.getByRole('button', {
      name: /^调整专业参数/,
    });
    await expect(professional).toHaveAttribute('aria-expanded', 'false');
    const modelSection = record.locator(
      'section[aria-labelledby="workbench-model-picker-title"]'
    );
    await expect(modelSection).toBeHidden();
    await expect(record.getByLabel('内容整理标签')).toHaveCount(0);

    const suite = record.locator(
      'section[aria-labelledby="content-suite-title"]'
    );
    const templatePreviews = record.locator(
      'section[aria-labelledby="creation-shelf-title"] svg[role="img"]'
    );
    await expect(templatePreviews).toHaveCount(3);
    await expect(templatePreviews.locator('text').first()).not.toHaveText('');
    await expect(
      suite.locator('[role="checkbox"][aria-label="前后对比"]')
    ).toBeChecked();
    await expect(
      suite.locator('[role="checkbox"][aria-label="社媒封面"]')
    ).toBeChecked();
    await expect(suite.getByText('已选 2 项', { exact: true })).toBeVisible();

    const reviewCard = suite.locator('[role="checkbox"][aria-label="好评卡"]');
    await expect(reviewCard).toBeEnabled();
    await reviewCard.click();
    await expect(reviewCard).toBeChecked();
    await expect(suite.getByText('已选 3 项', { exact: true })).toBeVisible();
    const structure = suite
      .getByText('本次成套结构', { exact: true })
      .locator('..')
      .locator('li');
    await expect(structure).toContainText(['前后对比', '社媒封面', '好评卡']);
    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/uiux-upgrade-b/screenshots/02a-progressive-composer-default-desktop.png',
    });
    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/uiux-upgrade-b/screenshots/02d-template-gallery-desktop.png',
    });

    await professional.click();
    await expect(professional).toHaveAttribute('aria-expanded', 'true');
    await expect(modelSection).toBeVisible();
    const modelGroup = modelSection.getByRole('radiogroup', {
      name: '执行模型',
    });
    await expect(record.getByLabel('内容整理标签')).toBeVisible();
    await expect(modelGroup.getByText(/本次预计：/).first()).toBeVisible();
    await expect(
      modelGroup.getByText(/美业能力预览 · 非当前模型实测/).first()
    ).toBeVisible();

    const models = modelGroup.getByRole('radio');
    expect(await models.count()).toBeGreaterThan(0);
    await record.getByRole('button', { name: '查看本次设置' }).click();
    const summaryBeforeSwitch = record
      .getByText('预计产出与历史耗时', { exact: true })
      .locator('..');
    await expect(summaryBeforeSwitch).toContainText('暂无足够真实样本');
    await modelSection.screenshot({
      path: '../docs/evidence/uiux-upgrade-b/screenshots/11a-duration-model-before-desktop.png',
    });
    const selectableIndex = await models.evaluateAll((nodes) =>
      nodes.findIndex(
        (node) =>
          node.getAttribute('aria-checked') === 'false' &&
          node.getAttribute('aria-disabled') !== 'true' &&
          !node.hasAttribute('data-disabled')
      )
    );
    expect(selectableIndex).toBeGreaterThanOrEqual(0);
    const selectableModel = models.nth(selectableIndex);
    await selectableModel.click();
    await expect(selectableModel).toBeChecked();
    await expect(modelGroup.getByRole('radio', { checked: true })).toHaveCount(
      1
    );
    await expect(summaryBeforeSwitch).toContainText('暂无足够真实样本');
    await modelSection.screenshot({
      path: '../docs/evidence/uiux-upgrade-b/screenshots/11b-duration-model-after-desktop.png',
    });
    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/uiux-upgrade-b/screenshots/02-progressive-composer-desktop.png',
    });
    const beforeReload = await creativeProjection(page);
    expect(beforeReload.works[0]?.sourceReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'official-before_after',
          kind: 'template',
        }),
      ])
    );
    await page.reload();
    const restoredRecord = page.getByLabel('创作助理整理的记录');
    await expect(restoredRecord).toContainText('已选创作模板：前后对比');
    await expect(restoredRecord).toContainText(
      '同一项目、同一角度的前后对比图各 1 张，画面清晰且已获授权。'
    );
  });

  test('shelf and global add-to-creation share the four-field inheritance confirmation', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await page
      .getByLabel('描述这次想创作的内容')
      .fill('验证来源继承字段由商家显式确认');
    await page.getByRole('button', { name: '建立创作记录' }).click();
    const record = page.getByLabel('创作助理整理的记录');
    await expect(record).toBeVisible();

    await record.getByRole('button', { name: '带入当前创作' }).first().click();
    const inheritance = page.getByRole('dialog', {
      name: '确认从来源继承什么',
    });
    const fields = inheritance.getByRole('checkbox');
    await expect(fields).toHaveCount(5);
    for (let index = 0; index < 4; index += 1) {
      await expect(fields.nth(index)).toBeChecked();
    }
    await expect(fields.nth(4)).not.toBeChecked();
    await expect(
      inheritance.getByRole('button', { name: '确认带入 4 项' })
    ).toBeEnabled();
    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/uiux-upgrade-b/screenshots/02c-inheritance-defaults-desktop.png',
    });
    await page.keyboard.press('Escape');
    await expect(inheritance).toBeHidden();

    await page.keyboard.press('Meta+K');
    const palette = page.getByRole('dialog', {
      name: '全局命令：导航或添加到创作',
    });
    await expect(palette).toBeVisible();
    await palette
      .locator('[data-slot="command-item"]')
      .filter({ hasText: '前后对比' })
      .click();
    await expect(inheritance).toBeVisible();
    for (let index = 0; index < 4; index += 1) {
      await expect(fields.nth(index)).toBeChecked();
    }
    await expect(fields.nth(4)).not.toBeChecked();
  });

  test('global palette returns an add-to-creation action without creating a Work or Job', async ({
    page,
    request,
  }) => {
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await page.goto('/dashboard/assets');
    expect(await creativeProjection(page)).toMatchObject({
      jobs: [],
      works: [],
    });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.dataset.globalCommandReady)
      )
      .toBe('true');

    const dialog = page.getByRole('dialog', {
      name: '全局命令：导航或添加到创作',
    });
    const focusReturn = page.getByRole('button', { name: '拍摄门店素材' });
    await focusReturn.focus();
    await page.keyboard.press('Meta+K');
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText('导航 · 打开', { exact: true })
    ).toBeVisible();
    await expect(
      dialog.getByText('添加到创作 · 添加', { exact: true })
    ).toBeVisible();
    await page.screenshot({
      fullPage: true,
      path: '../docs/evidence/uiux-upgrade-b/screenshots/13-global-command-palette-desktop.png',
    });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(focusReturn).toBeFocused();

    await page.keyboard.press('Control+K');
    await expect(dialog).toBeVisible();
    await dialog
      .locator('[data-slot="command-item"]')
      .filter({ hasText: '文案生成' })
      .click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(
      page.getByText('待执行：文案生成', { exact: true })
    ).toBeVisible();
    expect(await creativeProjection(page)).toMatchObject({
      jobs: [],
      works: [],
    });
  });
});
