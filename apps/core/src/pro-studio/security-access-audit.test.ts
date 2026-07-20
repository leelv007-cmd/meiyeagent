import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AdvancedCanvasProjectError,
  AdvancedCanvasProjectService,
  MemoryAdvancedCanvasProjectRepository,
  type CanvasGraph,
} from './advanced-canvas-project.js';
import {
  CanvasAssetError,
  CanvasAssetFacade,
  MemoryCanvasAssetRepository,
  MemoryCanvasObjectStorage,
} from './canvas-asset-facade.js';
import {
  MemoryProStudioAccessAudit,
  PRO_STUDIO_OBJECT_KINDS,
  accessDeniedAction,
  buildAccessDeniedEvent,
} from './security-access-audit.js';
import {
  AdvancedCanvasAdoptionApplicationService,
  AdvancedCanvasAdoptionError,
  MemoryAdvancedCanvasAdoptionRepository,
} from '../pro-studio-runtime/adoption.js';
import {
  CanvasAgentApplicationService,
  CanvasAgentError,
  MemoryCanvasAgentRepository,
  type CanvasAgentAuthorizationPort,
} from '../pro-studio-runtime/canvas-agent.js';
import {
  CanvasGenerationApplicationService,
  CanvasGenerationError,
  MemoryCanvasGenerationCatalog,
  MemoryCanvasGenerationRepository,
} from '../pro-studio-runtime/generation-runtime.js';
import { rejectProviderReferenceGrantAccess } from '../pro-studio-runtime/provider-reference-policy.js';

const png = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);

const graph = (): CanvasGraph => ({
  schemaVersion: 1,
  nodes: [{ id: 'image-1', type: 'image', data: { assetId: 'asset-1' } }],
  edges: [],
});

const owner = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  correlationId: 'corr-1',
};

const stranger = {
  userId: 'user-2',
  workspaceId: 'workspace-2',
  correlationId: 'corr-2',
};

class OpenAuthorization implements CanvasAgentAuthorizationPort {
  async resolve(
    input: Parameters<CanvasAgentAuthorizationPort['resolve']>[0]
  ) {
    return {
      assetGrantRevisions: Object.fromEntries(
        input.assetIds.map((assetId) => [assetId, 'asset-grant-v1'])
      ),
      operationCapabilityRevisions: Object.fromEntries(
        input.operations.map((operation) => [operation.tool, 'capability-v1'])
      ),
      quotaQuote: {
        id: 'agent-quota-1',
        maxCostMicros: input.maxCostMicros,
        maxGenerationCount: input.maxGenerationCount,
        operationHash: input.operationHash,
        revision: 'quota-v1',
      },
      role: 'owner' as const,
      roleRevision: 'role-v1',
    };
  }
}

test('access denied actions cover every Ticket 25 object kind', () => {
  assert.deepEqual(
    PRO_STUDIO_OBJECT_KINDS.map(accessDeniedAction),
    [
      'project_access_denied',
      'revision_access_denied',
      'asset_access_denied',
      'job_access_denied',
      'package_access_denied',
      'grant_access_denied',
      'confirmation_access_denied',
    ]
  );
  const event = buildAccessDeniedEvent({
    actorId: 'user-1',
    objectId: 'object-1',
    objectKind: 'package',
    workspaceId: 'workspace-1',
  });
  assert.equal(event.action, 'package_access_denied');
});

