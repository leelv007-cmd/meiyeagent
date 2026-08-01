import assert from 'node:assert/strict';
import test from 'node:test';

import type { OperationsApplicationService } from '../operations/application-service.js';
import type { CreationExecutionSnapshot } from '../execution-spine/creation-execution-snapshot.js';
import type { ProductBillingApplicationPort } from '../product-billing/durable-service.js';
import { OperationsResultCommandPort } from './operations-visual-adoption.js';

const context = {
  correlationId: 'corr-result-adjust',
  userId: 'owner-1',
  workspaceId: 'ws-1',
} as const;

function fixture(
  options: {
    noteSnapshot?: boolean;
    packageWorkflowId?: string;
    packageRevision?: number;
    quoteStatus?: 'confirmed' | 'quoted';
    quoteOutputCount?: number;
    quoteTaskId?: string;
    scopedAssetIds?: string[];
    semanticSnapshot?: boolean;
    sourceOperation?: 'copy.generate' | 'image.generate' | 'video.generate';
    sourceSessionId?: string;
  } = {},
) {
  const composerCalls: unknown[] = [];
  const deriveCalls: unknown[] = [];
  const submitCalls: unknown[][] = [];
  const operations = {
    async executeIdempotentModuleCommand(
      _context: unknown,
      _key: string,
      _input: unknown,
      execute: () => Promise<unknown>,
    ) {
      return execute();
    },
    async getCreativeWorkbench() {
      return {
        works: [
          {
            id: 'work-1',
            currentJobId: 'job-1',
            intent: '夏日海报',
            sessionId: options.sourceSessionId ?? 'session-1',
            sourceReferences: [{ id: 'grounding-1', kind: 'asset' }],
            updatedAt: '2026-07-20T00:00:00.000Z',
          },
          {
            id: 'derived-work-1',
            currentJobId: undefined,
            intent: '夏日海报\n\n调整要求：换成夏日风格',
            sessionId: 'session-1',
            sourceReferences: [
              { id: 'work-1', kind: 'work' },
              { id: 'grounding-1', kind: 'asset' },
              ...(options.scopedAssetIds ?? []).map((id) => ({
                id,
                kind: 'asset' as const,
              })),
            ],
            updatedAt: '2026-07-20T00:01:00.000Z',
          },
        ],
        jobs: [
          {
            id: 'job-1',
            workId: 'work-1',
            status: 'completed',
            contract: {
              aigcLabelEnabled: true,
              aspectRatio: '3:4',
              catalogModelId: 'image-model-old',
              catalogRevision: 'catalog-old',
              currency: 'CNY',
              dataClass: [],
              estimatedAmount: 1,
              operation: options.sourceOperation ?? 'image.generate',
              outputCount: 1,
              outputLabel: '1 张 3:4 图片',
              quoteAcceptedAt: '2026-07-19T00:00:00.000Z',
              quoteRevision: 'quote-old',
              watermarkEnabled: false,
            },
          },
        ],
        assets: [
          { id: 'asset-1', jobId: 'job-1', workId: 'work-1' },
          { id: 'asset-2', jobId: 'job-1', workId: 'work-1' },
          { id: 'grounding-1', jobId: 'input-job', workId: 'input-work' },
          { id: 'foreign-asset', jobId: 'job-2', workId: 'work-2' },
        ],
      };
    },
    async getContentPackage() {
      return {
        currentVersionId: 'version-1',
        generated: {
          assetIds: ['asset-1', 'asset-2'],
          ownedAssets: [
            { id: 'asset-1' },
            { id: 'asset-2' },
          ],
        },
        id: 'package-1',
        revision: options.packageRevision ?? 3,
        source: {
          aigcLabelEnabled: true,
          creationExecutionSnapshot: {
            id: 'snapshot-task-1',
            modelSelection: {
              catalogModelId: 'image-model-old',
              platformConfigRevision: null,
              source: 'current_selection',
            },
            revision: 1,
            schemaVersion: 'creation-execution-snapshot/v1',
          },
          workId: 'work-1',
          workflowId: options.packageWorkflowId ?? 'task-1',
          workflowRevision: 1,
        },
        versions: [
          {
            ...(options.noteSnapshot
              ? {
                  note: {
                    plan: { style: { id: 'story' } },
                  },
                }
              : {}),
            id: 'version-1',
            orderedAssetIds: ['asset-1', 'asset-2'],
          },
        ],
        workspaceId: 'ws-1',
      };
    },
    async deriveCreativeWork(_context: unknown, _workId: string, input: unknown) {
      deriveCalls.push(input);
      return { id: 'derived-work-1' };
    },
    async submitCreativeWork(...args: unknown[]) {
      submitCalls.push(args);
      return { work: { id: 'derived-work-1' } };
    },
  } as unknown as OperationsApplicationService;
  const confirmCalls: unknown[] = [];
  let quoteStatus = options.quoteStatus ?? 'confirmed';
  let quoteTaskId = options.quoteTaskId ?? 'derived-work-1';
  const quoteOutputCount =
    options.quoteOutputCount ?? options.scopedAssetIds?.length ?? 1;
  const currentQuote = () => ({
    billingMode: 'per_request' as const,
    catalogModelId: 'image-model-old',
    catalogModelRevision: 'catalog-fresh',
    confirmedAmount: quoteOutputCount * 2,
    ...(quoteStatus === 'confirmed'
      ? {
          confirmedAt: '2026-07-20T00:02:00.000Z',
          taskId: quoteTaskId,
        }
      : {}),
    formula: { currency: 'CNY', expression: 'fresh', unitRate: 2 },
    lifecycleStatus: quoteStatus,
    outputCount: quoteOutputCount,
    outputLabel: `${quoteOutputCount} 张 3:4 图片`,
    quoteId: 'quote-fresh',
    quotePolicyRevision: 'policy-fresh',
    revision: 'quote-revision-fresh',
    workspaceId: 'ws-1',
  });
  const quotes = {
    async getQuote() {
      return currentQuote();
    },
    async confirm(input: unknown) {
      confirmCalls.push(input);
      quoteTaskId = (input as { taskId: string }).taskId;
      quoteStatus = 'confirmed';
      return currentQuote();
    },
  } as unknown as ProductBillingApplicationPort;
  const snapshots = {
    async get() {
      return {
        catalogModel: { id: 'image-model-old', revision: 'catalog-old' },
        contentModules: ['social_cover'] as ['social_cover'],
        contentPackage: { expectedRevision: 0, id: 'package-1' },
        deliverable: {
          aspectRatio: '3:4' as const,
          kind: 'image_set' as const,
          quantity: 2,
        },
        id: options.semanticSnapshot
          ? 'snapshot-decision-note-style'
          : 'snapshot-task-1',
        ...(options.noteSnapshot ? { lens: 'image_text_note' as const } : {}),
        modelSelection: {
          catalogModelId: 'image-model-old',
          platformConfigRevision: null,
          source: 'current_selection' as const,
        },
        operation: options.sourceOperation ?? ('image.generate' as const),
        revision: 1 as const,
        task: { id: 'task-1' },
        work: { id: 'work-1' },
        workspaceId: 'ws-1',
        ...(options.semanticSnapshot
          ? {
              semanticDecision: {
                sourceSnapshotId: 'snapshot-task-1',
                reference: {
                  field: 'note_style',
                  id: 'decision-note-style',
                  revision: 1,
                  value: '故事版',
                },
              },
            }
          : {}),
      } as unknown as CreationExecutionSnapshot;
    },
  };
  const composerSubmissions = {
    async submit(input: { workId: string }) {
      composerCalls.push(input);
      return {
        contentPackage: { id: 'adjusted-package-1' },
        task: { id: 'adjusted-task-1' },
        work: { id: input.workId },
      };
    },
  };
  return {
    composerCalls,
    confirmCalls,
    deriveCalls,
    port: new OperationsResultCommandPort(
      operations,
      quotes,
      snapshots,
      composerSubmissions,
    ),
    submitCalls,
  };
}

