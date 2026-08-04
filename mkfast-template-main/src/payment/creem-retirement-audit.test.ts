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
  assert.equal(trackedModules, '', `Tracked retired modules:\n${trackedModules}`);

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

  assert.ok(
    activeReferences.status === 1 && activeReferences.stdout === '',
    activeReferences.stderr ||
      `Active Creem references remain:\n${activeReferences.stdout}`
  );
});
