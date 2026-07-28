import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  allowsDevSecretDefaults,
  isStrictSecretEnv,
  isWeakSecretValue,
  WEAK_SECRET_VALUES,
} from './secret-hardening.ts';

test('allowsDevSecretDefaults is true outside production/staging', () => {
  assert.equal(allowsDevSecretDefaults({ APP_ENV: 'e2e' }), true);
  assert.equal(allowsDevSecretDefaults({ APP_ENV: 'development' }), true);
  assert.equal(allowsDevSecretDefaults({ APP_ENV: 'test' }), true);
  assert.equal(allowsDevSecretDefaults({ NODE_ENV: 'test' }), true);
  assert.equal(allowsDevSecretDefaults({}), true);
  assert.equal(allowsDevSecretDefaults({ APP_ENV: 'production' }), false);
  assert.equal(allowsDevSecretDefaults({ APP_ENV: 'staging' }), false);
  assert.equal(allowsDevSecretDefaults({ NODE_ENV: 'production' }), false);
});

test('isStrictSecretEnv only for production/staging (or bare NODE_ENV=production)', () => {
  assert.equal(isStrictSecretEnv({ APP_ENV: 'production' }), true);
  assert.equal(isStrictSecretEnv({ APP_ENV: 'staging' }), true);
  assert.equal(isStrictSecretEnv({ NODE_ENV: 'production' }), true);
  assert.equal(
    isStrictSecretEnv({ APP_ENV: 'e2e', NODE_ENV: 'production' }),
    false
  );
  assert.equal(isStrictSecretEnv({}), false);
});

test('weak secret placeholders are enumerated for production rejection', () => {
  for (const value of WEAK_SECRET_VALUES) {
    assert.equal(isWeakSecretValue(value), true, value);
  }
  assert.equal(isWeakSecretValue('prod-rotation-token'), false);
});

/**
 * A declared-but-unread env key is the cheapest kind of 假绿: `.env.example`
 * and the zod schema both say the key matters, provisioning dutifully asks an
 * operator to fill it, and nothing on the other end ever looks. `FAL_KEY`
 * outlived the retired AI-playground routes that way. Two keys legitimately
 * have no textual reader — their *declaration* is the enforcement — so they
 * are named here rather than left to look like the same mistake.
 */
const ENFORCEMENT_ONLY_KEYS = new Map([
  [
    'BETTER_AUTH_SECRET',
    'Better Auth reads process.env itself; the schema only rejects weak values in production/staging.',
  ],
  [
    'INTERNAL_SERVICE_TRANSPORT',
    'docs/production-network-boundary-runbook.md — required by the schema in strict envs so a production boot without it fails fast.',
  ],
]);

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../..');

/**
 * Ships-to-users source only. Tests are excluded on purpose: a key whose only
 * reader is a test is exactly the shape this assertion exists to catch, and
 * leaving them in also lets this file's own prose about a removed key count as
 * that key's reader.
 */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' ? [] : sourceFiles(path);
    }
    if (/\.(test|spec)\.(ts|tsx|mjs)$/.test(entry.name)) return [];
    return /\.(ts|tsx|mjs)$/.test(entry.name) ? [path] : [];
  });
}

test('every declared server env key has a reader, or is named as enforcement-only', () => {
  const schema = readFileSync(join(here, 'server.ts'), 'utf8');
  const declared = [...schema.matchAll(/^ {4}([A-Z][A-Z0-9_]+):/gm)].map(
    ([, name]) => name
  );
  assert.ok(declared.length >= 20, `failed to parse server.ts (${declared})`);

  const haystack = [
    ...sourceFiles(join(repo, 'src')).filter(
      (path) => !path.endsWith(`${join('src', 'env', 'server.ts')}`)
    ),
    ...sourceFiles(join(repo, 'scripts')),
    join(repo, 'playwright.config.ts'),
    join(repo, 'wrangler.jsonc'),
  ]
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');

  const orphans = declared.filter(
    (name) =>
      !ENFORCEMENT_ONLY_KEYS.has(name) &&
      !new RegExp(`\\b${name}\\b`).test(haystack)
  );
  assert.deepEqual(
    orphans,
    [],
    'these env keys are declared and provisioned but nothing reads them — ' +
      'wire them up, drop them, or add them to ENFORCEMENT_ONLY_KEYS with the reason'
  );

  // The escape hatch has to stay honest too: an entry that grew a real reader
  // should leave the list rather than sit there excusing nothing.
  for (const name of ENFORCEMENT_ONLY_KEYS.keys()) {
    assert.ok(
      declared.includes(name),
      `${name} is excused as enforcement-only but server.ts no longer declares it`
    );
  }
});

test('.env.example asks operators for exactly the keys the schema declares', () => {
  const schema = [
    ...readFileSync(join(here, 'server.ts'), 'utf8').matchAll(
      /^ {4}([A-Z][A-Z0-9_]+):/gm
    ),
  ].map(([, name]) => name);
  const example = [
    ...readFileSync(join(repo, '.env.example'), 'utf8').matchAll(
      /^([A-Z][A-Z0-9_]+)=/gm
    ),
  ].map(([, name]) => name);

  // Wrangler's own convention, consumed by the dev server rather than by us.
  const wranglerOwned = ['CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE'];
  const client = [
    ...readFileSync(join(here, 'client.ts'), 'utf8').matchAll(
      /^ {4}(VITE_[A-Z0-9_]+):/gm
    ),
  ].map(([, name]) => name);
  const known = new Set([...schema, ...client, ...wranglerOwned]);

  assert.deepEqual(
    example.filter((name) => !known.has(name)),
    [],
    '.env.example asks for keys no env schema declares'
  );
});
