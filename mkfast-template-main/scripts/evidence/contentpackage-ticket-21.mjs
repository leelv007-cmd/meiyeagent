import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  readdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';
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
    '../docs/evidence/contentpackage/ticket-21'
);
const runId = `ticket-21-${Date.now()}`;
const admin = {
  email: `e2e-${runId}-admin@example.test`,
  name: 'Plan governance evidence admin',
  password: `Pa-${runId}!`,
};
const merchant = {
  email: `e2e-${runId}-merchant@example.test`,
  name: '套餐与合规验证门店',
  password: `Pm-${runId}!`,
};
const expectedGrowth = {
  allowance: { audio: 0, copy: 120, image: 48, video: 24 },
  concurrencyLimit: 5,
  queuePriority: 6,
  supportLabel: 'priority',
};
const evidenceKeys = [
  'plan.allowances.growth',
  'plan.addons',
  'compliance.watermark.default',
  'compliance.aigc_label.default',
  'compliance.regulated_mode.default',
];

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

function configMap(response) {
  assert(response.status === 200, 'Config list failed', response);
  return new Map(response.body.data.map((item) => [item.key, item]));
}

async function confirmReview(reason) {
  await page.locator('#impact-review-reason').fill(reason);
  await page
    .getByRole('button', { name: /确认配置变更|确认执行/ })
    .click();
  await page.waitForTimeout(900);
}

async function applyPlanChanges() {
  await page.locator('#plan-growth-copy').fill('120');
  await page.locator('#plan-growth-image').fill('48');
  await page.locator('#plan-growth-video').fill('24');
  await page.locator('#plan-growth-audio').fill('0');
  await page.locator('#plan-growth-concurrency').fill('5');
  await page.locator('#plan-growth-priority').fill('6');
  await page.locator('#plan-growth-support').selectOption('priority');
  await page
    .locator('#plan-growth-copy')
    .locator('xpath=ancestor::form')
    .getByRole('button', { name: '审阅套餐变更' })
    .click();
  await confirmReview('Ticket 21 plan governance evidence.');

  await page.locator('#addon-copy-20-price').fill('1.29');
  await page.locator('#addon-copy-20-currency').fill('CNY');
  await page
    .locator('#addon-copy-20-price')
    .locator('xpath=ancestor::form')
    .getByRole('button', { name: '审阅加量包价格' })
    .click();
  await confirmReview('Ticket 21 add-on price evidence.');

  for (const [id, reason] of [
    ['#compliance-watermark-default', 'Ticket 21 watermark default evidence.'],
    ['#compliance-aigc-label-default', 'Ticket 21 AIGC default evidence.'],
    ['#compliance-regulated-mode-default', 'Ticket 21 regulated default evidence.'],
  ]) {
    await page.locator(`label[for="${id.slice(1)}"]`).click();
    await confirmReview(reason);
  }
}

async function resetEvidenceBaseline() {
  const configs = configMap(await query('admin-config', 'config_list'));
  const changes = [
    [
      'plan.allowances.growth',
      {
        allowance: { audio: 0, copy: 100, image: 40, video: 20 },
        concurrencyLimit: 4,
        queuePriority: 5,
        supportLabel: 'priority',
      },
    ],
    [
      'plan.addons',
      configs.get('plan.addons').storedValue.map((offer) =>
        offer.id === 'copy-20'
          ? { ...offer, amountMicros: 990_000, currency: 'CNY' }
          : offer
      ),
    ],
    ['compliance.watermark.default', false],
    ['compliance.aigc_label.default', true],
    ['compliance.regulated_mode.default', false],
  ];
  for (const [key, value] of changes) {
    const item = configs.get(key);
    if (JSON.stringify(item.storedValue) === JSON.stringify(value)) continue;
    const applied = await command(
      'admin-config',
      'config_apply',
      {
        expectedRevision: item.revision,
        key,
        reason: 'Reset Ticket 21 evidence baseline.',
        value,
      },
      `${runId}-baseline-${key}`
    );
    assert(applied.status === 200, 'Evidence baseline reset failed', {
      key,
      response: applied,
    });
  }
}

let projectionBefore;
let projectionAfter;
let catalogAfter;
let configBeforeRestart;
let configAfterRestart;
let addOnPurchase;
let merchantDefaults;

