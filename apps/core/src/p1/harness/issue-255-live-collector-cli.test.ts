import assert from 'node:assert/strict';
import test from 'node:test';

import { assertIssue255LiveCollectorLaunch } from './issue-255-live-collector-cli.js';

test('issue 255 live collector CLI stays fail-closed without explicit live GO', () => {
  assert.throws(
    () => assertIssue255LiveCollectorLaunch({}),
    /remains disabled/u,
  );
  assert.throws(
    () =>
      assertIssue255LiveCollectorLaunch({
        RUN_LIVE_ISSUE_255: '0',
        MODEL_EXECUTION_MODE: 'direct',
        MODEL_MEDIA_EXECUTION_MODE: 'tuzi',
        PROVIDER_LIVE_COST_CAP_CNY: '5',
      }),
    /remains disabled/u,
  );
});
