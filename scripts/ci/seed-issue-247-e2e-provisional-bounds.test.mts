import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryAdminConfigRepository } from '../../apps/core/src/p1/admin-config/foundation-module.js';
import {
  BOUNDED_EXECUTION_LIMITS_CONFIG_KEY,
  ISSUE_247_RECORDED_PROVISIONAL_LIMITS,
} from '../../apps/core/src/p1/admin-config/bounded-execution-limits.js';
import {
  assertIssue247E2eProvisionalSeedEnabled,
  seedIssue247E2eProvisionalBounds,
} from './seed-issue-247-e2e-provisional-bounds.mts';

test('issue 247 E2E seed requires the explicit provisional-bounds switch', () => {
  assert.throws(
    () => assertIssue247E2eProvisionalSeedEnabled({}),
    /RUN_ISSUE_247_E2E_PROVISIONAL_BOUNDS_SEED=true/u,
  );
  assert.doesNotThrow(() =>
    assertIssue247E2eProvisionalSeedEnabled({
      APP_ENV: 'e2e',
      RUN_ISSUE_247_E2E_PROVISIONAL_BOUNDS_SEED: 'true',
    }),
  );
});

test('issue 247 E2E seed uses repository CAS and is idempotent', async () => {
  const repository = new MemoryAdminConfigRepository();

  const first = await seedIssue247E2eProvisionalBounds(repository);
  const second = await seedIssue247E2eProvisionalBounds(repository);

  assert.equal(first.revision, 1);
  assert.equal(second.revision, 1);
  assert.deepEqual(
    await repository.history(
      'global',
      '__global__',
      BOUNDED_EXECUTION_LIMITS_CONFIG_KEY,
    ),
    [first],
  );
  assert.deepEqual(second.value, ISSUE_247_RECORDED_PROVISIONAL_LIMITS);
});
