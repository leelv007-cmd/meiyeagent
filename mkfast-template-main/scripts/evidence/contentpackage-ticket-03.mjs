import { createHash } from 'node:crypto';
import { access, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from '@playwright/test';

const baseUrl = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:3000';
const outputDir = path.resolve(
  process.env.EVIDENCE_OUTPUT_DIR ?? '../docs/evidence/contentpackage/ticket-03'
);
const providerCredential = process.env.MODEL_DIRECT_API_KEY;
const providerEndpoint = process.env.MODEL_DIRECT_BASE_URL;
const providerModel = process.env.MODEL_DIRECT_MODEL;
if (!providerCredential || !providerEndpoint || !providerModel) {
  throw new Error('Ticket 03 requires the private live provider environment.');
}

const runId = `ticket-03-${Date.now()}`;
const admin = {
  email: `e2e-${runId}-admin@example.test`,
  name: 'BYOK live evidence admin',
  password: `Ba-${runId}!`,
};
const merchant = {
  email: `e2e-${runId}-merchant@example.test`,
  name: 'BYOK 真实执行门店',
  password: `Bm-${runId}!`,
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

function configItem(result, key) {
  assert(result.status === 200, 'Runtime config query failed', result);
  const item = result.body.data.find((candidate) => candidate.key === key);
  assert(item, 'Runtime config item missing', { key });
  return item;
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

let adminBefore;
let adminPending;
let adminEffective;
let validConnection;
let invalidConnection;
let usageBefore;
let usageAfterSuccess;
let usageAfterReplay;
let usageAfterInvalid;
let successResult;
let successOutputText;
let replayResult;
let invalidResult;
let auditEvents;

try {
  await registerAndLogin(admin, 'admin');
  await page.goto(`${baseUrl}/admin/models`, { waitUntil: 'networkidle' });
  await page.getByText('byok.adapter.assembly').waitFor({ timeout: 30_000 });
  adminBefore = configItem(
    await query('admin-config', 'config_list'),
    'byok.adapter.assembly'
  );
  const assembly = page.getByRole('radiogroup', {
    name: 'BYOK 适配器装配',
  });
  await assembly.getByRole('radio', { name: 'Live' }).click();
  await page.getByRole('button', { name: '审阅并记录' }).click();
  await page.locator('#impact-review-reason').fill('Enable real BYOK evidence run.');
  await page.getByRole('button', { name: '确认记录配置' }).click();
  await page.waitForTimeout(1_000);
  adminPending = configItem(
    await query('admin-config', 'config_list'),
    'byok.adapter.assembly'
  );
  assert(
    adminPending.storedValue === 'live' && adminPending.effectiveValue === 'recorded',
    'BYOK live assembly was not stored as restart-pending',
    adminPending
  );
  await page.screenshot({
    fullPage: true,
    path: path.join(outputDir, '01-admin-byok-live-restart-pending.png'),
  });

  const resumeFile = path.join(outputDir, 'resume-after-byok-restart');
  await writeFile(
    path.join(outputDir, 'restart-checkpoint.json'),
    `${JSON.stringify(
      {
        configKey: 'byok.adapter.assembly',
        expectedEffectiveValue: 'live',
        storedRevision: adminPending.revision,
        status: 'restart_required',
      },
      null,
      2
    )}\n`
  );
  console.log(JSON.stringify({ checkpoint: 'restart-byok-live-runtime', resumeFile }));
  const deadline = Date.now() + 300_000;
  for (;;) {
    try {
      await access(resumeFile);
      break;
    } catch {
      if (Date.now() > deadline) throw new Error('Timed out waiting for BYOK restart.');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  await page.goto(`${baseUrl}/admin/models`, { waitUntil: 'networkidle' });
  await page.getByText('byok.adapter.assembly').waitFor({ timeout: 30_000 });
  adminEffective = configItem(
    await query('admin-config', 'config_list'),
    'byok.adapter.assembly'
  );
  assert(
    adminEffective.storedValue === 'live' && adminEffective.effectiveValue === 'live',
    'BYOK live assembly did not become effective after restart',
    adminEffective
  );
  await page.screenshot({
    fullPage: true,
    path: path.join(outputDir, '02-admin-byok-live-effective.png'),
  });

  await context.clearCookies();
  await registerAndLogin(merchant, 'user');
  await page.goto(`${baseUrl}/settings/models?section=byok`, {
    waitUntil: 'networkidle',
  });
  await page.locator('#integration-subject').fill('真实 BYOK 密钥');
  await page.locator('#integration-secret').fill(providerCredential);
  await page.getByRole('button', { name: '创建连接' }).click();
  await page
    .getByText('真实 BYOK 密钥', { exact: true })
    .waitFor({ state: 'attached', timeout: 30_000 });
  assert(
    (await page.locator('#integration-secret').inputValue()) === '',
    'Write-only credential input did not clear after save'
  );
  const connectionsAfterCreate = await query('integrations', 'connections');
  validConnection = connectionsAfterCreate.body.data.find(
    (connection) => connection.subject === '真实 BYOK 密钥'
  );
  assert(validConnection, 'Valid BYOK connection missing', connectionsAfterCreate);
  await page.locator('#byok-prompt').waitFor({ timeout: 30_000 });
  await page.getByText('演示执行', { exact: true }).waitFor({ state: 'detached' });
  await page.screenshot({
    fullPage: true,
    path: path.join(outputDir, '03-merchant-write-only-live-connection.png'),
  });

  const optionsBefore = await query('integrations', 'strict_byok_options');
  assert(optionsBefore.status === 200, 'BYOK options unavailable', optionsBefore);
  assert(optionsBefore.body.data.executionMode === 'live', 'BYOK UI is not live', optionsBefore);
  assert(
    optionsBefore.body.data.profiles.some((profile) =>
      profile.permittedModels.includes('llm-custom')
    ),
    'Controlled endpoint does not publish llm-custom',
    optionsBefore.body.data.profiles
  );
  usageBefore = optionsBefore.body.data.usage;
  await page.locator('#byok-model').selectOption('llm-custom');
  await page
    .locator('#byok-prompt')
    .fill('为成都一家头皮护理门店写一段真实克制的中文介绍，不承诺疗效，控制在 80 字以内。');
  await page.screenshot({
    fullPage: true,
    path: path.join(outputDir, '04-merchant-live-byok-before-submit.png'),
  });
  await page.getByRole('button', { name: '使用密钥试用' }).click();
  await page
    .getByText(/结果：已完成 · 产品额度 已结算/)
    .waitFor({ timeout: 180_000 });
  const successSummary = page.getByText(/结果：已完成 · 产品额度 已结算/);
  successOutputText =
    (await successSummary.locator('xpath=..').locator('p').last().textContent()) ?? '';
  assert(
    successOutputText.trim().length > 10 &&
      !successOutputText.includes('recorded:') &&
      /[\u3400-\u9fff]/u.test(successOutputText),
    'Merchant did not receive a real Chinese BYOK output',
    { outputLength: successOutputText.length }
  );
  await page.screenshot({
    fullPage: true,
    path: path.join(outputDir, '05-merchant-real-chinese-output.png'),
  });
  const optionsAfterSuccess = await query('integrations', 'strict_byok_options');
  usageAfterSuccess = optionsAfterSuccess.body.data.usage;
  const auditAfterSuccess = await query('integrations', 'audit');
  const completedEvent = auditAfterSuccess.body.data.find(
    (event) => event.connectionId === validConnection.id && event.action === 'byok.completed'
  );
  assert(completedEvent, 'Completed BYOK audit event missing', auditAfterSuccess.body.data);
  const refreshedConnections = await query('integrations', 'connections');
  validConnection = refreshedConnections.body.data.find(
    (connection) => connection.id === validConnection.id
  );
  assert(
    validConnection?.status === 'available' &&
      validConnection.credential.status === 'active' &&
      validConnection.credential.lastUsedAt,
    'Successful connection did not become available and active',
    validConnection
  );
  assert(
    usageBefore.available - usageAfterSuccess.available === 1 &&
      usageAfterSuccess.committed - usageBefore.committed === 1,
    'Successful BYOK call did not commit exactly one copy unit',
    { usageAfterSuccess, usageBefore }
  );

  const replayPayload = {
    connectionId: validConnection.id,
    endpointProfileId: 'openai-compatible-default',
    catalogModelId: 'llm-custom',
    prompt: '只回复：BYOK 幂等验证通过',
  };
  const replayKey = `${runId}-same-provider-effect`;
  const replayFirst = await command(
    'integrations',
    'submit_strict_byok',
    replayPayload,
    replayKey
  );
  const replaySecond = await command(
    'integrations',
    'submit_strict_byok',
    replayPayload,
    replayKey
  );
  assert(
    replayFirst.status === 200 &&
      replayFirst.body.data.status === 'completed' &&
      replayFirst.body.data.output === replaySecond.body.data.output &&
      replayFirst.body.data.usage.available ===
        replaySecond.body.data.usage.available &&
      replayFirst.body.data.usage.status === replaySecond.body.data.usage.status &&
      replayFirst.body.data.routeSnapshot.id ===
        replaySecond.body.data.routeSnapshot.id,
    'BYOK idempotent replay failed',
    { firstStatus: replayFirst.status, secondStatus: replaySecond.status }
  );
  replayResult = replayFirst.body.data;
  usageAfterReplay = (await query('integrations', 'strict_byok_options')).body.data.usage;
  assert(
    usageAfterSuccess.available - usageAfterReplay.available === 1 &&
      usageAfterReplay.committed - usageAfterSuccess.committed === 1,
    'Replay produced more or less than one committed copy unit',
    { usageAfterReplay, usageAfterSuccess }
  );

  await page.locator('#integration-subject').fill('无效 BYOK 密钥');
  await page.locator('#integration-secret').fill('invalid-ticket-03-credential');
  await page.getByRole('button', { name: '创建连接' }).click();
  await page
    .getByText('无效 BYOK 密钥', { exact: true })
    .waitFor({ state: 'attached', timeout: 30_000 });
  invalidConnection = (await query('integrations', 'connections')).body.data.find(
    (connection) => connection.subject === '无效 BYOK 密钥'
  );
  assert(invalidConnection, 'Invalid BYOK connection missing');
  await page.locator('#byok-connection').selectOption(invalidConnection.id);
  await page.locator('#byok-model').selectOption('llm-custom');
  await page.locator('#byok-prompt').fill('这次调用必须被无效密钥拒绝。');
  await page.getByRole('button', { name: '使用密钥试用' }).click();
  await page
    .getByText(/结果：失败 · 产品额度 已退回/)
    .waitFor({ timeout: 180_000 });
  await page.screenshot({
    fullPage: true,
    path: path.join(outputDir, '06-invalid-key-refunded-needs-attention.png'),
  });
  usageAfterInvalid = (await query('integrations', 'strict_byok_options')).body.data.usage;
  const finalConnections = await query('integrations', 'connections');
  invalidConnection = finalConnections.body.data.find(
    (connection) => connection.id === invalidConnection.id
  );
  assert(
    invalidConnection?.status === 'permission_missing' &&
      invalidConnection.credential.status === 'unverified',
    'Invalid credential did not move to needs-attention state',
    invalidConnection
  );
  assert(
    usageAfterInvalid.available === usageAfterReplay.available &&
      usageAfterInvalid.committed === usageAfterReplay.committed,
    'Invalid credential changed committed or available quota',
    { usageAfterInvalid, usageAfterReplay }
  );
  auditEvents = (await query('integrations', 'audit')).body.data.filter(
    (event) => event.action.startsWith('byok.')
  );
  assert(
    auditEvents.some(
      (event) => event.connectionId === invalidConnection.id && event.action === 'byok.failed'
    ),
    'Failed BYOK audit event missing',
    auditEvents
  );

  const resultParagraph = page.getByText(/结果：失败 · 产品额度 已退回/);
  invalidResult = { visibleText: await resultParagraph.textContent() };
  const completedAudits = auditEvents.filter((event) => event.action === 'byok.completed');
  const replayAudits = completedAudits.filter(
    (event) => event.details.catalogModelId === 'llm-custom'
  );
  assert(replayAudits.length === 2, 'Idempotent replay created an extra audit event', {
    completedAuditCount: replayAudits.length,
  });

  successResult = {
    outputDigest: digest(successOutputText),
    outputLength: successOutputText.length,
    status: 'completed',
  };

  const evidence = {
    acceptance: {
      adminSelectedLiveWithoutCodeOrEnvEdit: true,
      invalidCredentialFailedAndRefunded: true,
      liveModeEffectiveAfterColdRestart: true,
      merchantCredentialRemainedWorkspaceOwned: true,
      merchantReceivedRealChineseOutput: true,
      replayReturnedSameResultWithoutSecondCommit: true,
      successfulCredentialBecameActiveAndUsed: true,
      uiStoppedShowingRecordedDemoLabel: true,
    },
    adminAssembly: {
      before: {
        effectiveValue: adminBefore.effectiveValue,
        revision: adminBefore.revision,
        storedValue: adminBefore.storedValue,
      },
      pending: {
        effectiveValue: adminPending.effectiveValue,
        revision: adminPending.revision,
        storedValue: adminPending.storedValue,
      },
      afterRestart: {
        effectiveValue: adminEffective.effectiveValue,
        revision: adminEffective.revision,
        storedValue: adminEffective.storedValue,
      },
    },
    auditEvents: auditEvents.map((event) => ({
      action: event.action,
      correlationId: event.correlationId,
      createdAt: event.createdAt,
      details: event.details,
    })),
    completedAt: new Date().toISOString(),
    connections: {
      invalid: {
        credentialStatus: invalidConnection.credential.status,
        credentialVersion: invalidConnection.credential.version,
        status: invalidConnection.status,
      },
      valid: {
        credentialLastUsedAt: validConnection.credential.lastUsedAt,
        credentialStatus: validConnection.credential.status,
        credentialVersion: validConnection.credential.version,
        status: validConnection.status,
      },
    },
    invalidResult,
    liveRuntime: {
      bindingCatalogModelId: 'llm-custom',
      endpointProfileId: 'openai-compatible-default',
      executionMode: 'live',
      providerModel,
    },
    redaction:
      'Credentials, cookies, raw generated output, workspace ids, connection ids, and provider request references are omitted from structured evidence. The browser media retains only masked inputs and merchant-visible output.',
    replay: {
      outputDigest: digest(replayResult.output),
      outputLength: replayResult.output.length,
      providerCostStatus: replayResult.providerCost.status,
      status: replayResult.status,
      usageStatus: replayResult.usage.status,
    },
    runId,
    successResult,
    timeline,
    usage: {
      afterInvalid: usageAfterInvalid,
      afterReplay: usageAfterReplay,
      afterSuccess: usageAfterSuccess,
      before: usageBefore,
    },
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
  const target = path.join(outputDir, 'continuous-byok-live-journey.webm');
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
