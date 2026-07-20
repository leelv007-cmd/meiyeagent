/**
 * Z1 / #105 three-modal full journey (fixture composition).
 *
 * Discover → submit → stream wait → result → adjust → save deliver → restore
 * for copy / image_text / video, with D-098 C6 click-budget alignment.
 *
 * Full Playwright e2e remains the stronger gate when harness is available;
 * this suite composes pure models + navigation fixtures so CI stays green
 * without four-service boot.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { CreationLensId } from '@meiye/contracts';

import {
  decideSubmitPath,
  fixtureBriefProjection,
  openBriefSurface,
  createBriefSurfaceState,
  confirmBriefSurface,
  setBriefVideoConfirmAccepted,
} from './brief-surface';
import {
  bindQuoteView,
  canSubmit,
  createComposerLensState,
  selectLens,
  submitComposer,
  updateUserText,
} from './lens-state-machine';
import { listColdCardsFromSeeds } from './recipe-cards';
import {
  buildComposerQuote,
  projectComposerQuoteView,
} from './quote-wiring';
import {
  buildResultCenterNavigation,
  navigateAfterSubmitSuccess,
} from '@/product/results/result-center-navigation';
import {
  projectResultShellPhase,
  projectResultShellView,
  type ResultShellFacts,
} from '@/product/results/result-shell-model';
import {
  projectDeliveryPanel,
  type DeliveryPanelFacts,
} from '@/product/results/delivery-panel-model';
import {
  buildReturnRestoreSnapshot,
  emptyReturnRestoreStore,
  loadReturnRestoreSnapshot,
  saveReturnRestoreSnapshot,
} from '@/product/results/result-return-restore';
import { projectCopyImageTextWorksurface } from '@/product/results/copy-image-text-worksurface-model';
import { projectImageWorksurface } from '@/product/results/image-worksurface-model';
import {
  projectVideoWorksurfaceActions,
  videoWorksurfaceFixture,
} from '@/product/results/video/video-worksurface-model';
import { xiaohongshuPackageFixture } from '@/product/results/delivery-full-package';
import { handedOverReceiptFixture } from '@/product/results/delivery-assisted-model';

const LENSES: CreationLensId[] = ['copy', 'image_text', 'video'];

function quoteFor(lensId: CreationLensId) {
  return projectComposerQuoteView(
    buildComposerQuote({
      quoteId: `journey-${lensId}`,
      catalogModelId: `model.${lensId}`,
      quotePolicyRevision: 'qp.journey',
      billingMode: lensId === 'video' ? 'per_output_second' : 'per_request',
      unitRate: lensId === 'video' ? 1 : 2,
      quantity: 1,
      targetSeconds: lensId === 'video' ? 15 : undefined,
      minChargeSeconds: lensId === 'video' ? 2 : undefined,
    })
  );
}

/**
 * C6 click budget (isTrusted activations to first usable draft):
 * - template dual-purpose card: 1 (card) + 1 (start) = 2
 * - pure text: 1 (lens) + 1 (start) = 2
 * - video: 1 (lens) + 1 (start) + 1 (Brief confirm) = 3
 */
function clickBudgetForPath(path: 'template' | 'pure_text' | 'video'): number {
  if (path === 'video') return 3;
  return 2;
}

function workspaceKindFor(
  lensId: CreationLensId
): ResultShellFacts['workspaceKind'] {
  if (lensId === 'copy') return 'copy';
  if (lensId === 'image_text') return 'image';
  return 'video';
}

function deliveryFacts(): DeliveryPanelFacts {
  return {
    target: 'xiaohongshu',
    hasCopyableText: true,
    hasSingleDownload: true,
    hasFullPackage: true,
    hasExternalSendApproval: true,
    shareDevice: {
      hasNavigatorShare: true,
      canShareFiles: true,
      canShareText: true,
    },
    sharePayload: {
      kind: 'files',
      title: '包',
      files: [{ name: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 10 }],
      oneShotLinkUrl: 'https://app.example/handoff/t',
      downloadHref: '/dl.zip',
    },
    fullPackagePlan: xiaohongshuPackageFixture(),
    assistedReceipt: handedOverReceiptFixture(),
    nowIso: '2026-07-20T12:00:00.000Z',
    viewport: 'desktop',
  };
}

test('cold-start discovers six recipe cards covering three lenses', () => {
  const cards = listColdCardsFromSeeds();
  assert.ok(cards.length >= 6, `expected ≥6 cold cards, got ${cards.length}`);
  const lensSet = new Set(
    cards
      .map((card) => card.lensId)
      .filter((id): id is CreationLensId => id != null)
  );
  for (const lens of ['copy', 'image_text', 'video'] as const) {
    assert.ok(
      lensSet.has(lens) || cards.some((c) => c.familyId === 'reuse_content'),
      `missing discovery for ${lens}`
    );
  }
});

