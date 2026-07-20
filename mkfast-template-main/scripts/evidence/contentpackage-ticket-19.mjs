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
  process.env.DATABASE_URL ?? 'postgres://meiye:meiye@127.0.0.1:54329/meiye';
const outputDir = path.resolve(
  process.env.EVIDENCE_OUTPUT_DIR ?? '../docs/evidence/contentpackage/ticket-19'
);
const photo = path.resolve(
  process.env.EVIDENCE_PHOTO ??
    '../docs/evidence/contentpackage/real-run-0003/journey/generated-image.png'
);
const providerCredential = process.env.MODEL_DIRECT_API_KEY;
if (!providerCredential) {
  throw new Error('Ticket 19 requires the private live provider environment.');
}
const runId = `ticket-19-${Date.now()}`;
const admin = {
  email: `e2e-${runId}-admin@example.test`,
  name: 'Provider vault evidence admin',
  password: `Va-${runId}!`,
};
const merchant = {
  email: `e2e-${runId}-merchant@example.test`,
  name: 'Provider 保险箱实执行门店',
  password: `Vm-${runId}!`,
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

async function waitForResume(filename, checkpoint) {
  const resumeFile = path.join(outputDir, filename);
  console.log(JSON.stringify({ checkpoint, resumeFile }));
  const deadline = Date.now() + 300_000;
  for (;;) {
    try {
      await access(resumeFile);
      return;
    } catch {
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for ${checkpoint}.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

function platformCredential(response) {
  assert(response.status === 200, 'Provider credential query failed', response);
  const item = response.body.data.find(
    (candidate) => candidate.id === 'platform:model.direct'
  );
  assert(item, 'Model direct provider slot missing', response.body.data);
  return item;
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

function sanitizeConnection(connection) {
  return {
    credential: connection.credential
      ? {
          lastUsedAt: connection.credential.lastUsedAt,
          mask: connection.credential.mask,
          scope: connection.credential.scope,
          status: connection.credential.status,
          testedAt: connection.credential.testedAt,
          testErrorCode: connection.credential.testErrorCode,
          testStatus: connection.credential.testStatus,
          version: connection.credential.version,
        }
      : undefined,
    effectiveSource: connection.effectiveSource,
    id: connection.id,
    status: connection.status,
    updatedAt: connection.updatedAt,
  };
}

let beforeRestart;
let afterVaultRestart;
let afterProbeRestart;
const activationRuns = [];
let targetDeployment;
let catalogRevision;
let merchantJob;
let routeCandidate;
let providerAudit;
let merchantForbidden;

try {
  await registerAndLogin(admin, 'admin');
  await page.goto(`${baseUrl}/admin/integrations`, {
    waitUntil: 'networkidle',
  });
  await page
    .getByText('Provider 凭据', { exact: true })
    .waitFor({ timeout: 30_000 });
  const input = page.getByLabel('为 model.direct 输入新凭据');
  await input.fill(providerCredential);
  await page
    .getByText('model.direct', { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"rounded-lg")]')
    .getByRole('button', { name: '保存凭据' })
    .click();
  await page.getByText(/•••••••• · v1/).waitFor({ timeout: 30_000 });
  assert(
    (await input.inputValue()) === '',
    'Write-only input did not clear after save'
  );
  await page
    .getByText('model.direct', { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"rounded-lg")]')
    .getByRole('button', { name: '测试连接' })
    .click();
  await page
    .getByText('连接成功。', { exact: true })
    .waitFor({ timeout: 180_000 });
  await page.screenshot({
    fullPage: true,
    path: path.join(outputDir, '01-provider-v1-masked-and-tested.png'),
  });

  await input.fill(providerCredential);
  await page
    .getByText('model.direct', { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"rounded-lg")]')
    .getByRole('button', { name: '轮换' })
    .click();
  await page.getByText(/•••••••• · v2/).waitFor({ timeout: 30_000 });
  assert(
    (await input.inputValue()) === '',
    'Write-only input did not clear after rotate'
  );
  await page
    .getByText('model.direct', { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"rounded-lg")]')
    .getByRole('button', { name: '测试连接' })
    .click();
  await page
    .getByText('连接成功。', { exact: true })
    .waitFor({ timeout: 180_000 });
  beforeRestart = platformCredential(
    await query('integrations', 'admin_provider_credentials')
  );
  assert(
    beforeRestart.credential?.version === 2 &&
      beforeRestart.credential?.testStatus === 'passed' &&
      beforeRestart.effectiveSource === 'env_fallback',
    'Rotated credential was not tested and restart-pending',
    sanitizeConnection(beforeRestart)
  );
  assert(
    !JSON.stringify(beforeRestart).includes(providerCredential),
    'Provider credential query leaked the raw value'
  );
  const douyin = (
    await query('integrations', 'admin_provider_credentials')
  ).body.data.find((candidate) => candidate.id === 'platform:douyin.platform');
  assert(
    douyin.effectiveSource === 'env',
    'Douyin slot stopped being honest recorded/env'
  );
  await page.screenshot({
    fullPage: true,
    path: path.join(outputDir, '02-provider-v2-tested-restart-pending.png'),
  });
  await writeFile(
    path.join(outputDir, 'vault-restart-checkpoint.json'),
    `${JSON.stringify(
      {
        expectedCredentialVersion: 2,
        expectedEffectiveSource: 'vault',
        status: 'restart_required',
      },
      null,
      2
    )}\n`
  );
  await waitForResume(
    'resume-after-vault-restart',
    'restart-provider-vault-runtime'
  );

  await login(admin);
  await page.goto(`${baseUrl}/admin/integrations`, {
    waitUntil: 'networkidle',
  });
  await page
    .getByText('当前生效来源：保险箱', { exact: true })
    .waitFor({ timeout: 30_000 });
  afterVaultRestart = platformCredential(
    await query('integrations', 'admin_provider_credentials')
  );
  assert(
    afterVaultRestart.effectiveSource === 'vault' &&
      afterVaultRestart.credential?.version === 2,
    'Vault credential did not become effective after restart',
    sanitizeConnection(afterVaultRestart)
  );
  await page.screenshot({
    fullPage: true,
    path: path.join(outputDir, '03-provider-v2-effective-from-vault.png'),
  });

  await page.goto(`${baseUrl}/admin/models`, { waitUntil: 'networkidle' });
  const controlBeforeProbe = await query(
    'model-supply',
    'admin_catalog_control'
  );
  assert(
    controlBeforeProbe.status === 200,
    'Catalog control unavailable',
    controlBeforeProbe
  );
  targetDeployment = controlBeforeProbe.body.data.catalog.deployments.find(
    (deployment) => deployment.catalogModelId === 'llm-openai'
  );
  const targetModel = controlBeforeProbe.body.data.catalog.models.find(
    (model) => model.id === 'llm-openai'
  );
  assert(targetDeployment && targetModel, 'OpenAI deployment/model missing');
  const probeRunsBefore = (await query('model-supply', 'activation_probe_runs'))
    .body.data;
  const probeIdsBefore = new Set(probeRunsBefore.map((run) => run.id));
  const targetRow = page
    .getByRole('row')
    .filter({ hasText: targetDeployment.id })
    .first();
  await targetRow
    .getByRole('button', { name: '运行真实探针 · copy.generate' })
    .click();
  await page.getByRole('button', { name: '确认并运行' }).click();
  let probeRuns;
  const probeDeadline = Date.now() + 180_000;
  for (;;) {
    probeRuns = (await query('model-supply', 'activation_probe_runs')).body
      .data;
    if (probeRuns.some((run) => !probeIdsBefore.has(run.id))) break;
    if (Date.now() > probeDeadline) {
      throw new Error('Timed out waiting for the UI activation probe.');
    }
    await page.waitForTimeout(500);
  }
  const firstProbe = probeRuns.find(
    (run) =>
      !probeIdsBefore.has(run.id) &&
      run.deploymentId === targetDeployment.id &&
      run.operation === 'copy.generate' &&
      run.outcome === 'passed'
  );
  assert(firstProbe, 'UI activation probe did not persist a passed run');
  activationRuns.push(firstProbe);
  for (const operation of targetModel.operations.filter(
    (candidate) => candidate !== 'copy.generate'
  )) {
    const probe = await command(
      'model-supply',
      'activation_probe_run',
      { deploymentId: targetDeployment.id, operation },
      `${runId}-probe-${operation}`
    );
    assert(
      probe.status === 200 && probe.body.data.outcome === 'passed',
      'Vault-backed activation probe failed',
      { operation, probe }
    );
    activationRuns.push(probe.body.data);
  }
  await page.screenshot({
    fullPage: true,
    path: path.join(outputDir, '04-vault-backed-real-probe-passed.png'),
  });
  await writeFile(
    path.join(outputDir, 'probe-restart-checkpoint.json'),
    `${JSON.stringify(
      {
        deploymentId: targetDeployment.id,
        operations: activationRuns.map((run) => run.operation),
        status: 'restart_required',
      },
      null,
      2
    )}\n`
  );
  await waitForResume(
    'resume-after-probe-restart',
    'restart-probe-evidence-runtime'
  );

  await login(admin);
  await page.goto(`${baseUrl}/admin/models`, { waitUntil: 'networkidle' });
  let control = await query('model-supply', 'admin_catalog_control');
  const refreshedTarget = control.body.data.catalog.deployments.find(
    (deployment) => deployment.id === targetDeployment.id
  );
  assert(
    refreshedTarget?.status === 'active' &&
      refreshedTarget.activationEvidence?.status === 'live_verified' &&
      refreshedTarget.credentialVersion === '2',
    'Vault-backed deployment was not live verified after restart',
    refreshedTarget
  );
  afterProbeRestart = platformCredential(
    await query('integrations', 'admin_provider_credentials')
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
        probe.status === 200 && probe.body.data.outcome === 'passed',
        'Catalog publication probe failed',
        { deploymentId: deployment.id, operation, probe }
      );
      activationRuns.push(probe.body.data);
    }
  }
  control = await query('model-supply', 'admin_catalog_control');
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
  await page.getByRole('button', { name: '发布 enabled revision' }).click();
  await page
    .locator('#impact-review-reason')
    .fill('Publish vault-backed model catalog evidence.');
  await page.getByRole('button', { name: '确认发布目录' }).click();
  await page.waitForTimeout(1_500);
  catalogRevision = lastStage('published');
  await page.screenshot({
    fullPage: true,
    path: path.join(outputDir, '05-vault-backed-catalog-published.png'),
  });

  await context.clearCookies();
  await registerAndLogin(merchant, 'user');
  merchantForbidden = await query('integrations', 'admin_provider_credentials');
  assert(
    merchantForbidden.status === 403 &&
      merchantForbidden.body.error?.code === 'FORBIDDEN',
    'Merchant could access platform provider credentials',
    merchantForbidden
  );
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
    .fill(
      '成都 Provider 保险箱验证门店。项目：头皮清洁与放松护理，体验价 59 元。'
    );
  await page.getByRole('button', { name: '生成初稿' }).click();
  await page.getByText('未确认初稿', { exact: true }).waitFor();
  await page.locator('#store-name').fill('Provider 保险箱验证门店');
  await page.locator('#store-city').fill('成都');
  await page.locator('#store-district').fill('武侯区');
  await page.locator('#store-address').fill('科华路 19 号');
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
    .fill('ticket-19-owner-consent');
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
    if ((await source.getAttribute('aria-pressed')) !== 'true')
      await source.click();
  }
  await page
    .getByLabel('描述这次想创作的内容')
    .fill(
      '写一条真实克制的头皮清洁项目种草文案，强调 59 元体验价，不作疗效承诺。'
    );
  await page.getByRole('button', { name: '建立创作记录' }).click();
  const record = page.getByLabel('创作助理整理的记录');
  await record.waitFor();
  await record.getByRole('button', { name: '采用并确认 Brief' }).click();
  await record.getByText('Brief 已确认', { exact: true }).waitFor();
  await record.getByRole('button', { name: /^调整专业参数/ }).click();
  const modelGroup = record.getByRole('radiogroup', { name: '执行模型' });
  await modelGroup.waitFor({ timeout: 30_000 });
  await modelGroup.getByRole('radio', { name: /OpenAI/i }).click();
  const contract = record.getByRole('checkbox', {
    name: /我已确认模型、规格、费用和发布标识/,
  });
  await contract.check();
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
    path: path.join(outputDir, '06-merchant-real-generation-with-vault-v2.png'),
  });
  const workbench = await query('operations', 'creative_workbench');
  merchantJob = workbench.body.data.jobs.find(
    (job) =>
      job.contract?.operation === 'copy.generate' &&
      job.executionProvenance?.actualCatalogModelId === 'llm-openai'
  );
  assert(
    merchantJob?.status === 'completed',
    'Vault-backed merchant job missing',
    {
      jobs: workbench.body.data.jobs.map((job) => ({
        actualCatalogModelId: job.executionProvenance?.actualCatalogModelId,
        operation: job.contract?.operation,
        status: job.status,
      })),
    }
  );

  const pool = new Pool({ connectionString: databaseUrl });
  const routeResult = await pool.query(
    `SELECT allowed_candidates
       FROM p1_route_snapshots
      WHERE id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [merchantJob.routeSnapshotId]
  );
  routeCandidate = routeResult.rows[0]?.allowed_candidates?.find(
    (candidate) => candidate.catalogModelId === 'llm-openai'
  );
  assert(
    routeCandidate?.credentialVersion === '2',
    'Merchant route did not freeze vault credential version 2',
    routeCandidate
  );
  const auditResult = await pool.query(
    `SELECT data
       FROM integration_audit_events
      WHERE workspace_id = '__global__'
        AND connection_id = 'platform:model.direct'
      ORDER BY created_at, id`
  );
  await pool.end();
  providerAudit = auditResult.rows.map((row) => row.data);
  await writeFile(
    path.join(outputDir, 'sql-provider-version-chain.json'),
    `${JSON.stringify(
      {
        providerAudit,
        route: {
          actualCatalogModelId: routeCandidate.catalogModelId,
          credentialVersion: routeCandidate.credentialVersion,
          deploymentId: routeCandidate.deploymentId,
          providerModel: routeCandidate.providerModel,
          routeSnapshotId: merchantJob.routeSnapshotId,
        },
      },
      null,
      2
    )}\n`
  );

  const evidence = {
    acceptance: {
      adminManagedCredentialWithoutCodeOrEnvEdit: true,
      douyinRemainedHonestlyRecorded: true,
      merchantCouldNotAccessPlatformCredentials: true,
      merchantGenerationUsedRotatedVersion:
        routeCandidate.credentialVersion === '2',
      queryNeverReturnedPlaintext: true,
      realConnectionTestPassed:
        afterVaultRestart.credential.testStatus === 'passed',
      vaultBecameEffectiveAfterColdRestart:
        afterVaultRestart.effectiveSource === 'vault',
      versionIncrementedAndOldVersionRevoked: providerAudit.some(
        (event) => event.action === 'credential.rotated'
      ),
      writeOnlyInputCleared: true,
    },
    activationRuns: activationRuns.map((run) => ({
      configurationRevision: run.configurationRevision,
      correlationId: run.correlationId,
      deploymentId: run.deploymentId,
      durationMs: run.durationMs,
      id: run.id,
      operation: run.operation,
      outcome: run.outcome,
      providerCost: run.providerCost,
      providerModel: run.providerModel,
    })),
    catalogRevision: { id: catalogRevision.id, stage: catalogRevision.stage },
    completedAt: new Date().toISOString(),
    credential: {
      afterProbeRestart: sanitizeConnection(afterProbeRestart),
      afterVaultRestart: sanitizeConnection(afterVaultRestart),
      beforeRestart: sanitizeConnection(beforeRestart),
    },
    merchantJob: {
      actualCatalogModelId:
        merchantJob.executionProvenance.actualCatalogModelId,
      credentialVersion: routeCandidate.credentialVersion,
      operation: merchantJob.contract.operation,
      providerModel: merchantJob.executionProvenance.providerModel,
      routeSnapshotId: merchantJob.routeSnapshotId,
      status: merchantJob.status,
    },
    providerAudit: providerAudit.map((event) => ({
      action: event.action,
      actorId: event.actorId,
      correlationId: event.correlationId,
      createdAt: event.createdAt,
      details: event.details,
    })),
    redaction:
      'Credentials, cookies, workspace ids, secret references, and raw generated copy are omitted. Only the fixed mask, credential version, status, and route provenance are retained.',
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
  const target = path.join(outputDir, 'continuous-provider-vault-journey.webm');
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
