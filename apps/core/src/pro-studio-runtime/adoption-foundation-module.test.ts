import assert from 'node:assert/strict';
import test from 'node:test';

import { P1ApplicationService } from '../p1/foundation/application-service.js';
import { MemoryFoundationRepository } from '../p1/foundation/memory-repository.js';
import {
  AdvancedCanvasAdoptionApplicationService,
  MemoryAdvancedCanvasAdoptionRepository,
} from './adoption.js';
import { AdvancedCanvasAdoptionFoundationModule } from './adoption-foundation-module.js';

const context = {
  correlationId: 'canvas-adoption-correlation',
  userId: 'owner-1',
  workspaceId: 'workspace-1',
} as const;

function createApplication(
  writeOwnershipReader?: () => Promise<'legacy' | 'frozen' | 'p1' | null>,
) {
  const foundation = new MemoryFoundationRepository();
  foundation.grantOwner(context.workspaceId, context.userId);
  const adoption = new AdvancedCanvasAdoptionApplicationService(
    new MemoryAdvancedCanvasAdoptionRepository({
      packages: [],
      projects: [
        {
          draftNodes: [],
          draftVersion: 1,
          id: 'project-1',
          revisions: [
            {
              createdAt: '2026-07-16T09:00:00.000Z',
              id: 'revision-1',
              nodes: [
                { id: 'text-1', kind: 'text', text: 'Adopted copy' },
                {
                  assetId: 'asset-1',
                  custody: 'owned',
                  deliveryStatus: 'completed',
                  id: 'image-1',
                  jobId: 'job-1',
                  kind: 'image',
                  sourceAssetIds: ['source-1'],
                },
              ],
            },
          ],
          workspaceId: context.workspaceId,
        },
      ],
    }),
    { clock: () => new Date('2026-07-16T10:00:00.000Z') },
  );
  return new P1ApplicationService(foundation, {
    operations: [new AdvancedCanvasAdoptionFoundationModule(adoption)],
    ...(writeOwnershipReader ? { writeOwnershipReader } : {}),
  });
}

test('adopts and lists Canvas output through fixed Product Core module actions', async () => {
  const application = createApplication();
  const command = {
    action: 'adopt_advanced_canvas_output',
    payload: {
      projectId: 'project-1',
      revisionRef: { kind: 'frozen', revisionId: 'revision-1' },
      selection: {
        orderedMediaNodeIds: ['image-1'],
        textNodeId: 'text-1',
      },
      target: { kind: 'new_package' },
    },
  };

  const adopted = await application.executeModule<
    typeof command,
    { packageId: string; versionId: string }
  >(context, 'advanced-canvas', command, 'adoption-key-1');
  const replayed = await application.executeModule<
    typeof command,
    { packageId: string; versionId: string }
  >(context, 'advanced-canvas', command, 'adoption-key-1');
  const adoptions = await application.queryModule<
    { action: string; payload: { projectId: string } },
    Array<{ packageId: string; versionId: string }>
  >(context, 'advanced-canvas', {
    action: 'list_adoptions',
    payload: { projectId: 'project-1' },
  });

  assert.deepEqual(replayed, adopted);
  assert.equal(adoptions.length, 1);
  assert.deepEqual(adoptions[0], adopted);
});

test('rejects non-contract adoption actions and unknown payload fields', async () => {
  const application = createApplication();

  await assert.rejects(
    application.queryModule(context, 'advanced-canvas', {
      action: 'list_internal_adoption_state',
      payload: { projectId: 'project-1' },
    }),
    /Unknown advanced canvas adoption query/,
  );
  await assert.rejects(
    application.executeModule(
      context,
      'advanced-canvas',
      {
        action: 'adopt_advanced_canvas_output',
        payload: {
          projectId: 'project-1',
          revisionRef: { kind: 'frozen', revisionId: 'revision-1' },
          selection: {
            orderedMediaNodeIds: ['image-1'],
            textNodeId: 'text-1',
          },
          target: { kind: 'new_package' },
          workspaceId: 'forged-workspace',
        },
      },
      'adoption-key-forged',
    ),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'INPUT_INVALID',
  );
});

test('honors the Product Core cutover write owner before adoption side effects', async () => {
  const application = createApplication(async () => 'frozen');

  await assert.rejects(
    application.executeModule(
      context,
      'advanced-canvas',
      {
        action: 'adopt_advanced_canvas_output',
        payload: {
          projectId: 'project-1',
          revisionRef: { kind: 'frozen', revisionId: 'revision-1' },
          selection: {
            orderedMediaNodeIds: ['image-1'],
            textNodeId: 'text-1',
          },
          target: { kind: 'new_package' },
        },
      },
      'adoption-key-frozen',
    ),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'COMMANDS_FROZEN',
  );
  assert.deepEqual(
    await application.queryModule(context, 'advanced-canvas', {
      action: 'list_adoptions',
      payload: { projectId: 'project-1' },
    }),
    [],
  );
});
