import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { PLATFORM_SAMPLE_ID_PREFIX } from '@meiye/contracts';

import { tenantMaterials } from './workspace-assets-page';

test('platform sample material never reaches the tenant workspace view', () => {
  const mine = { id: 'asset-mine' };
  const sample = { id: `${PLATFORM_SAMPLE_ID_PREFIX}hair-care-cover` };

  assert.deepEqual(tenantMaterials([mine, sample]), [mine]);
  assert.deepEqual(tenantMaterials([sample]), []);
});

test('the workspace surface filters before rendering, not after', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/product/workspace-assets-page.tsx'),
    'utf8'
  );

  // The only path from ProductState.assets into the view goes through the
  // filter; a direct `state.assets` render would leak sample material.
  assert.match(source, /tenantMaterials\(state\?\.assets \?\? \[\]\)/u);
  assert.equal(source.match(/state\?\.assets/gu)?.length, 1);
});

test('the workspace surface claims no ContentWorkspace tier it cannot read', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/product/workspace-assets-page.tsx'),
    'utf8'
  );
  // Comments are allowed to name the missing contract; the rendering is not.
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, '');

  // The D-121 tier dimension has no projection yet (OI-50), and D-123 forbids
  // hardcoded commercial numbers on merchant surfaces either way.
  assert.doesNotMatch(code, /ContentWorkspace|BrandSpace/u);
  assert.doesNotMatch(code, /workspaceQuota|booster|加油包/iu);
});
