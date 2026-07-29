import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AdminConfigFoundationModule,
  HARNESS_WOZ_RECIPE_CONFIG_KEY,
  MemoryAdminConfigRepository,
} from './foundation-module.js';

const context = {
  actor: 'owner' as const,
  correlationId: 'corr-recipe',
  userId: 'owner-a',
  workspaceId: 'workspace-a',
};

test('WOZ recipes use one registered free-form admin-config key with CAS history', async () => {
  const repository = new MemoryAdminConfigRepository();
  const module = new AdminConfigFoundationModule(repository);
  const value = {
    markdown: '# 团购配方',
    arbitraryCalibration: { candidateCount: 3, notes: ['WOZ'] },
  };
  const first = await module.execute({
    context,
    input: {
      action: 'config_apply',
      payload: {
        key: HARNESS_WOZ_RECIPE_CONFIG_KEY,
        value,
        expectedRevision: null,
        reason: 'initial WOZ recipe',
      },
    },
  });
  assert.equal(first.revision, 1);
  assert.deepEqual(first.storedValue, value);

  const history = (await module.query({
    context,
    input: {
      action: 'config_history',
      payload: { key: HARNESS_WOZ_RECIPE_CONFIG_KEY },
    },
  })) as Array<{ scope: string }>;
  assert.equal(history.length, 1);
  assert.equal(history[0]?.scope, 'workspace');
});