test('Composer snapshot adjustment prepares from frozen server facts', async () => {
  const { deriveCalls, port } = fixture();
  const prepared = await port.prepareAdjust(
    context,
    {
      expectedWorkUpdatedAt: '2026-07-20T00:00:00.000Z',
      instruction: '换成夏日风格',
      scope: { assetId: 'asset-1', kind: 'asset' },
      source: {
        expectedPackageRevision: 3,
        kind: 'content_package_snapshot',
        packageId: 'package-1',
        snapshotId: 'snapshot-task-1',
        workflowId: 'task-1',
      },
      workId: 'work-1',
    },
    'adjust-composer-prepare',
  );

  assert.deepEqual(deriveCalls, []);
  assert.match(prepared.work.id, /^work-result-adjust-/u);
  assert.match(prepared.task.id, /^composer-task:result-adjust:/u);
  assert.deepEqual(prepared.quoteIntent, {
    aspectRatio: '3:4',
    catalogModelId: 'image-model-old',
    operation: 'image.generate',
    quantity: 1,
  });
});

test('Composer snapshot adjustment preparation does not create a legacy Work', async () => {
  const { deriveCalls, port } = fixture({
    sourceSessionId: 'composer:surface-copy:copy@r1',
  });
  await port.prepareAdjust(
    context,
    {
      expectedWorkUpdatedAt: '2026-07-20T00:00:00.000Z',
      instruction: '语气更自然',
      source: {
        expectedPackageRevision: 3,
        kind: 'content_package_snapshot',
        packageId: 'package-1',
        snapshotId: 'snapshot-task-1',
        workflowId: 'task-1',
      },
      workId: 'work-1',
    },
    'adjust-composer-session',
  );

  assert.deepEqual(deriveCalls, []);
});

