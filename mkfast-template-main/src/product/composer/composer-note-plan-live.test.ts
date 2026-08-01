import assert from 'node:assert/strict';
import test from 'node:test';

import {
  contentPackageSchema,
  type ProductQuoteSnapshot,
  type PublicContentPackage,
} from '@meiye/contracts';

import {
  confirmComposerNotePlanPageRegeneration,
  prepareComposerNotePlanPageRegeneration,
  saveComposerNotePlanOutline,
  type ComposerNotePlanCommandSubmit,
} from './composer-note-plan-live';

function canonicalPackage(): PublicContentPackage {
  return contentPackageSchema.parse({
    compliance: { aigcLabelEnabled: false, watermarkEnabled: false },
    createdAt: '2026-08-02T02:00:00.000Z',
    currentVersionId: 'version-note-1',
    exportReceipts: [],
    generated: {
      assetIds: ['asset-cover', 'asset-body'],
      childRuns: [],
    },
    id: 'package-note-1',
    kind: 'image_text',
    lineage: {},
    revision: 3,
    rights: { state: 'authorized' },
    source: {
      assetIds: ['asset-cover', 'asset-body'],
      creationExecutionSnapshot: {
        id: 'snapshot-note-1',
        revision: 1,
        schemaVersion: 'creation-execution-snapshot/v1',
      },
      workId: 'work-note-1',
      workflowId: 'task-note-1',
      workflowRevision: 1,
    },
    status: 'accepted',
    updatedAt: '2026-08-02T02:00:00.000Z',
    variants: [],
    versions: [
      {
        body: '补水护理正文',
        createdAt: '2026-08-02T02:00:00.000Z',
        harnessCandidateId: 'practical-guide',
        id: 'version-note-1',
        note: {
          schema: 'image-text-note-version/v1',
          plan: {
            schema: 'note-plan/v1',
            themeAnchor: '夏日补水护理',
            style: {
              id: 'practical-guide',
              name: '干货科普版',
              positioning: '清楚可信',
            },
            pages: [
              {
                dependencies: [],
                id: 'page-1',
                imageAssetId: 'asset-cover',
                imageIntent: {
                  changes: [],
                  composition: '主体清晰',
                  exactText: [],
                  factRefs: [],
                  invariants: [],
                  operation: 'image.generate',
                  outputPlan: { kind: 'single' },
                  purpose: '封面配图',
                  references: [],
                  rightsRefs: [],
                  scene: '真实门店场景',
                  subject: '门店护理项目',
                },
                order: 1,
                pagePurpose: 'capture_attention',
                pageRole: 'cover',
                revision: 1,
                textBlock: {
                  body: '先判断当下肤况。',
                  exactText: [],
                  title: '补水先看肤况',
                },
              },
              {
                dependencies: [{ kind: 'text_sequence', pageId: 'page-1' }],
                id: 'page-2',
                imageAssetId: 'asset-body',
                imageIntent: {
                  changes: [],
                  composition: '主体清晰',
                  exactText: [],
                  factRefs: [],
                  invariants: [],
                  operation: 'image.generate',
                  outputPlan: { kind: 'single' },
                  purpose: '行动页配图',
                  references: [],
                  rightsRefs: [],
                  scene: '真实门店场景',
                  subject: '门店护理项目',
                },
                order: 2,
                pagePurpose: 'drive_action',
                pageRole: 'cta_guide',
                revision: 1,
                textBlock: {
                  body: '私信说明你的肤况。',
                  exactText: [],
                  title: '预约前先沟通',
                },
              },
            ],
          },
          regenerationReceipts: [],
        },
        orderedAssetIds: ['asset-cover', 'asset-body'],
        title: '夏日补水护理',
        topics: ['补水护理'],
      },
    ],
    workspaceId: 'workspace-note-1',
  });
}

test('outline save writes the full canonical note and reprojects only the server response', async () => {
  const contentPackage = canonicalPackage();
  const calls: Array<{
    action: string;
    payload: Record<string, unknown>;
  }> = [];
  const submit: ComposerNotePlanCommandSubmit = async (
    _module,
    action,
    payload
  ) => {
    calls.push({ action, payload });
    const command = payload as {
      changes: {
        note: NonNullable<(typeof contentPackage.versions)[number]['note']>;
      };
    };
    const { harnessCandidateId: _harnessCandidateId, ...baseVersion } =
      contentPackage.versions[0]!;
    const version = {
      ...baseVersion,
      ...command.changes,
      id: 'version-note-2',
      derivedFromVersionId: 'version-note-1',
    };
    return {
      ...contentPackage,
      currentVersionId: version.id,
      revision: 4,
      versions: [...contentPackage.versions, version],
    };
  };

  const saved = await saveComposerNotePlanOutline({
    contentPackage,
    edit: {
      body: '这是商家改过的封面正文。',
      pageId: 'page-1',
      title: '这是商家改过的封面标题',
    },
    submit,
  });

  assert.equal(calls[0]?.action, 'edit_content_package_version');
  assert.deepEqual(
    (calls[0]?.payload.changes as { note: unknown }).note,
    saved.contentPackage.versions.at(-1)?.note
  );
  assert.equal(calls[0]?.payload.expectedRevision, 3);
  assert.equal(
    (calls[0]?.payload.changes as { body: string }).body,
    '这是商家改过的封面正文。\n\n私信说明你的肤况。'
  );
  assert.equal(saved.contentPackage.revision, 4);
  assert.equal(saved.timeline.styleId, 'practical-guide');
  assert.equal(saved.timeline.pages[0]?.title, '这是商家改过的封面标题');
  assert.equal(saved.timeline.pages[0]?.outlineDirty, false);
});

