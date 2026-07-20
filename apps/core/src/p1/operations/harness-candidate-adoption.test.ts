import assert from 'node:assert/strict';
import test from 'node:test';
import { contentPackageSchema } from '@meiye/contracts';

import {
  MemoryOperationsRepository,
  OperationsApplicationService,
  OperationsError,
  OperationsFoundationModule,
  RecordedCanvasExportAdapter,
  RecordedImageGenerationAdapter,
} from './index.js';

const context = {
  actor: 'owner' as const,
  correlationId: 'corr-harness-adoption',
  userId: 'owner-1',
  workspaceId: 'workspace-1',
};

test('adopting a persisted Harness alternative updates the package and writes an audit event', async () => {
  const repository = new MemoryOperationsRepository();
  repository.grantMembership(context.userId, context.workspaceId);
  const service = new OperationsApplicationService(repository, {
    canvasExporter: new RecordedCanvasExportAdapter(),
    imageGenerator: new RecordedImageGenerationAdapter(),
    notifier: { async send() {} },
  });
  const created = await service.createContentPackage(context, {
    kind: 'image_text',
    source: { assetIds: [], workId: 'work-1', workflowId: 'work-1' },
  });
  const state = await repository.loadWorkspace(context.workspaceId);
  assert.ok(state);
  const timestamp = '2026-07-19T00:00:00.000Z';
  state.contentPackages[0] = {
    ...state.contentPackages[0]!,
    currentVersionId: 'version-c02',
    harnessSelection: { recommendedCandidateId: 'c02' },
    revision: 1,
    status: 'review_ready',
    versions: [
      candidateVersion('c01', 70, timestamp),
      candidateVersion('c02', 92, timestamp),
      candidateVersion('c03', 88, timestamp),
    ],
  };
  await repository.saveWorkspace(state);

  const adopted = await service.adoptHarnessCandidate(context, {
    candidateId: 'c03',
    expectedRevision: 1,
    packageId: created.id,
  });

  assert.equal(adopted.currentVersionId, 'version-c03');
  assert.equal(adopted.status, 'accepted');
  assert.equal(adopted.revision, 2);
  assert.deepEqual(adopted.harnessSelection, {
    adoptedCandidateId: 'c03',
    recommendedCandidateId: 'c02',
  });
  const persisted = await repository.loadWorkspace(context.workspaceId);
  assert.deepEqual(
    persisted?.auditEvents.at(-1)?.details,
    { candidateId: 'c03', recommendedCandidateId: 'c02' },
  );
  assert.equal(
    persisted?.auditEvents.at(-1)?.action,
    'content_package.harness_candidate_adopted',
  );
});

test('an accepted Harness package can reselect a frozen candidate as one immutable version', async () => {
  const repository = new MemoryOperationsRepository();
  repository.grantMembership(context.userId, context.workspaceId);
  const service = new OperationsApplicationService(repository, {
    canvasExporter: new RecordedCanvasExportAdapter(),
    imageGenerator: new RecordedImageGenerationAdapter(),
    notifier: { async send() {} },
  });
  const created = await service.createContentPackage(context, {
    kind: 'image_text',
    source: { assetIds: [], workId: 'work-1', workflowId: 'work-1' },
  });
  const state = await repository.loadWorkspace(context.workspaceId);
  assert.ok(state);
  const timestamp = '2026-07-19T00:00:00.000Z';
  state.contentPackages[0] = {
    ...state.contentPackages[0]!,
    currentVersionId: 'version-c02',
    harnessSelection: { recommendedCandidateId: 'c02' },
    revision: 1,
    status: 'review_ready',
    versions: [
      candidateVersion('c01', 70, timestamp),
      candidateVersion('c02', 92, timestamp),
      candidateVersion('c03', 88, timestamp),
    ],
  };
  await repository.saveWorkspace(state);
  const first = await service.adoptHarnessCandidate(context, {
    candidateId: 'c03',
    expectedRevision: 1,
    packageId: created.id,
  });
  assert.equal(first.status, 'accepted');
  assert.equal(first.revision, 2);

  const module = new OperationsFoundationModule(service);
  const command = {
    action: 'adopt_harness_candidate',
    payload: {
      candidateId: 'c01',
      expectedRevision: 2,
      packageId: created.id,
    },
  };
  const switched = (await module.execute({
    context,
    idempotencyKey: 'switch-harness-candidate-c01',
    input: command,
  })) as Awaited<ReturnType<typeof service.adoptHarnessCandidate>>;
  const replayed = (await module.execute({
    context,
    idempotencyKey: 'switch-harness-candidate-c01',
    input: command,
  })) as Awaited<ReturnType<typeof service.adoptHarnessCandidate>>;
  const sameSelection = (await module.execute({
    context,
    idempotencyKey: 'keep-harness-candidate-c01',
    input: {
      action: 'adopt_harness_candidate',
      payload: {
        candidateId: 'c01',
        expectedRevision: 3,
        packageId: created.id,
      },
    },
  })) as Awaited<ReturnType<typeof service.adoptHarnessCandidate>>;

  assert.deepEqual(replayed, switched);
  assert.equal(sameSelection.currentVersionId, switched.currentVersionId);
  assert.equal(sameSelection.revision, switched.revision);
  assert.equal(switched.status, 'accepted');
  assert.equal(switched.revision, 3);
  assert.equal(switched.harnessSelection?.adoptedCandidateId, 'c01');
  assert.notEqual(switched.currentVersionId, 'version-c01');
  assert.equal(switched.versions.length, 4);
  const selected = switched.versions.at(-1);
  assert.ok(selected);
  assert.equal(selected.id, switched.currentVersionId);
  assert.equal(selected.derivedFromVersionId, 'version-c01');
  assert.equal(selected.createdBy, context.userId);
  assert.equal(selected.harnessCandidateId, undefined);
  assert.equal(selected.title, 'c01 标题');
  assert.equal(selected.body, 'c01 正文');
  assert.doesNotThrow(() => contentPackageSchema.parse(switched));
  assert.deepEqual(switched.exportReceipts, []);
  assert.equal(switched.deliveryEvents, undefined);

  const persisted = await repository.loadWorkspace(context.workspaceId);
  assert.equal(persisted?.contentPackages[0]?.versions.length, 4);
  const adoptionEvents = persisted?.auditEvents.filter(
    ({ action }) => action === 'content_package.harness_candidate_adopted',
  );
  assert.equal(adoptionEvents?.length, 2);
  assert.deepEqual(adoptionEvents?.at(-1)?.details, {
    candidateId: 'c01',
    previousCandidateId: 'c03',
    recommendedCandidateId: 'c02',
    versionId: switched.currentVersionId,
  });
});

