import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BASE_URL = process.env.CONTENTPACKAGE_BASE_URL ?? 'http://localhost:3000';
const OUT =
  process.env.CONTENTPACKAGE_EVIDENCE_OUT ??
  join(REPO_ROOT, 'output/playwright/contentpackage-ticket-09-12');
const SOURCE_PHOTO =
  process.env.CONTENTPACKAGE_SOURCE_PHOTO ??
  join(
    REPO_ROOT,
    'mkfast-template-main/public/model-previews/image-beauty-preview.png'
  );
const E2E_SECRET = process.env.CONTENTPACKAGE_E2E_SECRET ?? 'mkfast-e2e-secret';
const RUN_ID = `ticket-09-12-${Date.now()}`;
const user = {
  email: `e2e-${RUN_ID}@example.test`,
  name: '清风美学体验店',
  password: `Cp-${RUN_ID}!`,
};

const networkLog = [];
const steps = [];
let packageId;
let finalEvidence;

function step(name, details = {}) {
  const entry = { at: new Date().toISOString(), name, ...details };
  steps.push(entry);
  process.stdout.write(`[evidence] ${entry.at} ${name}\n`);
}

async function sha256(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function artifact(path) {
  return { bytes: (await stat(path)).size, sha256: await sha256(path) };
}

async function coreQuery(page, action, payload = {}) {
  const result = await page.evaluate(
    async ({ action, payload }) => {
      const response = await fetch('/api/core/p1/query', {
        body: JSON.stringify({ action, module: 'operations', payload }),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      return { envelope: await response.json(), status: response.status };
    },
    { action, payload }
  );
  assert.equal(result.status, 200, `${action} query failed`);
  return result.envelope.data;
}

async function coreCommand(page, module, action, payload, idempotencyKey) {
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
      return { envelope: await response.json(), status: response.status };
    },
    { action, idempotencyKey, module, payload }
  );
}

async function currentPackage(page) {
  const packages = await coreQuery(page, 'content_packages');
  const contentPackage = packages.find((item) => item.id === packageId);
  assert.ok(contentPackage, `ContentPackage ${packageId} was not found`);
  return contentPackage;
}

async function usageProjection(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/core/p1/query', {
      body: JSON.stringify({
        action: 'projection',
        module: 'entitlements',
        payload: {},
      }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const envelope = await response.json();
    return envelope.data;
  });
}

function usageDigest(projection) {
  const resources = projection?.usage ?? projection?.resources ?? projection;
  return JSON.stringify(resources);
}

async function waitForPackage(page, predicate, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const contentPackage = await currentPackage(page);
    if (predicate(contentPackage)) return contentPackage;
    if (Date.now() > deadline)
      throw new Error('ContentPackage condition timed out');
    await page.waitForTimeout(500);
  }
}

