/**
 * ResultCenterNavigation contract tests (WT-D1 / #99).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RESULT_CENTER_PATH_PATTERN,
  RESULT_CENTER_ROUTE_ID,
  buildResultCenterNavigation,
  navigateAfterSubmitSuccess,
  resultCenterLocationFromNavigation,
  resultTargetFromRoute,
} from './result-center-navigation';

test('buildResultCenterNavigation requires workId', () => {
  assert.throws(() => buildResultCenterNavigation({ workId: '' }), /workId/);
  const nav = buildResultCenterNavigation({
    workId: 'work-1',
    returnToDraftKey: 'draft-x',
    focusKey: 'primary',
  });
  assert.deepEqual(nav, {
    workId: 'work-1',
    returnToDraftKey: 'draft-x',
    focusKey: 'primary',
  });
});

test('location uses /dashboard/results/$workId not ?workId= bridge', () => {
  const location = resultCenterLocationFromNavigation(
    { workId: 'work-42', returnToDraftKey: 'd1', focusKey: 'f1' },
    { panel: 'run', sourceRoute: '/dashboard' }
  );
  assert.equal(location.pathname, '/dashboard/results/work-42');
  assert.match(RESULT_CENTER_PATH_PATTERN, /results\/\$workId/);
  assert.equal(RESULT_CENTER_ROUTE_ID, '/dashboard/results_/$workId');
  assert.equal(location.search.panel, 'run');
  assert.equal(location.search.focusKey, 'f1');
  assert.equal('workId' in location.search, false);
});

test('navigateAfterSubmitSuccess is the composer handoff seam', () => {
  const location = navigateAfterSubmitSuccess({
    workId: 'work-submit',
    returnToDraftKey: 'composer-draft-1',
    sourceRoute: '/dashboard',
  });
  assert.equal(location.pathname, '/dashboard/results/work-submit');
  assert.equal(location.state?.returnToDraftKey, 'composer-draft-1');
  assert.equal(location.state?.sourceRoute, '/dashboard');
});

test('resultTargetFromRoute builds shareable target', () => {
  assert.deepEqual(
    resultTargetFromRoute({
      workId: 'w',
      contentId: 'c',
      panel: 'history',
    }),
    { workId: 'w', contentId: 'c', panel: 'history' }
  );
});
