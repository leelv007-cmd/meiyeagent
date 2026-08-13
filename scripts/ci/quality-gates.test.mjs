import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const releaseCommitSha = 'a'.repeat(40);

// V3.1 §37.4 A–K plus the artifact and goal/proactive journeys. The gate names
// every spec explicitly, so a journey whose file has not landed keeps CI red.
const v31AcceptanceSpecs = [
  'tests/e2e/specs/v31-day0-free-creation-journey.spec.ts',
  'tests/e2e/specs/v31-level1-copy-journey.spec.ts',
  'tests/e2e/specs/v31-memory-injection-b2-journey.spec.ts',
  'tests/e2e/specs/v31-living-plan-journey.spec.ts',
  'tests/e2e/specs/v31-video-paid-execution-journey.spec.ts',
  'tests/e2e/specs/v31-context-fence-journey.spec.ts',
  'tests/e2e/specs/v31-rights-revocation-journey.spec.ts',
  'tests/e2e/specs/v31-mid-run-steering-journey.spec.ts',
  'tests/e2e/specs/v31-interrupt-resume-journey.spec.ts',
  'tests/e2e/specs/v31-thread-root-workbench.spec.ts',
  'tests/e2e/specs/v31-ops-console-release-journey.spec.ts',
  'tests/e2e/specs/v31-publish-handoff-selfreport.spec.ts',
  'tests/e2e/specs/v31-artifact-growth-journey.spec.ts',
  'tests/e2e/specs/v31-goal-proactive-idle.spec.ts',
  'tests/e2e/specs/v31-partial-resume-assisted-journey.spec.ts',
  'tests/e2e/specs/v31-zero-source-image-text-first-visit.spec.ts',
];

async function stageV31SpecTree(presentSpecs) {
  const stagedRoot = await mkdtemp(join(tmpdir(), 'meiye-v31-specs-'));
  for (const spec of presentSpecs) {
    const target = join(stagedRoot, 'mkfast-template-main', spec);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, '');
  }
  return stagedRoot;
}

async function runGate(
  scriptName,
  environment = {},
  expectedStatus = 0,
  cwd = repositoryRoot
) {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-ci-gate-'));
  const logPath = join(directory, 'commands.log');
  const evidenceDirectory = join(directory, 'evidence');
  if (environment.CI_STUB_PRECREATE_EVIDENCE_BATCH) {
    await mkdir(
      join(evidenceDirectory, environment.CI_STUB_PRECREATE_EVIDENCE_BATCH),
      { recursive: true }
    );
  }
  const commandStub = `#!/bin/bash
printf '%s' "$0" >> '${logPath}'
printf ' %s' "$@" >> '${logPath}'
printf '\\n' >> '${logPath}'
if [[ "\${CI_STUB_FAIL_COMMAND:-}" == "\${0##*/} $*" ]]; then
  exit 23
fi
if [[ -n "\${CI_STUB_FAIL_SUBSTRING:-}" && "\${0##*/} $*" == *"\${CI_STUB_FAIL_SUBSTRING}"* ]]; then
  exit 23
fi
`;

  for (const command of ['bash', 'node', 'pnpm']) {
    const path = join(directory, command);
    await writeFile(path, commandStub);
    await chmod(path, 0o755);
  }

  const result = spawnSync(
    '/bin/bash',
    [join(repositoryRoot, 'scripts/ci', scriptName)],
    {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...environment,
        CI_EVIDENCE_DIR: evidenceDirectory,
        PATH: `${directory}:/usr/bin:/bin`,
        RELEASE_COMMIT_SHA: releaseCommitSha,
      },
    }
  );

  assert.equal(result.status, expectedStatus, result.stderr);
  if (!existsSync(logPath)) {
    return [];
  }
  return (await readFile(logPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) =>
      [directory, directory.replace(/^\/private/u, '')].reduce(
        (normalized, temporaryDirectory) =>
          normalized.replace(`${temporaryDirectory}/`, ''),
        line
      )
    );
}