test('accepted candidate reselection keeps OCC, frozen-set, and Harness-package gates closed', async () => {
  const repository = new MemoryOperationsRepository();
  repository.grantMembership(context.userId, context.workspaceId);
  const service = new OperationsApplicationService(repository, {
    canvasExporter: new RecordedCanvasExportAdapter(),
    imageGenerator: new RecordedImageGenerationAdapter(),
    notifier: { async send() {} },
  });
  const harnessPackage = await service.createContentPackage(context, {
    kind: 'image_text',
    source: { assetIds: [], workId: 'work-1', workflowId: 'work-1' },
  });
  const ordinaryPackage = await service.createContentPackage(context, {
    kind: 'image_text',
    source: { assetIds: [], workId: 'work-2' },
  });
  const state = await repository.loadWorkspace(context.workspaceId);
  assert.ok(state);
  const timestamp = '2026-07-19T00:00:00.000Z';
  const persistedHarnessPackage = state.contentPackages.find(
    ({ id }) => id === harnessPackage.id,
  );
  const persistedOrdinaryPackage = state.contentPackages.find(
    ({ id }) => id === ordinaryPackage.id,
  );
  assert.ok(persistedHarnessPackage);
  assert.ok(persistedOrdinaryPackage);
  Object.assign(persistedHarnessPackage, {
    currentVersionId: 'version-c03',
    harnessSelection: {
      adoptedCandidateId: 'c03',
      recommendedCandidateId: 'c02',
    },
    revision: 2,
    status: 'accepted',
    versions: [
      candidateVersion('c01', 70, timestamp),
      candidateVersion('c02', 92, timestamp),
      candidateVersion('c03', 88, timestamp),
    ],
  });
  Object.assign(persistedOrdinaryPackage, {
    currentVersionId: 'ordinary-version',
    revision: 4,
    status: 'accepted',
    versions: [
      {
        ...candidateVersion('ordinary-candidate', 80, timestamp),
        id: 'ordinary-version',
      },
    ],
  });
  await repository.saveWorkspace(state);

  await assert.rejects(
    service.adoptHarnessCandidate(context, {
      candidateId: 'c01',
      expectedRevision: 1,
      packageId: harnessPackage.id,
    }),
    (error: unknown) =>
      error instanceof OperationsError &&
      error.code === 'CONTENT_PACKAGE_REVISION_CONFLICT',
  );
  await assert.rejects(
    service.adoptHarnessCandidate(context, {
      candidateId: 'candidate-not-persisted',
      expectedRevision: 2,
      packageId: harnessPackage.id,
    }),
    (error: unknown) =>
      error instanceof OperationsError &&
      error.code === 'HARNESS_CANDIDATE_NOT_FOUND',
  );
  await assert.rejects(
    service.adoptHarnessCandidate(context, {
      candidateId: 'ordinary-candidate',
      expectedRevision: 4,
      packageId: ordinaryPackage.id,
    }),
    (error: unknown) =>
      error instanceof OperationsError &&
      error.code === 'HARNESS_CANDIDATE_NOT_ADOPTABLE',
  );
});

function candidateVersion(
  candidateId: string,
  score: number,
  createdAt: string,
) {
  return {
    body: `${candidateId} 正文`,
    conversionHook: '私信预约',
    createdAt,
    harnessCandidateId: candidateId,
    harnessScore: score,
    id: `version-${candidateId}`,
    orderedAssetIds: [],
    source: 'ai_generated' as const,
    title: `${candidateId} 标题`,
    topics: [],
  };
}
