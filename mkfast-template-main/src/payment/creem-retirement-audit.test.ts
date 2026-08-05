import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: process.cwd(),
  encoding: 'utf8',
}).trim();

const retiredModules = [
  'mkfast-template-main/src/payment/provider/creem-checkout-catalog.interaction.test.ts',
  'mkfast-template-main/src/payment/provider/creem-checkout-identity.test.ts',
  'mkfast-template-main/src/payment/provider/creem.ts',
  'mkfast-template-main/src/routes/api/webhooks/creem.ts',
];

test('Creem payment runtime remains retired from tracked code and active config', () => {
  const trackedModules = execFileSync(
    'git',
    ['ls-files', '--', ...retiredModules],
    { cwd: repoRoot, encoding: 'utf8' }
  ).trim();
  assert.equal(
    trackedModules,
    '',
    `Tracked retired modules:\n${trackedModules}`
  );

  const activeReferences = spawnSync(
    'git',
    [
      'grep',
      '--line-number',
      '--ignore-case',
      '--',
      'creem',
      '.github/workflows',
      'mkfast-template-main/.env.example',
      'mkfast-template-main/AGENTS.md',
      'mkfast-template-main/CLAUDE.md',
      'mkfast-template-main/docs',
      'mkfast-template-main/package.json',
      'mkfast-template-main/src',
      'mkfast-template-main/tests/e2e/TEST-CATALOG.md',
      'mkfast-template-main/vite.config.ts',
      'pnpm-lock.yaml',
      ':(exclude)mkfast-template-main/src/payment/creem-retirement-audit.test.ts',
    ],
    { cwd: repoRoot, encoding: 'utf8' }
  );

  // Fail closed: status 0 = hits found, 1 = no hits, anything else = grep error
  // (bad pathspec, git failure). Do not treat empty stdout as a clean pass.
  assert.ok(
    activeReferences.status === 0 || activeReferences.status === 1,
    activeReferences.stderr ||
      `git grep creem failed with status ${String(activeReferences.status)}`
  );

  // Constraint docs may name Creem only to state that it is retired — that is
  // policy prose, not a live payment path. Allow solely the AGENTS.md
  // retirement sentence; a `// Creem is retired` comment next to live creem
  // code under src/ must still fail.
  const remaining = (activeReferences.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        !/^mkfast-template-main\/AGENTS\.md:\d+:.*\(Creem is retired\)/i.test(
          line
        )
    );

  assert.equal(
    remaining.length,
    0,
    `Active Creem references remain:\n${remaining.join('\n') || activeReferences.stdout}`
  );
});
