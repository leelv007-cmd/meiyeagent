import assert from 'node:assert/strict';
import test from 'node:test';

import { assistantSourceSummaries } from './creation-assistant-context';

test('assistant source summaries use readable facts without exposing source ids', () => {
  const summaries = assistantSourceSummaries({
    assets: [{ id: 'asset-private-123', label: '猫眼甲成品图' }],
    references: [
      { id: 'task-private-456', kind: 'task' },
      { id: 'asset-private-123', kind: 'asset' },
      { id: 'template-private-789', kind: 'template' },
    ],
    tasks: [{ id: 'task-private-456', label: '周末同城引流' }],
    templates: [{ id: 'template-private-789', label: '项目种草' }],
  });

  assert.deepEqual(summaries, [
    '任务：周末同城引流',
    '素材：猫眼甲成品图',
    '预设：项目种草',
  ]);
  assert.equal(summaries.join(' ').includes('private'), false);
});

test('assistant source summaries use safe generic labels for unresolved references', () => {
  const summaries = assistantSourceSummaries({
    references: [
      { id: 'content-secret-id', kind: 'content' },
      { id: 'work-secret-id', kind: 'work' },
    ],
  });

  assert.deepEqual(summaries, ['内容来源', '创作来源']);
  assert.equal(summaries.join(' ').includes('secret'), false);
});
