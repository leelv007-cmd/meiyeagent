#!/usr/bin/env node
/**
 * Day-0 tour screenshot regression (V1 acceptance).
 *
 * Stations (same framing for before/after comparison):
 *   01-login → 02-seed-store → 03-inline-authorize → 04-create →
 *   05-stream-first-token → 06-assets → 07-mobile
 *
 * Usage (requires local Main+Core+Worker e2e stack, same as Playwright):
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3000 \
 *   node scripts/uiux/day0-tour-screenshots.mjs
 *
 * Optional env:
 *   DAY0_TOUR_OUT   default: docs/evidence/ux-fold-supply-day0/tours/<timestamp>
 *   DAY0_TOUR_LABEL default: after   (use "before" when capturing a baseline)
 *   E2E_SECRET      default: mkfast-e2e-secret
 *
 * Without a running stack this script exits non-zero after printing setup notes.
 * Screenshots never replace the Day-0 e2e assertions in
 * mkfast-template-main/tests/e2e/specs/uiux-day0-contract.spec.ts.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const E2E_SECRET = process.env.E2E_SECRET ?? 'mkfast-e2e-secret';
const LABEL = process.env.DAY0_TOUR_LABEL ?? 'after';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const OUT =
  process.env.DAY0_TOUR_OUT ??
  join(REPO_ROOT, 'docs/evidence/ux-fold-supply-day0/tours', `${LABEL}-${stamp}`);

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

const stations = [];

async function shot(page, name, note) {
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ fullPage: true, path: file });
  stations.push({ file, name, note, url: page.url() });
  console.log(`  ✓ ${name}: ${note}`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log(`Day-0 tour → ${OUT}`);
  console.log(`Base URL: ${BASE_URL}`);

  // Health probe — fail fast with setup docs when stack is down.
  try {
    const health = await fetch(`${BASE_URL}/api/ping`);
    if (!health.ok) throw new Error(`ping ${health.status}`);
  } catch (error) {
    const guide = [
      'Day-0 tour could not reach the app.',
      `  BASE_URL=${BASE_URL}`,
      `  error=${error instanceof Error ? error.message : String(error)}`,
      '',
      'Start the local e2e stack first (same as Playwright webServer):',
      '  1. Provision Postgres (scripts/ci/provision-test-db.sh or compose)',
      '  2. pnpm --filter @meiye/core start  (+ start:worker)',
      '  3. pnpm --filter @meiye/web dev',
      '  4. Re-run: node scripts/uiux/day0-tour-screenshots.mjs',
      '',
      'Evidence layout (manual before/after drop-in also OK):',
      '  docs/evidence/ux-fold-supply-day0/before/',
      '  docs/evidence/ux-fold-supply-day0/after/',
      '  docs/evidence/ux-fold-supply-day0/tours/',
    ].join('\n');
    await writeFile(join(OUT, 'SETUP.md'), `${guide}\n`, 'utf8');
    console.error(guide);
    process.exitCode = 1;
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { height: 900, width: 1280 } });
  const runId = `day0-tour-${Date.now()}`;
  const user = {
    email: `e2e-${runId}@example.test`,
    name: 'Day0 Tour Store',
    password: `Tour-${runId}!Aa`,
  };

  try {
    // 01 login/register surface
    await page.goto(`${BASE_URL}/auth/register`, { waitUntil: 'networkidle' });
    await shot(page, '01-register', 'Register surface');

    await page.locator('input[name="name"]').fill(user.name);
    await page.locator('input[name="email"]').fill(user.email);
    await page.locator('input[name="password"]').fill(user.password);
    await page.getByRole('button', { name: /sign up|注册|创建账户/i }).click();
    await page.waitForTimeout(800);

    // Mark verified via e2e API when available.
    const verification = await fetch(`${BASE_URL}/api/e2e/users`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-e2e-secret': E2E_SECRET,
      },
      body: JSON.stringify({
        email: user.email,
        emailVerified: true,
        role: 'user',
      }),
    });
    if (!verification.ok) {
      throw new Error(`e2e verification failed: ${verification.status}`);
    }

    if (new URL(page.url()).pathname !== '/dashboard') {
      await page.goto(`${BASE_URL}/auth/login`, { waitUntil: 'networkidle' });
      if (new URL(page.url()).pathname !== '/dashboard') {
        await page.locator('input[name="email"]').fill(user.email);
        await page.locator('input[name="password"]').fill(user.password);
        await page.getByRole('button', { name: /sign in|登录/i }).click();
      }
    }
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
    await shot(page, '02-dashboard-empty', 'Post-login dashboard (Day-0 shell)');

    // 02 seed store via product command
    await page.evaluate(async () => {
      const response = await fetch('/api/core/product/commands', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `tour-store-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          type: 'confirm_store',
          store: {
            accounts: [],
            address: '湖墅南路 88 号',
            booking: '提前一天预约',
            brandVoice: '专业、克制、像熟客推荐',
            city: '杭州',
            district: '拱墅区',
            name: 'Tour 美业门店',
            prohibitions: ['不虚构价格'],
            projects: [
              {
                confirmed: true,
                durationMinutes: 90,
                id: 'project-tour',
                name: '透亮猫眼',
                price: 299,
              },
            ],
            regulated: false,
          },
        }),
      });
      if (!response.ok) {
        throw new Error(`confirm_store failed: ${response.status}`);
      }
    });
    await page.reload({ waitUntil: 'networkidle' });
    await shot(page, '03-seed-store', 'Store facts seeded');

    // 03 inline authorize (composer path)
    const gallery = page.locator('#composer-gallery-input');
    if ((await gallery.count()) !== 1) {
      throw new Error('composer gallery input is missing');
    }
    await gallery.setInputFiles({
      buffer: PNG_1X1,
      mimeType: 'image/png',
      name: `tour-inline-${runId}.png`,
    });
    const yes = page.getByRole('button', {
      name: /确认：允许公开宣传|Confirm public use|是，可用于公开宣传/,
    });
    const usesLegacyAssetForm = LABEL === 'before' && (await yes.count()) === 0;
    if (usesLegacyAssetForm) {
      await shot(
        page,
        '04-inline-authorize',
        'Baseline multi-field asset authorization before the one-click fold'
      );
      await page.getByLabel('这是什么素材？').selectOption('store');
      for (const question of [
        '画面里有人吗？',
        '有手机号、聊天截图等隐私吗？',
        '有未成年人吗？',
      ]) {
        await page
          .locator('fieldset')
          .filter({ hasText: question })
          .getByRole('button', { name: '否' })
          .click();
      }
      await page.getByRole('button', { name: '可用于公开营销' }).click();
      await page
        .getByLabel('授权凭证编号或存档位置')
        .fill(`tour-baseline:${runId}`);
      await page.getByRole('button', { name: '确认并上传' }).click();
    } else {
      await yes.waitFor({ state: 'visible', timeout: 30_000 });
      await yes.click();
    }
    await page
      .getByText(/已保存到素材库|素材信息已确认/)
      .first()
      .waitFor({ timeout: 60_000 });
    if (!usesLegacyAssetForm) {
      await shot(
        page,
        '04-inline-authorize',
        'Composer inline one-click authorize'
      );
    }

    // 04 create
    const intent = page.getByLabel(/描述这次想创作的内容|Describe/);
    if ((await intent.count()) !== 1) {
      throw new Error('composer intent input is missing');
    }
    await intent.fill('Tour：为透亮猫眼写一条到店种草');
    const submit = page.getByRole('button', {
      name: /开始创作|建立创作记录|Start creating/,
    });
    if (!(await submit.isEnabled())) {
      throw new Error('composer submit is disabled after seed preparation');
    }
    await submit.click();
    await page.waitForTimeout(2_000);
    await shot(page, '05-create-stream', 'Create → stream surface');

    if (LABEL === 'before') {
      const confirmBrief = page.getByRole('button', {
        name: /采用并确认 Brief|Adopt and confirm Brief/,
      });
      if (await confirmBrief.isVisible()) {
        await confirmBrief.click();
        const legacyGenerate = page.getByRole('button', {
          name: /生成并预览|Generate and preview/,
        });
        await legacyGenerate.waitFor({ state: 'visible', timeout: 30_000 });
        await legacyGenerate.click();
      }
    }

    // 05 first token is a hard station. A pending screenshot is not evidence.
    if (LABEL === 'before') {
      const legacyDraft = page
        .locator(
          '[data-testid="workbench-result-stream"], [data-testid="workbench-result-hero"]'
        )
        .first();
      await legacyDraft.waitFor({ state: 'visible', timeout: 90_000 });
      await shot(
        page,
        '06-first-token',
        'Baseline draft surface visible (base predates the token marker)'
      );
    } else {
      const token = page.locator('[data-has-token="true"]').first();
      await token.waitFor({ state: 'visible', timeout: 90_000 });
      await shot(page, '06-first-token', 'First usable draft token visible');
    }

    // 06 assets
    await page.goto(`${BASE_URL}/dashboard/assets`, {
      waitUntil: 'networkidle',
    });
    await shot(page, '07-assets', 'Assets library');

    // 07 mobile viewport
    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle' });
    await shot(page, '08-mobile-dashboard', 'Mobile dashboard 390×844');

    const manifest = {
      baseUrl: BASE_URL,
      label: LABEL,
      out: OUT,
      stations,
      user: { email: user.email },
      generatedAt: new Date().toISOString(),
    };
    await writeFile(
      join(OUT, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8'
    );
    console.log(`Wrote ${stations.length} stations + manifest.json`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
