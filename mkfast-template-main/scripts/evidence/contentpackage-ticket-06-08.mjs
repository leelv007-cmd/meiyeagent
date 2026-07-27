import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from '@playwright/test';

const baseUrl = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:3000';
const outputRoot = path.resolve(
  process.env.EVIDENCE_OUTPUT_DIR ??
    '../docs/evidence/contentpackage/ticket-06-08'
);
const photoA = path.resolve(
  process.env.EVIDENCE_PHOTO_A ?? 'public/seed/store/store-artist-working.webp'
);
const photoB = path.resolve(
  process.env.EVIDENCE_PHOTO_B ?? 'public/seed/store/store-natural-light.webp'
);
const runId = `ticket-06-08-${Date.now()}`;
const outputDir = path.join(outputRoot, runId);
const account = {
  email: `e2e-${runId}@example.test`,
  name: 'Ticket 06-08 evidence merchant',
  password: `Cp-${runId}!`,
};
const network = [];
const steps = [];

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: 'zh-CN',
  recordVideo: { dir: outputDir, size: { width: 1440, height: 900 } },
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(details)}`);
}

function recordStep(name, details = {}) {
  const entry = { at: new Date().toISOString(), name, ...details };
  steps.push(entry);
  console.log(JSON.stringify({ step: entry }));
}

async function screenshot(name, options = {}) {
  await page.screenshot({
    fullPage: true,
    path: path.join(outputDir, `${name}.png`),
    ...options,
  });
}

async function query(module, action, payload = {}) {
  return page.evaluate(
    async ({ action, module, payload }) => {
      const response = await fetch('/api/core/p1/query', {
        body: JSON.stringify({ action, module, payload }),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      return { body: await response.json(), status: response.status };
    },
    { action, module, payload }
  );
}

async function command(module, action, payload, idempotencyKey) {
  return page.evaluate(
    async ({ action, idempotencyKey, module, payload }) => {
      const response = await fetch('/api/core/p1/commands', {
        body: JSON.stringify({ action, module, payload }),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
        },
        method: 'POST',
      });
      return { body: await response.json(), status: response.status };
    },
    { action, idempotencyKey, module, payload }
  );
}

async function hashArtifacts() {
  const entries = [];
  for (const name of (await readdir(outputDir)).sort()) {
    if (name === 'manifest.json') continue;
    const bytes = await readFile(path.join(outputDir, name));
    entries.push({
      bytes: bytes.byteLength,
      name,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  return entries;
}

async function registerAndLogin() {
  await page.goto(`${baseUrl}/auth/register`, { waitUntil: 'networkidle' });
  await page.locator('input[name="name"]').fill(account.name);
  await page.locator('input[name="email"]').fill(account.email);
  await page.locator('input[name="password"]').fill(account.password);
  await page.getByRole('button', { name: /^sign up$|^注册$/i }).click();
  await page
    .getByText(/check your email to verify your account|请检查您的邮箱/i)
    .waitFor({ timeout: 20_000 });
  const verification = await context.request.patch(`${baseUrl}/api/e2e/users`, {
    data: { email: account.email, emailVerified: true, role: 'user' },
    headers: { 'x-e2e-secret': 'mkfast-e2e-secret' },
  });
  assert(verification.ok(), 'E2E verification failed', verification.status());
  await context.clearCookies();
  await page.goto(`${baseUrl}/auth/login`, { waitUntil: 'networkidle' });
  await page.locator('input[name="email"]').fill(account.email);
  await page.locator('input[name="password"]').fill(account.password);
  await page.getByRole('button', { name: /^sign in$|^登录$/i }).click();
  await page.waitForURL((url) => url.pathname === '/dashboard', {
    timeout: 30_000,
  });
  recordStep('account:authenticated');
}

async function activateGrowthPlan() {
  const checkout = await command(
    'entitlements',
    'checkout_plan',
    { tier: 'growth' },
    `${runId}-growth-plan`
  );
  assert(checkout.status === 200, 'Growth plan checkout failed', checkout);
  recordStep('plan:growth-active', {
    correlationId: checkout.body?.meta?.correlationId,
  });
}

async function confirmStore() {
  await page.goto(`${baseUrl}/dashboard/store`, { waitUntil: 'networkidle' });
  await page
    .locator('#pasted-facts')
    .fill(
      [
        '云栖美研护理店，成都高新区。',
        '体验项目：头皮清洁护理，体验价 ¥59。',
        '地址：天府大道中段 500 号，建议提前预约。',
      ].join('\n')
    );
  await page.getByRole('button', { name: '生成初稿' }).click();
  await page.getByText('未确认初稿', { exact: true }).waitFor();
  await page.locator('#store-name').fill('云栖美研护理店');
  await page.locator('#store-city').fill('成都');
  await page.locator('#store-district').fill('高新区');
  await page.locator('#store-address').fill('天府大道中段 500 号');
  await page.locator('#store-booking').fill('建议提前预约');
  await page.locator('#store-project-name').fill('头皮清洁护理');
  await page.locator('#project-price').fill('59');
  await page.locator('#brand-voice').fill('专业、真实、克制，不承诺治疗效果。');
  await page.getByRole('button', { name: '保存门店资料' }).click();
  await page.getByText('已确认', { exact: true }).waitFor({ timeout: 20_000 });
  await screenshot('01-store-confirmed');
  recordStep('store:confirmed');
}

async function uploadAndAuthorize(photo, index) {
  await page.goto(`${baseUrl}/dashboard/assets`, { waitUntil: 'networkidle' });
  await page
    .locator('input[type="file"]#canonical-asset-upload')
    .setInputFiles(photo);
  const reviewLink = page
    .getByRole('link', { name: '确认这张素材能否用于宣传' })
    .first();
  await reviewLink.waitFor({ state: 'visible', timeout: 30_000 });
  await reviewLink.click();
  await page.waitForURL(/\/dashboard\/assets\/asset-/);
  await page
    .getByLabel('授权凭证编号或存档位置')
    .fill(`${runId}-owner-consent-${index}`);
  await page.getByRole('button', { name: /确认公开营销授权/ }).click();
  await page.getByText('公开营销可用', { exact: true }).waitFor();
  recordStep(`asset:${index}:authorized`);
}

async function createCopyWorkAndAdopt() {
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '做一条项目种草内容' }).click();
  const more = page.getByRole('button', { exact: true, name: '更多' });
  if (await more.isVisible().catch(() => false)) {
    if ((await more.getAttribute('aria-expanded')) !== 'true')
      await more.click();
  }
  const sourceChips = page.getByRole('button', { name: /^素材 · / });
  await sourceChips.first().waitFor({ state: 'visible', timeout: 30_000 });
  for (let index = 0; index < (await sourceChips.count()); index += 1) {
    const chip = sourceChips.nth(index);
    if ((await chip.getAttribute('aria-pressed')) !== 'true')
      await chip.click();
  }
  await page
    .getByLabel('描述这次想创作的内容')
    .fill(
      '写一条真实克制的项目种草内容：头皮清洁护理体验价¥59，说清体验流程、适合人群和预约方式，不承诺治疗效果。'
    );
  await page.getByRole('button', { name: '建立创作记录' }).click();
  const record = page.getByLabel('创作助理整理的记录');
  await record.waitFor({ state: 'visible' });
  await record.getByRole('button', { name: '采用并确认 Brief' }).click();
  await record.getByText('Brief 已确认', { exact: true }).waitFor();
  await record.getByRole('button', { name: /^调整专业参数/ }).click();
  const modelGroup = record.getByRole('radiogroup', { name: '执行模型' });
  await modelGroup.waitFor({ state: 'visible', timeout: 30_000 });
  const availableModels = modelGroup
    .getByRole('radio')
    .filter({ hasNot: page.locator('[disabled]') });
  const openAi = modelGroup.getByRole('radio', { name: /OpenAI/ });
  if (await openAi.isVisible().catch(() => false)) await openAi.click();
  else await availableModels.first().click();
  const contract = record.getByRole('checkbox', {
    name: /我已确认模型、规格、费用和发布标识/,
  });
  await page.waitForTimeout(300);
  if (!(await contract.isChecked())) await contract.check();
  const submit = record.getByTestId('execute-tool-action');
  await submit.waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(
    () =>
      !document.querySelector('[data-testid="execute-tool-action"]')?.disabled,
    undefined,
    { timeout: 30_000 }
  );
  await screenshot('02-copy-ready');
  if (!(await contract.isChecked())) await contract.check();
  await submit.click();
  const selector = page.getByRole('region', { name: '文案候选择优' });
  const candidates = selector.getByRole('radiogroup', { name: '三条文案候选' });
  await candidates.waitFor({ state: 'visible', timeout: 180_000 });
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        '[role="radiogroup"][aria-label="三条文案候选"] [role="radio"]'
      ).length === 3,
    undefined,
    { timeout: 180_000 }
  );
  await screenshot('03-three-copy-candidates');
  await candidates.getByRole('radio', { name: /^候选 B：/ }).click();
  await screenshot('04-candidate-b-two-assets-selected');
  await selector.getByRole('button', { name: '采用所选文案' }).click();
  await selector
    .getByText('本批已采用 1 条文案', { exact: true })
    .waitFor({ timeout: 60_000 });
  const libraryLink = page.getByRole('link', { name: '在内容库查看' });
  await libraryLink.waitFor({ state: 'visible' });
  const href = await libraryLink.getAttribute('href');
  const packageId =
    href?.match(/packageId=([^&]+)/)?.[1] ??
    href?.match(/\/dashboard\/content\/([^?]+)/)?.[1];
  assert(packageId, 'Adoption did not expose a ContentPackage link', href);
  const packages = await query('operations', 'content_packages');
  const contentPackage = packages.body?.data?.find(
    (item) => item.id === packageId
  );
  const currentVersion = contentPackage?.versions?.find(
    (version) => version.id === contentPackage.currentVersionId
  );
  assert(
    contentPackage?.kind === 'image_text',
    'Adoption kind changed',
    contentPackage
  );
  assert(
    contentPackage?.statusLabel === '可使用',
    'Adoption is not usable',
    contentPackage
  );
  assert(
    currentVersion?.orderedAssetIds?.length >= 2,
    'Adoption did not preserve at least two ordered visuals',
    currentVersion
  );
  recordStep('copy:adopted', {
    orderedAssetIds: currentVersion.orderedAssetIds,
    packageId,
    selectedCandidate: 'B',
  });
  return { contentPackage, packageId, workId: contentPackage.source.workId };
}

async function verifyLibraryAndNavigation(packageId) {
  await page.goto(`${baseUrl}/dashboard/content?packageId=${packageId}`, {
    waitUntil: 'networkidle',
  });
  const card = page.locator(`article[data-content-package-id="${packageId}"]`);
  await card.waitFor({ state: 'visible', timeout: 30_000 });
  await card.getByText('可使用', { exact: true }).waitFor();
  await screenshot('05-image-package-immediately-visible');
  const normalizedNavigation = [];
  for (const label of ['创作', '内容', '素材', '门店']) {
    const item = page.getByRole('link', { name: label, exact: true }).first();
    await item.waitFor({ state: 'visible', timeout: 10_000 });
    normalizedNavigation.push(label);
  }
  for (const pathname of ['/dashboard/tasks']) {
    await page.goto(`${baseUrl}${pathname}`, { waitUntil: 'networkidle' });
    assert(
      page.url().includes(pathname),
      'Stable secondary route changed',
      page.url()
    );
  }
  recordStep('library:image-and-navigation-verified', {
    firstLevelNavigation: normalizedNavigation,
  });
}

async function confirmAndCancelVideo(workId, imagePackageId) {
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle' });
  const existingWorkIds = new Set(
    (
      (await query('operations', 'creative_workbench')).body?.data?.works ?? []
    ).map((work) => work.id)
  );
  await page.getByRole('button', { name: '新建创作' }).click();
  const more = page.getByRole('button', { exact: true, name: '更多' });
  if (await more.isVisible().catch(() => false)) {
    if ((await more.getAttribute('aria-expanded')) !== 'true')
      await more.click();
  }
  const sourceChips = page.getByRole('button', { name: /^素材 · / });
  await sourceChips.first().waitFor({ state: 'visible', timeout: 30_000 });
  for (let index = 0; index < (await sourceChips.count()); index += 1) {
    const chip = sourceChips.nth(index);
    if ((await chip.getAttribute('aria-pressed')) !== 'true')
      await chip.click();
  }
  await page
    .getByLabel('描述这次想创作的内容')
    .fill(
      '用两张门店实拍素材制作一条头皮清洁护理项目短视频，真实克制，不承诺治疗效果。'
    );
  await page.getByRole('button', { name: '建立创作记录' }).click();
  const record = page.getByLabel('创作助理整理的记录');
  await record.waitFor({ state: 'visible' });
  await record.getByRole('button', { name: '采用并确认 Brief' }).click();
  await record.getByText('Brief 已确认', { exact: true }).waitFor();
  const projection = await query('operations', 'creative_workbench');
  const videoWork = projection.body?.data?.works?.find(
    (candidate) => !existingWorkIds.has(candidate.id)
  );
  assert(
    videoWork,
    'New video Work was not visible in the projection',
    projection
  );
  workId = videoWork.id;
  await page.getByRole('button', { name: '做视频' }).click();
  const professional = page.getByRole('button', { name: /^调整专业参数/ });
  if ((await professional.getAttribute('aria-expanded')) !== 'true') {
    await professional.click();
  }
  const modelGroup = page.getByRole('radiogroup', { name: '执行模型' });
  await modelGroup.waitFor({ state: 'visible', timeout: 30_000 });
  const enabledModelCount = await modelGroup
    .getByRole('radio')
    .evaluateAll(
      (nodes) =>
        nodes.filter(
          (node) =>
            node.getAttribute('aria-disabled') !== 'true' &&
            !node.hasAttribute('data-disabled')
        ).length
    );
  if (enabledModelCount === 0) {
    await screenshot('06-video-model-unavailable');
    recordStep('video:blocked-no-live-verified-model', {
      reason: 'All video model choices are disabled by the current catalog.',
    });
    return null;
  }
  const selectedModel = modelGroup.getByRole('radio', { checked: true });
  if ((await selectedModel.count()) === 0) {
    await modelGroup
      .locator(
        '[role="radio"]:not([aria-disabled="true"]):not([data-disabled])'
      )
      .first()
      .click();
  }
  const contract = page.getByRole('checkbox', {
    name: /我已确认模型、规格、费用和发布标识/,
  });
  await contract.waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(300);
  if (!(await contract.isChecked())) await contract.check();
  const lock = page.getByRole('button', { name: '锁定分镜' });
  await lock.waitFor({ state: 'visible', timeout: 30_000 });
  await screenshot('06-video-storyboard-ready');
  await lock.click();
  const confirm = page.getByRole('button', { name: '确认分镜并开始生成' });
  await confirm.waitFor({ state: 'visible', timeout: 30_000 });
  await screenshot('07-video-storyboard-locked');
  await confirm.click();
  const creatingDeadline = Date.now() + 30_000;
  let videoPackage;
  for (;;) {
    const packages = await query('operations', 'content_packages');
    videoPackage = packages.body?.data?.find(
      (item) => item.kind === 'video' && item.source.workId === workId
    );
    if (videoPackage) break;
    if (Date.now() > creatingDeadline) {
      throw new Error('Confirmed video ContentPackage did not appear.');
    }
    await page.waitForTimeout(500);
  }
  assert(
    videoPackage.statusLabel === '创作中',
    'Video package is not creating',
    videoPackage
  );
  await page.goto(`${baseUrl}/dashboard/content`, { waitUntil: 'networkidle' });
  const imageCard = page.locator(
    `article[data-content-package-id="${imagePackageId}"]`
  );
  const videoCard = page.locator(
    `article[data-content-package-id="${videoPackage.id}"]`
  );
  await imageCard.waitFor({ state: 'visible', timeout: 30_000 });
  await videoCard.waitFor({ state: 'visible', timeout: 30_000 });
  await videoCard.getByText('创作中', { exact: true }).waitFor();
  await screenshot('08-image-and-creating-video-same-library');
  recordStep('video:creating-in-library', { packageId: videoPackage.id });

  await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle' });
  const cancel = page.getByRole('button', { name: '取消视频任务' });
  await cancel.waitFor({ state: 'visible', timeout: 30_000 });
  await cancel.click();
  const cancellationDeadline = Date.now() + 60_000;
  for (;;) {
    const packages = await query('operations', 'content_packages');
    videoPackage = packages.body?.data?.find(
      (item) => item.id === videoPackage.id
    );
    if (videoPackage?.status === 'cancelled') break;
    if (Date.now() > cancellationDeadline) {
      throw new Error(
        `Video cancellation did not settle: ${videoPackage?.status}`
      );
    }
    await page.waitForTimeout(1_000);
  }
  assert(
    videoPackage.versions.length === 0,
    'Cancelled video gained a version',
    videoPackage
  );
  assert(
    (videoPackage.generated.ownedAssets ?? []).length === 0,
    'Cancelled video gained playable media',
    videoPackage
  );
  await page.goto(`${baseUrl}/dashboard/content`, { waitUntil: 'networkidle' });
  await page
    .locator(`article[data-content-package-id="${videoPackage.id}"]`)
    .getByText('需处理', { exact: true })
    .waitFor({ timeout: 30_000 });
  await screenshot('09-cancelled-video-needs-attention');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle' });
  await page
    .locator(`article[data-content-package-id="${videoPackage.id}"]`)
    .getByText('需处理', { exact: true })
    .waitFor({ timeout: 30_000 });
  await screenshot('10-mobile-same-cancelled-video');
  recordStep('video:cancelled-without-playable-version', {
    packageId: videoPackage.id,
    status: videoPackage.status,
    versions: videoPackage.versions.length,
  });
  return videoPackage;
}

page.on('response', async (response) => {
  if (!response.url().includes('/api/core/p1/')) return;
  let body;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  network.push({
    at: new Date().toISOString(),
    correlationId: body?.meta?.correlationId,
    errorCode: body?.error?.code,
    method: response.request().method(),
    path: new URL(response.url()).pathname,
    status: response.status(),
  });
});

let imagePackage;
let videoPackage;
let failure;
try {
  await registerAndLogin();
  await activateGrowthPlan();
  await confirmStore();
  await uploadAndAuthorize(photoA, 1);
  await uploadAndAuthorize(photoB, 2);
  await screenshot('01b-two-assets-authorized');
  imagePackage = await createCopyWorkAndAdopt();
  await verifyLibraryAndNavigation(imagePackage.packageId);
  videoPackage = await confirmAndCancelVideo(
    imagePackage.workId,
    imagePackage.packageId
  );
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  await screenshot('failure').catch(() => undefined);
} finally {
  await writeFile(
    path.join(outputDir, 'network-log.jsonl'),
    `${network.map((entry) => JSON.stringify(entry)).join('\n')}\n`
  );
  await writeFile(
    path.join(outputDir, 'journey.json'),
    `${JSON.stringify(
      {
        accountRef: createHash('sha256').update(account.email).digest('hex'),
        imagePackageId: imagePackage?.packageId,
        runId,
        steps,
        videoPackageId: videoPackage?.id,
      },
      null,
      2
    )}\n`
  );
  await context.close();
  await browser.close();
  const videos = (await readdir(outputDir)).filter((name) =>
    name.endsWith('.webm')
  );
  if (videos.length === 1 && videos[0] !== 'continuous-journey.webm') {
    await rename(
      path.join(outputDir, videos[0]),
      path.join(outputDir, 'continuous-journey.webm')
    );
  }
  const manifest = {
    acceptance: {
      candidateCount: steps.some((item) => item.name === 'copy:adopted')
        ? 3
        : 0,
      cancelledVideoHasNoPlayableVersion:
        videoPackage?.status === 'cancelled' &&
        videoPackage.versions.length === 0,
      desktopAndMobileSameVideoPackage: steps.some(
        (item) => item.name === 'video:cancelled-without-playable-version'
      ),
      imageAndVideoShareLibrary: steps.some(
        (item) => item.name === 'video:creating-in-library'
      ),
      imagePackageImmediatelyVisible: steps.some(
        (item) => item.name === 'library:image-and-navigation-verified'
      ),
      orderedVisualCount: imagePackage?.contentPackage?.versions?.find(
        (version) => version.id === imagePackage.contentPackage.currentVersionId
      )?.orderedAssetIds?.length,
      videoPackageCreatingOnConfirm: steps.some(
        (item) => item.name === 'video:creating-in-library'
      ),
    },
    completedAt: new Date().toISOString(),
    failure,
    limitations: [
      videoPackage
        ? 'This run intentionally cancels the video after proving the creating state; it does not claim completed-provider playback.'
        : 'The current catalog exposes no live-verified video model, so the user-visible confirm lifecycle is blocked without an administrator runtime change.',
      'The current-vs-before and external benchmark comparison remain governance evidence outside this harness.',
    ],
    ok: !failure,
    runId,
    runtime: {
      baseUrl,
      browser: 'chromium',
      mobileViewport: { height: 844, width: 390 },
      viewport: { height: 900, width: 1440 },
    },
  };
  await writeFile(
    path.join(outputDir, 'manifest.json'),
    `${JSON.stringify(
      { ...manifest, artifacts: await hashArtifacts() },
      null,
      2
    )}\n`
  );
}

if (failure) throw new Error(failure);
console.log(JSON.stringify({ ok: true, outputDir, runId }));