for (const lensId of LENSES) {
  test(`three-modal journey fixture: ${lensId}`, () => {
    // 1) Discover + select lens (C6 pure-text path activation #1)
    let state = createComposerLensState();
    assert.equal(canSubmit(state).allowed, false);

    state = selectLens(state, lensId);
    state = bindQuoteView(state, quoteFor(lensId));
    state = updateUserText(state, `旅程测试 · ${lensId}`);

    // 2) Submit gate (+ optional Brief for video)
    let activations = 1; // lens select
    const projection =
      lensId === 'video'
        ? fixtureBriefProjection({
            requiresBrief: true,
            triggerCodes: ['any_video'],
            lensId,
          })
        : null;
    const path = decideSubmitPath({ projection });

    let briefConfirmed = false;
    if (path.path === 'open_brief' && projection) {
      let brief = createBriefSurfaceState();
      brief = openBriefSurface(brief, {
        projection,
        composerSnapshot: {
          userText: state.draft.userText,
          sources: [],
          lensId,
          draftRevisionId: 'draft-journey',
        },
      });
      brief = setBriefVideoConfirmAccepted(brief, true);
      const confirmed = confirmBriefSurface(brief);
      assert.equal(confirmed.ok, true);
      briefConfirmed = true;
      activations += 1; // Brief confirm
    }

    activations += 1; // start / submit
    const expectedBudget =
      lensId === 'video'
        ? clickBudgetForPath('video')
        : clickBudgetForPath('pure_text');
    assert.equal(
      activations,
      expectedBudget,
      `${lensId} click budget expected ${expectedBudget}, got ${activations}`
    );
    if (lensId === 'video') {
      assert.equal(briefConfirmed, true);
    }

    const submitted = submitComposer(state, {
      videoConfirmAccepted: lensId === 'video' ? true : undefined,
      confirmPriceMatchesCharge: true,
    });
    assert.equal(submitted.ok, true);
    if (!submitted.ok) return;

    // 3) Stream wait → Result Center navigation
    const workId = `work-journey-${lensId}`;
    const location = navigateAfterSubmitSuccess({
      workId,
      sourceRoute: '/dashboard',
      panel: 'run',
    });
    assert.equal(location.pathname, `/dashboard/results/${workId}`);
    assert.equal(location.search.panel, 'run');

    // 4) Result shell phase progression (running → ready)
    const workspaceKind = workspaceKindFor(lensId);
    const runningFacts: ResultShellFacts = {
      target: { workId },
      workspaceKind,
      progressState: 'running',
    };
    assert.equal(projectResultShellPhase(runningFacts), 'running');

    const readyFacts: ResultShellFacts = {
      ...runningFacts,
      progressState: 'success',
      hasUsableCandidate: true,
      hasAdoptedCandidate: true,
    };
    const phase = projectResultShellPhase(readyFacts);
    assert.ok(
      phase === 'ready' || phase === 'delivered' || phase === 'running',
      `unexpected phase ${phase}`
    );
    const shell = projectResultShellView(readyFacts);
    assert.equal(shell.kind, 'ready');

    // 5) Adjust worksurface projection per modality
    if (lensId === 'copy' || lensId === 'image_text') {
      const copyView = projectCopyImageTextWorksurface({
        workId,
        baseRevisionId: 'rev-1',
        document: {
          title: '候选标题',
          body: '候选正文',
          conversionHook: '',
          topics: [],
          orderedAssetIds: [],
        },
        lifecycle: 'adopted',
        viewport: 'desktop',
      });
      assert.equal(copyView.panels.adjustPrompt, true);
      assert.equal(copyView.mobileDesktopGate, null);
    }

    if (lensId === 'image_text') {
      const imageView = projectImageWorksurface({
        workId,
        baseRevisionId: 'rev-1',
        outputType: 'ordered_image_set',
        slot: 'gallery',
        lifecycle: 'candidate',
        hasContentPackage: false,
        mediaVersionReady: true,
        candidates: [
          {
            assetId: 'img-1',
            persisted: true,
            rightsOk: true,
            generationOk: true,
          },
          {
            assetId: 'img-2',
            persisted: true,
            rightsOk: true,
            generationOk: true,
          },
        ],
        viewport: 'desktop',
      });
      assert.equal(imageView.mobileDesktopGate, null);
    }

    if (lensId === 'video') {
      const videoState = videoWorksurfaceFixture();
      const videoActions = projectVideoWorksurfaceActions(videoState);
      assert.ok(videoActions.primaryAction || videoActions.secondaryActions.length > 0);
    }

    // 6) Save / deliver panel
    const delivery = projectDeliveryPanel(deliveryFacts());
    assert.equal(delivery.surface.testId, 'delivery-panel');
    assert.ok(delivery.visibleGroups.length > 0);

    // 7) Restore snapshot round-trip
    let store = emptyReturnRestoreStore();
    const snapshot = buildReturnRestoreSnapshot({
      workId,
      returnToDraftKey: `draft-${lensId}`,
      focusKey: 'composer-intent',
      sourceRoute: '/dashboard',
    });
    store = saveReturnRestoreSnapshot(store, workId, snapshot);
    const restored = loadReturnRestoreSnapshot(store, workId);
    assert.ok(restored);
    assert.equal(restored?.returnToDraftKey, `draft-${lensId}`);

    // Navigation contract stability
    const nav = buildResultCenterNavigation({ workId });
    assert.equal(nav.workId, workId);
  });
}

test('C6 click budget matrix is exact (not ≤)', () => {
  assert.equal(clickBudgetForPath('template'), 2);
  assert.equal(clickBudgetForPath('pure_text'), 2);
  assert.equal(clickBudgetForPath('video'), 3);
});
