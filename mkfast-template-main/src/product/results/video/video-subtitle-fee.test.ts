/**
 * #104 acceptance: independent subtitle asset edit incurs no gen fee;
 * burned-in subtitle change requires full recompose quote.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  classifySubtitleEdit,
  classifySupplierTaskOps,
  editSubtitleText,
  merchantShotLabel,
  requestFullRecompose,
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

  it('burned-in subtitle text change requires full_compose quote', () => {
    const decision = classifySubtitleEdit({
      mode: 'burned_in',
      change: 'text',
    });
    assert.equal(decision.fee, 'billable');
    assert.equal(decision.scope, 'full_compose');
    assert.equal(decision.createsProductUsage, true);
    assert.equal(decision.requiresFullRecomposeQuote, true);
    assert.equal(decision.actionLabel, '重新合成整段');
    assert.match(decision.reason, /烧录字幕/);

    const state = videoWorksurfaceFixture({
      subtitleMode: 'burned_in',
      subtitleText: '已烧录字幕',
    });
    const attempt = editSubtitleText(state, '改烧录字幕');
    assert.equal(attempt.fee.createsProductUsage, true);
    assert.equal(attempt.fee.requiresFullRecomposeQuote, true);
    assert.equal(attempt.pendingQuote?.scope, 'full_compose');
    assert.equal(attempt.pendingQuote?.actionLabel, '重新合成整段');
    assert.equal(attempt.pendingQuote?.createsNewTaskAndIndependentQuote, true);
    // Must not silently mutate burned-in text without recompose.
    assert.equal(attempt.state.subtitle.text, '已烧录字幕');
  });

  it('burned-in toggle/style also force full recompose quote', () => {
    for (const change of ['toggle', 'style', 'replace_asset'] as const) {
      const decision = classifySubtitleEdit({
        mode: 'burned_in',
        change,
      });
      assert.equal(decision.scope, 'full_compose', change);
      assert.equal(decision.requiresFullRecomposeQuote, true, change);
    }
  });

  it('explicit full recompose path matches burned-in quote scope', () => {
    const state = videoWorksurfaceFixture({ subtitleMode: 'burned_in' });
    const recompose = requestFullRecompose(state);
    const burnedEdit = editSubtitleText(state, 'x');

    assert.equal(
      recompose.fee.scope,
      burnedEdit.fee.fee === 'billable' ? burnedEdit.fee.scope : null
    );
    assert.equal(recompose.state.pendingQuote?.scope, 'full_compose');
    assert.equal(burnedEdit.pendingQuote?.scope, 'full_compose');
  });
});