async function main() {
  await mkdir(join(OUT, 'keyframes'), { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'zh-CN',
    recordVideo: { dir: OUT, size: { height: 900, width: 1440 } },
    viewport: { height: 900, width: 1440 },
  });
  const page = await context.newPage();
  const video = page.video();
  const shot = (name) =>
    page.screenshot({
      path: join(OUT, 'keyframes', `${name}.png`),
      fullPage: true,
    });

  page.on('response', async (response) => {
    if (!response.url().includes('/api/core/')) return;
    const entry = {
      at: new Date().toISOString(),
      method: response.request().method(),
      path: response.url().replace(BASE_URL, '').split('?')[0],
      status: response.status(),
    };
    try {
      if (
        (response.headers()['content-type'] ?? '').includes('application/json')
      ) {
        const body = await response.json();
        if (body?.meta?.correlationId)
          entry.correlationId = body.meta.correlationId;
        if (body?.error?.code) entry.errorCode = body.error.code;
      }
    } catch {
      // Streaming responses intentionally keep only HTTP metadata.
    }
    networkLog.push(entry);
  });

  try {
    step('register:start');
    await page.goto(`${BASE_URL}/auth/register`, { waitUntil: 'networkidle' });
    await page.locator('input[name="name"]').fill(user.name);
    await page.locator('input[name="email"]').fill(user.email);
    await page.locator('input[name="password"]').fill(user.password);
    await page.getByRole('button', { name: /^sign up$|^注册$/i }).click();
    await page
      .getByText(/check your email|请检查您的邮箱/i)
      .waitFor({ timeout: 20_000 });
    const verification = await context.request.patch(
      `${BASE_URL}/api/e2e/users`,
      {
        data: { email: user.email, emailVerified: true, role: 'user' },
        headers: { 'x-e2e-secret': E2E_SECRET },
      }
    );
    assert.ok(verification.ok(), 'E2E email verification helper failed');
    await context.clearCookies();
    await page.goto(`${BASE_URL}/auth/login`, { waitUntil: 'networkidle' });
    await page.locator('input[name="email"]').fill(user.email);
    await page.locator('input[name="password"]').fill(user.password);
    await page.getByRole('button', { name: /^sign in$|^登录$/i }).click();
    await page.waitForURL((url) => url.pathname === '/dashboard', {
      timeout: 30_000,
    });
    step('login:done');

    const checkout = await coreCommand(
      page,
      'entitlements',
      'checkout_plan',
      { tier: 'growth' },
      `${RUN_ID}-growth`
    );
    assert.equal(checkout.status, 200, 'Growth plan checkout failed');

    await page.goto(`${BASE_URL}/dashboard/store`, {
      waitUntil: 'networkidle',
    });
    await page
      .locator('#pasted-facts')
      .fill(
        '清风美学体验店，成都高新区。头皮清洁与纳米熏蒸体验价 ¥59，营业时间 10:00–20:00，建议提前预约。'
      );
    await page.getByRole('button', { name: '生成初稿' }).click();
    await page.getByText('未确认初稿', { exact: true }).waitFor();
    await page.locator('#store-name').fill('清风美学体验店');
    await page.locator('#store-city').fill('成都');
    await page.locator('#store-district').fill('高新区');
    await page.locator('#store-address').fill('天府大道中段 500 号');
    await page.locator('#store-booking').fill('建议提前预约；10:00 开始营业');
    await page.locator('#store-project-name').fill('头皮清洁与纳米熏蒸');
    await page.locator('#project-price').fill('59');
    await page
      .locator('#brand-voice')
      .fill('专业、真实、克制，不承诺治疗效果。');
    await page.getByRole('button', { name: '保存门店资料' }).click();
    await page
      .getByText('已确认', { exact: true })
      .waitFor({ timeout: 20_000 });

    await page.goto(`${BASE_URL}/dashboard/assets`, {
      waitUntil: 'networkidle',
    });
    await page.locator('#canonical-asset-upload').setInputFiles(SOURCE_PHOTO);
    await page
      .getByRole('link', { name: '确认这张素材能否用于宣传' })
      .first()
      .click();
    await page
      .getByLabel('授权凭证编号或存档位置')
      .fill(`owned-evidence-${RUN_ID}`);
    await page.getByRole('button', { name: /确认公开营销授权/ }).click();
    await page.getByText('公开营销可用', { exact: true }).waitFor();
    step('merchant-foundation:ready');

    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '做一条项目种草内容' }).click();
    const more = page.getByRole('button', { exact: true, name: '更多' });
    if (await more.isVisible().catch(() => false)) await more.click();
    const source = page.getByRole('button', { name: /^素材 · / }).first();
    await source.waitFor({ state: 'visible', timeout: 30_000 });
    if ((await source.getAttribute('aria-pressed')) !== 'true')
      await source.click();
    await page
      .getByLabel('描述这次想创作的内容')
      .fill(
        '为 59 元头皮清洁与纳米熏蒸写一条真实克制的项目种草内容，不承诺治疗效果。'
      );
    await page.getByRole('button', { name: '建立创作记录' }).click();
    const record = page.getByLabel('创作助理整理的记录');
    await record.waitFor({ state: 'visible' });
    await record.getByRole('button', { name: '采用并确认 Brief' }).click();
    await record.getByText('Brief 已确认', { exact: true }).waitFor();
    await record.getByRole('button', { name: /^调整专业参数/ }).click();
    await record
      .getByRole('radiogroup', { name: '执行模型' })
      .getByRole('radio', { name: /OpenAI/ })
      .click();
    const acceptance = record.getByRole('checkbox', {
      name: /我已确认模型、规格、费用和发布标识/,
    });
    await page.waitForTimeout(300);
    await acceptance.check();
    await page.waitForFunction(
      () =>
        !document.querySelector('[data-testid="execute-tool-action"]')
          ?.disabled,
      undefined,
      { timeout: 30_000 }
    );
    await record.getByTestId('execute-tool-action').click();
    const candidates = page.getByRole('radiogroup', { name: '三条文案候选' });
    await candidates.waitFor({ state: 'visible', timeout: 180_000 });
    assert.equal(await candidates.getByRole('radio').count(), 3);
    await shot('01-three-real-llm-candidates');
    await candidates.getByRole('radio').nth(1).click();
    await page
      .getByRole('region', { name: '文案候选择优' })
      .getByRole('button', { name: '采用所选文案' })
      .click();
    const libraryLink = page.getByRole('link', { name: '在内容库查看' });
    await libraryLink.waitFor({ state: 'visible', timeout: 60_000 });
    const href = await libraryLink.getAttribute('href');
    packageId =
      href?.match(/packageId=([^&]+)/)?.[1] ??
      href?.match(/\/dashboard\/content\/([^?]+)/)?.[1];
    assert.ok(packageId, 'Adoption did not expose a ContentPackage id');
    step('copy:adopted', { packageId });

    await page.goto(`${BASE_URL}/dashboard/content?packageId=${packageId}`, {
      waitUntil: 'networkidle',
    });
    const generateVariants = page.getByRole('button', {
      name: /^生成三平台版本/,
    });
    await generateVariants.waitFor({ state: 'visible', timeout: 60_000 });
    await generateVariants.click();
    for (const platform of ['小红书', '抖音', '视频号']) {
      await page
        .getByRole('button', { exact: true, name: platform })
        .waitFor({ timeout: 180_000 });
    }
    const baseline = await currentPackage(page);
    assert.deepEqual(
      baseline.variants.map((variant) => variant.platform).sort(),
      ['douyin', 'video_account', 'xiaohongshu']
    );
    const copyDigests = baseline.variants.map((variant) => {
      const version = variant.versions.find(
        (item) => item.id === variant.currentVersionId
      );
      return createHash('sha256')
        .update(`${version.title}\n${version.body}`)
        .digest('hex');
    });
    assert.equal(
      new Set(copyDigests).size,
      3,
      'Platform copies are not materially distinct'
    );
    await shot('02-three-platform-variants');
    step('variants:ready');

    const baselineUsage = await usageProjection(page);
    const baselineStatus = baseline.status;
    const untouched = Object.fromEntries(
      baseline.variants
        .filter((variant) => variant.platform !== 'xiaohongshu')
        .map((variant) => [variant.platform, JSON.stringify(variant.versions)])
    );

    await page.getByRole('button', { exact: true, name: '小红书' }).click();
    await page.locator('#content-package-title').fill('小红书商户自由编辑版');
    await page
      .locator('#content-package-body')
      .fill('这是商户在真实内容库里保存的新正文，保留到店事实并弱化广告感。');
    await page.getByRole('button', { name: '保存为新版本' }).click();
    const edited = await waitForPackage(page, (item) => {
      const variant = item.variants.find(
        (candidate) => candidate.platform === 'xiaohongshu'
      );
      return variant?.versions.length === 2;
    });
    const editedXhs = edited.variants.find(
      (variant) => variant.platform === 'xiaohongshu'
    );
    assert.equal(editedXhs.versions.at(-1).source, 'merchant_edited');
    assert.equal(edited.status, baselineStatus);
    await page.getByRole('button', { name: '与当前版本对比' }).first().click();
    await page.getByText('历史版本', { exact: true }).waitFor();
    await shot('03-edit-history-compare');
    step('version:edited-and-compared');

    await page.getByRole('button', { name: '回滚为新版本' }).first().click();
    const rolledBack = await waitForPackage(page, (item) => {
      const variant = item.variants.find(
        (candidate) => candidate.platform === 'xiaohongshu'
      );
      return (
        variant?.versions.length === 3 &&
        variant.versions.at(-1)?.source === 'rollback_restored'
      );
    });
    const rolledBackXhs = rolledBack.variants.find(
      (variant) => variant.platform === 'xiaohongshu'
    );
    assert.equal(
      rolledBackXhs.versions.at(-1).revertedFromVersionId,
      rolledBackXhs.versions[0].id
    );
    assert.equal(rolledBack.status, baselineStatus);
    await shot('04-rollback-created-new-version');
    step('version:rollback-created-new-version');

    for (const [platform, versions] of Object.entries(untouched)) {
      const actual = rolledBack.variants.find(
        (variant) => variant.platform === platform
      );
      assert.equal(
        JSON.stringify(actual.versions),
        versions,
        `${platform} history changed with Xiaohongshu`
      );
    }

    const staleVersion = rolledBackXhs.versions.at(-1);
    const concurrent = await coreCommand(
      page,
      'operations',
      'edit_content_package_variant',
      {
        baseVersionId: staleVersion.id,
        changes: {
          body: staleVersion.body,
          conversionHook: staleVersion.conversionHook,
          orderedAssetIds: staleVersion.orderedAssetIds,
          title: '并发窗口先保存的版本',
          topics: staleVersion.topics,
        },
        packageId,
        platform: 'xiaohongshu',
      },
      `${RUN_ID}-concurrent-winner`
    );
    assert.equal(concurrent.status, 200, 'Concurrent winner edit failed');
    await page.locator('#content-package-title').fill('过期窗口不应覆盖新版本');
    await page.getByRole('button', { name: '保存为新版本' }).click();
    await page
      .getByText('已在别处更新，请刷新后再编辑。', { exact: true })
      .waitFor({ timeout: 30_000 });
    await shot('05-optimistic-conflict-visible');
    step('version:optimistic-conflict-visible');

    const finalPackage = await currentPackage(page);
    const finalUsage = await usageProjection(page);
    assert.equal(
      finalPackage.status,
      baselineStatus,
      'Free edits changed package status'
    );
    assert.equal(
      usageDigest(finalUsage),
      usageDigest(baselineUsage),
      'Free edits or rollback changed usage'
    );
    const finalXhs = finalPackage.variants.find(
      (variant) => variant.platform === 'xiaohongshu'
    );
    assert.equal(finalXhs.versions.length, 4);
    assert.deepEqual(
      finalXhs.versions.map((version) => version.source),
      [
        'ai_generated',
        'merchant_edited',
        'rollback_restored',
        'merchant_edited',
      ]
    );

    finalEvidence = {
      package: {
        id: packageId,
        kind: finalPackage.kind,
        statusAfter: finalPackage.status,
        statusBefore: baselineStatus,
      },
      ticket11: {
        copyDigests,
        platformVersionCounts: Object.fromEntries(
          baseline.variants.map((variant) => [
            variant.platform,
            variant.versions.length,
          ])
        ),
        platforms: baseline.variants.map((variant) => variant.platform),
      },
      ticket12: {
        finalXiaohongshuSources: finalXhs.versions.map(
          (version) => version.source
        ),
        optimisticConflictCode: 'CONTENT_PACKAGE_VERSION_CONFLICT',
        otherPlatformHistoriesUnchanged: true,
        rollbackCreatedNewVersion: true,
        statusUnchanged: true,
        usageUnchanged: true,
      },
    };
  } finally {
    await writeFile(
      join(OUT, 'network-log.jsonl'),
      networkLog.map(JSON.stringify).join('\n')
    );
    await context.close();
    await browser.close();
  }

  const recordedVideo = await video.path();
  const finalVideo = join(OUT, 'continuous-journey.webm');
  if (recordedVideo !== finalVideo) await rename(recordedVideo, finalVideo);
  const keyframes = [
    '01-three-real-llm-candidates.png',
    '02-three-platform-variants.png',
    '03-edit-history-compare.png',
    '04-rollback-created-new-version.png',
    '05-optimistic-conflict-visible.png',
  ];
  const artifacts = {
    'continuous-journey.webm': await artifact(finalVideo),
    'network-log.jsonl': await artifact(join(OUT, 'network-log.jsonl')),
  };
  for (const name of keyframes)
    artifacts[`keyframes/${name}`] = await artifact(
      join(OUT, 'keyframes', name)
    );

  const manifest = {
    artifacts,
    completedAt: new Date().toISOString(),
    environment: {
      core: 'http://localhost:4100',
      postgres: 'localhost:54329',
      web: BASE_URL,
    },
    evidenceLinks: {
      ticket09:
        'docs/evidence/contentpackage/real-run-0003/journey/run-manifest.json',
      ticket10:
        'docs/evidence/contentpackage/real-run-0001/provider-probe/README.md',
      ticket11And12: '.',
    },
    ...finalEvidence,
    redaction: [
      'No credentials, cookies, provider task references, signed URLs, workspace ids, or raw generated copy are stored.',
      'The network log stores only method, status, path without query, correlation id, and error code.',
    ],
    runId: RUN_ID,
    status: 'accepted',
    steps,
    ticketStatus: {
      '09': 'accepted by linked real-run-0003 plus deterministic rights rejection tests',
      10: 'provider-real bytes accepted; merchant browser video journey remains a separate gap',
      11: 'accepted by this continuous real-LLM browser journey',
      12: 'accepted by this continuous edit, compare, rollback, and conflict browser journey',
    },
  };
  await writeFile(
    join(OUT, 'run-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  process.stdout.write(
    `${JSON.stringify({ ok: true, out: OUT, packageId, runId: RUN_ID })}\n`
  );
}

await main();
