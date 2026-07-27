/**
 * #104 Video worksurface pure model tests (WT-E).
 *
 * Covers player / cover / storyboard / regen intents / action matrix /
 * free-action fee negatives / Pro Studio handoff.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  VIDEO_WORKSPACE_KIND,
  VIDEO_WORKSURFACE_PROJECTION_ONLY,
  adoptComposedFilm,
  buildVideoProStudioRefineHandoff,
  buildVideoWorksurfaceState,
  classifyShotRegen,
  classifySubtitleEdit,
  editSubtitleText,
  projectVideoWorksurfaceActions,
  reorderShots,
  requestShotRegen,
  seekPlayer,
  selectShotCandidate,
  setCoverFromAuthorizedImage,
  setCoverFromFrame,
  setFullscreen,
  togglePlay,
  toggleSubtitleEnabled,
  videoWorksurfaceFixture,
  videoWorksurfaceFreeActions,
  type VideoWorksurfaceState,
} from './video-worksurface-model';

function assertNoProviderLeak(value: unknown) {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes('Provider'), false);
  assert.equal(serialized.includes('Credential'), false);
  assert.equal(serialized.includes('Deployment'), false);
  assert.equal(serialized.includes('fallback'), false);
}

describe('video worksurface fixture + projection marker', () => {
  it('exports projection-only marker and builds a completed fixture', () => {
    assert.equal(VIDEO_WORKSURFACE_PROJECTION_ONLY, true);
    assert.equal(VIDEO_WORKSPACE_KIND, 'video');

    const state = videoWorksurfaceFixture();
    assert.equal(state.workId, 'work-video-1');
    assert.equal(state.workflowStatus, 'completed');
    assert.equal(state.loopPhase, 'candidate_ready');
    assert.equal(state.storyboard.length, 3);
    assert.ok(state.composedCandidate);
    assert.equal(state.subtitle.mode, 'independent_asset');
    assertNoProviderLeak(state);
  });

  it('derives storyboard candidates from public projection shots', () => {
    const state = videoWorksurfaceFixture();
    const opening = state.storyboard.find((s) => s.shotId === 'shot-opening');
    assert.ok(opening);
    assert.equal(opening.candidates.length, 2);
    assert.equal(opening.selectedCandidateIndex, 0);
    assert.equal(opening.candidates[0]?.selected, true);
    assert.equal(opening.candidates[1]?.selected, false);
  });

  it('restores canonical revision, shot order and subtitle text from the public projection', () => {
    const state = buildVideoWorksurfaceState({
      workId: 'work-video-restore',
      baseRevisionId: 'base-rev-restore',
      workflow: {
        workflowId: 'workflow-video-restore',
        status: 'completed',
        storyboardVersion: 2,
        storyboardRevision: 'storyboard-rev-2',
        catalogModelId: 'seedance-2',
        confirmed: true,
        revision: 7,
        updatedAt: '2026-07-20T12:00:00.000Z',
        subtitleText: '服务端字幕',
        shots: [
          {
            shotId: 'shot-service',
            candidatesPerShot: 2,
            selectedCandidateIndex: 0,
            candidateCount: 2,
          },
          {
            shotId: 'shot-opening',
            candidatesPerShot: 2,
            selectedCandidateIndex: 1,
            candidateCount: 2,
          },
        ],
      },
    });

    assert.equal(state.workflowRevision, 7);
    assert.equal(state.subtitle.text, '服务端字幕');
    assert.deepEqual(
      state.storyboard.map((shot) => shot.shotId),
      ['shot-service', 'shot-opening']
    );
    assert.equal(state.storyboard[1]?.selectedCandidateIndex, 1);
  });

  it('requires workId', () => {
    const fixture = videoWorksurfaceFixture();
    assert.throws(
      () =>
        buildVideoWorksurfaceState({
          workId: '   ',
          workflow: {
            workflowId: fixture.workflowId,
            status: fixture.workflowStatus,
            storyboardVersion: fixture.storyboardVersion,
            storyboardRevision: fixture.storyboardRevision,
            catalogModelId: fixture.catalogModelId,
            confirmed: true,
            shots: [],
            revision: 1,
            updatedAt: '2026-07-20T12:00:00.000Z',
          },
          baseRevisionId: 'r1',
        }),
      /workId/
    );
  });
});

describe('player / cover', () => {
  it('toggles play, seeks, and fullscreen without generation fee', () => {
    let state = videoWorksurfaceFixture();
    assert.equal(state.player.playing, false);

    state = togglePlay(state);
    assert.equal(state.player.playing, true);

    state = seekPlayer(state, 12);
    assert.equal(state.player.currentTimeSeconds, 12);

    state = seekPlayer(state, 999);
    assert.equal(state.player.currentTimeSeconds, 24);

    state = setFullscreen(state, true);
    assert.equal(state.player.fullscreen, true);
  });

  it('sets cover from frame or authorized image as free cover_select', () => {
    const base = videoWorksurfaceFixture();

    const fromFrame = setCoverFromFrame(base, 3.5);
    assert.equal(fromFrame.fee.fee, 'none');
    assert.equal(fromFrame.fee.createsProductUsage, false);
    assert.equal(fromFrame.fee.freeAction, 'cover_select');
    assert.equal(fromFrame.state.cover.source, 'frame');
    assert.equal(fromFrame.state.cover.frameTimeSeconds, 3.5);
    assert.equal(fromFrame.state.uncommitted.coverDraft?.source, 'frame');

    const fromImage = setCoverFromAuthorizedImage(
      base,
      'auth-img-9',
      '/v1/assets/auth-img-9'
    );
    assert.equal(fromImage.fee.createsProductUsage, false);
    assert.equal(fromImage.state.cover.source, 'authorized_image');
    assert.equal(fromImage.state.cover.assetId, 'auth-img-9');
    assert.equal(fromImage.state.selectedObjectId, 'auth-img-9');
  });
});

describe('storyboard selection / reorder / regen intents', () => {
  it('selects shot candidate and reorders deterministically without fee', () => {
    const base = videoWorksurfaceFixture();

    const selected = selectShotCandidate(base, 'shot-opening', 1);
    assert.equal(selected.fee.fee, 'none');
    assert.equal(selected.fee.freeAction, 'select_shot_candidate');
    const opening = selected.state.storyboard.find(
      (s) => s.shotId === 'shot-opening'
    );
    assert.equal(opening?.selectedCandidateIndex, 1);
    assert.equal(opening?.candidates[1]?.selected, true);
    assert.equal(
      selected.state.uncommitted.shotSelections?.['shot-opening'],
      1
    );

    const reordered = reorderShots(selected.state, [
      'shot-cta',
      'shot-opening',
      'shot-service',
    ]);
    assert.equal(reordered.fee.freeAction, 'deterministic_sort');
    assert.equal(reordered.fee.createsProductUsage, false);
    assert.deepEqual(
      reordered.state.storyboard.map((s) => s.shotId),
      ['shot-cta', 'shot-opening', 'shot-service']
    );
    assert.deepEqual(reordered.state.uncommitted.shotOrder, [
      'shot-cta',
      'shot-opening',
      'shot-service',
    ]);
  });

  it('only shot regeneration opens a billable quote', () => {
    const base = videoWorksurfaceFixture();

    const shot = requestShotRegen(base, 'shot-service');
    assert.equal(shot.fee.fee, 'billable');
    assert.equal(shot.fee.scope, 'shot');
    assert.equal(shot.fee.createsProductUsage, true);
    assert.equal(shot.fee.actionLabel, '重新生成此镜头');
    assert.equal(shot.state.pendingQuote?.scope, 'shot');
    assert.equal(shot.state.pendingQuote?.shotId, 'shot-service');
    assert.equal(
      shot.state.pendingQuote?.createsNewTaskAndIndependentQuote,
      true
    );

    assert.equal(classifyShotRegen('shot-x').scope, 'shot');
  });
});

describe('action matrix (contracts ResultActionId, video labels)', () => {
  it('candidate_ready primary is 使用此成片 / adopt_candidate', () => {
    const actions = projectVideoWorksurfaceActions(videoWorksurfaceFixture());
    assert.equal(actions.primaryAction?.id, 'adopt_candidate');
    assert.equal(actions.primaryAction?.label, '使用此成片');
    assert.ok(actions.secondaryActions.some((a) => a.id === 'continue_adjust'));
    assert.ok(actions.secondaryActions.some((a) => a.id === 'deliver'));
  });

  it('adopted primary is deliver; delivered primary is create_from_this', () => {
    const state = videoWorksurfaceFixture();
    const adopted = adoptComposedFilm(state, {
      contentPackageId: 'cp-video-1',
      now: '2026-07-20T12:05:00.000Z',
    });
    assert.equal(adopted.fee.createsProductUsage, false);
    assert.equal(adopted.state.loopPhase, 'adopted');
    assert.equal(adopted.contentRevision, 1);

    const adoptedActions = projectVideoWorksurfaceActions(adopted.state);
    assert.equal(adoptedActions.primaryAction?.id, 'deliver');
    assert.equal(adoptedActions.primaryAction?.label, '交付');

    const delivered: VideoWorksurfaceState = {
      ...adopted.state,
      delivery: { attempt: 'delivered' },
      loopPhase: 'delivered',
    };
    const deliveredActions = projectVideoWorksurfaceActions(delivered);
    assert.equal(deliveredActions.primaryAction?.id, 'create_from_this');
    assert.equal(deliveredActions.primaryAction?.label, '基于此再创作');
    assert.equal(
      deliveredActions.secondaryActions.some((a) => a.id === 'open_history'),
      false
    );
    assert.equal(
      deliveredActions.overflowActions.some((a) => a.id === 'open_run_detail'),
      false
    );
  });
});

describe('free action inventory', () => {
  it('includes subtitle_text_edit and adopt_candidate as free', () => {
    assert.ok(videoWorksurfaceFreeActions.includes('subtitle_text_edit'));
    assert.ok(videoWorksurfaceFreeActions.includes('adopt_candidate'));
    assert.ok(videoWorksurfaceFreeActions.includes('cover_select'));
    assert.ok(videoWorksurfaceFreeActions.includes('deterministic_sort'));
  });
});

describe('Pro Studio refine handoff', () => {
  it('preserves revision, selection, uncommitted and return navigation', () => {
    let state = videoWorksurfaceFixture();
    state = selectShotCandidate(state, 'shot-cta', 0).state;
    state = setCoverFromFrame(state, 1).state;
    state = editSubtitleText(state, '校对后的字幕').state;

    const handoff = buildVideoProStudioRefineHandoff(state, {
      returnToDraftKey: 'draft-abc',
      focusKey: 'shot-cta',
    });

    assert.equal(handoff.entryPath, '/pro-studio');
    assert.equal(handoff.createsEmptyProject, false);
    assert.equal(handoff.workId, 'work-video-1');
    assert.equal(handoff.baseRevisionId, state.baseRevisionId);
    assert.equal(handoff.contentId, 'cp-video-1');
    assert.equal(handoff.versionId, 'rev-cp-2');
    // Last local selection was cover frame → composed asset id is preserved.
    assert.equal(handoff.selectedObjectId, state.selectedObjectId);
    assert.equal(handoff.selectedObjectId, 'composed-asset-1');
    assert.equal(handoff.uncommittedEditKey.workspaceKind, 'video');
    assert.equal(handoff.uncommittedEditKey.workId, 'work-video-1');
    assert.equal(
      handoff.uncommittedEditKey.baseRevisionId,
      state.baseRevisionId
    );
    assert.equal(handoff.uncommitted.subtitleDraftText, '校对后的字幕');
    assert.equal(handoff.uncommitted.coverDraft?.source, 'frame');
    assert.equal(handoff.uncommitted.shotSelections?.['shot-cta'], 0);
    assert.equal(handoff.returnNavigation.workId, 'work-video-1');
    assert.equal(handoff.returnNavigation.returnToDraftKey, 'draft-abc');
    // Explicit focusKey overrides selectedObjectId for return restore.
    assert.equal(handoff.returnNavigation.focusKey, 'shot-cta');
    assert.equal(handoff.returnPath, '/dashboard/results/work-video-1');
    assert.equal(handoff.returnSearch.contentId, 'cp-video-1');
    assert.equal(handoff.returnSearch.focusKey, 'shot-cta');
    assertNoProviderLeak(handoff);
  });
});

describe('subtitle independent vs burned-in classification', () => {
  it('independent asset text is free; burned-in edits are unavailable', () => {
    const free = classifySubtitleEdit({
      mode: 'independent_asset',
      change: 'text',
    });
    assert.equal(free.fee, 'none');
    assert.equal(free.createsProductUsage, false);
    assert.equal(free.requiresFullRecomposeQuote, false);
    assert.equal(free.freeAction, 'subtitle_text_edit');

    const burned = classifySubtitleEdit({
      mode: 'burned_in',
      change: 'text',
    });
    assert.equal(burned.fee, 'unavailable');
    assert.equal(burned.createsProductUsage, false);
    assert.equal(burned.requiresFullRecomposeQuote, false);
    assert.match(burned.reason, /已下线/);
  });

  it('editSubtitleText applies the free path or leaves burned-in media unchanged', () => {
    const independent = videoWorksurfaceFixture({
      subtitleMode: 'independent_asset',
    });
    const freeEdit = editSubtitleText(independent, '新字幕文案');
    assert.equal(freeEdit.fee.createsProductUsage, false);
    assert.equal(freeEdit.state.subtitle.text, '新字幕文案');
    assert.equal(freeEdit.pendingQuote, null);

    const burned = videoWorksurfaceFixture({ subtitleMode: 'burned_in' });
    const unavailable = editSubtitleText(burned, '烧录改动');
    assert.equal(unavailable.fee.fee, 'unavailable');
    assert.equal(unavailable.fee.createsProductUsage, false);
    assert.equal(unavailable.pendingQuote, null);
    assert.equal(unavailable.state.subtitle.text, burned.subtitle.text);
  });

  it('toggle independent subtitle stays free and updates track binding', () => {
    const state = videoWorksurfaceFixture({
      subtitleMode: 'independent_asset',
      subtitleEnabled: true,
    });
    const toggled = toggleSubtitleEnabled(state);
    assert.equal(toggled.fee.fee, 'none');
    assert.equal(toggled.state.subtitle.enabled, false);
    assert.equal(toggled.state.player.subtitleTrackUrl, null);
  });
});
