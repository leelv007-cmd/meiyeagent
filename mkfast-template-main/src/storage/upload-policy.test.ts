import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveUploadPolicy, validateUploadPolicy } from './upload-policy';

test('only the server-owned avatar purpose creates a public object', () => {
  assert.deepEqual(resolveUploadPolicy('avatar'), {
    allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp'],
    folder: 'avatars',
    isPublic: true,
    maxBytes: 2 * 1024 * 1024,
  });
  assert.equal(resolveUploadPolicy('private_file').isPublic, false);
  assert.equal(resolveUploadPolicy('product_asset').isPublic, false);
});

test('avatar validation rejects a declared image when its signature differs', () => {
  assert.throws(
    () =>
      validateUploadPolicy({
        bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        contentType: 'image/jpeg',
        purpose: 'avatar',
        size: 4,
      }),
    /signature/u
  );
});

test('avatar validation rejects images whose encoded dimensions exceed the limit', () => {
  const oversizedPng = new Uint8Array(24);
  oversizedPng.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  oversizedPng.set([0x00, 0x00, 0x13, 0x89], 16);
  oversizedPng.set([0x00, 0x00, 0x00, 0x01], 20);

  assert.throws(
    () =>
      validateUploadPolicy({
        bytes: oversizedPng,
        contentType: 'image/png',
        purpose: 'avatar',
        size: oversizedPng.byteLength,
      }),
    /dimensions/u
  );
});

test('avatar validation accepts a bounded PNG with matching signature and dimensions', () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  png.set([0x00, 0x00, 0x02, 0x00], 16);
  png.set([0x00, 0x00, 0x02, 0x00], 20);

  assert.doesNotThrow(() =>
    validateUploadPolicy({
      bytes: png,
      contentType: 'image/png',
      purpose: 'avatar',
      size: png.byteLength,
    })
  );
});
