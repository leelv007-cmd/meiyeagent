/**
 * Restyle asset manifest gate (#427).
 *
 * Shared reui + admin shared/shell primitives listed here must exist on disk
 * and have ≥1 non-self consumer under src/ (import path resolves to the asset).
 *
 * Zero-consumer exemptions are explicit and temporary.
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';

const webRoot = resolve(process.cwd());

/** Restyle shared assets that must stay wired. */
const ASSET_MANIFEST = [
  'src/components/reui/badge.tsx',
  'src/components/reui/frame.tsx',
  'src/components/reui/timeline.tsx',
  'src/components/admin/shared/page-header.tsx',
  'src/components/admin/shared/use-route-sheet.ts',
  'src/components/admin/shared/icon-tile.tsx',
  'src/components/admin/shared/setting-field.tsx',
  'src/components/admin/shell/page-crumb.tsx',
  'src/components/admin/shell/nav-active.ts',
] as const;

/**
 * Assets allowed to have zero consumers until their wiring ticket lands.
 * Remove entries when consumers appear — do not grow this set casually.
 */
const EXEMPT_ZERO_CONSUMERS = new Set<string>([]);

const IMPORT_SPEC_RE = /(?:from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"])/g;

const SOURCE_EXTS = ['.ts', '.tsx', '.js', '.jsx'] as const;

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
      out.push(full);
    }
  };
  walk(dir);
  return out;
}

function resolveImport(importerAbs: string, spec: string): string | null {
  if (spec.startsWith('@/')) {
    const base = resolve(webRoot, 'src', spec.slice(2));
    return resolveWithExt(base);
  }
  if (spec.startsWith('.')) {
    const base = resolve(dirname(importerAbs), spec);
    return resolveWithExt(base);
  }
  return null;
}

function resolveWithExt(base: string): string | null {
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of SOURCE_EXTS) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }
  for (const ext of SOURCE_EXTS) {
    const index = join(base, `index${ext}`);
    if (existsSync(index) && statSync(index).isFile()) return index;
  }
  return null;
}

function importSpecs(source: string): string[] {
  const specs: string[] = [];
  for (const match of source.matchAll(IMPORT_SPEC_RE)) {
    const spec = match[1] ?? match[2];
    if (spec) specs.push(spec);
  }
  return specs;
}

function consumersOf(assetRel: string): string[] {
  const assetAbs = resolve(webRoot, assetRel);
  const consumers: string[] = [];
  for (const file of listSourceFiles(resolve(webRoot, 'src'))) {
    const rel = relative(webRoot, file).split('\\').join('/');
    if (rel === assetRel) continue;
    if (!existsSync(file)) continue;
    const source = readFileSync(file, 'utf8');
    for (const spec of importSpecs(source)) {
      const resolved = resolveImport(file, spec);
      if (resolved && resolve(resolved) === assetAbs) {
        consumers.push(rel);
        break;
      }
    }
  }
  return consumers;
}

test('restyle asset manifest files exist on disk', () => {
  const missing = ASSET_MANIFEST.filter(
    (rel) => !existsSync(resolve(webRoot, rel))
  );
  assert.deepEqual(
    missing,
    [],
    `restyle assets missing on disk:\n${missing.join('\n')}`
  );
});

test('restyle assets have ≥1 non-self consumer under src/ (or are exempt)', () => {
  const orphans: string[] = [];

  for (const assetRel of ASSET_MANIFEST) {
    if (EXEMPT_ZERO_CONSUMERS.has(assetRel)) continue;
    const consumers = consumersOf(assetRel);
    if (consumers.length === 0) {
      orphans.push(assetRel);
    }
  }

  assert.deepEqual(
    orphans,
    [],
    `restyle assets with zero consumers (add wiring or EXEMPT_ZERO_CONSUMERS):\n${orphans.join('\n')}`
  );
});

// Keep the exempt set honest: exempt paths must exist and still have zero consumers.
test('zero-consumer exemptions still resolve and remain unused', () => {
  for (const rel of EXEMPT_ZERO_CONSUMERS) {
    assert.ok(
      existsSync(resolve(webRoot, rel)),
      `${rel} is exempted but missing on disk — remove the exemption`
    );
    assert.ok(
      ASSET_MANIFEST.includes(rel as (typeof ASSET_MANIFEST)[number]),
      `${rel} is exempted but not in ASSET_MANIFEST`
    );
    const consumers = consumersOf(rel);
    assert.equal(
      consumers.length,
      0,
      `${rel} is exempted but now has consumers (${consumers.join(', ')}) — remove the exemption`
    );
  }
});
