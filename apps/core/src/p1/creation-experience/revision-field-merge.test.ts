import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  draftBodyOwnsField,
  resolveThreeStateCollectionField,
  resolveThreeStateDraftField,
} from './revision-field-merge.js';

describe('three-state revision field merge (#359)', () => {
  it('create path: missing field yields the normalized default', () => {
    const resolved = resolveThreeStateDraftField({
      inputOwnsField: false,
      inputValue: undefined,
      headValue: undefined,
      defaultValue: [] as string[],
    });
    assert.deepEqual(resolved, []);
  });

  it('update path: missing field inherits head value (clone)', () => {
    const head = ['workflow.copy@1', 'skill.a@2'];
    const resolved = resolveThreeStateDraftField({
      inputOwnsField: false,
      inputValue: undefined,
      headValue: head,
      defaultValue: [] as string[],
    });
    assert.deepEqual(resolved, head);
    assert.notEqual(resolved, head);
    resolved.push('mutated');
    assert.deepEqual(head, ['workflow.copy@1', 'skill.a@2']);
  });

  it('update path: explicit empty value clears the field', () => {
    const resolved = resolveThreeStateDraftField({
      inputOwnsField: true,
      inputValue: [] as string[],
      headValue: ['must-not-inherit'],
      defaultValue: ['must-not-default'] as string[],
    });
    assert.deepEqual(resolved, []);
  });

  it('update path: explicit non-empty value replaces head', () => {
    const resolved = resolveThreeStateDraftField({
      inputOwnsField: true,
      inputValue: ['next@1'],
      headValue: ['old@1'],
      defaultValue: [] as string[],
    });
    assert.deepEqual(resolved, ['next@1']);
  });

  it('draftBodyOwnsField distinguishes omit vs explicit empty', () => {
    assert.equal(draftBodyOwnsField({}, 'factTypes'), false);
    assert.equal(draftBodyOwnsField({ factTypes: [] }, 'factTypes'), true);
    assert.equal(
      draftBodyOwnsField({ factTypes: ['store_name'] }, 'factTypes'),
      true,
    );
  });

  it('collection helper: omit/inherit/clear map to the three states', () => {
    assert.deepEqual(
      resolveThreeStateCollectionField({}, 'skillRevisionRefs', undefined, []),
      [],
    );
    assert.deepEqual(
      resolveThreeStateCollectionField(
        {},
        'skillRevisionRefs',
        ['skill.head@1'],
        [],
      ),
      ['skill.head@1'],
    );
    assert.deepEqual(
      resolveThreeStateCollectionField(
        { skillRevisionRefs: [] },
        'skillRevisionRefs',
        ['skill.head@1'],
        [],
      ),
      [],
    );
  });

  it('collection helper: head empty array is still a defined inherit source', () => {
    assert.deepEqual(
      resolveThreeStateCollectionField({}, 'factTypes', [], ['default-should-not-win']),
      [],
    );
  });
});
