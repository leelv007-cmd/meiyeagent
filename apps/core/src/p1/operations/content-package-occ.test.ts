import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MemoryFoundationRepository,
  P1ApplicationService,
} from '../foundation/index.js';
import {
  ContentPackageRevisionConflictError,
  MemoryOperationsRepository,
  OperationsApplicationService,
  OperationsError,
  OperationsFoundationModule,
  RecordedCanvasExportAdapter,
  RecordedImageGenerationAdapter,
} from './index.js';
import type { OperationsWorkspaceState } from './types.js';

class FinalCasConflictRepository extends MemoryOperationsRepository {
  conflict: ContentPackageRevisionConflictError | null = null;

  override async saveWorkspace(state: OperationsWorkspaceState) {
    if (this.conflict) {
      const conflict = this.conflict;
      this.conflict = null;
      throw conflict;
    }
    return super.saveWorkspace(state);
  }
}

function setup() {
  const foundation = new MemoryFoundationRepository();
  const operations = new MemoryOperationsRepository();
  const context = {
    actor: 'owner' as const,
    correlationId: 'corr-occ-create',
    userId: 'owner-occ',
    workspaceId: 'workspace-occ',
  };
  foundation.grantOwner(context.workspaceId, context.userId);
  operations.grantMembership(context.userId, context.workspaceId);
  const operationsService = new OperationsApplicationService(operations, {
    canvasExporter: new RecordedCanvasExportAdapter(),
    imageGenerator: new RecordedImageGenerationAdapter(),
    notifier: { async send() {} },
  });
  const service = new P1ApplicationService(foundation, {
    operations: [new OperationsFoundationModule(operationsService)],
  });
  return { context, operations, operationsService, service };
}

test('same expectedRevision allows one mutation and records exactly one conflict audit', async () => {
  const { context, operations, operationsService, service } = setup();
  const created = await operationsService.createContentPackage(
    { ...context, actor: 'owner' },
    { kind: 'image_text', source: { assetIds: ['asset-1'] } }
  );
  assert.equal(created.revision, 0);

  const cancelContext = { ...context, correlationId: 'corr-occ-cancel' };
  const revokeContext = { ...context, correlationId: 'corr-occ-revoke' };
  const [cancelled, revoked] = await Promise.allSettled([
    service.executeModule(
      cancelContext,
      'operations',
      {
        action: 'cancel_content_package',
        payload: { expectedRevision: 0, packageId: created.id },
      },
      'occ-cancel'
    ),
    service.executeModule(
      revokeContext,
      'operations',
      {
        action: 'revoke_content_package_rights',
        payload: { expectedRevision: 0, packageId: created.id },
      },
      'occ-revoke'
    ),
  ]);

  const outcomes = [cancelled, revoked];
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = outcomes.find((result) => result.status === 'rejected');
  assert.ok(rejected && rejected.status === 'rejected');
  assert.equal(rejected.reason instanceof OperationsError, true);
  assert.equal(rejected.reason.code, 'CONTENT_PACKAGE_REVISION_CONFLICT');
  assert.equal(rejected.reason.status, 409);
  assert.deepEqual(rejected.reason.details, {
    correlationId:
      cancelled.status === 'rejected'
        ? cancelContext.correlationId
        : revokeContext.correlationId,
    currentRevision: 1,
    expectedRevision: 0,
    packageId: created.id,
  });

  const stored = await operationsService.getContentPackage(
    { ...context, actor: 'owner' },
    created.id
  );
  assert.equal(stored.revision, 1);
  assert.equal(stored.versions.length, 0);
  assert.equal(stored.exportReceipts.length, 0);

  const state = await operations.loadWorkspace(context.workspaceId);
  assert.ok(state);
  const conflictAudits = state.auditEvents.filter(
    (event) => event.action === 'content_package.revision_conflict'
  );
  assert.equal(conflictAudits.length, 1);
  assert.deepEqual(conflictAudits[0]?.details, {
    correlationId: conflictAudits[0]?.correlationId,
    currentRevision: 1,
    expectedRevision: 0,
  });
  assert.equal(
    state.auditEvents.filter((event) =>
      ['content_package.cancelled', 'content_package.rights_revoked'].includes(
        event.action
      )
    ).length,
    1
  );
});

test('receipt replay returns the committed result without incrementing revision again', async () => {
  const { context, operationsService, service } = setup();
  const created = await operationsService.createContentPackage(
    { ...context, actor: 'owner' },
    { kind: 'image_text', source: { assetIds: ['asset-1'] } }
  );
  const command = {
    action: 'cancel_content_package',
    payload: { expectedRevision: 0, packageId: created.id },
  };

  const first = await service.executeModule<
    typeof command,
    { id: string; revision: number; status: string }
  >(context, 'operations', command, 'occ-replay');
  const replayed = await service.executeModule<
    typeof command,
    { id: string; revision: number; status: string }
  >(context, 'operations', command, 'occ-replay');

  assert.deepEqual(replayed, first);
  assert.equal(first.revision, 1);
  assert.equal(
    (
      await operationsService.getContentPackage(
        { ...context, actor: 'owner' },
        created.id
      )
    ).revision,
    1
  );
});

test('the final repository CAS guard returns 409 and persists one conflict audit', async () => {
  const foundation = new MemoryFoundationRepository();
  const operations = new FinalCasConflictRepository();
  const context = {
    actor: 'owner' as const,
    correlationId: 'corr-final-cas',
    userId: 'owner-final-cas',
    workspaceId: 'workspace-final-cas',
  };
  foundation.grantOwner(context.workspaceId, context.userId);
  operations.grantMembership(context.userId, context.workspaceId);
  const operationsService = new OperationsApplicationService(operations, {
    canvasExporter: new RecordedCanvasExportAdapter(),
    imageGenerator: new RecordedImageGenerationAdapter(),
    notifier: { async send() {} },
  });
  const service = new P1ApplicationService(foundation, {
    operations: [new OperationsFoundationModule(operationsService)],
  });
  const created = await operationsService.createContentPackage(
    { ...context, actor: 'owner' },
    { kind: 'image_text', source: { assetIds: ['asset-1'] } },
  );
  operations.conflict = new ContentPackageRevisionConflictError(
    created.id,
    0,
    7,
  );

  await assert.rejects(
    service.executeModule(
      context,
      'operations',
      {
        action: 'cancel_content_package',
        payload: { expectedRevision: 0, packageId: created.id },
      },
      'final-cas-conflict',
    ),
    (error: unknown) =>
      error instanceof OperationsError &&
      error.code === 'CONTENT_PACKAGE_REVISION_CONFLICT' &&
      error.status === 409 &&
      error.details?.currentRevision === 7,
  );
  const state = await operations.loadWorkspace(context.workspaceId);
  assert.equal(state?.contentPackages[0]?.revision, 0);
  assert.equal(
    state?.auditEvents.filter(
      (event) => event.action === 'content_package.revision_conflict',
    ).length,
    1,
  );
});
