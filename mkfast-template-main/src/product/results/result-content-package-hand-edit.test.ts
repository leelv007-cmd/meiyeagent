import assert from 'node:assert/strict';
import test from 'node:test';

import type { ContentPackage } from '@meiye/contracts';

import {
  buildResultContentPackageHandEditCommand,
  executeResultContentPackageHandEdit,
  findResultContentPackageHandEditVersion,
  resolveResultContentPackageHandEditPlatform,
} from './result-content-package-hand-edit';

const contentPackage = {
  id: 'pkg-1',
  revision: 7,
  currentVersionId: 'version-7',
  versions: [
    {
      id: 'version-7',
      createdAt: '2026-07-20T00:00:00.000Z',
      body: '原正文',
      conversionHook: '原 CTA',
      orderedAssetIds: ['image-1', 'image-2'],
      title: '原标题',
      topics: ['美甲'],
    },
  ],
  variants: [
    {
      currentVersionId: 'xiaohongshu-version-2',
      id: 'pkg-1-xiaohongshu',
      platform: 'xiaohongshu',
      versions: [
        {
          id: 'xiaohongshu-version-2',
          createdAt: '2026-07-20T01:00:00.000Z',
          body: '小红书原正文',
          conversionHook: '小红书原 CTA',
          orderedAssetIds: ['image-2'],
          title: '小红书原标题',
          topics: ['小红书美甲'],
        },
      ],
    },
  ],
} satisfies Pick<
  ContentPackage,
  'currentVersionId' | 'id' | 'revision' | 'variants' | 'versions'
>;

test('hand edit compiles to the existing Operations ContentPackage OCC command', () => {
  const command = buildResultContentPackageHandEditCommand({
    contentPackage,
    changes: { title: '手改标题', body: '手改正文' },
    idempotencyKey: 'result-hand-edit:pkg-1:7:attempt-1',
  });

  assert.equal(command.action, 'edit_content_package_version');
  assert.equal(command.idempotencyKey, 'result-hand-edit:pkg-1:7:attempt-1');
  assert.deepEqual(command.payload, {
    baseVersionId: 'version-7',
    changes: {
      body: '手改正文',
      conversionHook: '原 CTA',
      orderedAssetIds: ['image-1', 'image-2'],
      title: '手改标题',
      topics: ['美甲'],
    },
    expectedRevision: 7,
    packageId: 'pkg-1',
  });
  assert.equal('result' in command.payload, false);
  assert.equal('resultRevision' in command.payload, false);
});

test('platform hand edit binds OCC to the selected delivery variant', () => {
  assert.equal(
    resolveResultContentPackageHandEditPlatform(contentPackage, 'xiaohongshu'),
    'xiaohongshu'
  );
  assert.equal(
    findResultContentPackageHandEditVersion(contentPackage, 'xiaohongshu')?.id,
    'xiaohongshu-version-2'
  );
  const command = buildResultContentPackageHandEditCommand({
    contentPackage,
    changes: { body: '小红书手改正文' },
    idempotencyKey: 'result-hand-edit:pkg-1:7:xiaohongshu',
    platform: 'xiaohongshu',
  });

  assert.deepEqual(command.payload, {
    baseVersionId: 'xiaohongshu-version-2',
    changes: {
      body: '小红书手改正文',
      conversionHook: '小红书原 CTA',
      orderedAssetIds: ['image-2'],
      title: '小红书原标题',
      topics: ['小红书美甲'],
    },
    expectedRevision: 7,
    packageId: 'pkg-1',
    platform: 'xiaohongshu',
  });
});

test('a package without variants keeps the canonical edit target', () => {
  const canonicalOnly = { ...contentPackage, variants: [] };
  const platform = resolveResultContentPackageHandEditPlatform(
    canonicalOnly,
    'xiaohongshu'
  );

  assert.equal(platform, undefined);
  assert.equal(
    findResultContentPackageHandEditVersion(canonicalOnly, platform)?.id,
    'version-7'
  );
});

test('execute dispatches the OCC write once and returns the canonical package response', async () => {
  const calls: unknown[] = [];
  const updated = { ...contentPackage, revision: 8 };

  const result = await executeResultContentPackageHandEdit(
    {
      contentPackage,
      changes: { conversionHook: '新 CTA' },
      idempotencyKey: 'idem-1',
    },
    async (action, payload, idempotencyKey) => {
      calls.push({ action, payload, idempotencyKey });
      return updated;
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(result.revision, 8);
});

test('stale OCC errors are propagated and never converted into a local result revision', async () => {
  const conflict = Object.assign(new Error('ContentPackage revision changed'), {
    code: 'CONTENT_PACKAGE_REVISION_CONFLICT',
  });

  await assert.rejects(
    executeResultContentPackageHandEdit(
      {
        contentPackage,
        changes: { title: '冲突手改' },
        idempotencyKey: 'idem-stale',
      },
      async () => {
        throw conflict;
      }
    ),
    (error: unknown) => error === conflict
  );
});

test('missing canonical current version is rejected before dispatch', async () => {
  await assert.rejects(
    executeResultContentPackageHandEdit(
      {
        contentPackage: { ...contentPackage, currentVersionId: 'missing' },
        changes: { title: '不应写入' },
        idempotencyKey: 'idem-invalid',
      },
      async () => {
        throw new Error('transport must not run');
      }
    ),
    /current ContentPackage edit version was not found/
  );
});

test('missing selected delivery variant is rejected before dispatch', async () => {
  const platform = resolveResultContentPackageHandEditPlatform(
    contentPackage,
    'douyin'
  );
  assert.equal(platform, 'douyin');
  assert.equal(
    findResultContentPackageHandEditVersion(contentPackage, platform),
    undefined
  );
  await assert.rejects(
    executeResultContentPackageHandEdit(
      {
        contentPackage,
        changes: { title: '不应写入' },
        idempotencyKey: 'idem-missing-platform',
        ...(platform ? { platform } : {}),
      },
      async () => {
        throw new Error('transport must not run');
      }
    ),
    /current ContentPackage edit version was not found/
  );
});
