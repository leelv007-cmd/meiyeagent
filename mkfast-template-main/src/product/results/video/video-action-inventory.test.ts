import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  projectVideoMobileP0Actions,
  videoBillableScopes,
  videoWorksurfaceFixture,
  videoWorksurfaceFreeActions,
} from './video-worksurface-model';

describe('retired video editing action inventory', () => {
  it('keeps only receiving, viewing and selection actions', () => {
    assert.deepEqual(videoWorksurfaceFreeActions, [
      'poll',
      'recover',
      'download_supplier_task',
      'play_control',
      'adopt_candidate',
      'select_shot_candidate',
      'deterministic_sort',
    ]);
    assert.deepEqual(videoBillableScopes, []);
  });

  it('keeps only playback as a mobile media action', () => {
    const mobile = projectVideoMobileP0Actions(videoWorksurfaceFixture());

    assert.deepEqual(
      mobile.mediaActions.map((action) => action.id),
      ['play']
    );
    assert.equal(mobile.requiresDesktopContinue, false);
  });

  it('never exports retry from a failed receiver state', () => {
    const failed = {
      ...videoWorksurfaceFixture(),
      loopPhase: 'failed' as const,
    };
    const mobile = projectVideoMobileP0Actions(failed);

    assert.equal(mobile.primaryResult, null);
    assert.equal(
      mobile.moreResult.some((action) => action.id === 'retry'),
      false
    );
  });
});
