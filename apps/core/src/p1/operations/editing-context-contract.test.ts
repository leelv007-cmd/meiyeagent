import assert from 'node:assert/strict';
import { test } from 'node:test';
import { editingContextSchema, type EditingContext } from '@meiye/contracts';

test('editing context is a strict shared discriminated contract', () => {
  const contexts: EditingContext[] = [
    { kind: 'layout_work', revisionId: 'revision-a', workId: 'work-a' },
    {
      kind: 'advanced_canvas',
      projectId: 'project-a',
      revisionId: 'revision-b',
    },
    { assetId: 'asset-a', kind: 'asset' },
  ];

  assert.deepEqual(contexts.map((context) => editingContextSchema.parse(context)), contexts);
  assert.throws(() =>
    editingContextSchema.parse({
      kind: 'advanced_canvas',
      projectId: 'project-a',
      revisionId: 'revision-b',
      workId: 'work-a',
    })
  );
  assert.throws(() =>
    editingContextSchema.parse({ kind: 'asset', projectId: 'project-a' })
  );
});
