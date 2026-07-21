/**
 * Image worksurface projection tests (WT-D2 / #100).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCreateFromThisCommand,
  FORBIDDEN_DESKTOP_GATE_MESSAGES,
  IMAGE_MOBILE_P0_ACTIONS,
  projectImageMobileP0Actions,
  projectImageWorksurface,
  type ImageCandidate,
  type ImageWorksurfaceFacts,
} from './image-worksurface-model';
import {
  createEmptyWorkingSelection,
  reduceWorkingSelection,
} from './working-selection-reducer';

const NOW = '2026-07-20T12:00:00.000Z';

function candidates(n: number): ImageCandidate[] {
  return Array.from({ length: n }, (_, i) => ({
    assetId: `img-${i + 1}`,
    persisted: true,
    rightsOk: true,
    generationOk: true,
  }));
}

function facts(
  overrides: Partial<ImageWorksurfaceFacts> = {}
): ImageWorksurfaceFacts {
  return {
    workId: 'work-1',
    baseRevisionId: 'rev-1',
    outputType: 'single_image',
    slot: 'standalone',
    lifecycle: 'candidate',
    candidates: candidates(1),
    hasContentPackage: false,
    mediaVersionReady: true,
    ...overrides,
  };
}

test('≥2 candidates default to set mode; switchable to single', () => {
  const view = projectImageWorksurface(facts({ candidates: candidates(2) }));
  assert.equal(view.mode, 'set');
  assert.equal(view.modeSwitchable, true);

  const single = projectImageWorksurface(
    facts({ candidates: candidates(2), explicitMode: 'single' })
  );
  assert.equal(single.mode, 'single');
});

test('single candidate stays single mode', () => {
  const view = projectImageWorksurface(facts());
  assert.equal(view.mode, 'single');
  assert.equal(view.primaryAction?.label, '采用这张');
});

test('set mode primary is 加入套图 or 采用这组', () => {
  const emptySel = createEmptyWorkingSelection({
    workId: 'work-1',
    baseRevisionId: 'rev-1',
    now: NOW,
  });
  const withSel = reduceWorkingSelection(
    reduceWorkingSelection(emptySel, {
      type: 'add',
      assetId: 'img-1',
      now: NOW,
    }).state,
    { type: 'add', assetId: 'img-2', now: NOW }
  ).state;

  const ready = projectImageWorksurface(
    facts({
      candidates: candidates(3),
      outputType: 'ordered_image_set',
      slot: 'gallery',
      workingSelection: emptySel,
    })
  );
  // Full candidate set ready → direct 采用这组
  assert.equal(ready.primaryAction?.label, '采用这组');

  const assembling = projectImageWorksurface(
    facts({
      candidates: candidates(3),
      outputType: 'ordered_image_set',
      slot: 'gallery',
      workingSelection: withSel,
      focusedAssetId: 'img-1',
    })
  );
  assert.equal(assembling.primaryAction?.label, '采用这组');
});

test('a11y names include role order and adopted state', () => {
  const view = projectImageWorksurface(
    facts({
      candidates: candidates(2),
      lifecycle: 'adopted',
      hasContentPackage: true,
      adoptedOrderedAssetIds: ['img-1'],
      slot: 'gallery',
    })
  );
  const first = view.candidates.find((c) => c.assetId === 'img-1');
  assert.ok(first);
  assert.match(first!.a11yName, /第 1 张/);
  assert.match(first!.a11yName, /已采用/);
});

test('library actions independent; create_from_this reinjects store facts + quote', () => {
  const view = projectImageWorksurface(
    facts({
      lifecycle: 'adopted',
      hasContentPackage: true,
      adoptedOrderedAssetIds: ['img-1'],
      storeFactsSnapshotId: 'facts-9',
      productQuoteSnapshotId: 'quote-3',
      mediaVersionReady: true,
      focusedAssetId: 'img-1',
    })
  );
  assert.ok(view.libraryActions.some((a) => a.label === '保存到素材库'));
  assert.ok(view.createFromThis);
  assert.equal(view.createFromThis?.label, '基于此再创作');
  assert.equal(view.createFromThis?.reinject.storeFactsSnapshotId, 'facts-9');
  assert.equal(view.createFromThis?.reinject.productQuoteSnapshotId, 'quote-3');
  assert.equal(view.createFromThis?.constraints.copyOldPrices, false);
  assert.equal(view.createFromThis?.constraints.mutateSource, false);
});

test('buildCreateFromThisCommand always reinjects and never copies old facts', () => {
  const command = buildCreateFromThisCommand({
    sourceWorkId: 'work-1',
    sourceRevisionId: 'rev-1',
    storeFactsSnapshotId: 'sf-1',
    productQuoteSnapshotId: 'pq-1',
  });
  assert.equal(command.kind, 'create_from_this');
  assert.equal(command.reinject.storeFactsSnapshotId, 'sf-1');
  assert.equal(command.constraints.copyCustomerFacts, false);
});

test('mobile P0 full actions and no desktop gate messages', () => {
  const mobile = projectImageMobileP0Actions();
  assert.equal(mobile.desktopOnlyMessage, null);
  for (const action of IMAGE_MOBILE_P0_ACTIONS) {
    assert.ok(mobile.actions.includes(action));
  }
  for (const msg of FORBIDDEN_DESKTOP_GATE_MESSAGES) {
    assert.ok(mobile.forbiddenMessages.includes(msg));
  }
  const view = projectImageWorksurface(
    facts({ candidates: candidates(2), viewport: 'mobile' })
  );
  assert.equal(view.mobileDesktopGate, null);
  assert.equal(view.adjustPrompt.placeholder, '还想怎么改？');
  assert.equal(view.adjustPrompt.persistent, true);
});

test('partial generation set is not adoptable', () => {
  const selection = reduceWorkingSelection(
    reduceWorkingSelection(
      createEmptyWorkingSelection({
        workId: 'work-1',
        baseRevisionId: 'rev-1',
        now: NOW,
      }),
      { type: 'add', assetId: 'img-1', now: NOW }
    ).state,
    { type: 'add', assetId: 'img-2', now: NOW }
  ).state;

  const view = projectImageWorksurface(
    facts({
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
          generationOk: false,
        },
      ],
      workingSelection: selection,
      explicitMode: 'set',
      outputType: 'ordered_image_set',
      slot: 'gallery',
    })
  );
  assert.equal(view.wholeSetAdopt?.kind, 'rejected');
  if (view.wholeSetAdopt?.kind === 'rejected') {
    assert.equal(view.wholeSetAdopt.code, 'PARTIAL_SET_FORBIDDEN');
  }
});
