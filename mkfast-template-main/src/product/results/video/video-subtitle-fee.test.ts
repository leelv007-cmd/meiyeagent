/**
 * #104/T23 acceptance: independent subtitle asset edit incurs no generation
 * fee; burned-in changes remain unavailable after recomposition retirement.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  classifySubtitleEdit,
  classifySupplierTaskOps,
  editSubtitleText,
  merchantShotLabel,
  toggleSubtitleEnabled,
  videoWorksurfaceFixture,
  videoWorksurfaceFreeActions,
} from './video-worksurface-model';

describe('supplier task ops never re-quote (P1-B4)', () => {
  it('poll / recover / download_supplier_task are free', () => {
    for (const action of [
      'poll',
      'recover',
      'download_supplier_task',
    ] as const) {
      const decision = classifySupplierTaskOps(action);
      assert.equal(decision.fee, 'none', action);
      assert.equal(decision.createsProductUsage, false, action);
      assert.equal(decision.requiresFullRecomposeQuote, false, action);
    }
  });

  it('merchant shot labels never leak UUIDs', () => {
    const label = merchantShotLabel({
      order: 0,
      promptPreview: '开场 7f3c2a10-1111-2222-3333-444455556666 到店',
      shotId: '7f3c2a10-1111-2222-3333-444455556666',
    });
    assert.match(label, /镜头 1/);
    assert.doesNotMatch(label, /7f3c2a10/);
    assert.doesNotMatch(label, /444455556666/);
  });
});

describe('subtitle fee boundary', () => {
  it('independent asset text edit is free and listed in free actions', () => {
    assert.ok(videoWorksurfaceFreeActions.includes('subtitle_text_edit'));

    const decision = classifySubtitleEdit({
      mode: 'independent_asset',
      change: 'text',
    });
    assert.equal(decision.fee, 'none');
    assert.equal(decision.createsProductUsage, false);
    assert.equal(decision.requiresFullRecomposeQuote, false);
    assert.equal(decision.freeAction, 'subtitle_text_edit');

    const state = videoWorksurfaceFixture({
      subtitleMode: 'independent_asset',
      subtitleText: '原稿字幕',
    });
    const edited = editSubtitleText(state, '校对后的独立字幕');
    assert.equal(edited.fee.createsProductUsage, false);
    assert.equal(edited.fee.requiresFullRecomposeQuote, false);
    assert.equal(edited.pendingQuote, null);
    assert.equal(edited.state.subtitle.text, '校对后的独立字幕');
    assert.equal(
      edited.state.uncommitted.subtitleDraftText,
      '校对后的独立字幕'
    );
  });

  it('independent toggle / style stay free (no re-encode)', () => {
    for (const change of ['toggle', 'style', 'replace_asset'] as const) {
      const decision = classifySubtitleEdit({
        mode: 'independent_asset',
        change,
      });
      assert.equal(decision.fee, 'none', change);
      assert.equal(decision.createsProductUsage, false, change);
    }

    const state = videoWorksurfaceFixture({
      subtitleMode: 'independent_asset',
    });
    const toggled = toggleSubtitleEnabled(state);
    assert.equal(toggled.fee.createsProductUsage, false);
    assert.equal(toggled.pendingQuote, null);
  });

  it('burned-in subtitle text change is unavailable and creates no usage', () => {
    const decision = classifySubtitleEdit({
      mode: 'burned_in',
      change: 'text',
    });
    assert.equal(decision.fee, 'unavailable');
    assert.equal(decision.createsProductUsage, false);
    assert.equal(decision.requiresFullRecomposeQuote, false);
    assert.match(decision.reason, /已下线/);

    const state = videoWorksurfaceFixture({
      subtitleMode: 'burned_in',
      subtitleText: '已烧录字幕',
    });
    const attempt = editSubtitleText(state, '改烧录字幕');
    assert.equal(attempt.fee.fee, 'unavailable');
    assert.equal(attempt.fee.createsProductUsage, false);
    assert.equal(attempt.fee.requiresFullRecomposeQuote, false);
    assert.equal(attempt.pendingQuote, null);
    // The retired path must not silently mutate burned-in media.
    assert.equal(attempt.state.subtitle.text, '已烧录字幕');
  });

  it('burned-in toggle/style are unavailable without opening a quote', () => {
    for (const change of ['toggle', 'style', 'replace_asset'] as const) {
      const decision = classifySubtitleEdit({
        mode: 'burned_in',
        change,
      });
      assert.equal(decision.fee, 'unavailable', change);
      assert.equal(decision.createsProductUsage, false, change);
      assert.equal(decision.requiresFullRecomposeQuote, false, change);
    }
  });

  it('burned-in edits leave no pending billable intent', () => {
    const state = videoWorksurfaceFixture({ subtitleMode: 'burned_in' });
    const burnedEdit = editSubtitleText(state, 'x');

    assert.equal(burnedEdit.fee.fee, 'unavailable');
    assert.equal(burnedEdit.fee.createsProductUsage, false);
    assert.equal(burnedEdit.pendingQuote, null);
  });
});
