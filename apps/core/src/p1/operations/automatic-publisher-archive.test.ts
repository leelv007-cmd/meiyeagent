/**
 * RET-05 / D-155: production assembly must not keep a dormant automatic
 * publisher port or evaluator that can open automatic_verified.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { contentPackageDeliveryCapability } from './content-package-delivery.js';

const here = dirname(fileURLToPath(import.meta.url));
const apiRuntime = readFileSync(
  join(here, '../../assembly/api-runtime.ts'),
  'utf8',
);

test('production assembly has no automatic publisher port or stub', () => {
  assert.doesNotMatch(apiRuntime, /ContentPackagePublishPort/u);
  assert.doesNotMatch(apiRuntime, /publisher:\s*\{/u);
  assert.doesNotMatch(
    apiRuntime,
    /Automatic ContentPackage publishing is not live-verified/u,
  );
});

test('main-chain capability projection is assisted or unavailable, never automatic_verified', () => {
  const withExport = contentPackageDeliveryCapability({
    exportAvailable: true,
    platform: 'xiaohongshu',
  });
  assert.equal(withExport.mode, 'assisted');
  assert.notEqual(withExport.mode, 'automatic_verified');

  const withoutExport = contentPackageDeliveryCapability({
    exportAvailable: false,
    platform: 'douyin',
  });
  assert.equal(withoutExport.mode, 'unavailable');
  assert.notEqual(withoutExport.mode, 'automatic_verified');
});
