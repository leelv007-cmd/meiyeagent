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

test('returns to the exact Task Inbox filter, scroll, focus, and panel', () => {
  assert.deepEqual(resultReturnDestination(taskInboxReturn), {
    search: {
      date: 'week',
      mode: 'week',
      relatedKind: 'work',
      restoreFocusKey: 'mobile-progress-entry',
      restoreScrollY: 326,
      risk: 'attention',
      source: 'manual',
      status: 'in_progress',
    },
    to: '/dashboard/tasks',
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
