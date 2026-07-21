/**
 * #104 acceptance: video candidate → adopt → deliver closed loop (fixture).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  adoptComposedFilm,
  markDelivered,
  projectVideoWorksurfaceActions,
  runCandidateAdoptDeliverLoop,
  videoWorksurfaceFixture,
} from './video-worksurface-model';

describe('video candidate → adopt → deliver closed loop', () => {
  it('runs fixture loop with free adopt/deliver and correct action ids', () => {
    const { steps, final } = runCandidateAdoptDeliverLoop();

    assert.equal(steps.length, 3);

    assert.equal(steps[0]?.step, 'candidate_ready');
    assert.equal(steps[0]?.phase, 'candidate_ready');
    assert.equal(steps[0]?.primaryActionId, 'adopt_candidate');
    assert.equal(steps[0]?.primaryActionLabel, '使用此成片');
    assert.equal(steps[0]?.createsProductUsage, false);
    assert.equal(steps[0]?.contentRevision, null);

    assert.equal(steps[1]?.step, 'adopted');
    assert.equal(steps[1]?.phase, 'adopted');
    assert.equal(steps[1]?.primaryActionId, 'deliver');
    assert.equal(steps[1]?.primaryActionLabel, '交付');
    assert.equal(steps[1]?.contentRevision, 1);
    assert.equal(steps[1]?.createsProductUsage, false);

    assert.equal(steps[2]?.step, 'delivered');
    assert.equal(steps[2]?.phase, 'delivered');
    assert.equal(steps[2]?.primaryActionId, 'create_from_this');
    assert.equal(steps[2]?.primaryActionLabel, '基于此再创作');
    assert.equal(steps[2]?.deliveryAttempt, 'delivered');
    assert.equal(steps[2]?.createsProductUsage, false);

    assert.equal(final.adoption.status, 'adopted');
    assert.equal(final.adoption.composedAssetId, 'composed-asset-1');
    assert.equal(final.delivery.attempt, 'delivered');
    assert.equal(final.loopPhase, 'delivered');
  });

  it('rejects adopt without composed candidate and deliver without adopt', () => {
    const noCompose = videoWorksurfaceFixture({
      composedCandidate: null,
      adoption: { status: 'none' },
    });
    // completed workflow without composed → still candidate_ready by status,
    // but adopt requires composed bytes.
    assert.throws(
      () =>
        adoptComposedFilm(
          {
            ...noCompose,
            composedCandidate: null,
            loopPhase: 'candidate_ready',
          },
          { contentPackageId: 'cp-x' }
        ),
      /composed candidate/
    );

    const candidate = videoWorksurfaceFixture();
    assert.throws(() => markDelivered(candidate), /adopted film/);
  });

  it('OCC-style revision increments on successive adopts from prior revision', () => {
    let state = videoWorksurfaceFixture({
      adoption: {
        status: 'candidate_ready',
        contentRevision: 2,
        contentPackageId: 'cp-video-1',
        composedAssetId: null,
        adoptedAt: null,
      },
    });
    // After first adopt from fixture with priorRevision 2 → 3
    const first = adoptComposedFilm(state, {
      contentPackageId: 'cp-video-1',
      now: '2026-07-20T12:10:00.000Z',
    });
    assert.equal(first.contentRevision, 3);
    assert.equal(first.state.baseRevisionId, 'rev-3');

    // Second adopt path: treat as new candidate after recompose.
    state = {
      ...first.state,
      loopPhase: 'candidate_ready',
      adoption: {
        ...first.state.adoption,
        status: 'candidate_ready',
      },
      composedCandidate: {
        assetId: 'composed-asset-2',
        playableUrl: '/v1/assets/composed-asset-2',
        durationSeconds: 24,
      },
    };
    const second = adoptComposedFilm(state, {
      contentPackageId: 'cp-video-1',
      now: '2026-07-20T12:20:00.000Z',
    });
    assert.equal(second.contentRevision, 4);
    assert.equal(second.state.adoption.composedAssetId, 'composed-asset-2');

    const actions = projectVideoWorksurfaceActions(second.state);
    assert.equal(actions.primaryAction?.id, 'deliver');
  });
});
