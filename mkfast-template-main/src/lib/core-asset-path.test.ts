import assert from 'node:assert/strict';
import test from 'node:test';

import { isAllowedWorkspaceAssetObjectKey } from './core-asset-path';

test('allows generated and product asset key shapes without nested paths', () => {
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
    isAllowedWorkspaceAssetObjectKey(`workspace-a/owned/${digest}.webp`),
    true
  );
  assert.equal(
    isAllowedWorkspaceAssetObjectKey(`workspace-a/generated/${digest}.mp3`),
    true
  );
  assert.equal(
    isAllowedWorkspaceAssetObjectKey('workspace-a/canvas/assets/cover.png'),
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
    isAllowedWorkspaceAssetObjectKey(
      `workspace-a/assets/user-a/${digest}.webp`
    ),
    true
  );
  assert.equal(
    isAllowedWorkspaceAssetObjectKey(
      'workspace-a/assets/user-a/legacy-store-front.png'
    ),
    true
  );
  assert.equal(
    isAllowedWorkspaceAssetObjectKey(`workspace-a/assets/user-a/${digest}.pdf`),
    false
  );
  assert.equal(
    isAllowedWorkspaceAssetObjectKey(
      'workspace-a/assets/user-a/nested/asset.png'
    ),
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