test('per-page regeneration prepares and quotes before any execution command', async () => {
  const calls: Array<{
    action: string;
    module: string;
    payload: Record<string, unknown>;
  }> = [];
  const submit: ComposerNotePlanCommandSubmit = async (
    module,
    action,
    payload
  ) => {
    calls.push({ action, module, payload });
    if (action === 'result_adjust_prepare') {
      return {
        quoteIntent: {
          aspectRatio: '3:4',
          catalogModelId: 'catalog-image-model',
          operation: 'image.generate',
          quantity: 1,
        },
        task: { id: 'derived-task-1' },
        work: { id: 'derived-work-1' },
      };
    }
    if (action === 'quote') {
      return {
        catalogModelId: 'catalog-image-model',
        confirmedAmount: 1,
        debitUnits: [{ quantity: 1, resource: 'image' }],
        formula: { currency: 'CNY' },
        lifecycleStatus: 'quoted',
        outputCount: 1,
        outputLabel: '1 张图片',
        quoteId: 'quote-note-regenerate-1',
        revision: 'quote-revision-1',
      } as ProductQuoteSnapshot;
    }
    throw new Error(`Unexpected command: ${module}.${action}`);
  };

  const pending = await prepareComposerNotePlanPageRegeneration({
    contentPackage: canonicalPackage(),
    createId: () => 'quote-note-regenerate-1',
    pageId: 'page-1',
    submit,
    workId: 'work-note-1',
    workUpdatedAt: '2026-08-02T02:00:00.000Z',
  });

  assert.deepEqual(
    calls.map(({ module, action }) => `${module}.${action}`),
    ['result-delivery.result_adjust_prepare', 'product-billing.quote']
  );
  assert.deepEqual(calls[0]?.payload.scope, {
    assetId: 'asset-cover',
    kind: 'asset',
  });
  assert.deepEqual(calls[0]?.payload.source, {
    expectedPackageRevision: 3,
    kind: 'content_package_snapshot',
    packageId: 'package-note-1',
    snapshotId: 'snapshot-note-1',
    workflowId: 'task-note-1',
  });
  assert.equal(pending.pageId, 'page-1');
  assert.equal(pending.quote.quoteId, 'quote-note-regenerate-1');
  assert.equal(
    calls.some(({ action }) => action === 'result_adjust'),
    false
  );
});

test('confirmation starts the derived task while prepare failure has no execution exit', async () => {
  const prepared = await prepareComposerNotePlanPageRegeneration({
    contentPackage: canonicalPackage(),
    createId: () => 'quote-note-regenerate-2',
    pageId: 'page-2',
    submit: async (_module, action) => {
      if (action === 'result_adjust_prepare') {
        return {
          quoteIntent: {
            catalogModelId: 'catalog-image-model',
            operation: 'image.generate',
            quantity: 1,
          },
          task: { id: 'derived-task-2' },
          work: { id: 'derived-work-2' },
        };
      }
      return {
        catalogModelId: 'catalog-image-model',
        confirmedAmount: 1,
        debitUnits: [{ quantity: 1, resource: 'image' }],
        formula: { currency: 'CNY' },
        lifecycleStatus: 'quoted',
        outputCount: 1,
        outputLabel: '1 张图片',
        quoteId: 'quote-note-regenerate-2',
        revision: 'quote-revision-2',
      } as ProductQuoteSnapshot;
    },
    workId: 'work-note-1',
    workUpdatedAt: '2026-08-02T02:00:00.000Z',
  });
  const confirmCalls: string[] = [];
  const result = await confirmComposerNotePlanPageRegeneration({
    pending: prepared,
    submit: async (module, action, payload) => {
      confirmCalls.push(`${module}.${action}`);
      assert.equal(
        (payload as { derivedTaskId: string }).derivedTaskId,
        'derived-task-2'
      );
      return {
        contentPackage: { id: 'derived-package-2' },
        task: { id: 'derived-task-2' },
        work: { id: 'derived-work-2' },
      };
    },
  });
  assert.deepEqual(confirmCalls, ['result-delivery.result_adjust']);
  assert.equal(result.task.id, 'derived-task-2');

  const failureCalls: string[] = [];
  await assert.rejects(
    prepareComposerNotePlanPageRegeneration({
      contentPackage: canonicalPackage(),
      pageId: 'page-1',
      submit: async (module, action) => {
        failureCalls.push(`${module}.${action}`);
        throw new Error('prepare unavailable');
      },
      workId: 'work-note-1',
      workUpdatedAt: '2026-08-02T02:00:00.000Z',
    }),
    /prepare unavailable/
  );
  assert.deepEqual(failureCalls, ['result-delivery.result_adjust_prepare']);
});
