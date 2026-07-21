import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasActiveLegacyAvatarClaim,
  isStrictLegacyAvatarKey,
  legacyAvatarContentTypeMatches,
} from './legacy-avatar';

const LEGACY_KEY = 'avatars/123e4567-e89b-12d3-a456-426614174000-profile.webp';

test('only the historical single-segment UUID avatar key is legacy-compatible', () => {
  assert.equal(isStrictLegacyAvatarKey(LEGACY_KEY), true);
  assert.equal(
    isStrictLegacyAvatarKey(
      'avatars/123e4567-e89b-12d3-a456-426614174000-___.png'
    ),
    true
  );
  assert.equal(
    isStrictLegacyAvatarKey(
      'avatars/user-1/123e4567-e89b-12d3-a456-426614174000-profile.webp'
    ),
    false
  );
  assert.equal(isStrictLegacyAvatarKey('avatars/anything.png'), false);
  assert.equal(
    isStrictLegacyAvatarKey(
      'userfiles/user-1/123e4567-e89b-12d3-a456-426614174000-profile.webp'
    ),
    false
  );
  assert.equal(
    isStrictLegacyAvatarKey(
      'avatars/123e4567-e89b-12d3-a456-426614174000-profile.svg'
    ),
    false
  );
});

test('legacy avatar compatibility requires the object MIME to match its image extension', () => {
  assert.equal(legacyAvatarContentTypeMatches(LEGACY_KEY, 'image/webp'), true);
  assert.equal(legacyAvatarContentTypeMatches(LEGACY_KEY, 'image/png'), false);
  assert.equal(
    legacyAvatarContentTypeMatches(
      'avatars/123e4567-e89b-12d3-a456-426614174000-profile.jpg',
      'image/jpeg'
    ),
    true
  );
});

test('a legacy avatar can be public only while its migration claim still matches the owner image', () => {
  const claim = {
    imageUrl: `https://app.example.com/api/storage/file?key=${encodeURIComponent(LEGACY_KEY)}`,
    objectKey: LEGACY_KEY,
    userImage: `https://app.example.com/api/storage/file?key=${encodeURIComponent(LEGACY_KEY)}`,
  };
  assert.equal(hasActiveLegacyAvatarClaim(claim, 'image/webp'), true);
  assert.equal(
    hasActiveLegacyAvatarClaim(
      { ...claim, userImage: 'https://cdn.example.com/new-avatar.webp' },
      'image/webp'
    ),
    false
  );
  assert.equal(
    hasActiveLegacyAvatarClaim(
      { ...claim, objectKey: 'avatars/anything.webp' },
      'image/webp'
    ),
    false
  );
});