test('the ordinary PR gate runs every Web and Canvas fast check plus repository guards', async () => {
  assert.deepEqual(await runGate('run-web-canvas-quality.sh'), [
    'pnpm --filter @meiye/web build',
    'pnpm --filter @meiye/web check',
    'pnpm --filter @meiye/web typecheck',
    'pnpm --filter @meiye/web test',
    'pnpm --filter @meiye/web test:interaction',
    'node scripts/uiux/secret-scan.mjs',
    'node scripts/uiux/decision-ticket-guard.mjs',
  ]);
});

test('the root required gate captures every root command and explicit security artifact', async () => {
  const expectedCommands = [
    'node scripts/ci/assert-suite-owner-manifest.mjs',
    'pnpm typecheck',
    'pnpm build',
    'pnpm test',
    'pnpm test:journeys',
    'pnpm --filter @meiye/web test:interaction',
    'pnpm --filter @meiye/web check',
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

test('the ordinary PR production journey isolates three provider-free candidate batches', async () => {
  // M-04: the browser hard gate rides this job, so the mainline journey spec is
  // part of the ordinary PR run — not a spec that exists without running.
  assert.deepEqual(await runGate('run-pr-production-journey.sh'), [
    `node scripts/production-network-boundary-gate.mjs --expected-commit-sha ${releaseCommitSha}`,
    'pnpm --filter @meiye/web exec playwright test tests/e2e/specs/assembly-gate-required-journey.spec.ts tests/e2e/specs/m04-browser-hard-gate.spec.ts tests/e2e/specs/marketing-identity-flow.spec.ts --retries=0 --trace=retain-on-failure --output=evidence/mainline/test-results',
    'pnpm --filter @meiye/web exec playwright test tests/e2e/specs/w12-identity-draft-assistant.spec.ts tests/e2e/specs/xhs-image-text-main-journey.spec.ts tests/e2e/specs/v31-memory-injection-b2-journey.spec.ts --retries=0 --trace=retain-on-failure --output=evidence/composer/test-results',
    'pnpm --filter @meiye/web exec playwright test tests/e2e/specs/memory-vault-governance.spec.ts tests/e2e/specs/v31-thread-root-workbench.spec.ts tests/e2e/specs/campaign-paid-work-confirmation.spec.ts --retries=0 --trace=retain-on-failure --output=evidence/governance/test-results',
  ]);

  const script = await readFile(
    join(repositoryRoot, 'scripts/ci/run-pr-production-journey.sh'),
    'utf8'
  );
  assert.match(script, /PLAYWRIGHT_PRODUCTION_CANDIDATE=true/);
  assert.match(script, /PLAYWRIGHT_PROVIDER_FREE=true/);
  assert.match(script, /MODEL_EXECUTION_MODE=fixture/);
  assert.match(script, /E2E_SERVICE_MAX_RESTARTS=0/);
  assert.match(script, /xhs-image-text-main-journey\.spec\.ts/);
  assert.match(script, /v31-memory-injection-b2-journey\.spec\.ts/);
	assert.doesNotMatch(script, /v31-artifact-composer-sse-workbench\.journey\.test\.ts/);
	assert.match(script, /v31-thread-root-workbench\.spec\.ts/);
  assert.match(script, /campaign-paid-work-confirmation\.spec\.ts/);
  assert.doesNotMatch(script, /API_KEY|PROVIDER_LIVE|STRIPE_SECRET_KEY/);

  const productionSpecs = Array.from(
    script.matchAll(/tests\/e2e\/specs\/[a-z0-9-]+\.spec\.ts/gu),
    ([spec]) => spec
  );
  assert.equal(new Set(productionSpecs).size, 9);
  assert.equal(productionSpecs.length, 9);

	const artifactBrowserJourney = await readFile(
	  join(
		repositoryRoot,
		'mkfast-template-main/tests/e2e/specs/xhs-image-text-main-journey.spec.ts'
	  ),
	  'utf8'
	);
	assert.match(
	  artifactBrowserJourney,
	  /test\.describe\([\s\S]*?test\.use\(\{\s*serviceWorkers:\s*'block'\s*\}\);/u
	);
	assert.match(artifactBrowserJourney, /e2eAgentFault/u);
	assert.match(
	  artifactBrowserJourney,
	  /x-meiye-e2e-agent-fault-applied/u
	);
	assert.match(
	  artifactBrowserJourney,
	  /page\.route\(\s*'\*\*\/api\/core\/p1\/agent-threads\/\*\/replay\*\*'/u
	);
	assert.match(
	  artifactBrowserJourney,
	  /page\.route\(\s*'\*\*\/api\/core\/p1\/agent-threads\/\*\/events\*\*'/u
	);
	assert.match(
	  artifactBrowserJourney,
	  /expect\(streamFaultProbe\.appliedReceiptCount\)\.toBe\(1\)/u
	);
	assert.match(
	  artifactBrowserJourney,
	  /expect\(replayFaultProbe\.appliedReceiptCount\)\.toBe\(1\)/u
	);
	assert.doesNotMatch(artifactBrowserJourney, /route\.fulfill/u);
  assert.doesNotMatch(artifactBrowserJourney, /page\.reload/u);

  assert.equal(
    (
      await runGate(
        'run-pr-production-journey.sh',
        { CI_STUB_FAIL_SUBSTRING: 'xhs-image-text-main-journey.spec.ts' },
        23
      )
    ).length,
    3
  );
  assert.deepEqual(
    await runGate(
      'run-pr-production-journey.sh',
      { CI_STUB_PRECREATE_EVIDENCE_BATCH: 'mainline' },
      2
    ),
    []
  );

  assert.deepEqual(await runGate('run-p2-browser-acceptance.sh'), [
    `node scripts/production-network-boundary-gate.mjs --expected-commit-sha ${releaseCommitSha}`,
    'pnpm --filter @meiye/web exec playwright test tests/e2e/specs/image-text-note-compiler.spec.ts tests/e2e/specs/viral-adapt-opencli-gate.spec.ts tests/e2e/specs/p2-browser-closure.spec.ts tests/e2e/specs/admin-sensitive-words.spec.ts tests/e2e/specs/composer-card-family.spec.ts tests/e2e/specs/v31-ops-console-release-journey.spec.ts',
  ]);

  const p2Script = await readFile(
    join(repositoryRoot, 'scripts/ci/run-p2-browser-acceptance.sh'),
    'utf8'
  );
  // Fixture vite only — do not force production-candidate (see script comment).
  assert.doesNotMatch(p2Script, /export PLAYWRIGHT_PRODUCTION_CANDIDATE=true/);
  assert.match(p2Script, /PLAYWRIGHT_PROVIDER_FREE=true/);
  assert.match(p2Script, /MODEL_EXECUTION_MODE=fixture/);
  assert.match(p2Script, /p2-browser-closure\.spec\.ts/);
  assert.match(p2Script, /v31-ops-console-release-journey\.spec\.ts/);
  assert.doesNotMatch(p2Script, /API_KEY|PROVIDER_LIVE|STRIPE_SECRET_KEY/);

  const v31Script = await readFile(
    join(repositoryRoot, 'scripts/ci/run-v31-browser-acceptance.sh'),
    'utf8'
  );
  assert.match(v31Script, /PLAYWRIGHT_PROVIDER_FREE=true/);
  assert.match(v31Script, /MODEL_EXECUTION_MODE=fixture/);
  assert.doesNotMatch(v31Script, /API_KEY|PROVIDER_LIVE|STRIPE_SECRET_KEY/);
  assert.doesNotMatch(v31Script, /v31-memory-injection-journey\.spec\.ts/);
  assert.equal(
    v31Script.match(/v31-memory-injection-b2-journey\.spec\.ts/gu)?.length,
    1
  );
  assert.doesNotMatch(v31Script, /receipt\/风格/u);
});

test('the V3.1 browser gate runs every named §37.4 journey spec', async () => {
  assert.equal(
    new Set(v31AcceptanceSpecs).size,
    v31AcceptanceSpecs.length,
    'A–K browser mapping must list each required journey exactly once',
  );
  const stagedRoot = await stageV31SpecTree(v31AcceptanceSpecs);

  assert.deepEqual(
    await runGate('run-v31-browser-acceptance.sh', {}, 0, stagedRoot),
    [
      `node scripts/production-network-boundary-gate.mjs --expected-commit-sha ${releaseCommitSha}`,
      `pnpm --filter @meiye/web exec playwright test ${v31AcceptanceSpecs.join(
        ' '
      )}`,
    ]
  );
});

test('the V3.1 browser gate fails closed when a journey spec is absent', async () => {
  for (const absentSpec of v31AcceptanceSpecs) {
    const stagedRoot = await stageV31SpecTree(
      v31AcceptanceSpecs.filter((spec) => spec !== absentSpec)
    );

    const result = spawnSync(
      '/bin/bash',
      [join(repositoryRoot, 'scripts/ci/run-v31-browser-acceptance.sh')],
      {
        cwd: stagedRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          CI_EVIDENCE_DIR: join(stagedRoot, 'evidence'),
          RELEASE_COMMIT_SHA: releaseCommitSha,
        },
      }
    );

    assert.equal(result.status, 1, `${absentSpec} did not fail the gate`);
    assert.match(result.stderr, new RegExp(`missing 1 required spec`, 'u'));
    assert.match(result.stderr, new RegExp(absentSpec.replace(/\./gu, '\\.')));
    assert.equal(
      await readFile(join(stagedRoot, 'evidence/missing-specs.log'), 'utf8'),
      result.stderr
    );
  }
});

test('every V3.1 spec in the repository is registered in the required gate', async () => {
  const specFiles = await readdir(
    join(repositoryRoot, 'mkfast-template-main/tests/e2e/specs')
  );
  const repositoryV31Specs = specFiles
    .filter((file) => file.startsWith('v31-') && file.endsWith('.spec.ts'))
    .map((file) => `tests/e2e/specs/${file}`);

  const unregistered = repositoryV31Specs.filter(
    (spec) => !v31AcceptanceSpecs.includes(spec)
  );
  assert.deepEqual(
    unregistered,
    [],
    'add new V3.1 specs to run-v31-browser-acceptance.sh and TEST-CATALOG.md'
  );
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
    'pnpm --filter @meiye/web build',
    'pnpm --filter @meiye/web typecheck',
    'pnpm typecheck:journeys',
  ]);
});

test('Biome checks authored Canvas sources while excluding only byte-exact vendor copies', async () => {
  const rootBiome = JSON.parse(
    await readFile(join(repositoryRoot, 'biome.json'), 'utf8')
  );

  assert.deepEqual(rootBiome.files?.includes, [
    '**',
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
      'node scripts/ci/assert-core-suite-owners.mjs',
      'bash scripts/ci/provision-test-db.sh',
      'pnpm --filter @meiye/web locale:compile',
      'node scripts/ci/run-core-suite.mjs --owner core-persistence --reporter spec --manifest-path /dev/core-persistence-suite-manifest.json',
      'node scripts/ci/assert-core-persistence-ran.mjs /dev/null',
    ]
  );
});

test('the release-candidate gate fails closed on live evidence before build/E2E', async () => {
  assert.deepEqual(
    await runGate('run-release-candidate-quality.sh', {
      RELEASE_MANIFEST_PATH: 'output/release/release-manifest.json',
    }),
    [
      'node scripts/ci/assert-release-candidate-evidence.mjs',
      `node scripts/production-network-boundary-gate.mjs --expected-commit-sha ${releaseCommitSha}`,
      'pnpm build',
      'pnpm --filter @meiye/web e2e',
    ]
  );

  // Without the downloaded manifest the gate refuses to run at all.
  const withoutManifest = spawnSync(
    '/bin/bash',
    [join(repositoryRoot, 'scripts/ci/run-release-candidate-quality.sh')],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: { ...process.env, RELEASE_COMMIT_SHA: releaseCommitSha, RELEASE_MANIFEST_PATH: '' },
    }
  );
  assert.notEqual(withoutManifest.status, 0);
  assert.match(withoutManifest.stderr, /RELEASE_MANIFEST_PATH/);
});

test('the Web deploy workflow is discoverable at the root and runs in the Web directory', async () => {
  // T40/E-01: GitHub only discovers workflows in the repository-root
  // .github/workflows, and every command in this file assumes the Web unit's
  // directory. Nothing guarded either fact before, which is how the workflow
  // stayed unreachable in a subdirectory.
  const deploy = await readFile(
    join(repositoryRoot, '.github/workflows/deploy.yml'),
    'utf8'
  );
  assert.equal(
    existsSync(join(repositoryRoot, 'mkfast-template-main/.github/workflows')),
    false,
    'workflows must not live in a subdirectory GitHub never reads'
  );

  assert.match(deploy, /^on:\n {2}workflow_run:\n/m);
  assert.doesNotMatch(deploy, /^ {2}workflow_dispatch:/m);
  assert.match(deploy, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(deploy, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  assert.match(deploy, /uses: actions\/checkout@v4/);
  assert.match(deploy, /uses: pnpm\/action-setup@v4\n\s+with:\n\s+version: 10\.30\.3/);
  assert.match(deploy, /uses: actions\/setup-node@v4/);

  // Install stays at the workspace root; every other command runs in the Web unit.
  const steps = deploy.split(/^ {6}- name: /m).slice(1);
  const stepDirectories = new Map(
    steps.map((step) => [
      step.split('\n')[0].trim(),
      /working-directory: (\S+)/.exec(step)?.[1] ?? null,
    ])
  );
  assert.equal(stepDirectories.get('Install dependencies'), null);
  for (const step of [
    'Apply PostgreSQL migrations before release',
    'Build',
    'Deploy to Cloudflare Workers',
  ]) {
    assert.equal(
      stepDirectories.get(step),
      'mkfast-template-main',
      `${step} must run in the Web unit directory`
    );
  }
  assert.match(deploy, /pnpm exec wrangler deploy/);
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
  assert.match(coreQuality, /^ {2}p2-browser-acceptance:/m);
  assert.match(coreQuality, /^ {2}v31-browser-acceptance:/m);
  assert.match(coreQuality, /PLAYWRIGHT_PRODUCTION_CANDIDATE: true/);
  assert.match(coreQuality, /bash scripts\/ci\/run-pr-production-journey\.sh/);
  assert.match(coreQuality, /bash scripts\/ci\/run-p2-browser-acceptance\.sh/);
  assert.match(coreQuality, /bash scripts\/ci\/run-v31-browser-acceptance\.sh/);
  assert.match(
    coreQuality,
    /REQUIRED_E2E_SPEC: tests\/e2e\/specs\/assembly-gate-required-journey\.spec\.ts/,
  );
  assert.match(
    coreQuality,
    /REQUIRED_BROWSER_HARD_GATE_SPEC: tests\/e2e\/specs\/m04-browser-hard-gate\.spec\.ts/,
  );
  assert.match(
    coreQuality,
    /REQUIRED_V31_MEMORY_INJECTION_SPEC: tests\/e2e\/specs\/v31-memory-injection-b2-journey\.spec\.ts/,
  );
  assert.match(coreQuality, /^ {2}required:/m);
  assert.match(coreQuality, /if: \$\{\{ always\(\) \}\}/);
  assert.match(coreQuality, /needs\.redline-evals\.result/);
  assert.match(coreQuality, /needs\.core\.result/);
  assert.match(coreQuality, /needs\.root-quality\.result/);
  assert.match(coreQuality, /needs\.core-persistence\.result/);
  assert.match(coreQuality, /needs\.production-main-journey\.result/);
  assert.match(coreQuality, /needs\.p2-browser-acceptance\.result/);
  assert.match(coreQuality, /needs\.v31-browser-acceptance\.result/);
  assert.match(coreQuality, /needs\.production-dependency-audit\.result/);
  assert.match(
    coreQuality,
    /Fact-satisfaction assertion control expected exit 100/,
  );
  assert.match(
    coreQuality,
    /if \[ "\$control_exit" -ne 100 \]; then/,
  );
  assert.match(coreQuality, /node scripts\/ci\/assert-required-jobs\.mjs/);
  for (const artifactName of [
    'root-required-quality-evidence',
    'core-persistence-evidence',
    'production-main-journey-evidence',
    'p2-browser-acceptance-evidence',
    'v31-browser-acceptance-evidence',
  ]) {
    assert.match(coreQuality, new RegExp(`name: ${artifactName}`));
  }
  assert.match(coreQuality, /if-no-files-found: error/);
  assert.match(coreQuality, /release-candidate/);
  assert.match(coreQuality, /^ {2}production-dependency-audit:/m);
  assert.match(coreQuality, /pnpm audit --prod --json/);
  assert.match(coreQuality, /assert-production-audit\.mjs/);
  assert.match(
    coreQuality,
    /docs\/ops\/production-dependency-audit-waivers\.json/
  );
  assert.match(coreQuality, /name: production-dependency-audit/);
  assert.match(
    coreQuality,
    /bash scripts\/ci\/run-release-candidate-quality\.sh/
  );
  assert.match(coreQuality, /RELEASE_COMMIT_SHA: \$\{\{ github\.sha \}\}/);
  // The release manifest is minted by its own job, uploaded, and downloaded by
  // the release-candidate job, which then names it for the gate.
  assert.match(coreQuality, /^ {2}release-manifest:/m);
  assert.match(coreQuality, /node scripts\/ci\/build-release-manifest\.mjs/);
  assert.match(coreQuality, /name: staging-release-manifest/);
  assert.match(coreQuality, /uses: actions\/download-artifact@v4/);
  assert.match(coreQuality, /needs: release-manifest/);
  assert.match(
    coreQuality,
    /RELEASE_MANIFEST_PATH: output\/release\/release-manifest\.json/
  );
  assert.doesNotMatch(
    coreQuality,
    /# Release-candidate acceptance[\s\S]*?github\.event_name == 'push'/
  );
  assert.doesNotMatch(
    coreQuality,
    /# Release-candidate acceptance[\s\S]*?contains\(github\.event\.pull_request\.labels\.\*\.name, 'run-e2e'\)/
  );
  assert.match(
    coreQuality,
    /RELEASE_WORKFLOW_RUN: \$\{\{ github\.server_url \}\}\/\$\{\{ github\.repository \}\}\/actions\/runs\/\$\{\{ github\.run_id \}\}/
  );
  for (const releaseInput of [
    'RELEASE_CONFIG_REVISION',
    'RELEASE_READINESS_EVIDENCE_REF',
    'RELEASE_RECOVERY_EVIDENCE_REF',
    'RELEASE_JOURNEY_EVIDENCE_REF_COPY',
    'RELEASE_JOURNEY_EVIDENCE_REF_IMAGE',
    'RELEASE_JOURNEY_EVIDENCE_REF_VIDEO',
  ]) {
    assert.match(
      coreQuality,
      new RegExp(`${releaseInput}: \\$\\{\\{ vars\\.${releaseInput} \\}\\}`)
    );
  }
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

function extractJobBlock(workflow, jobName) {
  const block = workflow.match(
    new RegExp(`^ {2}${jobName}:$([\\s\\S]*?)(?=^ {2}\\S|(?![\\s\\S]))`, 'mu')
  );
  assert.ok(block, `job ${jobName} is missing from the workflow`);
  return block[1];
}

test('the required aggregate blocks on exactly the jobs the checker enforces', async () => {
  const coreQuality = await readFile(
    join(repositoryRoot, '.github/workflows/core-quality.yml'),
    'utf8'
  );
  const checker = await readFile(
    join(repositoryRoot, 'scripts/ci/assert-required-jobs.mjs'),
    'utf8'
  );

  const requiredBlock = extractJobBlock(coreQuality, 'required');
  const declaredNeeds = [
    ...requiredBlock.matchAll(/^ {6}- ([a-z0-9-]+)$/gmu),
  ].map((match) => match[1]);
  const enforcedJobs = [...checker.matchAll(/\[\s*'([a-z0-9-]+)',/gu)].map(
    (match) => match[1]
  );

  assert.deepEqual([...declaredNeeds].sort(), [...enforcedJobs].sort());
  for (const jobName of declaredNeeds) {
    extractJobBlock(coreQuality, jobName);
  }

  // Ordinary browser acceptance must not inherit the opt-in release-manifest
  // dependency; only the release-candidate e2e job may depend on it.
  for (const jobName of ['p2-browser-acceptance', 'v31-browser-acceptance']) {
    const jobBlock = extractJobBlock(coreQuality, jobName);
    assert.doesNotMatch(jobBlock, /^ {4}needs:/mu);
    assert.doesNotMatch(jobBlock, /^ {4}if:/mu);
    assert.match(jobBlock, /^ {6}- uses: actions\/upload-artifact@v4$/mu);
    assert.match(jobBlock, /^ {8}if: always\(\)$/mu);
  }
  assert.match(extractJobBlock(coreQuality, 'e2e'), /^ {4}needs: release-manifest$/mu);
});
