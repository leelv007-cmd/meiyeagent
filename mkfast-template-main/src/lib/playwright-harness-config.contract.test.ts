import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

test('Playwright provisions an isolated DBOS database and enables the real Harness runtime', async () => {
  const config = await readFile(
    resolve(process.cwd(), 'playwright.config.ts'),
    'utf8'
  );

  assert.match(config, /_playwright_\$\{corePort\}_\$\{process\.pid\}/u);
  assert.match(config, /scripts\/ci\/provision-test-db\.sh/u);
  assert.match(config, /HARNESS_DBOS_SYSTEM_DATABASE_URL/u);
  assert.match(config, /MODEL_EXECUTION_MODE=fixture/u);
});
