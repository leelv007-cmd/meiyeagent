import assert from 'node:assert/strict';

import type { ContentPackage } from '@meiye/contracts';

import { ContentPackageRevisionConflictError } from './repository.js';
import type { OperationsHotPathRepository } from './operations-hot-path.js';
import type { OperationsWorkspaceState } from './types.js';

const NOW = '2026-08-19T12:00:00.000Z';

export function hotPathWorkspaceState(
  workspaceId: string,
): OperationsWorkspaceState {
  return {
    auditEvents: [],
    commandReceipts: [
      {
        actorId: 'owner-a',
        correlationId: 'corr-seed',
        createdAt: NOW,
        id: 'receipt-noise',
        idempotencyKey: 'seed',
        payloadHash: 'hash',
        result: null,
        status: 'completed',
        workspaceId,
      },
    ],
    composerConversations: [],
    contentPackages: [
      historicalPackage(workspaceId),
      livePackage(workspaceId),
    ],
    creationEvents: [],
    creativeAssets: [
      {
        createdAt: NOW,
        id: 'asset-1',
        jobId: 'job-1',
        kind: 'image',
        title: '封面',
        workId: 'work-1',
        workspaceId,
      },
    ],
    creativeContents: [],
    creativeJobs: [
      {
        contract: {
          aigcLabelEnabled: true,
          catalogModelId: 'model-a',
          catalogRevision: 'catalog-v1',
          currency: 'CNY',
          dataClass: [],
          estimatedAmount: 1,
          operation: 'image.generate',
          outputCount: 1,
          outputLabel: '1 张图片',
          quoteAcceptedAt: NOW,
          quoteRevision: 'quote-v1',
          watermarkEnabled: false,
        },
        createdAt: NOW,
        id: 'job-1',
        outputAssetIds: ['asset-1'],
        outputContentIds: [],
        status: 'completed',
        submissionKey: 'submit-1',
        updatedAt: NOW,
        workId: 'work-1',
        workspaceId,
      },
    ],
    creativeWorks: [
      {
        createdAt: NOW,
        id: 'work-1',
        intent: '夏季美甲图文',
        mode: 'direct',
        operation: 'image.generate',
        sessionId: 'session-1',
        sourceReferences: [],
        status: 'completed',
        updatedAt: NOW,
        workspaceId,
      },
    ],
    exportReceipts: [],
    imageJobs: [],
    taskEvents: [
      {
        actorId: 'owner-a',
        correlationId: 'corr-task',
        createdAt: NOW,
        event: 'created',
        id: 'task-event-1',
        taskId: 'task-1',
        workspaceId,
      },
    ],
    taskSourceLinks: [],
    tasks: [
      {
        createdAt: NOW,
        dueAt: NOW,
        executable: true,
        id: 'task-1',
        risk: 'normal',
        source: 'manual',
        status: 'todo',
        title: '待办',
        updatedAt: NOW,
        workspaceId,
      },
    ],
    templateShortcuts: [],
    triggerConfigs: [],
    triggerRuns: [],
    userTemplates: [],
    weeklyBatchExecutions: [],
    weeklyFacts: [
      {
        correlationId: 'corr-weekly',
        createdAt: NOW,
        id: 'weekly-noise',
        kind: 'planned',
        occurredAt: NOW,
        origin: 'automatic',
        sourceId: 'source-weekly',
        workspaceId,
      },
    ],
    weeklyReviews: [],
    works: [
      {
        aigcLabelEnabled: false,
        brandWatermarkEnabled: false,
        createdAt: NOW,
        currentRevisionId: 'canvas-rev-1',
        id: 'canvas-archive-1',
        name: '历史画布',
        revisions: [],
        updatedAt: NOW,
        workspaceId,
      },
    ],
    workspaceId,
  };
}

export function historicalPackage(workspaceId: string): ContentPackage {
  return {
    compliance: { aigcLabelEnabled: false, watermarkEnabled: false },
    createdAt: '2026-01-01T00:00:00.000Z',
    exportReceipts: [],
    generated: { assetIds: [], childRuns: [] },
    id: 'historical-package',
    kind: 'image_text',
    lineage: {},
    revision: 0,
    rights: { state: 'authorized' },
    source: { assetIds: [] },
    status: 'accepted',
    updatedAt: '2026-01-01T00:00:00.000Z',
    variants: [],
    versions: [],
    workspaceId,
  };
}

