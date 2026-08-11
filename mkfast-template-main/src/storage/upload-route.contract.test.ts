import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('active upload clients use the bounded custom route instead of server functions', async () => {
  const [route, fileRoute, productAssets, hook] = await Promise.all([
    readFile(
      new URL('../routes/api/storage/upload.ts', import.meta.url),
      'utf8'
    ),
    readFile(new URL('../routes/api/storage/file.ts', import.meta.url), 'utf8'),
    readFile(new URL('../api/product-assets.ts', import.meta.url), 'utf8'),
    readFile(new URL('../hooks/use-user-files.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(route, /parseBoundedFormData\([\s\S]*request/u);
  assert.doesNotMatch(route, /private_file/u);
  assert.match(route, /uploadAvatar/u);
  assert.doesNotMatch(route, /request\.formData\(/u);
  assert.match(route, /origin !== url\.origin/u);
  assert.match(fileRoute, /isMetadataAvatar/u);
  assert.match(fileRoute, /fileRecord\?\.deletedAt/u);
  assert.match(fileRoute, /legacyAvatarAccessClaims/u);
  assert.match(fileRoute, /isStrictLegacyAvatarKey/u);
  assert.match(fileRoute, /hasActiveLegacyAvatarClaim/u);
  assert.match(fileRoute, /userFiles\.description/u);
  assert.match(fileRoute, /X-Content-SHA256/u);
  assert.match(fileRoute, /\^product-asset:\(\[a-f0-9\]\{64\}\)\$/u);
  assert.doesNotMatch(fileRoute, /isPublicFolder/u);
  assert.match(productAssets, /uploadThroughBoundedRoute/u);
  assert.match(hook, /uploadThroughBoundedRoute/u);
});
