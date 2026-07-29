import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

function source(relativePath: string) {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    'utf8'
  );
}

const worksurfaceModel = source('./video-worksurface-model.ts');
const worksurface = source('./video-worksurface.tsx');
test('D-133 keeps every video regeneration scope outside the frontend', () => {
  for (const [name, contents] of [
    ['Web worksurface model', worksurfaceModel],
    ['Web quote request contract', worksurface],
  ] as const) {
    assert.doesNotMatch(
      contents,
      /\b(full_compose|classifyShotRegen|requestShotRegen)\b/,
      `${name} must not revive a retired video regeneration scope`
    );
  }

  assert.match(worksurfaceModel, /videoBillableScopes\s*=\s*\[\]\s+as const/);
});

test('D-133 removes the core video regeneration runtime family', () => {
  for (const relativePath of [
    '../../../../../apps/core/src/p1/model-supply/video-regeneration.ts',
    '../../../../../apps/core/src/p1/model-supply/video-regeneration-foundation.ts',
    '../../../../../apps/core/src/p1/model-supply/video-regeneration-runtime.ts',
    '../../../../../apps/core/src/p1/model-supply/video-regeneration-postgres.ts',
  ]) {
    assert.equal(
      existsSync(fileURLToPath(new URL(relativePath, import.meta.url))),
      false,
      `${relativePath} must be retired`
    );
  }
});
