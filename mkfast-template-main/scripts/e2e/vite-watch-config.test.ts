import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import type { ConfigEnv, UserConfig } from 'vite';

import viteConfig from '../../vite.config';

const configEnv: ConfigEnv = {
  command: 'serve',
  isPreview: false,
  isSsrBuild: false,
  mode: 'e2e',
};

async function resolveServeConfig(): Promise<UserConfig> {
  assert.equal(typeof viteConfig, 'function');
  return viteConfig(configEnv);
}

test('the Vite watcher ignores only the project Playwright output tree', async () => {
  const config = await resolveServeConfig();
  assert.deepEqual(config.server?.allowedHosts, ['.trycloudflare.com']);

  const ignored = config.server?.watch?.ignored;
  assert.equal(typeof ignored, 'function');
  const isIgnored = ignored as (path: string) => boolean;
  const projectRoot = fileURLToPath(new URL('../..', import.meta.url));

  assert.equal(
    isIgnored(
      resolve(
        projectRoot,
        'output/playwright/run/.playwright-artifacts-0/traces/resources/a.html'
      )
    ),
    true
  );
  assert.equal(
    isIgnored(
      resolve(projectRoot, 'output/playwright/run/trace.zip').replaceAll(
        '/',
        '\\'
      )
    ),
    true
  );
  assert.equal(isIgnored(resolve(projectRoot, 'src/routes/index.tsx')), false);
  assert.equal(
    isIgnored(resolve(projectRoot, 'tests/e2e/specs/example.spec.ts')),
    false
  );
  assert.equal(
    isIgnored(resolve(projectRoot, 'test-results/example/trace.zip')),
    false
  );
  assert.equal(
    isIgnored(resolve(projectRoot, 'output/playwright-copy/trace.zip')),
    false
  );
  assert.equal(
    isIgnored(
      resolve(projectRoot, 'tests/fixtures/output/playwright/trace.zip')
    ),
    false
  );
  assert.equal(
    isIgnored(resolve(projectRoot, '../output/ci/v31/playwright.log')),
    false
  );
});
