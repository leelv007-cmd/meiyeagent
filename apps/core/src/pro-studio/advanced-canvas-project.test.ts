import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AdvancedCanvasProjectError,
  AdvancedCanvasProjectService,
  MemoryAdvancedCanvasProjectRepository,
  type CanvasGraph,
} from './advanced-canvas-project.js';

const graph = (assetId = 'asset-1'): CanvasGraph => ({
  schemaVersion: 1,
  nodes: [
    {
      id: 'image-1',
      type: 'image',
      data: { assetId },
    },
  ],
  edges: [],
});

function fixture() {
  let id = 0;
  let current = new Date('2026-07-16T08:00:00.000Z');
  const repository = new MemoryAdvancedCanvasProjectRepository();
  const service = new AdvancedCanvasProjectService({
    repository,
    clock: () => current,
    nextId: (kind) => `${kind}-${++id}`,
  });
  return {
    repository,
    service,
    tick(value: string) {
      current = new Date(value);
    },
  };
}

test('creates, lists and loads projects only inside the trusted workspace', async () => {
  const { repository, service } = fixture();
  const created = await service.createProject(
    { userId: 'user-1', workspaceId: 'workspace-1' },
    { name: 'Campaign', graph: graph() }
  );

  assert.equal(created.draftVersion, 1);
  assert.deepEqual(
    (
      await service.listProjects({
        userId: 'user-1',
        workspaceId: 'workspace-1',
      })
    ).map(({ id }) => id),
    [created.id]
  );
  assert.equal(
    (
      await service.listProjects({
        userId: 'user-2',
        workspaceId: 'workspace-2',
      })
    ).length,
    0
  );
  await assert.rejects(
    service.loadProject(
      { userId: 'user-2', workspaceId: 'workspace-2' },
      created.id
    ),
    (error: unknown) =>
      error instanceof AdvancedCanvasProjectError && error.code === 'NOT_FOUND'
  );
  assert.equal(repository.inspectAudit()[0]?.action, 'project_access_denied');
  assert.equal(repository.inspectAudit()[0]?.objectKind, 'project');
  assert.equal(repository.inspectAudit()[0]?.objectId, created.id);
});

test('missing revisions leave a revision_access_denied audit without leaking existence', async () => {
  const { service, repository } = fixture();
  const owner = { userId: 'user-1', workspaceId: 'workspace-1' };
  const created = await service.createProject(owner, {
    name: 'Campaign',
    graph: graph(),
  });
  const checkpoint = await service.createCheckpoint(owner, {
    expectedDraftVersion: created.draftVersion,
    projectId: created.id,
  });
  await assert.rejects(
    service.getRevision(
      { userId: 'user-2', workspaceId: 'workspace-2' },
      created.id,
      checkpoint.id
    ),
    (error: unknown) =>
      error instanceof AdvancedCanvasProjectError && error.code === 'NOT_FOUND'
  );
  assert.equal(repository.inspectAudit()[0]?.action, 'project_access_denied');
  await assert.rejects(
    service.getRevision(owner, created.id, 'revision-missing'),
    (error: unknown) =>
      error instanceof AdvancedCanvasProjectError && error.code === 'NOT_FOUND'
  );
  assert.equal(repository.inspectAudit().at(-1)?.action, 'revision_access_denied');
  assert.equal(repository.inspectAudit().at(-1)?.objectId, 'revision-missing');
});

test('autosave uses draftVersion CAS and a stale writer has zero side effects', async () => {
  const { service } = fixture();
  const context = { userId: 'user-1', workspaceId: 'workspace-1' };
  const created = await service.createProject(context, {
    name: 'Campaign',
    graph: graph(),
  });

  const saved = await service.saveProjectDraft(context, {
    projectId: created.id,
    expectedDraftVersion: 1,
    graph: graph('asset-2'),
  });
  assert.equal(saved.draftVersion, 2);
  await assert.rejects(
    service.saveProjectDraft(context, {
      projectId: created.id,
      expectedDraftVersion: 1,
      graph: graph('asset-stale'),
    }),
    (error: unknown) =>
      error instanceof AdvancedCanvasProjectError &&
      error.code === 'DRAFT_VERSION_CONFLICT'
  );
  assert.deepEqual(
    (await service.loadProject(context, created.id)).graph,
    graph('asset-2')
  );
});