export function livePackage(workspaceId: string): ContentPackage {
  return {
    compliance: { aigcLabelEnabled: true, watermarkEnabled: false },
    createdAt: NOW,
    exportReceipts: [],
    generated: { assetIds: [], childRuns: [] },
    id: 'live-package',
    kind: 'image_text',
    lineage: {},
    revision: 1,
    rights: { state: 'authorized' },
    source: { assetIds: [], workId: 'work-1' },
    status: 'accepted',
    updatedAt: NOW,
    variants: [],
    versions: [
      {
        body: '正文',
        createdAt: NOW,
        id: 'version-1',
        orderedAssetIds: [],
        title: '标题',
        topics: [],
      },
    ],
    workspaceId,
  };
}

export async function assertOperationsHotPathContract(
  adapter: OperationsHotPathRepository,
  workspaceId: string,
) {
  const historical = await adapter.getContentPackage(
    workspaceId,
    'historical-package',
  );
  assert.equal(historical?.id, 'historical-package');
  assert.equal(historical?.revision, 0);
  assert.equal(historical?.deliveryEvents, undefined);

  const missing = await adapter.getContentPackage(workspaceId, 'missing');
  assert.equal(missing, null);

  const packages = await adapter.listContentPackages(workspaceId);
  assert.deepEqual(
    packages.map((row) => row.id).sort(),
    ['historical-package', 'live-package'],
  );

  const current = await adapter.getContentPackage(workspaceId, 'live-package');
  assert.ok(current);
  await assert.rejects(
    () =>
      adapter.saveContentPackageRevision({
        contentPackage: { ...current, revision: current.revision + 2 },
        expectedRevision: current.revision,
      }),
    (error: unknown) => error instanceof ContentPackageRevisionConflictError,
  );
  await assert.rejects(
    () =>
      adapter.saveContentPackageRevision({
        contentPackage: { ...current, revision: current.revision + 1 },
        expectedRevision: current.revision - 1,
      }),
    (error: unknown) => error instanceof ContentPackageRevisionConflictError,
  );

  const updatedAt = '2026-08-19T12:01:00.000Z';
  const saved = await adapter.saveContentPackageRevision({
    auditEvents: [
      {
        action: 'content_package.hot_path_save',
        actorId: 'owner-a',
        correlationId: 'hot-path',
        createdAt: updatedAt,
        entityId: current.id,
        entityType: 'content_package',
        id: 'audit-hot-path-1',
        workspaceId,
      },
    ],
    contentPackage: {
      ...current,
      revision: current.revision + 1,
      updatedAt,
    },
    expectedRevision: current.revision,
  });
  assert.equal(saved.revision, current.revision + 1);
  assert.equal(
    (await adapter.getContentPackage(workspaceId, 'live-package'))?.revision,
    current.revision + 1,
  );
  assert.equal(
    (await adapter.getContentPackage(workspaceId, 'historical-package'))
      ?.revision,
    0,
  );
  const audits = await adapter.listAuditEvents(
    workspaceId,
    'content_package.hot_path_save',
  );
  assert.equal(audits.length, 1);

  const works = await adapter.listCreativeWorks(workspaceId);
  assert.deepEqual(
    works.map((row) => row.id),
    ['work-1'],
  );
  assert.equal((await adapter.listCreativeJobs(workspaceId)).length, 1);
  assert.equal((await adapter.listCreativeAssets(workspaceId)).length, 1);
  assert.equal((await adapter.listTasks(workspaceId))[0]?.id, 'task-1');
  assert.equal((await adapter.listTaskEvents(workspaceId)).length, 1);
  assert.equal(
    (await adapter.listLegacyCanvasWorks(workspaceId))[0]?.id,
    'canvas-archive-1',
  );

  await adapter.replaceSearchDocuments(
    workspaceId,
    ['content'],
    [
      {
        id: 'search-1',
        kind: 'content',
        metadata: { projectionOwner: 'product' },
        tags: ['nail'],
        text: '夏季美甲',
        title: '美甲',
        updatedAt,
        workspaceId,
      },
    ],
    updatedAt,
    'product',
  );
  const search = await adapter.searchDocuments(workspaceId, {
    kinds: ['content'],
    query: '美甲',
  });
  assert.deepEqual(
    search.map((row) => row.id),
    ['search-1'],
  );

  await adapter.appendAuditEvent({
    action: 'publish_handoff.self_report_ask',
    actorId: 'owner-a',
    correlationId: 'self-report',
    createdAt: updatedAt,
    entityId: 'ask-1',
    entityType: 'self_report_ask',
    id: 'audit-self-report-1',
    workspaceId,
  });
  assert.equal(
    (
      await adapter.listAuditEvents(
        workspaceId,
        'publish_handoff.self_report_ask',
      )
    ).length,
    1,
  );
}
