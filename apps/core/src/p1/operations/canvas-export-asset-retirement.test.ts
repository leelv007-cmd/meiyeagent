/**
 * D-170 RET-02: canvas ZIP export-asset query/access/receipt verification
 * stays deleted. Merchant light-canvas export_work + adopt_canvas_work_export
 * remain on PersistentCanvasExportAdapter.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '../../../../..');

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function productionSources(roots: string[]): string[] {
  return roots
    .flatMap((root) => filesUnder(resolve(repositoryRoot, root)))
    .filter(
      (file) =>
        (file.endsWith('.ts') || file.endsWith('.tsx')) &&
        !file.endsWith('.d.ts') &&
        !file.endsWith('.test.ts') &&
        !file.endsWith('.test.tsx') &&
        !file.includes('node_modules'),
    )
    .map((file) => relative(repositoryRoot, file))
    .sort();
}

test('production sources do not resurrect canvas export asset access', () => {
  const files = productionSources([
    'apps/core/src',
    'packages/contracts/src',
  ]);
  const forbidden = [
    /OperationsCanvasExportAssetAccessService/u,
    /CanvasExportAssetAccessPort/u,
    /resolveCanvasExportAsset/u,
    /canvasExportAssetAccess/u,
    /verifyCanvasAssetReceipt/u,
    /['"]canvas_export_asset['"]/u,
  ];
  const violations = files.flatMap((file) => {
    const source = readFileSync(resolve(repositoryRoot, file), 'utf8');
    return forbidden
      .filter((pattern) => pattern.test(source))
      .map((pattern) => `${file}: ${pattern}`);
  });
  assert.deepEqual(violations, []);
});
