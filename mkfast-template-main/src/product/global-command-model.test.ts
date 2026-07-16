import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RawCanonicalHistory } from './canonical-history-model';
import type { CreationCatalogEntry } from './creation-catalog-model';
import {
  createPendingCreationAction,
  isGlobalCommandShortcut,
  parsePendingCreationAction,
  projectGlobalNavigation,
} from './global-command-model';

const history = {
  assets: [],
  canvasWorks: [],
  contents: [],
  creativeWorks: [],
  exportReceipts: [],
  imageJobs: [],
  jobs: [
    {
      contract: {
        aigcLabelEnabled: true,
        catalogModelId: 'model-a',
        catalogRevision: 'catalog-a',
        currency: 'CNY',
        dataClass: [],
        estimatedAmount: 1,
        operation: 'copy.generate',
        outputCount: 3,
        outputLabel: '候选文案',
        quoteAcceptedAt: '2026-07-13T08:00:00.000Z',
        quoteRevision: 'quote-a',
        watermarkEnabled: false,
      },
      createdAt: '2026-07-13T08:00:00.000Z',
      id: 'job-a',
      outputAssetIds: [],
      outputContentIds: [],
      status: 'completed',
      submissionKey: 'submission-a',
      updatedAt: '2026-07-13T08:02:00.000Z',
      workId: 'work-a',
      workspaceId: 'workspace-a',
    },
  ],
  sessions: [
    {
      createdAt: '2026-07-13T08:00:00.000Z',
      id: 'session-a',
      updatedAt: '2026-07-13T08:01:00.000Z',
      workIds: ['work-a'],
    },
  ],
  tasks: [
    {
      createdAt: '2026-07-13T08:03:00.000Z',
      dueAt: '2026-07-14T08:03:00.000Z',
      executable: true,
      id: 'task-a',
      risk: 'normal',
      source: 'manual',
      status: 'ready',
      title: '发布夏季项目',
    },
  ],
} satisfies RawCanonicalHistory;

const assetEntry: CreationCatalogEntry = {
  available: true,
  detail: 'image Asset',
  id: 'asset-a',
  kind: 'reference',
  key: 'asset:asset-a',
  label: '主视觉',
  owner: 'user',
  reference: { id: 'asset-a', kind: 'asset' },
  tags: [],
};

describe('global command model', () => {
  it('accepts both Meta+K and Ctrl+K without depending on the focus target', () => {
    assert.equal(
      isGlobalCommandShortcut({
        ctrlKey: false,
        key: 'K',
        metaKey: true,
        repeat: false,
      }),
      true
    );
    assert.equal(
      isGlobalCommandShortcut({
        ctrlKey: true,
        key: 'k',
        metaKey: false,
        repeat: false,
      }),
      true
    );
    assert.equal(
      isGlobalCommandShortcut({
        ctrlKey: true,
        key: 'k',
        metaKey: false,
        repeat: true,
      }),
      false
    );
  });

  it('reuses business navigation and adds only Task, Session and Job deep links', () => {
    const entries = projectGlobalNavigation(history);

    assert.deepEqual(
      entries.slice(0, 4).map((entry) => entry.href),
      [
        '/dashboard',
        '/dashboard/content',
        '/dashboard/assets',
        '/dashboard/store',
      ]
    );
    assert.deepEqual(
      entries.slice(4).map((entry) => `${entry.kind}:${entry.id}`),
      ['task:task-a', 'job:job-a', 'session:session-a']
    );
    assert.ok(entries.every((entry) => entry.actionLabel === '打开'));
  });

  it('creates a stable one-shot pending action without a Work or Job command', () => {
    const first = createPendingCreationAction(assetEntry);
    const second = createPendingCreationAction(assetEntry);

    assert.deepEqual(first, second);
    assert.equal(first.key, 'asset:asset-a');
    assert.deepEqual(first.reference, { id: 'asset-a', kind: 'asset' });
    assert.equal('command' in first, false);
    assert.deepEqual(parsePendingCreationAction(JSON.stringify(first)), first);
  });

  it('rejects malformed or executable pending payloads', () => {
    assert.equal(parsePendingCreationAction('{broken'), undefined);
    assert.equal(
      parsePendingCreationAction(
        JSON.stringify({
          ...createPendingCreationAction(assetEntry),
          command: { type: 'prepare_creative_job' },
        })
      ),
      undefined
    );
  });
});
