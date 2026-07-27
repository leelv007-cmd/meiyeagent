import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isAllowedWorkspaceAssetObjectKey,
  workspaceIntakeUploadDigest,
} from './core-asset-path';

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

test('the writable key space is only the intake object that names its own bytes', () => {
  const digest = 'b'.repeat(64);

  assert.equal(
    workspaceIntakeUploadDigest(
      `workspace-a/canvas/assets/intake-${digest}.png`
    ),
    digest
  );
  assert.equal(
    workspaceIntakeUploadDigest(
      `workspace-a/canvas/assets/intake-${digest}.webp`
    ),
    digest
  );
  // Readable, but not writable: an arbitrary canvas asset name would let a
  // merchant overwrite an unrelated object with unverified bytes.
  assert.equal(
    isAllowedWorkspaceAssetObjectKey('workspace-a/canvas/assets/cover.png'),
    true
  );
  assert.equal(
    workspaceIntakeUploadDigest('workspace-a/canvas/assets/cover.png'),
    null
  );
  assert.equal(
    workspaceIntakeUploadDigest(
      `workspace-a/canvas/assets/intake-${digest}.mp4`
    ),
    null
  );
  assert.equal(
    workspaceIntakeUploadDigest(`workspace-a/generated/${digest}.png`),
    null
  );
  assert.equal(
    workspaceIntakeUploadDigest('workspace-a/canvas/assets/intake-short.png'),
    null
  );
});
