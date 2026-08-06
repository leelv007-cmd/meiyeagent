import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const SRC_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Sole production reader of createAuth().api.getSession for the active guard. */
const ALLOW_DIRECT_GET_SESSION = new Set(['auth/active-session.ts']);

/**
 * Every protected session consumer must route through requireActiveSession
 * (or call a helper that does). Listed so a new middleware cannot silently
 * reintroduce raw getSession.
 */
const PROTECTED_SESSION_CONSUMERS = [
  'middlewares/auth-middleware.ts',
  'middlewares/admin-middleware.ts',
  'middlewares/guest-middleware.ts',
  'auth/recent-admin-session.ts',
  'lib/workspace-core-authorization.ts',
  'lib/core-client.ts',
  'routes/api/storage/upload.ts',
  'routes/api/storage/file.ts',
] as const;

const DIRECT_GET_SESSION =
  /createAuth\s*\(\s*\)\s*\.\s*api\s*\.\s*getSession\s*\(/u;

function walkSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (
        entry === 'paraglide' ||
        entry === 'components' ||
        entry === 'product' ||
        entry === 'p1' ||
        entry === 'mail' ||
        entry === 'hooks' ||
        entry === 'locale'
      ) {
        // Skip large non-auth trees; protected session reads live in middleware,
        // auth, lib, and API routes only.
        continue;
      }
      files.push(...walkSourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/u.test(entry)) continue;
    if (/\.test\.(ts|tsx)$/u.test(entry)) continue;
    files.push(full);
  }
  return files;
}

function rel(path: string) {
  return relative(SRC_ROOT, path).replaceAll('\\', '/');
}

test('no protected production path calls createAuth().api.getSession directly', () => {
  const offenders: string[] = [];
  for (const file of walkSourceFiles(SRC_ROOT)) {
    const path = rel(file);
    if (ALLOW_DIRECT_GET_SESSION.has(path)) continue;
    const source = readFileSync(file, 'utf8');
    if (DIRECT_GET_SESSION.test(source)) {
      offenders.push(path);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `direct getSession outside the active-session guard:\n${offenders.join('\n')}`
  );
});

test('every protected session consumer imports requireActiveSession', () => {
  for (const path of PROTECTED_SESSION_CONSUMERS) {
    const source = readFileSync(join(SRC_ROOT, path), 'utf8');
    assert.match(
      source,
      /requireActiveSession/u,
      `${path} must use requireActiveSession`
    );
  }
});

test('p1 module proxy production path omits getSession so authorize uses requireActiveSession', () => {
  const source = readFileSync(join(SRC_ROOT, 'lib/p1-module-proxy.ts'), 'utf8');
  assert.match(source, /authorizeWorkspaceCoreRequest/u);
  assert.doesNotMatch(source, DIRECT_GET_SESSION);
  // Must pass options.getSession (optional harness inject) — not a production default getter.
  assert.match(
    source,
    /authorizeWorkspaceCoreRequest\(\s*request,\s*resource,\s*body,\s*options\.getSession\s*\)/u
  );
  assert.doesNotMatch(
    source,
    /defaultGetSession|createAuth\s*\(/u,
    'production default must not reintroduce raw createAuth getSession'
  );
});

test('auth cookie cache remains enabled (ban immediacy must not disable it)', () => {
  const authSource = readFileSync(join(SRC_ROOT, 'auth/auth.ts'), 'utf8');
  assert.match(authSource, /cookieCache\s*:\s*\{/u);
  assert.match(authSource, /enabled\s*:\s*true/u);
  assert.doesNotMatch(
    authSource,
    /cookieCache\s*:\s*\{[^}]*enabled\s*:\s*false/u
  );
});
