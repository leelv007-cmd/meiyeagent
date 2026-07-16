import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_INHERITANCE_FIELDS,
  INHERITANCE_FIELD_OPTIONS,
  inheritanceDefaults,
  quickTemplateEntries,
} from './creation-shelf-model';

test('shelf and command palette default to four structural fields', () => {
  assert.deepEqual(inheritanceDefaults('shelf'), DEFAULT_INHERITANCE_FIELDS);
  assert.deepEqual(
    inheritanceDefaults('command_palette'),
    DEFAULT_INHERITANCE_FIELDS
  );
  assert.deepEqual(DEFAULT_INHERITANCE_FIELDS, [
    'content_structure',
    'layout_slots',
    'copy_skeleton',
    'output_specification',
  ]);
  assert.equal(
    DEFAULT_INHERITANCE_FIELDS.includes('visual_style' as never),
    false
  );
});

test('decomposition starts from zero while all labels keep stable ids', () => {
  assert.deepEqual(inheritanceDefaults('decomposition'), []);
  assert.deepEqual(
    INHERITANCE_FIELD_OPTIONS.map((item) => item.id),
    [
      'content_structure',
      'layout_slots',
      'copy_skeleton',
      'output_specification',
      'visual_style',
    ]
  );
});

test('quick templates fill at most three cards from shortcuts then official fallbacks', () => {
  const entries = [
    { key: 'shortcut-a', owner: 'user' as const, shortcut: true },
    { key: 'official-a', owner: 'official' as const, shortcut: false },
    { key: 'official-b', owner: 'official' as const, shortcut: false },
    { key: 'official-c', owner: 'official' as const, shortcut: false },
    { key: 'user-b', owner: 'user' as const, shortcut: false },
  ];

  assert.deepEqual(
    quickTemplateEntries(entries).map((entry) => entry.key),
    ['shortcut-a', 'official-a', 'official-b']
  );
  assert.equal(quickTemplateEntries(entries).length, 3);
});