test('checkpoints are immutable and restore opens their graph as a new draft', async () => {
  const { service, tick } = fixture();
  const context = { userId: 'user-1', workspaceId: 'workspace-1' };
  const project = await service.createProject(context, {
    name: 'Campaign',
    graph: graph('asset-before'),
  });
  const revision = await service.createCheckpoint(context, {
    projectId: project.id,
    expectedDraftVersion: 1,
    label: 'Approved direction',
  });
  await service.saveProjectDraft(context, {
    projectId: project.id,
    expectedDraftVersion: 1,
    graph: graph('asset-after'),
  });
  tick('2026-07-16T09:00:00.000Z');
  const restored = await service.restoreRevision(context, {
    projectId: project.id,
    revisionId: revision.id,
    expectedDraftVersion: 2,
  });

  assert.equal(restored.draftVersion, 3);
  assert.deepEqual(restored.graph, graph('asset-before'));
  assert.deepEqual(
    (await service.getRevision(context, project.id, revision.id)).graph,
    graph('asset-before')
  );
  assert.equal((await service.listRevisions(context, project.id)).length, 1);
});

test('duplicate copies only the current graph and asset references', async () => {
  const { service } = fixture();
  const context = { userId: 'user-1', workspaceId: 'workspace-1' };
  const project = await service.createProject(context, {
    name: 'Campaign',
    graph: graph('asset-shared'),
  });
  await service.createCheckpoint(context, {
    projectId: project.id,
    expectedDraftVersion: 1,
  });

  const copy = await service.duplicateProject(context, {
    projectId: project.id,
    name: 'Campaign copy',
  });
  assert.equal(copy.draftVersion, 1);
  assert.deepEqual(copy.graph, graph('asset-shared'));
  assert.equal((await service.listRevisions(context, copy.id)).length, 0);
});

test('delete is soft and removes the project from active reads', async () => {
  const { repository, service } = fixture();
  const context = { userId: 'user-1', workspaceId: 'workspace-1' };
  const project = await service.createProject(context, {
    name: 'Campaign',
    graph: graph(),
  });

  const deleted = await service.deleteProject(context, project.id);
  assert.equal(deleted.retentionDays, 30);

  assert.equal((await service.listProjects(context)).length, 0);
  assert.ok(repository.inspectProjects()[0]?.deletedAt);
  await assert.rejects(
    service.loadProject(context, project.id),
    (error: unknown) =>
      error instanceof AdvancedCanvasProjectError && error.code === 'NOT_FOUND'
  );
});

test('soft-deleted projects are hard-purged after the retention window', async () => {
  let id = 0;
  let current = new Date('2026-07-16T08:00:00.000Z');
  const repository = new MemoryAdvancedCanvasProjectRepository();
  const service = new AdvancedCanvasProjectService({
    repository,
    softDeleteRetentionDays: 7,
    clock: () => current,
    nextId: (kind) => `${kind}-${++id}`,
  });
  const context = { userId: 'user-1', workspaceId: 'workspace-1' };
  const project = await service.createProject(context, {
    name: 'Campaign',
    graph: graph(),
  });
  await service.deleteProject(context, project.id);
  assert.equal(repository.inspectProjects().length, 1);

  current = new Date('2026-07-20T08:00:00.000Z');
  assert.deepEqual(await service.purgeExpiredDeletedProjects(context), []);
  assert.equal(repository.inspectProjects().length, 1);

  current = new Date('2026-07-24T08:00:00.000Z');
  assert.deepEqual(await service.purgeExpiredDeletedProjects(context), [
    project.id,
  ]);
  assert.equal(repository.inspectProjects().length, 0);
});
