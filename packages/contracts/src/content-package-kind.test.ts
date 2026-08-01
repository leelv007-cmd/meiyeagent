import assert from 'node:assert/strict';
import test from 'node:test';

import {
  contentPackageCanonicalKinds,
  contentPackageKindSchema,
  contentPackageLegacyKindAliasMap,
  isContentPackageCanonicalKind,
  normalizeContentPackageKind,
} from './content-package.js';

test('contentPackageKindSchema accepts canonical media/copy/note', () => {
  for (const kind of contentPackageCanonicalKinds) {
    assert.equal(contentPackageKindSchema.parse(kind), kind);
  }
});

test('contentPackageKindSchema still accepts legacy image_text and video aliases', () => {
  assert.equal(contentPackageKindSchema.parse('image_text'), 'image_text');
  assert.equal(contentPackageKindSchema.parse('video'), 'video');
});

test('contentPackageKindSchema rejects unknown kinds', () => {
  assert.equal(contentPackageKindSchema.safeParse('poster').success, false);
  assert.equal(contentPackageKindSchema.safeParse('image').success, false);
});

test('normalizeContentPackageKind maps legacy aliases to media/copy/note', () => {
  assert.equal(normalizeContentPackageKind('image_text'), 'note');
  assert.equal(normalizeContentPackageKind('video'), 'media');
  assert.equal(normalizeContentPackageKind('media'), 'media');
  assert.equal(normalizeContentPackageKind('copy'), 'copy');
  assert.equal(normalizeContentPackageKind('note'), 'note');
  assert.deepEqual(contentPackageLegacyKindAliasMap, {
    image_text: 'note',
    video: 'media',
  });
});

test('isContentPackageCanonicalKind distinguishes canonical from legacy', () => {
  assert.equal(isContentPackageCanonicalKind('media'), true);
  assert.equal(isContentPackageCanonicalKind('copy'), true);
  assert.equal(isContentPackageCanonicalKind('note'), true);
  assert.equal(isContentPackageCanonicalKind('image_text'), false);
  assert.equal(isContentPackageCanonicalKind('video'), false);
});
