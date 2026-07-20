import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from '@playwright/test';

const baseUrl = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:3000';
const outputDir = path.resolve(
  process.env.EVIDENCE_OUTPUT_DIR ?? '../docs/evidence/contentpackage/ticket-01'
);
const runId = `ticket-01-${Date.now()}`;
const account = {
  email: `e2e-${runId}@example.test`,
  name: 'ContentPackage contract evidence',
  password: `Cp-${runId}!`,
};

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: 'zh-CN',
  recordVideo: { dir: outputDir, size: { width: 1440, height: 900 } },
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
const network = [];

page.on('response', async (response) => {
  if (!response.url().includes('/api/core/p1/')) return;
  let correlationId;
  let errorCode;
  try {
    const body = await response.json();
    correlationId = body?.meta?.correlationId;
    errorCode = body?.error?.code;
  } catch {
    // Preserve only response metadata for non-JSON responses.
  }
  network.push({
    at: new Date().toISOString(),
    correlationId,
    errorCode,
    method: response.request().method(),
    path: new URL(response.url()).pathname,
    status: response.status(),
  });
});

async function command(action, payload, idempotencyKey) {
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

async function query(action, payload = {}) {
  return page.evaluate(
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
}

function assert(condition, message, details) {
  if (!condition) {
    throw new Error(`${message}: ${JSON.stringify(details)}`);
  }
}

try {
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
  await page.screenshot({
    fullPage: true,
    path: path.join(outputDir, '01-merchant-dashboard-before.png'),
  });

  const initial = await query('content_packages');
  assert(initial.status === 200, 'Initial list failed', initial);
  const initialCount = initial.body.data.length;
  const createKey = `${runId}-create`;
  const source = {
    assetIds: ['evidence-photo-01', 'evidence-photo-02', 'evidence-photo-03'],
    briefId: 'evidence-brief-01',
    storeProfileId: 'evidence-store-01',
  };
  const created = await command(
    'create_content_package',
    { kind: 'image_text', source },
    createKey
  );
  assert(created.status === 200, 'Create failed', created);
  const packageId = created.body.data.id;
  assert(
    JSON.stringify(created.body.data.source.assetIds) ===
      JSON.stringify(source.assetIds),
    'Ordered source assets changed',
    created.body.data.source.assetIds
  );

  const immediate = await query('content_packages');
  assert(immediate.status === 200, 'Immediate list failed', immediate);
  assert(
    immediate.body.data.some((item) => item.id === packageId),
    'Created package was not immediately visible',
    immediate.body.data
  );

  const replay = await command(
    'create_content_package',
    { kind: 'image_text', source },
    createKey
  );
  assert(replay.status === 200, 'Replay failed', replay);
  assert(
    replay.body.data.id === packageId,
    'Replay changed package id',
    replay
  );
  const afterReplay = await query('content_packages');
  assert(
    afterReplay.body.data.length === initialCount + 1,
    'Replay changed package count',
    { after: afterReplay.body.data.length, before: initialCount }
  );

  const revoked = await command(
    'revoke_content_package_rights',
    {
      expectedRevision: created.body.data.revision,
      packageId,
      reason: 'Ticket 01 evidence rehearsal',
    },
    `${runId}-revoke`
  );
  assert(revoked.status === 200, 'Rights revoke failed', revoked);
  assert(
    revoked.body.data.rights.state === 'revoked' &&
      revoked.body.data.status === 'needs_replacement' &&
      revoked.body.data.statusLabel === '需处理',
    'Rights revoke did not become visible needs-attention state',
    revoked.body.data
  );

  const cancelled = await command(
    'cancel_content_package',
    { expectedRevision: revoked.body.data.revision, packageId },
    `${runId}-cancel`
  );
  assert(cancelled.status === 200, 'Cancel failed', cancelled);
  assert(
    cancelled.body.data.status === 'cancelled' &&
      cancelled.body.data.statusLabel === '需处理',
    'Cancel status was not visible',
    cancelled.body.data
  );
  const repeatedCancel = await command(
    'cancel_content_package',
    { expectedRevision: cancelled.body.data.revision, packageId },
    `${runId}-cancel-again`
  );
  assert(repeatedCancel.status === 409, 'Repeated cancel was not rejected', {
    errorCode: repeatedCancel.body?.error?.code,
    status: repeatedCancel.status,
  });

  await page.goto(`${baseUrl}/dashboard/content`, { waitUntil: 'networkidle' });
  await page.screenshot({
    fullPage: true,
    path: path.join(outputDir, '02-content-library-after.png'),
  });

  const finalList = await query('content_packages');
  const finalPackage = finalList.body.data.find(
    (item) => item.id === packageId
  );
  const evidence = {
    acceptance: {
      cancelImmediatelyVisible: finalPackage?.status === 'cancelled',
      createImmediatelyVisible: true,
      orderedThreeAssetReferencesPreserved:
        JSON.stringify(finalPackage?.source?.assetIds) ===
        JSON.stringify(source.assetIds),
      repeatedCancelRejected: repeatedCancel.status === 409,
      replayDidNotDuplicate: finalList.body.data.length === initialCount + 1,
      rightsRevocationVisible: finalPackage?.rights?.state === 'revoked',
      singleVisibleStatusLabel: finalPackage?.statusLabel === '需处理',
    },
    completedAt: new Date().toISOString(),
    environment: {
      core: 'http://localhost:4100',
      database: 'PostgreSQL localhost:54329',
      transport: 'Browser BFF /api/core/p1 -> core operations seam',
      web: baseUrl,
    },
    package: {
      id: packageId,
      kind: finalPackage.kind,
      orderedAssetIds: finalPackage.source.assetIds,
      rights: finalPackage.rights.state,
      status: finalPackage.status,
      statusGroup: finalPackage.statusGroup,
      statusLabel: finalPackage.statusLabel,
    },
    replay: {
      countAfter: finalList.body.data.length,
      countBefore: initialCount,
      originalId: packageId,
      replayId: replay.body.data.id,
    },
    runId,
    timeline: network,
  };
  await writeFile(
    path.join(outputDir, 'seam-evidence.json'),
    `${JSON.stringify(evidence, null, 2)}\n`
  );
} finally {
  await page.close();
  await context.close();
  await browser.close();
}

for (const filename of await readdir(outputDir)) {
  if (!filename.endsWith('.webm')) continue;
  const target = path.join(outputDir, 'continuous-seam-journey.webm');
  if (filename !== path.basename(target)) {
    await rename(path.join(outputDir, filename), target);
  }
}

const artifacts = {};
for (const filename of (await readdir(outputDir)).sort()) {
  if (filename === 'manifest.json') continue;
  const bytes = await readFile(path.join(outputDir, filename));
  artifacts[filename] = {
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
await writeFile(
  path.join(outputDir, 'manifest.json'),
  `${JSON.stringify({ artifacts, runId, status: 'accepted' }, null, 2)}\n`
);

console.log(JSON.stringify({ ok: true, outputDir, runId }));
