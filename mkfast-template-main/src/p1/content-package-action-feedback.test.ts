import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { P1RequestError } from './client';
import { recoverContentPackageAction } from './content-package-action-feedback';

describe('ContentPackage action feedback', () => {
  it('refreshes stale packages and returns dedicated feedback for a version conflict', async () => {
    let refreshes = 0;

    const feedback = await recoverContentPackageAction(
      new P1RequestError(
        'The package changed.',
        'CONTENT_PACKAGE_VERSION_CONFLICT'
      ),
      async () => {
        refreshes += 1;
      }
    );

    assert.equal(feedback, 'version_conflict');
    assert.equal(refreshes, 1);
  });

  it('also refreshes after a generic command failure before showing fallback feedback', async () => {
    let refreshes = 0;

    const feedback = await recoverContentPackageAction(
      new P1RequestError('Export failed.', 'CONTENT_PACKAGE_EXPORT_FAILED'),
      async () => {
        refreshes += 1;
      }
    );

    assert.equal(feedback, 'generic');
    assert.equal(refreshes, 1);
  });
});
