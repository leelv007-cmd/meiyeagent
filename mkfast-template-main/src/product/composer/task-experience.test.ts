/**
 * Pure model tests for task-in experience surfaces (#325 / P2-13).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canActOnExperienceSediment,
  experienceEntryLabel,
  projectExperienceBasis,
  projectExperienceCorrection,
  projectExperienceSediment,
  shouldShowExperienceBasis,
  shouldShowExperienceCorrection,
  shouldShowExperienceSediment,
} from './task-experience';

test('sediment actions reject entry ids outside the current task projection', () => {
  const projection = {
    state: 'ready' as const,
    items: [{ id: 'current-entry', label: '当前任务经验' }],
  };

  assert.equal(canActOnExperienceSediment(projection, 'current-entry'), true);
  assert.equal(canActOnExperienceSediment(projection, 'other-entry'), false);
});

test('experienceEntryLabel never stringifies objects as JSON blobs', () => {
  assert.equal(experienceEntryLabel('主理人口吻', 'x'), '主理人口吻');
  assert.equal(
    experienceEntryLabel({ tone: '少促销感', hook: '先讲问题' }, 'x'),
    '少促销感 · 先讲问题'
  );
  assert.equal(
    experienceEntryLabel(['a', 'b', { nested: true }], 'x'),
    'a · b'
  );
  assert.equal(experienceEntryLabel({}, 'fallback'), 'fallback');
});

test('basis renders only labels supplied by the frozen current-task producer', () => {
  const ready = projectExperienceBasis({
    producerSettled: true,
    confirmedPreferences: [
      {
        sourceRef: 'preference:tone:r1',
        label: '少促销感',
        value: 'the UI must not re-derive this label',
      },
      {
        sourceRef: 'preference:structure:r2',
        label: '先讲问题再讲项目',
        value: { structure: ['problem', 'project'] },
      },
    ],
  });
  assert.equal(ready.state, 'ready');
  assert.deepEqual(
    ready.chips.map((c) => c.label),
    ['少促销感', '先讲问题再讲项目']
  );
});

test('basis is honest empty when producer settled with nothing', () => {
  const empty = projectExperienceBasis({
    producerSettled: true,
    confirmedPreferences: [],
  });
  assert.equal(empty.state, 'empty');
  assert.deepEqual(empty.chips, []);
});

test('basis stays loading until the producer settles', () => {
  const loading = projectExperienceBasis({
    producerSettled: false,
    confirmedPreferences: [],
  });
  assert.equal(loading.state, 'loading');
  assert.deepEqual(loading.chips, []);
});

test('sediment projects pending entries only after settle', () => {
  assert.equal(
    projectExperienceSediment({
      querySettled: false,
      taskSourceConversationId: 'work-current:task-current',
      pendingEntries: [
        {
          entryId: 'p1',
          sourceConversationId: 'work-current:task-current',
          value: 'x',
        },
      ],
    }).state,
    'loading'
  );
  assert.equal(
    projectExperienceSediment({
      querySettled: true,
      taskSourceConversationId: null,
      pendingEntries: [
        {
          entryId: 'workspace-pending',
          sourceConversationId: 'work-other:task-other',
          value: '无关任务的经验',
        },
      ],
    }).state,
    'empty'
  );
  assert.equal(
    projectExperienceSediment({
      querySettled: true,
      taskSourceConversationId: 'work-current:task-current',
      pendingEntries: [],
    }).state,
    'empty'
  );
  const ready = projectExperienceSediment({
    querySettled: true,
    taskSourceConversationId: 'work-current:task-current',
    pendingEntries: [
      {
        entryId: 'p1',
        sourceConversationId: 'work-current:task-current',
        value: '私信了解',
      },
    ],
  });
  assert.equal(ready.state, 'ready');
  assert.equal(ready.items[0]?.label, '私信了解');
});

test('correction is empty without a ready producer (no forged classification)', () => {
  const empty = projectExperienceCorrection({
    producerReady: false,
    classification: { kind: 'fact', summary: '她是店长' },
  });
  assert.equal(empty.state, 'empty');
  assert.equal(empty.kind, null);

  const ready = projectExperienceCorrection({
    producerReady: true,
    classification: { kind: 'task_only', summary: '这次不要写价格' },
  });
  assert.equal(ready.state, 'ready');
  assert.equal(ready.kind, 'task_only');
  assert.equal(ready.summary, '这次不要写价格');
});

test('phase gates match pre-exec / post-delivery / ready-only correction', () => {
  assert.equal(shouldShowExperienceBasis('running'), true);
  assert.equal(shouldShowExperienceBasis('delivered'), false);
  assert.equal(shouldShowExperienceSediment('delivered'), true);
  assert.equal(shouldShowExperienceSediment('running'), false);
  assert.equal(shouldShowExperienceCorrection('idle'), false);
  assert.equal(
    shouldShowExperienceCorrection('running', {
      state: 'empty',
      kind: null,
      summary: null,
    }),
    false
  );
  assert.equal(
    shouldShowExperienceCorrection('running', {
      state: 'ready',
      kind: 'fact',
      summary: '她是店长',
    }),
    true
  );
});
