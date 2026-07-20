import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  contentPackageSchema,
  reviseContentPackageVisualsCommandSchema,
} from '@meiye/contracts';

import type { P1Context } from '../foundation/domain.js';
import { VisualAdoptionError } from './errors.js';
import { ResultDeliveryFoundationModule } from './foundation-module.js';
import {
  MemoryFirstAdoptPort,
  MemoryVisualAdoptionStore,
  VisualAdoptionService,
  type VisualAssetRecord,
} from './visual-adoption.js';

const context: P1Context = {
  correlationId: 'corr-visual-adoption',
  userId: 'owner-1',
  workspaceId: 'workspace-1',
};

const moduleDir = dirname(fileURLToPath(import.meta.url));

function imageAsset(
  id: string,
  workspaceId = context.workspaceId,
): VisualAssetRecord {
  return {
    contentType: 'image/jpeg',
    id,
    kind: 'image',
    objectKey: `objects/${id}.jpg`,
    sha256: `sha-${id}`,
    sizeBytes: 1024,
    workspaceId,
  };
}

function buildService(clock = () => '2026-07-20T12:00:00.000Z') {
  const store = new MemoryVisualAdoptionStore();
  for (const id of ['img-1', 'img-2', 'img-3', 'img-4']) {
    store.putVisualAsset(imageAsset(id));
  }
  store.putVisualAsset({
    contentType: 'video/mp4',
    id: 'vid-1',
    kind: 'video',
    objectKey: 'objects/vid-1.mp4',
    sha256: 'sha-vid-1',
    workspaceId: context.workspaceId,
  });
  const firstAdopt = new MemoryFirstAdoptPort(store, clock);
  const service = new VisualAdoptionService(store, firstAdopt, { clock });
  return { firstAdopt, service, store };
}

test('first adopt create-if-absent is idempotent and does not create a second package', async () => {
  const { service, store } = buildService();
  const command = {
    copyCandidateAssetId: 'copy-1',
    visualAssetIds: ['img-2', 'img-1'],
    workId: 'work-1',
  };

  const first = await service.firstAdopt(context, command, 'adopt-key-1');
  const replay = await service.firstAdopt(context, command, 'adopt-key-1');
  const againSameWork = await service.firstAdopt(
    context,
    { ...command, visualAssetIds: ['img-1'] },
    'adopt-key-other',
  );

  assert.equal(first.id, replay.id);
  assert.equal(first.revision, replay.revision);
  assert.equal(first.currentVersionId, replay.currentVersionId);
  assert.equal(first.status, 'accepted');
  assert.equal(first.kind, 'image_text');
  assert.equal(first.versions[0]?.orderedAssetIds.length, 2);
  // create-if-absent: same work returns the original package, not a second one
  assert.equal(againSameWork.id, first.id);
  const packages = await store.listPackages(context.workspaceId);
  assert.equal(packages.length, 1);
  assert.doesNotThrow(() => contentPackageSchema.parse(first));
});

test('revise creates one derived immutable version and bumps revision', async () => {
  const { service } = buildService();
  const adopted = await service.firstAdopt(
    context,
    {
      copyCandidateAssetId: 'copy-1',
      title: '原标题',
      body: '原文案',
      visualAssetIds: ['img-1', 'img-2'],
      workId: 'work-revise',
    },
    'first-adopt-revise',
  );

  const revised = await service.reviseContentPackageVisuals(
    context,
    {
      baseVersionId: adopted.currentVersionId!,
      expectedRevision: adopted.revision,
      orderedVisualAssetIds: ['img-3', 'img-1'],
      packageId: adopted.id,
      roleAction: 'replace_set',
    },
    'revise-key-1',
  );

  assert.equal(revised.revision, adopted.revision + 1);
  assert.notEqual(revised.currentVersionId, adopted.currentVersionId);
  assert.equal(revised.versions.length, 2);
  const derived = revised.versions.at(-1);
  assert.ok(derived);
  assert.equal(derived.derivedFromVersionId, adopted.currentVersionId);
  assert.equal(derived.title, '原标题');
  assert.equal(derived.body, '原文案');
  assert.equal(derived.orderedAssetIds.length, 2);
  assert.equal(derived.source, 'merchant_edited');
  // media version nodes carry parent/source lineage
  const owned = revised.generated.ownedAssets ?? [];
  for (const mediaId of derived.orderedAssetIds) {
    const node = owned.find((asset) => asset.id === mediaId);
    assert.ok(node, `missing media version node ${mediaId}`);
    assert.ok(node.sourceAssetId);
  }
  assert.equal(
    owned.find((asset) => asset.id === derived.orderedAssetIds[0])
      ?.sourceAssetId,
    'img-3',
  );
});

