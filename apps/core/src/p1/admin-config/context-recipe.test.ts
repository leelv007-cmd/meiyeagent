import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AdminConfigFoundationModule,
  HARNESS_WOZ_RECIPE_CONFIG_KEY,
  MemoryAdminConfigRepository,
} from './foundation-module.js';
import { MemoryContextBundleRepository } from '../operations/context-bundle-repository.js';
import { ContextFoundationModule } from '../operations/context-foundation-module.js';
import { MemoryContextSourceRevisionRepository } from '../operations/context-source-revisions.js';
import { MemoryStoreFactLedger } from '../operations/store-fact-ledger.js';

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

test('context fences derive the recipe source revision from applied config history', async () => {
  const repository = new MemoryAdminConfigRepository();
  const admin = new AdminConfigFoundationModule(repository);
  const contextModule = new ContextFoundationModule(
    new MemoryStoreFactLedger(),
    new MemoryContextBundleRepository(),
    new MemoryContextSourceRevisionRepository(),
    () => '2026-07-18T03:00:00.000Z',
    async (workspaceId) =>
      (
        await repository.get(
          'workspace',
          workspaceId,
          HARNESS_WOZ_RECIPE_CONFIG_KEY,
        )
      )?.revision ?? 0,
  );
  const applyRecipe = (value: unknown, expectedRevision: number | null) =>
    admin.execute({
      context,
      input: {
        action: 'config_apply',
        payload: {
          key: HARNESS_WOZ_RECIPE_CONFIG_KEY,
          value,
          expectedRevision,
          reason: 'update WOZ recipe',
        },
      },
    });

  await applyRecipe({ markdown: 'recipe v1' }, null);
  await contextModule.execute({
    context,
    idempotencyKey: 'compile-recipe-v1',
    input: {
      action: 'context_bundle_compile',
      payload: {
        bundleId: 'bundle-recipe',
        taskId: 'task-recipe',
        scope: { storeId: 'store-a' },
        at: '2026-07-18T03:00:00.000Z',
        expectedRevision: 0,
        contributions: [],
        reason: 'compile with recipe v1',
      },
    },
  });
  await applyRecipe({ markdown: 'recipe v2' }, 1);

  const fence = (await contextModule.query({
    context,
    input: {
      action: 'context_bundle_fence',
      payload: {
        bundleId: 'bundle-recipe',
        scope: { storeId: 'store-a' },
        at: '2026-07-18T03:00:00.000Z',
      },
    },
  })) as { stale: boolean; changedSources: string[] };
  assert.equal(fence.stale, true);
  assert.deepEqual(fence.changedSources, ['recipe']);
});
