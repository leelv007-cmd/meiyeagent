import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryAdminConfigRepository } from '../../apps/core/src/p1/admin-config/foundation-module.js';
import { platformDefaultModelConfigName } from '../../apps/core/src/p1/foundation/workspace-provision.js';
import {
  PLATFORM_DEFAULT_MODEL_SEED_VALUES,
  platformDefaultModelSeedEntries,
  seedPlatformDefaultModels,
} from './seed-platform-default-models.mts';

test('platform default model seed writes the playwright four-pack once', async () => {
  const repository = new MemoryAdminConfigRepository();
  const first = await seedPlatformDefaultModels(repository);
  const second = await seedPlatformDefaultModels(repository);

  assert.equal(first.length, 4);
  assert.deepEqual(
    first.map((row) => row.key),
    platformDefaultModelSeedEntries().map(([key]) => key),
  );
  assert.deepEqual(
    first.map((row) => row.revision),
    [1, 1, 1, 1],
  );
  assert.deepEqual(
    second.map((row) => row.revision),
    [1, 1, 1, 1],
  );
  assert.equal(
    (await repository.get(
      'global',
      '__global__',
      platformDefaultModelConfigName('copy'),
    ))?.value,
    PLATFORM_DEFAULT_MODEL_SEED_VALUES.copy,
  );
  assert.equal(
    (await repository.get(
      'global',
      '__global__',
      platformDefaultModelConfigName('image'),
    ))?.value,
    'nano-banana-2',
  );
  assert.equal(
    (await repository.get(
      'global',
      '__global__',
      platformDefaultModelConfigName('video'),
    ))?.value,
    'seedance-2',
  );
  assert.equal(
    (await repository.get(
      'global',
      '__global__',
      platformDefaultModelConfigName('audio'),
    ))?.value,
    'audio-speech-fixture',
  );
  assert.equal(
    (
      await repository.history(
        'global',
        '__global__',
        platformDefaultModelConfigName('copy'),
      )
    ).length,
    1,
  );
});
