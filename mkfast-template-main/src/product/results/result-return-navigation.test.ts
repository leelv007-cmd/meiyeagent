import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseResultReturnState,
  resultReturnDestination,
  resultReturnSearch,
  type ResultReturnState,
} from './result-return-navigation';

const taskInboxReturn: ResultReturnState = {
  kind: 'task-inbox',
  filters: {
    date: 'week',
    relatedKind: 'work',
    risk: 'attention',
    source: 'manual',
    status: 'in_progress',
  },
  focusKey: 'mobile-progress-entry',
  panel: 'week',
  scrollY: 326,
};

test('serializes a typed Task Inbox return anchor into the Result URL', () => {
  const search = resultReturnSearch(taskInboxReturn);

  assert.deepEqual(search, {
    returnDate: 'week',
    returnFocusKey: 'mobile-progress-entry',
    returnPanel: 'week',
    returnRelatedKind: 'work',
    returnRisk: 'attention',
    returnScrollY: 326,
    returnSource: 'manual',
    returnStatus: 'in_progress',
    returnTo: 'task-inbox',
  });
  assert.deepEqual(parseResultReturnState(search), taskInboxReturn);
});

test('every return lands on the workbench now the task inbox is retired', () => {
  // T34 / #228: 旧任务收件箱 route is a redirect shell, so a task-inbox return
  // state has no page to restore. Old links still parse — they just come home.
  assert.deepEqual(resultReturnDestination(taskInboxReturn), {
    search: {},
    to: '/dashboard',
  });
  assert.deepEqual(resultReturnDestination({ kind: 'dashboard' }), {
    search: {},
    to: '/dashboard',
  });
});

test('rejects arbitrary source routes and unknown focus keys', () => {
  assert.equal(
    parseResultReturnState({
      returnFocusKey: 'evil-selector',
      returnTo: 'https://example.com',
    }),
    undefined
  );
  assert.equal(
    parseResultReturnState({
      returnFocusKey: 'unknown-focus',
      returnTo: 'task-inbox',
    }),
    undefined
  );
});
