import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:3000';
const email = required('EVIDENCE_EMAIL');
const password = required('EVIDENCE_PASSWORD');
const packageId = required('EVIDENCE_PACKAGE_ID');
const assetId = required('EVIDENCE_ASSET_ID');
const runId = process.env.EVIDENCE_RUN_ID ?? `ticket-15-rights-${Date.now()}`;
const output = path.resolve(
  process.env.EVIDENCE_OUT ?? `docs/evidence/contentpackage/ticket-15/${runId}`
);
const journey = path.join(output, 'journey');
const keyframes = path.join(journey, 'keyframes');
const steps = [];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function login(page) {
  await page.goto(`${baseUrl}/auth/login`, { waitUntil: 'networkidle' });
  await page.getByRole('textbox', { name: '邮箱' }).fill(email);
  await page.getByRole('textbox', { name: '密码' }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForURL((url) => url.pathname === '/dashboard');
}

async function productState(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/core/product/state', {
      credentials: 'same-origin',
    });
    return (await response.json()).data;
  });
}

async function query(page, action, payload) {
  return page.evaluate(
    async ({ action, payload }) => {
      const response = await fetch('/api/core/p1/query', {
        body: JSON.stringify({ action, module: 'operations', payload }),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.code ?? `HTTP_${response.status}`);
      return body.data;
    },
    { action, payload }
  );
}

async function command(page, action, payload, key) {
  return page.evaluate(
    async ({ action, key, payload }) => {
      const response = await fetch('/api/core/p1/commands', {
        body: JSON.stringify({ action, module: 'operations', payload }),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': key,
        },
        method: 'POST',
      });
      const body = await response.json();
      return {
        errorCode: body.error?.code,
        status: response.status,
      };
    },
    { action, key, payload }
  );
}

async function openPackage(page) {
  await page.goto(
    `${baseUrl}/dashboard/content/${encodeURIComponent(packageId)}`,
    { waitUntil: 'networkidle' }
  );
  await page.getByText('内容详情', { exact: true }).waitFor();
}

async function shot(page, name) {
  await page.screenshot({
    fullPage: true,
    path: path.join(keyframes, name),
  });
}

function record(name, detail = {}) {
  steps.push({ at: new Date().toISOString(), name, ...detail });
  process.stdout.write(`[evidence] ${name}\n`);
}

async function main() {
  await mkdir(keyframes, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'zh-CN',
    recordVideo: { dir: journey, size: { height: 900, width: 1440 } },
    viewport: { height: 900, width: 1440 },
  });
  const page = await context.newPage();
  let video;
  let videoPath;
  try {
    await login(page);
    const beforeAssets = await productState(page);
    const asset = beforeAssets.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error('EVIDENCE_ASSET_ID was not found.');
    await page.goto(
      `${baseUrl}/dashboard/assets/${encodeURIComponent(asset.id)}`,
      { waitUntil: 'networkidle' }
    );
    await page.getByText('公开营销可用', { exact: true }).waitFor();
    await shot(page, '01-new-asset-authorized.png');
    record('asset-authorized');

    const beforePackage = await query(page, 'content_package', { packageId });
    const currentVersion = beforePackage.versions.find(
      (version) => version.id === beforePackage.currentVersionId
    );
    if (!currentVersion)
      throw new Error('Package current version was not found.');
    const alreadyReferenced =
      beforePackage.source.assetIds.includes(asset.id) ||
      currentVersion.orderedAssetIds.includes(asset.id);
    if (!alreadyReferenced) {
      throw new Error(
        'EVIDENCE_ASSET_ID must already be referenced by EVIDENCE_PACKAGE_ID.'
      );
    }
    await openPackage(page);
    await shot(page, '02-package-before-withdrawal.png');

    await page.goto(
      `${baseUrl}/dashboard/assets/${encodeURIComponent(asset.id)}`,
      { waitUntil: 'networkidle' }
    );
    await page.getByRole('button', { name: '撤回授权' }).click();
    await page.waitForFunction(
      async (expectedAssetId) => {
        const response = await fetch('/api/core/product/state', {
          credentials: 'same-origin',
        });
        const body = await response.json();
        return body.data?.assets?.some(
          (item) =>
            item.id === expectedAssetId &&
            item.authorizationStatus === 'withdrawn'
        );
      },
      asset.id,
      { timeout: 30_000 }
    );
    await shot(page, '03-asset-withdrawn.png');
    record('asset-withdrawn');

    await openPackage(page);
    await page.getByText('引用素材已撤回授权', { exact: true }).waitFor();
    await shot(page, '04-package-blocked-after-withdrawal.png');
    const afterWithdrawal = await query(page, 'content_package', { packageId });
    const receiptCount = afterWithdrawal.exportReceipts.length;
    const exportAttempt = await command(
      page,
      'export_content_package',
      { packageId, platform: 'xiaohongshu' },
      `${runId}-blocked-export`
    );
    const reuseAttempt = await command(
      page,
      'reuse_content_package',
      { sourcePackageId: packageId },
      `${runId}-blocked-reuse`
    );
    const finalPackage = await query(page, 'content_package', { packageId });
    if (
      exportAttempt.status !== 409 ||
      exportAttempt.errorCode !== 'RIGHTS_REVOKED' ||
      reuseAttempt.status !== 409 ||
      reuseAttempt.errorCode !== 'REUSE_SOURCE_REVOKED' ||
      finalPackage.exportReceipts.length !== receiptCount ||
      finalPackage.status !== 'needs_replacement' ||
      !finalPackage.rights.reason?.startsWith('asset_withdrawn:')
    ) {
      throw new Error('Rights withdrawal did not block package side effects.');
    }
    record('blocked-export-and-reuse');

    await writeFile(
      path.join(journey, 'rights-evidence.json'),
      `${JSON.stringify(
        {
          runId,
          packageId,
          assetId: asset.id,
          before: {
            exportReceipts: beforePackage.exportReceipts.length,
            status: beforePackage.status,
          },
          after: {
            exportReceipts: finalPackage.exportReceipts.length,
            exportError: exportAttempt.errorCode,
            reuseError: reuseAttempt.errorCode,
            rightsReason: 'asset_withdrawn:<redacted-asset-id>',
            status: finalPackage.status,
          },
          checks: {
            browserWithdrawal: true,
            exportSideEffectsBlocked: true,
            packageImmediatelyNeedsAttention: true,
            receiptsPreserved: true,
            reuseBlocked: true,
          },
        },
        null,
        2
      )}\n`
    );
    await writeFile(
      path.join(journey, 'steps.json'),
      `${JSON.stringify(steps, null, 2)}\n`
    );
  } finally {
    video = page.video();
    await context.close();
    videoPath = await video?.path();
    await browser.close();
  }
  if (videoPath) {
    await rename(
      videoPath,
      path.join(journey, 'continuous-rights-journey.webm')
    );
  }
  const files = {};
  for (const relative of [
    'journey/continuous-rights-journey.webm',
    'journey/keyframes/01-new-asset-authorized.png',
    'journey/keyframes/02-package-before-withdrawal.png',
    'journey/keyframes/03-asset-withdrawn.png',
    'journey/keyframes/04-package-blocked-after-withdrawal.png',
    'journey/rights-evidence.json',
    'journey/steps.json',
  ]) {
    const bytes = await readFile(path.join(output, relative));
    files[relative] = {
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }
  await writeFile(
    path.join(journey, 'run-manifest.json'),
    `${JSON.stringify({ completedAt: new Date().toISOString(), files, runId }, null, 2)}\n`
  );
  process.stdout.write(`${output}\n`);
}

await main();
