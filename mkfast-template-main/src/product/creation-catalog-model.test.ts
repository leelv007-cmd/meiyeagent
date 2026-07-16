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
  it('projects templates, tools, Assets and Works from the existing facts', () => {
    const entries = projectCreationCatalog(catalog, history);

    assert.deepEqual(
      entries.map((entry) => `${entry.kind}:${entry.id}`),
      [
        'template:template-a',
        'tool:copy.generate',
        'tool:image.generate',
        'tool:video.generate',
        'reference:asset-a',
        'reference:work-a',
      ]
    );
    assert.equal(entries[0]?.shortcut, true);
    assert.deepEqual(entries[0]?.tags, ['封面']);
    assert.equal(entries[4]?.key, 'asset:asset-a');
    assert.equal(entries[5]?.key, 'work:work-a');
    assert.deepEqual(entries[4]?.reference, { id: 'asset-a', kind: 'asset' });
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

  it('keeps an incompatible tool searchable with its current reason', () => {
    const entries = projectCreationCatalog(catalog, history, {
      'video.generate': {
        available: false,
        unavailableReason: '当前没有带报价的视频模型',
      },
    });
    const video = entries.find((entry) => entry.id === 'video.generate');

    assert.equal(video?.available, false);
    assert.equal(video?.unavailableReason, '当前没有带报价的视频模型');
  });

  it('keeps duplicate and self references searchable but unavailable', () => {
    const entries = projectCreationCatalog(catalog, history, undefined, {
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

  it('projects a named preset Work without exposing its internal intent', () => {
    const preset = projectCreationCatalog(catalog)[0]?.template;
    assert.ok(preset?.internalIntent);
    const entries = projectCreationCatalog(catalog, {
      ...history,
      creativeWorks: [
        {
          ...history.creativeWorks[0]!,
          intent: preset.internalIntent,
          sourceReferences: [{ id: preset.id, kind: 'template' }],
        },
      ],
    });

    assert.equal(entries.at(-1)?.label, preset.name);
    assert.doesNotMatch(entries.at(-1)?.label ?? '', /真实克制/);
  });
});
