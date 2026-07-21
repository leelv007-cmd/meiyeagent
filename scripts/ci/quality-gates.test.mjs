import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const releaseCommitSha = 'a'.repeat(40);

async function runGate(scriptName) {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-ci-gate-'));
  const logPath = join(directory, 'commands.log');
  const commandStub = `#!/usr/bin/env bash
printf '%s' "$0" >> '${logPath}'
printf ' %s' "$@" >> '${logPath}'
printf '\\n' >> '${logPath}'
`;

  for (const command of ['node', 'pnpm']) {
    const path = join(directory, command);
    await writeFile(path, commandStub);
    await chmod(path, 0o755);
  }

  const result = spawnSync(
    '/bin/bash',
    [join(repositoryRoot, 'scripts/ci', scriptName)],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${directory}:/usr/bin:/bin`,
        RELEASE_COMMIT_SHA: releaseCommitSha,
      },
    }
  );

  assert.equal(result.status, 0, result.stderr);
  return (await readFile(logPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => line.replace(`${directory}/`, ''));
}

test('the ordinary PR gate runs every Web and Canvas fast check plus repository guards', async () => {
  assert.deepEqual(await runGate('run-web-canvas-quality.sh'), [
    'pnpm --filter @meiye/web check',
    'pnpm --filter @meiye/web typecheck',
    'pnpm --filter @meiye/web test',
    'pnpm --filter @meiye/web test:interaction',
    'pnpm --filter @meiye/canvas check',
    'pnpm --filter @meiye/canvas test',
    'node scripts/uiux/secret-scan.mjs',
    'node scripts/uiux/decision-ticket-guard.mjs',
  ]);
});

test('the release-candidate gate builds all workspaces before four-service E2E', async () => {
  assert.deepEqual(await runGate('run-release-candidate-quality.sh'), [
    `node scripts/production-network-boundary-gate.mjs --expected-commit-sha ${releaseCommitSha}`,
    'pnpm build',
    'pnpm --filter @meiye/web e2e',
  ]);
});

test('workflows wire fast, release-candidate, SCA, and provider-live gates', async () => {
  const coreQuality = await readFile(
    join(repositoryRoot, '.github/workflows/core-quality.yml'),
    'utf8'
  );
  const providerLive = await readFile(
    join(repositoryRoot, '.github/workflows/provider-live.yml'),
    'utf8'
  );

  assert.doesNotMatch(coreQuality, /^\s+(?:paths|paths-ignore):/m);
  assert.match(coreQuality, /bash scripts\/ci\/run-web-canvas-quality\.sh/);
  assert.match(coreQuality, /release-candidate/);
  assert.match(coreQuality, /pnpm audit --prod --json/);
  assert.match(coreQuality, /assert-production-audit\.mjs/);
  assert.match(coreQuality, /name: production-dependency-audit/);
  assert.match(
    coreQuality,
    /bash scripts\/ci\/run-release-candidate-quality\.sh/
  );
  assert.match(coreQuality, /RELEASE_COMMIT_SHA: \$\{\{ github\.sha \}\}/);
  assert.match(providerLive, /release:\n\s+types: \[published\]/);
  assert.match(providerLive, /workflow_dispatch:/);
  assert.match(providerLive, /schedule:/);
  assert.match(providerLive, /PROVIDER_LIVE_REQUIRE_ALL: '1'/);
});
