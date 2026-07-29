import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  adoptComposedFilm,
  markDelivered,
  projectVideoWorksurfaceActions,
  reorderShots,
  selectShotCandidate,
  togglePlay,
  videoWorksurfaceFixture,
} from './video-worksurface-model';

describe('video worksurface projection', () => {
  it('projects an upstream result for viewing without inventing media', () => {
    const state = videoWorksurfaceFixture();

    assert.equal(state.composedCandidate?.assetId, 'composed-asset-1');
    assert.equal(
      state.composedCandidate?.posterUrl,
      '/seed/video/video-poster-vertical.webp'
    );
    assert.equal(state.player.subtitleTrackUrl, '/v1/assets/sub-asset-1');
    assert.equal(state.storyboard.length, 3);
    assert.equal(state.loopPhase, 'candidate_ready');
  });

  it('plays the received video without creating usage', () => {
    const initial = videoWorksurfaceFixture();
    const playing = togglePlay(initial);
    const paused = togglePlay(playing);

    assert.equal(playing.player.playing, true);
    assert.equal(paused.player.playing, false);
  });

  it('selects received candidates and reorders them deterministically', () => {
    const initial = videoWorksurfaceFixture();
    const selected = selectShotCandidate(initial, 'shot-opening', 1);

    assert.equal(selected.fee.freeAction, 'select_shot_candidate');
    assert.equal(selected.state.storyboard[0]?.selectedCandidateIndex, 1);
    assert.deepEqual(selected.state.uncommitted.shotSelections, {
      'shot-opening': 1,
    });

    const reordered = reorderShots(selected.state, [
      'shot-service',
      'shot-opening',
      'shot-cta',
    ]);
    assert.equal(reordered.fee.freeAction, 'deterministic_sort');
    assert.deepEqual(
      reordered.state.storyboard.map((shot) => shot.shotId),
      ['shot-service', 'shot-opening', 'shot-cta']
    );
  });

  it('keeps adopt and delivery as the result actions', () => {
    const candidate = videoWorksurfaceFixture();
    assert.equal(
      projectVideoWorksurfaceActions(candidate).primaryAction?.id,
      'adopt_candidate'
    );

    const adopted = adoptComposedFilm(candidate, {
      contentPackageId: 'cp-video-1',
      now: '2026-07-29T00:00:00.000Z',
    });
    assert.equal(adopted.fee.freeAction, 'adopt_candidate');
    assert.equal(
      projectVideoWorksurfaceActions(adopted.state).primaryAction?.id,
      'deliver'
    );

    const delivered = markDelivered(adopted.state);
    assert.equal(delivered.delivery.attempt, 'delivered');
  });
});
