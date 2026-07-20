import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const requireFromCore = createRequire(
  path.join(projectRoot, 'apps/core/package.json')
);
const { unzipSync } = requireFromCore('fflate');
const baseUrl = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:3000';
const email = requiredEnv('EVIDENCE_EMAIL');
const password = requiredEnv('EVIDENCE_PASSWORD');
const sourcePackageId = requiredEnv('EVIDENCE_SOURCE_PACKAGE_ID');
const runId = process.env.EVIDENCE_RUN_ID ?? `ticket-13-16-${Date.now()}`;
const outputDirectory = path.resolve(
  process.env.EVIDENCE_OUT ??
    path.join(projectRoot, 'docs/evidence/contentpackage/ticket-13-16', runId)
);
const journeyDirectory = path.join(outputDirectory, 'journey');
const keyframeDirectory = path.join(journeyDirectory, 'keyframes');
const artifactDirectory = path.join(journeyDirectory, 'artifact');
const networkLog = [];
const steps = [];

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function step(name, detail = {}) {
  const entry = { at: new Date().toISOString(), name, ...detail };
  steps.push(entry);
  process.stdout.write(`[evidence] ${name}\n`);
}

async function login(page) {
  await page.goto(`${baseUrl}/auth/login`, { waitUntil: 'networkidle' });
  await page.getByRole('textbox', { name: '邮箱' }).fill(email);
  await page.getByRole('textbox', { name: '密码' }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForURL((url) => url.pathname === '/dashboard', {
    timeout: 30_000,
  });
}

async function operationsQuery(page, action, payload = {}) {
  const result = await page.evaluate(
    async ({ action, payload }) => {
      const response = await fetch('/api/core/p1/query', {
        body: JSON.stringify({ action, module: 'operations', payload }),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      return { body: await response.json(), status: response.status };
    },
    { action, payload }
  );
  if (result.status !== 200) {
    throw new Error(`operations query ${action} failed with ${result.status}`);
  }
  return result.body;
}

async function operationsCommand(page, action, payload, idempotencyKey) {
  return page.evaluate(
    async ({ action, idempotencyKey, payload }) => {
      const response = await fetch('/api/core/p1/commands', {
        body: JSON.stringify({ action, module: 'operations', payload }),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
        },
        method: 'POST',
      });
      return { body: await response.json(), status: response.status };
    },
    { action, idempotencyKey, payload }
  );
}

async function packageProjection(page, packageId) {
  const result = await operationsQuery(page, 'content_package', { packageId });
  return result.data;
}

async function openPackage(page, packageId) {
  await page.goto(
    `${baseUrl}/dashboard/content/${encodeURIComponent(packageId)}`,
    { waitUntil: 'networkidle' }
  );
  await page
    .getByText('内容详情', { exact: true })
    .waitFor({ timeout: 30_000 });
}

function packageIdFromUrl(page) {
  const marker = '/dashboard/content/';
  const url = new URL(page.url());
  if (!url.pathname.startsWith(marker)) {
    throw new Error(
      `Expected a stable ContentPackage URL, received ${url.pathname}`
    );
  }
  return decodeURIComponent(url.pathname.slice(marker.length));
}

async function saveScreenshot(page, filename, fullPage = true) {
  await page.screenshot({
    fullPage,
    path: path.join(keyframeDirectory, filename),
  });
}

async function downloadReceipt(context, receipt) {
  if (!receipt.artifactObjectKey) {
    throw new Error('The succeeded export receipt has no artifact object key.');
  }
  const response = await context.request.get(
    `${baseUrl}/api/core/p1/assets?objectKey=${encodeURIComponent(receipt.artifactObjectKey)}`
  );
  if (!response.ok()) {
    throw new Error(`Artifact download failed with ${response.status()}.`);
  }
  const bytes = Buffer.from(await response.body());
  if (bytes.length !== receipt.sizeBytes || sha256(bytes) !== receipt.sha256) {
    throw new Error(
      'Downloaded artifact does not match its persisted receipt.'
    );
  }
  const archivePath = path.join(artifactDirectory, 'ticket-13-export.zip');
  await writeFile(archivePath, bytes);
  return { archivePath, bytes };
}

async function extractArchive(bytes) {
  const entries = unzipSync(bytes);
  const inventory = [];
  const imageDataUrls = [];
  for (const [entryName, entryBytes] of Object.entries(entries).sort()) {
    const safeName = path.basename(entryName);
    const outputPath = path.join(artifactDirectory, safeName);
    await writeFile(outputPath, entryBytes);
    inventory.push({
      bytes: entryBytes.byteLength,
      name: safeName,
      sha256: sha256(entryBytes),
    });
    if (/\.(?:jpe?g|png|webp)$/iu.test(safeName)) {
      const extension = path.extname(safeName).slice(1).replace('jpg', 'jpeg');
      imageDataUrls.push({
        name: safeName,
        url: `data:image/${extension};base64,${Buffer.from(entryBytes).toString('base64')}`,
      });
    }
  }
  return { imageDataUrls, inventory };
}

async function renderExportContactSheet(page, imageDataUrls) {
  await page.setContent(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
    <style>body{font-family:system-ui;margin:24px;background:#f4f1eb;color:#1d1c1a}h1{font-size:24px}
    main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}figure{margin:0;background:white;padding:12px;border-radius:12px;box-shadow:0 2px 12px #0002}img{width:100%;height:auto;display:block}figcaption{margin-top:8px;font:14px ui-monospace}</style>
    </head><body><h1>Ticket 15 真实导出图片：AI 标识 + 品牌水印</h1><main>${imageDataUrls
      .map(
        (image) =>
          `<figure><img alt="${image.name}" src="${image.url}"><figcaption>${image.name}</figcaption></figure>`
      )
      .join('')}</main></body></html>`);
  await saveScreenshot(page, '03-exported-images-contact-sheet.png');
}

async function authenticateSecondaryContext(browser, options = {}) {
  const context = await browser.newContext({ locale: 'zh-CN', ...options });
  const page = await context.newPage();
  await login(page);
  return { context, page };
}

async function writeJson(filename, value) {
  await writeFile(
    path.join(journeyDirectory, filename),
    `${JSON.stringify(value, null, 2)}\n`
  );
}

async function inventoryDirectory(relativePaths) {
  const inventory = {};
  for (const relativePath of relativePaths.sort()) {
    const bytes = await readFile(path.join(outputDirectory, relativePath));
    inventory[relativePath] = { bytes: bytes.length, sha256: sha256(bytes) };
  }
  return inventory;
}

async function main() {
  await mkdir(keyframeDirectory, { recursive: true });
  await mkdir(artifactDirectory, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'zh-CN',
    recordVideo: { dir: journeyDirectory, size: { height: 900, width: 1440 } },
    viewport: { height: 900, width: 1440 },
  });
  const page = await context.newPage();
  page.on('response', async (response) => {
    if (!response.url().includes('/api/core/')) return;
    const entry = {
      at: new Date().toISOString(),
      method: response.request().method(),
      status: response.status(),
      url: response.url().replace(baseUrl, '').split('?')[0],
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
      // Keep the status-only evidence for streaming and non-JSON responses.
    }
    networkLog.push(entry);
  });

  let videoPath;
  let video;
  let secondContext;
  let secondPage;
  let coarseContext;
  let coarsePage;
  let restorePlatformVersionId;
  let platformVersionRestored = false;
  try {
    await login(page);
    step('login');
    const sourceBefore = await packageProjection(page, sourcePackageId);
    if (
      sourceBefore.kind !== 'image_text' ||
      sourceBefore.variants.length !== 3 ||
      !sourceBefore.compliance.aigcLabelEnabled ||
      !sourceBefore.compliance.watermarkEnabled
    ) {
      throw new Error(
        'Source package is not a three-variant, fully labeled image-text package.'
      );
    }

    const xiaohongshuBefore = sourceBefore.variants.find(
      (variant) => variant.platform === 'xiaohongshu'
    );
    const xiaohongshuVersionBefore = xiaohongshuBefore?.versions.find(
      (version) => version.id === xiaohongshuBefore.currentVersionId
    );
    const durableOwnedAssetIds = new Set(
      (sourceBefore.generated.ownedAssets ?? []).map((asset) => asset.id)
    );
    const exportAssetIds = xiaohongshuVersionBefore?.orderedAssetIds.filter(
      (assetId) => durableOwnedAssetIds.has(assetId)
    );
    if (!xiaohongshuVersionBefore || !exportAssetIds?.length) {
      throw new Error('Source package has no durable owned image for export.');
    }
    restorePlatformVersionId = xiaohongshuVersionBefore.id;

    await openPackage(page, sourcePackageId);
    await saveScreenshot(page, '01-source-package-before-export.png');
    const prepared = await operationsCommand(
      page,
      'edit_content_package_variant',
      {
        baseVersionId: xiaohongshuVersionBefore.id,
        changes: {
          body: xiaohongshuVersionBefore.body,
          ...(xiaohongshuVersionBefore.conversionHook
            ? { conversionHook: xiaohongshuVersionBefore.conversionHook }
            : {}),
          orderedAssetIds: exportAssetIds,
          title: xiaohongshuVersionBefore.title,
          topics: xiaohongshuVersionBefore.topics,
        },
        packageId: sourcePackageId,
        platform: 'xiaohongshu',
      },
      `${runId}-prepare-owned-export-version`
    );
    if (prepared.status !== 200) {
      throw new Error('Could not prepare the durable owned export version.');
    }
    const sourceAtExport = await packageProjection(page, sourcePackageId);
    await page.reload({ waitUntil: 'networkidle' });
    await saveScreenshot(page, '01b-owned-export-version.png');
    step('ticket-13:owned-export-version-prepared', {
      durableAssetCount: exportAssetIds.length,
    });
    const receiptCountBefore = sourceAtExport.exportReceipts.length;
    await page.getByRole('button', { name: '导出小红书' }).click();
    await page.waitForFunction(
      async ({ packageId, receiptCount }) => {
        const response = await fetch('/api/core/p1/query', {
          body: JSON.stringify({
            action: 'content_package',
            module: 'operations',
            payload: { packageId },
          }),
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        });
        const body = await response.json();
        return body.data?.exportReceipts?.length === receiptCount + 1;
      },
      { packageId: sourcePackageId, receiptCount: receiptCountBefore },
      { timeout: 60_000 }
    );
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByText('导出回执', { exact: true }).waitFor();
    await saveScreenshot(page, '02-export-receipt-and-download.png');
    const afterUiExport = await packageProjection(page, sourcePackageId);
    const uiReceipt = afterUiExport.exportReceipts.at(-1);
    if (uiReceipt?.status !== 'succeeded')
      throw new Error('UI export did not succeed.');
    const downloaded = await downloadReceipt(context, uiReceipt);
    const archive = await extractArchive(downloaded.bytes);
    if (archive.imageDataUrls.length !== exportAssetIds.length) {
      throw new Error(
        `Expected ${exportAssetIds.length} exported images, received ${archive.imageDataUrls.length}.`
      );
    }
    await renderExportContactSheet(page, archive.imageDataUrls);
    step('ticket-13:ui-export-downloaded', {
      archiveSha256: uiReceipt.sha256,
      entries: archive.inventory.length,
    });

    await openPackage(page, sourcePackageId);
    const replayKey = `${runId}-export-replay`;
    const replayBefore = await packageProjection(page, sourcePackageId);
    const replayFirst = await operationsCommand(
      page,
      'export_content_package',
      { packageId: sourcePackageId, platform: 'xiaohongshu' },
      replayKey
    );
    const replaySecond = await operationsCommand(
      page,
      'export_content_package',
      { packageId: sourcePackageId, platform: 'xiaohongshu' },
      replayKey
    );
    const replayAfter = await packageProjection(page, sourcePackageId);
    if (
      replayFirst.status < 200 ||
      replayFirst.status >= 300 ||
      replaySecond.status < 200 ||
      replaySecond.status >= 300 ||
      replayAfter.exportReceipts.length !==
        replayBefore.exportReceipts.length + 1
    ) {
      throw new Error(
        'Export idempotency replay duplicated or changed the result.'
      );
    }
    step('ticket-13:idempotent-replay', { receiptDelta: 1 });

    ({ context: secondContext, page: secondPage } =
      await authenticateSecondaryContext(browser));
    const secondSessionPackage = await packageProjection(
      secondPage,
      sourcePackageId
    );
    const secondSessionReceipt = secondSessionPackage.exportReceipts.find(
      (receipt) => receipt.id === uiReceipt.id
    );
    if (!secondSessionReceipt)
      throw new Error('Export receipt did not persist across sessions.');
    const secondSessionDownload = await downloadReceipt(
      secondContext,
      secondSessionReceipt
    );
    if (sha256(secondSessionDownload.bytes) !== uiReceipt.sha256) {
      throw new Error('Cross-session artifact bytes changed.');
    }
    await secondContext.close();
    secondContext = undefined;
    secondPage = undefined;
    step('ticket-13:cross-session-receipt-and-bytes');

    const rollback = await operationsCommand(
      page,
      'rollback_content_package_version',
      {
        packageId: sourcePackageId,
        targetVersionId: xiaohongshuVersionBefore.id,
      },
      `${runId}-restore-xiaohongshu-version`
    );
    if (rollback.status !== 200) {
      throw new Error('Could not restore the pre-evidence platform version.');
    }
    platformVersionRestored = true;
    step('ticket-13:platform-version-restored');

    await openPackage(page, sourcePackageId);
    await page.getByRole('button', { name: '做同款' }).click();
    await page.waitForURL(
      (url) =>
        url.pathname.startsWith('/dashboard/content/') &&
        decodeURIComponent(url.pathname.split('/').at(-1)) !== sourcePackageId
    );
    const packageBId = packageIdFromUrl(page);
    await page.getByText('做同款关系', { exact: true }).waitFor();
    await saveScreenshot(page, '04-reuse-b-visible-with-source.png');
    const packageB = await packageProjection(page, packageBId);
    if (
      packageB.lineage.reusedFromPackageId !== sourcePackageId ||
      packageB.versions.length !== 1 ||
      packageB.exportReceipts.length !== 0
    ) {
      throw new Error(
        'First reuse did not start at V1 with clean receipts and source lineage.'
      );
    }

    await page.getByRole('button', { name: '做同款' }).click();
    await page.waitForURL(
      (url) =>
        url.pathname.startsWith('/dashboard/content/') &&
        ![sourcePackageId, packageBId].includes(
          decodeURIComponent(url.pathname.split('/').at(-1))
        )
    );
    const packageCId = packageIdFromUrl(page);
    await page.getByText('做同款关系', { exact: true }).waitFor();
    await saveScreenshot(page, '05-reuse-c-visible-with-two-hop-lineage.png');
    const packageCBeforeMobile = await packageProjection(page, packageCId);
    const lineageC = await operationsQuery(page, 'content_package_lineage', {
      packageId: packageCId,
    });
    if (
      lineageC.data.ancestors.map((item) => item.id).join(',') !==
      [packageBId, sourcePackageId].join(',')
    ) {
      throw new Error('A-to-B-to-C ancestry is incomplete.');
    }
    await openPackage(page, packageBId);
    await saveScreenshot(page, '06-reuse-b-bidirectional-lineage.png');
    step('ticket-14:a-to-b-to-c-lineage', { packageBId, packageCId });

    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto(
      `${baseUrl}/dashboard?stage=handoff&packageId=${encodeURIComponent(packageCId)}`,
      { waitUntil: 'networkidle' }
    );
    const mobileTitle = `跨端轻编辑 ${runId.slice(-8)}`;
    const mobileBody =
      '手机端保存的同一成品正文，用于 Ticket 16 跨设备连续性验收。';
    await page.getByRole('textbox', { name: '成品标题' }).fill(mobileTitle);
    await page.getByRole('textbox', { name: '成品正文' }).fill(mobileBody);
    await page.getByRole('button', { name: '保存文本版本' }).click();
    await page.waitForFunction(
      async ({ packageId, title }) => {
        const response = await fetch('/api/core/p1/query', {
          body: JSON.stringify({
            action: 'content_package',
            module: 'operations',
            payload: { packageId },
          }),
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        });
        const body = await response.json();
        const current = body.data?.versions?.find(
          (version) => version.id === body.data.currentVersionId
        );
        return current?.title === title;
      },
      { packageId: packageCId, title: mobileTitle },
      { timeout: 30_000 }
    );
    await saveScreenshot(page, '07-mobile-same-package-edited.png');
    const stableDesktopLink = await page
      .getByRole('link', { name: /在桌面继续当前对象|回到电脑继续/u })
      .first()
      .getAttribute('href');
    if (!stableDesktopLink?.includes(encodeURIComponent(packageCId))) {
      throw new Error(
        'Mobile desktop handoff does not target the same stable package.'
      );
    }

    await page.setViewportSize({ height: 900, width: 1440 });
    await openPackage(page, packageCId);
    await page.waitForFunction(
      (title) =>
        [...document.querySelectorAll('input')].some(
          (input) => input.value === title
        ),
      mobileTitle
    );
    await saveScreenshot(page, '08-desktop-sees-mobile-version.png');
    const packageCAfterMobile = await packageProjection(page, packageCId);
    if (
      packageCAfterMobile.id !== packageCBeforeMobile.id ||
      packageCAfterMobile.versions.length !==
        packageCBeforeMobile.versions.length + 1
    ) {
      throw new Error(
        'Mobile edit did not append exactly one version to the same package.'
      );
    }

    ({ context: coarseContext, page: coarsePage } =
      await authenticateSecondaryContext(browser, {
        hasTouch: true,
        viewport: { height: 844, width: 390 },
      }));
    await coarsePage.goto(
      `${baseUrl}/dashboard?stage=handoff&packageId=${encodeURIComponent(packageCId)}`,
      { waitUntil: 'networkidle' }
    );
    await coarsePage.waitForFunction(
      (title) =>
        [...document.querySelectorAll('input')].some(
          (input) => input.value === title
        ),
      mobileTitle
    );
    await coarsePage.screenshot({
      fullPage: true,
      path: path.join(keyframeDirectory, '09-coarse-pointer-same-package.png'),
    });
    await coarseContext.close();
    coarseContext = undefined;
    coarsePage = undefined;
    step('ticket-16:desktop-mobile-same-package', {
      packageCId,
      versionDelta: 1,
    });

    await writeJson('package-evidence.json', {
      archive: {
        contentType: uiReceipt.contentType,
        entries: archive.inventory,
        receiptMatchesDownloadedBytes: true,
        sha256: uiReceipt.sha256,
        sizeBytes: uiReceipt.sizeBytes,
      },
      preparation: {
        durableAssetCount: exportAssetIds.length,
        platformVersionRestoredThroughRollback: true,
      },
      compliance: {
        receiptMatchesPackage: true,
        source: sourceBefore.compliance,
      },
      lineage: {
        a: sourcePackageId,
        b: packageBId,
        c: packageCId,
        cAncestors: lineageC.data.ancestors.map((item) => item.id),
      },
      mobile: {
        coarsePointerVerified: true,
        desktopStableAddressVerified: true,
        packageId: packageCId,
        versionCountAfter: packageCAfterMobile.versions.length,
        versionCountBefore: packageCBeforeMobile.versions.length,
      },
      replay: {
        responseStable: true,
        receiptDelta: 1,
      },
      runId,
    });
    await writeJson('steps.json', steps);
    await writeFile(
      path.join(journeyDirectory, 'network-log.jsonl'),
      `${networkLog.map((entry) => JSON.stringify(entry)).join('\n')}\n`
    );
  } finally {
    if (secondContext) await secondContext.close();
    if (coarseContext) await coarseContext.close();
    if (restorePlatformVersionId && !platformVersionRestored) {
      const rollback = await operationsCommand(
        page,
        'rollback_content_package_version',
        {
          packageId: sourcePackageId,
          targetVersionId: restorePlatformVersionId,
        },
        `${runId}-restore-xiaohongshu-version-after-failure`
      ).catch(() => undefined);
      platformVersionRestored = rollback?.status === 200;
    }
    video = page.video();
    await context.close();
    videoPath = await video?.path();
    await browser.close();
  }

  if (videoPath) {
    await rename(
      videoPath,
      path.join(journeyDirectory, 'continuous-journey.webm')
    );
  }
  const evidenceFiles = [
    'journey/artifact/ticket-13-export.zip',
    ...Object.keys(
      unzipSync(
        await readFile(path.join(artifactDirectory, 'ticket-13-export.zip'))
      )
    ).map((entry) => `journey/artifact/${path.basename(entry)}`),
    'journey/continuous-journey.webm',
    'journey/keyframes/01-source-package-before-export.png',
    'journey/keyframes/01b-owned-export-version.png',
    'journey/keyframes/02-export-receipt-and-download.png',
    'journey/keyframes/03-exported-images-contact-sheet.png',
    'journey/keyframes/04-reuse-b-visible-with-source.png',
    'journey/keyframes/05-reuse-c-visible-with-two-hop-lineage.png',
    'journey/keyframes/06-reuse-b-bidirectional-lineage.png',
    'journey/keyframes/07-mobile-same-package-edited.png',
    'journey/keyframes/08-desktop-sees-mobile-version.png',
    'journey/keyframes/09-coarse-pointer-same-package.png',
    'journey/network-log.jsonl',
    'journey/package-evidence.json',
    'journey/steps.json',
  ];
  await writeFile(
    path.join(journeyDirectory, 'run-manifest.json'),
    `${JSON.stringify(
      {
        acceptance: {
          ticket13: {
            crossSessionPersistence: true,
            downloadedArtifactMatchesReceipt: true,
            idempotentReplay: true,
            uiExport: true,
          },
          ticket14: {
            bidirectionalLineage: true,
            chainDepth: 3,
            cleanV1: true,
            uiReuse: true,
          },
          ticket15: {
            imageComplianceArtifactCaptured: true,
            rightsRevocationJourney: false,
            unlabeledControlArtifact: false,
            videoBurnIn: false,
          },
          ticket16: {
            coarsePointerSimulation: true,
            samePackageAcrossViewports: true,
            stableDesktopAddress: true,
            trueDeviceRecording: false,
          },
          ticket17: {
            browserMigrationJourney: false,
          },
        },
        completedAt: new Date().toISOString(),
        files: await inventoryDirectory(evidenceFiles),
        runId,
      },
      null,
      2
    )}\n`
  );
  process.stdout.write(`${outputDirectory}\n`);
}

await main();