test('Composer snapshot adjustment keeps the latest semantic decision snapshot', async () => {
  const { composerCalls, port } = fixture({
    noteSnapshot: true,
    quoteStatus: 'quoted',
    semanticSnapshot: true,
  });
  const source = {
    expectedPackageRevision: 3,
    kind: 'content_package_snapshot' as const,
    packageId: 'package-1',
    snapshotId: 'snapshot-task-1',
    workflowId: 'task-1',
  };
  const prepared = await port.prepareAdjust(
    context,
    {
      expectedWorkUpdatedAt: '2026-07-20T00:00:00.000Z',
      instruction: '只调整当前图片',
      scope: { assetId: 'asset-1', kind: 'asset' },
      source,
      workId: 'work-1',
    },
    'adjust-semantic-prepare',
  );
  await port.adjust(
    context,
    {
      billingQuoteId: 'quote-fresh',
      derivedTaskId: prepared.task.id,
      derivedWorkId: prepared.work.id,
      instruction: '只调整当前图片',
      scope: { assetId: 'asset-1', kind: 'asset' },
      source,
    },
    'adjust-semantic-confirm',
  );

  assert.equal(composerCalls.length, 1);
  assert.equal(
    (composerCalls[0] as { sourceNoteStyleId?: string }).sourceNoteStyleId,
    'story',
  );
  assert.equal(
    (
      composerCalls[0] as {
        sourceSnapshot: CreationExecutionSnapshot;
      }
    ).sourceSnapshot.semanticDecision?.reference.value,
    '故事版',
  );
});

