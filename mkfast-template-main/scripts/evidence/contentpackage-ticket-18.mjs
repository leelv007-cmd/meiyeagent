import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import { chromium } from '@playwright/test';

const rootRequire = createRequire(
  new URL('../../../apps/core/package.json', import.meta.url)
);
const { Pool } = rootRequire('pg');

const baseUrl = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:3000';
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://meiye:meiye@127.0.0.1:54329/meiye';
const outputDir = path.resolve(
  process.env.EVIDENCE_OUTPUT_DIR ??
    '../docs/evidence/contentpackage/ticket-18'
);
const photo = path.resolve(
  process.env.EVIDENCE_PHOTO ?? 'public/seed/store/store-artist-working.webp'
);
const runId = `ticket-18-${Date.now()}`;
const admin = {
  email: `e2e-${runId}-admin@example.test`,
  name: 'Execution mode evidence admin',
  password: `Ma-${runId}!`,
};
const merchant = {
  email: `e2e-${runId}-merchant@example.test`,
  name: '执行模式止血验证门店',
  password: `Mm-${runId}!`,
};

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: 'zh-CN',
  recordVideo: { dir: outputDir, size: { width: 1440, height: 900 } },
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
const timeline = [];

page.on('response', async (response) => {
  if (!response.url().includes('/api/core/p1/')) return;
  let body;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  timeline.push({
    at: new Date().toISOString(),
    correlationId: body?.meta?.correlationId,
    errorCode: body?.error?.code,
    method: response.request().method(),
    path: new URL(response.url()).pathname,
    status: response.status(),
  });
});

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(details)}`);
}

async function registerAndLogin(account, role) {
  await context.clearCookies();
  await page.goto(`${baseUrl}/auth/register`, { waitUntil: 'networkidle' });
  await page.locator('input[name="name"]').fill(account.name);
  await page.locator('input[name="email"]').fill(account.email);
  await page.locator('input[name="password"]').fill(account.password);
  await page.getByRole('button', { name: /^sign up$|^注册$/i }).click();
  await page
    .getByText(/check your email to verify your account|请检查您的邮箱/i)
    .waitFor({ timeout: 20_000 });
  const verified = await context.request.patch(`${baseUrl}/api/e2e/users`, {
    data: { email: account.email, emailVerified: true, role },
    headers: { 'x-e2e-secret': 'mkfast-e2e-secret' },
  });
  assert(verified.ok(), 'Account verification failed', verified.status());
  await login(account);
}

async function login(account) {
  await context.clearCookies();
  await page.goto(`${baseUrl}/auth/login`, { waitUntil: 'networkidle' });
  await page.locator('input[name="email"]').fill(account.email);
  await page.locator('input[name="password"]').fill(account.password);
  await page.getByRole('button', { name: /^sign in$|^登录$/i }).click();
  await page.waitForURL((url) => url.pathname === '/dashboard', {
    timeout: 30_000,
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

function configItem(response, key) {
  assert(response.status === 200, 'Config list failed', response);
  const item = response.body.data.find((candidate) => candidate.key === key);
  assert(item, 'Config item missing', { key });
  return item;
}

async function applyMode(groupName, radioName, key, expectedValue, reason) {
  const group = page.getByRole('radiogroup', { name: groupName });
  await group.getByRole('radio', { name: radioName }).click();
  await page.getByRole('button', { name: '审阅并记录' }).click();
  await page.locator('#impact-review-reason').fill(reason);
  await page.getByRole('button', { name: '确认记录配置' }).click();
  const deadline = Date.now() + 30_000;
  for (;;) {
    const item = configItem(await query('admin-config', 'config_list'), key);
    if (item.storedValue === expectedValue) return item;
    if (Date.now() > deadline) throw new Error(`${key} did not become ${expectedValue}.`);
    await page.waitForTimeout(300);
  }
}

async function confirmStoreAndAuthorizePhoto() {
  await page.goto(`${baseUrl}/dashboard/store`, { waitUntil: 'networkidle' });
  await page
    .locator('#pasted-facts')
    .fill('成都止血验证门店。项目：头皮清洁护理，体验价 59 元，需提前预约。');
  await page.getByRole('button', { name: '生成初稿' }).click();
  await page.getByText('未确认初稿', { exact: true }).waitFor();
  await page.locator('#store-name').fill('执行模式止血验证门店');
  await page.locator('#store-city').fill('成都');
  await page.locator('#store-district').fill('高新区');
  await page.locator('#store-address').fill('天府大道中段 500 号');
  await page.locator('#store-booking').fill('需提前预约');
  await page.locator('#store-project-name').fill('头皮清洁护理');
  await page.locator('#project-price').fill('59');
  await page.locator('#brand-voice').fill('专业、真实、克制。');
  await page.getByRole('button', { name: '保存门店资料' }).click();
  await page.getByText('已确认', { exact: true }).waitFor({ timeout: 20_000 });

  await page.goto(`${baseUrl}/dashboard/assets`, { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]#canonical-asset-upload').setInputFiles(photo);
  const reviewLink = page
    .getByRole('link', { name: '确认这张素材能否用于宣传' })
    .first();
  await reviewLink.waitFor({ state: 'visible', timeout: 30_000 });
  await reviewLink.click();
  await page.waitForURL(/\/dashboard\/assets\/asset-/);
  await page
    .getByLabel('授权凭证编号或存档位置')
    .fill(`${runId}-owner-consent`);
  await page.getByRole('button', { name: /确认公开营销授权/ }).click();
  await page.getByText('公开营销可用', { exact: true }).waitFor();
}

async function createCreativeRecord(intent) {
  const before = (await query('operations', 'creative_workbench')).body.data;
  const existingWorkIds = new Set(before.works.map((work) => work.id));
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle' });
  const newWork = page.getByRole('button', { name: '新建创作' });
  const quickStart = page.getByRole('button', { name: '做一条项目种草内容' });
  if (await newWork.isVisible().catch(() => false)) await newWork.click();
  else await quickStart.click();
  const more = page.getByRole('button', { exact: true, name: '更多' });
  if (await more.isVisible().catch(() => false)) {
    if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click();
  }
  const sourceChips = page.getByRole('button', { name: /^素材 · / });
  await sourceChips.first().waitFor({ state: 'visible', timeout: 30_000 });
  for (let index = 0; index < (await sourceChips.count()); index += 1) {
    const chip = sourceChips.nth(index);
    if ((await chip.getAttribute('aria-pressed')) !== 'true') await chip.click();
  }
  await page.getByLabel('描述这次想创作的内容').fill(intent);
  await page.getByRole('button', { name: '建立创作记录' }).click();
  const record = page.getByLabel('创作助理整理的记录');
  await record.waitFor({ state: 'visible', timeout: 30_000 });
  const after = (await query('operations', 'creative_workbench')).body.data;
  const work = after.works.find((candidate) => !existingWorkIds.has(candidate.id));
  assert(work, 'New creative Work was not projected', after.works);
  await record.getByRole('button', { name: '采用并确认 Brief' }).click();
  await record.getByText('Brief 已确认', { exact: true }).waitFor();
  return { record, workId: work.id };
}

async function submitCopyAndWaitForFailure() {
  const { record, workId } = await createCreativeRecord(
    '写一条真实克制的头皮清洁护理种草文案，说明 59 元体验价，不作疗效承诺。'
  );
  await record.getByRole('button', { name: /^调整专业参数/ }).click();
  const modelGroup = record.getByRole('radiogroup', { name: '执行模型' });
  await modelGroup.waitFor({ state: 'visible', timeout: 30_000 });
  await modelGroup.getByRole('radio', { name: /OpenAI/ }).click();
  const contract = record.getByRole('checkbox', {
    name: /我已确认模型、规格、费用和发布标识/,
  });
  await page.waitForTimeout(300);
  if (!(await contract.isChecked())) await contract.check();
  const submit = record.getByTestId('execute-tool-action');
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="execute-tool-action"]')?.disabled,
    undefined,
    { timeout: 30_000 }
  );
  await submit.click();
  await page
    .getByText('模型执行已停用。产品额度已退回，本次未产生供应商费用。', {
      exact: true,
    })
    .waitFor({ timeout: 30_000 });
  const projection = (await query('operations', 'creative_workbench')).body.data;
  return projection.jobs.find(
    (job) => job.workId === workId && job.contract.operation === 'copy.generate'
  );
}

async function submitImageAndWaitForFailure() {
  const { record, workId } = await createCreativeRecord(
    '用已授权门店实拍生成一张真实克制的头皮清洁护理项目配图。'
  );
  await record.getByRole('button', { name: /^图片生成/ }).click();
  await record.getByRole('button', { name: /^调整专业参数/ }).click();
  const aspect = record.getByLabel('画面规格');
  if (await aspect.count()) await aspect.selectOption('1:1');
  const modelGroup = record.getByRole('radiogroup', { name: '执行模型' });
  await modelGroup.waitFor({ state: 'visible', timeout: 30_000 });
  const seedream = modelGroup.getByRole('radio', { name: /Seedream 4\.5/ });
  await seedream.click();
  const contract = record.getByRole('checkbox', {
    name: /我已确认模型、规格、费用和发布标识/,
  });
  await page.waitForTimeout(400);
  if (!(await contract.isChecked())) await contract.check();
  const submit = record.getByTestId('execute-tool-action');
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="execute-tool-action"]')?.disabled,
    undefined,
    { timeout: 30_000 }
  );
  await submit.click();
  await page
    .getByText('媒体执行已停用。产品额度已退回，本次未产生供应商费用。', {
      exact: true,
    })
    .waitFor({ timeout: 30_000 });
  const projection = (await query('operations', 'creative_workbench')).body.data;
  return projection.jobs.find(
    (job) => job.workId === workId && job.contract.operation === 'image.generate'
  );
}

let modelDisabled;
let modelRestored;
let mediaDisabled;
let mediaRestored;
let copyFailure;
let videoFailure;
let copyResult;
let mediaResult;
let usageBefore;
let usageAfter;
let forbidden;
let snapshots;

try {
  await registerAndLogin(admin, 'admin');
  await page.goto(`${baseUrl}/admin/models`, { waitUntil: 'networkidle' });
  await page.getByText('model.execution.mode').waitFor({ timeout: 30_000 });
  const fixture = page.locator('#model\.execution\.mode-fixture');
  const ark = page.locator('#model\.media\.execution\.mode-ark');
  assert(await fixture.isDisabled(), 'Fixture mode was not blocked outside e2e assembly');
  assert(await ark.isDisabled(), 'Ark mode was not blocked without Ark credentials');
  await page.screenshot({
    fullPage: true,
    path: path.join(outputDir, '01-admin-five-and-four-modes-with-disabled-reasons.png'),
  });

  await registerAndLogin(merchant, 'user');
  forbidden = await query('admin-config', 'config_list');
  assert(
    forbidden.status === 403 && forbidden.body.error?.code === 'FORBIDDEN',
    'Merchant could read global execution config',
    forbidden
  );
  const checkout = await command(
    'entitlements',
    'checkout_plan',
    { tier: 'growth' },
    `${runId}-growth`
  );
  assert(checkout.status === 200, 'Growth checkout failed', checkout);
  usageBefore = (await query('entitlements', 'projection')).body.data.usage;
  await confirmStoreAndAuthorizePhoto();

  await login(admin);
  await page.goto(`${baseUrl}/admin/models`, { waitUntil: 'networkidle' });
  modelDisabled = await applyMode(
    '模型执行模式',
    '停用',
    'model.execution.mode',
    'disabled',
    'Ticket 18 emergency model stop evidence.'
  );
  assert(
    modelDisabled.effectiveValue === 'direct',
    'Emergency stop unexpectedly pretended to hot-reassemble the runtime',
    modelDisabled
  );
  await page.screenshot({
    fullPage: true,
    path: path.join(outputDir, '02-admin-model-disabled-immediately.png'),
  });

  await login(merchant);
  await page.waitForTimeout(5_500);
  copyFailure = await submitCopyAndWaitForFailure();
  assert(
    copyFailure.status === 'failed' &&
      copyFailure.failureCode === 'model_execution_disabled',
    'Model emergency stop did not reject before provider cost',
    copyFailure
  );
  await page.screenshot({
    fullPage: true,
    path: path.join(outputDir, '03-merchant-model-disabled-refunded.png'),
  });

  await login(admin);
  await page.goto(`${baseUrl}/admin/models`, { waitUntil: 'networkidle' });
  modelRestored = await applyMode(
    '模型执行模式',
    '真实直连',
    'model.execution.mode',
    'direct',
    'Restore direct mode after Ticket 18 emergency stop evidence.'
  );
  mediaDisabled = await applyMode(
    '媒体执行模式',
    '停用',
    'model.media.execution.mode',
    'disabled',
    'Ticket 18 emergency media stop evidence.'
  );
  assert(
    mediaDisabled.effectiveValue === 'tuzi',
    'Media emergency stop unexpectedly pretended to hot-reassemble the runtime',
    mediaDisabled
  );
  await page.screenshot({
    fullPage: true,
    path: path.join(outputDir, '04-admin-media-disabled-immediately.png'),
  });

  await login(merchant);
  await page.waitForTimeout(5_500);
  videoFailure = await submitImageAndWaitForFailure();
  assert(
    videoFailure.status === 'failed' &&
      videoFailure.failureCode === 'media_execution_disabled',
    'Media emergency stop did not reject before provider cost',
    videoFailure
  );
  await page.screenshot({
    fullPage: true,
    path: path.join(outputDir, '05-merchant-media-disabled-refunded.png'),
  });
  usageAfter = (await query('entitlements', 'projection')).body.data.usage;
  assert(
    usageAfter.copy.available === usageBefore.copy.available &&
      usageAfter.video.available === usageBefore.video.available,
    'Emergency stop consumed merchant allowance',
    { usageAfter, usageBefore }
  );

  await login(admin);
  await page.goto(`${baseUrl}/admin/models`, { waitUntil: 'networkidle' });
  mediaRestored = await applyMode(
    '媒体执行模式',
    'Tuzi 真实生成',
    'model.media.execution.mode',
    'tuzi',
    'Restore Tuzi mode after Ticket 18 emergency stop evidence.'
  );

  const pool = new Pool({ connectionString: databaseUrl });
  const resultRows = await pool.query(
    `SELECT job_id, result
       FROM model_generation_jobs
      WHERE job_id = ANY($1::text[])`,
    [[copyFailure.providerJobId, videoFailure.providerJobId]]
  );
  copyResult = resultRows.rows.find(
    (row) => row.job_id === copyFailure.providerJobId
  )?.result;
  mediaResult = resultRows.rows.find(
    (row) => row.job_id === videoFailure.providerJobId
  )?.result;
  assert(
    copyResult?.failureCode === 'model_execution_disabled' &&
      copyResult?.providerCost?.amount === 0 &&
      copyResult?.usage?.status === 'refunded',
    'Persisted model stop ledger was not free and refunded',
    copyResult
  );
  assert(
    mediaResult?.failureCode === 'media_execution_disabled' &&
      mediaResult?.providerCost?.amount === 0 &&
      mediaResult?.usage?.status === 'refunded',
    'Persisted media stop ledger was not free and refunded',
    mediaResult
  );
  const snapshotResult = await pool.query(
    `SELECT process_kind, execution_mode, media_mode,
            execution_source, media_source, fallback_reason,
            booted_at::text AS booted_at
       FROM admin_config_effective_snapshots
      ORDER BY process_kind`
  );
  await pool.end();
  snapshots = snapshotResult.rows;
  await writeFile(
    path.join(outputDir, 'sql-effective-snapshots.json'),
    `${JSON.stringify({ rows: snapshots }, null, 2)}\n`
  );

  const evidence = {
    acceptance: {
      dangerousModesWereDisabledWithVisibleReasons: true,
      mediaEmergencyStopWasImmediateAndFree: true,
      merchantCouldNotSeeAdminConfig: true,
      modelEmergencyStopWasImmediateAndFree: true,
      runtimeWasRestoredToDirectAndTuzi: true,
      storedAndEffectiveValuesStayedHonestlyDistinct: true,
    },
    completedAt: new Date().toISOString(),
    emergencyStops: {
      media: {
        effectiveValueAtStop: mediaDisabled.effectiveValue,
        failureCode: mediaResult.failureCode,
        providerCost: mediaResult.providerCost,
        revision: mediaDisabled.revision,
        storedValueAtStop: mediaDisabled.storedValue,
        usage: mediaResult.usage,
      },
      model: {
        effectiveValueAtStop: modelDisabled.effectiveValue,
        failureCode: copyResult.failureCode,
        providerCost: copyResult.providerCost,
        revision: modelDisabled.revision,
        storedValueAtStop: modelDisabled.storedValue,
        usage: copyResult.usage,
      },
    },
    finalRuntimeConfig: {
      media: {
        effectiveValue: mediaRestored.effectiveValue,
        storedValue: mediaRestored.storedValue,
      },
      model: {
        effectiveValue: modelRestored.effectiveValue,
        storedValue: modelRestored.storedValue,
      },
    },
    redaction:
      'Structured evidence omits cookies, account credentials, workspace ids, job ids, and route identifiers. No provider request was accepted during either emergency stop.',
    runId,
    runtimeSnapshots: snapshots,
    timeline,
    usage: { after: usageAfter, before: usageBefore },
  };
  await writeFile(
    path.join(outputDir, 'evidence.json'),
    `${JSON.stringify(evidence, null, 2)}\n`
  );
} finally {
  await page.close();
  await context.close();
  await browser.close();
}

for (const filename of await readdir(outputDir)) {
  if (!filename.endsWith('.webm')) continue;
  const target = path.join(outputDir, 'continuous-emergency-mode-gates.webm');
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
