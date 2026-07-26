import assert from 'node:assert/strict';
import test from 'node:test';

import { NOTE_STYLE_CONFIG_KEY } from '@meiye/contracts';

import { MemoryAdminConfigRepository } from './foundation-module.js';
import { AdminConfigNotePlanSettingsSource } from './note-plan-settings.js';

test('NotePlan settings use safe defaults and follow admin-config reorder/add/remove changes', async () => {
  const repository = new MemoryAdminConfigRepository();
  const source = new AdminConfigNotePlanSettingsSource(repository);

  const defaults = await source.read();
  assert.deepEqual(
    defaults.styles.styles.map(({ name }) => name),
    ['干货科普版', '种草叙事版'],
  );

  await repository.apply({
    actorId: 'admin-1',
    correlationId: 'note-styles-1',
    expectedRevision: null,
    key: NOTE_STYLE_CONFIG_KEY,
    scope: 'global',
    reason: 'Update note styles',
    value: {
      styles: [
        {
          id: 'story',
          name: '故事版',
          writingGuide: '场景叙事',
          structureTemplate: '场景、方案、行动',
          platforms: ['xiaohongshu'],
        },
        {
          id: 'local',
          name: '同城版',
          writingGuide: '同城导向',
          structureTemplate: '地域、服务、预约',
          platforms: ['xiaohongshu', 'douyin'],
        },
      ],
    },
    workspaceId: '*',
  });
  const configured = await source.read();
  assert.deepEqual(
    configured.styles.styles.map(({ id }) => id),
    ['story', 'local'],
  );
});
