import assert from 'node:assert/strict';
import test from 'node:test';

import { translateWorksSystemText, worksCopy } from './works-copy';

test('works copy has complete Chinese and English list-surface messages', () => {
  assert.deepEqual(Object.keys(worksCopy('en')), Object.keys(worksCopy('zh')));
  assert.equal(worksCopy('en').title, 'Content');
  assert.equal(worksCopy('zh').title, '内容');
  assert.equal(worksCopy('en').detail.use, 'How to use this content');
  assert.equal(worksCopy('zh').detail.adjust, '继续调整');
  assert.equal(worksCopy('en').detail.adjust, 'Continue adjusting');
  assert.equal(worksCopy('en').light.title, 'Light edit');
  assert.equal(
    translateWorksSystemText('en', '这一版已确认，可以直接导出。'),
    'This version is confirmed and ready to export.'
  );
  assert.equal(
    translateWorksSystemText('zh', '这一版已确认，可以直接导出。'),
    '这一版已确认，可以直接导出。'
  );
});
