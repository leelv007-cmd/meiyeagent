/**
 * Conditional Brief surface — seven trigger show/cancel restore,
 * simple-task direct submit contrast, evidence "no evidence = not shown".
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { BriefTriggerConditionCode } from '@meiye/contracts';

import { overwriteGetLocale } from '@/locale/paraglide/runtime';

import {
  BRIEF_TRIGGER_CODES,
  cancelBriefSurface,
  confirmBriefSurface,
  createBriefSurfaceState,
  decideSubmitPath,
  openBriefSurface,
  projectBriefSurfaceView,
  projectEvidenceForBrowser,
  serializeBriefSurfaceForBrowser,
  shouldShowEvidenceDrawer,
  type ComposerInputSnapshot,
} from './brief-surface';
import { fixtureBriefProjection } from './brief-surface.fixture';
import { findForbiddenBrowserComposerKey } from './browser-contract';
import type { ComposerQuoteView } from './quote-wiring';

const SNAPSHOT: ComposerInputSnapshot = {
  userText: '本周美甲活动文案，强调安全卸甲',
  sources: [{ id: 'src-1', kind: 'asset' }],
  lensId: 'copy',
  draftRevisionId: 'draft-r1',
  hostState: { quantity: 3, catalogModelId: 'model.copy.basic' },
};

function openWith(
  codes: BriefTriggerConditionCode[],
  extras: Parameters<typeof fixtureBriefProjection>[0] = {
    requiresBrief: true,
  }
) {
  const projection = fixtureBriefProjection({
    ...extras,
    triggerCodes: codes,
    lensId: codes.includes('any_video') ? 'video' : 'copy',
  });
  let state = createBriefSurfaceState();
  state = openBriefSurface(state, {
    projection,
    composerSnapshot: {
      ...SNAPSHOT,
      lensId: codes.includes('any_video') ? 'video' : SNAPSHOT.lensId,
    },
  });
  return { state, projection };
}

describe('seven Brief trigger UI show / cancel restore', () => {
  it('exposes exactly the seven D-094 safety codes', () => {
    assert.deepEqual(
      [...BRIEF_TRIGGER_CODES],
      [
        'any_video',
        'multi_deliverable_or_cross_platform',
        'images_over_four',
        'restricted_assets',
        'high_risk_fact_missing_or_conflict',
        'quote_policy_threshold',
        'confirmation_invalid',
      ]
    );
  });

  for (const code of BRIEF_TRIGGER_CODES) {
    it(`shows Brief for trigger ${code} and cancel restores Composer input`, () => {
      const { state: opened } = openWith([code]);
      const view = projectBriefSurfaceView(opened, {
        lensId: opened.composerSnapshot?.lensId ?? null,
      });

      assert.equal(view.visible, true);
      assert.equal(view.phase, 'open');
      assert.ok(view.triggers.some((t) => t.code === code));
      assert.ok(view.summaryRows.length > 0);
      assert.equal(view.bindRevisions?.draftRevisionId, 'draft-rev-fixture');

      // Cancel returns to Composer without losing input
      const { state: cancelled, restored } = cancelBriefSurface(opened);
      assert.equal(cancelled.phase, 'cancelled');
      assert.equal(cancelled.projection, null);
      assert.ok(restored);
      assert.equal(restored.userText, SNAPSHOT.userText);
      assert.deepEqual(restored.sources, SNAPSHOT.sources);
      assert.equal(restored.draftRevisionId, SNAPSHOT.draftRevisionId);
      assert.equal(restored.hostState?.quantity, 3);
      assert.equal(restored.hostState?.catalogModelId, 'model.copy.basic');

      const hidden = projectBriefSurfaceView(cancelled);
      assert.equal(hidden.visible, false);
    });
  }

  it('confirm seals exact bindRevisions from the open projection', () => {
    const { state: opened, projection } = openWith(['quote_policy_threshold'], {
      requiresBrief: true,
      triggerCodes: ['quote_policy_threshold'],
      bindRevisions: {
        draftRevisionId: 'draft-exact',
        recipeRevisionId: 'recipe-r2',
        modelRevisionId: 'model-r3',
        quoteRevisionId: 'quote-r4',
        sourceRevisionId: 'source-r5',
        surfaceRevisionId: 'surface-r6',
        lensId: 'image_text',
      },
    });

    const result = confirmBriefSurface(opened, {
      confirmedAt: '2026-07-20T12:00:00.000Z',
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.state.phase, 'confirmed');
    assert.deepEqual(
      result.confirmation.boundRevisions,
      projection.bindRevisions
    );
    assert.deepEqual(result.confirmation.triggerCodes, [
      'quote_policy_threshold',
    ]);
    assert.equal(result.confirmation.confirmedAt, '2026-07-20T12:00:00.000Z');
  });
});

describe('simple task — no Brief, direct submit contrast', () => {
  it('decideSubmitPath returns direct_submit when requiresBrief is false', () => {
    const projection = fixtureBriefProjection({
      requiresBrief: false,
      triggerCodes: [],
      summary: {},
    });
    const decision = decideSubmitPath({ projection });
    assert.equal(decision.path, 'direct_submit');
    assert.equal(decision.reason, 'no_brief_required');
  });

  it('openBriefSurface is a no-op when requiresBrief is false', () => {
    const projection = fixtureBriefProjection({ requiresBrief: false });
    const state = openBriefSurface(createBriefSurfaceState(), {
      projection,
      composerSnapshot: SNAPSHOT,
    });
    assert.equal(state.phase, 'idle');
    assert.equal(state.projection, null);
    const view = projectBriefSurfaceView(state);
    assert.equal(view.visible, false);
  });

  it('D1: policy_exempt_copy never opens Brief even when requiresBrief is true', () => {
    const projection = fixtureBriefProjection({
      requiresBrief: true,
      triggerCodes: ['high_risk_facts'],
    });
    const decision = decideSubmitPath({
      projection,
      policyExemptCopy: true,
    });
    assert.equal(decision.path, 'direct_submit');
    assert.equal(decision.reason, 'no_brief_required');
  });

  it('requiresBrief true routes to open_brief', () => {
    const projection = fixtureBriefProjection({
      requiresBrief: true,
      triggerCodes: ['images_over_four'],
    });
    const decision = decideSubmitPath({ projection });
    assert.equal(decision.path, 'open_brief');
    if (decision.path === 'open_brief') {
      assert.equal(decision.projection.triggers[0]?.code, 'images_over_four');
    }
  });

  it('quota exhausted blocks before brief', () => {
    const projection = fixtureBriefProjection({
      requiresBrief: true,
      triggerCodes: ['any_video'],
    });
    const decision = decideSubmitPath({
      projection,
      quotaExhausted: true,
    });
    assert.equal(decision.path, 'blocked_quota');
  });

  it('videoConfirmRequired forces open_brief with requiresBrief true', () => {
    const projection = fixtureBriefProjection({
      requiresBrief: false,
      triggerCodes: [],
      lensId: 'video',
      summary: {},
    });
    const decision = decideSubmitPath({
      projection,
      videoConfirmRequired: true,
    });
    assert.equal(decision.path, 'open_brief');
    if (decision.path === 'open_brief') {
      assert.equal(decision.projection.requiresBrief, true);
      assert.equal(decision.reason, 'brief_required');
    }
  });

  it('videoConfirmRequired without projection does not invent open_brief', () => {
    // Caller must setShowRequiredHint and never runCreate in this case.
    const decision = decideSubmitPath({
      projection: null,
      videoConfirmRequired: true,
    });
    assert.equal(decision.path, 'direct_submit');
    assert.equal(decision.reason, 'no_brief_required');
  });

  it('videoConfirmRequired still yields to quota block', () => {
    const projection = fixtureBriefProjection({
      requiresBrief: false,
      lensId: 'video',
    });
    const decision = decideSubmitPath({
      projection,
      videoConfirmRequired: true,
      quotaExhausted: true,
    });
    assert.equal(decision.path, 'blocked_quota');
  });
});

describe('Brief target deliverable is merchant language', () => {
  it('maps Core image enum through the single label helper', () => {
    overwriteGetLocale(() => 'zh');
    const { state } = openWith(['quote_policy_threshold'], {
      requiresBrief: true,
      triggerCodes: ['quote_policy_threshold'],
      summary: {
        targetDeliverable: 'image',
        platforms: ['小红书'],
      },
    });
    const imageText = projectBriefSurfaceView(state, { lensId: 'image_text' });
    const imageRow = imageText.summaryRows.find(
      (row) => row.key === 'targetDeliverable'
    );
    assert.equal(imageRow?.value, '图文');

    const copyLens = projectBriefSurfaceView(state, { lensId: 'copy' });
    assert.equal(
      copyLens.summaryRows.find((row) => row.key === 'targetDeliverable')
        ?.value,
      '图片'
    );
  });
});

describe('evidence drawer — no evidence = not shown', () => {
  it('shouldShowEvidenceDrawer is false for empty / missing', () => {
    assert.equal(shouldShowEvidenceDrawer([]), false);
    assert.equal(shouldShowEvidenceDrawer(null), false);
    assert.equal(shouldShowEvidenceDrawer(undefined), false);
  });

  it('view.showEvidenceDrawer is false when projection has no evidence', () => {
    const { state } = openWith(['restricted_assets'], {
      requiresBrief: true,
      triggerCodes: ['restricted_assets'],
      evidenceDrawer: [],
    });
    const view = projectBriefSurfaceView(state);
    assert.equal(view.showEvidenceDrawer, false);
    assert.equal(view.evidenceEntries.length, 0);
  });

  it('view.showEvidenceDrawer is true only with real participating evidence', () => {
    const { state } = openWith(['high_risk_fact_missing_or_conflict'], {
      requiresBrief: true,
      triggerCodes: ['high_risk_fact_missing_or_conflict'],
      evidenceDrawer: [
        {
          sourceName: '门店价目表',
          sourceType: 'source_extracted',
          factKind: 'price',
          factSummary: '卸甲 99 元',
          appliedLocation: '正文价格',
          freshness: '本周更新',
          rightsStatus: '本店自有',
          uncertaintyOrConflict: '事实冲突',
          pendingConfirmation: true,
        },
      ],
    });
    const view = projectBriefSurfaceView(state);
    assert.equal(view.showEvidenceDrawer, true);
    assert.equal(view.evidenceEntries.length, 1);
    assert.equal(view.evidenceEntries[0]?.sourceName, '门店价目表');
    assert.equal(view.evidenceEntries[0]?.pendingConfirmation, true);
  });

  it('projectEvidenceForBrowser strips forbidden keys and empty shells', () => {
    const cleaned = projectEvidenceForBrowser([
      {
        sourceName: '',
        sourceType: 'system_suggested',
        factKind: 'price',
      },
      {
        sourceName: '系统建议',
        sourceType: 'system_suggested',
        factKind: 'term',
        factSummary: '活动截止周五',
        provider: 'openai',
      } as import('@meiye/contracts').BriefEvidenceEntry & {
        provider: string;
      },
    ]);
    // empty sourceName dropped; remaining stripped of provider
    assert.equal(cleaned.length, 1);
    assert.equal(cleaned[0]?.sourceName, '系统建议');
    assert.equal(
      findForbiddenBrowserComposerKey(
        cleaned as unknown as Record<string, unknown>
      ),
      null
    );
    assert.equal(
      'provider' in (cleaned[0] as unknown as Record<string, unknown>),
      false
    );
  });
});

describe('video confirm zone embedded in Brief', () => {
  it('embeds per-second billing note for video trigger', () => {
    const quote: ComposerQuoteView = {
      quoteId: 'q-v',
      revision: 'qr-1',
      catalogModelId: 'model.video.std',
      billingMode: 'per_output_second',
      amount: 30,
      quantity: 1,
      quotedSeconds: 15,
      targetSeconds: 15,
      creditCost: null,
      failureRefundsCredits: null,
      billingNote: '按生成成片 15 秒计费',
      lifecycleStatus: 'quoted',
      formulaExpression: '2 × 15s',
    };

    const { state } = openWith(['any_video'], {
      requiresBrief: true,
      triggerCodes: ['any_video'],
      lensId: 'video',
    });

    const view = projectBriefSurfaceView(state, {
      lensId: 'video',
      quote,
    });

    assert.ok(view.videoConfirm?.visible);
    assert.equal(view.videoConfirm?.billingNote, '按生成成片 15 秒计费');
    assert.equal(view.requiresVideoConfirm, true);
    assert.equal(view.canConfirm, true);

    const confirmed = confirmBriefSurface(state);
    assert.equal(confirmed.ok, true);
    if (confirmed.ok) {
      assert.equal(confirmed.state.videoConfirmAccepted, true);
    }
  });

  it('uses the single Brief CTA as the explicit video acceptance', () => {
    const { state } = openWith(['any_video'], {
      requiresBrief: true,
      triggerCodes: ['any_video'],
      lensId: 'video',
    });
    const result = confirmBriefSurface(state);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.state.videoConfirmAccepted, true);
    }
  });
});

describe('browser contract for Brief surface', () => {
  it('serialized view never embeds Provider / credential / route', () => {
    const { state } = openWith(['any_video'], {
      requiresBrief: true,
      triggerCodes: ['any_video'],
      evidenceDrawer: [
        {
          sourceName: '案例库',
          sourceType: 'source_extracted',
          factKind: 'effect',
          factSummary: '前后对比已授权',
        },
      ],
    });
    const view = projectBriefSurfaceView(state, { lensId: 'video' });
    const json = serializeBriefSurfaceForBrowser(view);
    assert.equal(findForbiddenBrowserComposerKey(JSON.parse(json)), null);
    assert.doesNotMatch(json, /provider/i);
    assert.doesNotMatch(json, /hidden.?prompt/i);
    assert.doesNotMatch(json, /credential/i);
  });
});

/**
 * #240 P1. `canConfirm` used to be unconditionally true for an open Brief, so a
 * merchant who kept typing after the card appeared could still confirm it — and
 * the card kept showing the price of the quote it was built against. Both doors
 * now answer to the same identity check the Composer's four gates use.
 */