test('idempotent revise replay returns same package and revision', async () => {
  const { service } = buildService();
  const adopted = await service.firstAdopt(
    context,
    {
      copyCandidateAssetId: 'copy-1',
      visualAssetIds: ['img-1'],
      workId: 'work-idem-revise',
    },
    'first-for-idem-revise',
  );

  const command = {
    baseVersionId: adopted.currentVersionId!,
    expectedRevision: adopted.revision,
    orderedVisualAssetIds: ['img-2', 'img-1'],
    packageId: adopted.id,
  };
  const first = await service.reviseContentPackageVisuals(
    context,
    command,
    'revise-idem-1',
  );
  const replay = await service.reviseContentPackageVisuals(
    context,
    command,
    'revise-idem-1',
  );

  assert.equal(replay.id, first.id);
  assert.equal(replay.revision, first.revision);
  assert.equal(replay.currentVersionId, first.currentVersionId);
  assert.equal(replay.versions.length, first.versions.length);
});

test('OCC mismatch throws 409 CONTENT_PACKAGE_REVISION_CONFLICT', async () => {
  const { service } = buildService();
  const adopted = await service.firstAdopt(
    context,
    {
      copyCandidateAssetId: 'copy-1',
      visualAssetIds: ['img-1'],
      workId: 'work-occ',
    },
    'first-occ',
  );

  await assert.rejects(
    () =>
      service.reviseContentPackageVisuals(context, {
        baseVersionId: adopted.currentVersionId!,
        expectedRevision: adopted.revision + 5,
        orderedVisualAssetIds: ['img-2'],
        packageId: adopted.id,
      }),
    (error: unknown) =>
      error instanceof VisualAdoptionError &&
      error.code === 'CONTENT_PACKAGE_REVISION_CONFLICT' &&
      error.status === 409,
  );
});

test('stale baseVersionId throws 409 CONTENT_PACKAGE_VERSION_CONFLICT', async () => {
  const { service } = buildService();
  const adopted = await service.firstAdopt(
    context,
    {
      copyCandidateAssetId: 'copy-1',
      visualAssetIds: ['img-1'],
      workId: 'work-stale-base',
    },
    'first-stale-base',
  );
  const once = await service.reviseContentPackageVisuals(
    context,
    {
      baseVersionId: adopted.currentVersionId!,
      expectedRevision: adopted.revision,
      orderedVisualAssetIds: ['img-2'],
      packageId: adopted.id,
    },
    'revise-once',
  );

  await assert.rejects(
    () =>
      service.reviseContentPackageVisuals(context, {
        baseVersionId: adopted.currentVersionId!,
        expectedRevision: once.revision,
        orderedVisualAssetIds: ['img-3'],
        packageId: adopted.id,
      }),
    (error: unknown) =>
      error instanceof VisualAdoptionError &&
      error.code === 'CONTENT_PACKAGE_VERSION_CONFLICT' &&
      error.status === 409,
  );
});