test('Composer snapshot adjustment never fabricates a legacy CreativeJob', async () => {
  const { composerCalls, port, submitCalls } = fixture({
    quoteOutputCount: 2,
    quoteStatus: 'quoted',
  });
  const command = {
    expectedWorkUpdatedAt: '2026-07-20T00:00:00.000Z',
    instruction: '换成夏日风格',
    source: {
      expectedPackageRevision: 3,
      kind: 'content_package_snapshot' as const,
      packageId: 'package-1',
      snapshotId: 'snapshot-task-1',
      workflowId: 'task-1',
    },
    workId: 'work-1',
  };
  const prepared = await port.prepareAdjust(
    context,
    command,
    'adjust-composer-prepare-success',
  );
  await port.adjust(
    context,
    {
      billingQuoteId: 'quote-fresh',
      derivedTaskId: prepared.task.id,
      derivedWorkId: prepared.work.id,
      instruction: command.instruction,
      source: command.source,
    },
    'adjust-composer-confirm',
  );

  assert.deepEqual(submitCalls, []);
  assert.equal(composerCalls.length, 1);
});

test('video adjustment is unavailable before quote or derived work creation', async () => {
  const {
    composerCalls,
    confirmCalls,
    deriveCalls,
    port,
    submitCalls,
  } = fixture({ sourceOperation: 'video.generate' });

  await assert.rejects(
    port.prepareAdjust(
      context,
      {
        expectedWorkUpdatedAt: '2026-07-20T00:00:00.000Z',
        instruction: '修改字幕',
        source: {
          expectedPackageRevision: 3,
          kind: 'content_package_snapshot',
          packageId: 'package-1',
          snapshotId: 'snapshot-task-1',
          workflowId: 'task-1',
        },
        workId: 'work-1',
      },
      'adjust-video-unavailable',
    ),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'RESULT_ADJUST_OPERATION_UNSUPPORTED',
  );
  assert.deepEqual(confirmCalls, []);
  assert.deepEqual(deriveCalls, []);
  assert.deepEqual(composerCalls, []);
  assert.deepEqual(submitCalls, []);
});

test('Composer snapshot adjustment confirmation rejects changed prepared semantics', async () => {
  const { composerCalls, port } = fixture({
    quoteOutputCount: 1,
    quoteStatus: 'quoted',
  });
  const source = {
    expectedPackageRevision: 3,
    kind: 'content_package_snapshot' as const,
    packageId: 'package-1',
    snapshotId: 'snapshot-task-1',
    workflowId: 'task-1',
  };
  const prepared = await port.prepareAdjust(
    context,
    {
      expectedWorkUpdatedAt: '2026-07-20T00:00:00.000Z',
      instruction: '换成夏日风格',
      scope: { assetId: 'asset-1', kind: 'asset' },
      source,
      workId: 'work-1',
    },
    'adjust-composer-prepare-binding',
  );

  await assert.rejects(
    port.adjust(
      context,
      {
        billingQuoteId: 'quote-fresh',
        derivedTaskId: prepared.task.id,
        derivedWorkId: prepared.work.id,
        instruction: '改成冬日风格',
        scope: { assetId: 'asset-1', kind: 'asset' },
        source,
      },
      'adjust-composer-confirm-tampered',
    ),
    /prepared adjustment Work and its frozen source were not found/,
  );
  await assert.rejects(
    port.adjust(
      context,
      {
        billingQuoteId: 'quote-fresh',
        derivedTaskId: prepared.task.id,
        derivedWorkId: prepared.work.id,
        instruction: '换成夏日风格',
        scope: { assetId: 'asset-2', kind: 'asset' },
        source,
      },
      'adjust-composer-confirm-scope-tampered',
    ),
    /prepared adjustment Work and its frozen source were not found/,
  );
  assert.deepEqual(composerCalls, []);
});

