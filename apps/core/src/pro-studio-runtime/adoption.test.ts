import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AdvancedCanvasAdoptionApplicationService,
  MemoryAdvancedCanvasAdoptionRepository,
  type AdvancedCanvasAdoptionSeed,
} from './adoption.js';

const owner = {
  userId: 'owner-1',
  workspaceId: 'workspace-1',
  correlationId: 'correlation-1',
};

function seed(): AdvancedCanvasAdoptionSeed {
  return {
    projects: [
      {
        id: 'project-1',
        workspaceId: owner.workspaceId,
        draftVersion: 7,
        draftNodes: [
          { id: 'text-1', kind: 'text', text: '今天分享奶油白猫眼美甲' },
          {
            id: 'image-1',
            kind: 'image',
            assetId: 'asset-1',
            jobId: 'job-1',
            sourceAssetIds: ['source-1'],
            custody: 'owned',
            deliveryStatus: 'completed',
          },
          {
            id: 'image-2',
            kind: 'image',
            assetId: 'asset-2',
            jobId: 'job-2',
            sourceAssetIds: ['source-2'],
            custody: 'owned',
            deliveryStatus: 'completed',
          },
        ],
        revisions: [
          {
            id: 'revision-1',
            createdAt: '2026-07-16T09:00:00.000Z',
            nodes: [
              { id: 'text-1', kind: 'text', text: '今天分享奶油白猫眼美甲' },
              {
                id: 'image-1',
                kind: 'image',
                assetId: 'asset-1',
                jobId: 'job-1',
                sourceAssetIds: ['source-1'],
                custody: 'owned',
                deliveryStatus: 'completed',
              },
              {
                id: 'image-2',
                kind: 'image',
                assetId: 'asset-2',
                jobId: 'job-2',
                sourceAssetIds: ['source-2'],
                custody: 'owned',
                deliveryStatus: 'completed',
              },
            ],
          },
        ],
      },
    ],
    packages: [],
  };
}

function runtime() {
  const repository = new MemoryAdvancedCanvasAdoptionRepository(seed());
  return {
    repository,
    service: new AdvancedCanvasAdoptionApplicationService(repository, {
      clock: () => new Date('2026-07-16T10:00:00.000Z'),
    }),
  };
}

test('same project revision and ordered selection adopts only once across targets and keys', async () => {
  const { service, repository } = runtime();
  const first = await service.adopt(owner, {
    projectId: 'project-1',
    revisionRef: { kind: 'frozen', revisionId: 'revision-1' },
    selection: {
      textNodeId: 'text-1',
      orderedMediaNodeIds: ['image-1', 'image-2'],
    },
    target: { kind: 'new_package' },
    idempotencyKey: 'adoption-1',
  });
  const replay = await service.adopt(owner, {
    projectId: 'project-1',
    revisionRef: { kind: 'frozen', revisionId: 'revision-1' },
    selection: {
      textNodeId: 'text-1',
      orderedMediaNodeIds: ['image-1', 'image-2'],
    },
    target: {
      kind: 'existing_package',
      packageId: 'some-other-package',
      baseVersionId: 'some-other-version',
    },
    idempotencyKey: 'adoption-2',
  });

  assert.deepEqual(replay, first);
  const state = repository.snapshot(owner.workspaceId);
  assert.equal(state.packages.length, 1);
  assert.equal(state.packages[0]?.versions.length, 1);
  assert.equal(state.adoptions.length, 1);
  assert.equal(state.auditEvents.length, 1);
  assert.deepEqual(state.packages[0]?.source.assetIds, ['asset-1', 'asset-2']);
  assert.deepEqual(state.packages[0]?.versions[0]?.orderedAssetIds, [
    'asset-1',
    'asset-2',
  ]);
  assert.deepEqual(
    state.packages[0]?.versions[0]?.sourceRef.advancedCanvas,
    {
      projectId: 'project-1',
      revisionId: 'revision-1',
      selectedNodeIds: ['text-1', 'image-1', 'image-2'],
      orderedMediaNodeIds: ['image-1', 'image-2'],
      schemaVersion: 1,
    },
  );
});

test('media order is part of business identity and remains unchanged in the package', async () => {
  const { service, repository } = runtime();
  const base = {
    projectId: 'project-1',
    revisionRef: { kind: 'frozen' as const, revisionId: 'revision-1' },
    target: { kind: 'new_package' as const },
  };
  await service.adopt(owner, {
    ...base,
    selection: {
      textNodeId: 'text-1',
      orderedMediaNodeIds: ['image-1', 'image-2'],
    },
    idempotencyKey: 'adoption-1',
  });
  await service.adopt(owner, {
    ...base,
    selection: {
      textNodeId: 'text-1',
      orderedMediaNodeIds: ['image-2', 'image-1'],
    },
    idempotencyKey: 'adoption-2',
  });

  const packages = repository.snapshot(owner.workspaceId).packages;
  assert.equal(packages.length, 2);
  assert.deepEqual(packages[1]?.versions[0]?.orderedAssetIds, [
    'asset-2',
    'asset-1',
  ]);
});

