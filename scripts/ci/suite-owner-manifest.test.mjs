import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  assertSuiteOwnerManifest,
  currentSuiteOwnerManifest,
  suiteOwnerManifestSourceViolations,
  suiteOwnerManifestViolations,
} from './suite-owner-manifest.mjs';

const rootQualityScript = fileURLToPath(
  new URL('./run-root-required-quality.sh', import.meta.url)
);

test('the unified suite manifest covers every required category with one owner per suite', async () => {
  const { contract, manifest } = await currentSuiteOwnerManifest();

  assert.deepEqual(suiteOwnerManifestViolations(manifest, contract), []);
  assert.doesNotThrow(() => assertSuiteOwnerManifest(manifest, contract));

  const coveredCategories = new Set(
    manifest.suites.flatMap((suite) => suite.categories)
  );
  for (const category of contract.requiredCategories) {
    assert.ok(
      coveredCategories.has(category),
      `required suite category is not covered: ${category}`
    );
  }

  for (const suite of manifest.suites) {
    assert.equal(typeof suite.requiredOwner, 'string');
    assert.notEqual(suite.requiredOwner, '');
    assert.equal(
      suite.requiredOwners,
      undefined,
      'a suite must not declare an ambiguous owner list'
    );
  }
  assert.equal(
    new Set(manifest.suites.map((suite) => suite.requiredOwner)).size,
    manifest.suites.length,
    'each required command owner must own exactly one manifest suite'
  );

  const aggregateCommand = manifest.suites
    .flatMap((suite) => suite.commands)
    .find((command) => command.id === 'root-test-aggregate-command');
  assert.equal(aggregateCommand?.kind, 'aggregate');
  assert.deepEqual(
    aggregateCommand?.categories,
    ['aggregate'],
    'the recursive root test must not masquerade as a required unit suite'
  );
  assert.ok(
    aggregateCommand?.aggregateOf?.some(
      (nested) => nested.id === 'core-unit-command'
    ),
    'aggregate coverage must name nested core unit ownership'
  );
});

test('the checker rejects duplicate command ownership and missing required categories', () => {
  const contract = {
    schemaVersion: 1,
    requiredCategories: ['unit', 'interaction'],
  };
  const manifest = {
    schemaVersion: 1,
    suites: [
      {
        id: 'unit-a',
        categories: ['unit'],
        requiredOwner: 'owner-a',
        commands: [{ id: 'same-command', run: 'pnpm test' }],
      },
      {
        id: 'interaction-a',
        categories: ['interaction'],
        requiredOwner: 'owner-b',
        commands: [{ id: 'same-command', run: 'pnpm test' }],
      },
    ],
  };

  const violations = suiteOwnerManifestViolations(manifest, contract).join(
    '\n'
  );
  assert.match(violations, /duplicate command registrations/u);
});

test('the checker fails closed when an aggregate command masquerades as a required suite', () => {
  const contract = {
    schemaVersion: 1,
    requiredCategories: ['unit'],
    aggregateCategories: ['aggregate'],
  };
  const manifest = {
    schemaVersion: 1,
    suites: [
      {
        id: 'bad-aggregate',
        categories: ['unit'],
        requiredOwner: 'root-quality',
        commands: [
          {
            id: 'aggregate-command',
            run: 'pnpm test',
            kind: 'aggregate',
            categories: ['unit'],
            aggregateOf: [
              {
                id: 'nested-unit',
                owner: 'core',
                category: 'unit',
                run: 'pnpm --filter @meiye/core test',
              },
            ],
            references: [{ path: 'package.json', contains: 'pnpm test' }],
          },
        ],
      },
    ],
  };

  const violations = suiteOwnerManifestViolations(manifest, contract).join(
    '\n'
  );
  assert.match(
    violations,
    /aggregate command cannot claim required\/unknown category unit/u
  );
});

test('root required quality invokes the unified owner checker before the suites', async () => {
  const script = await readFile(rootQualityScript, 'utf8');
  assert.match(
    script,
    /run_required_gate suite-owner-manifest\.log node scripts\/ci\/assert-suite-owner-manifest\.mjs/u
  );
});

test('the source checker fails closed when an owner reference disappears', async () => {
  const violations = await suiteOwnerManifestSourceViolations(
    {
      suites: [
        {
          id: 'missing-source',
          commands: [
            {
              id: 'missing-source-command',
              references: [
                {
                  path: 'scripts/ci/does-not-exist.mjs',
                  contains: 'required command',
                },
              ],
            },
          ],
        },
      ],
    },
    process.cwd()
  );
  assert.match(violations.join('\n'), /source is unreadable/u);
});
