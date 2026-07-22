import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const releaseCommitSha = 'a'.repeat(40);

async function runGate(scriptName, environment = {}, expectedStatus = 0) {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-ci-gate-'));
  const logPath = join(directory, 'commands.log');
  const commandStub = `#!/usr/bin/env bash
printf '%s' "$0" >> '${logPath}'
printf ' %s' "$@" >> '${logPath}'
printf '\\n' >> '${logPath}'
if [[ "\${CI_STUB_FAIL_COMMAND:-}" == "\${0##*/} $*" ]]; then
  exit 23
fi
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
        ...environment,
        CI_EVIDENCE_DIR: join(directory, 'evidence'),
        PATH: `${directory}:/usr/bin:/bin`,
        RELEASE_COMMIT_SHA: releaseCommitSha,
      },
    }
  );

  assert.equal(result.status, expectedStatus, result.stderr);
  return (await readFile(logPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => line.replace(`${directory}/`, ''));
}

test('the ordinary PR gate runs every Web and Canvas fast check plus repository guards', async () => {
  assert.deepEqual(await runGate('run-web-canvas-quality.sh'), [
    'pnpm --filter @meiye/web build',
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

test('the root required gate captures every root command and explicit security artifact', async () => {
  const expectedCommands = [
    'pnpm typecheck',
    'pnpm build',
    'pnpm test',
    'pnpm --filter @meiye/web test:interaction',
    'pnpm check',
    'node scripts/uiux/secret-scan.mjs',
    'node scripts/uiux/bundle-budget.mjs',
  ];
  assert.deepEqual(
    await runGate('run-root-required-quality.sh'),
    expectedCommands
  );
  assert.deepEqual(
    await runGate(
      'run-root-required-quality.sh',
      { CI_STUB_FAIL_COMMAND: 'pnpm test' },
      1
    ),
    expectedCommands
  );
});

test('the ordinary PR production journey is fixed to one provider-free candidate path', async () => {
  assert.deepEqual(await runGate('run-pr-production-journey.sh'), [
    `node scripts/production-network-boundary-gate.mjs --expected-commit-sha ${releaseCommitSha}`,
    'pnpm --filter @meiye/web exec playwright test tests/e2e/specs/marketing-identity-flow.spec.ts',
  ]);

  const script = await readFile(
    join(repositoryRoot, 'scripts/ci/run-pr-production-journey.sh'),
    'utf8'
  );
  assert.match(script, /PLAYWRIGHT_PRODUCTION_CANDIDATE=true/);
  assert.match(script, /PLAYWRIGHT_PROVIDER_FREE=true/);
  assert.match(script, /MODEL_EXECUTION_MODE=fixture/);
  assert.doesNotMatch(script, /API_KEY|PROVIDER_LIVE|STRIPE_SECRET_KEY/);
});

test('the provider-free production candidate removes every commerce setting', () => {
  const result = spawnSync(
    'pnpm',
    [
      '--filter',
      '@meiye/web',
      'exec',
      'tsx',
      '-e',
      "import config from './playwright.config.ts'; const servers = Array.isArray(config.webServer) ? config.webServer : [config.webServer]; process.stdout.write(servers.map((server) => server?.command ?? '').join('\\n'));",
    ],
    {
      cwd: join(repositoryRoot, 'mkfast-template-main'),
      encoding: 'utf8',
      env: {
        ...process.env,
        PLAYWRIGHT_PRODUCTION_CANDIDATE: 'true',
        PLAYWRIGHT_PROVIDER_FREE: 'true',
      },
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /pnpm build/u);
  assert.match(result.stdout, /MODEL_EXECUTION_MODE=fixture/u);
  assert.doesNotMatch(
    result.stdout,
    /stripe|pro_studio|paid_launch|checkout|payment_provider/iu
  );
});

test('the root typecheck prepares Web generated content before checking every workspace', async () => {
  assert.deepEqual(await runGate('run-root-typecheck.sh'), [
    'pnpm --filter @meiye/contracts typecheck',
    'pnpm --filter @meiye/core typecheck',
    'pnpm --filter @meiye/canvas typecheck',
    'pnpm --filter @meiye/web build',
    'pnpm --filter @meiye/web typecheck',
  ]);
});

test('Biome checks authored Canvas sources while excluding only byte-exact vendor copies', async () => {
  const rootBiome = JSON.parse(
    await readFile(join(repositoryRoot, 'biome.json'), 'utf8')
  );

  assert.deepEqual(rootBiome.files?.includes, [
    '**',
    '!apps/canvas/src/vendor/vozeb',
  ]);
});

test('the persistence gate uses Node test output before asserting database execution', async () => {
  assert.deepEqual(
    await runGate('run-core-persistence.sh', {
      CORE_PERSISTENCE_LOG_PATH: '/dev/null',
      TEST_DATABASE_URL: 'postgres://business.example.test/business',
      TEST_DBOS_SYSTEM_DATABASE_URL: 'postgres://dbos.example.test/dbos',
    }),
    [
      'pnpm --filter @meiye/core exec node --import tsx --test --test-concurrency=1 --test-reporter=spec src/**/*.test.ts',
      'node scripts/ci/assert-core-persistence-ran.mjs /dev/null',
    ]
  );
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
  assert.match(coreQuality, /^ {2}root-quality:/m);
  assert.match(coreQuality, /bash scripts\/ci\/run-root-required-quality\.sh/);
  assert.match(coreQuality, /^ {2}production-main-journey:/m);
  assert.match(coreQuality, /PLAYWRIGHT_PRODUCTION_CANDIDATE: true/);
  assert.match(coreQuality, /bash scripts\/ci\/run-pr-production-journey\.sh/);
  assert.match(coreQuality, /^ {2}required:/m);
  assert.match(coreQuality, /if: \$\{\{ always\(\) \}\}/);
  assert.match(coreQuality, /needs\.redline-evals\.result/);
  assert.match(coreQuality, /needs\.core\.result/);
  assert.match(coreQuality, /needs\.root-quality\.result/);
  assert.match(coreQuality, /needs\.core-persistence\.result/);
  assert.match(coreQuality, /needs\.production-main-journey\.result/);
  assert.match(coreQuality, /node scripts\/ci\/assert-required-jobs\.mjs/);
  for (const artifactName of [
    'root-required-quality-evidence',
    'core-persistence-evidence',
    'production-main-journey-evidence',
  ]) {
    assert.match(coreQuality, new RegExp(`name: ${artifactName}`));
  }
  assert.match(coreQuality, /if-no-files-found: error/);
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
  assert.match(providerLive, /PROVIDER_LIVE_COST_CAP_CNY:/);
  assert.doesNotMatch(providerLive, /PROVIDER_LIVE_COST_CAP_USD/);
  assert.doesNotMatch(providerLive, /PROVIDER_LIVE_CNY_PER_USD/);
  assert.doesNotMatch(providerLive, /PROVIDER_LIVE_FX_EVIDENCE_REF/);
  assert.match(providerLive, /PROVIDER_LIVE_ACCEPTANCE_MODE: primary_connectivity/);
  assert.match(providerLive, /PROVIDER_LIVE_RELEASE_REF: \$\{\{ github\.sha \}\}/);
  assert.match(providerLive, /PROVIDER_LIVE_ENVIRONMENT: provider-live/);
  assert.match(providerLive, /PROVIDER_LIVE_EVIDENCE_DIR: provider-live-evidence/);
  assert.match(
    providerLive,
    /ARK_SEEDANCE_MODEL: doubao-seedance-2-0-mini-260615/,
  );
  assert.doesNotMatch(
    providerLive,
    /PROVIDER_LIVE_EVIDENCE_DIR: apps\/core\/provider-live-evidence/
  );
  assert.match(
    providerLive,
    /PROVIDER_LIVE_CONFIG_REVISION: \$\{\{ vars\.PROVIDER_LIVE_CONFIG_REVISION \}\}/
  );
  assert.match(providerLive, /name: Initialize redacted live evidence/);
  assert.match(providerLive, /status: 'preflight_pending'/);
  assert.match(providerLive, /name: Provider live preflight/);
  assert.ok(
    providerLive.indexOf('name: Initialize redacted live evidence') <
      providerLive.indexOf('name: Provider live preflight')
  );
});
