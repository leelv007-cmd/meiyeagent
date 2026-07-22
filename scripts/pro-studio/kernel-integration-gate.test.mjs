import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import {
  EXACT_COPY_SOURCES,
  PRODUCTION_INVENTORY,
  PRODUCTION_WHITELIST,
} from './apply-exact-copies.mjs';
import {
  discoverExactCopyTargets,
  discoverPortedTargets,
  validateCopyManifest,
  validateDiscoveredCopySet,
  validatePortManifest,
  validateProductionInventory,
} from './conformance-gate.mjs';

const root = resolve(import.meta.dirname, '../..');
const manifestPath = resolve(
  root,
  'docs/evidence/pro-studio/copy-manifest.json'
);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const configuredUpstreamRoot = process.env.PRO_STUDIO_UPSTREAM_ROOT;
const defaultUpstreamRoot = resolve(root, 'references/repos/vozeb');
const upstreamRoot = configuredUpstreamRoot
  ? resolve(configuredUpstreamRoot)
  : existsSync(defaultUpstreamRoot)
    ? defaultUpstreamRoot
    : undefined;
const upstreamParitySkipReason =
  !configuredUpstreamRoot && !upstreamRoot
    ? 'PRO_STUDIO_UPSTREAM_ROOT and references/repos/vozeb are unavailable; committed target evidence remains verified.'
    : false;

test('kernel integration: copy-manifest verifies committed target evidence', () => {
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.copies.length, EXACT_COPY_SOURCES.length);
  assert.deepEqual(
    manifest.copies.map((row) => row.source).sort(),
    [...EXACT_COPY_SOURCES].sort()
  );
  for (const required of [
    'web/src/app/(user)/canvas/components/vozeb-canvas.tsx',
    'web/src/app/(user)/canvas/utils/canvas-image-data.ts',
    'web/src/lib/canvas-theme.ts',
  ]) {
    assert.ok(EXACT_COPY_SOURCES.includes(required), required);
  }
  const issues = validateCopyManifest(manifest, {
    evidenceExists: (path) => existsSync(resolve(root, path)),
    readEvidence: (path) => readFileSync(resolve(root, path)),
    readTarget: (path) => {
      try {
        return readFileSync(resolve(root, path));
      } catch {
        return undefined;
      }
    },
  });
  for (const row of manifest.copies) {
    const bytes = readFileSync(resolve(root, row.target));
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      row.sha256,
      row.target
    );
    assert.equal(row.authorizationStatus, 'authorized');
  }
  assert.deepEqual(issues, []);
  assert.deepEqual(
    manifest.productionInventory.map((row) => row.source).sort(),
    PRODUCTION_INVENTORY.map((row) => row.source).sort()
  );
  assert.deepEqual(manifest.productionWhitelist, PRODUCTION_WHITELIST);
  assert.deepEqual(
    validateProductionInventory(manifest, {
      readHost: (path) => {
        try {
          return readFileSync(resolve(root, path));
        } catch {
          return undefined;
        }
      },
    }),
    []
  );
  assert.deepEqual(
    validatePortManifest(manifest, {
      discoveredTargets: discoverPortedTargets(
        resolve(root, 'apps/canvas/src/kernel-host/ported')
      ),
      evidenceExists: (path) => existsSync(resolve(root, path)),
      readTarget: (path) => {
        try {
          return readFileSync(resolve(root, path));
        } catch {
          return undefined;
        }
      },
    }),
    []
  );
});

test(
  'kernel integration: copy-manifest verifies upstream byte parity when checkout is available',
  { skip: upstreamParitySkipReason },
  () => {
    assert.ok(upstreamRoot, 'configured upstream checkout is required');
    assert.ok(
      existsSync(upstreamRoot),
      'configured upstream checkout is missing'
    );
    assert.equal(
      execFileSync('git', ['-C', upstreamRoot, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim(),
      manifest.upstream.commit
    );
    const issues = validateCopyManifest(manifest, {
      evidenceExists: (path) => existsSync(resolve(root, path)),
      readEvidence: (path) => readFileSync(resolve(root, path)),
      readSource: (path) => readFileSync(resolve(upstreamRoot, path)),
      readTarget: (path) => {
        try {
          return readFileSync(resolve(root, path));
        } catch {
          return undefined;
        }
      },
    });
    assert.deepEqual(issues, []);
    assert.deepEqual(
      validatePortManifest(manifest, {
        discoveredTargets: discoverPortedTargets(
          resolve(root, 'apps/canvas/src/kernel-host/ported')
        ),
        evidenceExists: (path) => existsSync(resolve(root, path)),
        readSource: (path) => readFileSync(resolve(upstreamRoot, path)),
        readTarget: (path) => {
          try {
            return readFileSync(resolve(root, path));
          } catch {
            return undefined;
          }
        },
      }),
      []
    );
    assert.deepEqual(
      validateDiscoveredCopySet(
        manifest.copies,
        discoverExactCopyTargets(
          upstreamRoot,
          resolve(root, 'apps/canvas/src/vendor/vozeb'),
          'apps/canvas/src/vendor/vozeb'
        )
      ),
      []
    );
  }
);

test('kernel-host adapters and surface exist', () => {
  for (const rel of [
    'apps/canvas/src/kernel-host/graph-bridge.ts',
    'apps/canvas/src/kernel-host/project-persistence.ts',
    'apps/canvas/src/kernel-host/media-adapter.ts',
    'apps/canvas/src/kernel-host/generation-adapter.ts',
    'apps/canvas/src/kernel-host/agent-adapter.ts',
    'apps/canvas/src/kernel-host/adoption-adapter.ts',
    'apps/canvas/src/kernel-host/kernel-canvas-surface.tsx',
    'docs/evidence/pro-studio/copy-candidate-inventory.md',
  ]) {
    assert.ok(existsSync(resolve(root, rel)), rel);
  }
});

test('canvas-shell mounts kernel surface', () => {
  const shell = readFileSync(
    resolve(root, 'apps/canvas/src/client/canvas-shell.tsx'),
    'utf8'
  );
  assert.match(shell, /KernelCanvasSurface/);
  assert.match(shell, /fromKernelGraph|toKernelGraph/);
});
