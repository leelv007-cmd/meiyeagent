import assert from 'node:assert/strict';
import test from 'node:test';

import type { CreativeWork } from '@meiye/contracts';

import { creativeWorkDisplay } from './creative-work-display';

const legacyGeneratedPrompt = '生成一组内部稳定执行指令，不向用户展示。';
const preset = {
  id: 'preset-a',
  inputGuide: '上传同一项目的前后对比图。',
  name: 'Before/After',
};

function work(overrides: Partial<CreativeWork> = {}): CreativeWork {
  return {
    createdAt: '2026-07-13T08:00:00.000Z',
    id: 'work-a',
    intent: '手写的夏季项目推广',
    mode: 'agent',
    sessionId: 'session-a',
    sourceReferences: [],
    status: 'draft',
    updatedAt: '2026-07-13T08:00:00.000Z',
    workspaceId: 'workspace-a',
    ...overrides,
  };
}

test('template-backed work keeps its recorded intent after hidden-prompt retirement', () => {
  const display = creativeWorkDisplay(
    work({
      intent: legacyGeneratedPrompt,
      sourceReferences: [{ id: preset.id, kind: 'template' }],
    }),
    [preset],
    true
  );

  assert.deepEqual(display, {
    kind: 'manual',
    title: legacyGeneratedPrompt,
  });
});

test('manual intent remains visible when an unrelated template is added later', () => {
  const display = creativeWorkDisplay(
    work({ sourceReferences: [{ id: preset.id, kind: 'template' }] }),
    [preset],
    true
  );

  assert.equal(display.kind, 'manual');
  assert.equal(display.title, '手写的夏季项目推广');
});

test('template-backed work stays neutral while catalog facts are unresolved', () => {
  const unresolved = work({
    intent: legacyGeneratedPrompt,
    sourceReferences: [{ id: 'missing-preset', kind: 'template' }],
  });

  assert.deepEqual(creativeWorkDisplay(unresolved, [], false), {
    kind: 'unresolved',
    title: '正在读取创作预设',
  });
  assert.deepEqual(creativeWorkDisplay(unresolved, [], true), {
    kind: 'unresolved',
    title: '创作预设暂不可用',
  });
});
