import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProductContext, StoreProfilePatch } from '@meiye/contracts';

import { DomainError, ProductService } from './product-service.js';
import { MemoryProductRepository } from './repository.js';

const context: ProductContext = {
  actor: 'user',
  correlationId: 'store-profile-merge',
  userId: 'store-profile-user',
  workspaceId: 'store-profile-workspace',
};

test('a complete revision-zero patch creates the Day-0 store profile and replays once', async () => {
  const repository = new MemoryProductRepository();
  repository.grantMembership(context.userId, context.workspaceId);
  const product = new ProductService({ repository });
  const patch = completePatch();

  const created = await product.mergeStoreProfile(context, patch, 'day-0');
  const replay = await product.mergeStoreProfile(context, patch, 'day-0');

  assert.equal(created.revision, 1);
  assert.equal(replay.revision, 1);
  assert.deepEqual(created.accounts, []);
  assert.deepEqual(created.projects, []);
  assert.deepEqual(created.prohibitions, []);
  await assert.rejects(
    product.mergeStoreProfile(
      context,
      { ...patch, expectedRevision: 0, city: '上海' },
      'stale-day-0',
    ),
    (error) =>
      error instanceof DomainError &&
      error.code === 'STORE_PROFILE_REVISION_CONFLICT' &&
      error.status === 409,
  );
});

test('patch merge upserts stable ids and preserves omitted accounts and legacy unconfirmed projects', async () => {
  const repository = new MemoryProductRepository();
  repository.grantMembership(context.userId, context.workspaceId);
  const product = new ProductService({ repository });
  await product.mergeStoreProfile(
    context,
    {
      ...completePatch(),
      accounts: {
        upsert: [
          { platform: 'xiaohongshu', nickname: '青禾小红书' },
          { platform: 'douyin', nickname: '青禾抖音' },
        ],
      },
      projects: {
        upsert: [
          project('project-a', '透亮猫眼', 299),
          project('project-b', '历史待确认项目', 0),
        ],
      },
    },
    'seed',
  );
  const seeded = await repository.load(context.workspaceId);
  assert.ok(seeded?.store);
  seeded.store.projects[1]!.confirmed = false;
  await repository.save(seeded);

  const merged = await product.mergeStoreProfile(
    context,
    {
      expectedRevision: 1,
      accounts: {
        upsert: [
          { platform: 'xiaohongshu', nickname: '青禾美甲官方号' },
        ],
      },
      projects: {
        upsert: [project('project-a', '透亮猫眼升级版', 329)],
      },
    },
    'merge-one',
  );

  assert.equal(merged.revision, 2);
  assert.deepEqual(
    merged.accounts.map(({ platform, nickname }) => ({ platform, nickname })),
    [
      { platform: 'xiaohongshu', nickname: '青禾美甲官方号' },
      { platform: 'douyin', nickname: '青禾抖音' },
    ],
  );
  assert.deepEqual(
    merged.projects.map(({ id, name, confirmed }) => ({
      id,
      name,
      confirmed,
    })),
    [
      { id: 'project-a', name: '透亮猫眼升级版', confirmed: true },
      { id: 'project-b', name: '历史待确认项目', confirmed: false },
    ],
  );
});

test('per-id clear removes only the named account and project', async () => {
  const repository = new MemoryProductRepository();
  repository.grantMembership(context.userId, context.workspaceId);
  const product = new ProductService({ repository });
  await product.mergeStoreProfile(
    context,
    {
      ...completePatch(),
      accounts: {
        upsert: [
          { platform: 'xiaohongshu', nickname: '青禾小红书' },
          { platform: 'douyin', nickname: '青禾抖音' },
        ],
      },
      projects: {
        upsert: [
          project('project-a', '透亮猫眼', 299),
          project('project-b', '法式渐变', 259),
        ],
      },
    },
    'seed-clear',
  );

  const merged = await product.mergeStoreProfile(
    context,
    {
      expectedRevision: 1,
      accounts: { clear: ['douyin'] },
      projects: { clear: ['project-a'] },
    },
    'clear-one',
  );

  assert.deepEqual(
    merged.accounts.map((account) => account.platform),
    ['xiaohongshu'],
  );
  assert.deepEqual(
    merged.projects.map((item) => item.id),
    ['project-b'],
  );
});

function completePatch(): StoreProfilePatch {
  return {
    expectedRevision: 0,
    name: '青禾美甲',
    city: '杭州',
    district: '拱墅区',
    address: '湖墅南路 88 号',
    booking: '提前一天预约',
    brandVoice: '真实、克制',
    regulated: false,
  };
}

function project(id: string, name: string, price: number) {
  return {
    confirmed: true,
    durationMinutes: 90,
    id,
    name,
    price,
  };
}
