import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  readdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { chromium } from '@playwright/test';

const baseUrl = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:3000';
const outputDir = path.resolve(
  process.env.EVIDENCE_OUTPUT_DIR ??
    '../docs/evidence/contentpackage/ticket-02'
);
const photo = path.resolve(
  process.env.EVIDENCE_PHOTO ??
    '../.scratch/real-run-0001-prep/merchant-photo-8530089748.jpg'
);
const runId = `ticket-02-${Date.now()}`;
const admin = {
  email: `e2e-${runId}-admin@example.test`,
  name: 'Custom provider evidence admin',
  password: `Ca-${runId}!`,
};
const merchant = {
  email: `e2e-${runId}-merchant@example.test`,
  name: '自定义供应商真实跑通门店',
  password: `Cm-${runId}!`,
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
const commandResponses = [];

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
  if (response.url().includes('/api/core/p1/commands')) {
    commandResponses.push({ body, status: response.status() });
  }
});

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(details)}`);
}

async function registerAndLogin(account, role) {
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

function lastStage(stage) {
  const response = commandResponses.at(-1);
  assert(
    response?.status === 200 && response.body?.data?.stage === stage,
    `Catalog ${stage} failed`,
    response
  );
  return response.body.data;
}

let activationRuns;
let customDeployment;
let catalogRevision;
let customJob;

try {
  await registerAndLogin(admin, 'admin');
  await page.goto(`${baseUrl}/admin/models`, { waitUntil: 'networkidle' });
  await page.getByText('model.execution.mode').waitFor({ timeout: 30_000 });
  let control = await query('model-supply', 'admin_catalog_control');
  assert(control.status === 200, 'Catalog control unavailable', control);
  customDeployment = control.body.data.catalog.deployments.find(
    (deployment) =>
      deployment.catalogModelId === 'llm-custom'
  );
  assert(customDeployment, 'Custom deployment missing', {
    deployments: control.body.data.catalog.deployments.map((item) => ({
      catalogModelId: item.catalogModelId,
      id: item.id,
      status: item.status,
    })),
  });
  const customModel = control.body.data.catalog.models.find(
    (model) => model.id === 'llm-custom'
  );
  assert(customModel, 'Custom model missing', control.body.data.catalog.models);
  activationRuns = [];
  for (const operation of customModel.operations) {
    const probe = await command(
      'model-supply',
      'activation_probe_run',
      { deploymentId: customDeployment.id, operation },
      `${runId}-probe-${operation}`
    );
    assert(
      probe.status === 200 && probe.body?.data?.outcome === 'passed',
      'Custom activation probe failed',
      { operation, probe }
    );
    activationRuns.push({
      actualCatalogModelId: probe.body.data.actualCatalogModelId,
      deploymentId: probe.body.data.deploymentId,
      durationMs: probe.body.data.durationMs,
      operation: probe.body.data.operation,
      outcome: probe.body.data.outcome,
      phase: 'bootstrap_before_restart',
      providerCost: probe.body.data.providerCost,
      providerModel: probe.body.data.providerModel,
      runId: probe.body.data.id,
    });
  }
  const resumeFile = path.join(outputDir, 'resume-after-probe-restart');
  await writeFile(
    path.join(outputDir, 'probe-restart-checkpoint.json'),
    `${JSON.stringify(
      {
        deploymentId: customDeployment.id,
        operations: activationRuns.map((run) => run.operation),
        status: 'restart_required',
      },
      null,
      2
    )}\n`
  );
  console.log(
    JSON.stringify({ checkpoint: 'restart-custom-runtime', resumeFile })
  );
  const restartDeadline = Date.now() + 300_000;
  for (;;) {
    try {
      await access(resumeFile);
      break;
    } catch {
      if (Date.now() > restartDeadline) {
        throw new Error('Timed out waiting for the custom runtime restart.');
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  await page.goto(`${baseUrl}/admin/models`, { waitUntil: 'networkidle' });
  await page.getByText('model.execution.mode').waitFor({ timeout: 30_000 });
  control = await query('model-supply', 'admin_catalog_control');
  const refreshedCustom = control.body.data.catalog.deployments.find(
    (deployment) => deployment.id === customDeployment.id
  );
  assert(
    refreshedCustom?.status === 'active' &&
      refreshedCustom?.activationEvidence?.status === 'live_verified',
    'Custom deployment did not become active and live verified after restart',
    refreshedCustom
  );
  for (const deployment of control.body.data.catalog.deployments) {
    if (deployment.activationEvidence?.status !== 'live_verified') continue;
    const model = control.body.data.catalog.models.find(
      (candidate) => candidate.id === deployment.catalogModelId
    );
    for (const operation of model?.operations ?? []) {
      const probe = await command(
        'model-supply',
        'activation_probe_run',
        { deploymentId: deployment.id, operation },
        `${runId}-publish-probe-${deployment.id}-${operation}`
      );
      assert(
        probe.status === 200 && probe.body?.data?.outcome === 'passed',
        'Publish activation probe failed',
        { deploymentId: deployment.id, operation, probe }
      );
      activationRuns.push({
        actualCatalogModelId: probe.body.data.actualCatalogModelId,
        deploymentId: probe.body.data.deploymentId,
        durationMs: probe.body.data.durationMs,
        operation: probe.body.data.operation,
        outcome: probe.body.data.outcome,
        phase: 'publish_after_restart',
        providerCost: probe.body.data.providerCost,
        providerModel: probe.body.data.providerModel,
        runId: probe.body.data.id,
      });
    }
  }
  control = await query('model-supply', 'admin_catalog_control');
  await page.screenshot({
    fullPage: true,
    path: path.join(outputDir, '01-custom-live-verified-admin.png'),
  });

  const editor = page.getByLabel('模型渠道目录 JSON');
  await editor.fill(JSON.stringify(control.body.data.catalog, null, 2));
  await page.getByRole('button', { name: '校验并创建草稿' }).click();
  await page.waitForTimeout(1_500);
  const draft = lastStage('draft');
  await page.locator('#admin-model-revision-id').fill(draft.id);
  await page.getByRole('button', { name: '启用 draft' }).click();
  await page.waitForTimeout(1_500);
  const enabled = lastStage('enabled');
  await page.locator('#admin-model-revision-id').fill(enabled.id);
  await page.getByRole('button', {
    name: '发布 enabled revision',
  }).click();
  await page
    .locator('#impact-review-reason')
    .fill('Publish live-verified custom provider evidence.');
  await page.getByRole('button', { name: '确认发布目录' }).click();
  await page.waitForTimeout(1_500);
  catalogRevision = lastStage('published');
  await page.screenshot({
    fullPage: true,
    path: path.join(outputDir, '02-custom-catalog-published.png'),
  });

  await context.clearCookies();
  await registerAndLogin(merchant, 'user');
  const checkout = await command(
    'entitlements',
    'checkout_plan',
    { tier: 'growth' },
    `${runId}-growth`
  );
  assert(checkout.status === 200, 'Growth checkout failed', checkout);

  await page.goto(`${baseUrl}/dashboard/store`, { waitUntil: 'networkidle' });
  await page
    .locator('#pasted-facts')
    .fill('成都自定义供应商验证门店。项目：头皮清洁与放松护理，体验价 59 元。');
  await page.getByRole('button', { name: '生成初稿' }).click();
  await page.getByText('未确认初稿', { exact: true }).waitFor();
  await page.locator('#store-name').fill('自定义供应商验证门店');
  await page.locator('#store-city').fill('成都');
  await page.locator('#store-district').fill('武侯区');
  await page.locator('#store-address').fill('科华路 88 号');
  await page.locator('#store-booking').fill('到店前一天预约');
  await page.locator('#store-project-name').fill('头皮清洁与放松护理');
  await page.locator('#project-price').fill('59');
  await page.locator('#brand-voice').fill('专业、真实、克制，不作疗效承诺。');
  await page.getByRole('button', { name: '保存门店资料' }).click();
  await page.getByText('已确认', { exact: true }).waitFor({ timeout: 20_000 });

  await page.goto(`${baseUrl}/dashboard/assets`, { waitUntil: 'networkidle' });
  await page.locator('#canonical-asset-upload').setInputFiles(photo);
  await page
    .getByRole('link', { name: '确认这张素材能否用于宣传' })
    .first()
    .click();
  await page.waitForURL(/\/dashboard\/assets\/asset-/);
  await page
    .getByLabel('授权凭证编号或存档位置')
    .fill('ticket-02-owner-consent');
  await page.getByRole('button', { name: /确认公开营销授权/ }).click();
  await page.getByText('公开营销可用', { exact: true }).waitFor();

  await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '做一条项目种草内容' }).click();
  const more = page.getByRole('button', { exact: true, name: '更多' });
  if (await more.isVisible().catch(() => false)) await more.click();
  const sources = page.getByRole('button', { name: /^素材 · / });
  await sources.first().waitFor({ timeout: 30_000 });
  for (let index = 0; index < (await sources.count()); index += 1) {
    const source = sources.nth(index);
    if ((await source.getAttribute('aria-pressed')) !== 'true') {
      await source.click();
    }
  }
  await page
    .getByLabel('描述这次想创作的内容')
    .fill('写一条真实克制的头皮清洁项目种草文案，强调 59 元体验价，不作疗效承诺。');
  await page.getByRole('button', { name: '建立创作记录' }).click();
  const record = page.getByLabel('创作助理整理的记录');
  await record.waitFor();
  await record.getByRole('button', { name: '采用并确认 Brief' }).click();
  await record.getByText('Brief 已确认', { exact: true }).waitFor();
  await record.getByRole('button', { name: /^调整专业参数/ }).click();
  const modelGroup = record.getByRole('radiogroup', { name: '执行模型' });
  await modelGroup.waitFor({ timeout: 30_000 });
  await modelGroup.getByRole('radio', { name: /自定义供应商|Custom/ }).click();
  await record
    .getByText(/自定义供应商 · 3 条内容候选/)
    .waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1_000);
  const contract = record.getByRole('checkbox', {
    name: /我已确认模型、规格、费用和发布标识/,
  });
  await contract.check();
  assert(await contract.isChecked(), 'Execution contract was not accepted');
  await page.screenshot({
    fullPage: true,
    path: path.join(outputDir, '03-custom-fixed-before-submit.png'),
  });
  await record.getByRole('button', { name: '提交生成任务' }).click();
  const candidates = page.getByRole('radiogroup', { name: '三条文案候选' });
  await candidates.waitFor({ timeout: 180_000 });
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        '[role="radiogroup"][aria-label="三条文案候选"] [role="radio"]'
      ).length === 3,
    undefined,
    { timeout: 180_000 }
  );
  await page.screenshot({
    fullPage: true,
    path: path.join(outputDir, '04-custom-real-three-candidates.png'),
  });
  const workbench = await query('operations', 'creative_workbench');
  customJob = workbench.body.data.jobs.find(
    (job) =>
      job.contract?.operation === 'copy.generate' &&
      job.executionProvenance?.actualCatalogModelId === 'llm-custom'
  );
  assert(customJob?.status === 'completed', 'Custom merchant job missing', {
    jobs: workbench.body.data.jobs.map((job) => ({
      actualCatalogModelId: job.executionProvenance?.actualCatalogModelId,
      operation: job.contract?.operation,
      status: job.status,
    })),
  });

  const evidence = {
    acceptance: {
      adminCustomDeploymentVisible: true,
      customFixedSelectionUsed: true,
      liveCustomProbePassedAllOperations:
        activationRuns.filter(
          (run) =>
            run.deploymentId === customDeployment.id &&
            run.phase === 'publish_after_restart'
        ).length === 3,
      merchantReceivedThreeCandidates: (await candidates.getByRole('radio').count()) === 3,
      noAutomaticCrossBrandSwitch:
        customJob.executionProvenance.actualCatalogModelId === 'llm-custom',
      publishedCustomCatalog: catalogRevision.stage === 'published',
    },
    activationRuns,
    catalogRevision: { id: catalogRevision.id, stage: catalogRevision.stage },
    completedAt: new Date().toISOString(),
    configuration: {
      apiFamily: 'custom',
      catalogModelId: 'llm-custom',
      customProtocol: 'openai_chat',
      deploymentId: customDeployment.id,
    },
    merchantJob: {
      actualCatalogModelId:
        customJob.executionProvenance.actualCatalogModelId,
      catalogModelId: customJob.contract.catalogModelId,
      operation: customJob.contract.operation,
      providerModel: customJob.executionProvenance.providerModel,
      routeSnapshotId: customJob.routeSnapshotId,
      status: customJob.status,
    },
    redaction: 'Structured JSON omits credentials, cookies, raw generated copy, workspace ids, and provider request references. Screenshots and video retain the merchant-visible generated copy required for UI acceptance.',
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
  const target = path.join(outputDir, 'continuous-custom-provider-journey.webm');
  if (filename !== path.basename(target)) await rename(path.join(outputDir, filename), target);
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