test('ordered media selection preserves repeated nodes and assets verbatim', async () => {
  const { service, repository } = runtime();

  const adopted = await service.adopt(owner, {
    idempotencyKey: 'adoption-repeated-media',
    projectId: 'project-1',
    revisionRef: { kind: 'frozen', revisionId: 'revision-1' },
    selection: {
      textNodeId: 'text-1',
      orderedMediaNodeIds: ['image-1', 'image-1', 'image-2'],
    },
    target: { kind: 'new_package' },
  });

  assert.deepEqual(adopted.orderedMediaNodeIds, [
    'image-1',
    'image-1',
    'image-2',
  ]);
  assert.deepEqual(
    repository.snapshot(owner.workspaceId).packages[0]?.versions[0]
      ?.orderedAssetIds,
    ['asset-1', 'asset-1', 'asset-2'],
  );
});

test('existing package adoption creates a version and rejects a stale base with zero writes', async () => {
  const repository = new MemoryAdvancedCanvasAdoptionRepository({
    ...seed(),
    packages: [
      {
        id: 'package-1',
        workspaceId: owner.workspaceId,
        kind: 'image_text',
        source: { assetIds: ['asset-existing'] },
        versions: [
          {
            id: 'version-1',
            body: '旧文案',
            orderedAssetIds: ['asset-existing'],
            childJobIds: [],
            sourceAssetIds: [],
            sourceRef: {},
            createdAt: '2026-07-16T08:00:00.000Z',
          },
        ],
      },
    ],
  });
  const service = new AdvancedCanvasAdoptionApplicationService(repository);
  const command = {
    projectId: 'project-1',
    revisionRef: { kind: 'frozen' as const, revisionId: 'revision-1' },
    selection: {
      textNodeId: 'text-1',
      orderedMediaNodeIds: ['image-1'],
    },
    target: {
      kind: 'existing_package' as const,
      packageId: 'package-1',
      baseVersionId: 'stale-version',
    },
    idempotencyKey: 'adoption-stale',
  };
  await assert.rejects(
    service.adopt(owner, command),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'CONTENT_VERSION_CONFLICT',
  );
  assert.equal(repository.snapshot(owner.workspaceId).packages[0]?.versions.length, 1);

  const adopted = await service.adopt(owner, {
    ...command,
    target: { ...command.target, baseVersionId: 'version-1' },
    idempotencyKey: 'adoption-current',
  });
  assert.equal(adopted.packageId, 'package-1');
  assert.equal(repository.snapshot(owner.workspaceId).packages[0]?.versions.length, 2);
});

test('freeze_current_draft checks CAS and freezes in the same adoption transaction', async () => {
  const { service, repository } = runtime();
  await assert.rejects(
    service.adopt(owner, {
      projectId: 'project-1',
      revisionRef: {
        kind: 'freeze_current_draft',
        expectedDraftVersion: 6,
      },
      selection: {
        textNodeId: 'text-1',
        orderedMediaNodeIds: ['image-1'],
      },
      target: { kind: 'new_package' },
      idempotencyKey: 'freeze-stale',
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'DRAFT_VERSION_CONFLICT',
  );
  assert.equal(repository.snapshot(owner.workspaceId).projects[0]?.revisions.length, 1);

  const adopted = await service.adopt(owner, {
    projectId: 'project-1',
    revisionRef: { kind: 'freeze_current_draft', expectedDraftVersion: 7 },
    selection: {
      textNodeId: 'text-1',
      orderedMediaNodeIds: ['image-1'],
    },
    target: { kind: 'new_package' },
    idempotencyKey: 'freeze-current',
  });
  assert.notEqual(adopted.revisionId, 'revision-1');
  assert.equal(repository.snapshot(owner.workspaceId).projects[0]?.revisions.length, 2);
});

test('selection rejects non-owned or undelivered media without side effects', async () => {
  const data = seed();
  const project = data.projects[0];
  if (!project) throw new Error('test project missing');
  project.revisions[0]?.nodes.push({
    id: 'image-bad',
    kind: 'image',
    assetId: 'asset-bad',
    jobId: 'job-bad',
    sourceAssetIds: [],
    custody: 'external',
    deliveryStatus: 'accepted',
  });
  const repository = new MemoryAdvancedCanvasAdoptionRepository(data);
  const service = new AdvancedCanvasAdoptionApplicationService(repository);

  await assert.rejects(
    service.adopt(owner, {
      projectId: 'project-1',
      revisionRef: { kind: 'frozen', revisionId: 'revision-1' },
      selection: {
        textNodeId: 'text-1',
        orderedMediaNodeIds: ['image-bad'],
      },
      target: { kind: 'new_package' },
      idempotencyKey: 'adoption-bad',
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'MEDIA_NOT_DELIVERABLE',
  );
  const state = repository.snapshot(owner.workspaceId);
  assert.equal(state.packages.length, 0);
  assert.equal(state.adoptions.length, 0);
});