test('image_text rejects empty, duplicate, and non-image visuals', async () => {
  const { service } = buildService();

  await assert.rejects(
    () =>
      service.firstAdopt(context, {
        copyCandidateAssetId: 'copy-1',
        visualAssetIds: [],
        workId: 'work-empty',
      }),
    (error: unknown) =>
      error instanceof VisualAdoptionError &&
      error.code === 'VISUAL_ASSET_REQUIRED' &&
      error.status === 400,
  );

  await assert.rejects(
    () =>
      service.firstAdopt(context, {
        copyCandidateAssetId: 'copy-1',
        visualAssetIds: ['img-1', 'img-1'],
        workId: 'work-dup',
      }),
    (error: unknown) =>
      error instanceof VisualAdoptionError &&
      error.code === 'DUPLICATE_VISUAL_ASSET' &&
      error.status === 400,
  );

  await assert.rejects(
    () =>
      service.firstAdopt(context, {
        copyCandidateAssetId: 'copy-1',
        visualAssetIds: ['vid-1'],
        workId: 'work-video',
      }),
    (error: unknown) =>
      error instanceof VisualAdoptionError &&
      error.code === 'INVALID_VISUAL_ASSET' &&
      error.status === 409,
  );

  const adopted = await service.firstAdopt(
    context,
    {
      copyCandidateAssetId: 'copy-1',
      visualAssetIds: ['img-1'],
      workId: 'work-revise-validate',
    },
    'first-validate',
  );

  await assert.rejects(
    () =>
      service.reviseContentPackageVisuals(context, {
        baseVersionId: adopted.currentVersionId!,
        expectedRevision: adopted.revision,
        orderedVisualAssetIds: ['vid-1'],
        packageId: adopted.id,
      }),
    (error: unknown) =>
      error instanceof VisualAdoptionError &&
      error.code === 'INVALID_VISUAL_ASSET',
  );
});

test('ResultDeliveryFoundationModule wires first adopt and revise with idempotency', async () => {
  const { service } = buildService();
  const module = new ResultDeliveryFoundationModule(service);

  const adoptInput = {
    action: 'adopt_into_content_package',
    payload: {
      copyCandidateAssetId: 'copy-1',
      visualAssetIds: ['img-1', 'img-2'],
      workId: 'work-module',
    },
  };
  const adopted = (await module.execute({
    context,
    idempotencyKey: 'mod-adopt-1',
    input: adoptInput,
  })) as Awaited<ReturnType<typeof service.firstAdopt>>;
  const adoptReplay = (await module.execute({
    context,
    idempotencyKey: 'mod-adopt-1',
    input: adoptInput,
  })) as typeof adopted;

  assert.equal(adoptReplay.id, adopted.id);
  assert.equal(adoptReplay.revision, adopted.revision);

  const reviseInput = {
    action: 'revise_content_package_visuals',
    payload: {
      baseVersionId: adopted.currentVersionId,
      expectedRevision: adopted.revision,
      orderedVisualAssetIds: ['img-3'],
      packageId: adopted.id,
    },
  };
  const revised = (await module.execute({
    context,
    idempotencyKey: 'mod-revise-1',
    input: reviseInput,
  })) as Awaited<ReturnType<typeof service.reviseContentPackageVisuals>>;
  const reviseReplay = (await module.execute({
    context,
    idempotencyKey: 'mod-revise-1',
    input: reviseInput,
  })) as typeof revised;

  assert.equal(reviseReplay.revision, revised.revision);
  assert.equal(reviseReplay.currentVersionId, revised.currentVersionId);
  assert.equal(revised.revision, adopted.revision + 1);
});

test('revise_content_package_visuals command schema accepts required fields', () => {
  assert.equal(
    reviseContentPackageVisualsCommandSchema.safeParse({
      baseVersionId: 'v1',
      expectedRevision: 1,
      orderedVisualAssetIds: ['a'],
      packageId: 'pkg-1',
      roleAction: 'set_cover',
    }).success,
    true,
  );
  assert.equal(
    reviseContentPackageVisualsCommandSchema.safeParse({
      baseVersionId: 'v1',
      expectedRevision: 1,
      orderedVisualAssetIds: [],
      packageId: 'pkg-1',
    }).success,
    false,
  );
});

test('visual-adoption write path never references attach_content_package_generation', () => {
  const sources = [
    'visual-adoption.ts',
    'foundation-module.ts',
    'role-action-compiler.ts',
    'index.ts',
  ].map((name) => readFileSync(join(moduleDir, name), 'utf8'));

  for (const source of sources) {
    assert.equal(source.includes('attach_content_package_generation'), false);
    assert.equal(source.includes('attachContentPackageGeneration'), false);
  }
});
