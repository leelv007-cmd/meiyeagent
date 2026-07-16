import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMobileUploadSession,
  markMobileUploadPersisted,
  resumeMobileUploadSession,
} from './mobile-upload-session';

const file = {
  name: 'store-front.png',
  sha256: 'a'.repeat(64),
  size: 128,
  type: 'image/png',
};

test('keeps a stable upload and Asset identity across an interrupted retry', () => {
  const session = createMobileUploadSession(file, 'upload-stable-a');
  const interrupted = { ...session, phase: 'interrupted' as const };
  const resumed = resumeMobileUploadSession(interrupted, file);

  assert.equal(resumed.uploadId, 'upload-stable-a');
  assert.equal(resumed.assetId, 'asset-mobile-upload-stable-a');
  assert.equal(resumed.phase, 'uploading');
});

test('rejects different bytes with identical file metadata and exposes Asset only after persistence', () => {
  const session = createMobileUploadSession(file, 'upload-stable-b');

  assert.throws(
    () =>
      resumeMobileUploadSession(session, {
        ...file,
        sha256: 'b'.repeat(64),
      }),
    /同一文件/
  );
  assert.equal(session.persistedAssetId, undefined);

  const persisted = markMobileUploadPersisted(
    session,
    'workspace-a/assets/store-front.png'
  );
  assert.equal(persisted.phase, 'persisted');
  assert.equal(persisted.persistedAssetId, 'asset-mobile-upload-stable-b');
  assert.equal(persisted.objectKey, 'workspace-a/assets/store-front.png');
});