try {
  await registerAndLogin(admin, 'admin');
  await resetEvidenceBaseline();
  await registerAndLogin(merchant, 'user');
  const checkout = await command(
    'entitlements',
    'checkout_plan',
    { tier: 'growth' },
    `${runId}-growth-before-change`
  );
  assert(checkout.status === 200, 'Initial Growth checkout failed', checkout);
  projectionBefore = (await query('entitlements', 'projection')).body.data;
  assert(
    projectionBefore.plan.allowance.copy === 100 &&
      projectionBefore.plan.concurrencyLimit === 4,
    'Initial merchant projection was not the original Growth definition',
    projectionBefore.plan
  );

  await login(admin);
  await page.goto(`${baseUrl}/admin/plans`, { waitUntil: 'networkidle' });
  await page.getByText('动作级权益目录').waitFor({ timeout: 30_000 });
  await applyPlanChanges();
  await page.getByText(/120 条/).waitFor({ timeout: 30_000 });
  await page.getByText(/1\.29 CNY/).waitFor({ timeout: 30_000 });
  configBeforeRestart = configMap(
    await query('admin-config', 'config_list')
  );
  const storedGrowth = configBeforeRestart.get(
    'plan.allowances.growth'
  )?.storedValue;
  assert(
    storedGrowth?.allowance?.audio === expectedGrowth.allowance.audio &&
      storedGrowth?.allowance?.copy === expectedGrowth.allowance.copy &&
      storedGrowth?.allowance?.image === expectedGrowth.allowance.image &&
      storedGrowth?.allowance?.video === expectedGrowth.allowance.video &&
      storedGrowth?.concurrencyLimit === expectedGrowth.concurrencyLimit &&
      storedGrowth?.queuePriority === expectedGrowth.queuePriority &&
      storedGrowth?.supportLabel === expectedGrowth.supportLabel,
    'Growth config did not update immediately',
    configBeforeRestart.get('plan.allowances.growth')
  );
  await page.screenshot({
    fullPage: true,
    path: path.join(outputDir, '01-admin-plan-price-compliance-applied.png'),
  });

  const resumeFile = path.join(outputDir, 'resume-after-runtime-restart');
  await writeFile(
    path.join(outputDir, 'restart-checkpoint.json'),
    `${JSON.stringify(
      {
        expectedConfigRevisions: Object.fromEntries(
          evidenceKeys.map((key) => [
            key,
            configBeforeRestart.get(key)?.revision ?? null,
          ])
        ),
        status: 'restart_required',
      },
      null,
      2
    )}\n`
  );
  console.log(JSON.stringify({ checkpoint: 'restart-ticket-21-runtime', resumeFile }));
  const deadline = Date.now() + 300_000;
  for (;;) {
    try {
      await access(resumeFile);
      break;
    } catch {
      if (Date.now() > deadline) throw new Error('Timed out waiting for runtime restart.');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  await login(admin);
  await page.goto(`${baseUrl}/admin/plans`, { waitUntil: 'networkidle' });
  await page.getByText(/120 条/).waitFor({ timeout: 30_000 });
  configAfterRestart = configMap(await query('admin-config', 'config_list'));
  for (const key of evidenceKeys) {
    assert(
      configAfterRestart.get(key)?.revision ===
        configBeforeRestart.get(key)?.revision,
      'Config revision changed or disappeared after restart',
      { after: configAfterRestart.get(key), before: configBeforeRestart.get(key), key }
    );
  }
  await page.screenshot({
    fullPage: true,
    path: path.join(outputDir, '02-admin-plan-config-persisted-after-restart.png'),
  });

  await login(merchant);
  projectionAfter = (await query('entitlements', 'projection')).body.data;
  assert(
    projectionAfter.plan.allowance.copy === 100 &&
      projectionAfter.plan.concurrencyLimit === 4,
    'Existing activated Growth plan was retroactively rewritten',
    projectionAfter.plan
  );
  catalogAfter = (await query('entitlements', 'catalog')).body.data;
  const growthAfter = catalogAfter.plans.find((item) => item.id === 'growth');
  const copyAddOn = catalogAfter.addOns.find((item) => item.id === 'copy-20');
  assert(
    growthAfter.allowance.audio === expectedGrowth.allowance.audio &&
      growthAfter.allowance.copy === expectedGrowth.allowance.copy &&
      growthAfter.allowance.image === expectedGrowth.allowance.image &&
      growthAfter.allowance.video === expectedGrowth.allowance.video &&
      growthAfter.concurrencyLimit === expectedGrowth.concurrencyLimit &&
      growthAfter.queuePriority === expectedGrowth.queuePriority &&
      growthAfter.supportLabel === expectedGrowth.supportLabel,
    'New Growth catalog did not use the stored definition',
    growthAfter
  );
  assert(
    copyAddOn.amountMicros === 1_290_000 && copyAddOn.currency === 'CNY',
    'New add-on catalog did not use the stored price',
    copyAddOn
  );
  const purchase = await command(
    'entitlements',
    'checkout_add_on',
    { offerId: 'copy-20' },
    `${runId}-copy-addon-after-change`
  );
  assert(purchase.status === 200, 'Recorded add-on checkout failed', purchase);
  const projectionAfterPurchase = (await query('entitlements', 'projection')).body.data;
  addOnPurchase = projectionAfterPurchase.addOnPurchases.find(
    (item) => item.purchaseId === purchase.body.data.purchaseId
  );
  assert(
    addOnPurchase?.amountMicros === 1_290_000 &&
      addOnPurchase?.currency === 'CNY',
    'Recorded purchase did not freeze the new price',
    addOnPurchase
  );

  await page.goto(`${baseUrl}/dashboard/store`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: '资质信息' }).click();
  const regulated = page.locator('#regulated');
  assert(await regulated.isChecked(), 'New store did not inherit regulated=true');
  await regulated.click();
  assert(!(await regulated.isChecked()), 'Merchant could not override regulated default');
  await page.screenshot({
    fullPage: true,
    path: path.join(outputDir, '03-merchant-regulated-default-and-override.png'),
  });

  await page.getByRole('tab', { name: '门店资料' }).click();
  await page
    .locator('#pasted-facts')
    .fill('成都合规默认验证门店。项目：头皮清洁与放松护理，体验价 59 元。');
  await page.getByRole('button', { name: '生成初稿' }).click();
  await page.getByText('未确认初稿', { exact: true }).waitFor();
  await page.locator('#store-name').fill('合规默认验证门店');
  await page.locator('#store-city').fill('成都');
  await page.locator('#store-district').fill('武侯区');
  await page.locator('#store-address').fill('科华路 21 号');
  await page.locator('#store-booking').fill('到店前一天预约');
  await page.locator('#store-project-name').fill('头皮清洁与放松护理');
  await page.locator('#project-price').fill('59');
  await page.locator('#brand-voice').fill('专业、真实、克制。');
  await page.getByRole('button', { name: '保存门店资料' }).click();
  await page.getByText('已确认', { exact: true }).waitFor({ timeout: 20_000 });

  await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '做一条项目种草内容' }).click();
  await page
    .getByLabel('描述这次想创作的内容')
    .fill('写一条真实克制的项目介绍。');
  await page.getByRole('button', { name: '建立创作记录' }).click();
  const record = page.getByLabel('创作助理整理的记录');
  await record.waitFor({ timeout: 30_000 });
  await record.getByRole('button', { name: '采用并确认 Brief' }).click();
  await record.getByText('Brief 已确认', { exact: true }).waitFor();
  await record.getByRole('button', { name: /^调整专业参数/ }).click();
  const watermark = record.getByRole('switch', { name: '品牌水印' });
  const aigc = record.getByRole('switch', { name: 'AIGC 标识' });
  await watermark.waitFor();
  assert(await watermark.isChecked(), 'New session did not inherit watermark=true');
  assert(!(await aigc.isChecked()), 'New session did not inherit AIGC=false');
  await watermark.click();
  await aigc.click();
  assert(
    !(await watermark.isChecked()) && (await aigc.isChecked()),
    'Merchant could not override compliance defaults in the current session'
  );
  merchantDefaults = {
    afterOverride: { aigcLabelEnabled: true, watermarkEnabled: false },
    initial: { aigcLabelEnabled: false, watermarkEnabled: true },
    regulatedInitial: true,
    regulatedOverride: false,
  };
  await page.screenshot({
    fullPage: true,
    path: path.join(outputDir, '04-merchant-compliance-defaults-and-override.png'),
  });

  const pool = new Pool({ connectionString: databaseUrl });
  const sql = await pool.query(
    `SELECT config_key, revision, status, actor_id, reason, correlation_id,
            created_at::text AS created_at, value
       FROM admin_config_revisions
      WHERE scope = 'global'
        AND workspace_id = '__global__'
        AND config_key = ANY($1::text[])
      ORDER BY config_key, revision`,
    [evidenceKeys]
  );
  await pool.end();
  await writeFile(
    path.join(outputDir, 'sql-version-chain.json'),
    `${JSON.stringify({ query: 'admin_config_revisions for Ticket 21 keys', rows: sql.rows }, null, 2)}\n`
  );

  const evidence = {
    acceptance: {
      addOnCheckoutUsedNewPrice: true,
      adminChangesVisibleImmediately: true,
      complianceDefaultsAppliedOnlyToNewForms: true,
      existingPlanWasNotRetroactivelyRewritten: true,
      merchantCouldOverrideComplianceDefaults: true,
      persistedAcrossColdRestart: true,
      recordedCommerceWasExplicit: catalogAfter.mode === 'recorded',
    },
    addOnPurchase: {
      amountMicros: addOnPurchase.amountMicros,
      currency: addOnPurchase.currency,
      quantity: addOnPurchase.quantity,
      resource: addOnPurchase.resource,
    },
    completedAt: new Date().toISOString(),
    configRevisions: Object.fromEntries(
      evidenceKeys.map((key) => [key, configAfterRestart.get(key)?.revision ?? null])
    ),
    existingPlan: {
      afterChange: projectionAfter.plan,
      beforeChange: projectionBefore.plan,
    },
    merchantDefaults,
    newCatalog: { copyAddOn, growth: growthAfter },
    redaction:
      'Structured evidence omits cookies, workspace ids, payment ids, and account credentials. Recorded commerce is explicitly reported as recorded.',
    runId,
    timeline,
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
  const target = path.join(outputDir, 'continuous-plan-compliance-journey.webm');
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