test('Composer snapshot adjustment fails closed on package revision drift', async () => {
  const { deriveCalls, port } = fixture({ packageRevision: 4 });
  await assert.rejects(
    port.prepareAdjust(
      context,
      {
        expectedWorkUpdatedAt: '2026-07-20T00:00:00.000Z',
        instruction: '换成夏日风格',
        source: {
          expectedPackageRevision: 3,
          kind: 'content_package_snapshot',
          packageId: 'package-1',
          snapshotId: 'snapshot-task-1',
          workflowId: 'task-1',
        },
        workId: 'work-1',
      },
      'adjust-composer-stale-package',
    ),
    /Result changed before this adjustment was submitted/,
  );
  assert.deepEqual(deriveCalls, []);
});

test('Composer snapshot adjustment fails closed on workflow binding drift', async () => {
  const { deriveCalls, port } = fixture({
    packageWorkflowId: 'task-other',
  });
  await assert.rejects(
    port.prepareAdjust(
      context,
      {
        expectedWorkUpdatedAt: '2026-07-20T00:00:00.000Z',
        instruction: '换成夏日风格',
        source: {
          expectedPackageRevision: 3,
          kind: 'content_package_snapshot',
          packageId: 'package-1',
          snapshotId: 'snapshot-task-1',
          workflowId: 'task-1',
        },
        workId: 'work-1',
      },
      'adjust-composer-workflow-drift',
    ),
    /frozen ContentPackage adjustment source was not found/,
  );
  assert.deepEqual(deriveCalls, []);
});

test('Composer snapshot adjustment rejects scope outside the current package', async () => {
  const { deriveCalls, port } = fixture();
  await assert.rejects(
    port.prepareAdjust(
      context,
      {
        expectedWorkUpdatedAt: '2026-07-20T00:00:00.000Z',
        instruction: '换成夏日风格',
        scope: { assetId: 'foreign-asset', kind: 'asset' },
        source: {
          expectedPackageRevision: 3,
          kind: 'content_package_snapshot',
          packageId: 'package-1',
          snapshotId: 'snapshot-task-1',
          workflowId: 'task-1',
        },
        workId: 'work-1',
      },
      'adjust-composer-foreign-scope',
    ),
    /adjustment scope does not belong to the source Job/,
  );
  assert.deepEqual(deriveCalls, []);
});

test('Composer snapshot adjustment rejects a quote for another quantity', async () => {
  const { port, submitCalls } = fixture({
    quoteOutputCount: 1,
    quoteStatus: 'quoted',
  });
  const command = {
    expectedWorkUpdatedAt: '2026-07-20T00:00:00.000Z',
    instruction: '换成夏日风格',
    source: {
      expectedPackageRevision: 3,
      kind: 'content_package_snapshot' as const,
      packageId: 'package-1',
      snapshotId: 'snapshot-task-1',
      workflowId: 'task-1',
    },
    workId: 'work-1',
  };
  const prepared = await port.prepareAdjust(
    context,
    command,
    'adjust-composer-prepare-wrong-quantity',
  );
  await assert.rejects(
    port.adjust(
      context,
      {
        billingQuoteId: 'quote-fresh',
        derivedTaskId: prepared.task.id,
        derivedWorkId: prepared.work.id,
        instruction: command.instruction,
        source: command.source,
      },
      'adjust-composer-wrong-quantity',
    ),
    /fresh Product quote does not match this prepared adjustment/,
  );
  assert.deepEqual(submitCalls, []);
});

test('image adjustment freezes an owned explicit scope into derived intent', async () => {
  const { deriveCalls, port, submitCalls } = fixture();
  const prepared = await port.prepareAdjust(
    context,
    {
      expectedWorkUpdatedAt: '2026-07-20T00:00:00.000Z',
      instruction: '换成夏日风格',
      scope: { assetId: 'asset-1', kind: 'asset' },
      source: { baseJobId: 'job-1', kind: 'legacy_job' },
      workId: 'work-1',
    },
    'adjust-1',
  );
  assert.match(JSON.stringify(deriveCalls), /调整范围：单张 asset-1/);
  assert.deepEqual(prepared.quoteIntent, {
    aspectRatio: '3:4',
    catalogModelId: 'image-model-old',
    operation: 'image.generate',
    quantity: 1,
  });
  assert.deepEqual(submitCalls, []);
});

