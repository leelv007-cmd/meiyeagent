import assert from 'node:assert/strict';
import test from 'node:test';

import { merchantMessageFromP1 } from './merchant-p1-error';

test('maps steering not-ready codes to Chinese without task ids', () => {
  const message = merchantMessageFromP1({
    code: 'QUEUE_NOT_READY',
    message: 'No admitted execution plan exists for task composer-task:abc',
  });
  assert.match(message, /现在还不能改这一页/);
  assert.doesNotMatch(message, /admitted|composer-task/);
});

test('strips English and snapshot leaks from raw messages', () => {
  const message = merchantMessageFromP1({
    message: '不得偏离 ExecutionPlanSnapshot snapshotHash=abc',
    fallback: '这次没能完成，请再试一次。',
  });
  assert.equal(message, '这次没能完成，请再试一次。');
});
