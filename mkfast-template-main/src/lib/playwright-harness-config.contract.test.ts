import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { productionJourneyGlobalTimeout } from '../../playwright.config.js';

test('only the required CI production journey has a bounded global runtime', () => {
  assert.equal(
    productionJourneyGlobalTimeout({
      CI: 'true',
      PLAYWRIGHT_PRODUCTION_CANDIDATE: 'true',
    }),
    60 * 60_000
  );
  assert.equal(productionJourneyGlobalTimeout({ CI: 'true' }), undefined);
  assert.equal(
    productionJourneyGlobalTimeout({
      PLAYWRIGHT_PRODUCTION_CANDIDATE: 'true',
    }),
    undefined
  );
});

test('Playwright provisions an isolated DBOS database and enables the real Harness runtime', async () => {
  const [config, provisioner] = await Promise.all([
    readFile(resolve(process.cwd(), 'playwright.config.ts'), 'utf8'),
    readFile(
      resolve(process.cwd(), '../scripts/ci/provision-test-db.sh'),
      'utf8'
    ),
  ]);

  assert.match(config, /_playwright_\$\{corePort\}_\$\{process\.pid\}/u);
  assert.match(config, /scripts\/ci\/provision-test-db\.sh/u);
  assert.match(config, /RUN_ISSUE_247_E2E_PROVISIONAL_BOUNDS_SEED: 'true'/u);
  assert.match(provisioner, /seed-issue-247-e2e-provisional-bounds\.mts/u);
  assert.doesNotMatch(
    config,
    /pnpm db:migrate:local/u,
    'the authoritative provision step must be the only migration apply path'
  );
  assert.equal(
    config.match(/HARNESS_DBOS_SYSTEM_DATABASE_URL: dbosSystemDatabaseURL/gu)
      ?.length,
    2,
    'core and the P1 worker must share the DBOS system database'
  );
  assert.match(config, /DBOS__VMID: `core-e2e-\$\{corePort\}`/u);
  assert.match(config, /DBOS__VMID: `p1-worker-e2e-\$\{corePort\}`/u);
  assert.equal(
    config.match(/LANGFUSE_PROMPT_POLICY: 'pilot'/gu)?.length,
    2,
    'provider-free Core and Worker fixtures must explicitly opt into warned prompt fallback'
  );
  for (const key of [
    'LANGFUSE_BASE_URL',
    'LANGFUSE_PUBLIC_KEY',
    'LANGFUSE_SECRET_KEY',
    'LANGFUSE_PROMPT_VERSIONS',
  ]) {
    assert.equal(
      config.match(new RegExp(`${key}: ''`, 'gu'))?.length,
      2,
      `provider-free Core and Worker fixtures must clear inherited ${key}`
    );
  }
  assert.match(config, /MODEL_EXECUTION_MODE: 'fixture'/u);
  assert.equal(config.match(/JOB_QUEUE_PREFIX: jobQueuePrefix/gu)?.length, 3);
  // Four services after Pro Studio / Canvas retirement (no canvas webServer).
  assert.equal(config.match(/scripts\/e2e\/run-service\.mjs/gu)?.length, 3);
  assert.equal(
    config.match(/scripts\/e2e\/run-wrangler-service\.mjs/gu)?.length,
    1
  );
  assert.equal(config.match(/gracefulShutdown:/gu)?.length, 4);
  assert.match(
    config,
    /url: authBaseURL,[\s\S]*?timeout: 300_000,/u,
    'the Web server startup gate must allow the cold locale compile to finish'
  );
});

test('Playwright service wrapper terminates the complete child process group', async () => {
  const wrapper = resolve(process.cwd(), 'scripts/e2e/run-service.mjs');
  const childSource = [
    "const { spawn } = require('node:child_process');",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);",
    "console.log('GRANDCHILD:' + child.pid);",
    'setInterval(() => {}, 1000);',
  ].join('');
  const service = spawn(
    process.execPath,
    [wrapper, process.execPath, '-e', childSource],
    {
      stdio: ['ignore', 'pipe', 'inherit'],
    }
  );
  const grandchildPid = await new Promise<number>((resolvePid, reject) => {
    const timeout = setTimeout(
      () =>
        reject(new Error('service fixture did not expose its grandchild pid')),
      5_000
    );
    service.stdout.setEncoding('utf8');
    service.stdout.on('data', (chunk) => {
      const match = /GRANDCHILD:(\d+)/u.exec(chunk);
      if (!match) return;
      clearTimeout(timeout);
      resolvePid(Number(match[1]));
    });
  });

  service.kill('SIGTERM');
  await new Promise<void>((resolveExit, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('service wrapper did not terminate')),
      5_000
    );
    service.once('exit', () => {
      clearTimeout(timeout);
      resolveExit();
    });
  });
  await assert.rejects(
    async () => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        process.kill(grandchildPid, 0);
        await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      }
    },
    (error: unknown) =>
      error instanceof Error && 'code' in error && error.code === 'ESRCH'
  );
});