test('image adjustment rejects an asset outside the frozen source Job', async () => {
  const { deriveCalls, port } = fixture();
  await assert.rejects(
    port.prepareAdjust(
      context,
      {
        expectedWorkUpdatedAt: '2026-07-20T00:00:00.000Z',
        instruction: '换成夏日风格',
        scope: { assetId: 'foreign-asset', kind: 'asset' },
        source: { baseJobId: 'job-1', kind: 'legacy_job' },
        workId: 'work-1',
      },
      'adjust-2',
    ),
    /adjustment scope does not belong to the source Job/,
  );
  assert.deepEqual(deriveCalls, []);
});

test('confirmed adjustment submits with only the server quote facts', async () => {
  const { port, submitCalls } = fixture();
  await port.adjust(
    context,
    {
      billingQuoteId: 'quote-fresh',
      derivedWorkId: 'derived-work-1',
      source: { baseJobId: 'job-1', kind: 'legacy_job' },
    },
    'adjust-confirm-1',
  );

  assert.equal(submitCalls.length, 1);
  const contract = submitCalls[0]?.[2] as Record<string, unknown>;
  assert.deepEqual(
    {
      catalogModelId: contract.catalogModelId,
      catalogRevision: contract.catalogRevision,
      currency: contract.currency,
      estimatedAmount: contract.estimatedAmount,
      quoteAcceptedAt: contract.quoteAcceptedAt,
      quoteRevision: contract.quoteRevision,
    },
    {
      catalogModelId: 'image-model-old',
      catalogRevision: 'catalog-fresh',
      currency: 'CNY',
      estimatedAmount: 2,
      quoteAcceptedAt: '2026-07-20T00:02:00.000Z',
      quoteRevision: 'quote-revision-fresh',
    },
  );
  assert.equal(submitCalls[0]?.[8], 'quote-fresh');
});

test('adjust confirmation binds a fresh quote to the server-derived Work', async () => {
  const { confirmCalls, port } = fixture({ quoteStatus: 'quoted' });
  await port.adjust(
    context,
    {
      billingQuoteId: 'quote-fresh',
      derivedWorkId: 'derived-work-1',
      source: { baseJobId: 'job-1', kind: 'legacy_job' },
    },
    'adjust-confirm-quoted',
  );
  assert.deepEqual(confirmCalls, [
    {
      quoteId: 'quote-fresh',
      taskId: 'derived-work-1',
      workspaceId: 'ws-1',
    },
  ]);
});

test('set adjustment freezes the explicit set size into the submitted contract', async () => {
  const { port, submitCalls } = fixture({
    scopedAssetIds: ['asset-1', 'asset-2'],
  });
  await port.adjust(
    context,
    {
      billingQuoteId: 'quote-fresh',
      derivedWorkId: 'derived-work-1',
      source: { baseJobId: 'job-1', kind: 'legacy_job' },
    },
    'adjust-confirm-set',
  );
  const contract = submitCalls[0]?.[2] as Record<string, unknown>;
  assert.equal(contract.outputCount, 2);
  assert.equal(contract.outputLabel, '2 张 3:4 图片');
  assert.equal(contract.estimatedAmount, 4);
});

test('set adjustment rejects a quote for a different output quantity', async () => {
  const { port, submitCalls } = fixture({
    quoteOutputCount: 1,
    scopedAssetIds: ['asset-1', 'asset-2'],
  });
  await assert.rejects(
    port.adjust(
      context,
      {
        billingQuoteId: 'quote-fresh',
        derivedWorkId: 'derived-work-1',
        source: { baseJobId: 'job-1', kind: 'legacy_job' },
      },
      'adjust-confirm-wrong-quantity',
    ),
    /fresh Product quote does not match this prepared adjustment/,
  );
  assert.deepEqual(submitCalls, []);
});
