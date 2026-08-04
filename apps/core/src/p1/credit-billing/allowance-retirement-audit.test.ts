import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: process.cwd(),
  encoding: 'utf8',
}).trim();

const PROTECTED_PROGRESSIVE_RIGHTS = [
  'mkfast-template-main/src/product/progressive-rights.ts',
  'mkfast-template-main/src/product/progressive-rights-card.tsx',
];

const PRODUCTION_ASSEMBLY = [
  'apps/core/src/main.ts',
  'apps/core/src/job-worker.ts',
];

const PRODUCTION_ALLOWANCE_READ_PATHS = [
  'apps/core/src/main.ts',
  'apps/core/src/job-worker.ts',
  'apps/core/src/p1/admin-config/entitlement-catalog-source.ts',
  'apps/core/src/p1/admin-config/foundation-module.ts',
  'mkfast-template-main/src/p1/admin-plan-control.tsx',
  'mkfast-template-main/src/p1/admin-runtime-config-control.tsx',
  'mkfast-template-main/src/p1/admin-config-view-model.ts',
  'mkfast-template-main/src/p1/admin-config-field-model.ts',
];

test('progressive-rights material-authorization surfaces remain tracked (not retired)', () => {
  const tracked = execFileSync(
    'git',
    ['ls-files', '--', ...PROTECTED_PROGRESSIVE_RIGHTS],
    { cwd: repoRoot, encoding: 'utf8' }
  )
    .trim()
    .split('\n')
    .filter(Boolean);
  assert.deepEqual(
    tracked.sort(),
    [...PROTECTED_PROGRESSIVE_RIGHTS].sort(),
    'progressive-rights* must stay — material authorization is not billing'
  );
});

test('production ProductService assembly is billing write-locked (legacyBillingReadOnly)', () => {
  for (const relative of PRODUCTION_ASSEMBLY) {
    const source = readFileSync(resolve(repoRoot, relative), 'utf8');
    const flags = source.match(/legacyBillingReadOnly:\s*(true|false)/gu) ?? [];
    assert.ok(
      flags.length >= 2,
      `${relative} must construct ProductService with legacyBillingReadOnly`
    );
    for (const flag of flags) {
      assert.match(
        flag,
        /true/u,
        `${relative} must not re-open P0 product-service billing writes: ${flag}`
      );
    }
    assert.doesNotMatch(
      source,
      /legacyBillingReadOnly:\s*false/u,
      `${relative} must never set legacyBillingReadOnly: false`
    );
  }
});

test('plan.allowances.* has no production read or admin write surface', () => {
  const active = spawnSync(
    'git',
    [
      'grep',
      '--line-number',
      '--',
      'plan\\.allowances',
      ...PRODUCTION_ALLOWANCE_READ_PATHS,
    ],
    { cwd: repoRoot, encoding: 'utf8' }
  );

  // git grep exits 1 when there are no matches.
  assert.ok(
    active.status === 1 && active.stdout === '',
    active.stderr ||
      `Production plan.allowances references remain:\n${active.stdout}`
  );
});

test('admin foundation registry no longer publishes plan.allowances keys', () => {
  const foundation = readFileSync(
    resolve(repoRoot, 'apps/core/src/p1/admin-config/foundation-module.ts'),
    'utf8'
  );
  assert.doesNotMatch(foundation, /plan\.allowances\./u);
  assert.doesNotMatch(foundation, /planAllowanceSchema/u);
  assert.match(foundation, /plan\.credits\./u);
});