test('every enabled object kind records a rejection audit on foreign access', async () => {
  const clock = () => new Date('2026-07-16T12:00:00.000Z');
  const accessAudit = new MemoryProStudioAccessAudit(clock);

  const projectRepository = new MemoryAdvancedCanvasProjectRepository();
  const projects = new AdvancedCanvasProjectService({
    repository: projectRepository,
    clock,
    nextId: (kind) => `${kind}-1`,
  });
  const project = await projects.createProject(owner, {
    name: 'Security',
    graph: graph(),
  });
  await projects.createCheckpoint(owner, {
    expectedDraftVersion: project.draftVersion,
    projectId: project.id,
  });
  await assert.rejects(
    projects.loadProject(stranger, project.id),
    (error: unknown) =>
      error instanceof AdvancedCanvasProjectError && error.code === 'NOT_FOUND'
  );
  await assert.rejects(
    projects.getRevision(owner, project.id, 'revision-foreign'),
    (error: unknown) =>
      error instanceof AdvancedCanvasProjectError && error.code === 'NOT_FOUND'
  );

  const assets = new CanvasAssetFacade({
    accessAudit,
    repository: new MemoryCanvasAssetRepository(),
    storage: new MemoryCanvasObjectStorage(),
    clock,
    nextId: () => 'asset-1',
  });
  const asset = await assets.persistLocalCanvasArtifact(owner, {
    bytes: png,
    contentType: 'image/png',
    derivation: 'retouch',
    fileName: 'original.png',
  });
  await assert.rejects(
    assets.getAsset(stranger, asset.id),
    (error: unknown) =>
      error instanceof CanvasAssetError && error.code === 'NOT_FOUND'
  );

  const generation = new CanvasGenerationApplicationService(
    new MemoryCanvasGenerationRepository(),
    {
      accessAudit,
      assets: {
        async persist() {
          throw new Error('unused');
        },
        async persistQuarantined() {
          throw new Error('unused');
        },
      },
      assetAccess: { async assertOwned() {} },
      catalog: new MemoryCanvasGenerationCatalog([]),
      entitlement: { async assertCanGenerate() {} },
      projectAccess: { async assertRevision() {} },
      provider: {
        async submit() {
          throw new Error('unused');
        },
        async cancel() {
          return { status: 'cancelled' as const };
        },
      },
      clock,
    }
  );
  await assert.rejects(
    generation.getJob(stranger, 'job-foreign'),
    (error: unknown) =>
      error instanceof CanvasGenerationError &&
      error.code === 'GENERATION_JOB_NOT_FOUND'
  );

  const adoption = new AdvancedCanvasAdoptionApplicationService(
    new MemoryAdvancedCanvasAdoptionRepository({
      projects: [
        {
          id: 'project-1',
          workspaceId: owner.workspaceId,
          draftVersion: 1,
          draftNodes: [
            { id: 'text-1', kind: 'text', text: 'hello' },
            {
              id: 'image-1',
              kind: 'image',
              assetId: 'asset-1',
              jobId: 'job-1',
              sourceAssetIds: [],
              custody: 'owned',
              deliveryStatus: 'completed',
            },
          ],
          revisions: [],
        },
      ],
      packages: [],
    }),
    { accessAudit, clock }
  );
  await assert.rejects(
    adoption.adopt(owner, {
      projectId: 'project-1',
      revisionRef: { kind: 'freeze_current_draft', expectedDraftVersion: 1 },
      selection: {
        textNodeId: 'text-1',
        orderedMediaNodeIds: ['image-1'],
      },
      target: {
        kind: 'existing_package',
        packageId: 'package-foreign',
        baseVersionId: 'version-missing',
        expectedRevision: 0,
      },
      idempotencyKey: 'adopt-foreign-package',
    }),
    (error: unknown) =>
      error instanceof AdvancedCanvasAdoptionError &&
      error.code === 'CONTENT_PACKAGE_NOT_FOUND'
  );

  const agent = new CanvasAgentApplicationService(
    new MemoryCanvasAgentRepository([
      {
        workspaceId: owner.workspaceId,
        projectId: 'project-1',
        revision: 1,
        nodes: [{ id: 'node-1', kind: 'text', data: { text: '原文案' } }],
        edges: [],
        assetVersions: {},
      },
    ]),
    {
      accessAudit,
      authorization: new OpenAuthorization(),
      planner: {
        async plan() {
          return [
            {
              tool: 'create_node',
              node: { id: 'node-2', kind: 'text', data: { text: 'b' } },
            },
          ];
        },
      },
      clock,
      nonce: () => 'nonce-1',
    }
  );
  await assert.rejects(
    agent.apply(owner, {
      sessionId: 'session-1',
      projectId: 'project-1',
      credentialId: 'confirmation-foreign',
      expectedRevision: 1,
    }),
    (error: unknown) =>
      error instanceof CanvasAgentError && error.code === 'CONFIRMATION_NOT_FOUND'
  );

  await assert.rejects(
    rejectProviderReferenceGrantAccess({
      accessAudit,
      actorId: stranger.userId,
      grantId: 'grant-foreign',
      workspaceId: stranger.workspaceId,
    }),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('ProviderReferenceGrant is disabled')
  );

  const projectAudits = projectRepository.inspectAudit();
  assert.ok(
    projectAudits.some((event) => event.action === 'project_access_denied')
  );
  assert.ok(
    projectAudits.some((event) => event.action === 'revision_access_denied')
  );
  assert.equal(accessAudit.byKind('asset')[0]?.objectId, asset.id);
  assert.equal(accessAudit.byKind('job')[0]?.objectId, 'job-foreign');
  assert.equal(accessAudit.byKind('package')[0]?.objectId, 'package-foreign');
  assert.equal(
    accessAudit.byKind('confirmation')[0]?.objectId,
    'confirmation-foreign'
  );
  assert.equal(accessAudit.byKind('grant')[0]?.objectId, 'grant-foreign');

  const observed = new Set([
    ...projectAudits.map((event) => event.objectKind),
    ...accessAudit.events.map((event) => event.objectKind),
  ]);
  for (const kind of PRO_STUDIO_OBJECT_KINDS) {
    assert.ok(observed.has(kind), `missing rejection audit for ${kind}`);
  }
});
