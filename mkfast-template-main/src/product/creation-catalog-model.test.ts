import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RawCanonicalHistory } from './canonical-history-model';
import {
  projectCreationCatalog,
  type CreationCatalogResponse,
} from './creation-catalog-model';

const catalog: CreationCatalogResponse = {
  shortcuts: [{ hidden: false, rank: 0, templateId: 'template-a' }],
  templates: [
    {
      enabledVersionId: 'version-a',
      family: 'social_cover',
      id: 'template-a',
      name: '小红书封面',
      publicationStatus: 'enabled',
      tags: ['封面'],
    },
  ],
  userTemplates: [],
};

const history: RawCanonicalHistory = {
  assets: [
    {
      createdAt: '2026-07-13T08:03:00.000Z',
      id: 'asset-a',
      jobId: 'job-a',
      kind: 'image',
      title: '主视觉',
      workId: 'work-a',
      workspaceId: 'workspace-a',
    },
  ],
  canvasWorks: [],
  contents: [],
  creativeWorks: [
    {
      createdAt: '2026-07-13T08:00:00.000Z',
      id: 'work-a',
      intent: '夏季项目推广',
      mode: 'agent',
      sessionId: 'session-a',
      sourceReferences: [],
      status: 'draft',
      updatedAt: '2026-07-13T08:03:00.000Z',
      workspaceId: 'workspace-a',
    },
  ],
  exportReceipts: [],
  imageJobs: [],
  jobs: [],
  sessions: [],
  tasks: [],
};

describe('creation catalog projection', () => {
  it('projects templates, Assets and Works without retired direct-tool rows', () => {
    const entries = projectCreationCatalog(catalog, history);

    assert.deepEqual(
      entries.map((entry) => `${entry.kind}:${entry.id}`),
      ['template:template-a', 'reference:asset-a', 'reference:work-a']
    );
    assert.equal(entries[0]?.shortcut, true);
    assert.deepEqual(entries[0]?.tags, ['封面']);
    assert.equal(entries[1]?.key, 'asset:asset-a');
    assert.equal(entries[2]?.key, 'work:work-a');
    assert.deepEqual(entries[1]?.reference, { id: 'asset-a', kind: 'asset' });
    assert.equal(
      entries.some((entry) => entry.id.includes('.generate')),
      false
    );
  });

  it('keeps unavailable templates visible with a reason', () => {
    const entries = projectCreationCatalog(
      {
        ...catalog,
        templates: [
          {
            ...catalog.templates[0]!,
            publicationStatus: 'retired',
          },
        ],
      },
      history
    );

    assert.equal(entries[0]?.available, false);
    assert.equal(entries[0]?.unavailableReason, '模板已停用');
  });

  it('dead direct-tool ids stay unavailable instead of default Composer', () => {
    const entries = projectCreationCatalog(catalog, history);
    assert.equal(
      entries.find((entry) => entry.id === 'video.generate'),
      undefined
    );
    assert.equal(
      entries.find((entry) => entry.key === 'tool:copy.generate'),
      undefined
    );
  });

  it('keeps duplicate and self references searchable but unavailable', () => {
    const entries = projectCreationCatalog(catalog, history, {
      currentWorkId: 'work-a',
      sourceReferences: [{ id: 'asset-a', kind: 'asset' }],
    });
    const asset = entries.find((entry) => entry.key === 'asset:asset-a');
    const work = entries.find((entry) => entry.key === 'work:work-a');

    assert.equal(asset?.available, false);
    assert.equal(
      asset?.unavailableReason,
      '该来源已在当前创作中，没有重复添加。'
    );
    assert.equal(work?.available, false);
    assert.equal(work?.unavailableReason, '当前创作不能作为自身的来源。');
  });

  it('Z1: catalog templates no longer carry hidden-prompt contracts', () => {
    const preset = projectCreationCatalog(catalog)[0]?.template;
    assert.equal(
      preset?.[('internal' + 'Intent') as keyof typeof preset],
      undefined
    );
  });
});
