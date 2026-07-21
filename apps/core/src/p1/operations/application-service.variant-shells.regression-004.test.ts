import assert from 'node:assert/strict';
import test from 'node:test';

import { hasOnlySeededPlatformVariantShells } from './application-service.js';

test('formal platform adaptation may replace only the three seeded export shells', () => {
  const currentVersion = { id: 'base-version' } as Parameters<
    typeof hasOnlySeededPlatformVariantShells
  >[1];
  const seeded = {
    variants: ['xiaohongshu', 'douyin', 'video_account'].map((platform) => ({
      currentVersionId: `base-version:${platform}`,
      id: `package:${platform}`,
      platform,
      versions: [{ id: `base-version:${platform}` }],
    })),
  } as Parameters<typeof hasOnlySeededPlatformVariantShells>[0];

  assert.equal(
    hasOnlySeededPlatformVariantShells(seeded, currentVersion),
    true
  );

  const formal = structuredClone(seeded);
  formal.variants[0]!.currentVersionId = 'package-xiaohongshu-formal';
  formal.variants[0]!.versions[0]!.id = 'package-xiaohongshu-formal';

  assert.equal(
    hasOnlySeededPlatformVariantShells(formal, currentVersion),
    false
  );
});
