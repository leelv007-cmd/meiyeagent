import assert from 'node:assert/strict';
import test from 'node:test';

import { isAllowedWorkspaceAssetObjectKey } from './core-asset-path';

test('allows a generated ContentPackage ZIP receipt without widening other asset paths', () => {
  const digest = 'a'.repeat(64);

  assert.equal(
    isAllowedWorkspaceAssetObjectKey(`workspace-a/generated/${digest}.zip`),
    true
  );
  assert.equal(
    isAllowedWorkspaceAssetObjectKey(`workspace-a/generated/${digest}.png`),
    true
  );
  assert.equal(
    isAllowedWorkspaceAssetObjectKey(`workspace-a/composed/${digest}.mp4`),
    true
  );
  assert.equal(
    isAllowedWorkspaceAssetObjectKey(`workspace-a/composed/${digest}.zip`),
    false
  );
  assert.equal(
    isAllowedWorkspaceAssetObjectKey(`workspace-a/generated/${digest}.zip.png`),
    false
  );
  assert.equal(
    isAllowedWorkspaceAssetObjectKey(
      `workspace-a/generated/../generated/${digest}.zip`
    ),
    false
  );
});
