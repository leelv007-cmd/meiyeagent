/**
 * #104 acceptance: mobile video P0 actions (play / light cover / subtitle
 * proof + shared result actions). Never "请到桌面继续" for these basics.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  adoptComposedFilm,
  markDelivered,
  projectVideoMobileP0Actions,
  videoWorksurfaceFixture,
} from './video-worksurface-model';

describe('mobile video P0 actions', () => {
  it('exposes play, light cover, subtitle proof without desktop redirect', () => {
    const state = videoWorksurfaceFixture();
    const mobile = projectVideoMobileP0Actions(state);

    assert.equal(mobile.requiresDesktopContinue, false);

    const mediaIds = mobile.mediaActions.map((a) => a.id);
    assert.deepEqual(mediaIds, ['play', 'light_cover', 'subtitle_proof']);

    for (const action of mobile.mediaActions) {
      assert.equal(action.kind, 'media');
      assert.equal(action.enabled, true);
      assert.notEqual(action.label, '请到桌面继续');
    }

    assert.equal(mobile.primaryResult?.id, 'adopt_candidate');
    assert.equal(mobile.primaryResult?.label, '使用此成片');
    assert.equal(mobile.primaryResult?.kind, 'result');

    // Mobile budget: one primary + more (secondary/overflow collapsed).
    assert.ok(mobile.moreResult.length >= 1);
    assert.ok(mobile.moreResult.some((a) => a.id === 'continue_adjust'));
    assert.ok(mobile.moreResult.some((a) => a.id === 'deliver'));
    // History / Run Detail stay hidden until P1 surfaces exist.
    assert.equal(
      mobile.moreResult.some((a) => a.id === 'open_history'),
      false
    );
    assert.equal(
      mobile.moreResult.some((a) => a.id === 'open_run_detail'),
      false
    );
  });

  it('play label reflects player state; cover/subtitle stay available after adopt', () => {
    let state = videoWorksurfaceFixture();
    state = {
      ...state,
      player: { ...state.player, playing: true },
    };
    let mobile = projectVideoMobileP0Actions(state);
    assert.equal(
      mobile.mediaActions.find((a) => a.id === 'play')?.label,
      '暂停'
    );

    const adopted = adoptComposedFilm(state, {
      contentPackageId: 'cp-video-1',
      now: '2026-07-20T12:05:00.000Z',
    });
    mobile = projectVideoMobileP0Actions(adopted.state);
    assert.equal(mobile.requiresDesktopContinue, false);
    assert.equal(mobile.primaryResult?.id, 'deliver');
    assert.ok(mobile.mediaActions.every((a) => a.enabled));

    const delivered = markDelivered(adopted.state);
    mobile = projectVideoMobileP0Actions(delivered);
    assert.equal(mobile.primaryResult?.id, 'create_from_this');
    assert.equal(mobile.requiresDesktopContinue, false);
    // Media P0 still available post-delivery for review.
    assert.deepEqual(
      mobile.mediaActions.map((a) => a.id),
      ['play', 'light_cover', 'subtitle_proof']
    );
  });

  it('never surfaces desktop-only copy for mobile P0 labels', () => {
    const mobile = projectVideoMobileP0Actions(videoWorksurfaceFixture());
    const labels = [
      ...mobile.mediaActions.map((a) => a.label),
      mobile.primaryResult?.label ?? '',
      ...mobile.moreResult.map((a) => a.label),
    ];
    for (const label of labels) {
      assert.equal(label.includes('请到桌面'), false, label);
      assert.equal(label.includes('桌面继续'), false, label);
    }
  });
});
