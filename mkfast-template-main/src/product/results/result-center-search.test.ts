import assert from 'node:assert/strict';
import test from 'node:test';

import { parseResultCenterSearch } from './result-center-search';

test('Result route preserves only its typed return state across reload', () => {
  assert.deepEqual(
    parseResultCenterSearch({
      focusKey: 'candidate-1',
      panel: 'run',
      returnDate: 'week',
      returnFocusKey: 'mobile-progress-entry',
      returnPanel: 'week',
      returnRelatedKind: 'work',
      returnRisk: 'attention',
      returnScrollY: '326',
      returnSource: 'manual',
      returnStatus: 'in_progress',
      returnTo: 'task-inbox',
      unsafeReturnUrl: 'https://example.com',
    }),
    {
      focusKey: 'candidate-1',
      panel: 'run',
      returnDate: 'week',
      returnFocusKey: 'mobile-progress-entry',
      returnPanel: 'week',
      returnRelatedKind: 'work',
      returnRisk: 'attention',
      returnScrollY: 326,
      returnSource: 'manual',
      returnStatus: 'in_progress',
      returnTo: 'task-inbox',
    }
  );
});
