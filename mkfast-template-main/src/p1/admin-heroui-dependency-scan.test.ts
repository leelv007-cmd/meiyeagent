/**
 * Admin heroui residual scan (#387).
 *
 * After the controlled-config cell-editor restyle, admin product consumers
 * must not import `@heroui/react` or `@/components/heroui-pro`.
 *
 * Exemptions (explicit, narrow):
 * - comments that mention heroui in shell docs (string match only on imports)
 * - `routes/heroui-spike/**` — isolated vendor spike (not admin product surface)
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';

const webRoot = resolve(process.cwd());

const SCAN_ROOTS = [
  'src/routes/admin',
  'src/components/admin',
  'src/p1',
] as const;

/** Relative paths (posix) allowed to still import heroui — tracked elsewhere. */
const IMPORT_EXEMPT = new Set<string>([]);

const IMPORT_RE =
  /from\s+['"]@heroui\/react['"]|from\s+['"]@\/components\/heroui-pro(?:\/[^'"]*)?['"]|import\s+['"]@\/components\/heroui-pro/;

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(name)) continue;
      if (name.endsWith('.test.ts') || name.endsWith('.test.tsx')) continue;
      if (name.endsWith('.interaction.test.tsx')) continue;
      out.push(full);
    }
  };
  walk(dir);
  return out;
}

function isAdminP1File(rel: string): boolean {
  if (!rel.startsWith('src/p1/')) return false;
  const base = rel.slice('src/p1/'.length);
  // Admin controls and fixtures only — not merchant product helpers in p1.
  return (
    base.startsWith('admin-') ||
    base.startsWith('use-admin-') ||
    base.includes('admin-')
  );
}

test('admin product sources do not import heroui (except #386 ops charts)', () => {
  const hits: string[] = [];

  for (const root of SCAN_ROOTS) {
    const abs = resolve(webRoot, root);
    for (const file of listSourceFiles(abs)) {
      const rel = relative(webRoot, file).split('\\').join('/');
      if (root === 'src/p1' && !isAdminP1File(rel)) continue;
      if (IMPORT_EXEMPT.has(rel)) continue;

      const source = readFileSync(file, 'utf8');
      if (IMPORT_RE.test(source)) {
        hits.push(rel);
      }
    }
  }

  assert.deepEqual(
    hits,
    [],
    `admin heroui imports remaining (clear #387 residuals):\n${hits.join('\n')}`
  );
});

test('controlled config form has no heroui import', () => {
  const source = readFileSync(
    resolve(webRoot, 'src/p1/admin-config-form.tsx'),
    'utf8'
  );
  assert.doesNotMatch(source, IMPORT_RE);
});

test('heroui-spike route is marked isolated and is not under /admin', () => {
  const spike = readFileSync(
    resolve(webRoot, 'src/routes/heroui-spike.tsx'),
    'utf8'
  );
  assert.match(spike, /ISOLATED VENDOR SPIKE/);
  assert.match(spike, /notFound\(\)/);
  assert.doesNotMatch(spike, /createFileRoute\('\/admin/);
});

test('merchant heroui usage outside admin is untouched by this scan', () => {
  // Guard against over-scoping: product shell still uses heroui-pro.
  const layout = readFileSync(
    resolve(webRoot, 'src/components/layout/sidebar-layout.tsx'),
    'utf8'
  );
  assert.match(layout, /@\/components\/heroui-pro/);
});

// Keep the exempt set honest: exempt files must still exist and import heroui
// until #386 lands; a missing path silently empties the exemption.
test('heroui import exemptions still resolve to heroui consumers', () => {
  for (const rel of IMPORT_EXEMPT) {
    const source = readFileSync(resolve(webRoot, rel), 'utf8');
    assert.match(
      source,
      IMPORT_RE,
      `${rel} is exempted but no longer imports heroui — remove the exemption`
    );
  }
});

// Fail closed if a scan root was renamed away (empty tree is a silent pass).
test('admin heroui scan roots are non-empty on disk', () => {
  for (const root of SCAN_ROOTS) {
    const files = listSourceFiles(resolve(webRoot, root));
    assert.ok(files.length > 0, `scan root empty: ${root}`);
  }
});