describe('Brief confirmability follows the current quote identity', () => {
  it('stays confirmable and silent while the quote is still the current one', () => {
    const { state } = openWith(['quote_policy_threshold']);
    const view = projectBriefSurfaceView(state, {
      lensId: 'copy',
      quoteStale: false,
    });

    assert.equal(view.visible, true);
    assert.equal(view.canConfirm, true);
    assert.equal(view.staleNotice, null);
  });

  it('cannot be confirmed once the current quote no longer matches', () => {
    const { state } = openWith(['quote_policy_threshold']);
    const view = projectBriefSurfaceView(state, {
      lensId: 'copy',
      // What the host passes when `currentComposerQuoteView` came back empty.
      quote: null,
      quoteStale: true,
    });

    assert.equal(view.visible, true);
    assert.equal(view.canConfirm, false);
    assert.equal(
      view.staleNotice,
      '你刚改过要写的内容，这份确认对不上了。点“返回修改”再提交一次就好。'
    );
    // The card is not snatched away mid-read — cancel is still the way out.
    assert.equal(view.cancelLabel, '返回修改');
  });

  it('renders the stale quote decision in the active locale', () => {
    const { state } = openWith(['quote_policy_threshold']);

    overwriteGetLocale(() => 'en');
    const english = projectBriefSurfaceView(state, {
      lensId: 'copy',
      quoteStale: true,
    });
    assert.equal(
      english.staleNotice,
      'Your brief no longer matches what you just changed. Go back, then submit it again.'
    );

    overwriteGetLocale(() => 'zh');
    const chinese = projectBriefSurfaceView(state, {
      lensId: 'copy',
      quoteStale: true,
    });
    assert.equal(
      chinese.staleNotice,
      '你刚改过要写的内容，这份确认对不上了。点“返回修改”再提交一次就好。'
    );
  });

  it('omitting the flag keeps the previous behaviour for every other caller', () => {
    const { state } = openWith(['any_video']);
    const view = projectBriefSurfaceView(state, { lensId: 'video' });

    assert.equal(view.canConfirm, true);
    assert.equal(view.staleNotice, null);
  });

  it('a closed Brief carries no notice', () => {
    const { state } = openWith(['quote_policy_threshold']);
    const { state: cancelled } = cancelBriefSurface(state);
    const view = projectBriefSurfaceView(cancelled, { quoteStale: true });

    assert.equal(view.visible, false);
    assert.equal(view.canConfirm, false);
    assert.equal(view.staleNotice, null);
  });
});
